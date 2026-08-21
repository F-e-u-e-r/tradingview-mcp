import { z } from 'zod';
import { jsonResult } from './_format.js';
import { unixSeconds } from './_temporal.js';
import * as core from '../core/data.js';

/**
 * This tool has TWO legal modes selected by field PRESENCE ({} → latest;
 * {from,to} → historical window), so silently stripping an unknown key is not
 * a harmless normalization: `{FROM,TO}` became a latest-mode call that
 * answered with the wrong period's bars (issue #3, measured). It is therefore
 * registered STRICT — unknown keys are a fast -32602 refusal — via
 * `registerTool` + `z.strictObject`, the one path SDK 1.27.1 honors:
 * passing a ZodObject to legacy `server.tool()` silently DEGRADES the tool
 * to a no-schema registration that drops every argument (measured on the
 * orientation round; do not "simplify" this back).
 *
 * Strictness is deliberately per-tool, not repo policy: it is warranted
 * exactly where unknown-key stripping can flip the request into another
 * legal mode.
 */
export function registerDataTools(server) {
  server.registerTool('data_get_ohlcv', {
    description: 'Get OHLCV bar data from the chart. TWO MODES: pass from+to (unix seconds) to get bars from THAT window — required when reviewing a past trade, because without it you get the newest bars regardless of where the chart is navigated. Omit both for the newest `count` bars. A window with no loaded bars is refused rather than answered with the latest data; call chart_set_visible_range for that window first. Defaults to summary=true (compact stats + last 5 bars).',
    inputSchema: z.strictObject({
      count: z.coerce.number().int().min(1).max(500).optional().describe('Number of bars to consider (max 500, default 100)'),
      from: unixSeconds.optional().describe('Window start (unix seconds). Must be given together with `to`. OMIT it for the latest-bars mode — do not send null.'),
      to: unixSeconds.optional().describe('Window end (unix seconds, greater than `from`). Must be given together with `from`. OMIT it for the latest-bars mode — do not send null.'),
      summary: z.boolean().default(true).describe('Summary stats instead of all bars (default true)'),
    }),
  }, async ({ count, from, to, summary }) => {
    try { return jsonResult(await core.getOhlcv({ count, from, to, summary })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
