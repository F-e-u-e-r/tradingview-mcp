/**
 * BT1 — Donchian breakout backtest: the public compatibility facade.
 *
 * BINDING CONTRACTS: docs/BT0-CONTRACT.md §4 (execution semantics, CLOSED)
 * and docs/BT4-CONTRACT.md §7.2 D8a (this facade). BT4 generalized the
 * execution loop out of this file: the loop now lives in
 * src/analytics/engine.js and the Donchian signal rules in
 * src/analytics/strategies/donchian.js. Per the owner's D8a ruling
 * `donchianBreakoutBacktest(bars, period)` KEEPS its exact signature and
 * behaviour, adapter-backed and observationally identical, so every
 * existing consumer — BT2's accounting suite, BT3's metrics suite, any
 * BT0-era reading of the result model — continues to hold unedited.
 *
 * The shape this file is REQUIRED to have (contract §5.1.1 C):
 *
 *     backtest.js
 *        | compatibility facade only
 *     Donchian adapter
 *        | signal
 *     generic engine
 *
 * and the shape it is FORBIDDEN to have: a Donchian execution path of its
 * own kept alongside the generic one. Two paths would leave the CLOSED
 * kernel in place and make the D5 equivalence proof meaningless, so this
 * file carries no channel arithmetic and no second execution loop — only
 * argument validation under its own name, and delegation.
 *
 * The argument guards stay here, spelled with THIS function's name, because
 * the error text is part of the public surface D8a preserves; the engine
 * and the adapter validate their own inputs under their own names for
 * direct use.
 *
 * INPUT: a completed-bar-qualified record array from the validated OHLCV
 * boundary ({open, high, low, close} read; other record fields ignored).
 * Per the ratified BT0 §4.7 completion policy, every supplied bar is
 * treated as completed — ESTABLISHING completion (and excluding an
 * unverifiable terminal bar, observably) is the integration layer's
 * obligation, deferred to BT5. No completion heuristic is owned here.
 */

import { runStrategyBacktest } from './engine.js';
import { donchianStrategy } from './strategies/donchian.js';

function requirePositiveIntegerPeriod(period, name) {
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new Error(`${name}: period must be a positive integer, got: ${period}`);
  }
}

function requireBarArray(bars, name) {
  if (!Array.isArray(bars)) {
    throw new Error(`${name}: bars must be an array of OHLCV records`);
  }
}

/**
 * Run the V1 Donchian breakout simulation over completed bars.
 *
 * Semantics are BT0 §4 exactly as before the BT4 generalization — completed
 * bar i breaks out against the channel of the p bars ending at i-1, strict
 * inequalities, next-bar raw-open fills, no fabricated terminal fill,
 * terminal state reported, executions and closed trades counted
 * separately — and the returned object is the §4.5 result structure
 * unchanged.
 */
export function donchianBreakoutBacktest(bars, period = 20) {
  requirePositiveIntegerPeriod(period, 'donchianBreakoutBacktest');
  requireBarArray(bars, 'donchianBreakoutBacktest');
  return runStrategyBacktest(bars, donchianStrategy(period));
}
