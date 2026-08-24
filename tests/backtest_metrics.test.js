// BT3 — performance metrics layer, tested against the RATIFIED BT3 contract
// (docs/BT3-CONTRACT.md @ d2c60b3, merged 1abf261; D1–D8 owner-ruled
// 2026-08-24, adjudication record §1.5). Oracle discipline:
//
//   1. CONTRACT FIXTURES: MF0–MF13 below are transcribed verbatim from the
//      contract's §7 and composed through the REAL CLOSED BT1+BT2 chain
//      (§2 architecture: bars → BT1 → BT2 → metrics). Exact equality is
//      safe by the §7 precision doctrine (dyadic decimals as literals;
//      non-dyadic values as the same single quotient of the same two exact
//      operands). MF12 is the contract's one direct rule fixture (the D4
//      anchor is unobservable through the chain — BT2 §5.1); MF13 pins the
//      D7a whole-call typed error on a chain-reachable non-finite
//      totalReturn.
//   2. ADJUDICATED-RULE PINS: D3a winRate = wins/closedTrades (breakeven
//      lowers it; breakeven-only → measured 0; null only at zero closed
//      trades); D4 running peak seeded at initialCash; D5 three-way
//      structural reason tokens decided before any division; D7a R-FIN
//      typed errors per guarded stage; D2 copy-not-re-sum pinned with an
//      identity-inconsistent input (§3: the layer validates shape, never
//      reconciles — so a re-summing implementation is caught by value).
//   3. INPUT CONTRACT (§3): boundary-shaped typed errors for every
//      consumed field; no semantic re-verification of the accounting.
//   4. PROJECTION DISCIPLINE (§2.1/§2.2): a recording proxy asserts the
//      implementation reads ONLY the normative consumed-field allowlist —
//      ledger, finalCash, assumptions and the non-consumed open-position
//      fields are present and must never be touched; deep-frozen inputs
//      prove zero mutation.
//   5. STATIC INVARIANTS: the metrics module imports NOTHING and holds no
//      capability/nondeterminism token; no comparator/tolerance machinery
//      (numeric-literal whitelist {0, 1}); every guard stage present by
//      name; the CLOSED BT2 accounting layer is sha256-pinned (§2), as
//      BT2's tests pin BT1 and BT1's pin A1; zero product wiring before
//      BT5.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { donchianBreakoutBacktest } from '../src/analytics/backtest.js';
import { accountBacktest } from '../src/analytics/accounting.js';
import { computeBacktestMetrics } from '../src/analytics/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));

const B = ([open, high, low, close]) => ({ open, high, low, close });
const bars = (rows) => rows.map(B);
const flat = (value, n) => Array.from({ length: n }, () => [value, value, value, value]);

const account = (rows, period, params) => {
  const b = bars(rows);
  return accountBacktest(b, donchianBreakoutBacktest(b, period), params);
};
const run = (rows, period, params) => computeBacktestMetrics(account(rows, period, params));

const ZERO_COST = (initialCash) => ({ initialCash, commissionRate: 0, slippageRate: 0 });
const IC = 'insufficient_closed_trades';
const ND = 'no_directional_closed_trades';
const NL = 'no_losses';

// A thrown value satisfies the contract's "typed error" only as a real
// Error carrying the module's typed prefix — a bare regex would also
// accept thrown strings or foreign objects (round-1 Sol RECORD).
const typedError = (pattern) => (err) => err instanceof Error
  && err.message.startsWith('computeBacktestMetrics: ')
  && pattern.test(err.message);

// The ratified execution fixtures the metrics layer projects over
// (BT0 §7 / BT2 §7 bases, transcribed verbatim — as in the BT2 oracle).
const F1 = [...flat(10, 3), [10, 12, 10, 11], [10, 12, 10, 10], [10, 11, 10, 10], [8, 8, 7, 7], [8, 9, 8, 9]];
const F4 = [...flat(10, 3), [10, 15, 10, 14]];
const F5 = [...flat(10, 3), [10, 15, 10, 14], [13, 16, 13, 15], [15, 16, 14, 15]];
const AF7B = [...flat(10, 2), [10, 12, 10, 11], [13, 13, 9, 10], [9, 10, 8, 9], [9, 15, 9, 14], [15, 16, 14, 15], [15, 15, 7, 8], [7, 9, 7, 8]];

