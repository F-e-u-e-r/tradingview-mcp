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
  it('negative zero volume is a legal zero contribution, not a refusal', () => {
    assert.deepEqual(vwap(...cols([vbar(1, 10, -0), vbar(2, 40, 4)])), [null, 40]);
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
    for (const actual of ['5', '60', '1D', '1m', '01', 1]) {
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
  it('vwap with a period is refused BEFORE acquisition', async () => {
    const calls = [];
    const getOhlcv = async (args) => { calls.push(args); throw new Error('acquisition must not run'); };
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', period: 14, _deps: { getOhlcv } }),
      { message: /vwap does not take a period/ },
    );
    assert.equal(calls.length, 0);
  });
  it('a non-vwap indicator with a missing/invalid period is refused BEFORE acquisition with the kernel\'s exact message', async () => {
    const calls = [];
    const getOhlcv = async (args) => { calls.push(args); throw new Error('acquisition must not run'); };
    await assert.rejects(
      () => getIndicator({ indicator: 'sma', _deps: { getOhlcv } }),
      { message: 'sma: period must be a positive integer, got: undefined' },
    );
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
  it('non-vwap indicators neither require nor read the resolution envelope, and gain no vwap metadata', async () => {
    const bars = [vbar(1, 10, 1), vbar(2, 20, 1), vbar(3, 30, 1)];
    const { getOhlcv } = stubOhlcv(bars); // deliberately NO resolution field
    const r = await getIndicator({ indicator: 'sma', period: 2, _deps: { getOhlcv } });
    assert.equal(r.success, true);
    assert.equal('zero_volume_nulls_total' in r.metadata, false, 'zero_volume_nulls_total appears ONLY on vwap responses');
    assert.equal(r.period, 2, 'non-vwap results keep their period echo');
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
});

// ── D1 isolation invariant: vwap is an ADJACENT pure kernel ─────────────────

describe('vwap module invariants', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it('src/analytics/vwap.js imports NOTHING and owns no capability — adjacent to A1, never an amendment of it', () => {
    const src = readFileSync(join(here, '../src/analytics/vwap.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.deepEqual([...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]), [], 'the vwap kernel is standalone — zero imports');
    for (const banned of ['require(', 'import(', 'connection', 'evaluate', 'fetch', 'XMLHttpRequest', 'WebSocket', 'CDP', 'process.', 'Date.now', 'Math.random']) {
      assert.ok(!code.includes(banned), `vwap kernel must not reference ${banned}`);
    }
  });
});
