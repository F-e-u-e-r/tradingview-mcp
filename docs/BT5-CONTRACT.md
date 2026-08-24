# BT5 — Minimal MCP exposure contract (V1)

**Status:** owner-adjudicated 2026-08-24 — **APPROVED-WITH-PRECISION**
(§1.5); this revision incorporates the ruled precisions. **Zero product
wiring.** Ratification lands by merging the docs-only PR (CI1 + CI2
provenance gate); BT5 implementation and model review open only after that
merge. No decision point in §11 remains open.

**Base:** `main @ 94b21388acb175080193a2e8cfa8300719d039e9` — BT0 contract
ratified (`438a59e`), BT1 kernel CLOSED (`0d07902`), BT2 CLOSED (`57f1915`),
BT3 CLOSED (`cf197a5`), **BT4 CLOSED** (contract `8351804` + Amendment A
`dcc79a8`, implementation `e16a4e6`, merged `94b21388`). Pin/regression
confirmation for this base: the offline suite runs **573/573** green at
exactly this SHA locally (`mcp_boundary` excluded — 9222 was live; the
clean-runner CI covers it), and CI validated the full suite on this tree at
the merge.

---

## 1. Governance record

### 1.1 Charter

Owner KICKOFF, 2026-08-24, verbatim:

> GO — begin BT5 contract/design only from canonical
> `main @ 94b21388acb175080193a2e8cfa8300719d039e9`. Draft a minimal
> `data_compute_backtest` MCP exposure over the CLOSED BT1–BT4 pipeline,
> with no new acquisition path, no bar-cap expansion, no arbitrary strategy
> execution, no trading/replay capability, and explicit served
> provenance/assumptions. Return with D1–D8 before any product wiring or
> Sol/Luna review.

The purpose, in the owner's words:

> 把已 CLOSED 的 backtest pipeline 暴露成一個最小、明確、不可誤解為 live
> trading 的 MCP capability。

And what it is explicitly **not**:

> 不是再做 backtest correctness。

BT1–BT4 already settled correctness. BT5 is an **exposure** milestone: its
whole risk surface is the boundary between a validated local computation and
a caller who might mistake it for something it is not.

### 1.2 What BT5 is NOT (owner order, verbatim list)

Not user-provided JS; not an expression language; not an arbitrary indicator
graph; not dynamic eval; not a plugin strategy; not historical paging; not a
larger bar cap; not an alternate fetch path; not direct raw chart scraping;
not extra network; not a session/calendar layer.

### 1.3 Standing orchestration rules (in force, unchanged)

1. **Review budget:** ≤ 4 autonomous rounds, round 5+ needs owner
   reauthorization; owner expectation for this scope: 1–2.
2. **Frozen-SHA immutability / TORN** as ratified.
3. **Proportional review:** executable contract violations block;
   mutation-test completeness by itself does not.
4. **Contract adjudication precedes implementation and model review** — no
   Sol/Luna on this document before the owner rules D1–D8.

### 1.4 Closed ground truth this contract builds on

- **BT0 §4** execution semantics and **BT0 §4.7** the *epistemic* completion
  rule: a bar whose completion cannot be established MUST NOT participate in
  strategy evaluation, and the exclusion MUST be observable. BT0 deferred the
  mechanism to the integration layer — **that layer is BT5** (§6).
- **BT1–BT4** — the execution engine, strategy boundary, accounting and
  metrics, all CLOSED and byte-pinned where BT4 left them. BT5 consumes them
  and changes none of their semantics.
- **A2** (`data_compute_indicator`, adjudicated 2026-08-22) — the ratified
  precedent for "one curated tool over the SAME validated OHLCV source, no
  new acquisition path", including its curated enum, its per-variant
  parameter policy, its refusals-before-acquisition ordering, its
  `source`/`metadata` response blocks, and its internal `includeResolution`
  acquisition-metadata opt-in.
- **The tool-surface gate** (`tests/tool_surface.test.js`) — set-equality on
  the served tool list plus a named denylist, a dispatchability check, and a
  served-blob check.

### 1.5 Adjudication record (owner, 2026-08-24)

Owner decision, verbatim:

> **BT5 contract semantics APPROVED-WITH-PRECISION. Use
> `data_compute_backtest` as the sole new MCP capability (allowlist 8→9);
> keep the existing denylist rather than adding speculative names; use a
> strict nested discriminated strategy object; retain the existing ≤500-bar
> acquisition path; establish terminal-bar completion from same-snapshot
> successor evidence and use any outside-window successor strictly as
> evidence, not backtest input; capture symbol, resolution, and completion
> provenance atomically with the OHLCV snapshot; structure the response as
> source/assumptions/result; propagate CLOSED-kernel typed errors unchanged;
> and migrate the prior prohibition gates into an exact-one-allowed-path
> containment gate. Amend the contract accordingly and return with the
> certified docs-only ratification SHA before implementation.**

