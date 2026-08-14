# tradingview-mcp-review

A **review-only derivative** of [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp): 9 MCP tools for reviewing trade records against a live TradingView Desktop chart over Chrome DevTools Protocol on `127.0.0.1:9222`.

This is not the general-purpose bridge. The upstream project exposes 84 tools including Pine Script editing, alerts, watchlists, replay trading, UI automation, arbitrary JS evaluation, process control, and self-update. This build removes all of that at the code level and keeps only what a trade-record review needs: navigate the chart to where a trade happened, read price context, mark entry/exit levels, screenshot.

> Not affiliated with, endorsed by, or associated with TradingView Inc. or Anthropic, PBC. Programmatic interaction with TradingView may conflict with [TradingView's Terms of Use](https://www.tradingview.com/policies/) — you are solely responsible for ensuring your usage complies. See the upstream project's disclaimer, which applies here in full.

## Security boundary (by design)

- **Localhost only.** The CDP endpoint is hard-pinned to `127.0.0.1:9222` — no env or config override.
- **No high-privilege primitives.** No self-update, no process launch/kill, no arbitrary JS evaluation, no Pine editor, no alert/watchlist/replay/order capabilities. Removed at the source level (files deleted), not just unregistered.
- **No arbitrary inputs.** No caller-controlled file paths (screenshots go to `generated/screenshots/` with program-generated names), timeframes are an enum, symbols are length-capped.
- **Layout changes are treated as potentially persistent.** Changing symbol/timeframe can dirty the saved TradingView layout (and persist if layout autosave is on). Work on a dedicated scratch layout.
- **Local-only health check.** The upstream GitHub update check was removed; the server makes no network requests beyond the local debug port.
- **Enforced in CI.** `tests/tool_surface.test.js` asserts the tool list equals exactly the 7-tool allowlist and that named upstream capabilities are absent, so an upstream merge cannot silently reintroduce them.

## The 7 tools

| Tool | Purpose in a review |
|---|---|
| `tv_health_check` | Verify the local CDP connection and current chart |
| `chart_get_state` | Read symbol / timeframe / indicators |
| `chart_set_symbol` | Switch to the trade's instrument |
| `chart_set_timeframe` | Switch to the trade's resolution (enum) |
| `chart_set_visible_range` | Jump/zoom to the trade's time window (pages in older history) |
| `data_get_ohlcv` | Price context (summary by default) |
| `capture_screenshot` | Screenshot to `generated/screenshots/` (fixed path) |

Chart annotation (`draw_shape` / `draw_clear`) is **not in this release**. Removing an annotation safely requires proving which drawings this session created; across TradingView layout switches that ownership could not be established reliably, and a clear that cannot prove ownership deletes the user's own drawings. The capability returns with a contract that can be proven, not with a caveat.

Intended architecture: **your trade records are the source of truth → analysis happens locally → the TradingView debug instance provides visual context only.**

## Setup

Requirements: TradingView Desktop (with your subscription), Node.js 18+.

```bash
git clone https://github.com/F-e-u-e-r/tradingview-mcp-review.git
cd tradingview-mcp-review
npm ci --ignore-scripts
```

**Launch TradingView Desktop with the debug port yourself** (the server deliberately cannot do it for you):

```bash
./scripts/launch_tv_debug_mac.sh          # macOS
# or manually, any platform:
/path/to/TradingView --remote-debugging-port=9222
```

Only enable the debug port for review sessions — while it is on, any local process can control that TradingView instance. Close and relaunch normally when done. Use TradingView **Desktop**, not a Chrome tab with remote debugging (that would expose your whole browser profile).

Add to your MCP client config (e.g. a project `.mcp.json`):

```json
{
  "mcpServers": {
    "tradingview-review": {
      "command": "node",
      "args": ["/path/to/tradingview-mcp-review/src/server.js"]
    }
  }
}
```

## Gates

```bash
npm run lint   # eslint no-undef guard (catches unfinished refactors)
npm test       # tool-surface allowlist/denylist gate + sanitization + unit tests (all offline)
```

## Provenance

Forked from the upstream tree at a security-vetted commit; every change since is enumerated in [UPSTREAM.md](UPSTREAM.md), which also defines the re-vet procedure for pulling upstream updates. License: MIT (see [LICENSE](LICENSE), copyright upstream author).