// The BT3 contract's new traces (§7, transcribed verbatim).
const WT1 = [...flat(16, 3), [16, 17, 16, 17], [16, 22, 16, 21], [21, 23, 20, 22], [22, 24, 21, 24], [23, 23, 20, 22], [22, 23, 18, 18], [18, 19, 17, 18]];
const WT2 = [...flat(16, 2), [16, 17, 16, 17], [16, 18, 16, 17], [17, 20, 17, 19], [19, 22, 18, 21], [21, 22, 15.75, 15.75], [22, 24, 21, 23], [22, 23, 20, 21], [21, 22, 19, 20], [19, 20, 18, 19]];
const WT3 = [...flat(16, 2), [16, 17, 16, 17], [16, 17, 16, 16], [17, 18, 15, 16], [16, 17, 15, 16]];
const WT4 = [...flat(16, 2), [16, 17, 16, 17], [16, 18, 16, 17], [17, 20, 17, 19], [19, 22, 18, 21], [21, 22, 15.75, 15.75], [22, 24, 21, 23], [22, 23, 20, 21], [21, 22, 19, 20], [22, 25, 21, 24], [22, 23, 20, 21], [21, 22, 18, 19], [19, 20, 18, 19]];
const WT5 = [...flat(16, 3), [16, 17, 16, 17], [16, 20, 16, 20], [20, 20, 16, 18], [18, 24, 16, 24], [24, 24, 16, 18], [18, 20, 16, 19]];
const WT5P = [...WT5.slice(0, 8), [18, 20, 16, 16.5]];

// ── 1. the contract fixtures (BT3 §7, verbatim; exact equality) ─────────────