Every D-point was approved; the six open sub-decisions were ruled
D1a = **no speculative denylist expansion**, D2a = **nested strict
discriminated object**, D5a = **same-snapshot successor evidence**,
D6a = **atomic same-snapshot symbol provenance**, D7a = **transparent
propagation**, D8a = **gate migration to one exact allowed path**. The
precisions the same decision attached — each written into the normative
section it governs, not left in chat — are:

1. **D1a (§4):** containment rests on the exact allowlist plus the served
   semantics / wiring gate, **not** on an ever-growing name blacklist.
2. **D2a (§5.1):** five binding rejections, and **no silent-ignore of a
   foreign field**.
3. **D3 (§5.2):** everything decidable from the request alone fails
   **before** touching TradingView.
4. **D5a (§6.2):** the successor is preserved *before* the membership
   filter, is **evidence-only and never backtest input**, and the completion
   decision must stay **auditable provenance, never an unexplained
   boolean**.
5. **New invariant (§6.3):** all source provenance is captured **atomically**
   with the OHLCV snapshot.
6. **D6a (§7):** the symbol is taken in the same snapshot and is **not
   normalized by BT5**.
7. **D7a (§8):** no prefix stacking; BT5 owns only its own boundary errors.
8. **D8a (§9.2):** the migrated gate must additionally prove five negatives.

Process rulings attached to the same decision: **no Sol/Luna review of the
contract** before ratification; **no BT5 product wiring** until the
ratification merge; `e96f0b7` is **not** the final ratified SHA — the
amended document, re-checked, becomes the PR head. Contract-stage evidence
disposition (owner): the orientation checker is **approved as
feasibility/orientation evidence**, and the implementation stage must still
re-establish everything RED→GREEN — "不要因 contract checker 通過就跳
implementation tests". The two in-tooling corrections are dispositioned
**VALID fixture correction / no issue** (the mid-bucket `t0`, deliberately
kept) and **VALID checker defect / CLOSED** (the ASI early-return, diagnosed
by a discriminating probe before the fix); neither extends to product code.

---

## 2. Architecture

```text
                         MCP client
                             │  data_compute_backtest
                             ▼
              src/tools/<bt5>.js   — served schema + description
                             │      (strict object; refusals -> jsonResult)
                             ▼
              src/core/<bt5>.js    — orchestration ONLY
                  │                  no capability of its own
                  ├─ core/data.getOhlcv   (the ONLY acquisition path)
                  ├─ completion policy    (BT0 §4.7 made concrete — D5)
                  ├─ strategy selection   (closed enum -> CLOSED constructor)
                  ▼
   CLOSED, UNTOUCHED:  engine.js -> accounting.js -> metrics.js
                             │
                             ▼
              source / assumptions / result   (D6)
```

- BT5 adds **exactly one** tool and **no** new capability class. It performs
  no evaluate/CDP/network/filesystem access of its own; every window
  semantic of the data layer is inherited verbatim rather than
  re-implemented, and a `getOhlcv` refusal **propagates unchanged**.
- The CLOSED analytics modules are consumed as they stand. BT5 introduces no
  numerical transform, no rounding layer, and no second accounting truth.

### 2.1 Contract-stage machine evidence (pre-registered)

The campaign scratch checker (`bt5-orientation-check.mjs`,
`bt5-2026-08-24/`; verification tooling, not product code) — **rev 2, 8/8
after this adjudication** — establishes, by execution against the REAL
shipped modules and before any product wiring exists:

1. **C1 (D1/D8 baseline):** the served allowlist is exactly the **8** tools
   the gate asserts, and the denylist **already names** every capability the
   owner forbade — `data_get_strategy_results`, `data_get_trades`,
   `data_get_equity`, the whole `replay_*` family, `ui_evaluate`,
   `pine_set_source`, `alert_create`, `batch_run`, `data_get_indicator`.
   `data_compute_backtest` is not itself denylisted.
2. **C2 (D5):** a bar record carries **exactly** `time, open, high, low,
   close, volume` — **no completion evidence of any kind**; no field in the
   whole response matches complete/closed/final/partial/forming/settled. In
   latest mode the last returned bar **is** the chart's terminal bar.
3. **C3 (D5):** in **window** mode the envelope is **identical** whether or
   not a successor exists in the snapshot — an interior window and a
   terminal window produce the same shape, and `total_available` counts the
   whole loaded series and so is **direction-blind**. The membership filter
   discards the successor before the caller can see it.
4. **C4 (D5):** the successor-bar completedness rule is **already ratified
   and shipped** in `src/analytics/timeframe.js`, and is provably clock-free
   — the same data a whole day later partitions identically.
