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
 */
import { getOhlcv as _getOhlcv } from './data.js';
import { sma, ema, rsi, atr, donchian } from '../analytics/indicators.js';

function _resolve(deps) {
  return { getOhlcv: deps?.getOhlcv || _getOhlcv };
}

export async function getIndicator({ indicator, period, count, from, to, last, _deps } = {}) {
  const { getOhlcv } = _resolve(_deps);

  // Presence semantics: only undefined means omitted (issue-#3 ruling). The
  // served schema already refuses malformed `last`; this core belt keeps a
  // direct caller's null/"5"/0 from silently truncating to nothing.
  if (last !== undefined && (typeof last !== 'number' || !Number.isInteger(last) || last < 1)) {
    throw new Error(`last must be a positive integer when provided, got: ${JSON.stringify(last)}`);
  }

  const ohlcv = await getOhlcv({ summary: false, count, from, to });

  const bars = ohlcv.bars;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const times = bars.map((b) => b.time);

  let series;
  if (indicator === 'sma') series = { value: sma(closes, period) };
  else if (indicator === 'ema') series = { value: ema(closes, period) };
  else if (indicator === 'rsi') series = { value: rsi(closes, period) };
  else if (indicator === 'atr') series = { value: atr(highs, lows, closes, period) };
  else if (indicator === 'donchian') {
    const d = donchian(highs, lows, period);
    series = { upper: d.upper, middle: d.middle, lower: d.lower };
  } else {
    // unreachable through the served enum; refuse rather than guess for a
    // direct caller
    throw new Error(`unknown indicator: ${JSON.stringify(indicator)}`);
  }

  const total = bars.length;
  const reference = series.value ?? series.upper;
  let warmupNullsTotal = 0;
  for (const v of reference) if (v === null) warmupNullsTotal += 1;

  // Tail-slice OUTPUT only, after the full-window computation above.
  const returned = last === undefined ? total : Math.min(last, total);
  const start = total - returned;
  const slice = (arr) => (start === 0 ? arr : arr.slice(start));
  const outSeries = {};
  for (const [key, arr] of Object.entries(series)) outSeries[key] = slice(arr);

  const result = {
    success: true,
    indicator,
    period,
    source: {
      mode: ohlcv.mode,
      bar_count: total,
      total_available: ohlcv.total_available,
      ...(ohlcv.requested_window ? { requested_window: ohlcv.requested_window } : {}),
      // window truncation reported by the DATA layer (left-edge keep), passed
      // through with its own note — distinct from metadata.truncated below,
      // which is the A2 `last` tail.
      ...(ohlcv.truncated ? { truncated: true, note: ohlcv.note } : {}),
      ...(total > 0 ? { from: times[0], to: times[total - 1] } : {}),
    },
    metadata: {
      total,
      returned,
      truncated: returned < total,
      warmup_nulls_total: warmupNullsTotal,
    },
    times: slice(times),
    series: outSeries,
  };
  if (total > 0 && warmupNullsTotal === total) {
    result.note = `Insufficient history for period ${period}: all ${total} value(s) are warm-up nulls (documented kernel semantics, not an error). Fetch more bars or use a smaller period.`;
  }
  return result;
}
