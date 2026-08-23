/**
 * Core analytics orchestration — A2 (adjudicated 2026-08-22).
 *
 * validated OHLCV → pure A1 kernel → structured result. This module's ONLY
 * acquisition path is core/data.getOhlcv (summary:false); it owns no
 * evaluate/CDP/network capability of its own, so every window semantic of the
 * data layer (two explicit presence-selected modes, no fallback, no widening,
 * refusal by throw) is inherited verbatim rather than re-implemented. A
 * getOhlcv refusal PROPAGATES unchanged — the tool layer's try/catch reports
 * it exactly as data_get_ohlcv would.
 *
 * A2 is a TRANSPARENT TRANSPORT of A1 results: raw doubles, no rounding, no
 * second numerical transform (owner-adjudicated). `last` is OUTPUT-side only:
 * the indicator is always computed over the FULL fetched window first, and a
 * provided `last` merely tail-slices what is returned — it never alters the
 * acquisition window or the latest/window mode, and omitting it means NO
 * A2-layer truncation at all. `warmup_nulls_total` is counted on the full
 * pre-truncation series so a null-free returned tail cannot misread as
 * "this indicator has no warm-up".
 *
 * vwap (issue #16, owner rulings D1–D4 2026-08-23) rides the same
 * orchestration with three per-indicator deltas, all enforced here:
 *   - period policy: vwap takes NO period (supplying one is refused, never
 *     silently ignored); every other indicator requires the positive
 *     integer it always has. Both refusals fire BEFORE acquisition.
 *   - 1-minute canon (D2): vwap requires the AUTHORITATIVE chart
 *     resolution — captured by core/data in the SAME evaluate snapshot as
 *     the bars via the internal includeResolution envelope — to be exactly
 *     "1". No aliases, no bar-spacing inference, fail closed when
 *     unestablished, refused before the kernel runs.
 *   - null metadata (D4): vwap has no warm-up; its nulls mean "cumulative
 *     volume still zero", reported in the vwap-only
 *     zero_volume_nulls_total while warmup_nulls_total stays 0, and the
 *     result omits `period` entirely.
 *
 * The B+ owner amendment (2026-08-23, recorded on issue #16) adds the
 * `timeframe` CLAIM: omitted means exactly the pre-amendment behavior;
 * present ('1' | '5') enforces the canonical 1-minute acquisition (the
 * same authoritative same-snapshot resolution the vwap gate reads) and
 * '5' derives completed five-minute analytics — aggregated bars into the
 * UNCHANGED A1 kernels, and for vwap a bucket-end SAMPLING of the
 * canonical 1-minute contribution stream (never a recompute from 5m
 * OHLC). Boundary state is reported observably under NEUTRAL names
 * (owner R3 amendment): partial_leading_1m_bars /
 * incomplete_terminal_1m_bars describe input-boundary state, not
 * participation — partial leading 1m bars stay in the 5m VWAP fold (the
 * window-start anchor) while never entering derived 5m bars; incomplete
 * terminal bars enter neither.
 *
 * Owner amendment precision (2026-08-23, verbatim): "B+ derives 1-minute
 * analytics from the canonical validated 1-minute snapshot and derives
 * 5-minute analytics only from completed five-minute buckets. It does
 * not independently assert completion of the terminal one-minute source
 * bar." — timeframe '1' is snapshot analytics, deliberately WITHOUT a
 * 1-minute completion heuristic; only the derived '5' path enforces
 * completed-bucket semantics.
 */
import { getOhlcv as _getOhlcv } from './data.js';
import { sma, ema, rsi, atr, donchian } from '../analytics/indicators.js';
import { vwap } from '../analytics/vwap.js';
import { partitionFiveMinuteBuckets, aggregateFiveMinute } from '../analytics/timeframe.js';

function _resolve(deps) {
  return { getOhlcv: deps?.getOhlcv || _getOhlcv };
}

