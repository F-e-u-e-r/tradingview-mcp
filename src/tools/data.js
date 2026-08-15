import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/data.js';

export function registerDataTools(server) {
  server.tool('data_get_ohlcv', 'Get OHLCV bar data from the chart. TWO MODES: pass from+to (unix seconds) to get bars from THAT window — required when reviewing a past trade, because without it you get the newest bars regardless of where the chart is navigated. Omit both for the newest `count` bars. A window with no loaded bars is refused rather than answered with the latest data; call chart_set_visible_range for that window first. Defaults to summary=true (compact stats + last 5 bars).', {
    count: z.coerce.number().int().min(1).max(500).optional().describe('Number of bars to consider (max 500, default 100)'),
    from: z.coerce.number().int().optional().describe('Window start (unix seconds). Must be given together with `to`.'),
    to: z.coerce.number().int().optional().describe('Window end (unix seconds, greater than `from`). Must be given together with `from`.'),
    summary: z.boolean().default(true).describe('Summary stats instead of all bars (default true)'),
  }, async ({ count, from, to, summary }) => {
    try { return jsonResult(await core.getOhlcv({ count, from, to, summary })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
