// BT2 — costs & equity accounting layer, tested against the RATIFIED BT2
// contract (docs/BT2-CONTRACT.md @ 04dc9fd, merged 7d0fb1f; D1–D7 all
// owner-approved 2026-08-23). Oracle discipline:
//
//   1. CONTRACT FIXTURES: AF1–AF7 below are transcribed verbatim from the
//      contract's §7 tables and composed through the REAL CLOSED BT1 kernel
//      (the §2 architecture: bars → BT1 → accounting). Exact equality is
//      safe on these fixtures by §5.10 (dyadic-exact, verified
//      value-by-value through four review rounds).
//   2. OWNER RED LIST: same-ledger/different-marks (the D7 counterexample),
//      slippage direction, fill-bar equity ordering, open-at-end raw-close
//      marking (including WITH costs — kills liquidation-marking mutants),
//      binary64 awkward values (the three review counterexamples under the
//      §5.7 normalized comparator), overflow/subnormal/domain failures,
//      exact ledger+costs+marks reconciliation (D7 operationalized).
//   3. OPERATIVE-RULE PINS on non-dyadic inputs: entry cashAfter === 0
//      exactly (D1 definitional — a subtraction implementation leaves an
//      IEEE residue), and realizedPnl === cashAfterExit − cashBeforeEntry
//      structurally (the price-form formula diverges on non-dyadic inputs).
//   4. STATIC INVARIANTS: the accounting module imports NOTHING and holds
//      no capability/nondeterminism token; the §5.7 comparator lives in
//      THIS test file only — tolerance machinery is banned from product
//      code (owner ruling: the comparator is a verification instrument,
//      never part of the accounting formulas); the CLOSED BT1 kernel is
//      sha256-pinned (D3); zero product wiring before BT5.
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { donchianBreakoutBacktest } from '../src/analytics/backtest.js';
import { accountBacktest } from '../src/analytics/accounting.js';

const here = dirname(fileURLToPath(import.meta.url));

const B = ([open, high, low, close]) => ({ open, high, low, close });
const bars = (rows) => rows.map(B);
const flat10 = [10, 10, 10, 10];

// The ratified BT0 execution fixtures the contract layers accounting over.
const F1 = [flat10, flat10, flat10, [10, 12, 10, 11], [10, 12, 10, 10], [10, 11, 10, 10], [8, 8, 7, 7], [8, 9, 8, 9]];
const F4 = [flat10, flat10, flat10, [10, 15, 10, 14]];
const F5 = [flat10, flat10, flat10, [10, 15, 10, 14], [13, 16, 13, 15], [15, 16, 14, 15]];
const AF7B = [flat10, flat10, [10, 12, 10, 11], [13, 13, 9, 10], [9, 10, 8, 9], [9, 15, 9, 14], [15, 16, 14, 15], [15, 15, 7, 8], [7, 9, 7, 8]];

const run = (rows, period, params) => {
  const b = bars(rows);
  return accountBacktest(b, donchianBreakoutBacktest(b, period), params);
};

const L = (kind, signalIndex, fillIndex, rawPrice, effectivePrice, quantity, commission, cashBefore, cashAfter) =>
  ({ kind, signalIndex, fillIndex, rawPrice, effectivePrice, quantity, commission, cashBefore, cashAfter });
const RESULT = (ledger, closedTradePnl, openPositionAccounting, equitySeries, params, finalCash) => ({
  ledger,
  realizedPnlTotal: closedTradePnl.reduce((a, t) => a + t.realizedPnl, 0),
  closedTradePnl,
  openPositionAccounting,
  equitySeries,
  initialCash: params.initialCash,
  finalCash,
  finalEquity: equitySeries.length ? equitySeries[equitySeries.length - 1] : params.initialCash,
  assumptions: { initialCash: params.initialCash, commissionRate: params.commissionRate, slippageRate: params.slippageRate },
});

// ── 1. the seven contract fixtures (BT2 §7, verbatim; exact equality) ───────

