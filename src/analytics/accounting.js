/**
 * BT2 — costs & equity accounting layer (pure fold).
 *
 * BINDING CONTRACT: docs/BT2-CONTRACT.md (owner-ratified 2026-08-23 at
 * commit 04dc9fd, merged 7d0fb1f; decision points D1–D7 all approved).
 * This module implements §3–§5 of that document EXACTLY; any semantic
 * departure requires a BT2 amendment, never an in-flight
 * reinterpretation. The seven contract fixtures (AF1–AF7) are transcribed
 * into tests/backtest_accounting.test.js as the binding oracle.
 *
 * ARCHITECTURE (§2): a pure derivation over the CLOSED BT1 execution
 * result — accountBacktest(bars, execution, params). Costs never
 * influence signals or fills; this module imports NOTHING and owns no
 * capability, clock, randomness, or mutable module state. The BT1 kernel
 * is sha256-pinned by the tests (D3); the A1 indicator kernel stays
 * pinned by BT1's tests.
 *
 * OPERATIVE BINARY64 RULES (owner-ratified; each has exactly one IEEE
 * reading):
 *   - D1 all-in entry: quantity = cashBefore / (effectivePrice × (1+r));
 *     entry cashAfter := 0 BY DEFINITION (all-in deploys the entire
 *     balance — never a subtraction whose residue an epsilon would hide).
 *   - D4 cost order: slippage on the raw fill price forms the effective
 *     price (buys ×(1+s), sells ×(1−s)); commission on effective
 *     notional, per side.
 *   - §5.5 cash-form P&L: realizedPnl := cashAfterExit − cashBeforeEntry;
 *     entryCost := cashBeforeEntry.
 *   - D2/D5 marking: an open position marks at the RAW close (no
 *     hypothetical exit costs); one equity sample per completed bar, a
 *     fill effective within its own bar.
 *   - D7 reconstruction basis: everything reported here derives from the
 *     execution ledger + these explicit assumptions + the bars' close
 *     series. No hidden accounting state exists.
 *
 * DOMAIN GUARDS (§3; applied to computed INTERMEDIATES): computed
 * effective prices finite and strictly positive; entry denominator
 * finite; entry quantity strictly positive; exit net proceeds strictly
 * positive; every derived value finite. Violations fail loud with typed
 * errors — results never carry NaN or Infinity.
 *
 * The §5.7 reconciliation comparator is deliberately ABSENT from this
 * module: it is a verification instrument that lives in the tests (owner
 * ruling — tolerance machinery must never appear in accounting formulas
 * or decide a cash/state transition).
 */

function fail(what) {
  throw new Error(`accountBacktest: ${what}`);
}

function requireParams(params) {
  if (params === null || typeof params !== 'object') {
    fail(`params must be an object with initialCash/commissionRate/slippageRate, got: ${params}`);
  }
  const { initialCash, commissionRate, slippageRate } = params;
  if (typeof initialCash !== 'number' || !Number.isFinite(initialCash) || initialCash <= 0) {
    fail(`initialCash must be a finite number > 0, got: ${initialCash}`);
  }
  if (typeof commissionRate !== 'number' || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
    fail(`commissionRate must be a finite number in [0, 1), got: ${commissionRate}`);
  }
  if (typeof slippageRate !== 'number' || !Number.isFinite(slippageRate) || slippageRate < 0 || slippageRate >= 1) {
    fail(`slippageRate must be a finite number in [0, 1), got: ${slippageRate}`);
  }
  return { initialCash, commissionRate, slippageRate };
}

function requireFinite(value, what) {
  if (!Number.isFinite(value)) fail(`${what} must be finite, got: ${value}`);
  return value;
}

/**
 * Account a CLOSED-BT1 execution result over its bars.
 *
 * Inputs: the same completed-bar record array the kernel ran on (closes
 * are the authoritative mark series, D7), the BT1 result (`executions`,
 * `openPosition`), and the three REQUIRED explicit parameters (§3 — no
 * silent defaults; a zero-cost run states its zeros).
 *
 * Returns the §5.9 structure: chronological `ledger` (one record per
 * fill, extending the execution with rawPrice/effectivePrice/quantity/
 * commission/cashBefore/cashAfter), `closedTradePnl` aligned with BT1's
 * closedTrades, `realizedPnlTotal`, `openPositionAccounting` (quantity,
 * entryCost, markPrice, markedValue, unrealizedPnl) or null, one
 * `equitySeries` sample per bar, `initialCash`/`finalCash`/`finalEquity`,
 * and the echoed `assumptions`. For N = 0: empty series and
 * finalCash = finalEquity = initialCash (§5.1).
 */
