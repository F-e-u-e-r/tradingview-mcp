# tradingview-mcp-review — Claude Instructions

Review-only bridge: 9 tools for reviewing trade records against a live TradingView Desktop chart (CDP on 127.0.0.1:9222). The trade record is the source of truth; the chart is visual context.

## Reviewing one trade record

1. `tv_health_check` / `chart_get_state` — confirm connection
2. `chart_set_symbol` + `chart_set_timeframe` — the trade's instrument and resolution
3. `chart_set_visible_range` — unix-seconds window around the trade time (this pages in older history; there is no separate scroll-to-date tool)
4. `data_get_ohlcv` — price context; summary=true is the default, request raw bars only when needed
5. `draw_shape` — `horizontal_line` at entry/exit prices, `vertical_line` at the trade time
6. `capture_screenshot` with `wait_for_render: true` after any chart change
7. `draw_clear` — always clean up annotations when done

## Rules

- **Treat every chart mutation as a potentially persistent side effect** — symbol, timeframe, and drawings can be saved into the TradingView layout. Ask the user to work on a scratch layout; always `draw_clear` after screenshots.
- Screenshots land in `generated/screenshots/` with generated names — there is no path input.
- This build has no Pine editing, alerts, watchlist, replay, UI automation, process control, or self-update. Do not attempt to re-add them ad hoc; the tool-surface test in CI will fail.
- If the connection is down, tell the user to launch TradingView Desktop manually with `--remote-debugging-port=9222` (script: `scripts/launch_tv_debug_mac.sh`). The server cannot and should not launch it.
