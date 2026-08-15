# Upstream provenance

This repository is a security-reviewed, review-only derivative of an upstream project. This file binds the derivative to the exact upstream content that was vetted, enumerates every deviation, and defines how upstream updates must be taken.

## Base

- **Upstream:** https://github.com/tradesdontlie/tradingview-mcp
- **Base commit:** `c05b8f5755ed8e64ea242de88ddbf46aa24d56a4` (upstream `main`, 2026-07-28)
- **Base git tree:** `d5769663f8eacfa610871aca22464950837497a3`

## Security vet of the base

- **Date:** 2026-08-13
- **Method:** full 85-file human-grade read; invisible-Unicode sweep (zero-width, bidi, tag-block ranges); lockfile supply-chain scan (173 packages, all `registry.npmjs.org`, zero install scripts); sandboxed fixture run (stdio `initialize` + `tools/list` + tool calls) confirming served surface matches source; opening/closing tree digests matched.
- **Vet digest:** `sha256:1d7f972e123964de2a5fbb1ead1d7b6c9ef31137f5761ed8e51f2d2ec13268d2`
  (computed over sorted repo-relative paths excluding `.git`: per-record `kind\0relpath\0size\0sha256(bytes)`, each record length-prefixed with an 8-byte big-endian length, hashed with SHA-256.)
- **Verdict:** SAFE-TO-PROPOSE at that exact content, with caveats that motivated this derivative: agent-callable self-update (`tv_update`), arbitrary JS (`ui_evaluate`), account-mutating surfaces, README's overbroad "never connects to TradingView servers" claim (upstream code calls `pine-facade.tradingview.com`, `pricealerts.tradingview.com`, `tradingview.com/api/v1/symbols_list`, `symbol-search.tradingview.com`, `api.github.com` — all purpose-consistent, none present in this build).
- **npm warning:** the npm package name `tradingview-mcp` is held by a third party (`blasesc`) publishing an older snapshot; `@specialagentk/tradingview-mcp` is another unvetted republish. Never install this project or upstream via npm/npx; use git at a pinned SHA.

## Deviations from base (complete list)

**Removed (files deleted, not just unregistered):**

- Self-update: `src/core/update.js`, `tv_update` tool, GitHub update check in health
- Process control: `tv_launch` and all launch/kill/MSIX-copy machinery in `src/core/health.js`
- Arbitrary JS + UI automation: `src/core/ui.js`, `src/tools/ui.js` (incl. `ui_evaluate`)
- Pine editor suite: `src/core/pine.js`, `src/tools/pine.js`, `scripts/pine_push.js`, `scripts/pine_pull.js`
- Account-state writes: `src/core/alerts.js`, `src/core/watchlist.js` + tool files
- Replay/simulated orders: `src/core/replay.js` + tools; batch: `src/core/batch.js` + tools
- Tabs/panes/layout switching, indicator management, streaming: `src/core/{tab,pane,indicators,stream}.js` + tool files
- Entire CLI (`src/cli/`, `bin` entry), non-macOS launch scripts, upstream skills/agents/docs (`skills/`, `agents/`, `SETUP_GUIDE.md`, `RESEARCH.md`, `CONTRIBUTING.md`, `SECURITY.md`)
- Dropped from kept modules: `chart_set_type`, `chart_manage_indicator`, `chart_scroll_to_date` (superseded by `chart_set_visible_range`, which pages history), `chart_get_visible_range`, `symbol_info`, `symbol_search` (network), `quote_get`, `depth_get`, all strategy/pine-graphics readers, `data_get_study_values` (deferred; may return in a later phase after the same review), `draw_list`/`draw_remove_one`/`draw_get_properties`, screenshot `method: 'api'` path
- Tests for removed features: `e2e`, `pine_analyze`, `cli`, `launch`, `replay`, `update`, `chart_indicator`

**Hardened:**

- `src/connection.js`: CDP endpoint hard-pinned to `127.0.0.1:9222` (env overrides `TV_CDP_HOST`/`CDP_HOST`/`TV_CDP_PORT`/`CDP_PORT` removed); `KNOWN_PATHS` trimmed to the two paths still used
- `src/core/capture.js`: caller-controlled filename removed; fixed output dir `generated/screenshots/`; program-generated names
- `src/core/drawing.js`: single-point shapes only; shape allowlist (`horizontal_line`, `vertical_line`); no style overrides, no text, no point2
- `src/core/chart.js`: `setVisibleRange` rejects `to <= from`
- `src/core/data.js`: `summary` defaults to `true`
- Tool schemas: timeframe enum, symbol `max(32)`, region enum
- `.gitignore`: `generated/` replaces `screenshots/`

**Added:**

- `tests/tool_surface.test.js`: CI gate asserting the served tool list equals exactly the 9-tool allowlist and that ~70 named upstream capabilities are absent
- `tests/sanitization.test.js` (reworked from upstream): keeps safeString/requireFinite/injection suites; adds shape-allowlist, range-window, localhost-pin, fixed-path, and no-child_process audits
- `README.md`, `CLAUDE.md`, this file

