/**
 * BT3 — performance metrics layer (pure projection).
 *
 * BINDING CONTRACT: docs/BT3-CONTRACT.md (owner-adjudicated 2026-08-24,
 * APPROVED-WITH-AMENDMENTS — adjudication record in its §1.5; ratified by
 * the merge of PR #20 at commit d2c60b3, merged 1abf261). This module
 * implements §2–§5 of that document EXACTLY; any semantic departure
 * requires a BT3 amendment, never an in-flight reinterpretation. The
 * fourteen contract fixtures (MF0–MF13) are transcribed into
 * tests/backtest_metrics.test.js as the binding oracle.
 *
 * ARCHITECTURE (§2): a pure projection over the CLOSED BT2 accounting
 * result — computeBacktestMetrics(accounting), one argument, nothing
 * else. This module imports NOTHING and owns no capability, clock,
 * randomness, or mutable module state. The CLOSED BT2 accounting layer is
 * sha256-pinned by the tests (§2); BT1 stays pinned by BT2's tests and A1
 * by BT1's.
 *
 * PROJECTION DISCIPLINE (§2.1/§2.2): the function reads exactly the
 * normative consumed-field allowlist — initialCash, finalEquity,
 * realizedPnlTotal, closedTradePnl[].realizedPnl, openPositionAccounting
 * (null-ness and its unrealizedPnl), equitySeries — and never re-derives
 * an authoritative value: the realized total is copied, never re-summed
 * from executions or closed trades (owner ruling, §2.1); the unrealized
 * value is copied, never recomputed from the mark; no equity, position,
 * cost, or fill is reconstructed. If a metric here disagrees with the
 * accounting layer, the defect is here by definition — there is no second
 * accounting truth.
 *
 * OPERATIVE RULES (owner-ruled; written IEEE evaluation order):
 *   - D1  totalReturn = (finalEquity − initialCash) / initialCash.
 *   - D2  netPnl = realizedPnlTotal + unrealizedPnl (one addition);
 *         flat ⇒ unrealizedPnl is 0 by the BT2 §5.5 definition.
 *   - D3  classification by the sign of each closed trade's net
 *         after-cost realizedPnl; zero (either sign of zero) is
 *         breakeven — neither a win nor a loss.
 *   - D3a winRate = winningTrades / closedTrades (the plain denominator —
 *         a breakeven lowers the plain win rate); a breakeven-only
 *         history measures 0; null only when no closed trade exists.
 *   - D4  maxDrawdown: running-peak peak-to-trough fraction over the BT2
 *         equity series with the peak SEEDED at initialCash — "Initial
 *         capital is the time-zero equity anchor for drawdown."
 *   - D5  profitFactor decided structurally BEFORE any division:
 *         losses present → grossProfitTotal / (−grossLossTotal);
 *         wins without losses → null 'no_losses'; closed trades that are
 *         all breakeven → null 'no_directional_closed_trades'; no closed
 *         trades → null 'insufficient_closed_trades'.
 *   - D7/D7a: every reported metric is a finite raw double or a
 *         contract-enumerated reasoned null. A metric whose derived
 *         arithmetic is non-finite from valid finite inputs fails the
 *         whole call loudly with a typed error naming the metric/stage —
 *         never Infinity, never NaN, never a serialization-laundered
 *         null. No tolerance machinery of any kind lives here (the BT2
 *         reconciliation comparator is a verification instrument, tests
 *         only).
 *
 * INPUT CONTRACT (§3): boundary-shaped validation of the consumed fields
 * only — typed errors on missing/mistyped/non-finite consumed values; no
 * master-identity check, no equity recomputation, no reconciliation of
 * any kind (those belong to the CLOSED BT2 layer and the test suite).
 */

function fail(what) {
  throw new Error(`computeBacktestMetrics: ${what}`);
}