5. **C5 (D2/D6):** a string-selected CLOSED strategy flows through the REAL
   CLOSED engine → accounting → metrics into a `source`/`assumptions`/
   `result` shape, for **both** strategies, against hand-derived values
   (Donchian on BT0's F1: equity `[1000×6, 700, 800]`, realized −200,
   maxDrawdown 0.3; SMA crossover on SF-core: realized −600, final equity
   800), with **zero special cases**; a token outside the closed set is
   refused, never guessed.
6. **C6 (D4):** acquisition **metadata** can be added for internal callers
   without changing the served shape — the ratified `includeResolution`
   precedent — and an unestablished value stays `null`, never invented.
7. **C7 (D5a / D6a, added by this adjudication):** the ruled mechanism is
   computable in **one** snapshot — a reference acquisition in the shape
   `src/core/data.js` already uses reads the symbol and the resolution off
   the **same** chartApi object the bars are reached through, and decides
   terminal completion from the successor present in that same snapshot
   **before** the membership filter discards it. An interior window reports
   `{established: true, evidence: 'later_bar_in_same_snapshot',
   successorTime}`; a terminal window and latest mode both report
   `{established: false}`. **The successor never enters the returned bars.**
   Shifting the whole series a day decides identically — clock-free.
8. **C8 (D2a / D3, added by this adjudication):** the nested strict
   discriminated strategy object refuses an unknown type, a wrong
   strategy-specific field, an extra field belonging to the other strategy,
   a missing required parameter, an invalid period relation, and a coerced
   string period — **all before acquisition** (the spy counts zero
   acquisitions across every refusal), and a foreign field is refused, never
   silently ignored.

These checks ran against the **real acquisition script** from
`src/core/data.js` (executed against a fake chart), not a paraphrase of it.
Contract-stage evidence disposition (owner, this adjudication): **approved
as feasibility / orientation evidence** — it establishes that the current
data surface has no completion flag, that window mode destroys successor
evidence, that same-snapshot enrichment is technically feasible, and that
the orchestration shape works. It is **not** implementation closure
evidence: the implementation stage re-establishes everything RED→GREEN, and
a passing contract checker never licenses skipping implementation tests.

---

## 3. Orientation finding — the completion question (owner's explicit ask)

The owner asked orientation to answer one question before any heuristic is
proposed:

> 現有 data path 有沒有足夠 authoritative evidence 判 terminal bar
> completion？

**Answer: partly — and the sufficient evidence is structural, not temporal.**

**What does NOT exist.** The bar record has no completion flag, no bar-close
timestamp, no "is final" marker. `bars.valueAt(i)` yields a six-element
tuple and nothing else (C2). Nothing in the served or internal envelope
distinguishes a settled bar from a forming one.

**What DOES exist.**

1. **The successor-bar rule.** A bar can be proven closed by the existence
   of a LATER bar in the same snapshot: once the next bucket has begun, no
   further tick can land in the previous one. This is not a new invention —
   it is the rule `src/analytics/timeframe.js` already ships and the owner
   already ratified for five-minute derivation (C4), stated there verbatim:
   *"COMPLETEDNESS is established from DATA, never a clock … a present
   bucket is completed iff a LATER bucket has begun in the snapshot … The
   terminal bucket can never prove its own completion and is always
   excluded."*
2. **The authoritative resolution**, captured in the SAME page evaluation as
   the bars so the two cannot race apart (C6).

**Where the evidence is destroyed.** In **latest** mode the last returned
bar is the chart's terminal bar, which by the rule above can never prove its
own completion — correct and unambiguous. In **window** mode the membership
filter (`v[0] >= from && v[0] <= to`) discards any successor before it
reaches the caller, so a demonstrably-completed last bar and a forming one
are indistinguishable in the response (C3). Since BT5's entire purpose is
reviewing a PAST trade — a historical window — this is the case that
matters most, and it is precisely what D5 must decide.

**What orientation deliberately did NOT do.** No wall-clock heuristic was
designed, per the owner's order. Nothing here infers completion from the
current time, from bar spacing, or from the resolution value.

---

## 4. D1 — Tool name and the allowlist expansion

**Name (owner-specified, binding):** `data_compute_backtest`.

`compute` is load-bearing, exactly as it was for A2: it says *validated data
→ local deterministic computation*, not *read a strategy result off the
chart*. The rejected spellings are recorded so the distinction cannot later
be softened: `data_get_backtest`, `data_get_strategy_results`,
`replay_trade`, `run_strategy`, `trade_backtest`. Two of those are already
on the denylist and stay there.

**The expansion is a deliberate, loud gate — never hidden in a refactor:**