describe('BT3 contract fixtures (binding oracle, transcribed verbatim)', () => {
  it('MF0 empty input (BT2 §5.1 definitions)', () => {
    assert.deepStrictEqual(run([], 3, ZERO_COST(1000)), {
      totalReturn: 0, realizedPnlTotal: 0, unrealizedPnl: 0, netPnl: 0,
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
      winRate: null, winRateReason: IC,
      maxDrawdown: 0, profitFactor: null, profitFactorReason: IC,
    });
  });

  it('MF1 no trades, flat equity (over AF6 / BT0 F4)', () => {
    assert.deepStrictEqual(run(F4, 3, { initialCash: 1000, commissionRate: 0.25, slippageRate: 0.25 }), {
      totalReturn: 0, realizedPnlTotal: 0, unrealizedPnl: 0, netPnl: 0,
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
      winRate: null, winRateReason: IC,
      maxDrawdown: 0, profitFactor: null, profitFactorReason: IC,
    });
  });

  it('MF2 one losing closed trade (over AF1 / BT0 F1)', () => {
    assert.deepStrictEqual(run(F1, 3, ZERO_COST(1000)), {
      totalReturn: -200 / 1000, realizedPnlTotal: -200, unrealizedPnl: 0, netPnl: -200,
      closedTrades: 1, winningTrades: 0, losingTrades: 1, breakevenTrades: 0,
      winRate: 0, winRateReason: null,
      maxDrawdown: 300 / 1000, profitFactor: 0, profitFactorReason: null,
    });
  });

  it('MF3 one winning closed trade (WT1): PF is a reasoned null, never Infinity', () => {
    assert.deepStrictEqual(run(WT1, 3, ZERO_COST(1600)), {
      totalReturn: 0.125, realizedPnlTotal: 200, unrealizedPnl: 0, netPnl: 200,
      closedTrades: 1, winningTrades: 1, losingTrades: 0, breakevenTrades: 0,
      winRate: 1, winRateReason: null,
      maxDrawdown: 0.25, profitFactor: null, profitFactorReason: NL,
    });
  });

  it('MF4 win + loss; drawdown with full recovery (WT2)', () => {
    assert.deepStrictEqual(run(WT2, 2, ZERO_COST(1600)), {
      totalReturn: 0.1875, realizedPnlTotal: 300, unrealizedPnl: 0, netPnl: 300,
      closedTrades: 2, winningTrades: 1, losingTrades: 1, breakevenTrades: 0,
      winRate: 0.5, winRateReason: null,
      maxDrawdown: 0.25, profitFactor: 2, profitFactorReason: null,
    });
  });

  it('MF5 breakeven-only (WT3): winRate is a measured 0, PF null is the ND token (D3a/D5)', () => {
    assert.deepStrictEqual(run(WT3, 2, ZERO_COST(1600)), {
      totalReturn: 0, realizedPnlTotal: 0, unrealizedPnl: 0, netPnl: 0,
      closedTrades: 1, winningTrades: 0, losingTrades: 0, breakevenTrades: 1,
      winRate: 0, winRateReason: null,
      maxDrawdown: 0, profitFactor: null, profitFactorReason: ND,
    });
  });

  it('MF6 win + loss + breakeven (WT4): the D3a ruling pin — winRate 1/3, not 0.5', () => {
    assert.deepStrictEqual(run(WT4, 2, ZERO_COST(1600)), {
      totalReturn: 0.1875, realizedPnlTotal: 300, unrealizedPnl: 0, netPnl: 300,
      closedTrades: 3, winningTrades: 1, losingTrades: 1, breakevenTrades: 1,
      winRate: 1 / 3, winRateReason: null,
      maxDrawdown: 0.25, profitFactor: 2, profitFactorReason: null,
    });
  });

  it('MF7 open at end; later higher peak, deeper drawdown (WT5) — no force-close', () => {
    assert.deepStrictEqual(run(WT5, 3, ZERO_COST(1600)), {
      totalReturn: 0.1875, realizedPnlTotal: 0, unrealizedPnl: 300, netPnl: 300,
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
      winRate: null, winRateReason: IC,
      maxDrawdown: 0.25, profitFactor: null, profitFactorReason: IC,
    });
  });

  it('MF8 same closed trades, different terminal mark (WT5′): only mark-dependent metrics move', () => {
    assert.deepStrictEqual(run(WT5P, 3, ZERO_COST(1600)), {
      totalReturn: 0.03125, realizedPnlTotal: 0, unrealizedPnl: 50, netPnl: 50,
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
      winRate: null, winRateReason: IC,
      maxDrawdown: 0.3125, profitFactor: null, profitFactorReason: IC,
    });
  });

  it('MF9 costs: the entry bar itself drives drawdown (over AF2)', () => {
    assert.deepStrictEqual(run(F1, 3, { initialCash: 1562.5, commissionRate: 0.25, slippageRate: 0.25 }), {
      totalReturn: -1112.5 / 1562.5, realizedPnlTotal: -1112.5, unrealizedPnl: 0, netPnl: -1112.5,
      closedTrades: 1, winningTrades: 0, losingTrades: 1, breakevenTrades: 0,
      winRate: 0, winRateReason: null,
      maxDrawdown: 1112.5 / 1562.5, profitFactor: 0, profitFactorReason: null,
    });
  });

  it('MF10 two compounding losses (over AF7): multi-trade gross-loss accumulation, PF 0', () => {
    assert.deepStrictEqual(run(AF7B, 2, ZERO_COST(1300)), {
      totalReturn: -880 / 1300, realizedPnlTotal: -880, unrealizedPnl: 0, netPnl: -880,
      closedTrades: 2, winningTrades: 0, losingTrades: 2, breakevenTrades: 0,
      winRate: 0, winRateReason: null,
      maxDrawdown: 880 / 1300, profitFactor: 0, profitFactorReason: null,
    });
  });

  it('MF11 monotone-up equity, open at end (over AF5): zero drawdown', () => {
    assert.deepStrictEqual(run(F5, 3, ZERO_COST(1300)), {
      totalReturn: 200 / 1300, realizedPnlTotal: 0, unrealizedPnl: 200, netPnl: 200,
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
      winRate: null, winRateReason: IC,
      maxDrawdown: 0, profitFactor: null, profitFactorReason: IC,
    });
  });

  it('MF12 D4 anchor (direct rule fixture): initialCash is the time-zero running peak', () => {
    // Identity-consistent BT2-shaped input; unreachable through the chain
    // (BT2 §5.1: chain output always has equitySeries[0] = initialCash), so
    // the anchor is pinned at the metrics boundary. An unseeded fold reads 0.
    assert.deepStrictEqual(computeBacktestMetrics({
      initialCash: 1600, finalEquity: 1600, realizedPnlTotal: 0,
      closedTradePnl: [], openPositionAccounting: null,
      equitySeries: [1200, 1600],
    }), {
      totalReturn: 0, realizedPnlTotal: 0, unrealizedPnl: 0, netPnl: 0,
      closedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
      winRate: null, winRateReason: IC,
      maxDrawdown: 0.25, profitFactor: null, profitFactorReason: IC,
    });
  });

  it('MF13 D7a (chain trace WT6): valid finite BT2 inputs, non-finite totalReturn → whole-call typed error', () => {
    const a = 2 ** -1000;
    const b = 2 ** 100;
    const WT6 = [...flat(a, 3), [a, 2 * a, a, a], [a, 2 * a, a, a], [a, a, a / 2, a], [b, b, b, b]];
    const acc = account(WT6, 3, ZERO_COST(a));
    // The BT2 layer itself is finite and guard-clean on this trace.
    assert.deepStrictEqual(acc.closedTradePnl, [{ realizedPnl: b }]);
    assert.equal(acc.finalEquity, b);
    assert.equal(b - a, b, 'fl(b − a) = b (half-ULP argument, §7)');
    assert.throws(
      () => computeBacktestMetrics(acc),
      (err) => err instanceof Error
        && err.message.includes('computeBacktestMetrics:')
        && err.message.includes('totalReturn')
        && err.message.includes('non_finite_result'),
      'the D7a typed error names the metric and the non_finite_result stage',
    );
  });
});

