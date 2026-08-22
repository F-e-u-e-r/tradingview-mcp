/**
 * BT1 — deterministic Donchian breakout execution kernel (pure).
 *
 * BINDING CONTRACT: docs/BT0-CONTRACT.md (ratified by owner 2026-08-23 at
 * commit 438a59e, merged ae68572). This module implements §4 of that
 * document EXACTLY; any semantic departure requires an explicit BT0
 * amendment, never an in-flight reinterpretation. The twelve contract
 * fixtures (F1–F12) are transcribed into tests/backtest_kernel.test.js as
 * the binding oracle.
 *
 * INVARIANTS (same zero-capability class as the A1 kernel): no MCP
 * registration, no CDP, no network, no filesystem, no process/env access,
 * no clock, no randomness, no mutable module state, no new dependency;
 * deterministic inputs → outputs; the input array is never mutated.
 *
 * INPUT: a completed-bar-qualified record array from the validated OHLCV
 * boundary ({open, high, low, close} read; other record fields ignored).
 * Per the ratified §4.7 completion policy, the kernel treats every supplied
 * bar as completed — ESTABLISHING completion (and excluding an unverifiable
 * terminal bar, observably) is the integration layer's obligation, deferred
 * to BT5. This kernel deliberately owns no completion heuristic.
 *
 * PROVENANCE (DERIVE, per the owner's supersession of Phase-0's ADAPT-port
 * disposition): the prior-window signal rule — bar i breaks out against the
 * Donchian channel of the p bars ending at i−1, never a window containing
 * bar i itself — retains the donor's post-#71 lesson
 * (atilaahmettaner/tradingview-mcp @ d77db101, MIT; behavioral inspiration
 * only, no code copied — recorded in BT0 §1.2, deliberately NOT a
 * THIRD_PARTY_NOTICES entry per the owner's COPY/ADAPT-only rule). The
 * execution semantics — completed-bar signal → next-bar raw-open fill,
 * explicit terminal state — are the owner-defined contract, replacing the
 * donor's same-bar-close fill and silent terminal-position drop.
 *
 * The prior-window channel is obtained by consuming the CLOSED A1 kernel's
 * bar-inclusive donchian() output at index i−1 — src/analytics/indicators.js
 * is not modified by BT work (owner ruling; pinned by hash in the tests).
 */

import { donchian } from './indicators.js';

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
 * Event order per bar t (BT0 §4.1): (1) at the open, a pending order from
 * bar t−1's signal fills at open[t]; (2) at completion, evaluate — flat →
 * entry iff high[t] > upper[t−1]; long → exit iff low[t] < lower[t−1];
 * strict inequalities; bars t < period are warm-up and evaluate nothing.
 * The simulation starts flat (§4.1). A signal on the final bar never fills
 * and is preserved as the unfillable pending signal (§4.3/§4.4).
 *
 * Returns the §4.5 result structure: chronological `executions` (ascending
 * fillIndex) and `closedTrades` (ascending exitFillIndex), plus the live
 * terminal state (`openPosition`, `pendingSignal`) and both totals —
 * executions and closed trades are distinct counts, never conflated.
 */
export function donchianBreakoutBacktest(bars, period = 20) {
  requirePositiveIntegerPeriod(period, 'donchianBreakoutBacktest');
  requireBarArray(bars, 'donchianBreakoutBacktest');

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const { upper, lower } = donchian(highs, lows, period);

  const executions = [];
  const closedTrades = [];
  let openPosition = null;
  let pending = null; // { kind: 'entry' | 'exit', signalIndex }

  for (let t = 0; t < bars.length; t++) {
    if (pending !== null) {
      const fillPrice = bars[t].open;
      executions.push({ kind: pending.kind, signalIndex: pending.signalIndex, fillIndex: t, fillPrice });
      if (pending.kind === 'entry') {
        openPosition = { entrySignalIndex: pending.signalIndex, entryFillIndex: t, entryPrice: fillPrice };
      } else {
        closedTrades.push({
          entrySignalIndex: openPosition.entrySignalIndex,
          entryFillIndex: openPosition.entryFillIndex,
          entryPrice: openPosition.entryPrice,
          exitSignalIndex: pending.signalIndex,
          exitFillIndex: t,
          exitPrice: fillPrice,
        });
        openPosition = null;
      }
      pending = null;
    }

    if (t >= period) {
      if (openPosition === null) {
        if (bars[t].high > upper[t - 1]) pending = { kind: 'entry', signalIndex: t };
      } else if (bars[t].low < lower[t - 1]) {
        pending = { kind: 'exit', signalIndex: t };
      }
    }
  }

  return {
    executions,
    closedTrades,
    openPosition,
    pendingSignal: pending === null ? null : { kind: pending.kind, signalIndex: pending.signalIndex, unfillable: true },
    totalExecutions: executions.length,
    totalClosedTrades: closedTrades.length,
  };
}