describe('BT2 contract fixtures (binding oracle, transcribed verbatim)', () => {
  it('AF1 zero-cost round trip (baseline)', () => {
    const p = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
    assert.deepStrictEqual(run(F1, 3, p), RESULT(
      [L('entry', 3, 4, 10, 10, 100, 0, 1000, 0), L('exit', 6, 7, 8, 8, 100, 0, 0, 800)],
      [{ realizedPnl: -200 }],
      null,
      [1000, 1000, 1000, 1000, 1000, 1000, 700, 800],
      p, 800,
    ));
  });

  it('AF2 both costs, dyadic', () => {
    const p = { initialCash: 1562.5, commissionRate: 0.25, slippageRate: 0.25 };
    assert.deepStrictEqual(run(F1, 3, p), RESULT(
      [L('entry', 3, 4, 10, 12.5, 100, 312.5, 1562.5, 0), L('exit', 6, 7, 8, 6, 100, 150, 0, 450)],
      [{ realizedPnl: -1112.5 }],
      null,
      [1562.5, 1562.5, 1562.5, 1562.5, 1000, 1000, 700, 450],
      p, 450,
    ));
  });

  it('AF3 commission only', () => {
    const p = { initialCash: 1250, commissionRate: 0.25, slippageRate: 0 };
    assert.deepStrictEqual(run(F1, 3, p), RESULT(
      [L('entry', 3, 4, 10, 10, 100, 250, 1250, 0), L('exit', 6, 7, 8, 8, 100, 200, 0, 600)],
      [{ realizedPnl: -650 }],
      null,
      [1250, 1250, 1250, 1250, 1000, 1000, 700, 600],
      p, 600,
    ));
  });

  it('AF4 slippage only — same totals as AF3, different ledger (deliberate)', () => {
    const p = { initialCash: 1250, commissionRate: 0, slippageRate: 0.25 };
    assert.deepStrictEqual(run(F1, 3, p), RESULT(
      [L('entry', 3, 4, 10, 12.5, 100, 0, 1250, 0), L('exit', 6, 7, 8, 6, 100, 0, 0, 600)],
      [{ realizedPnl: -650 }],
      null,
      [1250, 1250, 1250, 1250, 1000, 1000, 700, 600],
      p, 600,
    ));
  });

  it('AF5 open at end, unrealized (marked at raw close, D2)', () => {
    const p = { initialCash: 1300, commissionRate: 0, slippageRate: 0 };
    assert.deepStrictEqual(run(F5, 3, p), RESULT(
      [L('entry', 3, 4, 13, 13, 100, 0, 1300, 0)],
      [],
      { quantity: 100, entryCost: 1300, markPrice: 15, markedValue: 1500, unrealizedPnl: 200 },
      [1300, 1300, 1300, 1300, 1500, 1500],
      p, 0,
    ));
  });

  it('AF6 signal without fill has zero accounting effect', () => {
    const p = { initialCash: 1000, commissionRate: 0.25, slippageRate: 0.25 };
    assert.deepStrictEqual(run(F4, 3, p), RESULT(
      [], [], null, [1000, 1000, 1000, 1000], p, 1000,
    ));
  });

  it('AF7 compounding across two round trips (qty2 derives from trade-1 outcome)', () => {
    const p = { initialCash: 1300, commissionRate: 0, slippageRate: 0 };
    assert.deepStrictEqual(run(AF7B, 2, p), RESULT(
      [L('entry', 2, 3, 13, 13, 100, 0, 1300, 0), L('exit', 3, 4, 9, 9, 100, 0, 0, 900),
        L('entry', 5, 6, 15, 15, 60, 0, 900, 0), L('exit', 7, 8, 7, 7, 60, 0, 0, 420)],
      [{ realizedPnl: -400 }, { realizedPnl: -480 }],
      null,
      [1300, 1300, 1300, 1000, 900, 900, 900, 480, 420],
      p, 420,
    ));
  });

  it('BT0 F12 accounting: closed history intact alongside a terminal pending ENTRY (round-6)', () => {
    // F12 (ratified BT0 §7): entry s3→f4 @12, exit s4→f5 @9, pending entry
    // s5 unfillable. cash 1000, zero costs: qty = 1000/12; exit cash =
    // (1000/12)×9 = 750 exactly in binary64; equity[4] = (1000/12)×8 =
    // 666.6666666666666 (machine-verified before pinning). The pending
    // ENTRY has zero accounting effect and must not gate the fold (a
    // kind-conditional mutant was previously caught only incidentally, by
    // guard-3b's terminal signal).
    const F12 = [flat10, flat10, flat10, [10, 12, 10, 11], [12, 12, 7, 8], [9, 20, 8, 19]];
    const b = bars(F12);
    const ex = donchianBreakoutBacktest(b, 3);
    assert.deepStrictEqual(ex.pendingSignal, { kind: 'entry', signalIndex: 5, unfillable: true });
    const p = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
    assert.deepStrictEqual(accountBacktest(b, ex, p), RESULT(
      [L('entry', 3, 4, 12, 12, 1000 / 12, 0, 1000, 0), L('exit', 4, 5, 9, 9, 1000 / 12, 0, 0, 750)],
      [{ realizedPnl: -250 }],
      null,
      [1000, 1000, 1000, 1000, 666.6666666666666, 750],
      p, 750,
    ));
  });

  it('COSTED two round trips: costs recur at every fill, compounding through prior costs (round-7)', () => {
    // The fixture matrix had a structural hole: every costed case had at
    // most one trade, and every multi-trade case was zero-cost — so
    // phase-conditioned mutants (costs correct only for the FIRST trade)
    // survived. This valid p=1 trace (machine-verified against §5's rules)
    // closes the {costs × multi-trade} cell:
    //   trade 1: entry raw 8 → eff 10, denom 12.5, qty 100, comm 250;
    //            exit raw 24 → eff 18, proceeds 1800, comm 450, cash 1350;
    //            realized +100.
    //   trade 2: entry raw 12 → eff 15, denom 18.75, qty 72 (= 1350/18.75,
    //            compounded THROUGH trade-1 costs), comm 270;
    //            exit raw 20 → eff 15, proceeds 1080, comm 270, cash 810;
    //            realized −540. Total −440.
    const rows = [[10, 10, 10, 10], [10, 12, 10, 11], [8, 11, 7, 9], [24, 25, 23, 24], [12, 20, 10, 15], [20, 21, 19, 20]];
    const p = { initialCash: 1250, commissionRate: 0.25, slippageRate: 0.25 };
    assert.deepStrictEqual(run(rows, 1, p), RESULT(
      [L('entry', 1, 2, 8, 10, 100, 250, 1250, 0), L('exit', 2, 3, 24, 18, 100, 450, 0, 1350),
        L('entry', 3, 4, 12, 15, 72, 270, 1350, 0), L('exit', 4, 5, 20, 15, 72, 270, 0, 810)],
      [{ realizedPnl: 100 }, { realizedPnl: -540 }],
      null,
      [1250, 1250, 900, 1350, 1080, 810],
      p, 810,
    ));
  });

  it('COSTED non-dyadic re-entry ending open: §5.5 cash forms hold after prior closed history (round-7)', () => {
    // Closes the {costs × non-dyadic × re-entry-open} cell: after a closed
    // trade, the re-entry's entryCost must still be the stored cashBefore
    // (0.6694214876033058 — the recomputed form gives …057) and unrealized
    // must still be the single subtraction (price form gives …5986). All
    // doubles machine-verified against the operative §5 rules.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [0.1, 1, 0.05, 0.1], [0.1, 2, 0.05, 0.1], [0.1, 0.2, 0.1, 0.1]];
    const a = run(rows, 1, { initialCash: 1, commissionRate: 0.1, slippageRate: 0.1 });
    assert.equal(a.ledger.length, 3);
    assert.equal(a.ledger[1].cashAfter, 0.6694214876033058);
    assert.equal(a.ledger[2].effectivePrice, 0.11000000000000001);
    assert.equal(a.ledger[2].quantity, 5.532408988457071);
    assert.equal(a.ledger[2].commission, 0.06085649887302779);
    assert.deepStrictEqual(a.openPositionAccounting, {
      quantity: 5.532408988457071,
      entryCost: 0.6694214876033058,
      markPrice: 0.1,
      markedValue: 0.5532408988457072,
      unrealizedPnl: -0.11618058875759862,
    });
    assert.equal(a.openPositionAccounting.entryCost, a.ledger[2].cashBefore);
    assert.equal(a.openPositionAccounting.unrealizedPnl,
      a.openPositionAccounting.markedValue - a.openPositionAccounting.entryCost);
    assert.deepStrictEqual(a.equitySeries, [1, 1, 0.8264462809917354, 0.6694214876033058, 0.5532408988457072]);
  });

  it('N = 0 (empty input) is the defined §5.1 result', () => {
    const p = { initialCash: 1000, commissionRate: 0.25, slippageRate: 0.25 };
    assert.deepStrictEqual(run([], 3, p), RESULT([], [], null, [], p, 1000));
  });
});