export async function getIndicator({ indicator, period, count, from, to, last, timeframe, _deps } = {}) {
  const { getOhlcv } = _resolve(_deps);

  // Presence semantics: only undefined means omitted (issue-#3 ruling). The
  // served schema already refuses malformed `last`; this core belt keeps a
  // direct caller's null/"5"/0 from silently truncating to nothing.
  if (last !== undefined && (typeof last !== 'number' || !Number.isInteger(last) || last < 1)) {
    throw new Error(`last must be a positive integer when provided, got: ${JSON.stringify(last)}`);
  }

  // B+ belt: the served schema curates the enum; this keeps a direct
  // caller's '15'/5/null from silently selecting a timeframe that does
  // not exist.
  if (timeframe !== undefined && timeframe !== '1' && timeframe !== '5') {
    throw new Error(`timeframe must be "1" or "5" when provided, got: ${JSON.stringify(timeframe)}`);
  }

  // Per-indicator period policy (issue #16), enforced BEFORE acquisition so
  // a refusable call never fetches. The non-vwap message matches the kernel
  // guards byte-for-byte; the kernels keep their own guard as the
  // direct-call belt.
  const isVwap = indicator === 'vwap';
  if (isVwap) {
    if (period !== undefined) {
      throw new Error(`vwap does not take a period — it accumulates from the first bar of the returned window; omit period. got: ${JSON.stringify(period)}`);
    }
  } else if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new Error(`${indicator}: period must be a positive integer, got: ${period}`);
  }

  const ohlcv = await getOhlcv({ summary: false, count, from, to, includeResolution: true });

  // 1-minute canon (owner ruling D2): no timeframe parameter exists on this
  // path — the bars are whatever the chart currently serves — so the gate
  // reads the AUTHORITATIVE chart.resolution() captured in the SAME
  // acquisition snapshot as the bars (never a second evaluate, never
  // inferred from bar spacing) and requires EXACTLY "1". Refused before the
  // kernel: a coarser chart can never produce an OHLC-approximated "VWAP"
  // under this tool's name.
  if (isVwap) {
    const resolution = ohlcv.resolution ?? null;
    if (resolution !== '1') {
      throw new Error(`vwap requires the chart at 1-minute resolution — the authoritative chart resolution must be exactly "1", got: ${JSON.stringify(resolution)}. Set the chart to 1-minute (chart_set_timeframe) and retry.`);
    }
  } else if (timeframe !== undefined) {
    // B+ (owner amendment): a timeframe is a CLAIM on the canonical
    // 1-minute acquisition — enforced against the same authoritative
    // same-snapshot resolution the vwap gate reads, before any kernel.
    const resolution = ohlcv.resolution ?? null;
    if (resolution !== '1') {
      throw new Error(`timeframe "${timeframe}" requires the chart at 1-minute resolution — the canonical acquisition is the validated 1-minute snapshot; the authoritative chart resolution must be exactly "1", got: ${JSON.stringify(resolution)}. Set the chart to 1-minute (chart_set_timeframe) and retry.`);
    }
  }

  const sourceBars = ohlcv.bars;

  // B+ derivation: timeframe "5" works on completed five-minute buckets.
  // The A1 indicators consume the aggregated bars; vwap does NOT — its
  // working set stays the 1-minute bars, and the 5m series is sampled
  // from the canonical stream below (owner invariant: never recomputed
  // from aggregated 5m OHLC).
  let derived = null;
  let bars = sourceBars;
  if (timeframe === '5') {
    if (isVwap) {
      derived = partitionFiveMinuteBuckets(sourceBars.map((b) => b.time));
    } else {
      derived = aggregateFiveMinute(sourceBars);
      bars = derived.bars;
    }
  }

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const times = bars.map((b) => b.time);
  const volumes = bars.map((b) => b.volume);

  let series;
  if (indicator === 'sma') series = { value: sma(closes, period) };
  else if (indicator === 'ema') series = { value: ema(closes, period) };
  else if (indicator === 'rsi') series = { value: rsi(closes, period) };
  else if (indicator === 'atr') series = { value: atr(highs, lows, closes, period) };
  else if (indicator === 'donchian') {
    const d = donchian(highs, lows, period);
    series = { upper: d.upper, middle: d.middle, lower: d.lower };
  } else if (isVwap) {
    if (timeframe === '5') {
      const buckets = derived.buckets;
      if (buckets.length === 0) {
        series = { value: [] };
      } else {
        // Fold the canonical 1m stream only through the last completed
        // bucket: excluded terminal bars can never affect a sampled value,
        // so their data must not be read (it could otherwise refuse a
        // derivation it cannot influence). Leading-cut bars DO stay in the
        // fold — the anchor is the window start, and the 5m series equals
        // the 1m series at every shared timestamp by construction.
        const foldEnd = buckets[buckets.length - 1].endIndex + 1;
        const stream = vwap(highs.slice(0, foldEnd), lows.slice(0, foldEnd), closes.slice(0, foldEnd), volumes.slice(0, foldEnd));
        series = { value: buckets.map((b) => stream[b.endIndex]) };
      }
    } else {
      series = { value: vwap(highs, lows, closes, volumes) };
    }
  } else {
    // unreachable through the served enum; refuse rather than guess for a
    // direct caller
    throw new Error(`unknown indicator: ${JSON.stringify(indicator)}`);
  }

  // Output timebase: the sampled vwap derivation reports bucket starts;
  // every other path's working bars already carry the right times (the
  // aggregated 5m bars are stamped with their bucket start).
  const outTimes = derived && isVwap ? derived.buckets.map((b) => b.start) : times;
  const total = outTimes.length;
  const reference = series.value ?? series.upper;
  // For sma/ema/rsi/atr/donchian these are WARM-UP nulls; for vwap they are
  // zero-volume nulls (D4) — same count, reported under the honest name.
  let nullsTotal = 0;
  for (const v of reference) if (v === null) nullsTotal += 1;

  // Tail-slice OUTPUT only, after the full-window computation above.
  const returned = last === undefined ? total : Math.min(last, total);
  const start = total - returned;
  const slice = (arr) => (start === 0 ? arr : arr.slice(start));
  const outSeries = {};
  for (const [key, arr] of Object.entries(series)) outSeries[key] = slice(arr);

  const result = {
    success: true,
    indicator,
    // The timeframe echo appears only when the claim was made (B+); the
    // legacy no-claim response is byte-for-byte unchanged.
    ...(timeframe !== undefined ? { timeframe } : {}),
    // vwap OMITS period (D4): never null, never a fabricated 0 — the field
    // pattern follows requested_window's conditional-presence precedent.
    ...(period !== undefined ? { period } : {}),
    source: {
      mode: ohlcv.mode,
      // The source block is ACQUISITION truth: the fetched 1m window, even
      // when the reported series is a 5m derivation of it.
      bar_count: sourceBars.length,
      total_available: ohlcv.total_available,
      ...(ohlcv.requested_window ? { requested_window: ohlcv.requested_window } : {}),
      // window truncation reported by the DATA layer (left-edge keep), passed
      // through with its own note — distinct from metadata.truncated below,
      // which is the A2 `last` tail.
      ...(ohlcv.truncated ? { truncated: true, note: ohlcv.note } : {}),
      ...(sourceBars.length > 0 ? { from: sourceBars[0].time, to: sourceBars[sourceBars.length - 1].time } : {}),
    },
    metadata: {
      total,
      returned,
      truncated: returned < total,
      warmup_nulls_total: isVwap ? 0 : nullsTotal,
      // vwap-only (D4): its nulls are "cumulative volume still zero", not
      // warm-up. The field appears on NO other indicator's response.
      ...(isVwap ? { zero_volume_nulls_total: nullsTotal } : {}),
      // B+ observable boundary state ("exclusion MUST be observable" —
      // BT0 §4.7 lineage), NEUTRAL names by owner R3 amendment: these
      // count 1m bars in a partial leading / incomplete terminal bucket,
      // describing the INPUT boundary, not participation — neither set
      // enters derived 5m BARS, but partial leading bars DO stay in the
      // 5m VWAP fold (window-start anchor) while incomplete terminal
      // bars never enter it. Present only in derived mode.
      ...(derived ? { partial_leading_1m_bars: derived.partialLeading, incomplete_terminal_1m_bars: derived.incompleteTerminal } : {}),
    },
    times: slice(outTimes),
    series: outSeries,
  };
  // Warm-up semantics only: vwap cannot reach an all-null result (its
  // kernel refuses a zero-total-volume window loudly), and this note's
  // wording is meaningless without a period.
  if (!isVwap && total > 0 && nullsTotal === total) {
    result.note = `Insufficient history for period ${period}: all ${total} value(s) are warm-up nulls (documented kernel semantics, not an error). Fetch more bars or use a smaller period.`;
  }
  return result;
}
