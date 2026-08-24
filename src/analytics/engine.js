/**
 * BT4 — generalized, strategy-consulted execution engine (pure).
 *
 * BINDING CONTRACT: docs/BT4-CONTRACT.md (ratified by owner 2026-08-24 at
 * commit 8351804, merged e3f674b; Amendment A at dcc79a8, merged e4dc65b),
 * which implements the CLOSED BT0 §4 execution semantics unchanged. Any
 * semantic departure requires a BT4 amendment, never an in-flight
 * reinterpretation.
 *
 * OWNERSHIP (contract §3.1, D1). This module owns, exclusively:
 *
 *     signal -> pending -> next-bar-raw-open fill -> position transition
 *
 * A strategy owns none of it: not fill timing, not execution price, not
 * cash, not commission or slippage, not accounting, not force-close, not
 * future data, not order sizing. A strategy answers one question per bar,
 * in one of three tokens, and the engine decides everything else.
 *
 * WHAT A STRATEGY SEES (contract §3.3 / §4, D3 and D4). Exactly a bounded
 * view of the completed bars 0..i as four column arrays, plus the position
 * state as `flat` or `long`. Bar i+1 is UNREACHABLE, not merely unread:
 * the columns are freshly built copies truncated at i, and both the view
 * and its columns are frozen, so no surface the view offers — index, slice,
 * spread, .at, mutation — reaches past the current bar or leaks into the
 * next one. Nothing about cash, equity, P&L, costs, or trade counts is
 * exposed; the BT2 accounting result never reaches a strategy.
 *
 * WARM-UP (contract §3.1, D1b). The engine consults the strategy on EVERY
 * eligible completed bar and is never told how much history a strategy
 * needs. Insufficient history is the strategy's own business and is
 * expressed as the outcome NONE, never as a skipped consultation. No
 * strategy parameter of any kind reaches this module.
 *
 * INAPPLICABLE SIGNALS (contract §3.1, D1a). ENTER_LONG while long and
 * EXIT_LONG while flat are DEFINED NO-OPS, never errors: the strategy
 * proposes intent and this engine stays authoritative over whether that
 * intent is applicable in the current position state. The no-op is strict —
 * no pending order, no execution, no counter increment, no accounting
 * effect, and no synthetic rejection record; substituting NONE for such a
 * signal must leave the entire result bit-identical. A token OUTSIDE the
 * closed vocabulary is a different thing — a protocol violation — and fails
 * loud rather than being silently swallowed.
 *
 * IDENTITY BLINDNESS (contract §7.3). Nothing here branches on which
 * strategy produced a signal: no name, no kind, no class, no parameter
 * fingerprint. For an identical signal sequence the result is identical,
 * whatever produced it. That is the architecture line this milestone exists
 * to establish, so this module deliberately imports NOTHING — not even the
 * A1 kernel, which belongs to the strategies that consume it.
 *
 * INVARIANTS (same zero-capability class as A1/BT1/BT2/BT3): no imports, no
 * MCP registration, no CDP, no network, no filesystem, no process/env
 * access, no clock, no randomness, no mutable module state, no new
 * dependency; deterministic inputs -> outputs; the input array and its bar
 * records are never mutated.
 */

function requireBarArray(bars) {
  if (!Array.isArray(bars)) {
    throw new Error('runStrategyBacktest: bars must be an array of OHLCV records');
  }
}

function requireStrategy(strategy) {
  if (strategy === null || typeof strategy !== 'object' || typeof strategy.evaluate !== 'function') {
    throw new Error('runStrategyBacktest: strategy must expose an evaluate(view) function');
  }
}

function isSignal(value) {
  return value === 'ENTER_LONG' || value === 'EXIT_LONG' || value === 'NONE';
}

/**
 * Build the bar-`at` view: the completed bars 0..at as frozen column copies,
 * plus the position state. Nothing beyond `at` is reachable through it.
 */
function boundedView(bars, at, held) {
  const opens = new Array(at + 1);
  const highs = new Array(at + 1);
  const lows = new Array(at + 1);
  const closes = new Array(at + 1);
  for (let i = 0; i <= at; i++) {
    const bar = bars[i];
    opens[i] = bar.open;
    highs[i] = bar.high;
    lows[i] = bar.low;
    closes[i] = bar.close;
  }
  return Object.freeze({
    index: at,
    position: held,
    opens: Object.freeze(opens),
    highs: Object.freeze(highs),
    lows: Object.freeze(lows),
    closes: Object.freeze(closes),
  });
}

/**
 * Run a strategy over completed bars under the CLOSED BT0 §4 execution
 * model.
 *
 * Event order per bar t (BT0 §4.1): (1) at the open, a pending order from
 * bar t-1's signal fills at open[t]; (2) at completion, the strategy is
 * consulted over the bounded view of bars 0..t under the position state
 * that now holds. The simulation starts flat (§4.1). A signal on the final
 * bar never fills and is preserved as the unfillable pending signal
 * (§4.3/§4.4).
 *
 * Returns the §4.5 result structure verbatim — chronological `executions`
 * (ascending fillIndex) and `closedTrades` (ascending exitFillIndex), the
 * live terminal state (`openPosition`, `pendingSignal`), and both totals,
 * which are distinct counts and never conflated. The shape does not grow a
 * signal log: BT2 and BT3 consume this object unchanged.
 */
export function runStrategyBacktest(bars, strategy) {
  requireBarArray(bars);
  requireStrategy(strategy);

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

    const signal = strategy.evaluate(boundedView(bars, t, openPosition === null ? 'flat' : 'long'));
    if (!isSignal(signal)) {
      throw new Error('runStrategyBacktest: strategy returned an unknown signal: ' + String(signal));
    }

    if (openPosition === null) {
      if (signal === 'ENTER_LONG') pending = { kind: 'entry', signalIndex: t };
    } else if (signal === 'EXIT_LONG') {
      pending = { kind: 'exit', signalIndex: t };
    }
    // Every other combination is a defined no-op: nothing is queued,
    // recorded, or counted, and no rejection is synthesised.
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
