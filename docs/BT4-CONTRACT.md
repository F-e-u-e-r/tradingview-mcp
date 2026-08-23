# BT4 — Strategy generalization & second-strategy proof contract (V1)

**Status:** design-only proposal for owner adjudication. **Zero product
code.** BT4 implementation opens only after this document is ratified; the
decision points in §8 are the owner's to adjudicate.

**Base:** `main @ 7e220eb48ae0846d91e6522268f59e6cec40cb32` — BT0 contract
ratified (`438a59e`), BT1 kernel CLOSED (`0d07902`), BT2 CLOSED (contract
`04dc9fd`, impl `57f1915`), BT3 CLOSED (contract `d2c60b3`, impl
`cf197a5`, merged `7e220eb`). Pin/regression confirmation for this base:
the offline suite (481/481 — every pure/mocked file, including the A1/BT1
sha-pins, the AF oracle, and the MF oracle) runs green at exactly this
SHA locally, and CI1 run 32664450389 validated the full suite (the
environment-sensitive `mcp_boundary` file included) on this same tree in
a clean runner.

---

## 1. Governance record

### 1.1 Charter

Owner KICKOFF, 2026-08-24, verbatim:

> GO — begin BT4 contract/design only from canonical
> `main @ 7e220eb48ae0846d91e6522268f59e6cec40cb32`. Draft
> `docs/BT4-CONTRACT.md` with no product-code changes. Define the pure
> strategy/engine ownership boundary, minimal signal vocabulary, minimal
> flat/long state visibility, structurally enforceable no-lookahead rule,
> Donchian observational-equivalence requirement, and a second-strategy
> acceptance proof. Use SMA crossover as the candidate second strategy
> unless orientation finds a concrete repo-level reason it is unsuitable.
> Return with the D-points before implementation or model review.

What BT4 proves (owner, verbatim):

> BT1–BT3 已建立的 execution / accounting / metrics machinery，能否在不修
> 改其語意的前提下，從 Donchian-specific strategy dependency 抽成一個可替
> 換的 pure strategy boundary。

The single question this milestone answers (owner, verbatim):

> 第二個策略能否接入，而 execution / accounting / metrics kernels完全不用
> 因策略種類而改語意？

And the standard it is held to (owner, verbatim):

> 這樣 BT4才是在證明「我們真的有 backtest engine」，而不是把 Donchian函數
> 換個名字叫 framework。

### 1.2 What BT4 is NOT (owner order, verbatim list)

Not a strategy marketplace; not arbitrary user code; not a DSL; not MCP
exposure; not optimization; not a parameter sweep; not portfolio; not
live trading.

### 1.3 Standing orchestration rules (in force, unchanged)

1. **Review budget:** ≤ 4 autonomous rounds, round 5+ needs owner
   reauthorization; owner expectation for this scope: 1–2.
2. **Frozen-SHA immutability / TORN** as ratified.
3. **Proportional review:** executable contract violations block;
   mutation-test completeness by itself does not. Owner order for BT4
   review focus: no-lookahead; strategy/engine ownership boundary;
   Donchian observational equivalence; whether the second strategy
   forces special cases; no arbitrary-code capability. **No numerical
   mutation archaeology** (owner, verbatim: 「不要再做 numerical
   mutation archaeology」).

### 1.4 Closed ground truth this contract builds on

- **BT0 §4** execution semantics (event order, strict-inequality signal
  rules as *Donchian's own* rules, next-bar raw-open fills, terminal
  state, warm-up arithmetic) — CLOSED; F1–F12 are the behavioral oracle.
- **BT1** kernel (`donchianBreakoutBacktest`) — CLOSED semantics; its
  *implementation file* is what BT4 generalizes (§7/D8 governs how).
- **BT2** accounting and **BT3** metrics — CLOSED in both semantics and
  files; BT4 consumes them untouched (D7 is precisely the proof that it
  can).
- **A1** indicator kernel — CLOSED and byte-pinned; `sma()` returns
  null-prefixed bar-inclusive window means (First (period−1) values are
  null), which is the exact shape the D6 second strategy needs — no new
  indicator work.

---

## 2. Architecture

