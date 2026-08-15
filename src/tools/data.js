import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/data.js';

/**
 * A unix-seconds window bound.
 *
 * Deliberately NOT `z.coerce.number()`. That routes every value through
 * `Number()`, and `Number(null) === 0`, `Number('') === 0`, `Number(true) === 1`
 * — while zod's `.optional()` short-circuits only `undefined`. So a client
 * saying "not specified" the ordinary way, `from: null`, arrived at core as a
 * real timestamp: epoch 0. Core's half-window guard tests for absence and could
 * never fire, and `{from: null, to: <newest bar>}` came back a successful
 * `mode:'window'` result carrying the OLDEST loaded bars.
 *
 * Two representations are accepted and no others: an integer, and a string that
 * is unambiguously one. Everything else is a caller error reported as a caller
 * error. The boundary rejects a malformed REPRESENTATION; core still enforces
 * the TEMPORAL contract (pair-or-neither, ordering, window membership) — this
 * does not move that responsibility, it stops corrupting the input to it.
 */
const unixSeconds = z.preprocess(
  (v) => (typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v),
  z.number().int(),
);

export function registerDataTools(server) {
  server.tool('data_get_ohlcv', 'Get OHLCV bar data from the chart. TWO MODES: pass from+to (unix seconds) to get bars from THAT window — required when reviewing a past trade, because without it you get the newest bars regardless of where the chart is navigated. Omit both for the newest `count` bars. A window with no loaded bars is refused rather than answered with the latest data; call chart_set_visible_range for that window first. Defaults to summary=true (compact stats + last 5 bars).', {
    count: z.coerce.number().int().min(1).max(500).optional().describe('Number of bars to consider (max 500, default 100)'),
    from: unixSeconds.optional().describe('Window start (unix seconds). Must be given together with `to`. OMIT it for the latest-bars mode — do not send null.'),
    to: unixSeconds.optional().describe('Window end (unix seconds, greater than `from`). Must be given together with `from`. OMIT it for the latest-bars mode — do not send null.'),
    summary: z.boolean().default(true).describe('Summary stats instead of all bars (default true)'),
  }, async ({ count, from, to, summary }) => {
    try { return jsonResult(await core.getOhlcv({ count, from, to, summary })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
