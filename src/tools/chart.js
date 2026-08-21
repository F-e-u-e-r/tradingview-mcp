import { z } from 'zod';
import { jsonResult } from './_format.js';
import { unixSeconds } from './_temporal.js';
import * as core from '../core/chart.js';

// Curated resolutions for trade review. Deliberately an enum, not a free
// string — anything the enum misses is added here, not loosened at runtime.
export const TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '240', 'D', 'W', 'M'];

export function registerChartTools(server) {
  server.tool('chart_get_state', 'Get current chart state (symbol, timeframe, chart type, indicators)', {}, async () => {
    try { return jsonResult(await core.getState()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_set_symbol', 'Change the chart symbol', {
    symbol: z.string().min(1).max(32).describe('Symbol to set (e.g., BTCUSD, AAPL, ES1!, NYMEX:CL1!)'),
  }, async ({ symbol }) => {
    try { return jsonResult(await core.setSymbol({ symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_set_timeframe', 'Change the chart timeframe/resolution', {
    timeframe: z.enum(TIMEFRAMES).describe('Timeframe: 1, 3, 5, 15, 30, 45, 60, 120, 240 (minutes), D, W, M'),
  }, async ({ timeframe }) => {
    try { return jsonResult(await core.setTimeframe({ timeframe })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_set_visible_range', 'Zoom the chart to a specific date range (unix timestamps in seconds). Pages in older history as needed, so this also serves as jump-to-date for reviewing a past trade: pass a window around the trade time.', {
    // unixSeconds, not z.coerce.number(): coercion laundered null/''/true into
    // epoch 0/0/1 here, and the invented bound then drove the history-paging
    // loop (issue #3, measured). Both fields stay REQUIRED.
    from: unixSeconds.describe('Start of range (unix seconds)'),
    to: unixSeconds.describe('End of range (unix seconds, must be greater than from)'),
  }, async ({ from, to }) => {
    try { return jsonResult(await core.setVisibleRange({ from, to })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
