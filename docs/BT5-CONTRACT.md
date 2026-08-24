# BT5 — Minimal MCP exposure contract (V1)

**Status:** design-only proposal for owner adjudication. **Zero product
wiring.** BT5 implementation and model review open only after this document
is ratified; the decision points in §11 are the owner's to adjudicate.

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
`bt5-2026-08-24/`; verification tooling, not product code) — **6/6** —
establishes, by execution against the REAL shipped modules and before any
product wiring exists:

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

These checks ran against the **real acquisition script** from
`src/core/data.js` (executed against a fake chart), not a paraphrase of it.
Contract-stage evidence disposition, following the BT4 precedent: **valid
contract feasibility evidence, not implementation closure evidence** — the
implementation stage re-establishes everything RED→GREEN.

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

**D1a — does the denylist grow? (sub-decision.)** Candidate: **no**. C1
verified that every capability the owner named as forbidden is already
denylisted by name, so growth would add nothing. Alternative: add
never-build names (`backtest_run`, `strategy_execute`, `order_submit`,
`portfolio_backtest`) as forward tripwires. The candidate keeps the
denylist a record of *upstream capabilities actually removed* rather than a
speculative wishlist.

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

**D2a — flat parameters or a nested strategy object? (sub-decision.)** The
owner's sketch is nested:

```text
strategy:
  type: "donchian"
  period: 20
```

The shipped A2 precedent is **flat** — `indicator` plus a top-level
`period`, with the per-indicator combination policy enforced in core
(required for sma/ema/rsi/atr/donchian, forbidden for vwap). Both work; they
differ in where the "wrong parameter for this variant" refusal reads
naturally.

| | candidate: **nested** (owner sketch) | alternative: flat (A2 precedent) |
|---|---|---|
| shape | `{ strategy: { type, …params } }` | `{ strategy: 'donchian', period, fastPeriod, slowPeriod }` |
| wrong-variant params | structurally impossible to express for another type once `type` is fixed, if the schema uses a discriminated union | expressible, so each must be refused by an explicit combination policy |
| consistency | differs from A2 | matches A2 exactly |
| growth | adding a third strategy adds a union arm | adding a third strategy adds more top-level optional fields whose policy multiplies |

Recommendation: **nested**, as the owner sketched, because the second
strategy already makes the flat shape carry three mutually-exclusive
parameter sets — the exact case where A2's flat policy would stop scaling.
The concrete JSON spelling is locked at ratification.

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

### 6.2 D5 — terminal-bar completion (the decision §3 sets up)

BT0 §4.7 is binding and already ratified: an unverifiable terminal bar must
not participate in strategy evaluation, and **the exclusion must be
observable**. BT5 is the layer that makes it concrete. Two candidates, both
clock-free:

**Candidate A — fail-safe exclusion.** Always drop the last returned bar
before evaluation, in both modes, and report it observably (e.g.
`excluded_terminal_bars: 1` in `source`). Needs no change to any shipped
module. Cost: in a historical window where a successor demonstrably exists
in the snapshot, a genuinely-completed bar is discarded — and that is the
product's main use case.

**Candidate B — completion evidence carried in the same snapshot
(recommended).** The acquisition script already computes
`end = bars.lastIndex()` and already knows whether a later bar exists beyond
the returned window. Surface that as **internal acquisition metadata** —
the exact shape issue #16 D2 ratified for `includeResolution`: an opt-in
that internal callers request, that the served `data_get_ohlcv` never
requests, and whose public shape therefore does not change (C6). Then:

```text
last returned bar has a successor in the snapshot   -> completed, KEEP
last returned bar IS the chart terminal bar         -> unprovable, EXCLUDE
```

Both outcomes reported observably. This keeps a historical review's final
bar exactly when it is provably settled, and excludes it exactly when it is
not — with no clock anywhere.

**Is B inside the owner's boundary?** It adds no acquisition *path*: no
paging, no second evaluate, no wider window, no new capability — it reads
one more fact from the same synchronous snapshot, which is what the
`includeResolution` ruling already established as acquisition metadata
rather than a new path. It does, however, touch a shipped module
(`src/core/data.js`), so it is the owner's call, not an implementation
detail.

**D5a — which candidate.** Candidate B recommended; Candidate A is the
zero-touch fallback if the owner wants BT5 to change no shipped module at
all.

**Not proposed, per owner order:** any wall-clock heuristic, any inference
from bar spacing, any "the resolution is 1m so a bar older than 60s must be
closed" reasoning. If the owner prefers a temporal mechanism it must be
ratified first, and this contract does not smuggle one in.

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

| block | fields (candidate) |
|---|---|
| **source** | window mode; `requested_window` when windowed; authoritative `resolution`; `bar_count`; `total_available`; first/last bar time of the evaluated set; bars excluded by the D5 completion policy, with the reason; data-layer `truncated` + `note` when the window overflowed the cap |
| **assumptions** | the strategy and its parameters, echoed; `execution: next_bar_open`; the cost assumptions actually applied; `long_only`, single position, no pyramiding; `force_close: false`; the ≤500-bar cap |
| **result** | `executions`, `closedTrades`, `openPosition`, `pendingSignal`, `totalExecutions`, `totalClosedTrades` (the BT0 §4.5 shape verbatim), the BT2 accounting values, and the BT3 metrics |

C5 demonstrated this shape end-to-end through the REAL closed pipeline for
both strategies with zero special cases.

**D6a — symbol provenance (sub-decision).** The owner asked `source` to
carry symbol provenance. Orientation finding: **the OHLCV acquisition
snapshot does not contain the symbol.** `getOhlcv` returns bars,
`total_bars`, `truncated`, `source`, and (opt-in) `resolution` — no
instrument identity. Options:

1. **Capture it in the same snapshot**, exactly as `includeResolution` did
   for the resolution — one more read inside the same evaluation, so it
   cannot race a symbol switch. Same disposition question as D5b.
2. **Omit it**, and let the caller pair the response with
   `chart_get_state`. Cheapest, but the response then cannot say what
   instrument it describes — which is the failure mode the `source` block
   exists to prevent.
3. **Read it separately** — rejected outright: a second evaluate can race a
   chart switch between the two reads, which is the exact hazard the
   same-snapshot rule was created to close.

Recommendation: **(1)**, and it rides with D5's Candidate B since both are
the same one-field-in-the-same-snapshot question.

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

**D7a — do CLOSED-kernel typed errors surface verbatim? (sub-decision.)**
Candidate: **yes** — transparent transport, matching A2's treatment of the
A1 kernel guards. A BT2 refusal such as `accountBacktest: computed entry
quantity must be finite and > 0, got: 0` reaches the caller with its own
wording, because the alternative is a BT5-invented message that hides which
layer refused and why. Alternative: wrap every downstream error in a BT5
prefix — rejected as candidate, since it would make the CLOSED layers'
diagnostics unreadable at the boundary.

**No silent degradation anywhere:** BT5 never substitutes latest-mode bars
for a failed window, never returns a partial result labelled as complete,
and never invents a value it could not read.

---

## 9. D8 — Denylist and no-trading capability containment

### 9.1 The served statement

The tool description must state, in substance and unmistakably:

> **Simulation only. Does not place, replay, submit, modify, or retrieve
> real trades/orders.**

**Verified from SERVED metadata, not from a source comment.** This is the
VWAP lesson made binding: the served description is the public contract, and
the repo already has the mechanism — capture the registered config through
the `registerTool` seam and assert on `served.description` and the
per-field descriptions, plus a full in-process MCP client/server seam for
served calls.

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

**D8a — how the three gates transform (sub-decision).** Candidate:
each becomes an allowed-path gate in the A2 shape — the string is permitted
only on `server.js → tools/<bt5>.js → core/<bt5>.js`, forbidden in every
other root, and the sanctioned registration is asserted to exist so the gate
also fails if the wiring silently disappears. A2's `analytics` gate gains
the two BT5 files in its allowed set, since the BT5 core legitimately
imports the analytics modules. Nothing is weakened: the blast radius stays
"exactly one path", it just becomes a named path instead of none.

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

## 11. Decision points for owner adjudication

| # | Question | Candidate (this document) | Alternative |
|---|---|---|---|
| **D1** | tool name / allowlist expansion | `data_compute_backtest`; deliberate **8 → 9**, written into the gate's ALLOWLIST in the same reviewed commit; no new capability class; denylist unchanged and re-pinned (§4) | — (name is owner-specified) |
| **D1a** | does the denylist grow? | **no** — C1 verified every forbidden capability is already named | add never-build names as forward tripwires |
| **D2** | strategy schema | closed enum `donchian` / `sma_crossover` over the CLOSED BT4 strategies; anything else refused, never guessed (§5.1) | — |
| **D2a** | flat or nested parameters | **nested** discriminated shape, per the owner's sketch — three mutually-exclusive parameter sets is where A2's flat policy stops scaling | flat, matching A2 exactly |
| **D3** | parameter validation | A2's three-layer discipline: strict served schema → core belt with the per-variant policy → CLOSED kernel guards; positive integers, never coerced, no defaults; refusals before acquisition (§5.2) | — |
| **D4** | acquisition inheritance | `core/data.getOhlcv` only; two presence-selected modes, ≤500 cap, refusals propagating verbatim; nothing added (§6.1) | — |
| **D5** | terminal-bar completion | BT0 §4.7 made concrete, clock-free, exclusion observable (§6.2) | — (the mechanism choice is D5a) |
| **D5a** | which completion mechanism | **Candidate B** — successor evidence carried in the SAME snapshot (the ratified `includeResolution` shape); keeps a provably-settled last bar, excludes an unprovable one | **Candidate A** — always drop the last returned bar; zero-touch, but discards a good bar in the product's main use case |
| **D6** | response shape | `source` / `assumptions` / `result`, with the assumptions a caller would otherwise have to guess made explicit (§7) | — |
| **D6a** | symbol provenance | capture it in the SAME acquisition snapshot (rides with D5a-B) — the snapshot carries no symbol today | omit it and let the caller pair with `chart_get_state`; (a separate read is rejected outright — it can race a symbol switch) |
| **D7** | error semantics | served error results; `getOhlcv` refusals verbatim; refuse before acquisition; unknown keys `-32602`; no silent degradation (§8) | — |
| **D7a** | CLOSED-kernel typed errors | **surface verbatim** — transparent transport, matching A2 | wrap in a BT5 prefix |
| **D8** | denylist / no-trading containment | served "Simulation only…" statement verified from SERVED metadata; denylist unchanged and re-pinned (§9) | — |
| **D8a** | how the three BT5 gates transform | allowed-path gates in the A2 shape — one named path, forbidden everywhere else, sanctioned wiring asserted to exist | leave them as blanket bans (impossible: BT5 cannot then wire anything) |

Plus two RECORDs the owner attached: **performance stays RECORD while BT5
keeps ≤500 bars** (§6.1), and **9222 / `mcp_boundary` is harness hygiene,
not a BT5 product requirement** (§9.3).

---

## 12. BT5 closure protocol (owner-ordered sequence)

1. this contract document complete and internally consistent, with the
   orientation question answered by execution against the real modules
   (§2.1, §3) — **done**;
2. **owner adjudication of D1–D8a** (no model review of the contract before
   it; no product wiring before ratification); ratification lands the
   docs-only PR (CI1 + CI2 provenance gate);
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
