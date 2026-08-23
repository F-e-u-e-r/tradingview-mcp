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
 */
import { getOhlcv as _getOhlcv } from './data.js';
import { sma, ema, rsi, atr, donchian } from '../analytics/indicators.js';
import { vwap } from '../analytics/vwap.js';

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
  }

  const bars = ohlcv.bars;
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
    series = { value: vwap(highs, lows, closes, volumes) };
  } else {
    // unreachable through the served enum; refuse rather than guess for a
    // direct caller
    throw new Error(`unknown indicator: ${JSON.stringify(indicator)}`);
  }

  const total = bars.length;
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
    // vwap OMITS period (D4): never null, never a fabricated 0 — the field
    // pattern follows requested_window's conditional-presence precedent.
    ...(period !== undefined ? { period } : {}),
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
      warmup_nulls_total: isVwap ? 0 : nullsTotal,
      // vwap-only (D4): its nulls are "cumulative volume still zero", not
      // warm-up. The field appears on NO other indicator's response.
      ...(isVwap ? { zero_volume_nulls_total: nullsTotal } : {}),
    },
    times: slice(times),
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