// ── 2. owner RED-list scenarios beyond the contract fixtures ────────────────

describe('owner RED list', () => {
  it('D7 counterexample: same ledger, different marks → different equity', () => {
    // Two series identical except the final close (15 vs 16). BT1 ignores
    // closes, so the LEDGERS are identical — equity/unrealized must differ,
    // exactly as D7's mark-series basis dictates.
    const p = { initialCash: 1300, commissionRate: 0, slippageRate: 0 };
    const F5b = F5.map((r, i) => (i === 5 ? [15, 16, 14, 16] : r));
    const a = run(F5, 3, p);
    const b = run(F5b, 3, p);
    assert.deepStrictEqual(a.ledger, b.ledger);
    assert.equal(b.openPositionAccounting.markPrice, 16);
    assert.equal(b.openPositionAccounting.markedValue, 1600);
    assert.equal(b.openPositionAccounting.unrealizedPnl, 300);
    assert.equal(b.finalEquity, 1600);
    assert.equal(a.finalEquity, 1500);
  });

  it('open at end WITH costs: marked at RAW close — no hypothetical exit costs (D2)', () => {
    // F5 with r = s = 0.25 and cash chosen for exact arithmetic:
    //   entry raw 13 → eff 16.25; denominator 16.25×1.25 = 20.3125;
    //   qty = 2031.25/20.3125 = 100; commission = 100×16.25×0.25 = 406.25;
    //   cash := 0. Open at end: entryCost = 2031.25 (the cash consumed),
    //   markPrice 15 (RAW close), markedValue 1500, unrealized −531.25.
    //   equity[4] = 100×15 = 1500 (not effective-price- or
    //   liquidation-adjusted). Identity: 1500 = 2031.25 + 0 − 531.25.
    const p = { initialCash: 2031.25, commissionRate: 0.25, slippageRate: 0.25 };
    assert.deepStrictEqual(run(F5, 3, p), RESULT(
      [L('entry', 3, 4, 13, 16.25, 100, 406.25, 2031.25, 0)],
      [],
      { quantity: 100, entryCost: 2031.25, markPrice: 15, markedValue: 1500, unrealizedPnl: -531.25 },
      [2031.25, 2031.25, 2031.25, 2031.25, 1500, 1500],
      p, 0,
    ));
  });

  it('slippage direction: adverse on BOTH sides (buy up, sell down)', () => {
    const p = { initialCash: 1250, commissionRate: 0, slippageRate: 0.25 };
    const a = run(F1, 3, p);
    assert.equal(a.ledger[0].effectivePrice, 12.5, 'buy fills ABOVE raw (10 × 1.25)');
    assert.equal(a.ledger[1].effectivePrice, 6, 'sell fills BELOW raw (8 × 0.75)');
  });

  it('fill-bar equity ordering (D5): the fill bar\'s close sample reflects the fill', () => {
    // AF2's bar 4: pre-entry equity was 1562.5; the entry fills at bar 4's
    // open, so bar 4's sample is cash 0 + 100 × close 10 = 1000 — never a
    // stale "not yet entered" 1562.5 patched later.
    const p = { initialCash: 1562.5, commissionRate: 0.25, slippageRate: 0.25 };
    assert.equal(run(F1, 3, p).equitySeries[4], 1000);
  });

  it('operative D1 pin: entry cashAfter is EXACTLY 0 on non-dyadic inputs', () => {
    // r = 0.1 (non-dyadic): a subtraction implementation leaves an IEEE
    // residue (~8.7e-19-scale); the ratified operative rule assigns 0.
    const p = { initialCash: 100, commissionRate: 0.1, slippageRate: 0 };
    const a = run(F5, 3, p);
    assert.equal(a.ledger[0].cashAfter, 0);
    assert.equal(a.finalCash, 0);
  });

  it('operative D1 pin at HIGH magnitude: no tolerance snap can fake the zero', () => {
    // At initialCash 1e16 the subtraction residue is ~2 — far above any
    // plausible "snap small residues to zero" threshold (round-1 found
    // Math.abs(δ) < 1e-12 and < 1e-6 mutants that pass at small scale).
    // The definitional rule yields exactly 0 at every scale.
    const p = { initialCash: 1e16, commissionRate: 0.1, slippageRate: 0.03 };
    const a = run(F5, 3, p);
    assert.equal(a.ledger[0].cashAfter, 0);
    assert.equal(a.finalCash, 0);
  });

  it('sub-micro positive exit cash is preserved exactly — no threshold can snap it (round-2)', () => {
    // cash 1e-7, entry raw 1, exit raw 0.5 → qty 1e-7, exit cash 5e-8.
    // A "snap small values to zero" mutant with ANY decimal threshold
    // (round-2 found `net < 0.000001 ? 0 : …`) destroys this exact value.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [0.5, 1, 0.5, 1]];
    const a = run(rows, 1, { initialCash: 1e-7, commissionRate: 0, slippageRate: 0 });
    assert.equal(a.ledger[1].cashAfter, 5e-8);
    assert.equal(a.finalCash, 5e-8);
    assert.equal(a.finalEquity, 5e-8);
    assert.equal(a.closedTradePnl[0].realizedPnl, 5e-8 - 1e-7);
  });

  it('realizedPnlTotal accumulates in LEDGER order — three cancelling trades discriminate (round-2)', () => {
    // Valid p=1 trace with fills entry@1 → exit@1e16 → entry@1e16 → exit@1
    // → entry@1 → exit@2 (cash 1, zero costs). Trade P&Ls are
    // [1e16, −1e16, 1] (1e16 − 1 rounds to 1e16 at ULP 2). Ledger-order
    // summation gives (1e16 + −1e16) + 1 = 1; reverse-order gives
    // (1 + −1e16) + 1e16 = 0. AF7's two trades cannot discriminate this.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 2, 0.5, 1], [1e16, 2e16, 0.4, 1],
      [1e16, 1e16, 0.3, 1], [1, 3e16, 0.2, 1], [1, 3, 0.1, 1], [2, 2, 2, 2]];
    const a = run(rows, 1, { initialCash: 1, commissionRate: 0, slippageRate: 0 });
    assert.deepStrictEqual(a.closedTradePnl, [{ realizedPnl: 1e16 }, { realizedPnl: -1e16 }, { realizedPnl: 1 }]);
    assert.equal(a.realizedPnlTotal, 1);
    assert.equal(a.finalCash, 2);
  });

  it('entry effective price follows the WRITTEN order raw × (1 + s) — additive expansion differs by one ULP (round-3)', () => {
    // raw 0.1, s 0.2: written 0.1 × 1.2 = 0.12 exactly-as-rounded; the
    // additive expansion 0.1 + 0.1 × 0.2 = 0.12000000000000001. Quantity and
    // the marked equity diverge one ULP-step with them.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [0.1, 1, 0.1, 0.1]];
    const a = run(rows, 1, { initialCash: 1, commissionRate: 0, slippageRate: 0.2 });
    assert.equal(a.ledger[0].effectivePrice, 0.12);
    assert.equal(a.ledger[0].quantity, 8.333333333333334);
    assert.equal(a.finalEquity, 0.8333333333333335);
  });

  it('positive exit cash below 1e-9 is preserved exactly (round-3 leading-dot threshold)', () => {
    // cash 1e-10 → exit cash exactly 5e-11: any threshold at .000000001 or
    // above (the leading-dot literal that evaded the round-2 whitelist
    // regex) snaps this to zero.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [0.5, 1, 0.5, 1]];
    const a = run(rows, 1, { initialCash: 1e-10, commissionRate: 0, slippageRate: 0 });
    assert.equal(a.ledger[1].cashAfter, 5e-11);
    assert.equal(a.finalCash, 5e-11);
    assert.equal(a.closedTradePnl[0].realizedPnl, 5e-11 - 1e-10);
  });

  it('assumptions echo EXACTLY the three §5.9 fields — extra params properties are not echoed (round-3)', () => {
    const b = bars(F1);
    const a = accountBacktest(b, donchianBreakoutBacktest(b, 3),
      { initialCash: 1000, commissionRate: 0, slippageRate: 0, note: 'metadata that must not leak' });
    assert.deepStrictEqual(a.assumptions, { initialCash: 1000, commissionRate: 0, slippageRate: 0 });
  });

  it('re-entered open position uses CURRENT fold state, coexisting with a terminal pending exit (round-4)', () => {
    // BT0-valid p=1 trace: entry @10 → exit @8 → re-entry @12, ending with an
    // unfillable terminal exit signal AND an open position. Machine-verified
    // exact values: qty1 = 10, exit cash 80, qty2 = 80/12 = 6.666666666666667,
    // mark 9, markedValue = (80/12) × 9 = 60 exactly in binary64, unrealized
    // −20, equity [100, 100, 90, 80, 60]. Kills: stale-first-entry-quantity
    // mutants (ledger[0].quantity = 10 ≠ 6.66…) and mutants that suppress
    // openPositionAccounting whenever a pendingSignal exists.
    const rows = [[10, 10, 10, 10], [10, 12, 10, 11], [10, 11, 9, 9], [8, 13, 8, 11], [12, 12, 7, 9]];
    const b = bars(rows);
    const ex = donchianBreakoutBacktest(b, 1);
    assert.deepStrictEqual(ex.pendingSignal, { kind: 'exit', signalIndex: 4, unfillable: true });
    const p = { initialCash: 100, commissionRate: 0, slippageRate: 0 };
    assert.deepStrictEqual(accountBacktest(b, ex, p), RESULT(
      [L('entry', 1, 2, 10, 10, 10, 0, 100, 0), L('exit', 2, 3, 8, 8, 10, 0, 0, 80),
        L('entry', 3, 4, 12, 12, 80 / 12, 0, 80, 0)],
      [{ realizedPnl: -20 }],
      { quantity: 80 / 12, entryCost: 80, markPrice: 9, markedValue: 60, unrealizedPnl: -20 },
      [100, 100, 90, 80, 60],
      p, 0,
    ));
  });

  it('operative §5.5 pin: entryCost is EXACTLY cashBeforeEntry, never recomputed', () => {
    // Non-dyadic open position (F5, cash 1, r = s = 0.1): the forbidden
    // audit-form recomputation qty × eff × (1+r) yields 0.9999999999999999,
    // one ULP off the operative value, which is the stored cashBefore: 1.
    const p = { initialCash: 1, commissionRate: 0.1, slippageRate: 0.1 };
    const a = run(F5, 3, p);
    assert.equal(a.openPositionAccounting.entryCost, 1);
    assert.equal(a.openPositionAccounting.entryCost, a.ledger[0].cashBefore);
    assert.equal(a.openPositionAccounting.markPrice, 15);
    // Round-4: unrealizedPnl is the SINGLE subtraction markedValue − entryCost
    // — a price-form recomputation diverges by ~1e-16 on these non-dyadic
    // inputs and fails this exact structural identity.
    assert.equal(a.openPositionAccounting.unrealizedPnl,
      a.openPositionAccounting.markedValue - a.openPositionAccounting.entryCost);
  });

  it('operative §5.5 pin: realizedPnl is the cash form, structurally', () => {
    // Non-dyadic rates make the price-form formula diverge from the cash
    // form by rounding; the contract binds the cash form.
    const p = { initialCash: 100, commissionRate: 0.1, slippageRate: 0.03 };
    const a = run(F1, 3, p);
    assert.equal(a.closedTradePnl[0].realizedPnl, a.ledger[1].cashAfter - a.ledger[0].cashBefore);
  });

  it('exact reconciliation: every reported value regenerates from ledger + assumptions + marks (D7)', () => {
    for (const [rows, period, params] of [
      [F1, 3, { initialCash: 1562.5, commissionRate: 0.25, slippageRate: 0.25 }],
      [F5, 3, { initialCash: 2031.25, commissionRate: 0.25, slippageRate: 0.25 }],
      [AF7B, 2, { initialCash: 1300, commissionRate: 0, slippageRate: 0 }],
      [F1, 3, { initialCash: 100, commissionRate: 0.1, slippageRate: 0.03 }],
    ]) {
      const b = bars(rows);
      const a = accountBacktest(b, donchianBreakoutBacktest(b, period), params);
      // Rebuild the fold from {kind, rawPrice} + assumptions alone, then join
      // with the close marks — §5.7's reconstruction, implemented literally.
      let cash = params.initialCash;
      let qty = 0;
      let entryCashBefore = null;
      const rebuiltLedger = [];
      const rebuiltTrades = [];
      for (const e of a.ledger) {
        const cashBefore = cash;
        if (e.kind === 'entry') {
          const eff = e.rawPrice * (1 + params.slippageRate);
          const q = cashBefore / (eff * (1 + params.commissionRate));
          rebuiltLedger.push(L('entry', e.signalIndex, e.fillIndex, e.rawPrice, eff, q, q * eff * params.commissionRate, cashBefore, 0));
          cash = 0; qty = q; entryCashBefore = cashBefore;
        } else {
          const eff = e.rawPrice * (1 - params.slippageRate);
          const proceeds = qty * eff;
          const commission = qty * eff * params.commissionRate;
          cash = cashBefore + proceeds - commission;
          rebuiltLedger.push(L('exit', e.signalIndex, e.fillIndex, e.rawPrice, eff, qty, commission, cashBefore, cash));
          rebuiltTrades.push({ realizedPnl: cash - entryCashBefore });
          qty = 0; entryCashBefore = null;
        }
      }
      assert.deepStrictEqual(rebuiltLedger, a.ledger);
      assert.deepStrictEqual(rebuiltTrades, a.closedTradePnl);
      const equity = [];
      let c2 = params.initialCash, q2 = 0, li = 0;
      for (let t = 0; t < b.length; t++) {
        while (li < a.ledger.length && a.ledger[li].fillIndex === t) {
          c2 = a.ledger[li].cashAfter;
          q2 = a.ledger[li].kind === 'entry' ? a.ledger[li].quantity : 0;
          li++;
        }
        equity.push(c2 + (q2 > 0 ? q2 * b[t].close : 0));
      }
      assert.deepStrictEqual(equity, a.equitySeries);
    }
  });
});

