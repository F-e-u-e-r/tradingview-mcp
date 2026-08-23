/**
 * Issue #16 B+ amendment suite — deterministic 1m → 5m derivation.
 *
 * Owner amendment (2026-08-23, recorded verbatim on issue #16), with the
 * owner's precision: "B+ derives 1-minute analytics from the canonical
 * validated 1-minute snapshot and derives 5-minute analytics only from
 * completed five-minute buckets. It does not independently assert
 * completion of the terminal one-minute source bar." Five-minute OHLC
 * bars aggregate deterministically from timestamp-aligned completed
 * 1-minute bars; five-minute VWAP derives from the canonical 1-minute
 * price-volume contributions, NEVER recomputed from aggregated 5-minute
 * OHLC; incomplete terminal buckets are not completed bars; retrieval
 * caps unchanged. No 1-minute completion heuristic exists — by ruling.
 *
 * Operative readings pinned here (documented in the amendment comment):
 *   - buckets are floor(time/300)×300; a present bucket is COMPLETED iff a
 *     later bucket has begun in the snapshot — every present bucket except
 *     the last (the terminal bucket can never prove its own completion);
 *   - the LEADING bucket is completed only when the window starts exactly
 *     on its boundary (a mid-bucket cut would fabricate a wrong 5m open);
 *   - boundary state is OBSERVABLE under NEUTRAL names (owner R3):
 *     partial_leading_1m_bars / incomplete_terminal_1m_bars count
 *     input-boundary bars, not participation — neither set enters derived
 *     5m bars, but partial leading bars DO stay in the 5m VWAP fold;
 *   - `timeframe` on data_compute_indicator is a CLAIM: omitted = today's
 *     behavior byte-for-byte; present ('1' | '5') = the 1-minute canonical
 *     gate is enforced; '5' derives the completed-bucket series;
 *   - 5m VWAP is a bucket-end SAMPLING of the canonical 1m cumulative
 *     stream — equal by construction to the 1m VWAP at each completed
 *     bucket's last 1m bar, so the window-relative anchor and the three
 *     admitted kernel guards are inherited, not reimplemented.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partitionFiveMinuteBuckets, aggregateFiveMinute } from '../src/analytics/timeframe.js';
import { vwap } from '../src/analytics/vwap.js';
import { getIndicator } from '../src/core/analytics.js';

function mbar(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume };
}
// A bar whose hlc3 is exactly x (high = low = close = x).
function vbar(time, x, volume) {
  return { time, open: x, high: x, low: x, close: x, volume };
}

describe('partitionFiveMinuteBuckets — data-evidence completedness', () => {
  it('every present bucket except the terminal one is completed; the terminal bars are counted, observably', () => {
    const times = [300, 360, 420, 480, 540, 600, 660, 900];
    const p = partitionFiveMinuteBuckets(times);
    assert.deepEqual(p.buckets, [
      { start: 300, startIndex: 0, endIndex: 4 },
      { start: 600, startIndex: 5, endIndex: 6 },
    ]);
    assert.equal(p.partialLeading, 0);
    assert.equal(p.incompleteTerminal, 1, 'the bar at 900 sits in a bucket that cannot prove completion');
  });
  it('a window cut MID-bucket excludes the leading bucket — its 5m open/high/low would be fabricated', () => {
    const times = [360, 420, 600, 660, 900];
    const p = partitionFiveMinuteBuckets(times);
    assert.deepEqual(p.buckets, [{ start: 600, startIndex: 2, endIndex: 3 }]);
    assert.equal(p.partialLeading, 2);
    assert.equal(p.incompleteTerminal, 1);
  });
  it('a single present bucket is terminal — never completed, never double-counted as leading', () => {
    const p = partitionFiveMinuteBuckets([0, 60]);
    assert.deepEqual(p.buckets, []);
    assert.equal(p.partialLeading, 0);
    assert.equal(p.incompleteTerminal, 2);
  });
  it('an empty window partitions to nothing', () => {
    assert.deepEqual(partitionFiveMinuteBuckets([]), { buckets: [], partialLeading: 0, incompleteTerminal: 0 });
  });
  it('gaps INSIDE a bucket are market reality, not a cut — the bucket still completes', () => {
    // bucket 300 holds only 300 and 540 (no trades between): completed
    // once bucket 600 begins.
    const p = partitionFiveMinuteBuckets([300, 540, 600, 660]);
    assert.deepEqual(p.buckets, [{ start: 300, startIndex: 0, endIndex: 1 }]);
  });
  it('a bar exactly ON a boundary opens the NEXT bucket (half-open [start, start+300))', () => {
    const p = partitionFiveMinuteBuckets([0, 60, 300]);
    assert.deepEqual(p.buckets, [{ start: 0, startIndex: 0, endIndex: 1 }]);
    assert.equal(p.incompleteTerminal, 1);
  });
  it('non-increasing or malformed times refuse loudly', () => {
    for (const bad of [[300, 300], [300, 240], [300, Number.NaN], [300, '360']]) {
      assert.throws(() => partitionFiveMinuteBuckets(bad), { message: /strictly increasing finite/ }, JSON.stringify(bad));
    }
  });
});

describe('aggregateFiveMinute — deterministic OHLCV roll-up of completed buckets', () => {
  it('open=first, high=max, low=min, close=last, volume=Σ, time=bucket start', () => {
    const bars = [
      mbar(300, 10, 12, 9, 11, 1),
      mbar(360, 11, 14, 10, 13, 2),
      mbar(420, 13, 13, 8, 9, 1),
      mbar(480, 9, 10, 9, 10, 4),
      mbar(540, 10, 16, 10, 15, 2),
      mbar(600, 15, 25, 15, 25, 3),
      mbar(660, 25, 25, 25, 25, 1),
      mbar(900, 7, 7, 7, 7, 1), // terminal bucket — excluded
    ];
    const a = aggregateFiveMinute(bars);
    assert.deepEqual(a.bars, [
      { time: 300, open: 10, high: 16, low: 8, close: 15, volume: 10 },
      { time: 600, open: 15, high: 25, low: 15, close: 25, volume: 4 },
    ]);
    assert.equal(a.partialLeading, 0);
    assert.equal(a.incompleteTerminal, 1);
  });
  it('does not mutate its input', () => {
    const bars = [mbar(300, 1, 2, 0, 1, 1), mbar(600, 1, 2, 0, 1, 1)];
    const snapshot = JSON.parse(JSON.stringify(bars));
    aggregateFiveMinute(bars);
    assert.deepEqual(bars, snapshot);
  });
});

// ── core orchestration: timeframe as an enforced claim ──────────────────────

function stubOhlcv(bars, extra = {}) {
  const calls = [];
  const getOhlcv = async (args) => { calls.push(args); return { success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, ...extra }; };
  return { calls, getOhlcv };
}
const oneMinute = { resolution: '1' };

describe('core — timeframe "5": derived completed-bucket analytics', () => {
  // Two completed buckets + a terminal bar. hlc3s: bucket 0 → {4, 10},
  // bucket 300 → {40}; volumes {1, 1, 2}; terminal bar at 600.
  const invariantBars = [vbar(0, 4, 1), vbar(60, 10, 1), vbar(300, 40, 2), vbar(600, 999, 5)];

  it('vwap@5m samples the canonical 1m cumulative stream at completed bucket ends — NEVER recomputed from 5m OHLC (owner invariant, required RED)', async () => {
    const { getOhlcv } = stubOhlcv(invariantBars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } });
    // canonical stream: 4/1, (4+10)/2 = 7, (14+80)/4 = 23.5 — sampled at
    // bucket ends: [7, 23.5].
    assert.deepEqual(r.times, [0, 300]);
    assert.deepEqual(r.series.value, [7, 23.5]);
    // The owner's mutant — aggregate to 5m OHLC first, then hlc3×volume —
    // is numerically DIFFERENT on this fixture, so it cannot pass:
    // bucket 0 as a 5m bar is O4 H10 L4 C10 → hlc3 8, volume 2 → 8 ≠ 7,
    // and cumulatively (16+80)/4 = 24 ≠ 23.5.
    const naive = [(8 * 2) / 2, (8 * 2 + 40 * 2) / 4];
    assert.notDeepEqual(r.series.value, naive, 'the 5m-OHLC recompute must be discriminated, not merely disallowed on paper');
    // Identity with the 1m stream (equal BY CONSTRUCTION): the sampled
    // values are the 1m VWAP at each completed bucket's last 1m bar.
    const oneMinuteSeries = vwap(
      invariantBars.map((b) => b.high), invariantBars.map((b) => b.low),
      invariantBars.map((b) => b.close), invariantBars.map((b) => b.volume),
    );
    assert.equal(r.series.value[0], oneMinuteSeries[1]);
    assert.equal(r.series.value[1], oneMinuteSeries[2]);
  });
  it('vwap@5m: metadata is the 5m truth — bucket count, observable exclusions, vwap-only null count', async () => {
    const { getOhlcv } = stubOhlcv(invariantBars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } });
    assert.equal(r.timeframe, '5');
    assert.equal(r.metadata.total, 2);
    assert.equal(r.metadata.returned, 2);
    assert.equal(r.metadata.partial_leading_1m_bars, 0);
    assert.equal(r.metadata.incomplete_terminal_1m_bars, 1);
    assert.equal(r.metadata.warmup_nulls_total, 0);
    assert.equal(r.metadata.zero_volume_nulls_total, 0);
    assert.equal('period' in r, false);
  });
  it('vwap@5m: a zero-volume leading bucket samples null — the prefix invariant survives sampling', async () => {
    const bars = [vbar(0, 10, 0), vbar(60, 20, 0), vbar(300, 40, 4), vbar(600, 1, 1)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [null, 40]);
    assert.equal(r.metadata.zero_volume_nulls_total, 1);
    assert.equal(r.metadata.warmup_nulls_total, 0);
  });
  it('vwap@5m: terminal-bucket bars are OUTSIDE the fold — their data cannot poison a sampled value', async () => {
    // The terminal bar carries a negative volume; it is excluded, so the
    // derived series must compute rather than refuse.
    const bars = [vbar(0, 4, 1), vbar(60, 10, 1), vbar(300, 40, 2), vbar(600, 5, -1)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, [7, 23.5]);
  });
  it('non-vwap@5m: derived completed 5m bars feed the UNCHANGED A1 kernel', async () => {
    // closes of the two completed buckets: 15, 25 → sma(2) = [null, 20].
    const bars = [
      mbar(300, 10, 12, 9, 11, 1), mbar(360, 11, 14, 10, 13, 2), mbar(420, 13, 13, 8, 9, 1),
      mbar(480, 9, 10, 9, 10, 4), mbar(540, 10, 16, 10, 15, 2),
      mbar(600, 15, 25, 15, 25, 3), mbar(660, 25, 25, 25, 25, 1),
      mbar(900, 7, 7, 7, 7, 1),
    ];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'sma', period: 2, timeframe: '5', _deps: { getOhlcv } });
    assert.deepEqual(r.times, [300, 600]);
    assert.deepEqual(r.series.value, [null, 20]);
    assert.equal(r.timeframe, '5');
    assert.equal(r.period, 2, 'period counts FIVE-MINUTE bars');
    assert.equal(r.metadata.warmup_nulls_total, 1);
    assert.equal(r.metadata.incomplete_terminal_1m_bars, 1);
    assert.equal('zero_volume_nulls_total' in r.metadata, false);
  });
  it('donchian@5m keeps its three-channel shape over derived bars', async () => {
    const bars = [
      mbar(300, 10, 12, 8, 11, 1), mbar(360, 11, 14, 10, 13, 2),
      mbar(600, 15, 25, 15, 25, 3),
      mbar(900, 7, 7, 7, 7, 1),
    ];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'donchian', period: 1, timeframe: '5', _deps: { getOhlcv } });
    assert.deepEqual(Object.keys(r.series).sort(), ['lower', 'middle', 'upper']);
    // p=1 windows are the bars themselves: highs [14, 25], lows [8, 15].
    assert.deepEqual(r.series.upper, [14, 25]);
    assert.deepEqual(r.series.lower, [8, 15]);
  });
  it('last=N tail-slices the DERIVED series after full computation — the anchor stays the window start', async () => {
    const { getOhlcv } = stubOhlcv(invariantBars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', last: 1, _deps: { getOhlcv } });
    assert.deepEqual(r.times, [300]);
    assert.deepEqual(r.series.value, [23.5], '23.5 is window-anchored; a tail-anchored recomputation would return 40');
    assert.deepEqual({ total: r.metadata.total, returned: r.metadata.returned, truncated: r.metadata.truncated }, { total: 2, returned: 1, truncated: true });
  });
  it('partial leading 1m bars stay in the 5m VWAP fold — the neutral name is earned, not cosmetic (owner R3)', async () => {
    // Window cut mid-bucket: bucket 300 is partial (bars at 360, 420) and
    // produces NO derived 5m bar, but its bars still seed the canonical
    // window-start anchor. Stream: 6/1, 24/2, 84/4, 124/8 = 15.5 —
    // sampled at completed bucket 600's end. A fold that dropped the
    // partial bars would answer (60+40)/6 instead.
    const bars = [vbar(360, 6, 1), vbar(420, 18, 1), vbar(600, 30, 2), vbar(660, 10, 4), vbar(900, 999, 7)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } });
    assert.deepEqual(r.times, [600]);
    assert.deepEqual(r.series.value, [15.5]);
    assert.equal(r.metadata.partial_leading_1m_bars, 2);
    assert.equal(r.metadata.incomplete_terminal_1m_bars, 1);
  });
  it('vwap + timeframe "1": legacy 1m values, enforced claim, echo — and no derivation fields (owner pre-review fixture)', async () => {
    const bars = [vbar(1, 10, 1), vbar(2, 20, 1), vbar(3, 40, 2)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const claimed = await getIndicator({ indicator: 'vwap', timeframe: '1', _deps: { getOhlcv } });
    const legacy = await getIndicator({ indicator: 'vwap', _deps: { getOhlcv } });
    assert.deepEqual(claimed.series.value, legacy.series.value);
    assert.deepEqual(claimed.series.value, [10, 15, 27.5]);
    assert.deepEqual(claimed.times, legacy.times);
    assert.equal(claimed.timeframe, '1');
    assert.equal('period' in claimed, false);
    assert.equal(claimed.metadata.warmup_nulls_total, 0);
    assert.equal(claimed.metadata.zero_volume_nulls_total, 0);
    assert.equal('partial_leading_1m_bars' in claimed.metadata, false, '"1" derives nothing — no boundary fields');
    // The claim stays enforced on this combination too: an unestablished
    // resolution refuses with vwap's own unchanged message.
    const { getOhlcv: ungated } = stubOhlcv(bars); // no resolution field
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', timeframe: '1', _deps: { getOhlcv: ungated } }),
      { message: /vwap requires the chart at 1-minute resolution/ },
    );
  });
  it('zero completed buckets is a well-formed empty derivation, not an error', async () => {
    const bars = [vbar(0, 10, 1), vbar(60, 20, 1)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const r = await getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } });
    assert.deepEqual(r.series.value, []);
    assert.deepEqual(r.times, []);
    assert.equal(r.metadata.total, 0);
    assert.equal(r.metadata.incomplete_terminal_1m_bars, 2);
  });
});

describe('core — the timeframe CLAIM is enforced; omission stays legacy', () => {
  it('timeframe present requires the canonical 1-minute chart — for NON-vwap indicators too', async () => {
    const bars = [mbar(300, 10, 12, 9, 11, 1)];
    for (const timeframe of ['1', '5']) {
      const { calls, getOhlcv } = stubOhlcv(bars, { resolution: '60' });
      await assert.rejects(
        () => getIndicator({ indicator: 'sma', period: 2, timeframe, _deps: { getOhlcv } }),
        (err) => {
          assert.match(err.message, /exactly "1", got: "60"/);
          assert.match(err.message, /timeframe/, 'the refusal names the timeframe claim');
          return true;
        },
        `timeframe=${timeframe}`,
      );
      assert.equal(calls.length, 1, 'same-snapshot gate — one acquisition, no second evaluate');
    }
  });
  it('an unestablished resolution fails CLOSED for a timeframe claim', async () => {
    const { getOhlcv } = stubOhlcv([mbar(300, 10, 12, 9, 11, 1)]); // no resolution field
    await assert.rejects(
      () => getIndicator({ indicator: 'sma', period: 2, timeframe: '5', _deps: { getOhlcv } }),
      { message: /exactly "1", got: null/ },
    );
  });
  it('vwap under a timeframe claim keeps its OWN unchanged refusal (the r-series pinned message)', async () => {
    const { getOhlcv } = stubOhlcv([vbar(0, 10, 1)], { resolution: '60' });
    await assert.rejects(
      () => getIndicator({ indicator: 'vwap', timeframe: '5', _deps: { getOhlcv } }),
      { message: /vwap requires the chart at 1-minute resolution/ },
    );
  });
  it('timeframe OMITTED is byte-for-byte legacy: non-vwap indicators run ungated on the served bars', async () => {
    const { getOhlcv } = stubOhlcv([mbar(1, 10, 11, 9, 10, 1), mbar(2, 11, 12, 10, 11, 1)]); // NO resolution
    const r = await getIndicator({ indicator: 'sma', period: 1, _deps: { getOhlcv } });
    assert.equal(r.success, true);
    assert.equal('timeframe' in r, false, 'no claim, no echo');
    assert.equal('incomplete_terminal_1m_bars' in r.metadata, false);
  });
  it('timeframe "1" computes the same values as omitted — plus the enforced claim and the echo', async () => {
    const bars = [mbar(1, 10, 11, 9, 10, 1), mbar(2, 11, 12, 10, 11, 1), mbar(3, 12, 13, 11, 12, 1)];
    const { getOhlcv } = stubOhlcv(bars, oneMinute);
    const legacy = await getIndicator({ indicator: 'sma', period: 2, _deps: { getOhlcv } });
    const claimed = await getIndicator({ indicator: 'sma', period: 2, timeframe: '1', _deps: { getOhlcv } });
    assert.deepEqual(claimed.series, legacy.series);
    assert.deepEqual(claimed.times, legacy.times);
    assert.equal(claimed.timeframe, '1');
    assert.equal('incomplete_terminal_1m_bars' in claimed.metadata, false, '"1" derives nothing — no exclusion fields');
  });
  it('a direct-core timeframe outside the enum refuses loudly (the served schema is the first belt)', async () => {
    const { getOhlcv } = stubOhlcv([vbar(0, 10, 1)], oneMinute);
    for (const bad of ['15', 5, '05', 'five', null]) {
      await assert.rejects(
        () => getIndicator({ indicator: 'sma', period: 1, timeframe: bad, _deps: { getOhlcv } }),
        { message: /timeframe must be "1" or "5" when provided/ },
        `timeframe=${JSON.stringify(bad)}`,
      );
    }
  });
});

// ── module invariants (D1 lineage: adjacent pure kernels) ───────────────────

describe('timeframe module invariants', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it('src/analytics/timeframe.js imports NOTHING and owns no capability', () => {
    const src = readFileSync(join(here, '../src/analytics/timeframe.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\bimport\b/.test(code), 'zero imports of ANY form');
    for (const banned of ['require(', 'connection', 'evaluate', 'fetch', 'XMLHttpRequest', 'WebSocket', 'CDP', 'process.', 'Date.now', 'Math.random', 'node:']) {
      assert.ok(!code.includes(banned), `timeframe kernel must not reference ${banned}`);
    }
  });
});
