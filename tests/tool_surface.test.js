/**
 * Tool-surface gate for the review build.
 *
 * The server must expose EXACTLY the 9 allowlisted tools — and none of the
 * denylisted capabilities. `draw_shape`/`draw_clear` are on the DENYLIST, not
 * merely absent from the allowlist: this release removed them because their
 * clear path cannot prove session ownership, and re-registering them must fail
 * here by name rather than as an anonymous set mismatch. Runs fully offline (tools/list is static;
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
  // A2 (adjudicated 2026-08-22): deliberate 7→8 expansion — the A1 indicator
  // kernel (sma/ema/rsi/atr/donchian) over the SAME validated OHLCV source;
  // no new acquisition path.
  'data_compute_indicator',
  // BT5 (contract ratified 2026-08-24 @ 35a31c52, merged ab85e472): deliberate
  // 8→9 expansion — the CLOSED BT1–BT4 backtest pipeline over that SAME
  // validated OHLCV source. Still no new acquisition path, no bar-cap change,
  // and no trading capability: `compute` means local deterministic
  // computation, and the served description says "Simulation only". Upstream's
  // `data_get_strategy_results` / `data_get_trades` / `data_get_equity` stay
  // on the DENYLIST below and are NOT being reintroduced under a new name.
  'data_compute_backtest',
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
  // Annotation, removed from THIS release (not upstream residue): draw_clear
  // could not prove which drawings the session owns, so a clear risked deleting
  // the user's own work. They return only with a provable ownership contract.
  'draw_shape', 'draw_clear',
];

let child;
let tools;
let rpc;

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
    rpc = lineRpc(child);
    await rpc(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'tool-surface-gate', version: '0.0.0' },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const res = await rpc(2, 'tools/list', {});
    tools = res.result?.tools || [];
  });

  // The initialize result carries the server's own instructions; captured here
  // so the surface can be checked against what the server SAYS about itself.
  let instructions;
  before(async () => {
    const init = await rpc(3, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'tool-surface-gate-2', version: '0.0.0' },
    });
    instructions = init.result?.instructions ?? '';
  });

  after(() => {
    if (child) child.kill();
  });

  it('exposes exactly the 9 allowlisted tools', () => {
    assert.deepEqual(tools.map(t => t.name).sort(), ALLOWLIST);
  });

  it('the served instructions agree with the served surface — no stale tool count', () => {
    // BT5 review finding (both reviewers, 2026-08-24): the instructions still
    // claimed 8 tools after the 8->9 expansion. The served surface is the
    // public contract, so a drifted count is a defect, not a typo. This
    // asserts agreement rather than a literal, so the next expansion cannot
    // regress it silently.
    const stated = instructions.match(/—\s*(\d+)\s+tools\b/);
    assert.ok(stated, `the instructions must state a tool count, got: ${instructions.slice(0, 80)}`);
    assert.equal(Number(stated[1]), tools.length,
      'the stated tool count must equal the number of tools actually served');
    // …and every tool the instructions walk through must really exist.
    for (const name of tools.map((t) => t.name)) {
      if (name === 'tv_health_check') continue; // not part of the numbered flow
      assert.ok(instructions.includes(name), `the instructions must mention ${name}`);
    }
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

  it('the removed annotation tools are not merely unlisted — they cannot be DISPATCHED', async () => {
    // Absence from tools/list is what a client sees; this is what a client can
    // actually DO. A registration that leaked back while the listing was
    // filtered, or a handler still reachable by name, fails here.
    for (const name of ['draw_shape', 'draw_clear']) {
      const res = await rpc(100 + name.length, 'tools/call', { name, arguments: {} });
      const errText = JSON.stringify(res.error ?? res.result ?? {});
      assert.ok(res.error || res.result?.isError,
        `${name} must not be dispatchable in this release (got: ${errText.slice(0, 160)})`);
      assert.match(errText, /not found|unknown|invalid|no such/i,
        `${name} must be refused as unknown, not executed (got: ${errText.slice(0, 160)})`);
    }
  });

  it('nothing in the served surface mentions annotation, so a client cannot infer it exists', () => {
    const blob = JSON.stringify(tools).toLowerCase();
    assert.ok(!blob.includes('draw_shape') && !blob.includes('draw_clear'),
      'the tool listing must not advertise a capability this release does not provide');
  });

  it('capture_screenshot accepts no filename or path input', () => {
    const t = tools.find(t => t.name === 'capture_screenshot');
    const props = Object.keys(t.inputSchema.properties).sort();
    assert.deepEqual(props, ['region', 'wait_for_render']);
    assert.deepEqual([...t.inputSchema.properties.region.enum].sort(), ['chart', 'full']);
  });
});
