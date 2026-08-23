# BT3 — Performance metrics contract (V1)

**Status:** owner-adjudicated 2026-08-24 — **APPROVED-WITH-AMENDMENTS**
(§1.5); this revision incorporates the amendments. **Zero product code.**
Ratification lands by merging the docs-only PR (CI1 + CI2 provenance
gate); BT3 implementation opens only after that merge. No decision point
in §8 remains open.

**Base:** `main @ 0320d4b0f884eab3ec426b840e51f361c150e8ca` — BT0 contract
ratified (`438a59e`), BT1 kernel CLOSED (`0d07902`), BT2 contract ratified
(`04dc9fd`), BT2 implementation CLOSED (`57f1915`), VWAP/#16 CLOSED
(`2d9bef8`, merged `0320d4b`). Pin/regression confirmation for this base:
the full suite (465/465, including the A1/BT1 sha-pins and the AF1–AF7
accounting oracle) runs green at exactly this SHA — BT1/BT2 closed
semantics are unchanged under the merged VWAP main.

---

## 1. Governance record

### 1.1 Charter

Owner GO, 2026-08-24, verbatim:

> GO — start BT3 as contract/design only on canonical
> `main @ 0320d4b0f884eab3ec426b840e51f361c150e8ca`. No BT3 product code
> until owner ratifies the contract.

BT3's sole purpose (owner, verbatim):

> derive deterministic performance metrics as pure projections of the
> CLOSED BT2 authoritative accounting output.

### 1.2 Purity rule (owner pre-lock, binding, verbatim)

> Metrics are pure projections of the CLOSED BT2 authoritative accounting
> output. They must not independently reconstruct fills, positions, costs,
> or equity.

Operationalized in §2–§3: the metrics layer consumes exactly one input —
the BT2 result object — and no bars, no BT1 result, no parameters. If a
BT3 metric disagrees with BT2 accounting, the defect is in BT3 by
definition (owner ruling, 2026-08-24, verbatim: 「如果 BT3 metric 和 BT2
accounting 對不上，修 BT3，不要偷偷建立第二套 accounting truth」). There
is no second accounting truth.

### 1.3 Standing orchestration rules (owner-ratified, in force for BT3)

1. **Review budget:** default autonomous independent-review budget = 4
   rounds; a blocking finding surviving round 4 returns to the owner. For
   BT3's scope the owner expectation is 1–2 rounds; 4 is a cap, not a
   target.
2. **Frozen-SHA immutability:** once a review round starts, the frozen SHA
   / worktree must not change; mid-review mutation invalidates the leg as
   TORN.
3. **Proportional review** (owner, 2026-08-24): executable contract
   violations block; mutation-test completeness by itself does not. A
   numerical BLOCK must present (owner, verbatim): "supported BT2
   authoritative result → observable violation of one of these metric
   contracts".

### 1.4 Accounting-layer ground truth

The CLOSED BT2 result (docs/BT2-CONTRACT.md §5.9, implementation
`src/analytics/accounting.js` @ this base) is the single authoritative
input. Facts BT3 relies on, all guaranteed by the ratified BT2 contract:

- `initialCash` is finite and > 0 (BT2 §3) — BT3 invents no
  initial-capital domain of its own;
- every reported BT2 value is finite (BT2 §3 guards) — results never
  carry NaN or Infinity;
- `closedTradePnl[k].realizedPnl` is the **net, after-cost** cash-form
  P&L of closed round trip `k` (BT2 §5.5: `cashAfterExit −
  cashBeforeEntry` with commission and slippage inside the ledger);
- when flat, unrealized P&L is 0 by definition (BT2 §5.5);
  `openPositionAccounting` is null exactly then;
- `equitySeries` has one sample per bar, marks at raw closes, reflects a
  fill within its own bar (BT2 §5.6/D5), and `equitySeries[0] =
  initialCash` whenever `N > 0` (BT2 §5.1);
- for `N = 0`: `equitySeries = []` and `finalEquity = initialCash`
  (BT2 §5.1);
- the master identity `finalEquity = initialCash + realizedPnlTotal +
  unrealizedPnl` is a theorem in exact real arithmetic and
  comparator-bounded in binary64 (BT2 §5.7);
- terminal open positions are marked, never force-closed, and BT2 §5.8
  already binds the successor: **"No force-close, ever (BT3 must not
  force one either)."**

### 1.5 Adjudication record (owner, 2026-08-24)

Owner decision, verbatim:

> **BT3 contract semantics APPROVED-WITH-AMENDMENTS. Ratify D1, D2, D3,
> D4, D5, D6, D7, D7a and D8 as specified above; change D3a to
> `winningTrades / closedTrades`; seed max-drawdown running peak with
> `initialCash`; refine profit-factor reason tokens to distinguish zero
> closed trades, breakeven-only closed trades, and no-loss histories;
> retain whole-call typed failure for representationally non-finite
> derived metrics; and weaken the “signature proves purity” wording to
> the actual consumed-field allowlist contract.**

Process rulings attached to the same decision: no Sol/Luna review of the
contract is required before ratification (the adjudicated amendments are
written back into this document, then the docs-only PR is opened);
implementation and model review stay closed until the ratification
merge; the draft-session process notes (an early piped-exit-code
misread, corrected in-session; the main-checkout branch switch by an
actor outside the session) are RESOLVED / RECORD-only — no blocker, no
follow-up investigation. §8 records the per-point rulings; §5 carries
the amended normative text.

---

## 2. Architecture

```text
bars ──▶ BT1 kernel (CLOSED) ──▶ execution result
  │                                     │
  └──────────▶ BT2 accounting (CLOSED) ─┘
                       │
                       ▼  the ONE input
            BT3 metrics (pure projection)
            computeBacktestMetrics(accounting) ──▶ metrics
```

- New pure module (conceptually `src/analytics/metrics.js`), same
  zero-capability class as A1/BT1/BT2: no imports, no clock, no
  randomness, no I/O, no mutation of inputs, no mutable module state.
- **Single argument** — the BT2 result object. Containment wording
  (owner amendment, 2026-08-24, verbatim): "The single-argument signature
  constrains BT3 to the authoritative BT2 accounting object; purity is
  enforced by the normative consumed-field allowlist in §2.2 and by
  tests that reject access to fields outside that contract. The
  signature alone is not treated as proof of non-reconstruction."
- `src/analytics/indicators.js`, `backtest.js`, `accounting.js` stay
  byte-untouched. The hash-pin discipline extends: BT3's tests sha256-pin
  `accounting.js` exactly as BT2's tests pin `backtest.js` and BT1's pin
  `indicators.js`.
