# BT4 — Strategy generalization & second-strategy proof contract (V1)

**Status:** owner-adjudicated 2026-08-24 —
**APPROVED-WITH-MINOR-PRECISION** (§1.5); this revision incorporates the
ruled precisions. **Zero product code.** Ratification lands by merging the
docs-only PR (CI1 + CI2 provenance gate); BT4 implementation and model
review open only after that merge. No decision point in §10 remains open.

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

### 1.5 Adjudication record (owner, 2026-08-24)

Owner decision, verbatim:

> **BT4 contract semantics APPROVED-WITH-MINOR-PRECISION. Ratify defined
> no-op handling for inapplicable signals; consult the strategy on every
> eligible bar with warm-up owned entirely by the strategy; use
> prev-inclusive/current-strict SMA crossover semantics; preserve
> `donchianBreakoutBacktest()` as an adapter-backed compatibility export;
> and treat strategy identity as unobservable downstream once a signal is
> produced. Amend the contract accordingly, re-run the design checker,
> then open the docs-only ratification PR. No product implementation or
> model review yet.**

Every D-point candidate in §10 was approved; the four open sub-decisions
were ruled D1a = **defined no-op**, D1b = **every bar, warm-up owned by
the strategy**, D6a = **prev-inclusive / current-strict**, D8a = **keep
the compatibility export**. The precisions the same decision attached —
each written into the normative section it governs, not left in chat —
are:

1. **D1 (§3.1):** the boundary is semantic, not a locked JS spelling.
2. **D1a (§3.1):** the no-op is *strict* — five named negatives.
3. **D1b (§3.1):** the warm-up outcome is `NONE`; the engine is never
   told a strategy's periods.
4. **D2 (§3.2):** signals describe intent, not orders.
5. **D4 (§4):** signal-prefix determinism is promoted from a
   demonstration to a **normative acceptance criterion**.
6. **D5 (§5):** the equivalence comparison's six observable dimensions
   are named; no new abstraction if the existing oracle already covers
   them.
7. **D6a (§6.1a):** the current-vs-previous equality wording is made
   explicit so the two halves of the rule cannot read as contradictory.
8. **D7 (§7.1):** identical signal sequence ⇒ identical downstream
   output, whatever produced it.
9. **New invariant (§7.3):** strategy identity must not be observable
   downstream of signal production — recorded as an invariant, **not** as
   a new decision point.

Process rulings attached to the same decision: **no Sol/Luna review of
the contract** before ratification (the precisions are written back, then
the docs-only PR opens); no product implementation and no model review
until the ratification merge; `deaba30` is **not** the final ratified SHA
— the amended document, re-checked, becomes the PR head. Contract-stage
machine evidence disposition (owner, verbatim): "**VALID CONTRACT
FEASIBILITY EVIDENCE / not implementation closure evidence**" — the
reference engine is a design instrument, the implementation stage
re-establishes everything RED→GREEN, and **no reviewer campaign is opened
against the reference engine**.

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
- **The architecture line (owner, binding; normative text in §7.3).**
  Signal production is where the strategy-specific world ends: strategy
  identity, name, and kind are permitted to matter in exactly three
  places — signal generation, strategy parameters, warm-up — and are
  unobservable everywhere downstream (engine → BT2 → BT3).

### 2.1 Contract-stage machine evidence (pre-registered)

The campaign scratch checker (`bt4-fixture-check.mjs`,
`bt4-2026-08-24/`; verification tooling, not product code) — **rev 2,
10/10 after this adjudication** — demonstrates, against the REAL closed
kernels at this base SHA:

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
5. **SF8 — §7.3 shape:** a scripted stub replaying a captured signal
   stream is indistinguishable from the real strategy at the engine
   boundary.
6. **SF10 — D6a reconciliation** (added by this adjudication): both
   halves of the ruled equality wording hold in one trace, on exact
   values.