| | |
|---|---|
| allowlist today | **8** (`capture_screenshot`, `chart_get_state`, `chart_set_symbol`, `chart_set_timeframe`, `chart_set_visible_range`, `data_compute_indicator`, `data_get_ohlcv`, `tv_health_check`) — machine-verified, C1 |
| allowlist after BT5 | **9** — the eight above plus `data_compute_backtest` |
| new capability classes | **none** — no evaluate, no CDP, no network, no filesystem, no process control |
| denylist | **unchanged**, and re-pinned by name |

The gate is set-equality on the served list, so the count change cannot pass
silently: the expansion must be written into
`tests/tool_surface.test.js`'s `ALLOWLIST` in the same reviewed commit, with
the A2-style rationale comment naming the adjudication.

**Why this name (owner).** It continues the repo's established split —
`get` = authoritative/source retrieval, `compute` = local computation over
validated data — so no caller can read it as evidence that TradingView
itself exposes a strategy-results API.

**D1a — RULED: no speculative denylist expansion.** The existing denylist
already names, by hand, every capability the owner forbade (C1). Growth
would add nothing real. The ruling, verbatim:

> **Only the explicitly approved `data_compute_backtest` path is added;
> absence of arbitrary future names is not modeled as an ever-growing name
> blacklist.**

Containment therefore rests on exactly two pillars, and never on
name-guessing:

1. the **exact allowlist** (set-equality, so any addition is loud);
2. the **served semantics and the wiring gate** (§9).

The denylist stays what it is — a record of *upstream capabilities actually
removed* — rather than becoming speculative archaeology against names
nobody has proposed. If a genuinely new dangerous capability is ever
proposed, it is adjudicated then.

---

## 5. D2 — Strategy schema, and D3 — parameter validation

### 5.1 D2 — the closed strategy set

V1 exposes exactly the two CLOSED strategies, by a curated enum:

```text
donchian       — period
sma_crossover  — fastPeriod, slowPeriod   (fastPeriod < slowPeriod)
```

Nothing else. No user-provided JS, no expression language, no arbitrary
indicator graph, no dynamic eval, no plugin strategy — the §1.2 list is
binding here, and a token outside the closed set is refused rather than
guessed (C5).

**D2a — RULED: a strict NESTED discriminated strategy object.** The type and
its parameters form **one** strict discriminated object:

```json
{ "strategy": { "type": "donchian", "period": 20 } }
```

```json
{ "strategy": { "type": "sma_crossover", "fastPeriod": 10, "slowPeriod": 20 } }
```

The flat A2 shape — `strategy: 'donchian'` alongside top-level `period`,
`fastPeriod`, `slowPeriod`, with a runtime policy deciding which fields
"this strategy ignores" — is **rejected**. Two strategies already produce
mutually-exclusive parameter sets, which the owner named as exactly the
point where a flat surface stops being worth it. Property spelling follows
this document; the binding semantics are that **type and parameters are one
strict discriminated object**.

**Binding validation (owner list).** Each of these is a refusal, never a
normalization:

| input | disposition |
|---|---|
| unknown strategy type | **reject** |
| a field that belongs to no strategy | **reject** |
| an extra field belonging to the *other* strategy | **reject** |
| a missing required parameter | **reject** |
| an invalid period relation (`fastPeriod >= slowPeriod`) | **reject, before acquisition** |

**A foreign field is never silently ignored.** Silent-ignore is the failure
mode this ruling exists to prevent: it lets a caller believe a parameter took
effect when it did not. §2.1 check C8 pins all of it, with an acquisition spy
proving not one refusable call reaches the chart.

### 5.2 D3 — parameter validation

Inherited from A2's ratified layering, unchanged:

1. **Served schema** (`z.strictObject`) curates the enum and the types.
   Unknown keys are a fast `-32602` refusal, **not** silently stripped —
   registered via `registerTool` + `z.strictObject`, the one path the SDK
   honors (issue-#3 lineage).
2. **Core belt** re-checks what a direct caller could still get wrong, and
   holds the per-variant combination policy. **Every refusal fires BEFORE
   acquisition**, so a refusable call never fetches.
3. **Kernel guards** stay as the last belt: BT4's strategy constructors
   already refuse a non-positive-integer period and `fastPeriod >=
   slowPeriod` at construction.

**Ordering rule (owner, binding):**

> 所有可以純由 request schema / strategy contract 判定的錯誤，必須在
> acquisition 前失敗。

So an unknown strategy, a malformed period, or mutually incompatible
parameters must **never** reach TradingView first and come back to report an
input error. The owner's two reasons are both recorded: it spends no
capability on a request already known to be invalid, and it keeps error
**provenance** clean — a refusal that never touched the chart cannot be
mistaken for a data problem.

Periods are positive-integer JSON numbers, **never coerced, no defaults** —
`'20'`, `20.0`-as-string, `null` and `true` are refusals, not inputs. Cost
parameters (`initialCash`, `commissionRate`, `slippageRate`) follow BT2's
ratified admissibility rules; whether they are exposed at all is D6's
`assumptions` question and is decided with it.

**Strictness is warranted here for the same measured reason as
`data_get_ohlcv` and `data_compute_indicator`:** this tool inherits the
two presence-selected window modes, so unknown-key stripping could flip a
historical request into a latest-mode call — the issue-#3 class of silent
semantic substitution.

---

## 6. D4 — OHLCV acquisition inheritance, and D5 — terminal-bar completion

### 6.1 D4 — acquisition is inherited, not extended

The ONLY acquisition path is `core/data.getOhlcv`, called exactly as A2
calls it. Inherited **verbatim**:

- the two explicit presence-selected modes (`{from,to}` → window;
  neither → latest `count`), with **no fallback and no widening**;
- the **≤ 500 bar cap**, unchanged;
- the structured refusals, which **propagate unchanged** to the caller —
  including "No loaded bars fall within [from, to] … call
  chart_set_visible_range for that window first";
- the left-edge keep on window truncation, and its `note`.

BT5 adds **no** paging, **no** cap change, **no** alternate fetch, **no**
raw chart scraping, **no** extra network, **no** session/calendar layer.

**Performance disposition (owner, RECORD):** while BT5 keeps the ≤500-bar
cap, the ~24 ms measured for the generalized BT4 path at that cap **does not
trigger an optimization workstream**. Only a BT5 proposal to raise the cap
reopens that decision.

### 6.2 D5 / D5a — terminal-bar completion — RULED: same-snapshot successor evidence

BT0 §4.7 is binding and already ratified: an unverifiable terminal bar must
not participate in strategy evaluation, and **the exclusion must be
observable**. BT5 is the layer that makes it concrete, and the owner ruled
the mechanism:

> **D5a = B: same-snapshot successor evidence.**

**Why this is the right model.** BT0 already ratified that completion must
come from *evidence*, not guessing. The evidence exists and is structural:

> **if a later bar already exists in the snapshot, the preceding bar is no
> longer the terminal forming bar.**

It depends on no wall clock, no timezone, no "has the minute rolled over
yet", and no network arrival timing. The fail-safe alternative — always drop
the last returned bar — is **rejected**: it would discard a provably settled
bar in exactly the case BT5 exists for, reviewing a past trade.

**Window mode — the successor is preserved BEFORE the filter.** The
forbidden order is:

```text
filter the requested window  ->  the successor disappears  ->  BT5 guesses
```

The ruled order keeps the evidence inside the same acquisition snapshot,
ahead of the membership filter:

```text
loaded series
     │
     ├─ requested bars        -> the backtest input
     └─ first later bar       -> PROOF ONLY
```

so that:

```text
requested terminal bar = t, and the snapshot also holds t_next > t
    -> t is completed; it may enter the backtest

no later bar exists in the same snapshot
    -> the requested terminal bar's completion is unproven; EXCLUDE it
```

**Evidence-only, outside-window (owner, explicit — write it down so a
reviewer cannot reasonably ask "you already fetched the successor, why not
use it?").** A successor lying outside the requested window proves that the
last requested bar closed. It does **not** make itself eligible:

> **the outside-window successor is EVIDENCE, never backtest input.** It is
> never evaluated, never filled against, and never returned among the
> result's bars.

The backtest input never exceeds the requested window.

**Latest mode.** The tail of the loaded series has no successor, so the final
source bar is excluded. That is deliberate, not a missing bar: BT0
explicitly chose not to generate a completed-bar signal from a bar that may
still be forming.

**The completion decision must stay auditable (owner, binding).** It may not
be reduced to an unexplained boolean such as `completed: true`. The internal
acquisition metadata must retain enough provenance to re-derive the
decision — conceptually:

```text
terminalCompletion:
  established:   true | false
  evidence:      "later_bar_in_same_snapshot" | null
  successorTime: <unix seconds> | null
```

The exact JSON spelling is an implementation-stage choice; what ratifies is:

> **the completion decision must remain auditable from same-snapshot
> provenance rather than being reduced to an unexplained boolean.**

And the BT5 response must let a caller see, at minimum:

- bars acquired;
- bars actually used;
- terminal bars excluded;
- the completion basis.

**Is this a new acquisition path? Owner ruling: NO.** It qualifies as
**same-snapshot metadata enrichment**, the same class as the ratified
`includeResolution`, provided the implementation keeps all of:

| must hold | |
|---|---|
| one evaluation | no second read |
| one loaded series | no wider external fetch |
| no paging | no cap change |
| the served `data_get_ohlcv` public shape | **unchanged** |

Touching `src/core/data.js` is therefore **approved, and approved only for
this narrow enrichment**. It is expressly **not** authorization to rewrite
the data layer.

**Not proposed, per owner order:** any wall-clock heuristic, any inference
from bar spacing, any "the resolution is 1m so a bar older than 60s must be
closed" reasoning. A temporal mechanism would have to be ratified first, and
this contract does not smuggle one in.

### 6.3 Atomic source provenance (invariant, added by the adjudication)

Because the symbol, the resolution and the completion evidence all now come
from the same envelope, the owner added one invariant that closes the whole
class at once rather than restating it per field (verbatim):

> **All source provenance used to label a BT5 result must be captured
> atomically with the OHLCV snapshot that produced the backtest bars. No
> provenance field may be populated by an independent subsequent chart
> read.**

This forecloses, in one clause: a wrong-symbol race, a wrong-resolution
race, and a wrong-completion race. §2.1 check C7 demonstrates that all three
facts are obtainable in a single evaluation.

---

## 7. D6 — Response shape and served provenance

The owner's three conceptual layers, binding:

```text
source        what was read
assumptions   what was assumed
result        what came out
```

The point is stated in the owner's own terms: a caller must never receive a
pile of numbers without knowing whether it is same-bar-close or
next-bar-open, whether costs were applied, and whether an open position was
force-closed.

| block | fields (owner list, binding minimum) |
|---|---|
| **source** | **symbol**; **resolution**; the requested window and mode; **bars acquired**; **bars actually used**; **the excluded-incomplete count and the boundary state**; the completion basis (§6.2); plus the data-layer `truncated` + `note` when the window overflowed the cap. All of it captured atomically per §6.3 |
| **assumptions** | the strategy and its parameters, echoed; the **completed-bar signal model**; **next-bar raw-open execution**; the commission and slippage assumptions actually applied; **long-only**; **one position**; **no pyramiding**; **no force-close**; the ≤500-bar cap |
| **result** | `executions`, `closedTrades`, `openPosition` (terminal open position), `pendingSignal` (pending terminal signal), `totalExecutions`, `totalClosedTrades` — the BT0 §4.5 shape verbatim — plus the BT2 accounting values and the BT3 metrics |

**The result block is not reshaped.** BT5 must not flatten or merge these
into something that loses a core distinction the CLOSED layers established —
executions versus closed trades, a terminal *open position* versus a
terminal *pending signal*. Those distinctions are the point of BT0 §4.5.

C5 demonstrated this shape end-to-end through the REAL closed pipeline for
both strategies with zero special cases.

**D6a — RULED: atomic same-snapshot symbol provenance.** Orientation
finding: **the OHLCV acquisition snapshot does not contain the symbol** —
`getOhlcv` returns bars, `total_bars`, `truncated`, `source`, and (opt-in)
`resolution`, and no instrument identity. The ruling is to capture it in the
same snapshot, alongside the bars, the resolution and the completion
evidence (§6.3). Neither omission nor a second read is acceptable:

| option | disposition |
|---|---|
| capture in the SAME snapshot | **RULED** — `chart.symbol()` sits on the same chartApi object the bars are reached through, so it costs one read inside the existing evaluation (C7) |
| omit it, let the caller pair with `chart_get_state` | **rejected** — the response could then not say which instrument it describes |
| read it separately afterwards | **rejected outright** — `read bars → the chart's symbol changes → read the symbol` yields internally incoherent provenance |

Like the completion enrichment, this is **internal metadata enrichment and
does not change the served `data_get_ohlcv` public shape**; BT5 projects it
into its own `source` block.

**Symbol spelling (owner, binding): BT5 does not normalize it.** The
acquisition layer's authoritative representation is what is reported,
verbatim. If canonicalization or alias handling is ever wanted, that is a
separate adjudication — not something BT5 invents at the boundary.

**Result-shape containment.** BT5 is a transparent transport: raw doubles,
no rounding layer, no second numerical transform, and no re-derivation of
any value the CLOSED layers already produce.

---

## 8. D7 — Error semantics

Inherited from the A2 seam, unchanged:

- a refusal is a served error result — `jsonResult({ success: false, error
  }, true)` — never a partially-filled success;
- **`getOhlcv` refusals propagate verbatim**, so a window with no loaded
  bars reads exactly as it does through `data_get_ohlcv`;
- refusals fire **before acquisition** wherever the input alone decides it;
- unknown keys are a schema-level `-32602`.

**BT5 owns its own boundary errors** (owner list): unsupported strategy;
invalid parameters; insufficient completed bars; a source-resolution
mismatch where this contract requires one; acquisition failure. Those are
BT5-specific typed errors and BT5 is responsible for their wording.

**D7a — RULED: transparent propagation of CLOSED-kernel typed errors.**

```text
BT5's own validation failure   ->  a BT5 typed error
a CLOSED kernel's typed failure ->  propagate UNCHANGED
```

If `accountBacktest()` or `computeBacktestMetrics()` already produced a
ratified typed error — say `accountBacktest: computed entry quantity must be
finite and > 0, got: 0` — it bubbles verbatim. The owner's four reasons are
recorded: it preserves the error identity closest to the actual fault
mechanism; it avoids a second, competing error vocabulary; it continues
A2's treatment of the A1 guards; and BT5 is orchestration, **not a new error
translation layer**.

Explicitly forbidden — prefix stacking:

```text
BT5_ERROR: BT3_ERROR: ...
```

**No silent degradation anywhere:** BT5 never substitutes latest-mode bars
for a failed window, never returns a partial result labelled as complete,
and never invents a value it could not read.

---

## 9. D8 — Denylist and no-trading capability containment

### 9.1 The served statement

The tool description must state, in substance and unmistakably:

> **Simulation only. Does not place, submit, modify, replay, or retrieve
> real trades or orders.**

**Verified from SERVED metadata, not from a source comment.** This is the
VWAP lesson made binding: the served description is the public contract. The
test must reach the **real** served surface — `tools/list` and the served
schema through the registered handler — and not merely grep a source string.
The repo already has both mechanisms: capturing the registered config
through the `registerTool` seam, and a full in-process MCP client/server
seam for served calls.

**The distinction this makes public, and which is itself part of the
contract:** BT5 returns *simulated* executions, *simulated* closed trades,
and *simulated* equity and metrics. That is not `data_get_trades` coming
back under a new name, and the served surface must make a caller unable to
confuse the two.

### 9.2 The containment tests

Three tests currently assert **zero** MCP wiring and name BT5 as the event
that opens them:

| gate | asserts no occurrence of | in |
|---|---|---|
| `backtest_kernel.test.js` | `backtest` | `server.js`, `connection.js`, `wait.js`, all of `src/tools/`, all of `src/core/*.js` |
| `backtest_accounting.test.js` | `accounting` | same roots |
| `backtest_metrics.test.js` | `metrics` | same roots |

A fourth, A2's, already shows the shape they must take: it permits the
string `analytics` **only** on the sanctioned path
`server.js → tools/analytics.js → core/analytics.js`, forbids it everywhere
else, and additionally asserts the sanctioned wiring **exists**.

**D8a — RULED: gate MIGRATION, not gate removal.** Each of the three becomes
an allowed-path gate in the A2 shape — the string is permitted only on
`server.js → tools/<bt5>.js → core/<bt5>.js`, forbidden in every other root,
and the sanctioned registration is asserted to **exist** so the gate also
fails if the wiring silently disappears. A2's `analytics` gate gains the two
BT5 files in its allowed set, since the BT5 core legitimately imports the
analytics modules.

The gate's meaning changes from *"analytics/backtest must not reach MCP at
all"* to:

> **exactly one owner-approved wiring path exists.**

It must therefore prove that path:

```text
MCP registration
      ↓
data_compute_backtest
      ↓
BT5 orchestration
      ↓
existing acquisition
      ↓
CLOSED strategy / engine
      ↓
BT2
      ↓
BT3
```

**and, at the same time, prove all five negatives (owner list, binding):**

1. there is **no second backtest tool**;
2. there is **no generic arbitrary strategy executor**;
3. `engine.js` has **no direct MCP exposure**;
4. nothing routes to **replay or trading**;
5. every other denylist entry remains **forbidden**.

The owner's assessment, recorded because it is the reason the migration is
worth the work: this is **strictly stronger than deleting the gate**.

This is the same class of migration BT4's Amendment A adjudicated — with the
difference that these three gates **named BT5 as their opening event when
they were written**, so opening them is their ratified purpose rather than a
contradiction. Recorded here so a reviewer does not read the change as a
weakening.

### 9.3 Test-harness hygiene (RECORD, not a product requirement)

Contract-stage note, per owner: local test runs must not rely on a live 9222
state; the clean-runner CI remains authoritative for MCP boundary
integration. This is harness hygiene and is deliberately **not** a BT5
product feature or acceptance criterion.

---

## 10. Scope freeze

BT5 V1 contains exactly:

```text
one new MCP tool: data_compute_backtest
a closed two-strategy enum over the CLOSED BT4 strategies
the existing validated OHLCV acquisition, unchanged
a concrete BT0 §4.7 completion policy (D5)
a source / assumptions / result response
```

Explicitly NOT in BT5: any third strategy; parameter sweeps or optimization;
portfolio or multi-symbol backtests; persistence of results; chart
annotation of trades; live or paper trading of any kind; replay; a bar-cap
increase; new timeframes beyond what A2 already derives; a session or
calendar engine. A reviewer demand for any of these is scope expansion /
RECORD, not a blocker.

---

## 11. Decision record — all points RULED (owner, 2026-08-24)

No decision point remains open. The owner's final table, with the normative
section that carries each ruling:

| # | Question | **Ruling** | where it is normative |
|---|---|---|---|
| **D1** | tool / allowlist expansion | **`data_compute_backtest`, allowlist 8 → 9** — a deliberate, loud capability expansion written into the gate's ALLOWLIST in the same reviewed commit; no new capability class | §4 |
| **D1a** | denylist | **no speculative expansion** — containment is the exact allowlist plus the served/wiring gate, never an ever-growing name blacklist | §4 |
| **D2** | strategy set | **Donchian + SMA crossover only** — no arbitrary strategy specification | §5.1 |
| **D2a** | parameters | **nested strict discriminated strategy object**; five binding rejections; a foreign field is refused, never silently ignored | §5.1 |
| **D3** | validation ordering | **reject request/schema-decidable errors BEFORE acquisition** — spends no capability on an already-invalid request and keeps error provenance clean | §5.2 |
| **D4** | acquisition | **existing path only, ≤500 unchanged**; no paging, no second evaluate, no extra fetch. Performance stays RECORD — the optimization trigger is not reached | §6.1 |
| **D5** | completion | **BT0 §4.7 evidence-only rule retained**, made concrete and observable | §6.2 |
| **D5a** | mechanism | **same-snapshot successor evidence**; the successor is preserved *before* the membership filter and is **evidence-only, never backtest input**; the decision stays auditable provenance, never an unexplained boolean. Touching `src/core/data.js` is approved **only** for this narrow enrichment | §6.2 |
| — | **atomic source provenance** | recorded as an **invariant**: every provenance field is captured atomically with the OHLCV snapshot; none may come from an independent subsequent chart read | §6.3 |
| **D6** | response | **`source` / `assumptions` / `result`**, with the owner's binding minimum field lists; the result block is never reshaped into something that loses a BT0 §4.5 distinction | §7 |
| **D6a** | symbol | **atomic same-snapshot capture**; omission and a second read are both rejected; **BT5 does not normalize the spelling** | §7 |
| **D7** | errors | **BT5 owns its boundary errors** (unsupported strategy, invalid params, insufficient completed bars, resolution mismatch, acquisition failure); `getOhlcv` refusals propagate verbatim; no silent degradation | §8 |
| **D7a** | CLOSED-kernel errors | **transparent propagation, no wrapping**; prefix stacking (`BT5_ERROR: BT3_ERROR: …`) is forbidden | §8 |
| **D8** | containment | **simulation-only served contract**, verified from the REAL served surface; simulated results are not `data_get_trades` under a new name | §9.1 |
| **D8a** | gates | **one exact allowed path; all adjacent capabilities remain denied** — gate migration, not removal, and the migrated gate proves five named negatives | §9.2 |

Two RECORDs the owner attached: **performance stays RECORD while BT5 keeps
≤500 bars** (§6.1), and **9222 / `mcp_boundary` is harness hygiene, not a
BT5 product requirement** (§9.3).

---

## 12. BT5 closure protocol (owner-ordered sequence)

1. **DONE** — this contract document complete and internally consistent,
   with the orientation question answered by execution against the real
   modules (§2.1, §3);
2. **DONE — owner adjudication of D1–D8a, 2026-08-24
   (APPROVED-WITH-PRECISION, §1.5)**; the ruled precisions are written back
   into §§2–9 and §11, the checker re-run (rev 2, 8/8).
   **Current position:** ratification lands by merging the docs-only PR
   (CI1 + CI2 provenance gate). Per the same adjudication, **no Sol/Luna
   review of the contract** is taken, and product wiring and model review
   stay closed until that merge;
3. implementation RED→GREEN against the ratified contract: the served
   schema and description first (the served surface is the public
   contract), the allowlist expansion in the same reviewed commit, the
   completion policy with its observable exclusion, the containment-gate
   migration, and the CLOSED layers consumed untouched;
4. narrow Sol + Luna implementation review (max effort) on the exact frozen
   SHA, ≤ 4 autonomous rounds (owner expectation 1–2), governed by §1.3 —
   review foci: no new capability or acquisition path; the completion
   policy's honesty and observability; served-metadata truthfulness; no
   arbitrary strategy execution; no trading/replay capability; CLOSED-layer
   semantics untouched;
5. owner adjudication of surviving findings → merge GO (CI1 + CI2).

Any post-ratification semantic departure requires a BT5 amendment — never an
in-flight reinterpretation.