- No MCP exposure: the allowlist stays at its current count; exposure
  remains BT5's deliberate gate.

### 2.1 Projection discipline (what "pure projection" permits)

The metrics layer may only:

1. **copy** a BT2-reported value (`realizedPnlTotal`, `finalEquity`,
   `unrealizedPnl`, `initialCash`);
2. **classify and count** BT2-reported values (the sign of each
   `closedTradePnl[k].realizedPnl`);
3. **apply the §5 metric formulas** to BT2-reported values
   (`totalReturn`, `netPnl`, `winRate`, `maxDrawdown`, `profitFactor`).

It must never re-derive a BT2-reported value from other BT2 fields.
Owner ruling (D2, verbatim): **"BT3 must not re-sum executions or closed
trades to derive `realizedPnlTotal`."** (BT2 reports that total; a
binary64 re-summation could differ in rounding and would be a second
accounting truth.) Likewise it must not
recompute `unrealizedPnl` from `markedValue − entryCost`, must not check
`finalEquity` against `equitySeries`, and must not rebuild any equity,
position, cost, or fill quantity from `ledger` (which it does not read at
all).

### 2.2 Consumed-field allowlist (normative, exhaustive)

| BT2 field | used by |
|---|---|
| `initialCash` | totalReturn; maxDrawdown (the D4 peak seed) |
| `finalEquity` | totalReturn |
| `realizedPnlTotal` | realizedPnlTotal (copy), netPnl |
| `closedTradePnl[]` — each element's `realizedPnl`, array order/length | counts, winRate, profitFactor |
| `openPositionAccounting` — null-ness; `unrealizedPnl` when present | unrealizedPnl (copy/0), netPnl |
| `equitySeries[]` | maxDrawdown |

`ledger`, `finalCash`, `assumptions`, and the other
`openPositionAccounting` fields (`quantity`, `entryCost`, `markPrice`,
`markedValue`) are **not consumed** and not validated (§3). This
allowlist is the enforcement surface of the §1.2 purity rule (owner
amendment, §1.5): the implementation reads no field outside it, and
BT3's tests must reject access to fields outside this contract — an
out-of-allowlist read is a contract violation, not a style issue.

---

## 3. Input contract

The single argument must be a CLOSED-BT2 result. Validation is
**boundary-shaped, not reconciliating**: the layer fail-louds (typed
errors, the A1 approved-delta doctrine) when a consumed field is missing,
mistyped, or non-finite — and performs **no** semantic re-verification of
the accounting (no master-identity check, no equity recomputation, no
comparator). The BT2 §5.7 comparator remains a verification instrument
that lives in tests only; it never appears in product formulas (BT2
owner ruling, carried forward).

Required of the input, exhaustively:

1. the argument is a non-null object;
2. `initialCash` is a finite number > 0 (re-stating BT2's own domain at
   the boundary, not a new domain);
3. `finalEquity` and `realizedPnlTotal` are finite numbers;
4. `closedTradePnl` is an array whose every element is a non-null object
   with a finite-number `realizedPnl`;
5. `openPositionAccounting` is `null` or a non-null object with a
   finite-number `unrealizedPnl`;
6. `equitySeries` is an array whose every element is a finite number.

Anything further (ledger consistency, identity reconciliation) is the
closed BT2 layer's guarantee and the test suite's business — never this
module's.

---

## 4. Definitions

- **Closed trade `k`.** Element `k` of `closedTradePnl`, in BT2 ledger
  order. Its **net realized P&L after costs** is the reported
  `realizedPnl` (§1.4).
- **Classification (D3).** By the sign of that reported value:
  `> 0` → **win**; `< 0` → **loss**; `=== 0` → **breakeven** (`0` and
  `-0` both classify breakeven; a genuine BT2 exit produces `+0` when
  equal). Breakeven is neither a win nor a loss (owner, verbatim:
  「breakeven沒有 directional outcome」). Therefore
  `closedTrades = winningTrades + losingTrades + breakevenTrades` is an
  identity of the classification.
- **Gross sums (D5).** `grossProfitTotal` = sum of winning trades'
  `realizedPnl`; `grossLossTotal` = sum of losing trades' `realizedPnl`
  (≤ 0); each accumulated in `closedTradePnl` order as raw doubles;
  breakeven trades contribute to neither. Empty sums are 0.
- **Running peak (D4, as amended).** Seeded at `initialCash` — owner
  amendment, verbatim: "Initial capital is the time-zero equity anchor
  for drawdown." — then folded over `equitySeries` in order:
  `peak[t] = max(initialCash, equitySeries[0..t])`. Every peak is
  therefore ≥ `initialCash > 0` unconditionally, so the D4 quotient's
  denominator is strictly positive.
- **Reason token.** A closed vocabulary string explaining exactly why a
  nullable metric is null (§5.4/§5.6, D8). A metric's reason field is
  non-null **iff** the metric is null.
- **Null semantics (D6, owner principle, verbatim):**

  > zero is a valid measured result; null means the metric is
  > semantically undefined/insufficient, not merely "nothing happened."

---

## 5. Normative metric model

### 5.1 Result shape (field names conceptual, structure binding — A2 convention)

```text
totalReturn          §5.2   finite number
realizedPnlTotal     §5.3   finite number (copy of BT2's field)
unrealizedPnl        §5.3   finite number (BT2's value; 0 when flat)
netPnl               §5.3   finite number
closedTrades         §5.4   integer ≥ 0
winningTrades        §5.4   integer ≥ 0
losingTrades         §5.4   integer ≥ 0
breakevenTrades      §5.4   integer ≥ 0
winRate              §5.4   number in [0,1] | null
winRateReason        §5.4   null | 'insufficient_closed_trades'
maxDrawdown          §5.5   finite number ≥ 0
profitFactor         §5.6   number ≥ 0 | null
profitFactorReason   §5.6   null | 'no_losses' | 'no_directional_closed_trades'
                            | 'insufficient_closed_trades'
```

Structural invariants (testable): the count identity (§4);
`winRateReason ≠ null ⟺ winRate = null`; `profitFactorReason ≠ null ⟺
profitFactor = null`; every non-null number finite (§5.7).

### 5.2 Total return (D1)

```text
totalReturn := (finalEquity − initialCash) / initialCash
```

One subtraction then one division, written order, over BT2-reported
values. A fraction, not a percent (`0.125` = +12.5%). No force-close: an
open terminal position participates exactly as BT2's raw-close marking
already priced it into `finalEquity`. The denominator's domain is BT2's
`initialCash > 0` guarantee — BT3 adds no initial-capital domain. For
`N = 0`, BT2 defines `finalEquity = initialCash`, so `totalReturn = 0`
with no special case.

