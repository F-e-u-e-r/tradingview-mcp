import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server) {
  server.tool('capture_screenshot', 'Take a screenshot of the TradingView chart. Saves to the fixed generated/screenshots/ directory with a program-generated name and returns the path. No path or name input is accepted.', {
    region: z.enum(['full', 'chart']).optional().describe('Capture region (default full)'),
    wait_for_render: z.boolean().optional().describe('Wait for the chart canvas to stabilize first — use after symbol/timeframe/range changes'),
  }, async ({ region, wait_for_render }) => {
    try { return jsonResult(await core.captureScreenshot({ region, waitForRender: wait_for_render })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