7. **D1a strictness** (added by this adjudication): replacing every
   injected inapplicable signal with `NONE` leaves the execution result
   *and* the REAL CLOSED BT2 accounting bit-identical.

A companion falsifiability probe (`bt4-red-probe.mjs`, 4/4) shows the
two added checks can actually go RED: a non-strict current side flips
SF10 i=4, a strict previous side flips SF10 i=5, a synthetic rejection
record breaks the D1a comparison, and a leaked pending order is refused
outright by CLOSED BT2 with a typed error.

**Owner's disposition of all of the above (verbatim, binding):**

> **VALID CONTRACT FEASIBILITY EVIDENCE / not implementation closure
> evidence.**

The reference engine is a design instrument. It does not close anything,
it is not product code, **no reviewer campaign is opened against it**,
and the implementation stage re-establishes every one of these
properties RED→GREEN against the real modules.

---

## 3. The strategy boundary (D1, D2, D3)

### 3.1 D1 — Ownership semantics

Conceptually `strategy.evaluate(view) → signal`. **This notation is
conceptual, and deliberately not a locked JS API spelling** (owner
precision, verbatim):

> **The normative contract is semantic; the concrete JavaScript
> function/object shape may vary provided the same visibility and
> ownership invariants are executable-testable.**

So a reviewer may not demand a particular function name, arity, or
object shape; a reviewer may demand that the visibility and ownership
invariants below hold and are testable by execution.

Information rule (owner, verbatim):

> Strategy只能從**已完成、且被 engine允許看到的 historical
> information**產生 signal。

A strategy must NOT own (owner ratification list, binding): **fill
timing; execution price; cash; commission/slippage; accounting;
force-close; future data; order sizing.** The engine continues to own
signal → pending → next-bar-open execution → position transition —
which the owner names the most important separation in BT4 (「這是 BT4
最重要的 separation」). Consequently a strategy
cannot express quantity, price, or timing — only the three-token intent
of §3.2 — and every execution consequence (fill bar, fill price,
position machine, terminal handling) is decided by the engine under BT0
§4 exactly as today.

**D1a — inapplicable signals — RULED: defined no-op.** An inapplicable
signal is a **defined no-op**, never an error:

```text
flat + EXIT_LONG   → no state change
long + ENTER_LONG  → no state change
```

The governing semantics (owner, verbatim):

> **strategy proposes intent; engine remains authoritative over whether
> that intent is applicable in the current position state.**

The typed-error alternative is **rejected**, for reasons the owner
recorded: a merely redundant Donchian signal would change CLOSED
historical behavior; the strategy would have to know *more* engine
applicability policy, not less; and it would turn a signal suggestion
into a strict imperative command. This also mirrors CLOSED BT1 §4.2's
state-dependence (entry-shaped breakouts while positioned are ignored —
F7/F11), keeps the engine total, and is the semantics the §2.1
equivalence evidence ran under.

**Strictness lock (owner, binding).** The no-op must be a *behavioral*
no-op — an inapplicable signal produces:

- **no pending order**;
- **no execution**;
- **no counter increment**;
- **no accounting effect**;
- **no synthetic rejection record**.

Operationally: for any bar sequence, replacing an inapplicable signal
with `NONE` must leave the entire execution result — and everything
BT2/BT3 derive from it — bit-identical. Anything less 「就不叫
behavioral no-op」 (owner). §2.1 item 7 pins exactly this, and the
falsifiability probe recorded there shows the pin can go RED.

**D1b — consultation range — RULED: every bar; warm-up owned by the
strategy.** Binding form (owner, verbatim):

> Engine consults the strategy on every eligible completed bar; strategy
> owns its own warm-up/insufficient-history logic.

The consultation happens at the completion of **every** bar (after the
step-1 fill, per BT0 §4.1). Warm-up is expressed as an outcome, not as a
skipped call:

```text
insufficient history  →  NONE
```

