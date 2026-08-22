# BT2 — Costs & equity accounting contract (V1)

**Status:** design-only proposal for owner adjudication. **Zero product
code.** BT2 implementation opens only after this document is ratified; the
decision points in §8 are the owner's to adjudicate.

**Base:** `main @ f4822ad` — BT0 contract ratified (`438a59e`, merged
`ae68572`), BT1 kernel CLOSED (`0d07902`, merged `f4822ad`).

---

## 1. Governance record

### 1.1 Charter

Owner GO, 2026-08-23, verbatim:

> Only then begin BT2, with costs/equity accounting as a separate contract
> layer and no BT3 metrics scope.

BT2 therefore adds **accounting over the CLOSED BT1 execution model** —
nothing else. Metrics of every kind (profit factor, Sharpe, drawdown, win
rate, …) remain BT3 scope and do not enter this milestone even though an
equity series exists (owner: "不因 BT2開始有 equity curve就順便加入").

### 1.2 Pre-registered owner invariant (binding, verbatim)

> **Every reported cash, position, realized-P&L, unrealized-P&L, or equity
> value must be reconstructible from the execution ledger plus explicit cost
> assumptions.**

The equity series is derived state, never an independent calculation that
"roughly agrees". §5.7 gives the reconstruction equations; every fixture in
§7 demonstrates the identity end-to-end.

### 1.3 Execution-layer ground truth

The BT1 closure statement (owner, verbatim) is the execution semantics this
layer accounts for:

> The BT1 kernel implements the ratified BT0 execution contract without
> modification: completed-bar Donchian signals use the prior channel,
> execute no earlier than the next raw open, never fabricate terminal fills,
> preserve terminal open state, and distinguish executions from closed
> trades. Completion qualification remains outside the pure kernel by
> design.

BT2 changes none of it: **costs never influence signals or fills.** In V1
the position quantity cannot alter execution (single instrument, one
position, long-only, no leverage), so accounting is a pure derivation over
the BT1 result — the layering is exact, not approximate.

---

## 2. Architecture

```text
bars ──▶ BT1 kernel (CLOSED) ──▶ executions / closedTrades / terminal state
  │                                        │
  └────────────┐          ┌────────────────┘
               ▼          ▼
        BT2 accounting layer (pure fold)
        (bars, bt1Result, params) ──▶ ledger + P&L + equity series
```

- New pure module (conceptually `src/analytics/accounting.js`) consuming the
  BT1 result, the same bars, and explicit parameters. Same zero-capability
  class as A1/BT1: no clock, no randomness, no I/O, no mutation of inputs.
- `src/analytics/backtest.js` and `src/analytics/indicators.js` stay
  byte-untouched (the A1 hash-pin discipline extends to BT1 — D3).
- No MCP exposure: the allowlist stays at 8 tools; exposure remains BT5's
  deliberate gate.

---

## 3. Parameters (all REQUIRED — no silent defaults)

Per the owner's cost-explicitness ruling (recorded in BT0 §4.6), costs
arrive as explicit parameters; a zero-cost run states its zeros explicitly.

| param | domain | meaning |
|---|---|---|
| `initialCash` | finite, > 0 | starting cash |
| `commissionRate` | finite, ≥ 0 | per-side proportional commission, charged on **effective notional** (quantity × effective price) at every fill |
| `slippageRate` | finite, 0 ≤ s < 1 | deterministic adverse price adjustment on the **raw fill price**: buys fill at `raw × (1+s)`, sells at `raw × (1−s)` |

Violations fail loud with typed errors (the A1 approved-delta doctrine).
Stochastic fill models remain deferred (roadmap Not-now).

**Domain guard (degenerate prices).** The accounting model requires every
fill's **effective price to be strictly positive** — the all-in quantity is
undefined otherwise, and negative proceeds would silently break the
no-leverage-by-construction property. A fill whose effective price is ≤ 0
fails loud with a typed error. This is a declared explicit boundary, not a
data policy: the validated OHLCV path serves real market prices, and the
guard makes that assumption checkable instead of silent. (With `s < 1`,
the guard is equivalent to requiring positive raw fill prices.)

---

## 4. Definitions

- **Raw price.** The BT1 execution's `fillPrice` — the next-bar open exactly
  as served (BT0 §3). BT2 never re-derives or adjusts it.
- **Effective price.** Raw price after slippage (§3). Both raw and effective
  are recorded per ledger entry — costs stay auditable (Phase-0 requirement,
  ratified roadmap BT2a).