// ── 3. binary64 awkward values under the §5.7 normalized comparator ─────────

describe('normalized comparator conformance (verification-side only)', () => {
  function normalizedResidual(a) {
    const unreal = a.openPositionAccounting ? a.openPositionAccounting.unrealizedPnl : 0;
    let S = Math.max(1, a.initialCash, Math.abs(a.finalEquity), Math.abs(a.realizedPnlTotal), Math.abs(unreal));
    for (const e of a.ledger) S = Math.max(S, e.cashBefore, Math.abs(e.cashAfter), e.quantity * e.effectivePrice);
    if (a.openPositionAccounting) S = Math.max(S, a.openPositionAccounting.entryCost, Math.abs(a.openPositionAccounting.markedValue));
    return Math.abs(a.finalEquity / S - (a.initialCash / S + a.realizedPnlTotal / S + unreal / S));
  }

  it('2^54 all-dyadic cancellation stays within the bound', () => {
    const rows = [[1, 1, 1, 1], [1, 2, Math.pow(2, -54), 1], [1, 1, Math.pow(2, -54), Math.pow(2, -54)]];
    const a = run(rows, 1, { initialCash: Math.pow(2, 54), commissionRate: 0, slippageRate: 0 });
    assert.ok(normalizedResidual(a) <= 1e-9);
  });

  it('1e16 cancellation stays within the bound', () => {
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [1e-16, 1e-16, 1e-16, 1e-16]];
    const a = run(rows, 1, { initialCash: 1e16, commissionRate: 0, slippageRate: 0 });
    assert.ok(normalizedResidual(a) <= 1e-9);
  });

  it('extreme-value conformance example: raw RHS overflows, normalized residual passes', () => {
    const M = Number.MAX_VALUE, A = M / 2, Bv = Math.pow(2, 969);
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1.5], [A, A, 0.5, 1], [Bv, Math.pow(2, 1023), Bv / 2, Bv], [Bv, M, Bv, M]];
    const a = run(rows, 1, { initialCash: A, commissionRate: 0, slippageRate: 0 });
    const unreal = a.openPositionAccounting.unrealizedPnl;
    assert.equal(a.initialCash + a.realizedPnlTotal + unreal, Infinity, 'the un-normalized sum overflows');
    assert.ok(normalizedResidual(a) <= 1e-9, 'the normalized form is total and passes');
  });
});