// ── 2. adjudicated-rule pins beyond the contract fixtures ───────────────────

describe('adjudicated-rule pins (direct BT2-shaped inputs)', () => {
  // A §3-valid direct input builder: identity-consistent unless a test
  // deliberately breaks it (the layer never reconciles — §3).
  const direct = (over) => ({
    initialCash: 1600, finalEquity: 1600, realizedPnlTotal: 0,
    closedTradePnl: [], openPositionAccounting: null, equitySeries: [],
    ...over,
  });

  it('multi-win gross-profit accumulation: PF sums every winning trade', () => {
    const m = computeBacktestMetrics(direct({
      finalEquity: 2000, realizedPnlTotal: 400,
      closedTradePnl: [{ realizedPnl: 300 }, { realizedPnl: 200 }, { realizedPnl: -100 }],
      equitySeries: [1600, 2000],
    }));
    assert.equal(m.profitFactor, 5); // (300 + 200) / 100
    assert.equal(m.winRate, 2 / 3);
    assert.equal(m.winningTrades, 2);
    assert.equal(m.losingTrades, 1);
    assert.equal(m.breakevenTrades, 0);
  });

  it('D3a: a breakeven trade lowers the plain winRate (denominator = closedTrades)', () => {
    const m = computeBacktestMetrics(direct({
      finalEquity: 1700, realizedPnlTotal: 100,
      closedTradePnl: [{ realizedPnl: 100 }, { realizedPnl: 0 }],
      equitySeries: [1600, 1700],
    }));
    // The rejected directional denominator would read 1.
    assert.equal(m.winRate, 0.5);
    assert.equal(m.winRateReason, null);
  });

  it('D4: the anchor composes with a later running-peak reset', () => {
    const m = computeBacktestMetrics(direct({
      finalEquity: 1400, realizedPnlTotal: -200,
      closedTradePnl: [{ realizedPnl: -200 }],
      equitySeries: [1200, 2000, 1400],
    }));
    // dd vs anchor: 400/1600 = 0.25; dd vs the later peak: 600/2000 = 0.3.
    assert.equal(m.maxDrawdown, 0.3);
  });

  it('D2 copy-not-re-sum: realizedPnlTotal is the authoritative BT2 field, never re-derived', () => {
    // Deliberately identity-inconsistent (§3: the layer validates shape,
    // never reconciles): a re-summing implementation would return 1 here.
    const m = computeBacktestMetrics(direct({
      finalEquity: 2599, realizedPnlTotal: 999,
      closedTradePnl: [{ realizedPnl: 1 }],
      equitySeries: [1600, 2599],
    }));
    assert.equal(m.realizedPnlTotal, 999);
    assert.equal(m.netPnl, 999);
  });

  it('unrealizedPnl is copied from the authoritative field, never recomputed from the mark', () => {
    // markedValue − entryCost = 8 ≠ 42: a recomputing implementation fails.
    const m = computeBacktestMetrics(direct({
      finalEquity: 1642, realizedPnlTotal: 0,
      openPositionAccounting: { quantity: 1, entryCost: 1, markPrice: 9, markedValue: 9, unrealizedPnl: 42 },
      equitySeries: [1600, 1642],
    }));
    assert.equal(m.unrealizedPnl, 42);
    assert.equal(m.netPnl, 42);
  });

  it('D7a R-FIN: non-finite netPnl from finite fields → typed error naming netPnl', () => {
    assert.throws(
      () => computeBacktestMetrics(direct({
        finalEquity: Number.MAX_VALUE, realizedPnlTotal: Number.MAX_VALUE,
        openPositionAccounting: { quantity: 1, entryCost: 1, markPrice: 1, markedValue: 1, unrealizedPnl: Number.MAX_VALUE },
        equitySeries: [1600, Number.MAX_VALUE],
      })),
      typedError(/netPnl non_finite_result/),
    );
  });

  it('D7a R-FIN: gross-profit sum overflow → typed error naming grossProfitTotal', () => {
    assert.throws(
      () => computeBacktestMetrics(direct({
        closedTradePnl: [
          { realizedPnl: Number.MAX_VALUE }, { realizedPnl: -1 }, { realizedPnl: Number.MAX_VALUE },
        ],
      })),
      typedError(/grossProfitTotal non_finite_result/),
    );
  });

  it('D7a R-FIN: profit-factor quotient overflow → typed error naming profitFactor', () => {
    assert.throws(
      () => computeBacktestMetrics(direct({
        closedTradePnl: [{ realizedPnl: Number.MAX_VALUE }, { realizedPnl: -Number.MIN_VALUE }],
      })),
      typedError(/profitFactor non_finite_result/),
    );
  });

  it('D7a R-FIN: drawdown overflow on a §3-valid pathological series → typed error naming maxDrawdown', () => {
    // totalReturn and netPnl stay finite here — the fault is isolated to
    // the drawdown subtraction (peak − equity spans 2·MAX_VALUE).
    assert.throws(
      () => computeBacktestMetrics(direct({
        initialCash: 1, finalEquity: -Number.MAX_VALUE,
        equitySeries: [Number.MAX_VALUE, -Number.MAX_VALUE],
      })),
      typedError(/maxDrawdown non_finite_result/),
    );
  });
});

