import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/drawing.js';

export function registerDrawingTools(server) {
  server.tool('draw_shape', 'Draw a review annotation on the chart: horizontal_line at a price (entry/exit level) or vertical_line at a time. Single point, fixed style. Drawings can persist into the saved TradingView layout — work on a scratch layout and call draw_clear after screenshots.', {
    shape: z.enum(['horizontal_line', 'vertical_line']).describe('Annotation type'),
    point: z.object({
      time: z.coerce.number().describe('Unix timestamp in seconds'),
      price: z.coerce.number().describe('Price level'),
    }).describe('Anchor point for the annotation'),
  }, async ({ shape, point }) => {
    try { return jsonResult(await core.drawShape({ shape, point })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_clear', 'Remove all drawings from the chart (cleanup after review screenshots)', {}, async () => {
    try { return jsonResult(await core.clearAll()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