```text
                 ┌───────────────────────────────────────────┐
                 │  strategy (pure): evaluate(view) → signal  │
                 │   • Donchian adapter (BT1 rules verbatim)  │
                 │   • SMA-crossover (the D6 second strategy) │
                 └──────────────────▲────────────────────────┘
                          view:    │ signal ∈ {ENTER_LONG,
                          bars ≤ i │           EXIT_LONG, NONE}
                          flat/long│
bars ──▶ generalized engine (BT0 §4 semantics, strategy-consulted)
              │  signal → pending → next-bar-raw-open fill →
              │  position transition → terminal state
              ▼
        execution result ──▶ BT2 accounting (CLOSED) ──▶ BT3 metrics (CLOSED)
```

- The engine owns, exclusively (owner, verbatim): "signal → pending →
  next-bar-open execution → position transition"。 One position,
  long-only, no pyramiding, no fabricated terminal fill, terminal state
  reported — all BT0 §4, unchanged.
- Strategies are pure evaluators in the same zero-capability class as
  A1/BT1/BT2/BT3: no I/O, no clock, no randomness, no mutable state, no
  engine internals. A strategy MAY import CLOSED A1 kernels (that is how
  BT1 consumes `donchian()` today; the Donchian adapter and the SMA
  strategy both do).
- Conceptual layout (names conceptual, structure binding — A2
  convention): the generalized engine plus two strategy definitions;
  `donchianBreakoutBacktest(bars, period)` remains exported with its
  exact current signature and behavior (D8a).

### 2.1 Contract-stage machine evidence (pre-registered)

The campaign scratch checker (`bt4-fixture-check.mjs`,
`bt4-2026-08-24/`; verification tooling, not product code) already
demonstrates, against the REAL closed kernels at this base SHA:

1. **D5 feasibility:** a reference implementation of the §2 engine +
   the Donchian adapter reproduces the CLOSED BT1 kernel
   **bit-identically on 16/16 ratified traces** (BT0 F1–F12 including
   both F9 empty/short cases, BT3's WT1 and WT5, and the AF7 p=2
   two-trade sequence).
2. **D4 executable form:** signal-prefix determinism holds on all 10
   truncations of the SF-core fixture.
3. **D7 shape:** the SMA-crossover execution flows through the REAL
   CLOSED `accountBacktest` and `computeBacktestMetrics` with
   hand-derived values, zero special cases (§6 SF9).
4. Every §6 SF signal table below is machine-verified with the REAL A1
   `sma()`.

---

## 3. The strategy boundary (D1, D2, D3)

### 3.1 D1 — Ownership semantics

Conceptually `strategy.evaluate(view) → signal` (the JS spelling is an
implementation-stage decision; the semantics below are what ratifies).

Information rule (owner, verbatim):

> Strategy只能從**已完成、且被 engine允許看到的 historical
> information**產生 signal。

A strategy must NOT (owner list, binding): fill itself; change cash;
change position; collect commission; decide an execution price;
force-close; write accounting; see a future bar. The engine continues to
own signal → pending → next-bar-open execution → position transition.
Consequently a strategy cannot express quantity, price, or timing — only
the three-token intent of §3.2 — and every execution consequence
(fill bar, fill price, position machine, terminal handling) is decided
by the engine under BT0 §4 exactly as today.

**D1a — inapplicable signals (sub-decision).** Candidate: an
inapplicable signal (`ENTER_LONG` while long, `EXIT_LONG` while flat) is
a **defined no-op** — no action, no error. This mirrors CLOSED BT1
§4.2's state-dependence (entry-shaped breakouts while positioned are
ignored — F7/F11) and keeps the engine total. Alternative: typed error
(strict protocol violation). The candidate is what the §2.1 equivalence
evidence ran under.

**Consultation range (part of D1).** Candidate: the engine consults the
strategy at the completion of **every** bar (after the step-1 fill, per
BT0 §4.1), and warm-up is the strategy's own business — it returns
`NONE` until its indicators are defined. The Donchian adapter
internalizes BT1's `i ≥ p` eligibility; observable behavior is identical
(§2.1 evidence — F3/F8/F9 among the 16 traces). Alternative: an
engine-level per-strategy warm-up parameter — rejected as candidate
because it leaks strategy knowledge into the engine.

### 3.2 D2 — Signal vocabulary (minimal, closed)

```text
ENTER_LONG | EXIT_LONG | NONE
```