// ── 4. domain guards — typed, fail-loud, on computed intermediates ──────────

describe('parameter validation and domain guards', () => {
  const p0 = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
  // Round-1: assert.throws with a bare regex accepts thrown STRINGS; the
  // contract requires typed errors, so every rejection is checked with a
  // predicate demanding a real Error carrying the expected message.
  const typedError = (re) => (err) => err instanceof Error && re.test(err.message);

  it('rejects invalid parameters with typed errors', () => {
    for (const [patch, re] of [
      [{ initialCash: 0 }, /initialCash/], [{ initialCash: -5 }, /initialCash/],
      [{ initialCash: Infinity }, /initialCash/], [{ initialCash: '1000' }, /initialCash/],
      [{ initialCash: NaN }, /initialCash/],
      [{ commissionRate: '0' }, /commissionRate/], [{ slippageRate: '0' }, /slippageRate/],
      [{ commissionRate: -0.1 }, /commissionRate/], [{ commissionRate: 1 }, /commissionRate/],
      [{ commissionRate: 2 }, /commissionRate/], [{ commissionRate: NaN }, /commissionRate/],
      [{ slippageRate: -0.1 }, /slippageRate/], [{ slippageRate: 1 }, /slippageRate/],
      [{ slippageRate: NaN }, /slippageRate/],
    ]) {
      assert.throws(() => run(F1, 3, { ...p0, ...patch }), typedError(re));
    }
  });

  it('parameters are REQUIRED — missing params or fields fail loud, no silent defaults', () => {
    // Round-1: a destructuring-defaults mutant ({ initialCash = 1000, … })
    // silently accepted omissions; the owner rule is explicit parameters.
    const ex = donchianBreakoutBacktest(bars(F1), 3);
    assert.throws(() => accountBacktest(bars(F1), ex, undefined), typedError(/params/));
    assert.throws(() => accountBacktest(bars(F1), ex, null), typedError(/params/));
    assert.throws(() => accountBacktest(bars(F1), ex, {}), typedError(/initialCash/));
    assert.throws(() => accountBacktest(bars(F1), ex, { commissionRate: 0, slippageRate: 0 }), typedError(/initialCash/));
    assert.throws(() => accountBacktest(bars(F1), ex, { initialCash: 1000, slippageRate: 0 }), typedError(/commissionRate/));
    assert.throws(() => accountBacktest(bars(F1), ex, { initialCash: 1000, commissionRate: 0 }), typedError(/slippageRate/));
  });

  it('rejects non-array bars and malformed execution input', () => {
    assert.throws(() => accountBacktest(null, donchianBreakoutBacktest(bars(F1), 3), p0), typedError(/bars/));
    assert.throws(() => accountBacktest(bars(F1), null, p0), typedError(/execution/));
    assert.throws(() => accountBacktest(bars(F1), {}, p0), typedError(/execution/));
  });

  it('guard 1: computed effective price must be finite and strictly positive', () => {
    // raw 0 → effective 0 (entry side)
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [0, 3, 0, 1]];
    assert.throws(() => run(rows, 1, p0), typedError(/entry effective price/));
    // subnormal underflow on a sell: raw MIN_VALUE × (1−0.5) → 0
    const rows2 = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [Number.MIN_VALUE, 1, Number.MIN_VALUE, 1]];
    assert.throws(() => run(rows2, 1, { ...p0, slippageRate: 0.5 }), typedError(/exit effective price/));
  });

  it('guard 1b: entry effective-price OVERFLOW fails as the effective-price stage (round-4)', () => {
    // Finite raw MAX_VALUE with positive slippage overflows the COMPUTED
    // effective price to Infinity. A raw-price-only guard mutant lets this
    // fall through to the denominator stage (a different message).
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [Number.MAX_VALUE, Number.MAX_VALUE, 1, 1]];
    assert.throws(() => run(rows, 1, { initialCash: 1, commissionRate: 0, slippageRate: 0.5 }),
      typedError(/entry effective price/));
  });

  it('guard 2a: entry denominator overflow fails by its OWN name (not masked by a later guard)', () => {
    // Round-1: /denominator|quantity/ let a deleted denominator guard pass
    // (the quantity guard fired instead). Each guard stage is discriminated
    // by its exact message.
    const rowsBig = [[1, 1, 1, 1], [1, 2, 1, 1], [Number.MAX_VALUE, Number.MAX_VALUE, 1, 1]];
    assert.throws(() => run(rowsBig, 1, { initialCash: 1, commissionRate: 0.5, slippageRate: 0 }), typedError(/entry denominator/));
  });

  it('guard 2b: entry quantity underflow fails by its own name', () => {
    const rowsTiny = [[1, 1, 1, 1], [1, 2, 1, 1], [2, 3, 2, 2]];
    assert.throws(() => run(rowsTiny, 1, { initialCash: Number.MIN_VALUE, commissionRate: 0, slippageRate: 0 }), typedError(/entry quantity/));
  });

  it('guard 3: a zero exit net (commission rounds to proceeds) fails by its own name', () => {
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [Number.MIN_VALUE, 1, Number.MIN_VALUE, 1]];
    assert.throws(() => run(rows, 1, { initialCash: 1, commissionRate: 0.9999999999999999, slippageRate: 0 }), typedError(/exit net proceeds/));
  });

  it('guard 4a: a non-finite terminal mark fails as markedValue (not deferred to equity)', () => {
    // Open at end; markedValue = 1e300 × 1e10 overflows. The markedValue
    // guard runs BEFORE the equity loop — a deferred-validation mutant
    // would fail with the equity message instead.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 3, 1, 1e10]];
    assert.throws(() => run(rows, 1, { initialCash: 1e300, commissionRate: 0, slippageRate: 0 }), typedError(/markedValue/));
  });

  it('guard 4b: a non-finite mid-series equity sample fails as equity by bar index', () => {
    // Position enters at bar 2 whose close (1e10) overflows the sample while
    // the FINAL close (1) keeps markedValue finite — only the equity guard
    // can catch this one.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 3, 1, 1e10], [1, 1, 1, 1]];
    assert.throws(() => run(rows, 1, { initialCash: 1e300, commissionRate: 0, slippageRate: 0 }), typedError(/equity sample at bar 2/));
  });

  it('guard 2c: quantity overflow to Infinity fails as entry quantity, not a later stage (round-5)', () => {
    // cash MAX_VALUE with a MIN_VALUE entry price: the denominator passes
    // (finite), quantity = MAX/MIN = Infinity — a guard that only checks
    // quantity <= 0 lets this fall through to the commission stage.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [Number.MIN_VALUE, 1, Number.MIN_VALUE, 1]];
    assert.throws(() => run(rows, 1, { initialCash: Number.MAX_VALUE, commissionRate: 0, slippageRate: 0 }),
      typedError(/entry quantity/));
  });

  it('guard 2d: entry commission NaN (rounded-up product overflow × zero rate) fails by name (round-5)', () => {
    // q = MAX/1.5 is finite, but fl(q × 1.5) rounds UP to Infinity; with
    // r = 0 the commission is Infinity × 0 = NaN. The guard must check the
    // COMPUTED commission, not the quantity operand.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1.5, 2, 1, 1.5]];
    assert.throws(() => run(rows, 1, { initialCash: Number.MAX_VALUE, commissionRate: 0, slippageRate: 0 }),
      typedError(/entry commission/));
  });

  it('guard 2e: entry commission INFINITY (nonzero rate) fails by name — a NaN-only check misses it (round-6)', () => {
    // Same rounded-up product overflow as guard 2d, but with r = MIN_VALUE:
    // commission = Infinity × MIN_VALUE = Infinity (not NaN). A guard
    // weakened to Number.isNaN passes 2d yet misses this.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1.5, 2, 1, 1.5]];
    assert.throws(() => run(rows, 1, { initialCash: Number.MAX_VALUE, commissionRate: Number.MIN_VALUE, slippageRate: 0 }),
      typedError(/entry commission/));
  });

  it('smallest positive exit net (exactly MIN_VALUE) is preserved — identifier-epsilon mutants die (round-6)', () => {
    // cash 2×MIN_VALUE, entry @1 → qty 1e-323; exit @0.5 → net exactly
    // Number.MIN_VALUE (5e-324). A guard tightened to net <= MIN_VALUE
    // falsely rejects it; a snap-to-zero variant falsely zeroes it.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [0.5, 1, 0.5, 1]];
    const a = run(rows, 1, { initialCash: 2 * Number.MIN_VALUE, commissionRate: 0, slippageRate: 0 });
    assert.equal(a.ledger[1].cashAfter, Number.MIN_VALUE);
    assert.equal(a.finalCash, Number.MIN_VALUE);
    assert.equal(a.finalEquity, Number.MIN_VALUE);
    assert.equal(a.closedTradePnl[0].realizedPnl, Number.MIN_VALUE - 2 * Number.MIN_VALUE);
  });

  it('guard 3b: exit proceeds overflow fails as exit proceeds, not a later stage (round-5)', () => {
    // Quantity 2 exiting at raw MAX_VALUE: the effective price passes its
    // own guard, proceeds = 2 × MAX = Infinity — a guard that validates the
    // effective price instead of the product misses it.
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 0.5, 1], [Number.MAX_VALUE, Number.MAX_VALUE, 1, 1]];
    assert.throws(() => run(rows, 1, { initialCash: 2, commissionRate: 0, slippageRate: 0 }),
      typedError(/exit proceeds/));
  });

  it('tiny-but-representable accounts are NOT rejected (no arbitrary minimum)', () => {
    const rows = [[1, 1, 1, 1], [1, 2, 1, 1], [1, 1, 1, 1]];
    const a = run(rows, 1, { initialCash: Number.MIN_VALUE, commissionRate: 0, slippageRate: 0 });
    assert.equal(a.ledger[0].quantity, Number.MIN_VALUE);
  });
});

