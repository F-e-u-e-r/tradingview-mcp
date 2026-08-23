/**
 * Five-minute derivation kernel (issue #16, B+ owner amendment 2026-08-23).
 *
 * ADJACENT pure kernel in the D1 lineage: zero imports, zero capability —
 * no MCP registration, no CDP, no network, no filesystem, no process/env,
 * no mutable module state, no clock, no randomness; deterministic
 * inputs → outputs; inputs are never mutated. Owner-specified semantics
 * (the amendment recorded verbatim on issue #16) — NOT donor-ported.
 *
 * SEMANTICS: 1-minute bars partition into timestamp-aligned five-minute
 * buckets, `floor(time / 300) × 300` — Unix-aligned, timezone-independent
 * (every real UTC offset is a multiple of 900s), calendar-free. Bucket
 * membership is half-open: [start, start + 300).
 *
 * COMPLETEDNESS is established from DATA, never a clock (the BT0 §4.7
 * epistemic lineage): a present bucket is completed iff a LATER bucket has
 * begun in the snapshot — every present bucket except the last. The
 * terminal bucket can never prove its own completion and is always
 * excluded ("incomplete terminal 5-minute buckets are not treated as
 * completed bars" — owner). The LEADING bucket is completed only when the
 * window starts exactly on its boundary (first time === bucket start):
 * a mid-bucket window cut is indistinguishable from data alone from a
 * no-trade gap at the bucket's open, and aggregating it would fabricate a
 * silently wrong 5m open/high/low. Exclusions are OBSERVABLE — both
 * counts are returned and the orchestration reports them.
 *
 * Gaps INSIDE a bucket are market reality (no trades that minute), not a
 * cut: the bucket still aggregates from the bars that exist.
 *
 * Aggregation is the standard deterministic roll-up per completed bucket,
 * in time order: open = first bar's open, high = max of highs, low = min
 * of lows, close = last bar's close, volume = Σ volumes, time = bucket
 * start. Values are RAW doubles in the written order (A2's transparent-
 * transport rule); like the A1 kernels this module adds no numeric guards
 * of its own — the aggregated OHLC feeds only the A1 kernels (which read
 * prices, unguarded by design), and five-minute VWAP NEVER reads these
 * bars at all: it is a bucket-end sampling of the canonical 1-minute
 * contribution stream (owner invariant: derived from the 1m price-volume
 * contributions, never recomputed from aggregated 5m OHLC), so the vwap
 * kernel's admitted guards are inherited there, not duplicated here.
 *
 * DEFERRED by owner ruling: 15m/30m/1h, arbitrary-timeframe
 * generalization, session/calendar engines, anchored VWAP. This module
 * proves exactly 1m → 5m and nothing more.
 */

const BUCKET_SECONDS = 300;

function requireStrictlyIncreasingTimes(name, times) {
  if (!Array.isArray(times)) {
    throw new Error(`${name}: times must be an array of unix-second numbers`);
  }
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (typeof t !== 'number' || !Number.isFinite(t) || (i > 0 && t <= times[i - 1])) {
      throw new Error(`${name}: times must be strictly increasing finite numbers, got: ${t} (index ${i})`);
    }
  }
}

/**
 * Partition strictly-increasing 1m bar times into five-minute buckets and
 * decide completedness from data evidence.
 *
 * Returns { buckets, excludedLeading, excludedTerminal }: `buckets` holds
 * the COMPLETED buckets only, ascending, as
 * { start, startIndex, endIndex } (inclusive index range into `times`);
 * the exclusion counts are 1m bars dropped at each edge (a single present
 * bucket counts as terminal, never double-counted as leading).
 */
export function partitionFiveMinuteBuckets(times) {
  requireStrictlyIncreasingTimes('partitionFiveMinuteBuckets', times);
  const present = [];
  for (let i = 0; i < times.length; i++) {
    const start = Math.floor(times[i] / BUCKET_SECONDS) * BUCKET_SECONDS;
    if (present.length && present[present.length - 1].start === start) {
      present[present.length - 1].endIndex = i;
    } else {
      present.push({ start, startIndex: i, endIndex: i });
    }
  }
  if (present.length === 0) return { buckets: [], excludedLeading: 0, excludedTerminal: 0 };

  const terminal = present[present.length - 1];
  const excludedTerminal = terminal.endIndex - terminal.startIndex + 1;
  let completed = present.slice(0, -1);
  let excludedLeading = 0;
  if (completed.length && times[completed[0].startIndex] !== completed[0].start) {
    // The window opens mid-bucket: its 5m open/high/low cannot be trusted.
    excludedLeading = completed[0].endIndex - completed[0].startIndex + 1;
    completed = completed.slice(1);
  }
  return { buckets: completed, excludedLeading, excludedTerminal };
}

/**
 * Aggregate validated 1m OHLCV bars into completed five-minute bars.
 * Returns { bars, excludedLeading, excludedTerminal } — `bars` are the
 * derived completed 5m bars, shaped exactly like the 1m records the A1
 * column extraction consumes.
 */
export function aggregateFiveMinute(bars) {
  if (!Array.isArray(bars)) {
    throw new Error('aggregateFiveMinute: bars must be an array of OHLCV records');
  }
  const partition = partitionFiveMinuteBuckets(bars.map((b) => b.time));
  const out = [];
  for (const bucket of partition.buckets) {
    let high = bars[bucket.startIndex].high;
    let low = bars[bucket.startIndex].low;
    let volume = 0;
    for (let i = bucket.startIndex; i <= bucket.endIndex; i++) {
      if (bars[i].high > high) high = bars[i].high;
      if (bars[i].low < low) low = bars[i].low;
      volume += bars[i].volume;
    }
    out.push({
      time: bucket.start,
      open: bars[bucket.startIndex].open,
      high,
      low,
      close: bars[bucket.endIndex].close,
      volume,
    });
  }
  return { bars: out, excludedLeading: partition.excludedLeading, excludedTerminal: partition.excludedTerminal };
}
