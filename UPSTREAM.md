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

## Taking upstream updates (required procedure)

1. `git fetch upstream` and read the full diff: `git diff c05b8f5755ed..upstream/main`.
2. Review the diff to the same standard as the original vet **before** merging — upstream is a high-churn community repo; new commits are unvetted by default.
3. Cherry-pick or merge only what the review clears; re-run `npm run lint` and `npm test` — the tool-surface gate must still pass unchanged (any new tool requires a deliberate allowlist edit in the same commit, never a silent one).
4. Update this file: new base SHA, new vet digest, date, and any new deviations.