— **not** "the engine does not call the strategy". The Donchian adapter
internalizes BT1's `i ≥ p` eligibility and the SMA strategy its own
null-prefix handling; observable behavior is identical (§2.1 evidence —
F3/F8/F9 among the 16 traces).

**No-leak lock (owner, binding).** None of `period`, `fastPeriod`,
`slowPeriod`, `minimumBars` — or any successor — may reach the generic
engine. The engine-level warm-up parameter is **rejected**: it leaks
strategy knowledge into the engine, and the failure mode it opens is the
one that would void the milestone (owner, verbatim):

```text
if strategy === Donchian ...
if strategy === SMA ...
```

> 那 BT4就失敗了。

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

**Reading rule (owner precision, binding, verbatim):**

> **Signals describe direction/state intent, not orders.**

`ENTER_LONG` is not a buy order and must never be read as one — the name
is intent vocabulary, and the precision exists so that nobody later
argues from the name that order semantics belong inside a strategy.

### 3.3 D3 — Position visibility (minimal state)

The view carries the engine position state as exactly one of

```text
flat
long
```

— nothing more. Rationale (owner): many strategies need state-dependent
rules (BT1's own §4.2 is state-dependent; the SMA strategy exits only
while long). The strategy must NOT see (owner ratification list,
binding): **entry price; cash; current equity; realized/unrealized P&L;
costs; trade count; profitability.** Otherwise "strategy abstraction會
變成「回測結果反餵策略」" — the accounting result must never feed back
into signal generation. The BT2 result object is never handed to a
strategy.

The concrete failure this closes (owner): a strategy that can see its own
P&L starts writing rules like

> 「虧錢就不出場」

— decisions driven by backtest accounting feedback, which pollutes the
engine/strategy boundary. Position metadata beyond `flat | long` is
therefore not an implementation-stage judgement call: if the product ever
needs it, **that is a new contract amendment** (owner, binding), never an
in-flight widening.

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
   - **Signal-prefix determinism** — promoted by owner ruling from a
     demonstration to a **normative acceptance criterion**, verbatim:

     > **For any bar index `i`, the signal produced for `i` must be
     > invariant under arbitrary changes to bars strictly after `i`.**

     Executable form:

     ```text
     signal(fullSeries, i)
     ==
     signal(seriesTruncatedAtI, i)
     ```

     or any equivalent executable form. It is strategy-agnostic, and it
     is deliberately stronger than a source-level check that "the
     adapter never writes `[i+1]`". (§2.1: already demonstrated 10/10 on
     SF-core.)
   - **Adversarial probe** (fixture SF7): a spy strategy that attempts
     to read beyond its window through every surface of the view must
     be observably unable to; a hypothetical future-reading strategy
     must make the test go RED.

**Bar-`i` visibility note — owner-approved, binding.** The ruling, in
the owner's own terms: bar `i` itself is **completed information**, so a
strategy may read it; what is forbidden is

> 用 bar `i` 本身參與建立它要突破的 threshold。

Donchian therefore uses the prior channel because of *that* rule — not
because a strategy may not read completed bar `i`. The owner ordered
this note kept expressly so that a reviewer does not re-interpret
no-lookahead as "only `i−1` is visible". Detail follows.

Donchian's rule consults the *prior-window* channel
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
F1–F12 / BT1's 28 kernel tests, BT2's AF suite, BT3's MF suite.

**Acceptance statement (owner ruling, verbatim):**

> generalized engine + Donchian adapter observationally equals CLOSED
> BT1 behavior over the canonical behavioral corpus.

**Comparison dimensions (owner, binding minimum).** The equivalence
comparison covers at least: **executions; closed trades; pending
terminal signal; open terminal position; timing; fill prices** — beyond
bare outputs. Owner constraint attached to the same ruling: *if the
existing oracle already covers these, no new abstraction is built for
them* — the existing suites are the instrument, not a newly-invented
comparison layer.