### 5.3 Realized / unrealized / net P&L (D2)

```text
realizedPnlTotal := the BT2-reported realizedPnlTotal          (copy, never re-summed)
unrealizedPnl    := openPositionAccounting === null
                      ? 0                                      (BT2 §5.5: flat ⇒ 0)
                      : openPositionAccounting.unrealizedPnl   (copy)
netPnl           := realizedPnlTotal + unrealizedPnl           (one IEEE addition)
```

`netPnl` is a derived convenience metric. By the BT2 master identity it
equals `finalEquity − initialCash` **in exact real arithmetic**; in
binary64 the two expressions may differ by IEEE rounding, and the BT2
§5.7 scale-aware comparator (in its overflow-safe normalized form)
bounds that difference **on the verification side only**. The product
module contains no tolerance machinery and does not compare the two.

### 5.4 Trade classification and win rate (D3)

Counts per §4's classification. Then (D3a, **as ruled by the owner
2026-08-24** — this supersedes the draft's directional-denominator
candidate):

```text
winRate := winningTrades / closedTrades                          if closedTrades > 0
        := null, winRateReason 'insufficient_closed_trades'      otherwise
```

The plain name `winRate` carries its most natural, least surprising
reading: wins over **all** closed trades. A breakeven is "not a win", so
it lowers the plain win rate; excluding breakevens from the denominator
answers a different question — the win rate **among directional
outcomes** — which, if it is ever wanted, enters as a separate future
metric `directionalWinRate = wins / (wins + losses)` (§6 Later list),
never as a redefinition of `winRate`. Consequences, all binding:
`closedTrades > 0` → a finite number in `[0, 1]`; a breakeven-only
history → `winRate = 0` with reason `null` (a valid measured zero — the
§4 null-semantics principle); `winRate` is `null` **only** when
`closedTrades === 0`. Fixture MF6 pins the ruled value `1/3` (the
rejected candidate would have read 0.5); MF5 pins the breakeven-only
zero. The counts are small integers (≤ 250 closed trades under the
≤ 500-bar contract), so the quotient is exact-operand correct rounding
into `[0, 1]`.

### 5.5 Maximum drawdown (D4)

**Max peak-to-trough percentage drawdown over the BT2 authoritative
equity series** — the only equity series there is (§1.2) — with the
running peak **seeded at `initialCash`** (owner amendment, verbatim:
"Initial capital is the time-zero equity anchor for drawdown.").
Operative fold, written order:

```text
maxDrawdown := 0;  peak := initialCash          (the time-zero anchor — D4 amendment)
for each sample E in equitySeries, in order:
    peak := max(peak, E)
    dd   := (peak − E) / peak
    maxDrawdown := max(maxDrawdown, dd)
```

The anchor is what makes a first sample **below** initial capital a
measured drawdown instead of a silently re-based peak. Under BT1 V1
execution timing the earliest fill is bar 2, so genuine chain output
always has `equitySeries[0] = initialCash` (BT2 §5.1) and the seed
coincides with the first sample; the anchor is nonetheless normative at
the metrics boundary, and fixture MF12 pins it directly. It is still a
pure projection: `initialCash` is a BT2-reported field on the §2.2
allowlist — no equity is reconstructed.

Reported as a **non-negative fraction** (`0.10` = a 10% drawdown, never
`−0.10`). An empty series (`N = 0`) yields 0 by construction — no
samples, no drawdown. A series that never trades, or never falls below
its anchored running peak, yields exactly 0. Because the series is BT2's, the
metric automatically sees cost-induced equity declines (MF9) and
open-position mark-to-market declines (MF7/MF8) — and never sees a
fabricated liquidation, because BT2 never fabricates one. Drawdown is
**not** computed from closed trades, price paths, or any reconstruction.

### 5.6 Profit factor (D5)

Closed trades only, after costs, per §4's gross sums. The case rule is
**structural — decided by counts before any division, never by
inspecting an arithmetic result** (owner ruling: PF's null must be
decided by structural conditions before the division). With the owner's
2026-08-24 reason-token refinement, the no-loss side splits three ways —
zero closed trades, breakeven-only closed trades, and no-loss histories
each carry their own token:

```text
if losingTrades > 0:
    profitFactor := grossProfitTotal / (−grossLossTotal)     (written order)
    profitFactorReason := null
else if winningTrades > 0:                    (wins, no losses)
    profitFactor := null;  profitFactorReason := 'no_losses'
else if closedTrades > 0:                     (closed trades, all breakeven)
    profitFactor := null;  profitFactorReason := 'no_directional_closed_trades'
else:                                         (no closed trades at all)
    profitFactor := null;  profitFactorReason := 'insufficient_closed_trades'
```

The refined grid:

| case | result |
|---|---|
| wins > 0 and losses > 0 | finite positive ratio |
| wins = 0, losses > 0 | `0` (a measured zero: nothing made, something lost) |
| wins > 0, losses = 0 | `null` + `'no_losses'` (undefined/unbounded — **not** a number, **not** Infinity) |
| closedTrades > 0, all breakeven | `null` + `'no_directional_closed_trades'` (never `0/0` — closed trades exist, but none carries the directional P&L a PF needs) |
| closedTrades = 0 | `null` + `'insufficient_closed_trades'` |
| a semantically-defined case whose binary64 evaluation is non-finite | fail loud per §5.7 — never a silent `null` via serialization |

The three tokens now have disjoint, individually explainable product
meanings (owner: honester than calling a breakeven-only history
"insufficient" — the trades exist; what is missing is directional P&L).

The distinction "undefined because the denominator is empty" ≠ "profit
factor = 0" is load-bearing and survives any D8 reshaping of the JSON.

### 5.7 Numerical and JSON policy (D7)

Owner constraint, verbatim:

> Every returned numeric metric must be a finite JSON-representable
> number, or the contract must explicitly represent the metric as
> unavailable/null with a reason.

Binding rules:

1. **Finite-or-reasoned-null.** Every reported metric is a finite raw
   double (transparent transport — no rounding step anywhere), or the
   contract-enumerated `null` with its reason token. `Infinity`,
   `-Infinity`, and `NaN` never appear in a result, and JSON
   serialization is never relied on to launder them into `null`.
2. **Nulls are structural.** Whether a metric is null is decided by
   counts and null-ness of BT2 fields (§5.4/§5.6), never by computing a
   quotient and checking what came out.