// ── 5. determinism and purity of behavior ───────────────────────────────────

describe('determinism', () => {
  const p = { initialCash: 1562.5, commissionRate: 0.25, slippageRate: 0.25 };
  it('identical input twice → deep-equal results', () => {
    assert.deepStrictEqual(run(F1, 3, p), run(F1, 3, p));
  });
  it('does not mutate its inputs (runs on a DEEP-frozen BT1 result — round-5)', () => {
    // Round-5: only executions were frozen, so mutants writing into
    // closedTrades / openPosition / pendingSignal survived. Freeze the
    // complete result graph; in strict-mode ESM any such write throws.
    const deepFreezeExecution = (ex) => {
      ex.executions.forEach(Object.freeze);
      Object.freeze(ex.executions);
      ex.closedTrades.forEach(Object.freeze);
      Object.freeze(ex.closedTrades);
      if (ex.openPosition) Object.freeze(ex.openPosition);
      if (ex.pendingSignal) Object.freeze(ex.pendingSignal);
      return Object.freeze(ex);
    };
    const b = Object.freeze(bars(F1).map((x) => Object.freeze(x)));
    const ex = deepFreezeExecution(donchianBreakoutBacktest(b, 3));
    const a = accountBacktest(b, ex, Object.freeze({ ...p }));
    assert.equal(a.finalCash, 450);
    // Open position + pending exit, deep-frozen too (the round-4 re-entry
    // trace) — mutants that write into openPosition die here.
    const rows = [[10, 10, 10, 10], [10, 12, 10, 11], [10, 11, 9, 9], [8, 13, 8, 11], [12, 12, 7, 9]];
    const b2 = Object.freeze(bars(rows).map((x) => Object.freeze(x)));
    const ex2 = deepFreezeExecution(donchianBreakoutBacktest(b2, 1));
    const a2 = accountBacktest(b2, ex2, Object.freeze({ initialCash: 100, commissionRate: 0, slippageRate: 0 }));
    assert.equal(a2.openPositionAccounting.markedValue, 60);
    // Round-5: the exported function itself must carry no persistent state —
    // a mutant stashing counters on accountBacktest adds an enumerable
    // own-property.
    assert.deepStrictEqual(Object.keys(accountBacktest), []);
  });
  it('extra record fields are ignored', () => {
    const withExtras = bars(F1).map((x, i) => ({ time: 1700000000 + i * 60, ...x, volume: 5 }));
    assert.deepStrictEqual(accountBacktest(withExtras, donchianBreakoutBacktest(withExtras, 3), p), run(F1, 3, p));
  });
});