export function accountBacktest(bars, execution, params) {
  const { initialCash, commissionRate, slippageRate } = requireParams(params);
  if (!Array.isArray(bars)) fail(`bars must be an array of OHLCV records, got: ${bars}`);
  if (execution === null || typeof execution !== 'object' || !Array.isArray(execution.executions)) {
    fail('execution must be a BT1 result with an executions array');
  }

  const ledger = [];
  const closedTradePnl = [];
  let cash = initialCash;
  let quantity = 0;
  let entryCashBefore = null;

  for (const fill of execution.executions) {
    const cashBefore = cash;
    const rawPrice = fill.fillPrice;
    if (fill.kind === 'entry') {
      const effectivePrice = rawPrice * (1 + slippageRate);
      if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
        fail(`computed entry effective price must be finite and > 0, got: ${effectivePrice}`);
      }
      const denominator = effectivePrice * (1 + commissionRate);
      if (!Number.isFinite(denominator)) {
        fail(`computed entry denominator must be finite, got: ${denominator}`);
      }
      quantity = cashBefore / denominator;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        fail(`computed entry quantity must be finite and > 0, got: ${quantity}`);
      }
      const commission = requireFinite(quantity * effectivePrice * commissionRate, 'computed entry commission');
      cash = 0; // D1 operative rule: the all-in entry deploys the entire balance by definition
      entryCashBefore = cashBefore;
      ledger.push({
        kind: fill.kind, signalIndex: fill.signalIndex, fillIndex: fill.fillIndex,
        rawPrice, effectivePrice, quantity, commission, cashBefore, cashAfter: cash,
      });
    } else {
      const effectivePrice = rawPrice * (1 - slippageRate);
      if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
        fail(`computed exit effective price must be finite and > 0, got: ${effectivePrice}`);
      }
      const proceeds = requireFinite(quantity * effectivePrice, 'computed exit proceeds');
      const commission = requireFinite(quantity * effectivePrice * commissionRate, 'computed exit commission');
      const net = proceeds - commission;
      if (!Number.isFinite(net) || net <= 0) {
        fail(`computed exit net proceeds must be finite and > 0, got: ${net}`);
      }
      cash = requireFinite(cashBefore + net, 'computed exit cashAfter');
      ledger.push({
        kind: fill.kind, signalIndex: fill.signalIndex, fillIndex: fill.fillIndex,
        rawPrice, effectivePrice, quantity, commission, cashBefore, cashAfter: cash,
      });
      closedTradePnl.push({ realizedPnl: requireFinite(cash - entryCashBefore, 'computed realizedPnl') });
      quantity = 0;
      entryCashBefore = null;
    }
  }

  let realizedPnlTotal = 0;
  for (const trade of closedTradePnl) realizedPnlTotal += trade.realizedPnl;
  requireFinite(realizedPnlTotal, 'computed realizedPnlTotal');

  let openPositionAccounting = null;
  if (execution.openPosition) {
    const markPrice = bars[bars.length - 1].close;
    const markedValue = requireFinite(quantity * markPrice, 'computed markedValue');
    openPositionAccounting = {
      quantity,
      entryCost: entryCashBefore, // §5.5 operative: exactly the cash the entry consumed
      markPrice,
      markedValue,
      unrealizedPnl: requireFinite(markedValue - entryCashBefore, 'computed unrealizedPnl'),
    };
  }

  // §5.6 equity series: state as of completion of bar t — a fill at bar t's
  // open is already reflected in bar t's sample (D5), marked at the raw close.
  const equitySeries = [];
  let equityCash = initialCash;
  let equityQuantity = 0;
  let nextFill = 0;
  for (let t = 0; t < bars.length; t++) {
    while (nextFill < ledger.length && ledger[nextFill].fillIndex === t) {
      equityCash = ledger[nextFill].cashAfter;
      equityQuantity = ledger[nextFill].kind === 'entry' ? ledger[nextFill].quantity : 0;
      nextFill++;
    }
    const sample = equityQuantity > 0 ? equityCash + equityQuantity * bars[t].close : equityCash;
    equitySeries.push(requireFinite(sample, `computed equity sample at bar ${t}`));
  }

  return {
    ledger,
    realizedPnlTotal,
    closedTradePnl,
    openPositionAccounting,
    equitySeries,
    initialCash,
    finalCash: cash,
    finalEquity: equitySeries.length ? equitySeries[equitySeries.length - 1] : initialCash,
    assumptions: { initialCash, commissionRate, slippageRate },
  };
}