Nothing else in V1 — the model remains long-only, one position, no
pyramiding, no shorting, so this vocabulary is complete. In the §4.5
result model the kinds map `ENTER_LONG → 'entry'`, `EXIT_LONG →
'exit'`; the executions/closedTrades/terminal-state shapes are BT0 §4.5
verbatim, unchanged. Explicitly excluded from the vocabulary (owner
order): BUY/SELL quantity, limit/stop, target price, confidence,
position sizing — "那些會污染 execution contract"。

### 3.3 D3 — Position visibility (minimal state)

The view carries the engine position state as exactly one of
`flat | long` — nothing more. Rationale (owner): many strategies need
state-dependent rules (BT1's own §4.2 is state-dependent; the SMA
strategy exits only while long). The strategy must NOT see (owner list,
binding): cash; realized P&L; equity; commission history;
profitability — otherwise "strategy abstraction會變成「回測結果反餵策
略」" — the accounting result must never feed back into signal
generation. The BT2 result object is never handed to a strategy.

---

## 4. Data visibility and no-lookahead (D4)

At the evaluation of bar `i` (BT0 §4.1 step 2), the strategy's view
exposes exactly the completed bars `0..i` — bar `i` itself is completed
at that moment (BT0 §3), and bar `i+1` is **unreachable**, not merely
unread. Owner invariant, verbatim:

> No-lookahead must be structural or executable-testable, not merely
> documented.

Binding, in two layers:

1. **Structural:** the view is bounded — the engine never hands the
   full input array with an honor-system index. The concrete shape
   (bounded copy, guarded accessor, or equivalent) is an
   implementation-stage decision; what ratifies is that bars beyond `i`
   are not reachable through any surface the view offers.
2. **Executable, two forms (both mandatory in the test suite):**
   - **Signal-prefix determinism** (strategy-agnostic): for every `k`,
     running the engine over `bars[0..k)` produces the same signal at
     each bar as the full-array run — the signal at bar `i` is a
     function of bars `0..i` only. (§2.1: already demonstrated 10/10 on
     SF-core.)
   - **Adversarial probe** (fixture SF7): a spy strategy that attempts
     to read beyond its window through every surface of the view must
     be observably unable to; a hypothetical future-reading strategy
     must make the test go RED.

**Bar-`i` visibility note (pre-registered against a foreseeable review
confusion).** Donchian's rule consults the *prior-window* channel
`ch[i−1]` because that is Donchian's own ratified signal semantics (the
donor's PR #71 pathology was the signal bar entering **its own breakout
threshold** — a self-referential band, zero trades silently). It is not
a general prohibition on reading completed bar `i`: BT1 itself compares
bar `i`'s high/low against that prior channel. The SMA strategy's use of
`sma[i]` (which includes `close[i]`, a completed value) alongside
`sma[i−1]` is legitimate completed-information usage with no
self-reference pathology. A finding that demands strategies be blinded
to completed bar `i` is a BT0-semantics change and out of scope.

---

## 5. Donchian observational equivalence (D5)

Owner requirement, verbatim:

> Donchian behavior must be observationally identical to BT1 before
> refactor.

Binding golden regression:

```text
old Donchian path (CLOSED BT1 kernel)
==
generalized engine + Donchian strategy
```

