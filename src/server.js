import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerHealthTools } from './tools/health.js';
import { registerChartTools } from './tools/chart.js';
import { registerDataTools } from './tools/data.js';
import { registerAnalyticsTools } from './tools/analytics.js';
import { registerBacktestTools } from './tools/backtest.js';
import { registerCaptureTools } from './tools/capture.js';

const server = new McpServer(
  {
    name: 'tradingview-review',
    version: '0.1.0',
    description: 'Review-only TradingView Desktop bridge (local CDP) for trade-record review',
  },
  {
    instructions: `TradingView review bridge — 8 tools for reviewing trade records against a live TradingView Desktop chart via CDP on 127.0.0.1:9222.

Typical flow for one trade record:
1. chart_get_state — confirm connection and current chart
2. chart_set_symbol + chart_set_timeframe — switch to the trade's instrument and resolution
3. chart_set_visible_range — window around the trade time (unix seconds); it pages in older history, so it also serves as jump-to-date
4. data_get_ohlcv — price context (summary by default)
5. data_compute_indicator — derived analytics (sma/ema/rsi/atr/donchian) over the SAME validated bars; period required, raw values, leading nulls are warm-up
6. capture_screenshot with wait_for_render=true — visual context

Boundaries (by design):
- Chart mutations (symbol/timeframe) can persist into the saved TradingView layout. Work on a dedicated scratch layout.
- This release does NOT provide chart annotation (draw_shape / draw_clear). Marking a chart requires proving which drawings this session owns, and that ownership could not be established reliably across TradingView layout switches; a clear that cannot prove ownership would delete the user's own drawings. The capability returns only with a contract that can be proven.
- This build has no account-mutating, Pine-editing, alert/watchlist, replay/order, UI-automation, process-control, or self-update tools.
- The trade record itself is the source of truth; the chart provides visual context only.`,
  }
);

registerHealthTools(server);
registerChartTools(server);
registerDataTools(server);
registerAnalyticsTools(server);
registerBacktestTools(server);
registerCaptureTools(server);

// Startup notice (stderr so it doesn't interfere with MCP stdio protocol)
process.stderr.write('⚠  tradingview-mcp-review  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n');
process.stderr.write('   Review-only build. Ensure your usage complies with TradingView\'s Terms of Use.\n\n');

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