// ── 3. input contract (§3) — boundary-shaped typed errors ───────────────────

describe('input contract (§3): typed errors, no reconciliation', () => {
  const valid = () => ({
    initialCash: 1000, finalEquity: 1000, realizedPnlTotal: 0,
    closedTradePnl: [], openPositionAccounting: null, equitySeries: [1000],
  });
  const throws = (mutate, pattern) => {
    const input = valid();
    mutate(input);
    assert.throws(() => computeBacktestMetrics(input), typedError(pattern));
  };

  it('rejects a non-object argument', () => {
    for (const bad of [null, undefined, 42, 'accounting']) {
      assert.throws(() => computeBacktestMetrics(bad), typedError(/accounting must be/));
    }
  });

  it('initialCash: finite number > 0 (the BT2 domain restated, not a new domain)', () => {
    for (const bad of [undefined, '1000', NaN, Infinity, 0, -1]) {
      throws((x) => { x.initialCash = bad; }, /computeBacktestMetrics: initialCash/);
    }
  });

  it('finalEquity and realizedPnlTotal: finite numbers', () => {
    throws((x) => { x.finalEquity = NaN; }, /computeBacktestMetrics: finalEquity/);
    throws((x) => { delete x.finalEquity; }, /computeBacktestMetrics: finalEquity/);
    throws((x) => { x.realizedPnlTotal = -Infinity; }, /computeBacktestMetrics: realizedPnlTotal/);
    throws((x) => { x.realizedPnlTotal = '0'; }, /computeBacktestMetrics: realizedPnlTotal/);
  });

  it('closedTradePnl: an array of objects with finite realizedPnl', () => {
    throws((x) => { x.closedTradePnl = 'none'; }, /computeBacktestMetrics: closedTradePnl/);
    throws((x) => { x.closedTradePnl = [null]; }, /computeBacktestMetrics: closedTradePnl/);
    throws((x) => { x.closedTradePnl = [{}]; }, /computeBacktestMetrics: closedTradePnl/);
    throws((x) => { x.closedTradePnl = [{ realizedPnl: NaN }]; }, /computeBacktestMetrics: closedTradePnl/);
    // NaN must be rejected loudly — a sign-classification of NaN would
    // silently read as breakeven (both comparisons false), the exact silent
    // wrong value the contract forbids.
  });

  it('openPositionAccounting: null or an object with finite unrealizedPnl', () => {
    throws((x) => { delete x.openPositionAccounting; }, /computeBacktestMetrics: openPositionAccounting/);
    throws((x) => { x.openPositionAccounting = 5; }, /computeBacktestMetrics: openPositionAccounting/);
    throws((x) => { x.openPositionAccounting = {}; }, /computeBacktestMetrics: openPositionAccounting/);
    throws((x) => { x.openPositionAccounting = { unrealizedPnl: Infinity }; }, /computeBacktestMetrics: openPositionAccounting/);
  });

  it('equitySeries: an array of finite numbers', () => {
    throws((x) => { x.equitySeries = 1000; }, /computeBacktestMetrics: equitySeries/);
    throws((x) => { x.equitySeries = [1000, NaN]; }, /computeBacktestMetrics: equitySeries/);
    throws((x) => { x.equitySeries = [1000, '1000']; }, /computeBacktestMetrics: equitySeries/);
  });

  it('performs no reconciliation: an identity-inconsistent but well-shaped input computes', () => {
    // §3: master-identity checking belongs to the CLOSED BT2 layer and the
    // verification side, never this module.
    const m = computeBacktestMetrics({
      initialCash: 100, finalEquity: 500, realizedPnlTotal: 7,
      closedTradePnl: [], openPositionAccounting: null, equitySeries: [100, 500],
    });
    assert.equal(m.totalReturn, 4); // (500 − 100) / 100
    assert.equal(m.netPnl, 7);
  });
});

