import { z } from 'zod';
import { jsonResult } from './_format.js';
import { unixSeconds } from './_temporal.js';
import * as core from '../core/analytics.js';

/**
 * A2 (adjudicated 2026-08-22): ONE curated-enum indicator tool over the SAME
 * validated OHLCV source data_get_ohlcv serves — no new acquisition path.
 *
 * Named data_compute_indicator: it COMPUTES from validated bars. Upstream's
 * dropped `data_get_indicator` (which read study values off the chart
 * surface) stays on the denylist and is NOT being reintroduced — the name
 * difference is deliberate, not cosmetic.
 *
 * Registered STRICT for the same measured reason as data_get_ohlcv: {from,to}
 * PRESENCE selects the window mode, so unknown-key stripping ({FROM,TO})
 * would silently flip the request into a latest-mode call (issue-#3 class).
 * Unknown keys are a fast -32602 refusal via registerTool + z.strictObject.
 *
 * period is REQUIRED and never coerced — no silent defaults. last is
 * OUTPUT-side tail truncation only (omitted = the FULL computed series; it
 * never changes the acquisition window). Values are raw doubles: A2 is a
 * transparent transport of the A1 kernel, with no rounding layer.
 */
export function registerAnalyticsTools(server) {
  server.registerTool('data_compute_indicator', {
    description: 'Compute one technical indicator (sma | ema | rsi | atr | donchian) over the SAME validated OHLCV bars data_get_ohlcv serves. TWO MODES, inherited unchanged: pass from+to (unix seconds) to compute over THAT historical window, or omit both for the newest `count` bars. `period` is REQUIRED (positive integer, e.g. 14). Omit `last` for the full aligned series; pass last=N to return only the final N points, computed AFTER the full-window calculation. Leading nulls are documented warm-up (not an error); donchian returns upper/middle/lower channels; values are raw doubles with no rounding.',
    inputSchema: z.strictObject({
      indicator: z.enum(['sma', 'ema', 'rsi', 'atr', 'donchian']).describe('Which indicator to compute'),
      period: z.number().int().min(1).describe('REQUIRED indicator period — a positive-integer JSON number; never coerced, no default'),
      count: z.coerce.number().int().min(1).max(500).optional().describe('Number of bars to consider (max 500, default 100)'),
      from: unixSeconds.optional().describe('Start of window (unix seconds) — provide with `to`, or neither'),
      to: unixSeconds.optional().describe('End of window (unix seconds) — provide with `from`, or neither'),
      last: z.number().int().min(1).optional().describe('Optional output tail: return only the final N points AFTER the full-window computation. Omit for the entire series.'),
    }),
  }, async ({ indicator, period, count, from, to, last }) => {
    try { return jsonResult(await core.getIndicator({ indicator, period, count, from, to, last })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
