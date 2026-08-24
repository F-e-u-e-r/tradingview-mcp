/**
 * Core BT5 orchestration — minimal MCP exposure of the CLOSED BT1–BT4
 * pipeline.
 *
 * BINDING CONTRACT: docs/BT5-CONTRACT.md (ratified by owner 2026-08-24 at
 * commit 35a31c52, merged ab85e472). Any semantic departure requires a BT5
 * amendment, never an in-flight reinterpretation.
 *
 * WHAT THIS MODULE IS. Orchestration, and nothing else. It owns no
 * evaluate/CDP/network/filesystem capability of its own; its ONLY acquisition
 * path is core/data.getOhlcv, so every window semantic of the data layer —
 * the two presence-selected modes, no fallback, no widening, the <=500 cap,
 * refusal by throw — is inherited verbatim rather than re-implemented, and a
 * getOhlcv refusal PROPAGATES unchanged.
 *
 * WHAT IT IS NOT. Not a second accounting truth, not a numerical transform,
 * not an error-translation layer, and not a trading capability of any kind.
 * The CLOSED layers are consumed exactly as they stand: their typed errors
 * bubble UNCHANGED (D7a — no BT5 prefix, no stacking), and their result
 * objects are transported verbatim rather than reshaped.
 *
 * VALIDATION ORDER (D3, binding). Everything decidable from the request alone
 * fails BEFORE acquisition — an unknown strategy, a malformed period, or a
 * mutually incompatible pair must never reach TradingView and come back to
 * report an input error. It spends no capability on an already-invalid
 * request, and it keeps error provenance clean: a refusal that never touched
 * the chart cannot be mistaken for a data problem.
 *
 * COMPLETION (D5/D5a, binding). BT0 §4.7 says a bar whose completion cannot
 * be established must not participate in strategy evaluation, and that the
 * exclusion must be observable. The evidence is STRUCTURAL, never temporal: a
 * later bar in the SAME snapshot proves the last returned bar can take no
 * further ticks. That evidence is located by the data layer before the
 * window's membership filter can hide it, and the successor is EVIDENCE ONLY
 * — it never enters the bars a strategy sees. When no successor exists the
 * terminal bar is excluded, observably. There is no wall-clock heuristic
 * anywhere in this file, and none may be added without a BT5 amendment.
 *
 * PROVENANCE (§6.3, binding). Symbol, resolution and completion evidence all
 * arrive from the SAME acquisition snapshot as the bars. This module never
 * reads the chart a second time to label a result.
 */
import { getOhlcv as _getOhlcv } from './data.js';
import { runStrategyBacktest } from '../analytics/engine.js';
import { donchianStrategy } from '../analytics/strategies/donchian.js';
import { smaCrossoverStrategy } from '../analytics/strategies/sma-crossover.js';
import { accountBacktest } from '../analytics/accounting.js';
import { computeBacktestMetrics } from '../analytics/metrics.js';

const MAX_BARS = 500;

// The closed V1 strategy set (D2). Adding an arm here is a contract change,
// not an implementation choice.
const STRATEGY_SPEC = {
  donchian: ['period'],
  sma_crossover: ['fastPeriod', 'slowPeriod'],
};

function _resolve(deps) {
  return { getOhlcv: deps?.getOhlcv || _getOhlcv };
}

function fail(what) {
  throw new Error(`computeBacktest: ${what}`);
}

function requirePositiveInteger(value, label, type) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(`${type}: ${label} must be a positive integer, got: ${JSON.stringify(value)}`);
  }
}

/**
 * The nested discriminated strategy object (D2a). The served schema already
 * refuses these shapes; this is the belt for a direct caller, and it is the
 * ONLY place the cross-field relation can be enforced — a discriminated union
 * cannot express `fastPeriod < slowPeriod`.
 *
 * A foreign field is REFUSED, never silently ignored: silent-ignore is the
 * failure mode the ruling exists to prevent, because it lets a caller believe
 * a parameter took effect when it did not.
 */
function requireStrategy(strategy) {
  if (strategy === null || typeof strategy !== 'object' || Array.isArray(strategy)) {
    fail(`strategy must be an object with a type, got: ${JSON.stringify(strategy)}`);
  }
  const required = STRATEGY_SPEC[strategy.type];
  if (required === undefined) {
    fail(`unknown strategy type: ${JSON.stringify(strategy.type)} — V1 supports ${Object.keys(STRATEGY_SPEC).join(' | ')}`);
  }
  const given = Object.keys(strategy).filter((k) => k !== 'type');
  for (const key of required) {
    if (!given.includes(key)) fail(`${strategy.type}: missing required parameter ${key}`);
  }
  for (const key of given) {
    if (!required.includes(key)) fail(`${strategy.type}: unexpected parameter ${key}`);
  }
  for (const key of required) requirePositiveInteger(strategy[key], key, strategy.type);
  if (strategy.type === 'sma_crossover' && strategy.fastPeriod >= strategy.slowPeriod) {
    fail(`sma_crossover: fastPeriod must be less than slowPeriod, got: ${strategy.fastPeriod} >= ${strategy.slowPeriod}`);
  }
  return strategy;
}