// ── 4. projection discipline (§2.1/§2.2) ────────────────────────────────────

describe('projection discipline: allowlist, immutability, statelessness', () => {
  it('reads ONLY the §2.2 consumed-field allowlist (recording proxy)', () => {
    const acc = account(WT5, 3, ZERO_COST(1600)); // has an open position
    const topReads = new Set();
    const openReads = new Set();
    const tradeReads = new Set();
    const wrapOpen = new Proxy(acc.openPositionAccounting, {
      get(target, prop) {
        if (typeof prop === 'string') openReads.add(prop);
        return target[prop];
      },
    });
    const wrapTrade = (trade) => new Proxy(trade, {
      get(target, prop) {
        if (typeof prop === 'string') tradeReads.add(prop);
        return target[prop];
      },
    });
    // A closed trade to exercise element reads alongside the open position.
    const closedTradePnl = [{ realizedPnl: 5 }].map(wrapTrade);
    const proxied = new Proxy({ ...acc, closedTradePnl }, {
      get(target, prop) {
        if (typeof prop === 'string') topReads.add(prop);
        return prop === 'openPositionAccounting' ? wrapOpen : target[prop];
      },
    });
    computeBacktestMetrics(proxied);
    const ALLOWED = ['closedTradePnl', 'equitySeries', 'finalEquity', 'initialCash', 'openPositionAccounting', 'realizedPnlTotal'];
    assert.deepStrictEqual([...topReads].sort(), ALLOWED, 'top-level reads are exactly the allowlist');
    assert.deepStrictEqual([...openReads], ['unrealizedPnl'], 'open-position reads are exactly unrealizedPnl');
    assert.deepStrictEqual([...tradeReads], ['realizedPnl'], 'closed-trade reads are exactly realizedPnl');
  });

  it('computes without ledger, finalCash, or assumptions present at all', () => {
    // The unconsumed fields are not merely unread — nothing depends on
    // their existence (§2.2: not consumed, not validated).
    const m = computeBacktestMetrics({
      initialCash: 1000, finalEquity: 1000, realizedPnlTotal: 0,
      closedTradePnl: [], openPositionAccounting: null, equitySeries: [1000],
    });
    assert.equal(m.totalReturn, 0);
  });

  it('mutates nothing: deep-frozen input, byte-identical result on a re-run', () => {
    const acc = account(WT2, 2, ZERO_COST(1600));
    acc.ledger.forEach(Object.freeze);
    Object.freeze(acc.ledger);
    acc.closedTradePnl.forEach(Object.freeze);
    Object.freeze(acc.closedTradePnl);
    Object.freeze(acc.equitySeries);
    Object.freeze(acc.assumptions);
    if (acc.openPositionAccounting) Object.freeze(acc.openPositionAccounting);
    Object.freeze(acc);
    const first = computeBacktestMetrics(acc);
    assert.deepStrictEqual(computeBacktestMetrics(acc), first, 'deterministic on a frozen input');
    assert.equal(first.winRate, 0.5);
  });

  it('the exported function carries no persistent state', () => {
    assert.deepStrictEqual(Object.keys(computeBacktestMetrics), []);
  });
});

// ── 5. result shape and structural invariants (§5.1) ────────────────────────

