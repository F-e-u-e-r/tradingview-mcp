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
 * period is per-indicator (issue #16): REQUIRED for sma/ema/rsi/atr/
 * donchian, FORBIDDEN for vwap — schema-level presence is optional and the
 * combination policy is core/analytics' (both refusals are typed core
 * errors, never a silent ignore); a SUPPLIED period is still schema-refused
 * unless it is a positive-integer JSON number, never coerced, no defaults.
 * last is OUTPUT-side tail truncation only (omitted = the FULL computed
 * series; it never changes the acquisition window). Values are raw
 * doubles: A2 is a transparent transport of the kernels, with no rounding
 * layer.
 *
 * vwap (issue #16, owner rulings 2026-08-23) is WINDOW-RELATIVE — the
 * running Σ(hlc3×volume)/Σ(volume) anchored at the first bar of the
 * returned window, the anchor being the caller's `from` choice, NOT an
 * exchange session — and requires the chart to be at 1-minute resolution
 * (enforced in core against the resolution captured in the same
 * acquisition snapshot as the bars; the public data_get_ohlcv shape is
 * unchanged by that plumbing). Anchor correctness is the caller's
 * responsibility: a window starting mid-session yields a mid-session
 * anchor, which is a documented property, not a defect.
 */
// _deps follows the repo's standard injection seam one layer up: tests hand a
// stubbed getOhlcv THROUGH the real registered handler so the full MCP seam
// (SDK validation -> handler destructuring -> core -> jsonResult) is the
// tested path; production (server.js) passes nothing and gets the real
// core/data acquisition. The seam carries no capability of its own.
export function registerAnalyticsTools(server, _deps) {
  server.registerTool('data_compute_indicator', {
    description: 'Compute one technical indicator (sma | ema | rsi | atr | donchian | vwap) over the SAME validated OHLCV bars data_get_ohlcv serves. TWO MODES, inherited unchanged: pass from+to (unix seconds) to compute over THAT historical window, or omit both for the newest `count` bars. Optional `timeframe` (\'1\'|\'5\'): derive completed 1-minute or 5-minute analytics from the canonical 1-minute snapshot without changing the chart — see the timeframe field description. `period` is REQUIRED for sma/ema/rsi/atr/donchian (positive integer, e.g. 14) and must be OMITTED for vwap. vwap is WINDOW-RELATIVE: it accumulates Σ(hlc3×volume)/Σ(volume) from the FIRST bar of the returned window — set `from` to the session open and the series matches the chart\'s session VWAP; a window starting mid-session yields a mid-session anchor (documented property, not a defect; no session/reset semantics are implied). vwap requires the chart at 1-minute resolution (set chart_set_timeframe to 1 first); points where cumulative volume is still zero are null, counted in zero_volume_nulls_total. Omit `last` for the full aligned series; pass last=N to return only the final N points, computed AFTER the full-window calculation. Leading nulls on the other indicators are documented warm-up (not an error); donchian returns upper/middle/lower channels; values are raw doubles with no rounding.',
    inputSchema: z.strictObject({
      indicator: z.enum(['sma', 'ema', 'rsi', 'atr', 'donchian', 'vwap']).describe('Which indicator to compute'),
      period: z.number().int().min(1).optional().describe('Indicator period — a positive-integer JSON number; never coerced, no default. REQUIRED for sma/ema/rsi/atr/donchian; FORBIDDEN for vwap (window-anchored, no period)'),
      count: z.coerce.number().int().min(1).max(500).optional().describe('Number of bars to consider (max 500, default 100)'),
      from: unixSeconds.optional().describe('Start of window (unix seconds) — provide with `to`, or neither'),
      to: unixSeconds.optional().describe('End of window (unix seconds) — provide with `from`, or neither'),
      last: z.number().int().min(1).optional().describe('Optional output tail: return only the final N points AFTER the full-window computation. Omit for the entire series.'),
      timeframe: z.enum(['1', '5']).optional().describe('Optional timeframe CLAIM (owner amendment): OMIT for the served bars exactly as today. \'1\' asserts — and enforces — the canonical 1-minute snapshot; \'5\' derives completed 5-minute analytics from that same snapshot (timestamp-aligned buckets; the incomplete terminal bucket and a mid-bucket-cut leading bucket are excluded, observably, via metadata). Both require the chart at 1-minute resolution; 5-minute VWAP is derived from the 1-minute price-volume contributions, never recomputed from aggregated 5-minute OHLC.'),
    }),
  }, async ({ indicator, period, count, from, to, last, timeframe }) => {
    try { return jsonResult(await core.getIndicator({ indicator, period, count, from, to, last, timeframe, _deps })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
