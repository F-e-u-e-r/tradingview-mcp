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
  assumptions: { ...params },
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

  it('operative §5.5 pin: entryCost is EXACTLY cashBeforeEntry, never recomputed', () => {
    // Non-dyadic open position (F5, cash 1, r = s = 0.1): the forbidden
    // audit-form recomputation qty × eff × (1+r) yields 0.9999999999999999,
    // one ULP off the operative value, which is the stored cashBefore: 1.
    const p = { initialCash: 1, commissionRate: 0.1, slippageRate: 0.1 };
    const a = run(F5, 3, p);
    assert.equal(a.openPositionAccounting.entryCost, 1);
    assert.equal(a.openPositionAccounting.entryCost, a.ledger[0].cashBefore);
    assert.equal(a.openPositionAccounting.markPrice, 15);
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
  it('does not mutate its inputs (runs on frozen bars and frozen execution)', () => {
    const b = Object.freeze(bars(F1).map((x) => Object.freeze(x)));
    const ex = donchianBreakoutBacktest(b, 3);
    Object.freeze(ex);
    ex.executions.forEach(Object.freeze);
    Object.freeze(ex.executions);
    const a = accountBacktest(b, ex, Object.freeze({ ...p }));
    assert.equal(a.finalCash, 450);
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

  it('imports nothing at all (pure fold over its inputs)', () => {
    assert.ok(!/\bimport\b/.test(code), 'no import token anywhere in code');
  });

  it('reaches for no capability, I/O, or nondeterminism source, and holds no module state', () => {
    for (const banned of [
      /\bprocess\b/, /\bperformance\b/, /\bglobalThis\b/, /\bcrypto\b/,
      /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bchild_process\b/,
      /\beval\b/, /\bFunction\b/, /\bDate\b/, /\bMath\.random\b/,
      /\bsetTimeout\b/, /\bsetInterval\b/, /\bsetImmediate\b/, /\brequire\b/,
      /node:/, /\bfs\b/, /\bconsole\b/,
    ]) {
      assert.ok(!banned.test(code), `no ${banned}`);
    }
    // Round-1: a top-level mutable counter passed the scan — a zero-state
    // pure fold declares no MODULE-SCOPE let/var (column-0 declarations;
    // function-local lets are indented and legitimate).
    assert.ok(!/^(let|var)\s/m.test(code), 'no module-scope let/var declarations');
  });

  it('holds no comparator/tolerance machinery — verification lives in tests only (owner ruling)', () => {
    // Round-1: Math.abs(δ) < 1e-12 and < 0.000001 snap-mutants evaded the
    // vocabulary ban. Math.abs has no legitimate use in the fold, and no
    // small scientific-notation literal belongs in product code.
    for (const banned of ['1e-9', 'tolerance', 'epsilon', 'EPSILON', 'residual', 'Math.abs', 'Math.']) {
      assert.ok(!code.includes(banned), `no ${banned} in product code`);
    }
    assert.ok(!/\d+e-\d+/.test(code), 'no small scientific-notation literal in product code');
  });

  it('operative-rule and guard source pins (contract-mandated, some mathematically redundant)', () => {
    // The D1 assignment must be the literal definitional zero — no
    // subtraction, no snapping (round-1 tolerance-state mutants).
    assert.ok(code.includes('cash = 0;'), 'the literal D1 entry assignment');
    assert.ok(!/cash\s*=\s*cashBefore\s*-/.test(code), 'entry cash is never a subtraction');
    // The §5.3 exit expression in its WRITTEN evaluation order (round-1:
    // cashBefore + net grouped differently).
    assert.ok(code.includes('cashBefore + proceeds - commission'), 'the written exit cash grouping');
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