**Unchanged from base:** `LICENSE` (MIT, upstream author), `src/wait.js`, `src/tools/_format.js`, `eslint.config.mjs`, `tests/chart_history.test.js`, `scripts/launch_tv_debug_mac.sh`, `package-lock.json` dependency graph (root metadata resynced for the renamed package).

## Branch scope: loopback security kernel ONLY

This branch exists because a six-round hardening campaign on `review-v1` failed to
converge. That campaign bundled the loopback security boundary together with drawing
ownership, chart/range certification, connection-lifecycle boundedness, and a
bespoke JavaScript static analyser, and then required a max-depth cross-family review
to return zero findings on all of it at once. Rounds 4, 5 and 6 each closed the
reported defects and introduced new ones in the same subsystems; the review never
reached a fixed point, because the problem as posed did not have one. That campaign
is preserved, frozen and unpushed, at `c44ee82` on `review-v1` — it is evidence, not
a release candidate.

The decomposition is now one correctness domain per release:

- **Loopback security kernel (this branch)** — ship/no-ship on its own.
- **Drawing ownership** — contract to be re-specified first (rounds 5–6 showed the
  create → fingerprint → verify → delete sequence has an inherent identity/TOCTOU
  problem across layout switches; the open question is whether TradingView exposes a
  stable, scope-aware, creation-time identity at all, and if not the product contract
  should narrow rather than a bespoke ownership protocol be built).
- **Chart/range certification** — resumes only on declared or evidenced cadence.
  Unknown is a legitimate result.
- **General boundedness / hang cleanup** — separate from the security claim.

### What this branch carries

The loopback kernel that both reviewer families verified closed across rounds 2–6,
transplanted onto the pre-hardening base rather than cherry-picked as whole commits:

- a target is used only when its `webSocketDebuggerUrl` is present and pinned to
  loopback:9222 — missing or empty fails closed;
- `isLoopbackWsUrl` accepts only canonical loopback literals, agreed by BOTH the
  WHATWG parser and the legacy `url.parse` that chrome-remote-interface actually
  dials with (the round-2 CRITICAL parser differential), and rejects any
  whitespace/control character (round-3 sol #3, which otherwise fell back to
  re-fetching `/json/list` by id and trusting an unverified response);
- the dial uses the exact verified URL, never a target id, with `local:true` so no
  protocol fetch leaves loopback;
- `assertLoopbackSocket` requires a confirmed ZERO redirect count and a loopback peer
  on the LIVE socket, and runs before any Runtime/Page/DOM command — the round-2
  CRITICAL where a rogue `:9222` answers the upgrade with a 3xx and ws silently
  follows it off-host;
- the control fetch uses `redirect:'manual'` and is pinned to the loopback endpoint;
- `targetInfo` is committed only after the debugger URL passed the loopback check,
  so `getTargetInfo()` can never serve a target this file refused, and a guard
  refusal closes and clears the client singleton.

  Stated precisely because a looser version of this claim was wrong when first
  written here: a post-guard `Runtime.enable` failure DOES leave the client
  singleton set. That is a lifecycle defect (it was fixed as F6 in the abandoned
  campaign) and it is deliberately NOT transplanted — it is out of this branch's
  scope, and it is not a loopback violation, because the guard has already proven
  the peer is loopback before any enable runs.

Architectural change made here, and NOT carried from the campaign: **no production
module can obtain a raw CDP client.** `getClient` is module-private; callers get
`ensureConnected()`, `capturePage(params)` and `evaluate(expression)`. The loopback
guarantee is a property of how this file uses the transport, and handing the raw
client to another module puts that guarantee beyond this file's control — which no
source audit can restore afterwards. This is deliberately structural rather than
enforced by an analyser: the campaign's own analyser was walked through three times.

`npm test` now DISCOVERS test files instead of listing three by name — the listed
form silently never ran `tests/loopback.test.js`, so the branch's own gate would have
existed without executing.

### The only question this branch asks a reviewer

> On this diff, is there any route by which CDP or control traffic can reach a
> non-loopback peer?

Drawing, chart certification, general boundedness and JavaScript-syntax auditing are
explicitly out of scope here and must not be re-audited into it.

### The release surface is SEVEN tools — annotation was removed, not deferred

`draw_shape` and `draw_clear` are not in this release. On the base, `draw_clear`
called `removeAllShapes()` unconditionally: it deleted the user's pre-existing
drawings, not just this session's. Six rounds of review then established why the
obvious fix is not small — removing only our own annotations requires proving which
drawings this session created, and across TradingView layout switches that ownership
could not be established reliably (EntityIds are layout-local; create → fingerprint →
verify → delete has an inherent identity/TOCTOU window). A clear that cannot prove
ownership destroys user data.

