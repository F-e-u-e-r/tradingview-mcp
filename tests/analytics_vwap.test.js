/**
 * Issue #16 — VWAP suite: kernel vectors, core orchestration (the 1-minute
 * resolution gate, the vwap period refusal, vwap-specific null metadata),
 * and the D2 containment pin on data_get_ohlcv's public shape.
 *
 * Contract: issue #16 (owner-authored) + owner rulings 2026-08-23 (D1–D4):
 *   - D1: the kernel lives in src/analytics/vwap.js, ADJACENT to A1 —
 *     src/analytics/indicators.js stays byte-identical (BT1 sha-pins it).
 *   - D2: `chart.resolution()` is captured in the SAME evaluate snapshot as
 *     the bars and travels as INTERNAL acquisition metadata only; the
 *     public data_get_ohlcv response shape must NOT gain a field. vwap
 *     requires the authoritative resolution to be exactly "1" — no aliases
 *     ("1m", 1, "01") — refused BEFORE the kernel runs.
 *   - D3: higher-timeframe aggregation is DEFERRED. Binding invariant for
 *     any future work (recorded, not implemented): higher-TF VWAP MUST
 *     aggregate the canonical 1m weighted-value/volume contributions and
 *     MUST NOT recompute from higher-TF aggregated OHLC.
 *   - D4: vwap nulls are ZERO-VOLUME nulls, not warm-up —
 *     warmup_nulls_total is 0 for vwap, the count reports in the
 *     vwap-only zero_volume_nulls_total, and `period` is OMITTED from the
 *     vwap result (never null, never 0).
 *
 * Division of responsibility mirrors analytics_tool.test.js: the served
 * -32602 boundary and the two period refusals THROUGH the SDK live there;
 * this file owns the kernel and the core orchestration semantics.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vwap } from '../src/analytics/vwap.js';
import { getIndicator } from '../src/core/analytics.js';
import { getOhlcv } from '../src/core/data.js';

// A bar whose hlc3 is exactly `x` (high = low = close = x makes hlc3 = 3x/3
// = x, exact in binary64 for the dyadic values used here) with an explicit
// volume — the fixture arithmetic below is exact end-to-end, so every
// assertion compares with === semantics, the A1/BT house rule.
function vbar(time, x, volume) {
  return { time, open: x, high: x, low: x, close: x, volume };
}
const cols = (bars) => [
  bars.map((b) => b.high),
  bars.map((b) => b.low),
  bars.map((b) => b.close),
  bars.map((b) => b.volume),
];

// Owner regression pin (D4): under valid non-negative volumes the null set
// is a PREFIX — cumulative volume is non-decreasing, so `value, null` can
// never occur. Stronger than any count assertion.
function assertNullsArePrefix(series, label) {
  let seen = false;
  for (const v of series) {
    if (v !== null) seen = true;
    else assert.equal(seen, false, `${label}: null after a value — the zero-volume null set must be a prefix`);
  }
}

describe('vwap kernel — window-relative Σ(hlc3×volume)/Σ(volume)', () => {
  it('hand-derived exact vector: hlc3 {10,20,40} × volumes {1,1,2} → [10, 15, 27.5]', () => {
    const bars = [vbar(1, 10, 1), vbar(2, 20, 1), vbar(3, 40, 2)];
    const out = vwap(...cols(bars));
    // cumulative: 10/1, 30/2, 110/4 — every product, sum and quotient exact.
    assert.deepEqual(out, [10, 15, 27.5]);
    assertNullsArePrefix(out, 'exact vector');
  });
  it('hlc3 uses (high+low+close)/3 with real spreads, anchored at the first bar', () => {
    // (12+9+9)/3 = 10 and (24+18+18)/3 = 20 — exact; volumes 1,3 →
    // [10, (10 + 60)/4] = [10, 17.5].
    const bars = [
      { time: 1, open: 11, high: 12, low: 9, close: 9, volume: 1 },
      { time: 2, open: 19, high: 24, low: 18, close: 18, volume: 3 },
    ];
    assert.deepEqual(vwap(...cols(bars)), [10, 17.5]);
  });
  it('a single bar with volume equals that bar\'s hlc3 — no warm-up, defined at the first bar', () => {
    assert.deepEqual(vwap(...cols([vbar(1, 10, 5)])), [10]);
  });
  it('non-dyadic quotients are RAW doubles pinned by the written expression', () => {
    // volumes {1,2}: (10 + 40)/3 — not exactly representable; the kernel
    // must return the IEEE result of exactly this expression (no rounding).
    const bars = [vbar(1, 10, 1), vbar(2, 20, 2)];
    assert.equal(vwap(...cols(bars))[1], (10 + 20 * 2) / 3);
  });
  it('zero-volume PREFIX yields nulls, then values from the first bar with volume', () => {
    const bars = [vbar(1, 10, 0), vbar(2, 20, 0), vbar(3, 40, 4)];
    const out = vwap(...cols(bars));
    assert.deepEqual(out, [null, null, 40]);
    assertNullsArePrefix(out, 'prefix');
  });
  it('an INTERIOR zero-volume bar repeats the prior value — never an interior null', () => {
    const bars = [vbar(1, 10, 2), vbar(2, 999, 0), vbar(3, 40, 2)];
    const out = vwap(...cols(bars));
    // bar 2 contributes 999×0 = 0 to both sums: [20/2, 20/2, (20+80)/4].
    assert.deepEqual(out, [10, 10, 25]);
    assertNullsArePrefix(out, 'interior zero-volume');
  });
  it('all-zero cumulative volume is a typed error, never an all-null series', () => {
    const bars = [vbar(1, 10, 0), vbar(2, 20, 0)];
    assert.throws(() => vwap(...cols(bars)), { message: /vwap: cumulative volume is zero across the entire window/ });
  });
  it('negative or non-numeric volume is refused loudly, per bar', () => {
    for (const bad of [-1, -0.0001, Number.NaN, '5', true, null, undefined]) {
      const bars = [vbar(1, 10, 1), vbar(2, 20, bad)];
      assert.throws(
        () => vwap(...cols(bars)),
        { message: /vwap: volume must be a non-negative number/ },
        `volume=${String(bad)}`,
      );
    }
  });
  it('an invalid volume refuses even BEFORE any cumulative volume exists (r2 Luna F2)', () => {
    // The per-bar validation must not be gated behind cumVolume > 0: a
    // negative FIRST bar and a negative bar after a zero-volume prefix
    // both refuse.
    assert.throws(() => vwap([10], [10], [10], [-1]), { message: /vwap: volume must be a non-negative number/ });
    assert.throws(() => vwap(...cols([vbar(1, 10, 0), vbar(2, 20, -1)])), { message: /vwap: volume must be a non-negative number/ });
  });
  it('a contribution below the NORMAL range is refused — dropout and quantization alike (r2 Luna F1, generalized r3 Sol F1)', () => {
    // Dropout endpoint (r2): 0.5 × MIN_VALUE rounds to exactly 0 — the
    // pre-r2 kernel returned [0] where the contract requires the first
    // bar to equal its hlc3.
    assert.throws(
      () => vwap([0.5], [0.5], [0.5], [Number.MIN_VALUE]),
      { message: /vwap: contribution is below the normal floating-point range/ },
    );
    // Quantization interior (r3): 1.5 × MIN_VALUE rounds to 2×MIN_VALUE —
    // the pre-r3 kernel returned [2] for hlc3 1.5 (33% error, silently).
    assert.throws(
      () => vwap([1.5], [1.5], [1.5], [Number.MIN_VALUE]),
      { message: /vwap: contribution is below the normal floating-point range/ },
    );
    // Positive control: a NORMAL tiny contribution survives exactly —
    // 0.5 × 1e-300 = 5e-301 (normal), and 5e-301 / 1e-300 = 0.5.
    assert.deepEqual(vwap([0.5], [0.5], [0.5], [1e-300]), [0.5]);
  });
  it('the guards sit EXACTLY on their boundaries — normal floor, |·|, and the finite maximum all compute (r4 Luna F1–F3)', () => {
    // 2^-1022 is the smallest NORMAL double: the subnormal guard is
    // strict `<`, so a contribution of exactly MIN_NORMAL computes.
    assert.deepEqual(vwap([1], [1], [1], [2.2250738585072014e-308]), [1]);
    // The contract imposes no price-sign restriction: hlc3 −1 gives a
    // NEGATIVE normal contribution — |·| keeps it computable (a bare
    // `contribution < MIN_NORMAL` would refuse every negative price).
    assert.deepEqual(vwap([-1], [-1], [-1], [1]), [-1]);
    // Number.MAX_VALUE is finite: sums that land exactly there compute
    // (the guard is isFinite, not a >= MAX_VALUE ceiling).
    assert.deepEqual(vwap([1], [1], [1], [Number.MAX_VALUE]), [1]);
    // The guards are SIGN-SYMMETRIC (r4 Sol F2–F4): ordinary negative
    // prices compute their negative average verbatim…
    assert.deepEqual(vwap([-10, -20], [-10, -20], [-10, -20], [1, 1]), [-10, -15]);
    // …a NEGATIVE subnormal contribution is refused like a positive one
    // (an hlc3 > 0 mutant would silently return [-2] for hlc3 -1.5)…
    assert.throws(
      () => vwap([-1.5], [-1.5], [-1.5], [Number.MIN_VALUE]),
      { message: /vwap: contribution is below the normal floating-point range/ },
    );
    // …and overflow to -Infinity is refused like +Infinity (an
    // === Infinity comparison would let it serialize as JSON null).
    assert.throws(
      () => vwap([-2], [-2], [-2], [Number.MAX_VALUE]),
      { message: /vwap: cumulative sums are no longer finite/ },
    );
  });
  it('a zero-volume bar\'s PRICES are never read — an overflowing hlc3 there cannot poison the sums (r3 Sol F2)', () => {
    // (M+M+M)/3 = Infinity, and Infinity × 0 = NaN: before the fix this
    // threw the sums guard; the contract requires the volume-0 bar to
    // contribute NOTHING — [null, 10] — and the interior variant to
    // repeat the prior value.
    const M = Number.MAX_VALUE;
    assert.deepEqual(vwap([M, 10], [M, 10], [M, 10], [0, 1]), [null, 10]);
    assert.deepEqual(vwap([10, M, 20], [10, M, 20], [10, M, 20], [1, 0, 3]), [10, 10, (10 + 60) / 4]);
  });
  it('an all-zero price bar with positive volume is a LEGITIMATE zero contribution (r3 Sol F3)', () => {
    // hlc3 === 0 exactly: the subnormal guard must not fire — the
    // average of zero prices is 0, not an error.
    assert.deepEqual(vwap([0], [0], [0], [1]), [0]);
    assert.deepEqual(vwap([0, 30], [0, 30], [0, 30], [1, 1]), [0, 15]);
  });
  it('a cumulative sum that overflows to Infinity is refused — never a silent JSON null (r2 Sol F1)', () => {
    // Reproduction of the confirmed defect: hlc3 2 × volume MAX_VALUE
    // overflows the weighted sum; the pre-fix kernel returned [Infinity],
    // which serializes as JSON null while zero_volume_nulls_total stays 0.
    assert.throws(
      () => vwap([2], [2], [2], [Number.MAX_VALUE]),
      { message: /vwap: cumulative sums are no longer finite/ },
    );
    // The sum can also overflow across bars whose individual
    // contributions are finite: hlc3 5e307 × volume 2 = 1e308 per bar,
    // and 1e308 + 1e308 → Infinity at index 1. (hlc3 itself must stay
    // representable: (x+x+x) overflows first for x ≥ MAX/3.)
    assert.throws(
      () => vwap(...cols([vbar(1, 5e307, 2), vbar(2, 5e307, 2)])),
      { message: /vwap: cumulative sums are no longer finite/ },
    );
    // Positive control: one huge-but-finite bar computes exactly.
    assert.deepEqual(vwap(...cols([vbar(1, 1e307, 1)])), [1e307]);
  });
  it('cumulative VOLUME overflow alone is refused too — both sums are guarded (r3 Luna F1)', () => {
    // hlc3 Number.MIN_VALUE with volumes Number.MAX_VALUE: every
    // contribution stays finite (~8.9e-16) while Σvolume overflows to
    // Infinity at index 1 — a cumWeighted-only guard would emit a
    // silently wrong 0 (finite ÷ Infinity).
    const bars = [vbar(1, Number.MIN_VALUE, Number.MAX_VALUE), vbar(2, Number.MIN_VALUE, Number.MAX_VALUE)];
    assert.throws(() => vwap(...cols(bars)), { message: /vwap: cumulative sums are no longer finite/ });
  });
  it('a one-bar all-zero-volume window is the same typed error as the multi-bar case (r2 Sol F2)', () => {
    assert.throws(() => vwap([10], [10], [10], [0]), { message: /vwap: cumulative volume is zero across the entire window/ });
  });
  it('hlc3 itself is the RAW (high+low+close)/3 — a non-integer hlc3 is pinned by its written expression (r2 Sol F3)', () => {
    // (10+10+11)/3 is not an integer; a Math.round(hlc3) mutant returns 10.
    assert.equal(vwap([10], [10], [11], [1])[0], (10 + 10 + 11) / 3);
  });
  it('negative zero volume is a legal zero contribution, not a refusal', () => {
    assert.deepEqual(vwap(...cols([vbar(1, 10, -0), vbar(2, 40, 4)])), [null, 40]);
  });
  it('fractional positive volumes weigh exactly — never rounded before accumulation (r1 Sol F5)', () => {
    // hlc3 {10, 20} × volumes {0.5, 1.5}: (5 + 30) / 2 = 17.5, exact in
    // binary64. A Math.round(volume) mutant returns (10 + 40)/3 instead.
    assert.deepEqual(vwap(...cols([vbar(1, 10, 0.5), vbar(2, 20, 1.5)])), [10, 17.5]);
  });
  it('mismatched column lengths refuse loudly (the A1 refusal style)', () => {
    assert.throws(() => vwap([1, 2], [1], [1, 2], [1, 2]), { message: /vwap: input columns must have equal lengths/ });
    assert.throws(() => vwap([1], [1], [1], []), { message: /vwap: input columns must have equal lengths/ });
  });
  it('an empty window is an empty series (the served path never produces one)', () => {
    assert.deepEqual(vwap([], [], [], []), []);
  });
  it('does not mutate its inputs', () => {
    const bars = [vbar(1, 10, 1), vbar(2, 20, 2)];
    const [h, l, c, v] = cols(bars);
    const snapshots = [h.slice(), l.slice(), c.slice(), v.slice()];
    vwap(h, l, c, v);
    assert.deepEqual([h, l, c, v], snapshots);
  });
});

// ── core orchestration: the 1m gate, the period refusal, vwap metadata ──────

function stubOhlcv(bars, extra = {}) {
  const calls = [];
  const getOhlcv = async (args) => { calls.push(args); return { success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, ...extra }; };
  return { calls, getOhlcv };
}
const oneMinute = { resolution: '1' };

describe('core — vwap through getIndicator', () => {
  it('computes over a 1-minute window: series, times, and vwap metadata', async () => {
    const bars = [vbar(101, 10, 1), vbar(102, 20, 1), vbar(103, 40, 2)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.equal(r.success, true);
    assert.equal(r.indicator, 'vwap');
    assert.deepEqual(r.times, [101, 102, 103]);
    assert.deepEqual(r.series.value, [10, 15, 27.5]);
    assert.equal(r.metadata.warmup_nulls_total, 0, 'vwap has NO warm-up — this field must not repurpose zero-volume nulls');
    assert.equal(r.metadata.zero_volume_nulls_total, 0);
    assert.equal('period' in r, false, 'period is OMITTED from the vwap result — not null, not 0');
    assert.equal(r.note, undefined, 'the warm-up insufficient-history note must never fire for vwap');
  });
  it('zero-volume prefix: nulls + honest vwap-specific metadata', async () => {
    const bars = [vbar(1, 10, 0), vbar(2, 20, 0), vbar(3, 40, 4)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [null, null, 40]);
    assert.equal(r.metadata.warmup_nulls_total, 0);
    assert.equal(r.metadata.zero_volume_nulls_total, 2);
    assert.equal(r.note, undefined);
  });
  it('last=N tail-slices AFTER the full-window computation — the anchor stays the window start', async () => {
    const bars = [vbar(101, 10, 1), vbar(102, 20, 1), vbar(103, 40, 2)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', last: 1, _deps: { getOhlcv } });
    assert.deepEqual(r.times, [103]);
    assert.deepEqual(r.series.value, [27.5], '27.5 is the WINDOW-anchored cumulative — a tail-anchored recomputation would return 40');
    assert.deepEqual(
      { total: r.metadata.total, returned: r.metadata.returned, truncated: r.metadata.truncated },
      { total: 3, returned: 1, truncated: true },
    );
    assert.equal(r.metadata.zero_volume_nulls_total, 0, 'counted on the full pre-truncation series');
  });
  it('non-"1" authoritative resolution is refused BEFORE the kernel — naming required and actual', async () => {
    const bars = [vbar(1, 10, 1), vbar(2, 20, 1)]; // fully computable — only the gate can refuse
    // ' 1 ' / '1 ' pin EXACT-string comparison against a whitespace-
    // normalizing (trim) mutant (r2 Sol F8).
    for (const actual of ['5', '60', '1D', '1m', '01', 1, ' 1 ', '1 ']) {
      const { calls, getOhlcv } = stubOhlcv(bars, { resolution: actual });
      await assert.rejects(
        () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
        (err) => {
          assert.match(err.message, /exactly "1"/, 'the refusal must name the required resolution');
          assert.ok(err.message.includes(JSON.stringify(actual)), `the refusal must name the actual resolution, got: ${err.message}`);
          return true;
        },
        `resolution=${JSON.stringify(actual)}`,
      );
      assert.equal(calls.length, 1, 'the gate reads the SAME acquisition — exactly one fetch, no second evaluate');
    }
  });
  it('the gate names a FALSY authoritative 0 verbatim — got: 0, never collapsed to null (r3 Luna F2)', async () => {
    // The gate has its own ?? null; a || null mutant would report
    // got: null for an authoritative numeric 0, violating "names actual"
    // (the data-assembly twin of this pin is in the containment suite).
    const { getOhlcv } = stubOhlcv([vbar(1, 10, 1)], { resolution: 0 });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
      { message: /exactly "1", got: 0\. Set/ },
    );
  });
  it('an unestablished resolution (envelope null / legacy stub without the field) fails CLOSED', async () => {
    const bars = [vbar(1, 10, 1)];
    for (const extra of [{}, { resolution: null }]) {
      const { getOhlcv } = stubOhlcv(bars, extra);
      await assert.rejects(
        () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
        { message: /exactly "1", got: null/ },
      );
    }
  });
  it('vwap with a period is refused BEFORE acquisition — including the schema-valid minimum 1 (r1 Sol F4)', async () => {
    const calls = [];
    const getOhlcv = async (args) => { calls.push(args); throw new Error('acquisition must not run'); };
    for (const period of [14, 1]) {
      await assert.rejects(
        () => getIndicator({ indicator: 'vwap', period, _deps: { getOhlcv } }),
        { message: /vwap does not take a period/ },
        `period=${period}`,
      );
    }
    assert.equal(calls.length, 0);
  });
  it('the resolution refusal PRECEDES the kernel — it wins even when the kernel would also refuse (r1 Sol F2)', async () => {
    // resolution "60" AND a negative volume: the contract requires the
    // resolution refusal, so a gate moved after the dispatch (which would
    // surface the volume error instead) is discriminated here.
    const bars = [vbar(1, 10, 1), vbar(2, 20, -1)];
    const { getOhlcv } = stubOhlcv(bars, { resolution: '60' });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
      { message: /exactly "1", got: "60"/ },
    );
  });
  it('a negative volume refuses THROUGH core — acquisition columns are never normalized (r1 Sol F6)', async () => {
    // A core-side Math.abs (or any clamp) would silently compute; the
    // kernel's per-bar refusal must propagate through getIndicator.
    const bars = [vbar(1, 10, 1), vbar(2, 20, -1)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
      { message: /vwap: volume must be a non-negative number/ },
    );
  });
  it('EVERY non-vwap indicator with a missing/invalid period is refused BEFORE acquisition with the kernel\'s exact message (r3 Sol F6)', async () => {
    // rsi/atr/donchian kernels carry DEFAULTS (14/14/20): a per-indicator
    // exemption mutant in the core gate would silently compute with the
    // kernel default instead of refusing — so the omission refusal is
    // pinned for all five, not a sample.
    const calls = [];
    const getOhlcv = async (args) => { calls.push(args); throw new Error('acquisition must not run'); };
    for (const indicator of ['sma', 'ema', 'rsi', 'atr', 'donchian']) {
      await assert.rejects(
        () => getIndicator({ indicator, _deps: { getOhlcv } }),
        { message: `${indicator}: period must be a positive integer, got: undefined` },
        indicator,
      );
    }
    await assert.rejects(
      () => getIndicator({ indicator: 'rsi', period: 0, _deps: { getOhlcv } }),
      { message: 'rsi: period must be a positive integer, got: 0' },
    );
    assert.equal(calls.length, 0);
  });
  it('all-zero-volume windows propagate the kernel\'s typed error through core', async () => {
    const { getOhlcv } = stubOhlcv([vbar(1, 10, 0), vbar(2, 20, 0)], oneMinute);
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
      { message: /cumulative volume is zero/ },
    );
  });
  it('a sum-overflow refusal propagates through core — never a served null claiming zero nulls (r2 Sol F1)', async () => {
    const { getOhlcv } = stubOhlcv([vbar(1, 2, Number.MAX_VALUE)], oneMinute);
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv } }),
      { message: /cumulative sums are no longer finite/ },
    );
  });
  it('non-vwap indicators neither require nor read the resolution envelope, and gain no vwap metadata — ALL five (r1 Sol F8)', async () => {
    // The vwap-only field must not leak onto ANY other indicator (a mutant
    // widening the condition to one more indicator survives an SMA-only
    // absence check).
    const bars = [vbar(1, 10, 1), vbar(2, 20, 1), vbar(3, 30, 1)];
    const { getOhlcv } = stubOhlcv(bars); // deliberately NO resolution field
    for (const indicator of ['sma', 'ema', 'rsi', 'atr', 'donchian']) {
      const r = await getIndicator({ indicator, period: 2, _deps: { getOhlcv } });
      assert.equal(r.success, true, indicator);
      assert.equal('zero_volume_nulls_total' in r.metadata, false, `zero_volume_nulls_total leaked onto ${indicator}`);
      assert.equal(r.period, 2, `${indicator} results keep their period echo`);
    }
  });
  it('vwap forwards from/to into acquisition — the caller-selected anchor window (r1 Luna F3)', async () => {
    // A mutant that drops from/to for vwap would silently answer with
    // latest-mode bars — the anchor the caller chose via `from` is the
    // product's whole point.
    const { calls, getOhlcv } = stubOhlcv([vbar(101, 10, 1)], oneMinute);
    await getIndicator({ indicator: 'vwap', from: 100, to: 200, count: 7, _deps: { getOhlcv } });
    assert.deepEqual(calls[0], { summary: false, count: 7, from: 100, to: 200, includeResolution: true });
  });
  it('core wires the REAL high/low/close columns into hlc3 — asymmetric bar discriminates (r1 Luna F4)', async () => {
    // (24+18+18)/3 = 20 ≠ close 18: a closes-only miswiring returns 18.
    const bars = [{ time: 1, open: 19, high: 24, low: 18, close: 18, volume: 1 }];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [20]);
  });
  it('the core path transports vwap raw doubles — non-dyadic value pinned by the written expression (r1 Luna F5)', async () => {
    const bars = [vbar(1, 10, 1), vbar(2, 20, 2)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.equal(r.series.value[1], (10 + 20 * 2) / 3, 'any rounding layer in the dispatch breaks bit-exactness');
  });
  it('a legitimate VWAP of exactly 0 is a VALUE, never miscounted as a zero-volume null (r4 Sol F6)', async () => {
    // A `!v` null-check mutant counts the falsy value 0 as a null; the
    // D4 count must stay 0 while the series carries [0, 5].
    const bars = [vbar(1, 0, 1), vbar(2, 10, 1)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [0, 5]);
    assert.equal(r.metadata.zero_volume_nulls_total, 0, 'the value 0 is not a null');
    assert.equal(r.metadata.warmup_nulls_total, 0);
  });
  it('zero_volume_nulls_total counts NULL POINTS, not zero-volume bars (r3 Sol F5)', async () => {
    // An interior zero-volume bar produces NO null (the value repeats) —
    // a count-the-zero-volume-bars mutant reports 1 here.
    const bars = [vbar(1, 10, 1), vbar(2, 999, 0), vbar(3, 20, 3)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [10, 10, (10 + 60) / 4]);
    assert.equal(r.metadata.zero_volume_nulls_total, 0, 'no null points exist — the zero-volume BAR is not a null');
  });
  it('zero_volume_nulls_total stays the FULL-window count under last (r1 Luna F6)', async () => {
    const bars = [vbar(1, 10, 0), vbar(2, 20, 0), vbar(3, 40, 4)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', last: 1, _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [40]);
    assert.equal(r.metadata.zero_volume_nulls_total, 2, 'counted BEFORE tail-slicing, like warmup_nulls_total');
    assert.equal(r.metadata.warmup_nulls_total, 0);
  });
});

// ── D2 containment: resolution is INTERNAL acquisition metadata ─────────────

describe('data — same-snapshot resolution stays out of the public shape', () => {
  // The evaluate stub returns what the enriched page snippet returns; the
  // containment question is what getOhlcv REPORTS from it, per caller.
  const page = (resolution) => async () => ({
    bars: [vbar(1, 10, 1), vbar(2, 20, 2)],
    total_bars: 2,
    truncated: false,
    source: 'direct_bars',
    ...(resolution === undefined ? {} : { resolution }),
  });

  it('data_get_ohlcv\'s shape is UNCHANGED: no resolution key without the internal opt-in (non-summary and summary)', async () => {
    const raw = await getOhlcv({ summary: false, _deps: { evaluate: page('5') } });
    assert.equal('resolution' in raw, false, 'the public non-summary shape must not grow a resolution field (D2 containment)');
    const summary = await getOhlcv({ summary: true, _deps: { evaluate: page('5') } });
    assert.equal('resolution' in summary, false, 'the public summary shape must not grow a resolution field (D2 containment)');
    // Containment holds at the CANONICAL resolution too (r4 Sol F9): a
    // leak conditioned on "1" would pass the "5" pins above.
    const rawOne = await getOhlcv({ summary: false, _deps: { evaluate: page('1') } });
    assert.equal('resolution' in rawOne, false, 'containment must not leak specifically on a 1-minute chart');
    const summaryOne = await getOhlcv({ summary: true, _deps: { evaluate: page('1') } });
    assert.equal('resolution' in summaryOne, false);
  });
  it('includeResolution: true carries the same-snapshot resolution to the internal caller', async () => {
    const raw = await getOhlcv({ summary: false, includeResolution: true, _deps: { evaluate: page('1') } });
    assert.equal(raw.resolution, '1');
    const summary = await getOhlcv({ summary: true, includeResolution: true, _deps: { evaluate: page('60') } });
    assert.equal(summary.resolution, '60');
  });
  it('an unreadable resolution reaches the internal caller as explicit null — never invented', async () => {
    const raw = await getOhlcv({ summary: false, includeResolution: true, _deps: { evaluate: page(undefined) } });
    assert.equal(raw.resolution, null);
  });
  it('a FALSY established resolution (numeric 0) is transported verbatim — the assembly must use ??, not || (r2 Sol F5)', async () => {
    const raw = await getOhlcv({ summary: false, includeResolution: true, _deps: { evaluate: page(0) } });
    assert.equal(raw.resolution, 0, 'non-summary assembly collapsed a falsy authoritative value');
    const summary = await getOhlcv({ summary: true, includeResolution: true, _deps: { evaluate: page(0) } });
    assert.equal(summary.resolution, 0, 'summary assembly collapsed a falsy authoritative value');
  });
  it('resolution rides the SAME evaluation as the bars — exactly one evaluate, first snapshot wins (r1 Luna F2)', async () => {
    // A second evaluate for the resolution could race a timeframe switch
    // between the two reads — the exact hazard the owner's D2 amendment
    // names. The stub answers '1' only on the first call: a two-evaluate
    // mutant reads '5' and/or bumps the count.
    let calls = 0;
    const evaluate = async () => {
      calls += 1;
      return { bars: [vbar(1, 10, 1)], total_bars: 1, truncated: false, source: 'direct_bars', resolution: calls === 1 ? '1' : '5' };
    };
    const r = await getOhlcv({ summary: false, includeResolution: true, _deps: { evaluate } });
    assert.equal(calls, 1, 'the bars evaluation is the ONLY evaluation');
    assert.equal(r.resolution, '1');
  });
  it('the envelope transports the authoritative value VERBATIM — numeric 1 is not laundered into "1" (r1 Luna F1)', async () => {
    const raw = await getOhlcv({ summary: false, includeResolution: true, _deps: { evaluate: page(1) } });
    assert.equal(raw.resolution, 1);
    assert.notEqual(raw.resolution, '1');
  });
  // Executes the REAL page snippet data.js sends. An evaluate stub that
  // ignores its `code` argument cannot see a coercion INSIDE the snippet —
  // that blind spot is exactly how a String() shim there survived the
  // object-stub tests (r1 Luna F1 lesson) — so these fixtures run the
  // snippet against a fake `window` shaped like the known paths.
  const THROWING_RESOLUTION = Symbol('resolution() throws');
  function snippetPage(resolutionValue, rows = [[1, 10, 10, 10, 10, 5]]) {
    // rows are raw page tuples [time, o, h, l, c, volume] — the shape
    // the snippet's mk() consumes.
    const fakeBars = {
      firstIndex: () => 0,
      lastIndex: () => rows.length - 1,
      size: () => rows.length,
      valueAt: (i) => rows[i],
    };
    const chart = {
      resolution: () => {
        if (resolutionValue === THROWING_RESOLUTION) throw new Error('detached chart');
        return resolutionValue;
      },
      _chartWidget: { model: () => ({ mainSeries: () => ({ bars: () => fakeBars }) }) },
    };
    const fakeWindow = { TradingViewApi: { _activeChartWidgetWV: { value: () => chart } } };
    // Parenthesized: the snippet begins with a newline, and a bare
    // `return ${code}` would ASI into `return;`.
    return async (code) => new Function('window', `return (${code});`)(fakeWindow);
  }
  it('the PAGE SNIPPET does not launder numeric 1 into "1" — real-snippet execution, refused end-to-end (r1 Luna F1)', async () => {
    // D2: exact string "1" only — numeric 1 is a banned alias unless
    // production characterization proves it.
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage(1) } });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } }),
      { message: /exactly "1", got: 1\. Set/ },
    );
  });
  it('real-snippet execution with the authoritative string "1" computes through data → core', async () => {
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage('1') } });
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } });
    assert.equal(r.success, true);
    assert.deepEqual(r.series.value, [10]);
    assert.equal(r.metadata.zero_volume_nulls_total, 0);
  });
  it('the snippet transports WHITESPACE strings verbatim — " 1 " reaches the gate untrimmed and is refused (r3 Sol F7)', async () => {
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage(' 1 ') } });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } }),
      { message: /exactly "1", got: " 1 "/ },
    );
  });
  it('the snippet transports alias STRINGS verbatim — "1m" reaches the gate as "1m" and is refused (r2 Sol F6)', async () => {
    // An in-snippet normalization ("1m" → "1") would be invisible to the
    // object-stub alias tests; the real-snippet fixture pins verbatim
    // transport so the gate is the ONLY comparator.
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage('1m') } });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } }),
      { message: /exactly "1", got: "1m"/ },
    );
  });
  it('a resolution() that RETURNS undefined stays unestablished at the snippet — no fail-open default (r2 Sol F7)', async () => {
    // Distinct from the THROWING getter below: a successful call returning
    // undefined must also end as null; a mutant defaulting it to "1" would
    // compute here.
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage(undefined) } });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } }),
      { message: /exactly "1", got: null/ },
    );
  });
  it('a non-string/non-number resolution is FILTERED to null by the snippet — boolean true refused as unestablished (r2 Luna F3)', async () => {
    // The envelope's documented type filter (string | number verbatim,
    // else null) is discriminated here: a widened filter would transport
    // `true` and the refusal would name `true` instead of null.
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage(true) } });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } }),
      { message: /exactly "1", got: null/ },
    );
  });
  it('the snippet\'s VOLUME COLUMN weights end-to-end — a multi-bar real-snippet run discriminates v[5] (r4 Sol F7)', async () => {
    // Rows 10@1 and 20@3 → (10 + 60) / 4 = 17.5; a v[4]-as-volume mutant
    // (close column) yields (10·10 + 20·20) / 30 instead.
    const rows = [[1, 10, 10, 10, 10, 1], [2, 20, 20, 20, 20, 3]];
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage('1', rows) } });
    const r = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } });
    assert.deepEqual(r.series.value, [10, 17.5]);
  });
  it('the same-snapshot resolution rides the HISTORICAL mode too — a windowed real-snippet run computes (r4 Sol F8)', async () => {
    // The windowed branch of the snippet must return the same
    // resolution; a windowed→null mutant turns this into a got: null
    // refusal.
    const rows = [[1, 10, 10, 10, 10, 1], [2, 20, 20, 20, 20, 3]];
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage('1', rows) } });
    const r = await getIndicator({ indicator: 'vwap', from: 0, to: 3, _deps: { getOhlcv: chained } });
    assert.equal(r.source.mode, 'window');
    assert.deepEqual(r.series.value, [10, 17.5]);
  });
  it('a THROWING chart.resolution() fails CLOSED at the snippet layer — refused as null, never fail-open (r1 Sol F3)', async () => {
    // The snippet's try/catch must leave resolution null when the page API
    // throws; a fail-open default (e.g. initializing to "1") would compute
    // here. Bars are otherwise fully valid.
    const chained = (args) => getOhlcv({ ...args, _deps: { evaluate: snippetPage(THROWING_RESOLUTION) } });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', _deps: { getOhlcv: chained } }),
      { message: /exactly "1", got: null/ },
    );
  });
});

// ── D1 isolation invariant: vwap is an ADJACENT pure kernel ─────────────────

describe('vwap module invariants', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it('src/analytics/vwap.js imports NOTHING and owns no capability — adjacent to A1, never an amendment of it', () => {
    const src = readFileSync(join(here, '../src/analytics/vwap.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    // Zero imports means NO import syntax of any form — a bare side-effect
    // `import 'node:fs'` has no `from` clause, so scan for the keyword
    // itself, not just the from-form (r2 Luna F4).
    assert.ok(!/\bimport\b/.test(code), 'the vwap kernel is standalone — zero imports of ANY form');
    for (const banned of ['require(', 'connection', 'evaluate', 'fetch', 'XMLHttpRequest', 'WebSocket', 'CDP', 'process.', 'Date.now', 'Math.random', 'node:']) {
      assert.ok(!code.includes(banned), `vwap kernel must not reference ${banned}`);
    }
  });
});