bit-identical on: prior-window band; completed-bar signal; next-bar
raw-open fill; final unfillable signal; terminal open position;
execution count vs closed-trade count (the owner's six-point list) —
concretely, the **entire existing oracle keeps passing unchanged**: BT0
F1–F12 / BT1's 28 kernel tests, BT2's AF suite, BT3's MF suite. This is
regression of a CLOSED layer, **not** a re-review of Donchian semantics;
a finding that re-litigates Donchian rules is a scope violation. §2.1
records the contract-stage feasibility evidence (16/16 traces through a
reference engine).

---

## 6. The second strategy: SMA crossover (D6)

**Orientation verdict (per the kickoff's condition):** suitable — no
repo-level obstacle. A1's CLOSED `sma()` provides exactly the needed
values (bar-inclusive window mean, null warm-up prefix, typed-error
period validation); no new indicator, no volume/session data, entry and
exit both exist, the signal shape (level crossing) is structurally
different from Donchian's breakout, and hand-exact fixtures are easy
(integer closes make SMA-2 exact halves and SMA-4 exact quarters).

### 6.1 Signal rule (candidate)

Parameters: integer periods `fastPeriod < slowPeriod` (violation = typed
error at construction). Let `f = sma(closes, fastPeriod)`,
`s = sma(closes, slowPeriod)` over the visible window at bar `i`:

```text
if f[i], s[i], f[i−1], s[i−1] are not all defined (warm-up) → NONE
flat:  ENTER_LONG  iff  f[i] > s[i]  AND  f[i−1] ≤ s[i−1]
long:  EXIT_LONG   iff  f[i] < s[i]  AND  f[i−1] ≥ s[i−1]
otherwise → NONE
```

Owner-preferred semantics, verbatim: "true crossing event，equality不構
成 crossing" — operationalized as:

- **equality at bar `i` never signals** (`f[i] == s[i]` satisfies
  neither strict inequality) — SF-core i=4 and SF5 i=6 pin both sides;
- **a crossing is an event, not a state**: being above/below without
  having crossed does not signal (SF2b: a cross that happens inside
  warm-up is missed by design and never fires late);
- the **previous side is inclusive** (`≤`/`≥`): touching the slow SMA
  from below on `i−1` and closing above on `i` IS a crossing (this is
  the owner's sketch — "fast SMA > slow SMA 且前一時點不高於 → enter").

**D6a — prior-side equality (sub-decision).** Candidate:
prev-inclusive as above. Alternative: strict both sides
(`f[i−1] < s[i−1]` for entry, `>` for exit), under which an
exact-touch-then-cross is not a crossing. SF-core i=5 discriminates
(fPrev = sPrev = 10 exactly: candidate → ENTER, alternative → NONE).

### 6.2 Hand-derived signal fixtures (machine-verified §2.1)

**SF-core** — warm-up, equality, prev-inclusive cross, hold, cross-down
(fast 2 / slow 4; integer closes; every SMA value exact):

| i | O | H | L | C | f₂ | s₄ | position | signal |
|---|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | flat | NONE (warm-up) |
| 1 | 10 | 10 | 10 | 10 | 10 | — | flat | NONE (warm-up) |
| 2 | 10 | 10 | 10 | 10 | 10 | — | flat | NONE (warm-up) |
| 3 | 10 | 10 | 10 | 10 | 10 | 10 | flat | NONE (s₄[2] null) |
| 4 | 10 | 10 | 10 | 10 | 10 | 10 | flat | NONE (f = s — equality never signals) |
| 5 | 10 | 12 | 10 | 12 | 11 | 10.5 | flat | **ENTER_LONG** (11 > 10.5; prev 10 ≤ 10) |
| 6 | 14 | 15 | 13 | 14 | 13 | 11.5 | long (filled @ open 14) | NONE (still-bullish while long — no re-enter) |
| 7 | 14 | 15 | 13 | 14 | 14 | 12.5 | long | NONE |
| 8 | 12 | 12 | 9 | 10 | 12 | 12.5 | long | **EXIT_LONG** (12 < 12.5; prev 14 ≥ 12.5) |
| 9 | 8 | 9 | 5 | 6 | 8 | 11 | flat (filled @ open 8) | NONE |

Executions: entry s5→f6 @ 14; exit s8→f9 @ 8; one closed trade; flat
end; no pending.

**SF2b** — crossing inside warm-up never fires late: closes
[10, 10, 12, 14, 16] (f₂ = ·,10,11,13,15; s₄ = ·,·,·,11.5,13): fast is
already above slow at the first fully-defined bar with fPrev > sPrev —
a state, not an event → all NONE, empty result, despite f > s
throughout eligibility.

**SF5** — equality while long is not an exit (fast 2 / slow 4):

| i | O | H | L | C | f₂ | s₄ | position | signal |
|---|---|---|---|---|---|---|---|---|
| 0–4 | 10 | 10 | 10 | 10 | →10 | →10 | flat | NONE |
| 5 | 10 | 12 | 10 | 12 | 11 | 10.5 | flat | **ENTER_LONG** |
| 6 | 8 | 10 | 7 | 8 | 10 | 10 | long (filled @ open 8) | NONE (f = s — touch is not a cross) |
| 7 | 7 | 8 | 5 | 6 | 7 | 9 | long | **EXIT_LONG** (7 < 9; prev 10 ≥ 10) |
| 8 | 6 | 7 | 5 | 6 | 6 | 8 | flat (filled @ open 6) | NONE |

**SF6** — final-bar crossover is terminal-unfillable: SF-core truncated
to bars 0–5 → ENTER_LONG at i=5, no bar 6 → zero executions, pending
`{entry, signalIndex 5, unfillable}` (BT0 §4.3/§4.4 unchanged).

**SF9** — end-to-end acceptance shape (D7): SF-core with cash 1400,
zero costs, through the REAL CLOSED BT2+BT3: qty = 1400/14 = 100 exact;
exit → cash 800; `closedTradePnl = [−600]`; equity `[1400×8, 1000,
800]`; metrics totalReturn −600/1400, counts 1/0/1/0, winRate 0,
maxDrawdown 600/1400, profitFactor 0 — no special case anywhere.

**Precision doctrine:** integer closes make every SMA value above an
exact half (fast 2) or quarter (slow 4) in binary64; the accounting and
metric values are exact or single-quotient forms per the BT2 §5.10 /
BT3 §7 doctrines.

---

## 7. Second-strategy acceptance and containment (D7, D8)

### 7.1 D7 — Acceptance = falsification proof

Owner, binding: acceptance is NOT "interface written"; it is

> 加入第二策略後，不修改 execution/accounting/metrics semantics即可完整
> 跑完。

If wiring the SMA-crossover strategy forces any of: changed fill
timing; changed position machine; special-cased accounting; changed BT3
metrics — the abstraction has failed and BT4 does not close. The second
strategy is the falsification instrument, not a feature.

### 7.2 D8 — Closed-artifacts containment and pin migration

Owner distinction, verbatim:

> implementation file may change
> semantic contract may not.

| artifact | BT4 disposition |
|---|---|
| BT0 §4 execution semantics | untouched; F1–F12 + BT1's 28 tests = canonical behavioral oracle (D5) |
| `src/analytics/indicators.js` (A1) | byte-untouched; sha-pin **unchanged** |
| `src/analytics/accounting.js` (BT2) | byte-untouched; BT3's sha-pin **unchanged**; AF oracle unchanged |
| `src/analytics/metrics.js` (BT3) | byte-untouched; MF oracle unchanged |
| `src/analytics/backtest.js` (BT1) | **may change, behavior-preserving-generalization only** (D5 gate). BT2's D3 byte-pin of this file is **migrated**: the behavioral oracle is the containment instrument, and the pin literal is updated **in the same reviewed commit** — exactly the protocol its own failure message prescribes ("a change requires owner adjudication, then update this pin in the same reviewed commit"); ratifying this contract is that adjudication |
| new BT4 modules (engine seam, strategies) | pinned at BT4 closure like every closed layer before them |

**D8a — public-surface continuity (sub-decision).** Candidate:
`donchianBreakoutBacktest(bars, period)` remains exported with its exact
signature and behavior — a thin wrapper over the generalized engine +
Donchian adapter — so BT2's and BT3's test imports, and any BT0-era
reading of the result model, continue to hold without edits beyond the
one pin literal. Alternative: rename/split the export and sweep every
consumer — rejected as candidate (louder diff, zero semantic gain).

---

## 8. Scope freeze (owner order)

BT4 V1 contains exactly:

```text
generic pure strategy boundary
Donchian adapter
SMA-crossover second strategy
existing execution engine (generalized, behavior-preserving)
existing BT2 accounting
existing BT3 metrics
```

Explicitly NOT in BT4 (owner list, verbatim): VWAP strategy; RSI
strategy; strategy composition; arbitrary indicator params framework;
JSON strategy definitions; MCP schema; user-supplied JS; dynamic eval;
optimizer; multi-strategy portfolio. A reviewer demand for any of these
— or for Sharpe or any BT3 §6 deferred metric — is scope expansion /
RECORD, not a blocker.

---

## 9. Fixture obligations (owner's ten, mapped)

| # | owner requirement | pinned by |
|---|---|---|
| 1 | Donchian equivalence | D5 golden oracle (all existing suites) + §2.1 evidence (16/16) |
| 2 | SMA warm-up → no signal | SF-core i≤3, SF2b |
| 3 | below → crosses above → one enter | SF-core i=5 |
| 4 | equality boundary → no false crossover | SF-core i=4 (flat), SF5 i=6 (long) |
| 5 | already-long repeated bullish → no re-enter | SF-core i=6/7 |
| 6 | cross below while long → exit | SF-core i=8, SF5 i=7 |
| 7 | final-bar crossover → terminal unfilled | SF6 |
| 8 | no-lookahead adversarial | D4 spy probe (implementation-stage test) + prefix determinism (§2.1, 10/10) |
| 9 | same signals → identical execution regardless of strategy identity | SF8 (scripted-stub replay == adapter; §2.1 verified) |
| 10 | second strategy flows through BT2+BT3 with no special cases | SF9 (§2.1 verified through the REAL closed kernels) |

Implementation-stage test obligations recorded now: the SF7 spy-probe
fixture (a future-reading strategy must turn the suite RED); the D5
golden regression wiring; strategy purity/static invariants in the house
style (zero capability, no module state); the D8 pin migration in the
same reviewed commit.

---

## 10. Decision points for owner adjudication

| # | Question | Candidate (this document) | Alternative |
|---|---|---|---|
| D1 | Strategy boundary | pure `evaluate(view) → signal`; owner's prohibition list binding; engine owns signal→pending→next-open-fill→position (§3.1) | — |
| **D1a** | **inapplicable signal** | **defined no-op** (mirrors BT1 state-dependence; engine total; §2.1 evidence ran under it) | typed error (strict protocol) |
| **D1b** | **consultation range** | **engine consults every bar; warm-up internal to the strategy** (Donchian adapter internalizes `i ≥ p`; equivalence machine-verified) | engine-level warm-up parameter (leaks strategy knowledge into the engine) |
| D2 | Signal vocabulary | `ENTER_LONG / EXIT_LONG / NONE` only; maps to §4.5 kinds; no quantity/price/confidence (§3.2) | — |
| D3 | Position visibility | `flat / long` only; the owner's forbidden list (no cash/P&L/equity/costs/profitability); BT2 result never reaches a strategy (§3.3) | — |
| D4 | No-lookahead | structural bounded view + two executable forms (prefix determinism, strategy-agnostic — demonstrated 10/10; adversarial spy probe) (§4) | — |
| D5 | Donchian equivalence | bit-identical golden regression over the entire existing oracle; §2.1 contract-stage evidence 16/16; not a Donchian re-review (§5) | — |
| D6 | Second strategy | **SMA crossover** (fast < slow, A1 `sma`, orientation: suitable); crossing-is-an-event; equality at `i` never signals (§6) | — (owner names replacement only if orientation had failed — it did not) |
| **D6a** | **prior-side equality** | **prev-inclusive** (`≤`/`≥` — the owner sketch; touch-then-cross IS a crossing; SF-core i=5 discriminates) | strict both sides (touch-then-cross is not a crossing) |
| D7 | Acceptance | the second strategy as falsification proof: zero semantic edits to execution/accounting/metrics, end-to-end (SF9) (§7.1) | — |
| D8 | Containment & pin migration | semantics closed / files per the §7.2 table; BT2's `backtest.js` byte-pin migrated to the behavioral oracle + same-reviewed-commit pin update; A1/BT2/BT3 pins unchanged | — |
| **D8a** | **public surface** | **keep `donchianBreakoutBacktest(bars, period)` exported, adapter-backed, byte-for-byte behavioral** | rename/split export + full consumer sweep |

D1–D8 track the owner's kickoff point by point; D1a, D1b, D6a and D8a
are the sub-choices this drafting surfaced.

---

## 11. BT4 closure protocol (owner-ordered sequence)

1. this contract document complete and internally consistent; every SF
   table hand-recomputable **and** machine-verified against the real A1
   kernel, and the §2.1 equivalence/determinism/end-to-end evidence
   reproduced by the campaign checker at the base SHA;
2. **owner adjudication of D1–D8a** (no model review of the contract
   before it; no implementation before ratification); ratification lands
   the docs-only PR (CI1 + CI2 provenance gate);
3. implementation RED→GREEN against the ratified contract: D5 golden
   regression first (the whole existing oracle green through the
   generalized engine), SF fixtures transcribed as the binding oracle,
   the SF7 spy probe, the D8 pin migration in the same reviewed commit;
4. narrow Sol + Luna implementation review (max effort) on the exact
   frozen SHA, ≤ 4 autonomous rounds (owner expectation 1–2), governed
   by §1.3 — review foci: no-lookahead, ownership boundary, Donchian
   observational equivalence, no second-strategy special cases, no
   arbitrary-code capability; no numerical mutation archaeology;
5. owner adjudication of surviving findings → merge GO (CI1 + CI2).

Any post-ratification semantic departure requires a BT4 amendment —
never an in-flight reinterpretation.