3. **R-FIN guard (D7a, ratified 2026-08-24).** A metric that is
   semantically defined but whose operative binary64 evaluation
   (including its intermediate sums) is non-finite **fails loud with a
   typed error for the whole `computeBacktestMetrics()` call** — the BT2
   §3 guard doctrine extended to the metrics layer. The owner-ruled
   requirement, verbatim: "If an arithmetic operation required by a BT3
   metric produces a non-finite result from otherwise valid finite BT2
   inputs, throw a typed error naming the metric/stage." (For example:
   metric `netPnl`, reason `non_finite_result`.) The exact error
   spelling narrows at implementation; no per-field
   `{value, reason: 'non_representable'}` result union exists. Owner
   rationale, recorded: this is not the `no_losses` kind of null — the
   semantics are defined, only the representation failed, and a
   partially non-representable report whose fields carry cross
   invariants (netPnl, totalReturn, the final-equity relation,
   realized/unrealized) invites consumer misuse; failing whole-call
   continues BT2's ratified non-finite-intermediate → fail-loud
   doctrine.
4. **No tolerance machinery in product code.** The BT2 comparator stays
   verification-side (§5.3); BT3 introduces no epsilon, no clamp, no
   widened arithmetic in the product module.

**Pre-registered reachability (honesty about №3).** BT2's guards bound
every *input* to finiteness but not the metrics' derived arithmetic:

- `totalReturn` is chain-reachably non-finite at extreme scale ratios —
  a huge `finalEquity` over a tiny (in-domain) `initialCash`. Fixture
  **MF13** pins this class executably: valid, fully guarded BT2 output
  whose `totalReturn` evaluation overflows, expected outcome the D7a
  typed error.
- `grossProfitTotal` / `grossLossTotal` can overflow in principle on a
  valid ledger — repeated ~`MAX_VALUE/2`-scale round trips keep every
  BT2 value finite while the same-sign partial sums grow without the
  telescoping that protects BT2's `realizedPnlTotal` (the BT2-review
  refutation of that overflow claim rests on telescoping; per-sign sums
  do not inherit it — also why `realizedPnlTotal` is copied, never
  re-summed). No fixture; the R-FIN guard covers it.
- `netPnl` is **not credibly reachable** — a correction of this
  document's pre-adjudication draft, found while constructing MF13: in
  exact real arithmetic `netPnl` telescopes to `markedValue −
  initialCash` when a position is open (and `finalCash − initialCash`
  when flat), both bounded by `MAX_VALUE`; overflow would need ULP-drift
  accumulation at `MAX_VALUE` scale across many trades. (The draft's
  claim that BT2's round-3 extreme trace overflows `netPnl` was wrong:
  that trace's `realizedPnlTotal = fl(B−A)` is *negative* — `B ≪ A` —
  so its `netPnl ≈ +MAX_VALUE/2`, finite.) The R-FIN guard covers the
  class regardless.

These scales are astronomically beyond market data; MF13 makes the one
practically constructible class executable, and nothing further is owed.
Per §1.3's proportional-review rule, a reviewer BLOCK on this axis must
present a supported BT2 authoritative result producing an observable
violation of one of these metric contracts — not further MAX_VALUE /
subnormal archaeology (owner: no mutation treadmill for this contract).

### 5.8 Per-metric availability (D6)

| metric | defined when | value when "nothing happened" |
|---|---|---|
| totalReturn | always (BT2 defines `finalEquity` for every N, `initialCash > 0`) | 0 |
| realizedPnlTotal | always | 0 |
| unrealizedPnl | always (0 when flat, BT2 §5.5) | 0 |
| netPnl | always | 0 |
| closedTrades / winningTrades / losingTrades / breakevenTrades | always | 0 — a valid measured count |
| winRate | `closedTrades > 0` (breakeven-only history → a measured `0`) | — (`null` + `'insufficient_closed_trades'` only when `closedTrades === 0`) |
| maxDrawdown | always (0 for empty or never-below-anchor series) | 0 |
| profitFactor | `losingTrades > 0` | — (reasoned `null` per §5.6 otherwise; 0 when wins = 0 with losses present) |
| Sharpe | **not in BT3** (§6) | — |

There is no generic "fewer than K trades ⇒ all null" rule; availability
is per-metric, per the §4 null-semantics principle.

---

## 6. Explicitly NOT in BT3 (owner order)

- **Sharpe ratio — DEFERRED.** Owner, verbatim: "Sharpe ratio is outside
  BT3 V1." Undecided axes, recorded so no reviewer re-imports the metric
  "for completeness": equity-return vs trade-return basis; bar-sampling
  basis; irregular-timestamp handling; annualization factor; risk-free
  rate; population vs sample variance; zero-variance semantics; minimum
  sample count. The donor's per-trade-returns + hard-coded 4% risk-free +
  annualization construction was already judged not directly adaptable in
  Phase 0. A finding that demands adding Sharpe (or any exclusion below)
  is a **scope violation by owner ruling** and is rejected on that
  ground.
- All other later metrics: CAGR, Sortino, Calmar, expectancy, exposure
  %, average trade, average win/loss, payoff ratio, consecutive
  wins/losses, SQN, volatility, and `directionalWinRate`
  (`wins / (wins + losses)` — the D3a ruling keeps this out of the plain
  `winRate`; if wanted it arrives as its own metric) — Later, each with
  its own adjudication.
- Force-closing terminal positions (BT2 §5.8 binds BT3 by name).
- Reconstructing fills, positions, costs, or equity; re-running BT1/BT2;
  any second accounting truth (§1.2).
