/**
 * BT4 — Donchian breakout strategy adapter (pure).
 *
 * BINDING CONTRACT: docs/BT4-CONTRACT.md §5 (D5). This adapter carries the
 * CLOSED BT1 signal rules verbatim; the generalized engine driven by it must
 * be observationally identical to the pre-refactor BT1 kernel over the whole
 * ratified behavioural corpus. That equivalence is the D5 golden regression,
 * and it — not any argument about how the channel is computed — is the
 * acceptance authority.
 *
 * PROVENANCE (carried over from the CLOSED BT1 kernel, DERIVE per the owner's
 * supersession of Phase-0's ADAPT-port disposition): the prior-window signal
 * rule — bar i breaks out against the Donchian channel of the p bars ending
 * at i-1, never a window containing bar i itself — retains the donor's
 * post-#71 lesson (atilaahmettaner/tradingview-mcp @ d77db101, MIT;
 * behavioural inspiration only, no code copied — recorded in BT0 §1.2,
 * deliberately NOT a THIRD_PARTY_NOTICES entry per the owner's
 * COPY/ADAPT-only rule). The donor's pathology was the signal bar entering
 * its OWN breakout threshold — a self-referential band that silently
 * produced zero trades. Reading completed bar i is legitimate and required
 * (the high/low compared against the band are bar i's own); what is
 * forbidden is bar i participating in the band it must break.
 *
 * OWNERSHIP (contract §3.1). This module produces one token per bar and
 * nothing else. It does not fill, price, position, account, or force-close;
 * it cannot see a future bar, because the engine's view is bounded at the
 * current bar and frozen.
 *
 * WARM-UP (contract §3.1, D1b) is internal here, never an engine parameter:
 * below index p the prior channel is undefined, and the outcome is the
 * ordinary signal NONE — the engine still consults on every bar.
 *
 * INVARIANTS: the ONLY dependency is the CLOSED A1 indicator kernel
 * (src/analytics/indicators.js, byte-pinned and untouched by BT work); the
 * channel is consumed from it and never recomputed locally; no capability,
 * no clock, no randomness, no mutable module state; deterministic
 * inputs -> outputs. The period guard is deliberately local rather than
 * shared, because the ratified per-module dependency rule (contract §5.1.1
 * B) permits this adapter exactly one import: the A1 kernel.
 */

import { donchian } from '../indicators.js';

function requirePositiveIntegerPeriod(period, name) {
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new Error(`${name}: period must be a positive integer, got: ${period}`);
  }
}

/**
 * The CLOSED BT1 §4.2 rules as a strategy: flat -> entry iff the current
 * high exceeds the PRIOR window's upper band; long -> exit iff the current
 * low falls below the PRIOR window's lower band; strict inequalities, so
 * touching a band is never a breakout.
 */
export function donchianStrategy(period = 20) {
  requirePositiveIntegerPeriod(period, 'donchianStrategy');
  return {
    evaluate({ index, position, highs, lows }) {
      if (index < period) return 'NONE';
      const { upper, lower } = donchian(highs, lows, period);
      if (position === 'flat') {
        return highs[index] > upper[index - 1] ? 'ENTER_LONG' : 'NONE';
      }
      return lows[index] < lower[index - 1] ? 'EXIT_LONG' : 'NONE';
    },
  };
}