- **Quantity (D1).** All-in exact deployment at entry:
  `quantity = cashBefore / (effectivePrice × (1 + commissionRate))`, so the
  entry consumes the entire cash balance exactly (cashAfter = 0) and
  leverage is impossible by construction. Fractional quantities are allowed;
  lot/size rounding is a declared V1 exclusion, not an oversight.
- **Cash.** Changes only at fills (§5.2–5.3). Signals without fills have
  zero accounting effect (AF6).
- **Marking (D2).** An open position is marked at the **raw close** of the
  bar in question: `markedValue = quantity × close[t]`. Marking applies no
  hypothetical exit costs — it is a mark, not a liquidation value, and is
  labeled as such. (A liquidation-adjusted mark would fabricate an exit the
  execution layer never produced; rejected for V1 — same reasoning as BT0's
  no-fabricated-fill rule.)

---

## 5. Normative accounting model

### 5.1 Initial state

`cash = initialCash`, no position, empty ledger — aligned with BT0 §4.1's
initial flat state. Since the earliest possible fill is bar `p+1 ≥ 2`,
`equity[0] = initialCash` always.

### 5.2 Entry fill (BT1 execution, kind = entry, at bar t)

```text
effectivePrice = rawPrice × (1 + slippageRate)
quantity       = cashBefore / (effectivePrice × (1 + commissionRate))   [D1]
commission     = quantity × effectivePrice × commissionRate
cashAfter      = cashBefore − quantity × effectivePrice − commission  (= 0 exactly under D1)
```

### 5.3 Exit fill (kind = exit, at bar t)

```text
effectivePrice = rawPrice × (1 − slippageRate)
proceeds       = quantity × effectivePrice
commission     = quantity × effectivePrice × commissionRate
cashAfter      = cashBefore + proceeds − commission
```

### 5.4 Ledger

One record per BT1 execution, chronological (same order as BT1's
`executions`), extending it with:
`{rawPrice, effectivePrice, quantity, commission, cashBefore, cashAfter}`.

### 5.5 Realized and unrealized P&L

- Per closed trade:
  `realizedPnl = quantity × (effExit × (1 − r) − effEntry × (1 + r))`
  — identically `cashAfterExit − cashBeforeEntry` under D1 (the fixtures
  demonstrate both forms agree).
- `realizedPnlTotal` = sum over closed trades.
- Open position at end (if any): `entryCost = quantity × effEntry × (1+r)`
  (= the cash consumed), `markedValue = quantity × close[N−1]`,
  `unrealizedPnl = markedValue − entryCost`. If flat: unrealizedPnl = 0.

### 5.6 Equity series

