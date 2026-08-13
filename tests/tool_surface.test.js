/**
 * Tool-surface gate for the review build.
 *
 * The server must expose EXACTLY the 9 allowlisted tools — and none of the
 * denylisted upstream capabilities. Runs fully offline (tools/list is static;
 * no TradingView needed). If a future upstream merge reintroduces a tool
 * registration or import, this test fails in CI before it ships.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');

const ALLOWLIST = [
  'tv_health_check',
  'chart_get_state',
  'chart_set_symbol',
  'chart_set_timeframe',
  'chart_set_visible_range',
  'data_get_ohlcv',
  'draw_shape',
  'draw_clear',
  'capture_screenshot',
].sort();

// Upstream capabilities that must never come back silently. Set-equality with
// ALLOWLIST already implies their absence — this explicit list exists so a
// regression names the exact capability that leaked.
const DENYLIST = [
  // self-update / process control / discovery
  'tv_update', 'tv_launch', 'tv_discover', 'tv_ui_state',
  // arbitrary JS + UI automation
  'ui_evaluate', 'ui_click', 'ui_keyboard', 'ui_type_text', 'ui_mouse_click',
  'ui_open_panel', 'ui_hover', 'ui_scroll', 'ui_find_element', 'ui_fullscreen',
  // Pine editor (read and write)
  'pine_get_source', 'pine_set_source', 'pine_compile', 'pine_smart_compile',
  'pine_save', 'pine_open', 'pine_new', 'pine_list_scripts', 'pine_check',
  'pine_analyze', 'pine_get_errors', 'pine_get_console',
  // account-state writes
  'alert_create', 'alert_list', 'alert_delete',
  'watchlist_get', 'watchlist_add', 'watchlist_add_bulk', 'watchlist_remove',
  // replay / simulated orders
  'replay_start', 'replay_step', 'replay_autoplay', 'replay_stop', 'replay_trade', 'replay_status',
  // batch / tabs / panes / layouts
  'batch_run', 'tab_list', 'tab_new', 'tab_close', 'tab_switch',
  'pane_list', 'pane_set_layout', 'pane_focus', 'pane_set_symbol',
  'layout_list', 'layout_switch', 'layout_new',
  // indicator management + dropped chart/data surface
  'indicator_add', 'indicator_search', 'indicator_set_inputs', 'indicator_toggle_visibility',
  'chart_manage_indicator', 'chart_set_type', 'chart_scroll_to_date', 'chart_get_visible_range',
  'symbol_search', 'symbol_info', 'quote_get', 'depth_get',
  'data_get_study_values', 'data_get_pine_lines', 'data_get_pine_labels',
  'data_get_pine_tables', 'data_get_pine_boxes', 'data_get_indicator',
  'data_get_strategy_results', 'data_get_trades', 'data_get_equity',
  'draw_list', 'draw_remove_one', 'draw_get_properties',
];

let child;
let tools;

function lineRpc(proc) {
  let buf = '';
  const pending = new Map();
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch { /* ignore non-JSON */ }
    }
  });
  return (id, method, params, timeoutMs = 15000) => new Promise((resolve, reject) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs).unref();
  });
}

describe('tool surface (allowlist + denylist gate)', () => {
  before(async () => {
    child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'ignore'] });
    const rpc = lineRpc(child);
    await rpc(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'tool-surface-gate', version: '0.0.0' },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const res = await rpc(2, 'tools/list', {});
    tools = res.result?.tools || [];
  });

  after(() => {
    if (child) child.kill();
  });

  it('exposes exactly the 9 allowlisted tools', () => {
    assert.deepEqual(tools.map(t => t.name).sort(), ALLOWLIST);
  });

  it('exposes none of the denylisted upstream tools', () => {
    const names = new Set(tools.map(t => t.name));
    const leaked = DENYLIST.filter(n => names.has(n));
    assert.deepEqual(leaked, [], `denylisted tools leaked back in: ${leaked.join(', ')}`);
  });

  it('chart_set_timeframe is enum-constrained', () => {
    const t = tools.find(t => t.name === 'chart_set_timeframe');
    assert.ok(Array.isArray(t.inputSchema.properties.timeframe.enum), 'timeframe must be an enum');
    assert.ok(t.inputSchema.properties.timeframe.enum.includes('D'));
  });

  it('chart_set_symbol has a length cap', () => {
    const t = tools.find(t => t.name === 'chart_set_symbol');
    assert.equal(t.inputSchema.properties.symbol.maxLength, 32);
  });

  it('draw_shape allows only fixed shapes and no style/text/point2 inputs', () => {
    const t = tools.find(t => t.name === 'draw_shape');
    assert.deepEqual([...t.inputSchema.properties.shape.enum].sort(), ['horizontal_line', 'vertical_line']);
    assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['point', 'shape']);
  });

  it('capture_screenshot accepts no filename or path input', () => {
    const t = tools.find(t => t.name === 'capture_screenshot');
    const props = Object.keys(t.inputSchema.properties).sort();
    assert.deepEqual(props, ['region', 'wait_for_render']);
    assert.deepEqual([...t.inputSchema.properties.region.enum].sort(), ['chart', 'full']);
  });
});