This is a **migration oracle, not a Donchian re-review**; a finding that
re-litigates Donchian rules is a scope violation. §2.1 records the
contract-stage feasibility evidence (16/16 traces through a reference
engine) — valuable as design evidence, and explicitly **not** a
substitute: the implementation stage re-proves equivalence against the
real product code (owner: 「正式 implementation仍須重新證明」).

---

## 6. The second strategy: SMA crossover (D6)

**Orientation verdict (per the kickoff's condition):** suitable — no
repo-level obstacle. A1's CLOSED `sma()` provides exactly the needed
values (bar-inclusive window mean, null warm-up prefix, typed-error
period validation); no new indicator, no volume/session data, entry and
exit both exist, the signal shape (level crossing) is structurally
different from Donchian's breakout, and hand-exact fixtures are easy
(integer closes make SMA-2 exact halves and SMA-4 exact quarters).

### 6.1 Signal rule (RULED — D6 approved, D6a ruled in §6.1a)

Parameters: integer periods `fastPeriod < slowPeriod` (violation = typed
error at construction). Let `f = sma(closes, fastPeriod)`,
`s = sma(closes, slowPeriod)` over the visible window at bar `i`:

```text
if f[i], s[i], f[i−1], s[i−1] are not all defined (warm-up) → NONE
flat:  ENTER_LONG  iff  f[i] > s[i]  AND  f[i−1] ≤ s[i−1]
long:  EXIT_LONG   iff  f[i] < s[i]  AND  f[i−1] ≥ s[i−1]
otherwise → NONE
```

### 6.1a D6a — RULED: prev-inclusive / current-strict

Owner ruling: **prev-inclusive; current strict.** Binding form:

```text
long entry:  previousFast <= previousSlow  &&  currentFast >  currentSlow
exit:        previousFast >= previousSlow  &&  currentFast <  currentSlow
```

The strict-both-sides alternative (`f[i−1] < s[i−1]` for entry, `>` for
exit) is **rejected**: under it an exact-touch-then-cross would not be a
crossing. SF-core i=5 is the discriminating fixture (fPrev = sPrev = 10
exactly: ruled semantics → ENTER_LONG; rejected alternative → NONE).

**Reconciliation of the two equality halves (owner precision, verbatim
— written here expressly so the wording cannot later read as
self-contradictory):**

> **Equality at the current observation is not itself a crossing event;
> equality at the previous observation may serve as the boundary state
> from which a subsequent strict move to the other side constitutes a
> crossing.**

The three cases the owner enumerated (stated, as the owner stated them,
in the entry direction; the exit rule is the exact mirror), each pinned:

| case | previous | current | signal | pinned by | exit-direction mirror |
|---|---|---|---|---|---|
| touch then move through | `fast == slow` | `fast > slow` | **ENTER_LONG** — a legitimate crossing | SF-core i=5; SF10 i=5 | SF5 i=7 (prev `≥`, then strictly below → EXIT_LONG) |
| current equality | `fast < slow` | `fast == slow` | **NONE** — a touch, not yet a crossing | SF10 i=4 (flat, prev strictly below) | SF5 i=6 (long, prev strictly above, current equal → no exit) |
| staying above | `fast > slow` | `fast > slow` | **NONE** — crossing is an event, not a state | SF2b (flat, never crossed inside eligibility) | SF-core i=6/7 (long, still bullish → no re-enter, no exit) |

Consequences, restated:

- **equality at bar `i` never signals** (`f[i] == s[i]` satisfies
  neither strict inequality) — SF-core i=4 and SF5 i=6 pin both sides;
- **a crossing is an event, not a state**: being above/below without
  having crossed does not signal (SF2b: a cross that happens inside
  warm-up is missed by design and never fires late);
- the **previous side is inclusive** (`≤`/`≥`): touching the slow SMA
  from below on `i−1` and closing above on `i` IS a crossing (the
  owner's original sketch — "fast SMA > slow SMA 且前一時點不高於 →
  enter").

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

**SF10** — the D6a reconciliation walked in one trace: strictly below →
exact touch (no signal) → strict move through from that boundary state
(signal). Closes [20, 16, 10, 8, 18, 24, 26] (fast 2 / slow 4; every
value exact):

| i | O | H | L | C | f₂ | s₄ | position | signal |
|---|---|---|---|---|---|---|---|---|
| 0 | 20 | 20 | 20 | 20 | — | — | flat | NONE (warm-up) |
| 1 | 20 | 20 | 16 | 16 | 18 | — | flat | NONE (warm-up) |
| 2 | 16 | 16 | 10 | 10 | 13 | — | flat | NONE (warm-up) |
| 3 | 10 | 10 | 8 | 8 | 9 | 13.5 | flat | NONE (s₄[2] null) |
| 4 | 8 | 18 | 8 | 18 | 13 | 13 | flat | NONE — **current equality is not a crossing** (prev 9 < 13.5, strictly below) |
| 5 | 18 | 24 | 18 | 24 | 21 | 15 | flat | **ENTER_LONG** — 21 > 15 with prev 13 ≤ 13: **equality at `i−1` is the boundary state** |
| 6 | 26 | 27 | 25 | 26 | 25 | 19 | long (filled @ open 26) | NONE (staying above is a state, not an event) |

Terminal: one execution (entry s5→f6 @ 26), zero closed trades, open
position carried, no pending signal. SF10 is what makes the two halves
of the ruled equality wording separately falsifiable: i=4 falsifies
"current equality signals", i=5 falsifies "previous equality blocks".

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

If wiring the SMA-crossover strategy forces any of: changed **execution
timing**; changed **pending semantics**; changed **BT2 accounting**;
changed **BT3 metrics** — the abstraction has failed and BT4 does not
close. The second strategy is the falsification instrument, not a
feature.

**What may change vs what may not (owner ruling, binding).**

| disposition | scope |
|---|---|
| **allowed to change** | generic engine machinery needed to replace Donchian-specific signal generation |
| **not allowed to change** | downstream semantics gaining a special case for the second strategy |

**Additional acceptance criterion (owner, verbatim — added by this
adjudication):**

> **For an identical signal sequence, execution/accounting/metrics
> output must be independent of which strategy implementation produced
> that sequence.**

This is the executable form of "the engine does not secretly depend on
strategy identity": replay a captured signal stream through a scripted
stub and the result must equal the real strategy's, bit for bit (§2.1
item 5 — SF8 — already demonstrates the shape at contract stage; §7.3
states the invariant it enforces).

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

**Owner ruling on the containment method (2026-08-24).** The owner
accepted that BT4 cannot keep using "`backtest.js`'s SHA may never
change" as the containment instrument — BT4's whole purpose requires
refactoring that file. The substitution is explicit:

- **still byte-pinned:** the A1 indicator kernel; BT2 `accounting.js`;
  BT3 `metrics.js`;
- **`backtest.js` may change**, and in its place (owner, verbatim):

  > **BT0/BT1 behavioral semantics become the canonical immutable
  > oracle.**

- BT2's old-SHA pin of `backtest.js` is updated **in the same reviewed
  BT4 implementation commit**, under the existing pin-amendment
  protocol. Owner ruling on its status, verbatim: 「這不算打破 pin；是
  pin自己預先定義的合法 migration procedure」 — ratifying this contract
  is the adjudication that protocol requires.

**D8a — public-surface continuity — RULED: keep the export.**
`donchianBreakoutBacktest(bars, period)` remains exported with its exact
signature and behavior, adapter-backed, observationally identical:

```text
donchianBreakoutBacktest(...)
        ↓
Donchian strategy adapter
        ↓
generic backtest engine
```

It becomes a **compatibility facade**, so BT2's and BT3's test imports,
and any BT0-era reading of the result model, continue to hold without
edits beyond the one pin literal. The rename/split alternative is
**rejected for this milestone** as the owner classified it — "diff大、
產品收益零、review surface增加". A genuine public-API cleanup, if ever
wanted, is handled separately as its own deprecation/rename work, never
folded into BT4.

### 7.3 Downstream strategy-identity independence (invariant, not a D-point)

Added by the 2026-08-24 adjudication. The owner explicitly declined to
open a new decision point for it — it is an **invariant** this contract
states, closely related to D7 but worth its own words (owner, verbatim):

> **Strategy identity must not be observable downstream of signal
> production.**

Concretely, nothing in execution, accounting, or metrics may contain:

```text
if strategyName === "donchian"
if strategyName === "sma"
```

— nor any equivalent branch on strategy type, class, instance identity,
parameter fingerprint, or a per-strategy flag threaded through the
result. The only places strategy-specific knowledge is permitted:

```text
signal generation  |  parameters  |  warm-up
```

Once a signal exists, the boundary is absolute — the owner's core
architecture line:

```text
(strategy-specific world ends)
             ↓
       generic engine
             ↓
            BT2
             ↓
            BT3
```

Enforcement: the D7 identical-signal-sequence criterion (§7.1) is its
executable form — a scripted stub replaying a captured signal stream
must be indistinguishable from the real strategy at and below the engine
boundary. §2.1's SF8 already demonstrates it at contract stage; the
implementation stage carries it as a binding test.

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
| 4 | equality boundary → no false crossover | SF-core i=4 (flat), SF5 i=6 (long), SF10 i=4 (prev strictly below) |
| 5 | already-long repeated bullish → no re-enter | SF-core i=6/7 |
| 6 | cross below while long → exit | SF-core i=8, SF5 i=7 |
| 7 | final-bar crossover → terminal unfilled | SF6 |
| 8 | no-lookahead adversarial | D4 spy probe (implementation-stage test) + prefix determinism (§2.1, 10/10) |
| 9 | same signals → identical execution regardless of strategy identity | SF8 (scripted-stub replay == adapter; §2.1 verified) |
| 10 | second strategy flows through BT2+BT3 with no special cases | SF9 (§2.1 verified through the REAL closed kernels) |

Added by the 2026-08-24 adjudication (§1.5):

| # | ruled requirement | pinned by |
|---|---|---|
| 11 | D6a reconciliation — current equality is not a crossing; previous equality is a boundary to cross from | SF10 i=4 and i=5 (§6.1a table; §2.1 item 6) |
| 12 | D1a strictness — an inapplicable signal leaves no pending order, execution, counter, accounting effect, or rejection record | D1a no-op fixture: NONE-substitution equality through the engine AND CLOSED BT2 (§2.1 item 7) |

Implementation-stage test obligations recorded now: the SF7 spy-probe
fixture (a future-reading strategy must turn the suite RED); the D5
golden regression wiring, comparing at minimum the six §5 dimensions;
the D4 normative prefix-determinism criterion as a binding test; the D7
identical-signal-sequence criterion and the §7.3 identity-independence
invariant; strategy purity/static invariants in the house style (zero
capability, no module state); the D8 pin migration in the same reviewed
commit.

---

## 10. Decision record — all points RULED (owner, 2026-08-24)

No decision point remains open. The owner's final table, with the
normative section that carries each ruling and the alternative it
rejects:

| # | Question | **Ruling** | where it is normative | rejected alternative |
|---|---|---|---|---|
| D1 | Strategy boundary | **APPROVE** — pure evaluator; the prohibition list (fill timing, execution price, cash, commission/slippage, accounting, force-close, future data, order sizing) is binding; the engine owns signal→pending→next-open-fill→position. Precision: the contract is **semantic**, not a locked JS spelling | §3.1 | — |
| **D1a** | **inapplicable signal** | **DEFINED NO-OP**, with the strictness lock: no pending order, no execution, no counter increment, no accounting effect, no synthetic rejection record | §3.1 | typed error (would change CLOSED behavior on a redundant signal; forces the strategy to know engine applicability policy) |
| **D1b** | **consultation range** | **EVERY eligible completed bar; warm-up owned entirely by the strategy**, expressed as the outcome `NONE`. No `period` / `fastPeriod` / `slowPeriod` / `minimumBars` reaches the engine | §3.1 | engine-level warm-up parameter (leaks strategy knowledge; opens the `if strategy === …` failure) |
| D2 | Signal vocabulary | **APPROVE** — `ENTER_LONG / EXIT_LONG / NONE` only. Precision: signals describe direction/state intent, **not orders** | §3.2 | — |
| D3 | Position visibility | **`flat` / `long` ONLY** — no entry price, cash, equity, P&L, costs, trade count, profitability. Any future position metadata is a **new contract amendment** | §3.3 | — |
| D4 | No-lookahead | **APPROVE + prefix determinism promoted to a NORMATIVE acceptance criterion**; bar-`i` visibility reading approved as written | §4 | source-level "never writes `[i+1]`" as the only check |
| D5 | Donchian equivalence | **APPROVE** — migration oracle over the canonical corpus, comparing at minimum executions, closed trades, pending terminal signal, open terminal position, timing, fill prices; no new abstraction if the existing oracle covers them | §5 | re-reviewing Donchian semantics; building a new comparison layer |
| D6 | Second strategy | **SMA CROSSOVER** — do not substitute another strategy | §6 | — (orientation found no unsuitability) |
| **D6a** | **equality semantics** | **PREV-INCLUSIVE / CURRENT-STRICT**, with the reconciliation wording written into the contract verbatim | §6.1a | strict both sides (touch-then-cross would not be a crossing) |
| D7 | Acceptance proof | **APPROVE** + the added criterion: identical signal sequence ⇒ identical execution/accounting/metrics output, whatever produced it. Allowed to change: generic engine machinery. Not allowed: downstream special cases | §7.1 | — |
| D8 | Containment | **APPROVE the behavioral-oracle migration** — A1/BT2/BT3 stay byte-pinned; `backtest.js` may change with BT0/BT1 behavioral semantics as the canonical immutable oracle; BT2's pin literal updates in the same reviewed commit | §7.2 | keeping "`backtest.js` SHA may never change" as the instrument |
| **D8a** | **public continuity** | **KEEP `donchianBreakoutBacktest(bars, period)`** as an adapter-backed compatibility facade | §7.2 | rename/split + consumer sweep ("diff大、產品收益零、review surface增加") |
| — | **downstream identity independence** | recorded as an **invariant, not a new D-point**: strategy identity must not be observable downstream of signal production | §7.3 | — |

D1–D8 track the owner's kickoff point by point; D1a, D1b, D6a and D8a
were the sub-choices this drafting surfaced, and all four were ruled in
§1.5.

---

## 11. BT4 closure protocol (owner-ordered sequence)

1. **DONE** — this contract document complete and internally consistent;
   every SF table hand-recomputable **and** machine-verified against the
   real A1 kernel, and the §2.1 equivalence/determinism/end-to-end
   evidence reproduced by the campaign checker at the base SHA;
2. **DONE — owner adjudication of D1–D8a, 2026-08-24
   (APPROVED-WITH-MINOR-PRECISION, §1.5)**; the ruled precisions are
   written back into §§2–7 and §10, the checker re-run (rev 2, 10/10).
   **Current position:** ratification lands by merging the docs-only PR
   (CI1 + CI2 provenance gate). Per the same adjudication, **no Sol/Luna
   review of the contract** is taken, and implementation and model review
   stay closed until that merge;
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