// ── 6. static invariants — purity, isolation, BT1 immutability ──────────────

describe('accounting invariants', () => {
  const src = readFileSync(join(here, '../src/analytics/accounting.js'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  // Keep only brace-depth-0 text: what remains is the module scope, with
  // every function body (and the object literals inside them) stripped —
  // so a module-scope declaration cannot hide behind indentation.
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

  it('imports nothing at all and exports exactly the fold (pure module — round-5)', () => {
    assert.ok(!/\bimport\b/.test(code), 'no import token anywhere in code');
    // Round-5: `export * from "assert"` imports a module with no `import`
    // token. The only sanctioned export is the single function declaration;
    // `from` has no other legitimate use in this module.
    assert.ok(!/\bfrom\b/.test(code), 'no re-export/from clause of any kind');
    assert.equal([...code.matchAll(/\bexport\b/g)].length, 1, 'exactly one export statement');
    assert.ok(code.includes('export function accountBacktest('), 'the export is the fold function');
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
    // Round-2: a `void '//'; void process;` line abused the non-string-aware
    // comment stripper to hide capability code from the stripped-code scan.
    // Counter: scan the RAW source line-by-line too — only lines that ARE
    // comments (after trimming, starting with //, /* or *) are exempt, so a
    // banned token hidden behind a string-embedded '//' is still seen.
    // (Consequence: comments may not name banned tokens; the header speaks
    // of "clock"/"I/O" in plain words for exactly this reason.)
    for (const line of src.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      for (const banned of BANNED) {
        assert.ok(!banned.test(line), `raw-line scan: no ${banned} in: ${trimmed}`);
      }
      // Round-6 (advisory closed): module-graph tokens scanned on RAW
      // non-comment lines too, so a string-embedded '//' cannot hide an
      // import/re-export from the stripped-code gate. The single sanctioned
      // export line is the only line allowed to carry 'export'.
      assert.ok(!/\b(import|from)\b/.test(line), `raw-line scan: no import/from in: ${trimmed}`);
      if (/\bexport\b/.test(line)) {
        assert.ok(trimmed.startsWith('export function accountBacktest('),
          `raw-line scan: only the sanctioned export line may say export: ${trimmed}`);
      }
    }
    // Round-1/round-2: module-scope mutable state in every spelling —
    // column-0 or indented let/var, and const-backed mutable objects. The
    // module's top level holds ONLY function declarations and the export:
    // zero module-scope const/let/var of any kind, and the total let-count
    // equals the eight sanctioned function-local accumulators.
    assert.ok(!/^\s*(let|var)\s/m.test(stripFunctionBodies(code)), 'no module-scope let/var (any indentation)');
    assert.ok(!/^\s*const\s/m.test(stripFunctionBodies(code)), 'no module-scope const (state cannot hide in a const object)');
    assert.equal([...code.matchAll(/\blet\s/g)].length, 9,
      'exactly the nine sanctioned function-local lets (eight fold accumulators + the equity loop index)');
    assert.equal([...code.matchAll(/\bvar\s/g)].length, 0, 'no var at all');
  });

  it('holds no comparator/tolerance machinery — verification lives in tests only (owner ruling)', () => {
    // Round-1: Math.abs(δ) < 1e-12 and < 0.000001 snap-mutants evaded the
    // vocabulary ban. Math.abs has no legitimate use in the fold, and no
    // small scientific-notation literal belongs in product code.
    for (const banned of ['1e-9', 'tolerance', 'epsilon', 'EPSILON', 'residual', 'Math.abs', 'Math.',
      'MIN_VALUE', 'MAX_VALUE']) {
      assert.ok(!code.includes(banned), `no ${banned} in product code`);
    }
    assert.ok(!/\d+e-\d+/.test(code), 'no small scientific-notation literal in product code');
    // Round-2: a DECIMAL threshold (0.000001) evaded the scientific-notation
    // ban. Total closure of the literal-threshold class: the fold's only
    // legitimate numeric literals are 0 and 1 — every other literal is a
    // smuggled constant and fails here by value.
    // Round-3: the previous regex required a digit before the dot, so a
    // leading-dot literal (.000000001) escaped the whitelist. This form
    // matches integer, decimal, leading-dot, and exponent spellings.
    const literals = [...code.matchAll(/(?<![\w$.])(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/g)].map((m) => m[0]);
    for (const lit of literals) {
      assert.ok(lit === '0' || lit === '1', `numeric literal whitelist {0, 1}: found ${lit}`);
    }
  });

  it('operative-rule and guard source pins (contract-mandated, some mathematically redundant)', () => {
    // The D1 assignment must be the literal definitional zero — no
    // subtraction, no snapping (round-1 tolerance-state mutants).
    assert.ok(code.includes('cash = 0;'), 'the literal D1 entry assignment');
    assert.ok(!/cash\s*=\s*cashBefore\s*-/.test(code), 'entry cash is never a subtraction');
    // The §5.3 exit expression in its WRITTEN evaluation order (round-1:
    // cashBefore + net grouped differently).
    assert.ok(code.includes('cashBefore + proceeds - commission'), 'the written exit cash grouping');
    // Round-2: reassociation mutants differ by one ULP on non-dyadic inputs
    // — the §5.2 quantity and commission expressions are pinned in their
    // written IEEE order (the denominator temp does not change rounding).
    assert.ok(code.includes('rawPrice * (1 + slippageRate)'), 'the written entry effective price');
    assert.ok(code.includes('rawPrice * (1 - slippageRate)'), 'the written exit effective price');
    assert.ok(!code.includes('rawPrice + rawPrice'), 'entry effective price is never additively expanded');
    assert.ok(!code.includes('rawPrice - rawPrice'), 'exit effective price is never additively expanded');
    assert.ok(code.includes('effectivePrice * (1 + commissionRate)'), 'the written entry denominator');
    assert.ok(code.includes('cashBefore / denominator'), 'quantity divides by the written denominator');
    assert.ok(!code.includes('/ effectivePrice /'), 'quantity is never a chained division');
    assert.ok(code.includes('quantity * effectivePrice * commissionRate'), 'the written commission order (left-associated)');
    assert.ok(!code.includes('(effectivePrice * commissionRate)'), 'commission is never regrouped');
    // Round-2: under D1 the positioned cash addend is always exactly 0, so
    // omitting it is output-equivalent — the complete §5.6 expression is
    // pinned as source text.
    assert.ok(code.includes('equityCash + equityQuantity * bars[t].close'), 'the complete positioned equity expression');
    // Every §3 guard stage must exist BY NAME — several are mathematically
    // unreachable given upstream guards, but contractually mandatory, so
    // their removal must fail statically (round-1 finding).
    for (const guard of [
      'computed entry effective price', 'computed entry denominator',
      'computed entry quantity', 'computed entry commission',
      'computed exit effective price', 'computed exit proceeds',
      'computed exit commission', 'computed exit net proceeds',
      'computed exit cashAfter', 'computed realizedPnl',
      'computed realizedPnlTotal', 'computed markedValue',
      'computed unrealizedPnl', 'computed equity sample',
    ]) {
      assert.ok(code.includes(guard), `guard stage present: ${guard}`);
    }
  });

  it('has zero product wiring — no MCP exposure before BT5', () => {
    const roots = ['../src/server.js', '../src/connection.js', '../src/wait.js'];
    for (const f of readdirSync(join(here, '../src/tools'))) roots.push(`../src/tools/${f}`);
    for (const f of readdirSync(join(here, '../src/core'))) {
      if (f.endsWith('.js')) roots.push(`../src/core/${f}`);
    }
    for (const rel of roots) {
      const text = readFileSync(join(here, rel), 'utf8');
      assert.ok(!text.includes('accounting'), `${rel} must not wire the accounting layer (BT5 gate)`);
    }
  });

  it('BT1 execution kernel is byte-identical to its CLOSED state (D3, owner-approved)', () => {
    // "BT2 tests must pin the CLOSED BT1 kernel" — a silent touch of
    // execution semantics from the accounting workstream fails here by name.
    const bt1 = readFileSync(join(here, '../src/analytics/backtest.js'));
    assert.equal(
      createHash('sha256').update(bt1).digest('hex'),
      'dd1f12dec0e68d841780456ef9d676058020797eb426799f1a44e55612fd7b45',
      'src/analytics/backtest.js changed — BT1 is CLOSED; a change requires owner adjudication, then update this pin in the same reviewed commit',
    );
  });
});

// ── 7. contract readback — code shape bound to the ratified document ────────

test('BT2 contract document pins the §5.9 result fields this layer returns', () => {
  const contract = readFileSync(join(here, '../docs/BT2-CONTRACT.md'), 'utf8');
  for (const needle of [
    'ledger[]', 'realizedPnlTotal', 'closedTradePnl[]', 'openPositionAccounting',
    'equitySeries[]', 'finalCash', 'finalEquity', 'assumptions',
    'markPrice', 'cashAfter      := 0',
  ]) {
    assert.ok(contract.includes(needle), `contract must contain: ${needle}`);
  }
});