/**
 * BT2 §3 admissibility, enforced here so it fires BEFORE acquisition. The
 * three parameters are REQUIRED: BT2 forbids silent defaults ("a zero-cost
 * run states its zeros"), so BT5 inventing one would be BT5 manufacturing an
 * assumption the caller never made.
 */
function requireCosts({ initialCash, commissionRate, slippageRate }) {
  if (typeof initialCash !== 'number' || !Number.isFinite(initialCash) || initialCash <= 0) {
    fail(`initialCash must be a finite number > 0, got: ${JSON.stringify(initialCash)}`);
  }
  for (const [label, rate] of [['commissionRate', commissionRate], ['slippageRate', slippageRate]]) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate >= 1) {
      fail(`${label} must be a finite number in [0, 1), got: ${JSON.stringify(rate)}`);
    }
  }
  return { initialCash, commissionRate, slippageRate };
}

function buildStrategy(spec) {
  if (spec.type === 'donchian') return donchianStrategy(spec.period);
  return smaCrossoverStrategy(spec.fastPeriod, spec.slowPeriod);
}

/**
 * Run one simulation over the validated OHLCV bars the chart currently
 * serves, and report what was read, what was assumed, and what came out.
 */
export async function computeBacktest({
  strategy, initialCash, commissionRate, slippageRate, count, from, to, _deps,
} = {}) {
  const { getOhlcv } = _resolve(_deps);

  // ── refuse before acquisition (D3) ───────────────────────────────────────
  const spec = requireStrategy(strategy);
  const costs = requireCosts({ initialCash, commissionRate, slippageRate });

  // ── the ONLY acquisition path, with the two internal opt-ins (D4/§6.3) ───
  const ohlcv = await getOhlcv({
    summary: false, count, from, to, includeResolution: true, includeProvenance: true,
  });

  // ── completed-bar qualification (D5/D5a) ─────────────────────────────────
  // Structural evidence only. No clock is consulted, here or anywhere below.
  const acquired = ohlcv.bars;
  const completion = ohlcv.terminalCompletion ?? { established: false, evidence: null, successorTime: null };
  const excluded = acquired.length > 0 && !completion.established ? 1 : 0;
  const bars = excluded ? acquired.slice(0, acquired.length - 1) : acquired;

  // A BT5-owned boundary error (D7). Returning success:true here would hand
  // the caller a result with no bar behind it — a vacuous "no trades" that
  // reads exactly like a real one. The honest answer is a refusal that names
  // what happened, and it is reported AFTER acquisition on purpose: whether a
  // window's terminal bar can be proven complete is a property of the data,
  // not of the request, and D4 forbids re-implementing data-layer knowledge
  // here to guess it earlier.
  if (bars.length === 0) {
    fail(`insufficient completed bars: acquired ${acquired.length}, excluded ${excluded} as unprovably complete, leaving 0 to evaluate. Widen the window (from/to) or raise count so at least one acquired bar is followed by a later bar in the same snapshot.`);
  }

  // ── the CLOSED pipeline, consumed untouched ──────────────────────────────
  const execution = runStrategyBacktest(bars, buildStrategy(spec));
  const accounting = accountBacktest(bars, execution, costs);
  const metrics = computeBacktestMetrics(accounting);

  return {
    success: true,
    source: {
      // Every field here came from the SAME snapshot as the bars (§6.3).
      symbol: ohlcv.symbol ?? null,
      resolution: ohlcv.resolution ?? null,
      mode: ohlcv.mode,
      ...(ohlcv.requested_window ? { requested_window: ohlcv.requested_window } : {}),
      bars_acquired: acquired.length,
      bars_used: bars.length,
      excluded_incomplete_terminal_bars: excluded,
      terminal_completion: {
        established: completion.established,
        evidence: completion.evidence,
        successor_time: completion.successorTime,
      },
      ...(bars.length > 0 ? { from: bars[0].time, to: bars[bars.length - 1].time } : {}),
      // Window truncation reported by the DATA layer, passed through with its
      // own note rather than restated.
      ...(ohlcv.truncated ? { truncated: true, note: ohlcv.note } : {}),
    },
    assumptions: {
      strategy: spec,
      signal_model: 'completed_bar',
      execution: 'next_bar_open',
      // Transported from the CLOSED accounting layer rather than restated, so
      // the reported costs are necessarily the ones actually applied.
      ...accounting.assumptions,
      long_only: true,
      max_open_positions: 1,
      pyramiding: false,
      force_close: false,
      max_bars: MAX_BARS,
    },
    result: {
      // The BT0 §4.5 shape verbatim — executions vs closed trades, and a
      // terminal open position vs a terminal pending signal, stay distinct.
      executions: execution.executions,
      closedTrades: execution.closedTrades,
      openPosition: execution.openPosition,
      pendingSignal: execution.pendingSignal,
      totalExecutions: execution.totalExecutions,
      totalClosedTrades: execution.totalClosedTrades,
      accounting,
      metrics,
    },
  };
}