One value per bar, aligned to bars, state **as of completion of bar t**
(a fill at the open of bar t is already reflected in bar t's value):

```text
equity[t] = cash_asof(t) + (positioned_asof(t) ? quantity × close[t] : 0)
```

`finalEquity = equity[N−1]`. The series is derived, never authoritative on
its own (§1.2).

### 5.7 Reconciliation (the §1.2 invariant, operational)

Given the ledger and the three parameters, every reported number is
reconstructible:

- `cashBefore₁ = initialCash`; `cashBefore₍ₖ₊₁₎ = cashAfterₖ`; the §5.2–5.3
  equations regenerate every ledger field from `{kind, rawPrice}` alone.
- `finalCash = cashAfter` of the last ledger entry (or `initialCash` if the
  ledger is empty).
- **Master identity (must hold in every conforming result):**

```text
equity[N−1] = initialCash + realizedPnlTotal + unrealizedPnl
```

The identity is a theorem of the model, not a per-fixture accident:
`finalCash = initialCash + Σ(exit net proceeds) − Σ(entry deployments)`;
closed entry/exit pairs contribute exactly their `realizedPnl`, and an
unmatched open entry contributes `−entryCost`. Therefore
`equity[N−1] = finalCash + (open ? markedValue : 0)
= initialCash + realizedPnlTotal + (open ? markedValue − entryCost : 0)
= initialCash + realizedPnlTotal + unrealizedPnl`. A conforming
implementation cannot violate it without breaking one of the §5.2–5.6
equations; every fixture in §7 additionally closes it by hand.

### 5.8 End-state separation

Carried from BT0 §4.4 into accounting: closed-trade statistics, the open
position's accounting (entryCost / markedValue / unrealizedPnl), and final
marked equity are reported **separately**. No force-close, ever (BT3 must
not force one either).

### 5.9 Result shape (field names conceptual, structure binding — A2 convention)

```text
ledger[]                 §5.4, chronological
realizedPnlTotal
closedTradePnl[]         one per BT1 closed trade, aligned by index
openPositionAccounting   null | {quantity, entryCost, markedValue, unrealizedPnl}
equitySeries[]           §5.6, one per bar
initialCash, finalCash, finalEquity
assumptions              {initialCash, commissionRate, slippageRate} echoed —
                         results carry their explicit cost assumptions
```

### 5.10 Precision

Raw doubles throughout; the accounting layer applies no rounding (the
A2/BT0 transparent-transport rule). The §7 fixtures deliberately use
**dyadic rates and exactly-representable values** so every product and sum
below is exact in binary64 — hand arithmetic and machine arithmetic agree
to the last bit, and conforming tests may compare exactly on these
fixtures. The model itself accepts any finite decimal inputs.

---

## 6. Explicitly NOT in BT2 (owner order)

All BT3 metrics (profit factor, Sharpe, drawdown, win rate, return ratios);
force-close of terminal positions; leverage/margin/shorting; lot rounding;
position-sizing strategies beyond D1; stochastic slippage; multi-position /
multi-symbol; MCP exposure (BT5); completion-establishment mechanics (BT5,
per the ratified §4.7 epistemic rule).

---

## 7. Hand-derived fixtures

All execution traces below are the **ratified BT0 §7 fixtures** (or the
BT1-reviewed p=2 two-trade sequence, restated in AF7) — BT2 adds only the
accounting on top. Notation: `r` = commissionRate, `s` = slippageRate.
Every number below is exact in binary64 (§5.10).

### AF1 — zero-cost round trip (baseline) — over BT0 F1

F1 execution: entry fill bar 4 @ raw 10; exit fill bar 7 @ raw 8. Closes:
10, 10, 10, 11, 10, 10, 7, 9. Params: cash 1000, r = 0, s = 0.

| event | eff | qty | commission | cash after |
|---|---|---|---|---|
| entry @10 | 10 | 1000/10 = **100** | 0 | 0 |
| exit @8 | 8 | 100 | 0 | **800** |

Equity: [1000, 1000, 1000, 1000, 1000, 1000, **700**, 800]
(bar 4: 0 + 100×10; bar 6: 100×7; bar 7: flat cash 800).

Realized = −200; unrealized = 0; **800 = 1000 − 200 + 0** ✓.

### AF2 — both costs, dyadic — over BT0 F1

Params: cash 1562.5, r = 0.25, s = 0.25.

| event | eff | qty | commission | cash after |
|---|---|---|---|---|
| entry @10 | 10×1.25 = 12.5 | 1562.5/(12.5×1.25) = 1562.5/15.625 = **100** | 100×12.5×0.25 = 312.5 | 1562.5 − 1250 − 312.5 = **0** |
| exit @8 | 8×0.75 = 6 | 100 | 100×6×0.25 = 150 | 0 + 600 − 150 = **450** |

Equity: [1562.5, 1562.5, 1562.5, 1562.5, 1000, 1000, 700, 450].

Realized per formula: 100 × (6×0.75 − 12.5×1.25) = 100 × (4.5 − 15.625)
= **−1112.5**; identically 450 − 1562.5 ✓. **450 = 1562.5 − 1112.5 + 0** ✓.

### AF3 — commission only — over BT0 F1

Params: cash 1250, r = 0.25, s = 0.

Entry: eff 10, qty = 1250/12.5 = **100**, commission 250, cashAfter 0.
Exit: eff 8, proceeds 800, commission 200, cashAfter **600**.
Equity: [1250, 1250, 1250, 1250, 1000, 1000, 700, 600].
Realized = 100 × (8×0.75 − 10×1.25) = 100 × (6 − 12.5) = **−650** ✓;
600 = 1250 − 650 + 0 ✓.

### AF4 — slippage only — over BT0 F1

Params: cash 1250, r = 0, s = 0.25.

Entry: eff 12.5, qty = 1250/12.5 = **100**, commission 0, cashAfter 0.
Exit: eff 6, proceeds 600, cashAfter **600**.
Equity: [1250, 1250, 1250, 1250, 1000, 1000, 700, 600].
Realized = 100 × (6 − 12.5) = **−650** ✓; 600 = 1250 − 650 + 0 ✓.

**Deliberate coincidence with AF3's totals:** identical realized P&L and
equity through different mechanisms. The LEDGERS must still differ —
AF3: eff 10/8, commissions 250/200; AF4: eff 12.5/6, commissions 0/0.
This pins ledger-level distinguishability: totals alone are not the
accounting.

### AF5 — open at end, unrealized — over BT0 F5

F5 execution: entry fill bar 4 @ raw 13, held to end. Closes: 10, 10, 10,
14, 15, 15. Params: cash 1300, r = 0, s = 0.

Entry: eff 13, qty = 1300/13 = **100**, cashAfter 0.
Equity: [1300, 1300, 1300, 1300, 1500, 1500].
openPositionAccounting: {quantity 100, entryCost 1300, markedValue
100×15 = 1500, unrealizedPnl **+200**}. Realized = 0; closed trades = 0.
**1500 = 1300 + 0 + 200** ✓. No force-close; marked, not liquidated (D2).

### AF6 — signal without fill has zero accounting effect — over BT0 F4

F4 execution: terminal entry signal, never filled. Params: cash 1000,
r = 0.25, s = 0.25 (present and unused).

Ledger empty; equity [1000, 1000, 1000, 1000]; realized 0; unrealized 0;
finalCash = finalEquity = 1000 = initialCash ✓. The pending signal is an
execution-layer fact with no accounting counterpart.

### AF7 — compounding across two round trips (p = 2 sequence)

Bars (O,H,L,C), the BT1-reviewed two-trade sequence — execution trace per
BT0 rules: entry signal 2 → fill 3 @ raw 13; exit signal 3 → fill 4 @ raw
9; entry signal 5 → fill 6 @ raw 15; exit signal 7 → fill 8 @ raw 7:

| i | O | H | L | C |
|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 |
| 1 | 10 | 10 | 10 | 10 |
| 2 | 10 | 12 | 10 | 11 |
| 3 | 13 | 13 | 9 | 10 |
| 4 | 9 | 10 | 8 | 9 |
| 5 | 9 | 15 | 9 | 14 |
| 6 | 15 | 16 | 14 | 15 |
| 7 | 15 | 15 | 7 | 8 |
| 8 | 7 | 9 | 7 | 8 |

Params: cash 1300, r = 0, s = 0.

| event | qty | cash after |
|---|---|---|
| entry @13 (bar 3) | 1300/13 = **100** | 0 |
| exit @9 (bar 4) | 100 | **900** |
| entry @15 (bar 6) | 900/15 = **60** | 0 |
| exit @7 (bar 8) | 60 | **420** |

Equity: [1300, 1300, 1300, 1000, 900, 900, 900, 480, 420]
(bar 3: 100×10; bar 7: 60×8).

Realized: trade 1 = −400, trade 2 = −480, total **−880** = 420 − 1300 ✓.
**Compounding is pinned by qty₂ = 60 ≠ qty₁ = 100** — the second trade's
size derives from the first trade's outcome through the ledger, nowhere
else. 420 = 1300 − 880 + 0 ✓.

---

## 8. Decision points for owner adjudication

| # | Question | Recommendation |
|---|---|---|
| D1 | Quantity model | **All-in exact deployment** (cashAfter-entry = 0; leverage impossible by construction; fractional qty; lot rounding a declared exclusion). Alternative: explicit fixed-quantity parameter. |
| D2 | Open-position marking | **Raw final close, no hypothetical exit costs** — a mark, labeled as such. Alternative (rejected-as-fabrication): liquidation-adjusted marking. |
| D3 | BT1 kernel immutability pin | **Yes** — BT2's tests sha256-pin `src/analytics/backtest.js` exactly as BT1 pinned A1's `indicators.js`. |
| D4 | Cost semantics | **Slippage: proportional on raw price, adverse both sides. Commission: proportional on effective notional, per side.** Alternatives: bps integers, flat per-trade. |
| D5 | Equity sampling | **One value per completed bar at its raw close**, fills effective within their own bar. |
| D6 | Result field names | Conceptual names, structure binding (the A2 convention), per §5.9. |

---

## 9. BT2 closure protocol (mirrors BT0 §8)

1. This contract document complete and internally consistent;
2. every fixture hand-recomputable (and exact in binary64 by construction);
3. narrow Sol + Luna contract review (max effort) on the exact SHA — a
   finding that demands changing BT0/BT1 CLOSED semantics, adding metrics,
   or force-closing positions is a scope violation by owner ruling;
4. owner adjudication of D1–D6 and surviving findings;
5. ratification by merging the docs-only PR (CI1 + CI2 as provenance gate).

BT2 implementation (product code + RED→GREEN + its own review rounds)
opens only after ratification, implements exactly this contract, and any
semantic departure requires a BT2 amendment — never an in-flight
reinterpretation.