function requireFiniteField(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${what} must be a finite number, got: ${value}`);
  }
  return value;
}

function requireFiniteMetric(value, metric) {
  if (!Number.isFinite(value)) {
    fail(`${metric} non_finite_result: the metric is semantically defined but its binary64 evaluation is not representable, got: ${value}`);
  }
  return value;
}

/**
 * Project the ratified BT3 V1 metrics from a CLOSED-BT2 accounting
 * result. Returns the flat thirteen-field §5.1 structure; reason fields
 * are non-null exactly when their metric is null.
 */
export function computeBacktestMetrics(accounting) {
  if (accounting === null || typeof accounting !== 'object') {
    fail(`accounting must be a CLOSED-BT2 result object, got: ${accounting}`);
  }
  const initialCash = requireFiniteField(accounting.initialCash, 'initialCash');
  if (initialCash <= 0) {
    fail(`initialCash must be greater than 0 (the BT2 domain, restated at the boundary), got: ${initialCash}`);
  }
  const finalEquity = requireFiniteField(accounting.finalEquity, 'finalEquity');
  const realizedPnlTotal = requireFiniteField(accounting.realizedPnlTotal, 'realizedPnlTotal');
  const closedTradePnl = accounting.closedTradePnl;
  if (!Array.isArray(closedTradePnl)) {
    fail(`closedTradePnl must be an array of closed-trade records, got: ${closedTradePnl}`);
  }
  const openPositionAccounting = accounting.openPositionAccounting;
  if (openPositionAccounting === undefined
    || (openPositionAccounting !== null && typeof openPositionAccounting !== 'object')) {
    fail(`openPositionAccounting must be null or an accounting record, got: ${openPositionAccounting}`);
  }
  const unrealizedPnl = openPositionAccounting === null
    ? 0 // flat ⇒ 0 by the BT2 §5.5 definition — a materialized copy, not a computation
    : requireFiniteField(openPositionAccounting.unrealizedPnl, 'openPositionAccounting.unrealizedPnl');
  const equitySeries = accounting.equitySeries;
  if (!Array.isArray(equitySeries)) {
    fail(`equitySeries must be an array of equity samples, got: ${equitySeries}`);
  }

  const totalReturn = requireFiniteMetric((finalEquity - initialCash) / initialCash, 'totalReturn');
  const netPnl = requireFiniteMetric(realizedPnlTotal + unrealizedPnl, 'netPnl');

  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let grossProfitTotal = 0;
  let grossLossTotal = 0;
  for (const trade of closedTradePnl) {
    if (trade === null || typeof trade !== 'object') {
      fail(`closedTradePnl element must be a closed-trade record, got: ${trade}`);
    }
    const realizedPnl = requireFiniteField(trade.realizedPnl, 'closedTradePnl[].realizedPnl');
    if (realizedPnl > 0) {
      winningTrades += 1;
      grossProfitTotal = requireFiniteMetric(grossProfitTotal + realizedPnl, 'grossProfitTotal');
    } else if (realizedPnl < 0) {
      losingTrades += 1;
      grossLossTotal = requireFiniteMetric(grossLossTotal + realizedPnl, 'grossLossTotal');
    } else {
      breakevenTrades += 1;
    }
  }
  const closedTrades = closedTradePnl.length;

  let winRate = null;
  let winRateReason = null;
  if (closedTrades > 0) {
    winRate = winningTrades / closedTrades; // D3a as ruled — the plain denominator
  } else {
    winRateReason = 'insufficient_closed_trades';
  }

  let profitFactor = null;
  let profitFactorReason = null;
  if (losingTrades > 0) {
    profitFactor = requireFiniteMetric(grossProfitTotal / -grossLossTotal, 'profitFactor');
  } else if (winningTrades > 0) {
    profitFactorReason = 'no_losses';
  } else if (closedTrades > 0) {
    profitFactorReason = 'no_directional_closed_trades';
  } else {
    profitFactorReason = 'insufficient_closed_trades';
  }

  let maxDrawdown = 0;
  let peak = initialCash; // D4 amendment: the time-zero equity anchor
  for (const sample of equitySeries) {
    const equity = requireFiniteField(sample, 'equitySeries sample');
    if (equity > peak) peak = equity;
    const drawdown = requireFiniteMetric((peak - equity) / peak, 'maxDrawdown');
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    totalReturn,
    realizedPnlTotal,
    unrealizedPnl,
    netPnl,
    closedTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRate,
    winRateReason,
    maxDrawdown,
    profitFactor,
    profitFactorReason,
  };
}
