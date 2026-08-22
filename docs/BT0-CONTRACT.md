# BT0 — Deterministic backtest execution contract (V1)

**Status:** owner-adjudicated design contract (2026-08-22). **Design only — zero
product code.** This document is the binding execution-semantics contract that
every later BT milestone implements against. BT1 (the first implementation
milestone) may not begin until this document is ratified by the owner.

**Base:** `main @ 4f80ce5` (A1 indicator kernel + A2 `data_compute_indicator`
both CLOSED).

---

## 1. Governance record

### 1.1 Relationship to the former A1b proposal

The analytics workstream once carried a placeholder milestone "A1b" (Donchian
breakout backtest). Its governance state — **CLOSED / NOT STARTED** — is pinned
in the A2 charter ("no A1b backtest") and the A2 adjudication ("A1b remains
closed."). That history is not rewritten. Owner decision, 2026-08-22, verbatim:

> The former A1b proposal is not reopened. Its intended product area is
> superseded by the separately governed BT roadmap beginning at BT0.

### 1.2 Supersession of the Phase-0 disposition (ADAPT-port → DERIVE)

Phase-0 (`analytics-phase0-2026-08-22/PHASE0-MATRIX.md`, batch-1 row 4)
dispositioned "Donchian channel + breakout backtest" as
`ADOPT (ADAPT-port), vectors ported from donor test`. The channel half landed
in A1. For the backtest half, the owner has formally superseded that
disposition. Owner decision, 2026-08-22, verbatim:

> KICKOFF BT0. The previous A1b proposal remains CLOSED / NOT STARTED and is
> superseded, not reopened, by the new BT roadmap. Owner explicitly supersedes
> Phase-0's Donchian backtest `ADAPT-port` disposition: the BT implementation
> will be DERIVED, retaining the donor's already-validated prior-window signal
> lesson but replacing its same-bar-close execution and terminal-position
> semantics with our completed-bar → next-bar-raw-open model and explicit
> terminal state. BT0 is design-only and must lock the 11 acceptance points
> above before any backtest product code is written.

Consequences, all binding:

- **Signal logic / historical bug lesson** — derived from and informed by the
  donor (`atilaahmettaner/tradingview-mcp @
  d77db101edc1b57b260450ddda5ca4f7f0211ecd`, MIT): the breakout signal for bar
  `i` is judged against the **prior** window's channel; the signal bar never
  participates in its own breakout threshold. The donor's PR #71 fixed exactly
  this bug (channel window included the signal bar → zero trades on every
  input, silently); that lesson is retained as a signal-level regression
  obligation (§6, clause 2; fixtures F6/F8).
- **Execution semantics** — our own owner-defined contract (§4): completed bar
  `i` forms the signal; earliest fill is the raw open of bar `i+1`. The
  donor's same-bar-close fill and silent terminal-position drop are **not**
  ported.
- **Donor trade-level vectors are demoted** to *signal-timing / no-lookahead
  oracle only*. They continue to pin: prior-window band; signal-bar exclusion
  from its own threshold; the historical zero-trades bug must not resurface.
  They no longer pin: fill price, fill bar, closed-trade count, or
  terminal-position handling — those are governed by this contract's own
  fixtures (§7).

**Provenance form (owner ruling):** BT1's engine is a DERIVE — behavioral
inspiration, no donor code copied. Durable provenance for the derivation is
recorded *here*, in this contract. `THIRD_PARTY_NOTICES.md` is updated only by
milestones that actually COPY or ADAPT third-party code; a behavioral oracle is
not a copyright-attribution event.

### 1.3 Roadmap position

Approved queue (owner, 2026-08-22 — note the renumbering: the draft roadmap's
BT4+BT5 are merged, later stages shift down by one):

```text
BT0  Contract lock (this document; design only)
BT1  Donchian deterministic execution kernel
BT2  Costs + equity accounting
BT3  Metrics
BT4  Strategy generalization + second-strategy proof
BT5  Minimal MCP exposure
BT6  Release hardening
```

Stopping rule: every milestone is independently useful and independently
closable. Work may stop after any CLOSED milestone without owing the next one.

---

## 2. Scope of this contract

Defines, for BT V1: the information boundary, the Donchian breakout signal
rule, execution timing, terminal-state semantics, the result model, the V1
assumption set, and the inherited data contract — each pinned by hand-derived
fixtures (§7) that a reviewer can recompute on paper.

Explicitly **not** designed here (later milestones own their design):
costs/slippage (BT2), equity/P&L accounting (BT2), metrics of any kind (BT3),
the strategy interface (BT4), MCP schema (BT5). Exactly two kinds of
statement about those milestones appear in this document, and only these:

- the declared V1 assumption set (§4.6), which the BT1 simulation model holds
  constant; and
- owner-adjudicated cross-milestone rulings, recorded and labeled in place in
  §4.6, §4.7 and §5 (cost-parameter explicitness, the completion policy,
  allowlist-gate discipline, tentative naming family, denylist distinction,
  output honesty) — each ruling carries its provenance where it is stated,
  and ratification of this document adopts them all.

Those record standing adjudications that bind the later milestones'
**acceptance**; each milestone's design space remains open within them.
Nothing else in this document pre-locks a later milestone.

---

## 3. Definitions

- **Bars.** The input is the full record array served by the repo's validated
  OHLCV boundary (`core/data.getOhlcv({ summary:false, … })` — the bar array,
  not the summary digest): `{time, open, high, low, close, volume}`, ascending
  time, prices **exactly as returned** — raw doubles; the backtest layer
  applies no rounding or other precision transform (the same
  transparent-transport rule the A2 adjudication fixed for indicator values).
  Indexing is **0-based**; `N` = bar count; `p` = Donchian period.
- **Completed bar.** Bar `i` is *completed* when its OHLC values are final. All
  signal evaluation for bar `i` happens at completion of bar `i`, using only
  bars `0..i`. The engine is a pure function of its input array and treats
  every supplied bar as completed; *establishing* completion is the
  acquisition boundary's obligation (§4.7, completion policy). Fixture bar
  tables (§7) are therefore completed bars by definition.
- **Prior-window channel `ch[i−1]`.** The A1 kernel's `donchian(highs, lows,
  p)` value at index `i−1`: upper = max high, lower = min low over the `p` bars
  ending at **`i−1`** (bar-inclusive at `i−1`, per the A1-closed definition).
  Because the window ends at `i−1`, it **does not contain bar `i`** — this is
  the prior-window semantics the strategy layer needs, obtained *without
  touching the kernel*. `ch[j]` is defined for `j ≥ p−1`; therefore the first
  evaluation-eligible bar is `i = p`.
- **Raw open.** `open[i+1]` exactly as served by the OHLCV boundary. No
  slippage, no adjustment, no synthetic price (BT1 has zero costs by clause 7).

---

## 4. Normative execution model

### 4.1 Event ordering (per bar `t`, after warm-up)

**Initial state (binding).** The simulation starts flat: `position = null`,
no pending order, empty `executions` and `closedTrades`. No position, order,
or signal carries in from outside the supplied bars.

1. **At the open of bar `t`:** if an order is pending from the signal formed at
   completion of bar `t−1`, it fills at `open[t]`. Position state changes at
   fill time.
2. **At the completion of bar `t`:** evaluate signal rules for `i = t` (using
   `ch[t−1]` and bar `t`'s completed values), under the position state that
   now holds (i.e. *after* any step-1 fill this bar).

No other decision points exist. In particular there is no intra-bar
evaluation and no same-bar fill.

The final bar is not special at evaluation time: when eligible (`t ≥ p`) its
completion is evaluated exactly like any other bar's — after any step-1 fill
at its own open — and a signal formed there is terminal-unfillable (§4.3,
§4.4). Fixtures F6 and F12 pin both flavors (exit-signal and entry-signal).

### 4.2 Signal rules (state-dependent; strict inequalities)

- Evaluation eligibility: `i ≥ p` (so `ch[i−1]` exists). Bars `i < p` are
  warm-up: **no rule is evaluated on them**, however breakout-shaped they look.
- **Flat → entry rule only:** entry signal iff `high[i] > ch[i−1].upper`.
  Equality (`high[i] == ch[i−1].upper`) is **not** a signal. While flat, the
  exit rule is not evaluated (there is nothing to exit); a bar that breaches
  both bands while flat yields an entry signal only.
- **Positioned → exit rule only:** exit signal iff `low[i] < ch[i−1].lower`.
  Equality is not a signal. While positioned, entry-shaped breakouts are
  ignored (one position, no pyramiding — clause 7).

### 4.3 Execution timing

- A signal formed at completion of bar `i` becomes an order that fills at
  `open[i+1]` — the earliest causally available price.
- **No fabricated terminal fill:** if bar `i+1` does not exist, the order
  never fills. The signal is preserved in the terminal state as an
  *unfillable terminal signal*; it is not silently dropped and no synthetic
  fill is invented.

### 4.4 Terminal state

At end of series the engine reports two orthogonal kinds of terminal fact —
they combine; they are never conflated:

- **Live state** — exactly one of the four mutually exclusive
  position × pending combinations that §4.2's state-dependent rules can
  produce:

  1. flat, nothing pending (F1);
  2. flat, unfillable terminal **entry** signal (F4, F12);
  3. long, nothing pending — an **open position at end** (F5, F11);
  4. long, unfillable terminal **exit** signal (F6).

  (`flat + pending exit` and `long + pending entry` are unreachable by
  construction: the exit rule is evaluated only while positioned, the entry
  rule only while flat.)

- **History** — `closedTrades[]`, independent of the live state. A series may
  end with closed trades AND an open position or a pending signal: F12 ends
  with one closed trade *and* a pending entry; a run that re-enters after a
  round trip ends with closed trades *and* an open position.

An unfillable terminal signal is preserved as data (§4.3) — distinct from "no
signal". An open position at end remains reported with its entry facts; it is
**never** silently discarded and **never** counted as a closed trade.
(Marking it to a value is BT2's business, not BT1's.)

### 4.5 Result model

Conceptually (field names conceptual, structure binding):

```text
executions[]     one record per FILL: {kind: entry|exit, signalIndex, fillIndex, fillPrice}
closedTrades[]   one record per completed round trip:
                 {entrySignalIndex, entryFillIndex, entryPrice,
                  exitSignalIndex,  exitFillIndex,  exitPrice}
