/**
 * BT4 — SMA crossover strategy (pure). The SECOND strategy, and the
 * instrument that falsifies the whole milestone.
 *
 * BINDING CONTRACT: docs/BT4-CONTRACT.md §6 (D6) and §6.1a (D6a). Its
 * purpose is not to be a good strategy; it is to answer the owner's single
 * question — can a second strategy be plugged in with NO semantic edit to
 * execution, accounting, or metrics? If wiring this module forced a change
 * to fill timing, pending semantics, BT2 accounting, or BT3 metrics, the
 * abstraction would have failed and BT4 would not close.
 *
 * SIGNAL RULE (contract §6.1, ratified). With integer periods
 * fastPeriod < slowPeriod, over the visible window at bar i:
 *
 *     flat: ENTER_LONG iff  fast[i] >  slow[i]  AND  fast[i-1] <= slow[i-1]
 *     long: EXIT_LONG  iff  fast[i] <  slow[i]  AND  fast[i-1] >= slow[i-1]
 *
 * — PREV-INCLUSIVE on the previous observation, STRICT on the current one
 * (D6a). The owner's reconciliation of the two equality halves, verbatim:
 * "Equality at the current observation is not itself a crossing event;
 * equality at the previous observation may serve as the boundary state from
 * which a subsequent strict move to the other side constitutes a crossing."
 *
 * So: a touch that then moves through IS a crossing; landing exactly on the
 * other line is NOT one, it is a touch; and staying on one side is a STATE,
 * not an event — a cross that happened during warm-up is missed by design
 * and never fires late.
 *
 * WARM-UP (contract §3.1, D1b) is internal here, never an engine parameter.
 * A1's sma() returns a null prefix for the first (period-1) bars; while any
 * of the four consulted values is null the outcome is the ordinary signal
 * NONE, and the engine still consults on every bar.
 *
 * OWNERSHIP (contract §3.1) is unchanged from every other strategy: one
 * token per bar, nothing else. No fill, no price, no position, no
 * accounting, no future bar. The view is bounded at the current bar and
 * frozen, so sma() is computed over the visible prefix — which is exactly
 * the same value it would take over the full series, since a bar-inclusive
 * window ending at i depends only on bars <= i.
 *
 * INVARIANTS: the ONLY dependency is the CLOSED A1 indicator kernel
 * (byte-pinned, untouched by BT work); no capability, no clock, no
 * randomness, no mutable module state; deterministic inputs -> outputs. The
 * period guard is deliberately local rather than shared, because the
 * ratified per-module dependency rule (contract §5.1.1 B) permits this
 * strategy exactly one import: the A1 kernel.
 */

import { sma } from '../indicators.js';

function requirePositiveIntegerPeriod(period, name, label) {
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new Error(`${name}: ${label} must be a positive integer, got: ${period}`);
  }
}

/**
 * Build the SMA-crossover strategy. `fastPeriod` must be strictly less than
 * `slowPeriod` — an inverted or equal pair is a typed error at
 * construction, not a silently degenerate strategy.
 */
export function smaCrossoverStrategy(fastPeriod, slowPeriod) {
  requirePositiveIntegerPeriod(fastPeriod, 'smaCrossoverStrategy', 'fastPeriod');
  requirePositiveIntegerPeriod(slowPeriod, 'smaCrossoverStrategy', 'slowPeriod');
  if (fastPeriod >= slowPeriod) {
    throw new Error(`smaCrossoverStrategy: fastPeriod must be less than slowPeriod, got: ${fastPeriod} >= ${slowPeriod}`);
  }
  return {
    evaluate({ index, position, closes }) {
      if (index < 1) return 'NONE';
      const fast = sma(closes, fastPeriod);
      const slow = sma(closes, slowPeriod);
      if (fast[index] === null || slow[index] === null || fast[index - 1] === null || slow[index - 1] === null) {
        return 'NONE';
      }
      if (position === 'flat') {
        return fast[index] > slow[index] && fast[index - 1] <= slow[index - 1] ? 'ENTER_LONG' : 'NONE';
      }
      return fast[index] < slow[index] && fast[index - 1] >= slow[index - 1] ? 'EXIT_LONG' : 'NONE';
    },
  };
}