describe('result shape (§5.1): flat 13 fields, reason ⟺ null', () => {
  const FIELDS = [
    'totalReturn', 'realizedPnlTotal', 'unrealizedPnl', 'netPnl',
    'closedTrades', 'winningTrades', 'losingTrades', 'breakevenTrades',
    'winRate', 'winRateReason', 'maxDrawdown', 'profitFactor', 'profitFactorReason',
  ];
  const CASES = [
    ['MF0', [], 3, ZERO_COST(1000)],
    ['MF2', F1, 3, ZERO_COST(1000)],
    ['MF3', WT1, 3, ZERO_COST(1600)],
    ['MF5', WT3, 2, ZERO_COST(1600)],
    ['MF6', WT4, 2, ZERO_COST(1600)],
    ['MF7', WT5, 3, ZERO_COST(1600)],
  ];
  it('every fixture result carries exactly the 13 contract fields, invariants intact', () => {
    for (const [name, rows, period, params] of CASES) {
      const m = run(rows, period, params);
      assert.deepStrictEqual(Object.keys(m), FIELDS, `${name}: field set and order`);
      assert.equal(m.closedTrades, m.winningTrades + m.losingTrades + m.breakevenTrades, `${name}: count identity`);
      assert.equal(m.winRateReason !== null, m.winRate === null, `${name}: winRate reason ⟺ null`);
      assert.equal(m.profitFactorReason !== null, m.profitFactor === null, `${name}: profitFactor reason ⟺ null`);
      for (const field of FIELDS) {
        const value = m[field];
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${name}.${field} finite`);
      }
      for (const count of ['closedTrades', 'winningTrades', 'losingTrades', 'breakevenTrades']) {
        assert.ok(Number.isInteger(m[count]) && m[count] >= 0, `${name}.${count} integer ≥ 0`);
      }
      if (m.winRate !== null) assert.ok(m.winRate >= 0 && m.winRate <= 1, `${name}: winRate in [0,1]`);
      assert.ok(m.maxDrawdown >= 0, `${name}: maxDrawdown ≥ 0`);
      if (m.profitFactor !== null) assert.ok(m.profitFactor >= 0, `${name}: profitFactor ≥ 0`);
    }
  });
});

// ── 6. static invariants — purity, isolation, BT2 immutability ──────────────

describe('metrics invariants', () => {
  const src = readFileSync(join(here, '../src/analytics/metrics.js'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  function stripFunctionBodies(text) {
    let out = '';
    let depth = 0;
    for (const ch of text) {
      if (ch === '{') { depth += 1; continue; }
      if (ch === '}') { depth -= 1; continue; }
      if (depth === 0) out += ch;
    }
    return out;
  }

  it('imports nothing at all and exports exactly the projection (pure module)', () => {
    assert.ok(!/\bimport\b/.test(code), 'no import token anywhere in code');
    assert.ok(!/\bfrom\b/.test(code), 'no re-export/from clause of any kind');
    assert.equal([...code.matchAll(/\bexport\b/g)].length, 1, 'exactly one export statement');
    assert.ok(code.includes('export function computeBacktestMetrics('), 'the export is the projection function');
  });

  it('reaches for no capability, I/O, or nondeterminism source, and holds no module state', () => {
    const BANNED = [
      /\bprocess\b/, /\bperformance\b/, /\bglobalThis\b/, /\bglobal\b/, /\bcrypto\b/,
      /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bchild_process\b/,
      /\beval\b/, /\bFunction\b/, /\bDate\b/, /\bMath\.random\b/,
      /\bsetTimeout\b/, /\bsetInterval\b/, /\bsetImmediate\b/, /\brequire\b/,
      /node:/, /\bfs\b/, /\bconsole\b/,
    ];
    for (const banned of BANNED) {
      assert.ok(!banned.test(code), `no ${banned}`);
    }
    for (const line of src.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      for (const banned of BANNED) {
        assert.ok(!banned.test(line), `raw-line scan: no ${banned} in: ${trimmed}`);
      }
      assert.ok(!/\b(import|from)\b/.test(line), `raw-line scan: no import/from in: ${trimmed}`);
      if (/\bexport\b/.test(line)) {
        assert.ok(trimmed.startsWith('export function computeBacktestMetrics('),
          `raw-line scan: only the sanctioned export line may say export: ${trimmed}`);
      }
    }
    assert.ok(!/^\s*(let|var)\s/m.test(stripFunctionBodies(code)), 'no module-scope let/var (any indentation)');
    assert.ok(!/^\s*const\s/m.test(stripFunctionBodies(code)), 'no module-scope const (state cannot hide in a const object)');
    assert.equal([...code.matchAll(/\bvar\s/g)].length, 0, 'no var at all');
    assert.equal([...code.matchAll(/\blet\s/g)].length, 11,
      'exactly the eleven sanctioned function-local lets (five classification accumulators, four nullable results, the drawdown maximum and its running peak)');
  });

  it('holds no comparator/tolerance machinery — verification lives in tests only (owner ruling, §5.7)', () => {
    for (const banned of ['1e-9', 'tolerance', 'epsilon', 'EPSILON', 'residual', 'Math.abs', 'Math.',
      'MIN_VALUE', 'MAX_VALUE']) {
      assert.ok(!code.includes(banned), `no ${banned} in product code`);
    }
    assert.ok(!/\d+e-\d+/.test(code), 'no small scientific-notation literal in product code');
    const literals = [...code.matchAll(/(?<![\w$.])(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/g)].map((m) => m[0]);
    for (const lit of literals) {
      assert.ok(lit === '0' || lit === '1', `numeric literal whitelist {0, 1}: found ${lit}`);
    }
  });

  it('operative-rule and guard source pins (contract-mandated)', () => {
    // The adjudicated formulas in their written IEEE evaluation order.
    assert.ok(code.includes('(finalEquity - initialCash) / initialCash'), 'the written totalReturn expression (D1)');
    assert.ok(code.includes('realizedPnlTotal + unrealizedPnl'), 'the written netPnl addition (D2)');
    assert.ok(code.includes('winningTrades / closedTrades'), 'the RULED D3a winRate denominator');
    assert.ok(!code.includes('winningTrades + losingTrades'), 'the rejected directional denominator appears nowhere');
    assert.ok(code.includes('grossProfitTotal / -grossLossTotal'), 'the written profit-factor quotient (D5)');
    assert.ok(code.includes('peak = initialCash'), 'the D4 time-zero anchor seed');
    assert.ok(code.includes('(peak - equity) / peak'), 'the written drawdown quotient (D4)');
    // R-FIN guard stages present by name (D7a).
    for (const stage of ['totalReturn', 'netPnl', 'grossProfitTotal', 'grossLossTotal', 'profitFactor', 'maxDrawdown']) {
      assert.ok(code.includes(`'${stage}'`), `R-FIN stage present: ${stage}`);
    }
    assert.ok(code.includes('non_finite_result'), 'the D7a reason spelling');
    // §3 validation stages present by name.
    for (const stage of ['initialCash', 'finalEquity', 'realizedPnlTotal', 'closedTradePnl', 'openPositionAccounting', 'equitySeries']) {
      assert.ok(code.includes(stage), `§3 validation names: ${stage}`);
    }
  });

  it('exactly ONE approved MCP wiring path reaches the metrics layer (BT5 gate, MIGRATED)', () => {
    // MIGRATED by the ratified BT5 contract (§9.2 D8a, ratified @ 35a31c52,
    // merged ab85e472). This gate's meaning changes from "must not reach MCP
    // at all" to "exactly one owner-approved wiring path exists" — strictly
    // stronger than deleting it, because the blast radius stays one path and
    // the path is now named and asserted to exist.
    //
    // Comments are STRIPPED before scanning, the same discipline the static
    // invariants above already use: a comment cannot wire anything, and
    // documentation that explains this very constraint must not trip it.
    const APPROVED = new Set(['../src/server.js', '../src/tools/backtest.js', '../src/core/backtest.js']);
    const strip = (t) => t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    const roots = ['../src/server.js', '../src/connection.js', '../src/wait.js'];
    for (const f of readdirSync(join(here, '../src/tools'))) roots.push(`../src/tools/${f}`);
    for (const f of readdirSync(join(here, '../src/core'))) {
      if (f.endsWith('.js')) roots.push(`../src/core/${f}`);
    }
    for (const rel of roots) {
      if (APPROVED.has(rel)) continue;
      const code = strip(readFileSync(join(here, rel), 'utf8'));
      assert.ok(!code.includes('metrics'), `${rel} is not on the approved BT5 path — one path only (D8a)`);
    }
    // The sanctioned wiring must EXIST: a registration that silently vanished
    // fails here too, so the gate cannot be satisfied by removing the feature.
    assert.match(readFileSync(join(here, '../src/server.js'), 'utf8'), /registerBacktestTools\(server\)/,
      'the one approved wiring path must be registered');
  });

  it('BT2 accounting layer is byte-identical to its CLOSED state (§2, owner-ratified)', () => {
    // "BT3's tests sha256-pin accounting.js exactly as BT2's tests pin
    // backtest.js" — a silent touch of accounting semantics from the
    // metrics workstream fails here by name.
    const bt2 = readFileSync(join(here, '../src/analytics/accounting.js'));
    assert.equal(
      createHash('sha256').update(bt2).digest('hex'),
      '79713e9f1727eeba92a704969363ad5d898bd7da889bb5299d4f02df1dc2224e',
      'src/analytics/accounting.js changed — BT2 is CLOSED; a change requires owner adjudication, then update this pin in the same reviewed commit',
    );
  });
});