So the capability leaves the release rather than shipping with a caveat. It returns
when its contract can be proven, which is the drawing workstream's entry condition —
possibly by narrowing the product contract (a dedicated scratch layout, or no promise
of automatic cleanup) rather than by building a bespoke ownership protocol.

Enforcement, not just omission: `draw_shape`/`draw_clear` moved onto the tool-surface
DENYLIST, so re-registering either fails by name; `tests/tool_surface.test.js` also
DISPATCHES both against the live server and requires refusal — the listing is what a
client sees, dispatch is what it can do. That check was verified discriminating: a
registered tool failing for other reasons does not match the refusal pattern. The
`drawing` module is also dropped from the `./core` package export; the source stays in
the tree for the follow-up workstream.

### Known and deliberately NOT addressed on this branch

- `npm audit` reports 7 advisories (4 high) in the SDK's transitive graph. The base
  predates the lockfile refresh that cleared them, and this branch's CI has no audit
  step. This is a MANDATORY pre-release workstream of its own, deliberately kept out
  of this diff so a reviewer faces one problem, not two. It must not be closed by
  mechanically bumping to a green `npm audit`: `assertLoopbackSocket` reads ws's
  `_redirects` internal, so a `ws` upgrade could silently change the very guard this
  branch exists to prove. Triage first (production vs dev-only, reachable vs
  build-only, whether the advisory affects the pinned version), and give any upgrade
  its own tests and review.
- Round-1..3 correctness findings in `chart.js` / `data.js` / `wait.js` /
  `capture.js` are present as they were at the base; they belong to their own domains.

### Chart correctness contract (2026-08-16)

Five clauses, each one a counterexample reproduced on the release tree BEFORE it was
written. Deliberately small: this contract does not attempt cadence inference,
forming-bar tolerance, range padding, or completeness flags. An earlier campaign built
all of those, and the orientation pass for this workstream showed why they could not be
transplanted — they were successive refinements of a contract that had never been
stated. `tests/chart_contract.test.js` is the contract; each clause has a falsifying
case and a not-over-corrected pin.

- **C1 temporal binding.** `data_get_ohlcv` has TWO explicit modes. Omit `from`/`to` for
  the newest `count` bars (unchanged, so a correctness fix is not a breaking API
  change). Pass BOTH for a window, and the answer contains only bars from it. A half
  window is a caller error, not something to infer. A window with no loaded bars FAILS
  rather than falling back — that fallback was the actual defect: a caller reviewing
  last Tuesday's trade silently received this afternoon's prices. The data layer also
  does not widen the window on the caller's behalf; guessing there is what produced the
  bug. Decision: refuse rather than substitute, because a silent semantic substitution
  is worse than a refusal the caller can act on.
- **C2 observable achievement.** `setVisibleRange().success` is true only when the
  chart's own reported visible range was OBSERVED to contain the request. No cadence, no
  pad, no forming-bar inference. This may false-NEGATIVE when the UI snaps the view;
  that direction is accepted deliberately, because the alternative is a false positive.
- **C3 unknown stays unknown.** An unreadable or null endpoint is reported as `null`,
  never masked with `|| 0`. Epoch 0 remains a legal, distinguishable timestamp — pinned
  by a test, so the fix cannot trade one masking bug for another.
- **C4 no silent substitution.** A window the loaded bars do not cover leaves the view
  where it is. It is NOT answered by zooming to the nearest available data.
- **C5 verified identity.** `waitForChartReady` reads the chart API's own
  `symbol()`/`resolution()` — the same authority `chart_get_state` reports — instead of
  scraping the DOM legend, and compares them EXACTLY. `expectedTf` had been accepted and
  never read at all, so a timeframe switch could report ready while the chart was still
  on the old resolution; a substring symbol match could be satisfied by a different
  ticker containing the requested one.

Testability: `getOhlcv` and `waitForChartReady` gained the injection seam the other core
modules already use. No new production export, and no capability leaves `connection.js`.

Recorded, NOT decided here: `setSymbol`/`setTimeframe` still return `success: true`
while reporting `chart_ready: false`. C5 makes that gap MORE visible rather than less —
readiness now genuinely fails when the switch is unconfirmed, where before it usually
passed. Whether `success` should follow `chart_ready` is achievement semantics for those
two tools, a different clause from the five above, and is left for adjudication rather
than folded in silently.

Also left alone deliberately: the history-paging loop still defaults `more = true` when
`requestMoreDataAvailable()` throws, and `capture.js`/render-stability were not touched.

## Taking upstream updates (required procedure)

1. `git fetch upstream` and read the full diff: `git diff c05b8f5755ed..upstream/main`.
2. Review the diff to the same standard as the original vet **before** merging — upstream is a high-churn community repo; new commits are unvetted by default.
3. Cherry-pick or merge only what the review clears; re-run `npm run lint` and `npm test` — the tool-surface gate must still pass unchanged (any new tool requires a deliberate allowlist edit in the same commit, never a silent one).
4. Update this file: new base SHA, new vet digest, date, and any new deviations.
