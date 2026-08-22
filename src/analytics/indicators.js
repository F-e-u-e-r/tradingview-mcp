/**
 * Pure indicator kernel (A1) — internal analytics layer, zero capability.
 *
 * INVARIANTS (adjudicated 2026-08-22): no MCP registration, no CDP, no
 * network, no filesystem, no process/env access, no mutable module state,
 * no donor runtime dependency, no new npm dependency; deterministic
 * inputs → outputs. The only intended production input source is the
 * existing validated OHLCV boundary (src/core/data.js bar records →
 * column arrays); this module never fetches anything itself.
 *
 * ADAPT-ported from the MIT-licensed donor:
 *   atilaahmettaner/tradingview-mcp @ d77db101edc1b57b260450ddda5ca4f7f0211ecd
 *   src/tradingview_mcp/core/services/indicators_calc.py
 *   Copyright (c) 2025 Ahmet Taner Atila — MIT.
 * See THIRD_PARTY_NOTICES.md for the license text, per-function provenance,
 * and the approved adaptation deltas.
 *
 * Semantics are pinned to the donor exactly as characterized in Phase 0:
 * warm-up prefixes are null; EMA is SMA-seeded with k = 2/(period+1); RSI and
 * ATR use Wilder's smoothing (RSI of an all-flat/all-gain window is 100 by the
 * donor's zero-loss branch); the Donchian window INCLUDES the current bar —
 * deliberately preserved: whether a STRATEGY may consult the bar-inclusive
 * channel is A1b's execution contract, not the indicator's definition.
 *
 * Approved behavioral delta (the only one): `period` must be a positive
 * integer — invalid periods fail closed with a typed error instead of the
 * donor's accidental ZeroDivisionError / negative-index behavior. Mismatched
 * column lengths likewise refuse loudly: the donor raised an uncaught
 * IndexError there, and JS out-of-range reads would otherwise turn that
 * refusal into silent NaN propagation — a semantic change, not a port.
 */

function requirePositiveIntegerPeriod(period, name) {
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new Error(`${name}: period must be a positive integer, got: ${period}`);
  }
}

function requireEqualLengths(name, columns) {
  const n = columns[0].length;
  for (const col of columns) {
    if (col.length !== n) {
      throw new Error(`${name}: input columns must have equal lengths`);
    }
  }
}

/** Simple Moving Average. First (period-1) values are null. */
export function sma(closes, period) {
  requirePositiveIntegerPeriod(period, 'sma');
  const result = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result[i] = sum / period;
  }
  return result;
}

/** Exponential Moving Average, SMA-seeded. First (period-1) values are null. */
export function ema(closes, period) {
  requirePositiveIntegerPeriod(period, 'ema');
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let j = 0; j < period; j++) seed += closes[j];
  seed /= period;
  result[period - 1] = seed;
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Relative Strength Index (Wilder's smoothing). First (period) values are
 * null. A window with zero average loss reads 100 (donor semantics — a flat
 * series is "all gain" under this branch, pinned as characterized).
 */
export function rsi(closes, period = 14) {
  requirePositiveIntegerPeriod(period, 'rsi');
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    gainSum += Math.max(diff, 0);
    lossSum += Math.max(-diff, 0);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100.0 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = avgLoss === 0 ? 100.0 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/**
 * Average True Range (Wilder's smoothing over TR = max(H-L, |H-prevC|,
 * |L-prevC|)). First (period) values are null.
 */
export function atr(highs, lows, closes, period = 14) {
  requirePositiveIntegerPeriod(period, 'atr');
  requireEqualLengths('atr', [highs, lows, closes]);
  const n = closes.length;
  const result = new Array(n).fill(null);
  if (n < period + 1) return result;

  const trs = [];
  for (let i = 1; i < n; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }

  let value = 0;
  for (let j = 0; j < period; j++) value += trs[j];
  value /= period;
  result[period] = value;
  for (let i = period + 1; i < n; i++) {
    value = (value * (period - 1) + trs[i - 1]) / period;
    result[i] = value;
  }
  return result;
}

/**
 * Donchian Channel: highest high / lowest low over the window INCLUDING the
 * current bar (donor semantics, deliberately preserved — see header), plus
 * middle = (upper + lower) / 2. First (period-1) values are null.
 */
export function donchian(highs, lows, period = 20) {
  requirePositiveIntegerPeriod(period, 'donchian');
  requireEqualLengths('donchian', [highs, lows]);
  const n = highs.length;
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const middle = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let u = -Infinity;
    let l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > u) u = highs[j];
      if (lows[j] < l) l = lows[j];
    }
    upper[i] = u;
    lower[i] = l;
    middle[i] = (u + l) / 2;
  }
  return { upper, lower, middle };
}
