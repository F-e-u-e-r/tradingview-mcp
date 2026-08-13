/**
 * Core screenshot logic — review subset.
 * Output path is FIXED: generated/screenshots/ inside this repo, with
 * program-generated file names. The tool accepts no path or name input
 * by design (review build). CDP capture only.
 */
import { getClient, evaluate } from '../connection.js';
import { waitForChartRender } from '../wait.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'generated', 'screenshots');

export async function captureScreenshot({ region, waitForRender = false } = {}) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  if (waitForRender) await waitForChartRender();

  const which = region === 'chart' ? 'chart' : 'full';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(SCREENSHOT_DIR, `tv_${which}_${ts}.png`);

  const client = await getClient();
  let clip;

  if (which === 'chart') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('[data-name="pane-canvas"]')
          || document.querySelector('[class*="chart-container"]')
          || document.querySelector('canvas');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  }

  const params = { format: 'png' };
  if (clip) params.clip = clip;

  const { data } = await client.Page.captureScreenshot(params);
  writeFileSync(filePath, Buffer.from(data, 'base64'));

  return {
    success: true, method: 'cdp', file_path: filePath, region: which,
    waited_for_render: !!waitForRender,
    size_bytes: Buffer.from(data, 'base64').length,
  };
}