- Changing `indicators.js` / `backtest.js` / `accounting.js` in any way.
- MCP exposure, schema work, or serving-layer wiring (BT5's gate).
- New parameters of any kind — the metrics layer takes no configuration.

---

## 7. Hand-derived fixtures

**Precision doctrine.** Every BT2-layer value below is exact in binary64
(the AF-based fixtures inherit the ratified BT2 §7 tables; the new WT
traces were chosen the same way — every quantity, cash value, and equity
sample is exactly representable and hand-recomputable). Metric values are
then pinned in one of two exact forms: **dyadic decimals** (`0.125`,
`0.25`, `0.5`, `2`, `0.03125`, …) assert bit-exactly as literals; a
**single-quotient value** whose exact ratio is not dyadic (e.g.
`−200/1000`, `880/1300`) asserts bit-exactly as *that same quotient of
the same two exact operands* — IEEE division is correctly rounded, so the
expression denotes one specific double (where the exact ratio has a short
decimal form, e.g. `−0.2` or `0.3`, the literal denotes the same double).
Non-maximal drawdown candidates sit strictly below each fixture's
maximum with exact-arithmetic gaps of at least `1/24 ≈ 0.0417` (the
smallest, in MF7), many orders of magnitude above the ~1-ULP (~10⁻¹⁶
relative) rounding of intermediate `dd` values — rounding can never
change which samples attain the maximum.

Fourteen fixtures. Twelve (MF0–MF11, MF13) are **chain fixtures**,
machine-verified **exactly** (strict `===` per field) over the CLOSED
BT1+BT2 chain at this document's base SHA — execution trace, accounting
values, and the adjudicated metric rules; MF13's pinned outcome is the
§5.7 typed error. **MF12 is a direct rule fixture** verified at the
metrics boundary (its rationale in place). Campaign scratch checker
`bt3-fixture-check.mjs`, `bt3-2026-08-24/`; the checker is verification
tooling, not product code. MF13's values are powers of two; its one
inexact difference `fl(2¹⁰⁰ − 2⁻¹⁰⁰⁰) = 2¹⁰⁰` is pinned by the half-ULP
argument in its section.

Metric rows abbreviate: tR totalReturn, rT realizedPnlTotal, uP
unrealizedPnl, nP netPnl, cT/w/l/be counts, wR winRate, mDD maxDrawdown,
PF profitFactor. Reason tokens: ND = `no_directional_closed_trades`,
IC = `insufficient_closed_trades`, NL = `no_losses`.

### MF0 — empty input (N = 0)

BT2 §5.1 defines the empty run: `equitySeries = []`, `finalEquity =
initialCash` (1000 here), `realizedPnlTotal = 0`, flat.

**Metrics:** tR 0 (= (1000−1000)/1000), rT 0, uP 0, nP 0; cT/w/l/be
0/0/0/0; wR null (IC); mDD 0 (empty fold over the anchored peak); PF
null (IC). Zero bars is a well-formed no-op end to end.

### MF1 — no trades, flat equity (over ratified AF6 / BT0 F4)

AF6: terminal entry signal never fills; costs present and unused (cash
1000, r = s = 0.25); ledger empty; equity `[1000, 1000, 1000, 1000]`.

**Metrics:** tR 0, rT 0, uP 0, nP 0; cT/w/l/be 0/0/0/0; wR null (IC);
mDD 0 (flat series at the anchor); PF null (IC). Identical metric values
to MF0 with a different, well-formed cause — and the pending signal has
no metric effect, exactly as it had no accounting effect.

### MF2 — one losing closed trade (over ratified AF1 / BT0 F1)

AF1: zero costs, cash 1000; one round trip 10 → 8, `closedTradePnl =
[−200]`; equity `[1000, 1000, 1000, 1000, 1000, 1000, 700, 800]`;
finalEquity 800.

**Metrics:** tR −200/1000 (= −0.2); rT −200, uP 0, nP −200; cT/w/l/be
1/0/1/0; wR 0 (a measured zero, not null — D6); mDD 300/1000 (= 0.3, the
bar-6 in-trade trough 700, deeper than the final 800); PF **0** (wins =
0 with a loss present: grossProfit 0, grossLossAbs 200 → 0). Pins the
PF = 0 row of the D5 grid and drawdown exceeding the realized loss.

### MF3 — one winning closed trade (new trace WT1, p = 3)

Cash 1600, r = s = 0. Channel rows show `ch[i−1]` upper/lower (BT0
notation); the entry uses the prior-window rule throughout.

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 1 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 2 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 3 | 16 | 17 | 16 | 17 | 16 / 16 | flat | 17 > 16 → **entry signal** |
| 4 | 16 | 22 | 16 | 21 | 17 / 16 | long (filled @ open 16) | 16 < 16 false → hold |
| 5 | 21 | 23 | 20 | 22 | 22 / 16 | long | 20 < 16 false → hold |
| 6 | 22 | 24 | 21 | 24 | 23 / 16 | long | 21 < 16 false → hold |
| 7 | 23 | 23 | 20 | 22 | 24 / 16 | long | 20 < 16 false → hold |
| 8 | 22 | 23 | 18 | 18 | 24 / 20 | long | 18 < 20 → **exit signal** |
| 9 | 18 | 19 | 17 | 18 | 24 / 18 | fill @ open 18 → flat | 19 > 24 false → no signal |

Channel checks: ch[3] = bars 1–3 → 17/16; ch[4] = bars 2–4 → 22/16;
ch[5] = bars 3–5 → 23/16; ch[6] = bars 4–6 → 24/16; ch[7] = bars 5–7 →
24/**20** (the lows 20/21/20 lift the band, arming the exit); ch[8] =
bars 6–8 → 24/18.

Accounting: entry qty = 1600/16 = **100**, cashAfter 0; exit proceeds
1800, cashAfter **1800**; `closedTradePnl = [+200]`; equity `[1600,
1600, 1600, 1600, 2100, 2200, 2400, 2200, 1800, 1800]`.

**Metrics:** tR **0.125**; rT +200, uP 0, nP +200; cT/w/l/be 1/1/0/0;
wR **1**; mDD **0.25** (peak 2400 at bar 6 → trough 1800 at bar 8:
600/2400 — a drawdown *inside a winning trade*); PF **null + NL** (a win
exists, no losses: the undefined/unbounded case is a reasoned null,
never Infinity, never 0 — the D5 grid's key row).

### MF4 — win + loss; drawdown with full recovery (new trace WT2, p = 2)

Cash 1600, r = s = 0.

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 1 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 2 | 16 | 17 | 16 | 17 | 16 / 16 | flat | 17 > 16 → **entry signal** |
| 3 | 16 | 18 | 16 | 17 | 17 / 16 | long (filled @ open 16) | 16 < 16 false → hold |
| 4 | 17 | 20 | 17 | 19 | 18 / 16 | long | 17 < 16 false → hold |
| 5 | 19 | 22 | 18 | 21 | 20 / 16 | long | 18 < 16 false → hold |
| 6 | 21 | 22 | 15.75 | 15.75 | 22 / 17 | long | 15.75 < 17 → **exit signal** |
| 7 | 22 | 24 | 21 | 23 | 22 / 16 | fill @ open 22 → flat | 24 > 22 → **entry signal** |
| 8 | 22 | 23 | 20 | 21 | 24 / 15.75 | long (filled @ open 22) | 20 < 15.75 false → hold |
| 9 | 21 | 22 | 19 | 20 | 24 / 20 | long | 19 < 20 → **exit signal** |
| 10 | 19 | 20 | 18 | 19 | 23 / 19 | fill @ open 19 → flat | 20 > 23 false → no signal |

Channel checks: ch[2] = bars 1–2 → 17/16; ch[3] = bars 2–3 → 18/16;
ch[4] = bars 3–4 → 20/16; ch[5] = bars 4–5 → 22/17; ch[6] = bars 5–6 →
22/15.75; ch[7] = bars 6–7 → 24/15.75; ch[8] = bars 7–8 → 24/20; ch[9] =
bars 8–9 → 23/19.

Accounting: trade 1 entry qty = 1600/16 = **100**, exit @ 22 → cash
**2200**, realized **+600**; trade 2 entry qty = 2200/22 = **100**, exit
@ 19 → cash **1900**, realized **−300**. `closedTradePnl = [+600,
−300]`; equity `[1600, 1600, 1600, 1700, 1900, 2100, 1575, 2200, 2100,
2000, 1900]`.

**Metrics:** tR **0.1875**; rT +300, uP 0, nP +300; cT/w/l/be 2/1/1/0;
wR **0.5**; mDD **0.25** (peak 2100 at bar 5 → trough 1575 at bar 6:
525/2100 — then **full recovery to a new high 2200**, and the later
peak's own worst drawdown 300/2200 ≈ 0.136 stays below it); PF **2**
(600/300 — the finite two-sided case).

### MF5 — breakeven-only (new trace WT3, p = 2)

Cash 1600, r = s = 0. Entry and exit both fill at 16.

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 1 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 2 | 16 | 17 | 16 | 17 | 16 / 16 | flat | 17 > 16 → **entry signal** |
| 3 | 16 | 17 | 16 | 16 | 17 / 16 | long (filled @ open 16) | 16 < 16 false → hold |
| 4 | 17 | 18 | 15 | 16 | 17 / 16 | long | 15 < 16 → **exit signal** |
| 5 | 16 | 17 | 15 | 16 | 18 / 15 | fill @ open 16 → flat | 17 > 18 false → no signal |

Channel checks: ch[2] = bars 1–2 → 17/16; ch[3] = bars 2–3 → 17/16;
ch[4] = bars 3–4 → 18/15.

Accounting: qty = 1600/16 = **100**; exit proceeds 1600 → cash **1600**;
realized = 1600 − 1600 = **exactly 0** (every product exact);
`closedTradePnl = [0]`; equity flat `[1600 × 6]`.

**Metrics:** tR 0, rT 0, uP 0, nP 0; cT/w/l/be **1/0/0/1**; wR **0**
with reason `null` (the D3a ruling: a closed trade exists and it was not
a win — a valid measured zero, not a null); mDD 0; PF **null + ND** (the
owner-refined token: closed trades exist, but none carries directional
P&L — never `0/0`, and honestly distinct from "no closed trades").
Distinguished from MF1 by `closedTrades = 1` **and** by `winRate` 0 vs
null and the PF reason ND vs IC — the adjudicated refinements make the
two histories observably different on three axes.

### MF6 — win + loss + breakeven (new trace WT4, p = 2) — the D3a discriminator

Cash 1600, r = s = 0. Extends WT2: after the +600 win, a breakeven round
trip (22 → 22), then the −300 loss.

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 1 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 2 | 16 | 17 | 16 | 17 | 16 / 16 | flat | 17 > 16 → **entry signal** |
| 3 | 16 | 18 | 16 | 17 | 17 / 16 | long (filled @ open 16) | 16 < 16 false → hold |
| 4 | 17 | 20 | 17 | 19 | 18 / 16 | long | 17 < 16 false → hold |
| 5 | 19 | 22 | 18 | 21 | 20 / 16 | long | 18 < 16 false → hold |
| 6 | 21 | 22 | 15.75 | 15.75 | 22 / 17 | long | 15.75 < 17 → **exit signal** |
| 7 | 22 | 24 | 21 | 23 | 22 / 16 | fill @ open 22 → flat | 24 > 22 → **entry signal** |
| 8 | 22 | 23 | 20 | 21 | 24 / 15.75 | long (filled @ open 22) | 20 < 15.75 false → hold |
| 9 | 21 | 22 | 19 | 20 | 24 / 20 | long | 19 < 20 → **exit signal** |
| 10 | 22 | 25 | 21 | 24 | 23 / 19 | fill @ open 22 → flat | 25 > 23 → **entry signal** |
| 11 | 22 | 23 | 20 | 21 | 25 / 19 | long (filled @ open 22) | 20 < 19 false → hold |
| 12 | 21 | 22 | 18 | 19 | 25 / 20 | long | 18 < 20 → **exit signal** |
| 13 | 19 | 20 | 18 | 19 | 23 / 18 | fill @ open 19 → flat | 20 > 23 false → no signal |

Channel checks (beyond MF4's): ch[9] = bars 8–9 → 23/19; ch[10] = bars
9–10 → 25/19; ch[11] = bars 10–11 → 25/20; ch[12] = bars 11–12 → 23/18.

Accounting: trade 1 as MF4 (**+600**, cash 2200); trade 2 entry qty =
2200/22 = **100**, exit @ open[10] = 22 → cash **2200**, realized
**exactly 0**; trade 3 entry qty = 2200/22 = **100**, exit @ 19 → cash
**1900**, realized **−300**. `closedTradePnl = [+600, 0, −300]`; equity
`[1600, 1600, 1600, 1700, 1900, 2100, 1575, 2200, 2100, 2000, 2200,
2100, 1900, 1900]`.

**Metrics:** tR **0.1875**; rT +300, uP 0, nP +300; cT/w/l/be
**3/1/1/1**; wR **1/3** (quotient form ≈ 0.3333) — **the D3a ruling's
pin**: one win over all three closed trades; the rejected
directional-denominator candidate would have read 0.5, and this fixture
is what forces the two apart; mDD **0.25** (same 2100 → 1575 event; the
breakeven trade adds none); PF **2** — the breakeven trade contributes
to neither gross sum, pinning its exclusion from the D5 numerator *and*
denominator (a breakeven lowers `winRate` but never touches PF).

### MF7 — open at end; later higher peak, deeper drawdown (new trace WT5, p = 3)

Cash 1600, r = s = 0. Every low after entry stays at 16, so the lower
band never lifts and no exit ever signals — the position survives to the
end while the closes swing.

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 1 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 2 | 16 | 16 | 16 | 16 | — | — | warm-up |
| 3 | 16 | 17 | 16 | 17 | 16 / 16 | flat | 17 > 16 → **entry signal** |
| 4 | 16 | 20 | 16 | 20 | 17 / 16 | long (filled @ open 16) | 16 < 16 false → hold |
| 5 | 20 | 20 | 16 | 18 | 20 / 16 | long | 16 < 16 false → hold |
| 6 | 18 | 24 | 16 | 24 | 20 / 16 | long | 16 < 16 false → hold |
| 7 | 24 | 24 | 16 | 18 | 24 / 16 | long | 16 < 16 false → hold |
| 8 | 18 | 20 | 16 | 19 | 24 / 16 | long | 16 < 16 false → hold |

Channel checks: ch[3] = bars 1–3 → 17/16; ch[4] = bars 2–4 → 20/16;
ch[5] = bars 3–5 → 20/16; ch[6] = bars 4–6 → 24/16; ch[7] = bars 5–7 →
24/16.

Accounting: entry qty = 1600/16 = **100**; open at end;
`openPositionAccounting = {quantity 100, entryCost 1600, markPrice 19,
markedValue 1900, unrealizedPnl +300}`; equity `[1600, 1600, 1600, 1600,
2000, 1800, 2400, 1800, 1900]`; finalEquity 1900.

**Metrics:** tR **0.1875**; rT 0, uP **+300**, nP +300; cT/w/l/be
0/0/0/0; wR null (IC); mDD **0.25** — peak₁ 2000 (bar 4) → 1800 gives
0.1; **higher** peak₂ 2400 (bar 6) → 1800 gives the **deeper** 600/2400
(bar-8's 500/2400 ≈ 0.208 stays below) — pinning the running-peak reset;
PF null (IC). The whole fixture is computed **with the position still
open**: drawdown from pure mark-to-market, no force-close anywhere.

### MF8 — same closed trades, different terminal mark (WT5′ = WT5 with final close 16.5)

Identical bars to MF7 except `close[8] = 16.5` (highs/lows untouched, so
the execution trace is **identical** — same entry, same held position,
same empty `closedTradePnl`). Only the mark changes:
`openPositionAccounting = {…, markPrice 16.5, markedValue 1650,
unrealizedPnl +50}`; equity `[…, 1800, 1650]`; finalEquity 1650.

**Metrics vs MF7:** rT, all counts, wR, PF — **identical** (realized
facts don't move with the mark). tR **0.03125** (vs 0.1875), uP **+50**
(vs +300), nP **+50**, mDD **0.3125** (750/2400, vs 0.25) — the
mark-dependent metrics move **only** through BT2's equity truth. This
pair is the projection proof: metrics ride on the authoritative
accounting, and nothing else.

### MF9 — costs drive drawdown (over ratified AF2 / BT0 F1)

AF2: cash 1562.5, r = s = 0.25; one round trip; `closedTradePnl =
[−1112.5]`; equity `[1562.5, 1562.5, 1562.5, 1562.5, 1000, 1000, 700,
450]`.

**Metrics:** tR −1112.5/1562.5 (= −0.712); rT −1112.5, uP 0, nP
−1112.5; cT/w/l/be 1/0/1/0; wR 0; mDD 1112.5/1562.5 (= 0.712); PF 0.
The **entry bar itself** drops equity 1562.5 → 1000 purely through
slippage+commission (the fill's mark is below its cost) — the drawdown
fold sees it because BT2's series already carries it; a
closed-trade-only or price-only "drawdown" would miss it.

### MF10 — two compounding losses (over ratified AF7, p = 2)

AF7: cash 1300, zero costs; `closedTradePnl = [−400, −480]` (qty 100
then 60 — compounding); equity `[1300, 1300, 1300, 1000, 900, 900, 900,
480, 420]`.

**Metrics:** tR −880/1300; rT −880, uP 0, nP −880; cT/w/l/be 2/0/2/0;
wR 0; mDD 880/1300 (peak 1300, trough the final 420 — no recovery); PF
**0** with a **multi-trade** gross-loss accumulation (grossLossAbs =
880 across two trades of different sizes).

### MF11 — monotone-up equity, open at end (over ratified AF5 / BT0 F5)

AF5: cash 1300, zero costs; entry 13 held to the end;
`openPositionAccounting = {quantity 100, entryCost 1300, markPrice 15,
markedValue 1500, unrealizedPnl +200}`; equity `[1300, 1300, 1300, 1300,
1500, 1500]`.

**Metrics:** tR 200/1300; rT 0, uP +200, nP +200; cT/w/l/be 0/0/0/0; wR
null (IC); mDD **0** (the series never falls below its anchored running
peak — the monotone case of D4); PF null (IC).

### MF12 — D4 anchor: initial capital is the time-zero running peak (direct rule fixture)

The one non-chain fixture, verified **directly at the metrics
boundary**: under BT1 V1 timing the earliest fill is bar 2, so genuine
chain output always has `equitySeries[0] = initialCash` (BT2 §5.1) and
can never make the anchor observable — yet the anchor is normative
(§5.5), so it is pinned with a BT2-*shaped*, master-identity-consistent
input:

```text
{ initialCash 1600, finalEquity 1600, realizedPnlTotal 0,
  closedTradePnl [], openPositionAccounting null,
  equitySeries [1200, 1600] }        (identity: 1600 = 1600 + 0 + 0 ✓)
```

**Metrics:** tR 0; rT 0, uP 0, nP 0; cT/w/l/be 0/0/0/0; wR null (IC);
PF null (IC); mDD **0.25** — the anchored peak 1600 sees the first
sample 1200 as a 400/1600 decline. An unseeded fold (peak starting at
the first sample) would report 0 and silently lose the decline below
initial capital — exactly the failure the owner's D4 amendment
forbids.

### MF13 — D7a: chain-reachable non-finite `totalReturn` → typed error (new trace WT6, p = 3)

Cash `a = 2⁻¹⁰⁰⁰`, zero costs, `b = 2¹⁰⁰` — every input value a power
of two, every BT2 value finite and guard-clean.

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | a | a | a | a | — | — | warm-up |
| 1 | a | a | a | a | — | — | warm-up |
| 2 | a | a | a | a | — | — | warm-up |
| 3 | a | 2a | a | a | a / a | flat | 2a > a → **entry signal** |
| 4 | a | 2a | a | a | 2a / a | long (filled @ open a) | a < a false → hold |
| 5 | a | a | a/2 | a | 2a / a | long | a/2 < a → **exit signal** |
| 6 | b | b | b | b | 2a / a/2 | fill @ open b → flat | b > 2a → **entry signal**; no bar 7 |

Channel checks: ch[2] = bars 0–2 → a/a; ch[3] = bars 1–3 → 2a/a; ch[4]
= bars 2–4 → 2a/a; ch[5] = bars 3–5 → 2a/(a/2). (`a/2 = 2⁻¹⁰⁰¹` is a
normal double; the terminal entry signal is unfillable and has no
accounting effect, as in AF6.)

Accounting (all §3 guards pass): entry qty = a/a = **1**, cashAfter 0;
exit proceeds b, cashAfter **b**; `closedTradePnl = [fl(b − a)] = [b]`
(2⁻¹⁰⁰⁰ is far below half an ULP of 2¹⁰⁰ — ULP(2¹⁰⁰) = 2⁴⁸ — so the
difference rounds back to b); `realizedPnlTotal = b`; equity
`[a, a, a, a, a, a, b]`; finalEquity b.

**Expected outcome:** `totalReturn = fl(fl(b − a)/a) = fl(2¹¹⁰⁰) =
+Infinity` → the call **throws the D7a typed error naming
`totalReturn`**. No metrics object exists for this input. Every other
metric of this history would have been well-defined and finite (wR 1,
PF null + NL, mDD 0, nP = b), which pins that the fault comes from
`totalReturn`'s own derived arithmetic — exactly the D7a class: valid
finite BT2 inputs, non-representable BT3 projection.

### Coverage map (owner's required list → fixtures)

| owner fixture requirement | pinned by |
|---|---|
| 1 no trades / flat equity | MF0, MF1 |
| 2 one winning closed trade (PF denominator 0) | MF3 |
| 3 one losing closed trade (PF = 0) | MF2 (single), MF10 (multi) |
| 4 win + loss (finite PF, hand-computable wR) | MF4 |
| 5 breakeven-only | MF5 |
| 6 win + loss + breakeven (wR denominator) | MF6 |
| 7 drawdown with full recovery | MF4 |
| 8 drawdown while final position open | MF7, MF8 |
| 9 same closed trades, different terminal mark | MF7 vs MF8 |
| D4: monotone up → 0; flat → 0; peak→trough→recovery; later higher peak, deeper drawdown; open-position mark-to-market; costs on the entry bar | MF11; MF1/MF5; MF4; MF7; MF7/MF8; MF9 |
| D4 amendment: `initialCash` is the time-zero running-peak anchor | MF12 (direct) |
| D3a ruling: `winRate = wins / closedTrades`; breakeven-only → 0 | MF6 (1/3); MF5 (0) |
| D5 refinement: three disjoint reason tokens | MF0/MF1 (IC), MF5 (ND), MF3 (NL) |
| D7a: defined-but-non-finite projection → whole-call typed error | MF13 |

Implementation-stage test obligations beyond these fixtures (recorded
now, designed then): a multi-win gross-profit accumulation case, the §3
typed-error paths, the structural invariants of §5.1, the §2.2
allowlist-enforcement tests (access outside the allowlist rejected), and
the `accounting.js` sha-pin.

---

## 8. Decision points — owner adjudication of 2026-08-24 (all ruled)

| # | Question | Ratified ruling |
|---|---|---|
| D1 | Total return | **APPROVE** — `(finalEquity − initialCash) / initialCash` over BT2-reported values; fraction; no force-close; N = 0 → 0; BT2's `initialCash` domain relied on, no new domain (§5.2) |
| D2 | Realized / unrealized / net | **APPROVE** — copy `realizedPnlTotal` ("BT3 must not re-sum executions or closed trades to derive `realizedPnlTotal`"); `unrealizedPnl` = BT2's value, 0 when flat; `netPnl` = one addition; comparator-checked in tests only (§2.1, §5.3) |
| D3 | Classification | **APPROVE** — sign of net after-cost `realizedPnl` per closed trade; breakeven (=== 0, `-0` included) is neither win nor loss; count identity holds (§4, §5.4) |
| D3a | winRate denominator | **CHANGE → `winningTrades / closedTrades`** — the plain name carries the plain meaning; breakeven lowers it; MF6 pins 1/3; breakeven-only → measured 0; null only when `closedTrades === 0`; the directional variant is a possible future `directionalWinRate` (§5.4, §6) |
| D4 | Max drawdown | **APPROVE WITH initial-equity anchor** — running peak seeded at `initialCash` ("Initial capital is the time-zero equity anchor for drawdown"), then peak-to-trough fraction over the BT2 `equitySeries`; non-negative; 0 for empty/never-below-anchor; MF12 pins the anchor (§5.5) |
| D5 | Profit factor | **APPROVE WITH reason-token refinement** — structural case rule decided before the division; three disjoint tokens distinguish zero closed trades / breakeven-only / no-loss histories (§5.6) |
| D6 | Insufficient-sample | **APPROVE** — per-metric availability table §5.8 (updated per D3a); zero is a measured result; no generic N-trade cutoff |
| D7 | JSON / numerical | **APPROVE** — finite-or-reasoned-null; nulls structural; no Infinity/NaN ever, no serialization laundering; no tolerance machinery in product (§5.7) |
| D7a | defined-but-non-finite evaluation | **APPROVE candidate — typed error, whole call fails loud**, with the owner's narrowed requirement wording; no per-field result union; no numerical-archaeology expansion; MF13 pins the class (§5.7) |
| D8 | result shape & vocabulary | **APPROVE** — flat 13-field shape (§5.1), camelCase conceptual names (A2 convention); final reason vocabulary locked to exactly `insufficient_closed_trades` / `no_directional_closed_trades` / `no_losses`; reason ⟺ null invariant |

All ten points were adjudicated by the owner on 2026-08-24 (§1.5
verbatim record); this revision incorporates the amendments. Nothing in
§8 remains open.

---

## 9. BT3 closure protocol (owner-ordered sequence)

Per the owner's 2026-08-24 directive — contract adjudication **precedes**
implementation and model review:

1. this contract document complete and internally consistent; every
   fixture hand-recomputable on paper **and** machine-verified exactly
   over the CLOSED BT1+BT2 chain at the base SHA (campaign
   `bt3-2026-08-24/`);
2. **owner adjudication of D1–D8 — DONE 2026-08-24
   (APPROVED-WITH-AMENDMENTS, §1.5; per owner order, no Sol/Luna review
   of the contract)**; ratification lands the docs-only PR carrying the
   adjudicated amendments (CI1 + CI2 provenance gate);
3. implementation RED→GREEN against the ratified contract: fixtures
   transcribed as the binding oracle; `accounting.js` joins the sha-pin
   set; the module carries the §2/§3 shape exactly;
4. narrow Sol + Luna implementation review (max effort) on the exact
   frozen SHA, ≤ 4 autonomous rounds (owner expectation for this scope:
   1–2), governed by the §1.3 proportional-review rule; findings that
   demand changing CLOSED BT0/BT1/BT2 semantics, adding a §6 exclusion
   (Sharpe included), force-closing a position, or independently
   re-deriving accounting values are scope violations by owner ruling;
5. owner adjudication of surviving findings → merge GO (CI1 + CI2).

Any post-ratification semantic departure requires a BT3 amendment —
never an in-flight reinterpretation.
