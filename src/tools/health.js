import { jsonResult } from './_format.js';
import * as core from '../core/health.js';

export function registerHealthTools(server) {
  server.tool('tv_health_check', 'Check the local CDP connection (127.0.0.1:9222) to TradingView Desktop and return current chart state. Local-only: performs no external network requests.', {}, async () => {
    try { return jsonResult(await core.healthCheck()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'TradingView Desktop is not running with --remote-debugging-port=9222. Launch it manually first (see scripts/launch_tv_debug_mac.sh).' }, true); }
  });
}