openPosition     null | {entrySignalIndex, entryFillIndex, entryPrice}
pendingSignal    null | {kind: entry|exit, signalIndex, unfillable: true}
totalExecutions      == executions.length
totalClosedTrades    == closedTrades.length
```

**Executions ≠ closed trades.** One entry fill + one exit fill ⇒
`totalExecutions = 2`, `totalClosedTrades = 1`. The two counts are never
conflated and both are always reported.

**Ordering (binding).** Both arrays are chronological: `executions` ascending
by `fillIndex`; `closedTrades` ascending by `exitFillIndex`.

### 4.6 V1 assumption set (declared, not claimed realistic)

Single instrument; long-only; at most one position at a time; no leverage; no
pyramiding; no partial fills; no shorting; deterministic fill at next raw
open; **zero commission and zero slippage in BT1** (costs arrive in BT2 as
explicit parameters, never hidden defaults — an owner ruling of 2026-08-22
recorded here; BT2's parameter design is otherwise its own). These are
declared simulation assumptions, not claims about live execution. The V1
result model is price-level (§4.5 carries no quantity field); position
sizing and accounting representation are BT2 design questions inside these
declared constraints.

### 4.7 Inherited data contract

BT V1 computes **only** over what the validated OHLCV boundary already serves:

- acquisition exclusively via existing `core/data.getOhlcv({ summary:false,
  … })` — the full bar array, no new fetch path, no network, no paging, no
  cap expansion, no precision change, no alternate source representation;
- the existing **≤ 500 bars** ceiling stands;
- the existing two explicit modes (latest-`count` / `from`+`to` window) and
  fail-closed semantics stand, unchanged.

**Completion policy (binding; added in review round 3, ratified with this
document).** The served records carry no completion flag, and the newest bar
the source serves — latest mode especially — may still be *forming* (its
OHLC not yet final; measured at `src/core/data.js`, which maps the chart's
bars as-is). Clause 1 permits signals only from completed bars, so a forming
bar must never be evaluated: a newest served bar whose completion the
acquisition layer cannot establish is **excluded from the engine's input**
(a deterministic drop of the final element) before the engine runs. The
engine then executes §4 over the remaining bars unchanged — in particular, a
signal on the new final bar is terminal-unfillable per §4.3/§4.4, and no
fill is taken on an excluded bar. Any served result must make the exclusion
(or the method that established completion) visible, never silent (§5,
output honesty); the concrete mechanism is BT5's to implement inside this
rule.

BT V1 is therefore *"backtest over the validated OHLCV currently available to
this MCP"*, not a long-history research engine. Long-history/paging would be a
separate data-capability workstream with its own adjudication; it must not be
smuggled in through the backtester.

**Warm-up arithmetic (binding, hand-checkable).** With period `p` over `N`
bars (0-based): evaluation-eligible bars are the interval `i ∈ [p, N−1]`,
**empty iff `N ≤ p`** (F9); *fillable* signal bars are `i ∈ [p, N−2]`,
**empty iff `N ≤ p+1`** — at `N = p+1` the single eligible bar is the final
bar, so any signal it forms is terminal-unfillable and no fill can ever
occur. When the eligible interval is non-empty, a signal on the final bar
`i = N−1` is terminal-unfillable. Worked example at the ceiling — `p = 20`,
`N = 500`: eligible evaluation bars `i ∈ [20, 499]` (480 bars), fillable
signal bars `i ∈ [20, 498]` (479 bars), and a bar-499 signal is terminal.
For `N ≥ p+1`, an N-bar window loses exactly `p` head bars to warm-up and the
tail bar's signal, if one forms there, to unfillability; for `N ≤ p`, all `N`
bars are warm-up and no evaluation occurs at all (F9).

---

## 5. Global invariants (all BT milestones)

Owner rulings of 2026-08-22, recorded here for traceability (see §2); the
affected milestones implement them as acceptance conditions.

- **Backtesting ≠ trading execution.** No path from this workstream to
  placing, simulating-into, or reading back a real TradingView/broker order.
- No live/paper order placement, broker integration, replay capability,
  arbitrary or LLM-generated strategy code execution, dynamic code
  evaluation, network, filesystem writes, or process control.
- **A1 kernel immutable (clause 10).** `src/analytics/indicators.js` semantics
  are CLOSED. `donchian()` stays bar-inclusive; prior-window semantics are
  obtained by consuming the kernel's output at index `i−1` (§3). A review
  finding that demands the indicator itself become exclude-current is a
  **scope violation** by owner ruling and is rejected on that ground.
- **Denylist non-resurrection.** `replay_trade`, `replay_*`,
  `data_get_strategy_results`, `data_get_trades`, `data_get_equity` and every
  other denylisted upstream capability stay denied. A BT result may *contain*
  fields named trades/executions/equity: those are return fields of **this
  local deterministic simulation**, not a capability to read real trades,
  equity, or strategy results off TradingView. BT5's acceptance must state
  this distinction explicitly, and its tool-surface change is a deliberate
  allowlist `8 → 9` expansion gate — never hidden inside a refactor.
- **Naming family (recorded now, schema locked at BT5).** House verb
  convention: `get` = read from the authoritative source; `compute` = local
  computation over already-validated data. The exposure tool is therefore
  tentatively **`data_compute_backtest`** (not `data_backtest_strategy`).
- **Output honesty (locks at BT5).** A served backtest result must carry its
  assumptions (execution model, cost model, coverage/provenance — including
  any completion-based exclusion of the newest served bar, §4.7) — a
  simulation must not be presentable as live-performance prediction.

---

## 6. The 11 acceptance clauses (owner-locked, 2026-08-22)

1. **Information boundary.** Signals form only from completed bar `i` and
   earlier data. (§4.1–4.2; F1–F11 all.)
2. **Donchian signal semantics.** Bar `i` breaks out against the prior-window
   channel `ch[i−1]`; the signal bar never participates in its own breakout
   threshold. (§3, §4.2; F1, F6, F8.)
3. **Execution timing.** Signal on completed `i` → fill at raw `open[i+1]`.
   (§4.3; F1, F5, F6, F7, F10, F11, F12.)
4. **No fabricated terminal fill.** Final-bar signal without `i+1` never
   fills. (§4.3; F4, F6, F12.)
5. **Terminal open position.** An open position at series end is explicitly
   preserved — never silently discarded, never counted closed. (§4.4; F5, F6,
   F11.)
6. **Executions ≠ closed trades.** Fill count and round-trip count are
   different reported quantities. (§4.5; F1, F6, F10, F12.)
7. **V1 assumptions.** Single instrument, long-only, one position, no
   leverage, no pyramiding, no partial fills; zero commission/slippage in
   BT1. (§4.6; F7.)
8. **Synthetic hand-derived scenarios.** At minimum: entry, exit, boundary
   equality, warm-up, terminal signal, open-at-end. (§7: F1, F2, F3, F4, F5 —
   plus F6–F12 beyond the minimum.)
9. **Donor divergence explicitly recorded.** ADAPT-port superseded → DERIVE;
   donor trade vectors demoted to signal oracle; the seven-bar fixture lists
   both models' correct answers side by side. (§1.2; F6.)
10. **A1 kernel untouched.** Bar-inclusive `donchian()` unchanged;
    prior-window via prior output index. (§3, §5; enforced across BT1–BT6.)
11. **Existing OHLCV contract inherited.** Validated `getOhlcv` range only;
    ≤ 500 bars; no new retrieval/paging/network/cap expansion; warm-up's
    effect on the effective backtest span is pinned. (§4.7; F3, F9 and the
    worked `p=20/N=500` example.)

---

## 7. Hand-derived fixtures

All fixtures use `p = 3` unless noted. Channel rows show `ch[i−1]` — the value
the strategy consults at bar `i` — as `upper / lower`, computed from the three
bars ending at `i−1`. Every number is chosen to be recomputable on paper.
"eval" is the rule actually evaluated per §4.2 (flat → entry only;
positioned → exit only; warm-up → none).

Discrimination property (deliberate): every **BT V1 expected** fill price
differs from its signal bar's close, so a same-bar-close-fill implementation
fails these fixtures on price as well as on fill index. (The one intentional
exception to the pattern is F6's *donor comparator row*, which is not a V1
expected fill: the donor model fills at the signal bar's close by definition
— that contrast is the point of F6.)

### F1 — Complete round trip (clauses 1, 2, 3, 6)

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 2 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 3 | 10 | 12 | 10 | 11 | 10 / 10 | flat | 12 > 10 → **entry signal** |
| 4 | 10 | 12 | 10 | 10 | 12 / 10 | long (filled @ open 10) | 10 < 10 false → hold |
| 5 | 10 | 11 | 10 | 10 | 12 / 10 | long | 10 < 10 false → hold |
| 6 | 8 | 8 | 7 | 7 | 12 / 10 | long | 7 < 10 → **exit signal** |
| 7 | 8 | 9 | 8 | 9 | 12 / 7 | fill @ open 8 → flat | 9 > 12 false → no signal |

Channel checks: ch[2] = bars 0–2 → 10/10. ch[3] = bars 1–3 → 12/10. ch[4] =
bars 2–4 → 12/10. ch[5] = bars 3–5 → 12/10. ch[6] = bars 4–6 → 12/7 —
consulted at the completion of bar 7 like any other eligible bar (§4.1: the
final bar evaluates after its own open fill): flat, 9 > 12 false, no
terminal signal.

**Expected:** executions = 2 (entry: signal i=3, fill i=4 @ 10; exit: signal
i=6, fill i=7 @ 8); closedTrades = 1 (entry 10 → exit 8); openPosition =
null; pendingSignal = null; totalExecutions = 2, totalClosedTrades = 1.

### F2 — Boundary equality is not a breakout (clauses 2, 8)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 8 | 9 | — | — | warm-up |
| 1 | 10 | 12 | 9 | 10 | — | — | warm-up |
| 2 | 10 | 11 | 9 | 10 | — | — | warm-up |
| 3 | 11 | 12 | 10 | 11 | 12 / 8 | flat | 12 > 12 **false** → no signal |
| 4 | 11 | 12 | 10 | 11 | 12 / 9 | flat | 12 > 12 **false** → no signal |

ch[2] = bars 0–2 → 12/8. ch[3] = bars 1–3 → 12/9.

**Expected:** executions = 0; closedTrades = 0; openPosition = null;
pendingSignal = null; totalExecutions = 0, totalClosedTrades = 0. Touching
the band is never a signal; only strict `>`.

### F3 — Warm-up bars cannot signal (clauses 1, 11)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 20 | 10 | 15 | — | — | warm-up (huge bar; still no eval) |
| 2 | 15 | 25 | 15 | 20 | — | — | warm-up (ditto) |
| 3 | 20 | 21 | 19 | 20 | 25 / 10 | flat | 21 > 25 false → no signal |

ch[2] = bars 0–2 → 25/10.

**Expected:** all-empty result (both totals 0). First evaluation-eligible bar
is exactly `i = p = 3`; breakout-shaped warm-up bars produce nothing, and
their extremes correctly enter the channel that bar 3 is judged against.

### F4 — Terminal entry signal never fills (clauses 3, 4)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 2 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 3 | 10 | 15 | 10 | 14 | 10 / 10 | flat | 15 > 10 → **entry signal**; no bar 4 |

**Expected:** executions = 0; closedTrades = 0; openPosition = null;
pendingSignal = {entry, signalIndex 3, unfillable}; totalExecutions = 0,
totalClosedTrades = 0. Distinct from "no signal" (F2/F3) and from an open
position (F5).

### F5 — Entry fills, never exits → open at end (clauses 3, 5)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 2 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 3 | 10 | 15 | 10 | 14 | 10 / 10 | flat | 15 > 10 → **entry signal** |
| 4 | 13 | 16 | 13 | 15 | 15 / 10 | long (filled @ open 13) | 13 < 10 false → hold |
| 5 | 15 | 16 | 14 | 15 | 16 / 10 | long | 14 < 10 false → hold |

ch[3] = bars 1–3 → 15/10. ch[4] = bars 2–4 → 16/10.

**Expected:** executions = 1 (entry: signal i=3, fill i=4 @ 13);
closedTrades = 0; openPosition = {entrySignalIndex 3, entryFillIndex 4,
entryPrice 13}; pendingSignal = null; totalExecutions = 1,
totalClosedTrades = 0. The open position is reported, not dropped, and not a
closed trade.

### F6 — Donor seven-bar fixture, dual-model (clauses 2, 4, 5, 6, 9)

The donor's own primary regression fixture (its PR #71 test), `p = 3`,
donor-style candles (open = high; dates 2026-01-01..07 map to i = 0..6):

| i | O | H | L | C |
|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 |
| 1 | 10 | 10 | 10 | 10 |
| 2 | 10 | 10 | 10 | 10 |
| 3 | 10 | 10 | 10 | 10 |
| 4 | 20 | 20 | 15 | 18 |
| 5 | 20 | 20 | 18 | 18 |
| 6 | 20 | 20 | 5 | 8 |

Shared signal trace (identical under both models — this is the retained donor
lesson): ch[2] = 10/10; i=3: 10 > 10 false. ch[3] = 10/10; i=4: 20 > 10 →
**entry signal**. ch[4] = bars 2–4 → 20/10; i=5 (long): 18 < 10 false.
ch[5] = bars 3–5 → 20/10; i=6 (long): 5 < 10 → **exit signal**; no bar 7.

Divergent execution — **both rows are correct answers, each under its own
declared model; the difference is a deliberate, binding product decision, not
a regression**:

| model | entry | exit | result |
|---|---|---|---|
| Donor (signal bar close-fill; terminal drop) | i=4 @ close 18 (01-05) | i=6 @ close 8 (01-07) | **1 closed trade** |
| **BT V1 (this contract)** | fill i=5 @ open 20 | exit signal i=6 unfillable (no bar 7) | **0 closed trades + 1 open position (entry @ 20) + 1 unfillable terminal exit signal** |

**Expected (V1):** executions = 1 (entry: signal i=4, fill i=5 @ 20);
closedTrades = 0; openPosition = {entrySignalIndex 4, entryFillIndex 5,
entryPrice 20}; pendingSignal = {exit, signalIndex 6, unfillable};
totalExecutions = 1, totalClosedTrades = 0.

### F7 — Breakouts while positioned are ignored (clauses 6, 7)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 2 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 3 | 10 | 12 | 10 | 12 | 10 / 10 | flat | 12 > 10 → **entry signal** |
| 4 | 13 | 15 | 11 | 14 | 12 / 10 | long (filled @ open 13) | exit rule only: 11 < 10 false (15 > 12 **ignored**) |
| 5 | 14 | 18 | 13 | 17 | 15 / 10 | long | 13 < 10 false (18 > 15 **ignored**) |
| 6 | 17 | 17 | 9 | 10 | 18 / 10 | long | 9 < 10 → **exit signal** |
| 7 | 11 | 11 | 9 | 11 | 18 / 9 | fill @ open 11 → flat | 11 > 18 false → no signal |

ch[3] = bars 1–3 → 12/10. ch[4] = bars 2–4 → 15/10. ch[5] = bars 3–5 → 18/10.
ch[6] = bars 4–6 → 18/9, consulted at bar 7's completion (flat): no signal.

**Expected:** executions = 2 (entry fill i=4 @ 13; exit fill i=7 @ 11);
closedTrades = 1 (13 → 11); openPosition = null; pendingSignal = null;
totalExecutions = 2, totalClosedTrades = 1. The up-breakouts at i=4 and i=5
add **zero** executions: no pyramiding, one position.

### F8 — Flat series never signals (clause 2; donor regression, transfers verbatim)

Ten identical bars `O=H=L=C=10`: every `ch[i−1] = 10/10`, `10 > 10` is always
false. **Expected:** all-empty result (both totals 0). (The donor's second
PR #71 regression; valid under both models.)

### F9 — Insufficient bars (clause 11)

- `N = 0` (empty input): no bars, no evaluation. **Expected:** all-empty
  result (both totals 0).
- `N = 3, p = 3` (any values): first eligible bar would be `i = 3`, which does
  not exist. **Expected:** all-empty result (both totals 0) — insufficient
  warm-up is a well-formed no-op, not an error and not a fabricated signal.

### F10 — Quick reversal: entry fill and exit signal on the same bar (clauses 1, 3, 6)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 2 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 3 | 10 | 14 | 10 | 13 | 10 / 10 | flat | 14 > 10 → **entry signal** |
| 4 | 12 | 14 | 8 | 9 | 14 / 10 | long (filled @ open 12, step 1) | step 2: 8 < 10 → **exit signal** |
| 5 | 8 | 9 | 8 | 9 | 14 / 8 | fill @ open 8 → flat | 9 > 14 false → no signal |

ch[3] = bars 1–3 → 14/10. ch[4] = bars 2–4 → 14/8, consulted at bar 5's
completion (flat): no signal.

**Expected:** executions = 2 (entry fill i=4 @ 12; exit fill i=5 @ 8);
closedTrades = 1 (12 → 8); openPosition = null; pendingSignal = null;
totalExecutions = 2, totalClosedTrades = 1. Pins the §4.1 event order: bar 4
first fills the pending entry at its open, then its completion evaluates the
exit rule under the just-entered position.

### F11 — Both bands breached while flat → entry only (clauses 2, 5, 7)

| i | O | H | L | C | ch[i−1] u/l | state | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 12 | 8 | 10 | — | — | warm-up |
| 1 | 10 | 12 | 8 | 10 | — | — | warm-up |
| 2 | 10 | 12 | 8 | 10 | — | — | warm-up |
| 3 | 13 | 13 | 7 | 9 | 12 / 8 | flat | entry rule only: 13 > 12 → **entry signal** (7 < 8 not consulted while flat) |
| 4 | 8 | 10 | 8 | 9 | 13 / 7 | long (filled @ open 8) | 8 < 7 false → hold |

ch[2] = bars 0–2 → 12/8. ch[3] = bars 1–3 → 13/7.

**Expected:** executions = 1 (entry fill i=4 @ 8); closedTrades = 0;
openPosition = {entrySignalIndex 3, entryFillIndex 4, entryPrice 8};
pendingSignal = null; totalExecutions = 1, totalClosedTrades = 0. Pins §4.2's
state-dependence: while flat only the entry rule exists, so an outside bar is
an entry, not an ambiguity.

### F12 — Final bar fills an exit, then evaluates and signals (clauses 1, 3, 4, 6)

| i | O | H | L | C | ch[i−1] u/l | state at eval | eval → outcome |
|---|---|---|---|---|---|---|---|
| 0 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 1 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 2 | 10 | 10 | 10 | 10 | — | — | warm-up |
| 3 | 10 | 12 | 10 | 11 | 10 / 10 | flat | 12 > 10 → **entry signal** |
| 4 | 12 | 12 | 7 | 8 | 12 / 10 | long (filled @ open 12) | 7 < 10 → **exit signal** |
| 5 | 9 | 20 | 8 | 19 | 12 / 7 | fill @ open 9 → flat | 20 > 12 → **entry signal**; no bar 6 |

ch[3] = bars 1–3 → 12/10. ch[4] = bars 2–4 → 12/7.

**Expected:** executions = 2 (entry fill i=4 @ 12; exit fill i=5 @ 9);
closedTrades = 1 (12 → 9); openPosition = null; pendingSignal = {entry,
signalIndex 5, unfillable}; totalExecutions = 2, totalClosedTrades = 1. Pins
§4.1's final-bar rule (the final bar evaluates after its own open fill) and
§4.4's orthogonality (a closed trade in history AND a pending terminal
signal in the live state, simultaneously).

---

## 8. BT0 closure protocol (owner ruling)

BT0 is design-only, so no runtime RED→GREEN is required or staged. Closure
requires all of:

1. this contract document complete and internally consistent;
2. every fixture table hand-recomputable (a reviewer can re-derive every
   channel value, signal, fill, and expected result on paper);
3. the donor-vs-V1 divergence explicit (§1.2, F6);
4. one narrow Sol + Luna contract review (max effort) over the exact document
   SHA — contract-consistency scope, not a code review; a finding that
   demands changing A1 kernel semantics is rejected as scope violation (§5);
5. owner adjudication of surviving findings, then ratification by merging the
   docs-only PR (normal CI1 merge-ref run + CI2 exact-SHA certification serve
   as the provenance gate).

BT1 opens only after this document is ratified, and implements exactly this
contract — deviations require a BT0 amendment, not an in-flight
reinterpretation.
