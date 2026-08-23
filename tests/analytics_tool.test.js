/**
 * A2 boundary + orchestration suite for data_compute_indicator.
 *
 * Division of responsibility (mirrors mcp_boundary.test.js):
 *   the boundary rejects a malformed REPRESENTATION (-32602, strictObject);
 *   core/analytics owns orchestration semantics (compute-then-slice, honest
 *   metadata, transparent raw values) over a _deps-stubbed getOhlcv;
 *   core/data keeps the TEMPORAL contract (pair-or-neither etc.) — inherited,
 *   not re-implemented, so its own suites remain the authority there.
 *
 * Issue #16 (vwap): the kernel vectors, the 1-minute resolution gate, and
 * the D2 containment pins live in analytics_vwap.test.js; THIS file covers
 * the vwap additions to the served boundary — the enum, the two period
 * refusals (one moved from schema to core, one new), and the served vwap
 * result shape.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAnalyticsTools } from '../src/tools/analytics.js';
import { getIndicator } from '../src/core/analytics.js';

const here = dirname(fileURLToPath(import.meta.url));

// Schema captured from the real registration (never re-declared — see
// mcp_boundary.test.js for why a copy would drift).
function capturedSchema() {
  let schema;
  registerAnalyticsTools({
    registerTool: (name, config) => { if (name === 'data_compute_indicator') schema = config.inputSchema; },
  });
  assert.ok(schema, 'data_compute_indicator was not registered');
  return schema;
}
const parseArgs = (args) => capturedSchema().safeParse(args);

let client; let server;
before(async () => {
  server = new McpServer({ name: 'a2-boundary-test', version: '0.0.0' });
  registerAnalyticsTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'a2-boundary-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});
after(async () => { await client.close(); await server.close(); });

async function callExpectingInvalidParams(args) {
  // The SDK reports registerTool input-validation failures as a RESOLVED
  // isError result whose text carries the -32602 protocol code (measured) —
  // it does not throw a protocol error at the client call site.
  const res = await client.callTool({ name: 'data_compute_indicator', arguments: args });
  assert.equal(res.isError, true, `expected isError for ${JSON.stringify(args)}`);
  assert.match(res.content[0].text, /-32602/, `expected -32602 in: ${res.content[0].text.slice(0, 120)}`);
}

describe('boundary — strictness and presence/type semantics', () => {
  it('unknown keys are refused (the issue-#3 mode-flip class)', async () => {
    await callExpectingInvalidParams({ indicator: 'rsi', period: 14, FROM: 1, TO: 2 });
    await callExpectingInvalidParams({ indicator: 'rsi', period: 14, banana: 1 });
  });
  it('period, when SUPPLIED, is a positive integer, never coerced (schema-level, unchanged)', async () => {
    for (const bad of ['14', 0, -1, 1.5, true, null, Infinity, NaN]) {
      await callExpectingInvalidParams({ indicator: 'rsi', period: bad });
    }
  });
  it('the two per-indicator period refusals are CORE refusals through the served seam (issue #16)', async () => {
    // period became schema-OPTIONAL so vwap can omit it; presence policy
    // moved to core/analytics. Both refusals are served error results with
    // the core's typed message — NOT -32602 (the representation is legal;
    // the combination is not).
    const missing = await client.callTool({ name: 'data_compute_indicator', arguments: { indicator: 'rsi' } });
    assert.equal(missing.isError, true);
    assert.doesNotMatch(missing.content[0].text, /-32602/);
    assert.match(missing.content[0].text, /rsi: period must be a positive integer, got: undefined/);
    const supplied = await client.callTool({ name: 'data_compute_indicator', arguments: { indicator: 'vwap', period: 14 } });
    assert.equal(supplied.isError, true);
    assert.doesNotMatch(supplied.content[0].text, /-32602/);
    assert.match(supplied.content[0].text, /vwap does not take a period/);
  });
  it('last, when provided, is a positive-integer JSON number only', async () => {
    for (const bad of ['50', 0, -3, 1.5, true, null]) {
      await callExpectingInvalidParams({ indicator: 'rsi', period: 14, last: bad });
    }
  });
  it('indicator enum is curated — anything else is refused', async () => {
    await callExpectingInvalidParams({ indicator: 'macd', period: 14 });
    await callExpectingInvalidParams({ period: 14 });
  });
  it('legal shapes parse and land with exactly the caller keys', () => {
    const latest = parseArgs({ indicator: 'sma', period: 20 });
    assert.ok(latest.success);
    assert.deepEqual(latest.data, { indicator: 'sma', period: 20 });
    // vwap is period-free at the schema: omission parses to exactly one key…
    const vwapShape = parseArgs({ indicator: 'vwap' });
    assert.ok(vwapShape.success);
    assert.deepEqual(vwapShape.data, { indicator: 'vwap' });
    // Every pre-vwap enum member is PRESERVED and the schema minimum is
    // still 1 (r4 Sol F10–F11): a dropped member or a raised .min would
    // refuse what the pre-#16 contract accepted.
    for (const indicator of ['sma', 'ema', 'rsi', 'atr', 'donchian']) {
      assert.ok(parseArgs({ indicator, period: 14 }).success, `${indicator} must stay schema-accepted`);
      assert.ok(parseArgs({ indicator, period: 1 }).success, `${indicator} with the minimum period 1 must stay schema-accepted`);
    }
    // B+ amendment: `timeframe` is an optional claim, enum-curated.
    assert.ok(parseArgs({ indicator: 'sma', period: 2, timeframe: '5' }).success);
    assert.ok(parseArgs({ indicator: 'vwap', timeframe: '1' }).success);
    assert.deepEqual(parseArgs({ indicator: 'vwap', timeframe: '5' }).data, { indicator: 'vwap', timeframe: '5' });
    for (const bad of ['15', '05', 5, 1, 'five', null, '']) {
      assert.ok(!parseArgs({ indicator: 'sma', period: 2, timeframe: bad }).success, `timeframe=${JSON.stringify(bad)} must be schema-refused`);
    }
    // …and vwap WITH a period is schema-legal too — that refusal is core's
    // (the per-indicator combination policy), pinned in the served test above.
    assert.ok(parseArgs({ indicator: 'vwap', period: 14 }).success);
    const windowed = parseArgs({ indicator: 'donchian', period: 20, from: 1700000000, to: 1700086400, last: 5 });
    assert.ok(windowed.success);
    assert.deepEqual(windowed.data, { indicator: 'donchian', period: 20, from: 1700000000, to: 1700086400, last: 5 });
    // temporal representation is the SHARED unixSeconds policy: integer string ok…
    assert.ok(parseArgs({ indicator: 'rsi', period: 14, from: '1700000000', to: '1700086400' }).success);
    // …null/booleans are not (the pre-#3 coercion hole must not reappear)
    assert.ok(!parseArgs({ indicator: 'rsi', period: 14, from: null, to: 1700086400 }).success);
    assert.ok(!parseArgs({ indicator: 'rsi', period: 14, from: true, to: 1700086400 }).success);
  });
});

// ── core orchestration over a stubbed validated-OHLCV source ────────────────

function bar(time, close, spread = 1) {
  return { time, open: close, high: close + spread, low: close - spread, close, volume: 100 };
}
function stubOhlcv(bars, extra = {}) {
  const calls = [];
  const getOhlcv = async (args) => { calls.push(args); return { success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, ...extra }; };
  return { calls, getOhlcv };
}

describe('core — acquisition passthrough and transparent transport', () => {
  it('forwards exactly {summary:false, count, from, to, includeResolution:true} to getOhlcv — last never reaches acquisition', async () => {
    // includeResolution is the D2 internal envelope opt-in: A2 always asks
    // for the same-snapshot resolution; the served data_get_ohlcv never does.
    const { calls, getOhlcv } = stubOhlcv([bar(1, 10), bar(2, 11), bar(3, 12)]);
    await getIndicator({ indicator: 'sma', period: 2, count: 3, from: 100, to: 200, last: 1, _deps: { getOhlcv } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { summary: false, count: 3, from: 100, to: 200, includeResolution: true });
  });
  it('one-sided from/to is FORWARDED, never collapsed — pair validation stays the data layer\'s (round-1)', async () => {
    // A both-or-nothing collapse mutant would silently turn a from-only call
    // into latest mode instead of letting getOhlcv refuse the half-window.
    const { calls, getOhlcv } = stubOhlcv([bar(1, 10), bar(2, 11)]);
    await getIndicator({ indicator: 'sma', period: 1, from: 100, _deps: { getOhlcv } });
    assert.deepEqual(calls[0], { summary: false, count: undefined, from: 100, to: undefined, includeResolution: true });
    await getIndicator({ indicator: 'sma', period: 1, to: 200, _deps: { getOhlcv } });
    assert.deepEqual(calls[1], { summary: false, count: undefined, from: undefined, to: 200, includeResolution: true });
  });
  it('getOhlcv refusals propagate unchanged (the data layer keeps the temporal contract)', async () => {
    const getOhlcv = async () => { throw new Error('No loaded bars fall within [1, 2] — sentinel'); };
    await assert.rejects(
      () => getIndicator({ indicator: 'rsi', period: 14, from: 1, to: 2, _deps: { getOhlcv } }),
      { message: /sentinel/ },
    );
  });
  it('times/values alignment holds and values are RAW doubles (no rounding layer)', async () => {
    // closes [10,12,11] p=2 → RSI = [null, null, 200/3]; 200/3 must survive EXACTLY.
    const { getOhlcv } = stubOhlcv([bar(101, 10), bar(102, 12), bar(103, 11)]);
    const r = await getIndicator({ indicator: 'rsi', period: 2, _deps: { getOhlcv } });
    assert.deepEqual(r.times, [101, 102, 103]);
    assert.deepEqual(r.series.value.slice(0, 2), [null, null]);
    assert.equal(r.series.value[2], 100 - 100 / 3, 'raw double, bit-exact via the kernel expression — any rounding layer breaks this');
    assert.equal(r.metadata.total, 3);
    assert.equal(r.metadata.returned, 3);
    assert.equal(r.metadata.truncated, false);
    assert.equal(r.metadata.warmup_nulls_total, 2);
    assert.equal(r.source.mode, 'latest');
    assert.deepEqual([r.source.from, r.source.to], [101, 103]);
  });
  it('last omitted → the FULL series; provided → compute-first then tail-slice', async () => {
    // 60 bars — deliberately MORE than any plausible hidden default (a
    // default-50 mutant must fail this, not slip under a short fixture; the
    // A1 oracle-discrimination lesson applied to A2's own tests).
    const bars = Array.from({ length: 60 }, (_, i) => bar(i + 1, 100 + i));
    const { getOhlcv } = stubOhlcv(bars);
    const full = await getIndicator({ indicator: 'sma', period: 8, _deps: { getOhlcv } });
    assert.equal(full.times.length, 60, 'omitted last returns EVERYTHING — no hidden default tail');
    assert.equal(full.metadata.returned, 60);
    assert.equal(full.metadata.truncated, false);

    const tail = await getIndicator({ indicator: 'sma', period: 8, last: 2, _deps: { getOhlcv } });
    assert.deepEqual(tail.times, [59, 60]);
    assert.equal(tail.series.value.length, 2);
    assert.ok(tail.series.value.every((v) => v !== null), 'the returned tail has no nulls…');
    assert.equal(tail.metadata.warmup_nulls_total, 7, '…but warm-up metadata still reports the PRE-truncation count');
    assert.deepEqual({ total: tail.metadata.total, returned: tail.metadata.returned, truncated: tail.metadata.truncated }, { total: 60, returned: 2, truncated: true });
    // and the tail values equal the corresponding slice of the full computation
    assert.deepEqual(tail.series.value, full.series.value.slice(-2), 'tail === full-computation slice (never sliced-input recomputation)');
    // last > total is not an error; it simply returns everything
    const over = await getIndicator({ indicator: 'sma', period: 8, last: 200, _deps: { getOhlcv } });
    assert.equal(over.metadata.returned, 60);
    assert.equal(over.metadata.truncated, false);
  });
  it('donchian returns three aligned channels under one stable series shape', async () => {
    const bars = [bar(1, 10, 2), bar(2, 20, 2), bar(3, 15, 2)];
    const { getOhlcv } = stubOhlcv(bars);
    const r = await getIndicator({ indicator: 'donchian', period: 2, last: 2, _deps: { getOhlcv } });
    assert.deepEqual(Object.keys(r.series).sort(), ['lower', 'middle', 'upper']);
    assert.equal(r.series.upper.length, r.times.length);
    assert.equal(r.series.lower.length, r.times.length);
    assert.equal(r.series.middle.length, r.times.length);
    // p=2 on highs [12,22,17] / lows [8,18,13]: idx1 = 22/8/15, idx2 = 22/13/17.5
    assert.deepEqual(r.times, [2, 3]);
    assert.deepEqual(r.series.upper, [22, 22]);
    assert.deepEqual(r.series.lower, [8, 13]);
    assert.deepEqual(r.series.middle, [15, 17.5]);
  });
  it('insufficient history is a SUCCESSFUL all-null documented result with a note', async () => {
    const { getOhlcv } = stubOhlcv([bar(1, 10), bar(2, 11), bar(3, 12)]);
    const r = await getIndicator({ indicator: 'rsi', period: 14, _deps: { getOhlcv } });
    assert.equal(r.success, true);
    assert.deepEqual(r.series.value, [null, null, null]);
    assert.equal(r.metadata.warmup_nulls_total, 3);
    assert.match(r.note, /Insufficient history/);
  });
  it('data-layer window truncation passes through in source, distinct from the last-tail flag', async () => {
    const bars = [bar(1, 10), bar(2, 11)];
    const { getOhlcv } = stubOhlcv(bars, { mode: 'window', requested_window: { from: 1, to: 99 }, truncated: true, note: 'left-edge keep sentinel' });
    const r = await getIndicator({ indicator: 'sma', period: 1, _deps: { getOhlcv } });
    assert.equal(r.source.mode, 'window');
    assert.deepEqual(r.source.requested_window, { from: 1, to: 99 });
    assert.equal(r.source.truncated, true);
    assert.match(r.source.note, /sentinel/);
    assert.equal(r.metadata.truncated, false, 'no last given — the A2 tail flag stays false');
  });
  it('direct-core last presence belt: null/"5"/0 refuse rather than silently truncate', async () => {
    const { getOhlcv } = stubOhlcv([bar(1, 10)]);
    for (const bad of [null, '5', 0, 1.5, true]) {
      await assert.rejects(
        () => getIndicator({ indicator: 'sma', period: 1, last: bad, _deps: { getOhlcv } }),
        { name: 'Error', message: /positive integer/ },
        `last=${JSON.stringify(bad)}`,
      );
    }
  });
});

// ── the full MCP seam: SUCCESSFUL calls through the SDK ─────────────────────
// (round-1: without this, a handler-level mutant — a `last = 50` destructure
// default, handler-side rounding, a reshaped response — survived every test.)

describe('served seam — successful calls through the registered handler', () => {
  let sClient; let sServer; let sCalls;
  before(async () => {
    sServer = new McpServer({ name: 'a2-served-test', version: '0.0.0' });
    const bars = Array.from({ length: 60 }, (_, i) => bar(i + 1, 100 + i));
    sCalls = [];
    // resolution '1' rides the stub the way the enriched envelope serves it —
    // non-vwap indicators ignore it; the served vwap test depends on it.
    const getOhlcv = async (args) => { sCalls.push(args); return { success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, resolution: '1' }; };
    registerAnalyticsTools(sServer, { getOhlcv });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    sClient = new Client({ name: 'a2-served-client', version: '0.0.0' });
    await Promise.all([sServer.connect(st), sClient.connect(ct)]);
  });
  after(async () => { await sClient.close(); await sServer.close(); });

  async function callOk(args) {
    const res = await sClient.callTool({ name: 'data_compute_indicator', arguments: args });
    assert.ok(!res.isError, `expected success, got: ${res.content?.[0]?.text?.slice(0, 200)}`);
    return JSON.parse(res.content[0].text);
  }

  it('omitted last returns the FULL series through the served seam (no hidden handler default)', async () => {
    const r = await callOk({ indicator: 'sma', period: 8 });
    assert.equal(r.metadata.returned, 60);
    assert.equal(r.metadata.truncated, false);
    assert.equal(r.times.length, 60);
  });
  it('served values are raw doubles and aligned; metadata is the pre-truncation truth', async () => {
    const r = await callOk({ indicator: 'rsi', period: 2, last: 3 });
    assert.equal(r.metadata.total, 60);
    assert.equal(r.metadata.returned, 3);
    assert.equal(r.metadata.truncated, true);
    assert.equal(r.metadata.warmup_nulls_total, 2);
    assert.equal(r.times.length, 3);
    assert.equal(r.series.value.length, 3);
    // strictly rising closes → RSI 100 exactly at the tail (no rounding artifacts)
    assert.ok(r.series.value.every((v) => v === 100));
  });
  it('donchian three-channel shape survives the served seam intact', async () => {
    const r = await callOk({ indicator: 'donchian', period: 20, last: 2 });
    assert.deepEqual(Object.keys(r.series).sort(), ['lower', 'middle', 'upper']);
    assert.equal(r.series.upper.length, 2);
    assert.equal(r.series.middle.length, 2);
    assert.equal(r.series.lower.length, 2);
  });
  it('the handler forwards caller args verbatim into acquisition (spot check)', async () => {
    sCalls.length = 0;
    await callOk({ indicator: 'sma', period: 3, count: 42 });
    assert.deepEqual(sCalls[0], { summary: false, count: 42, from: undefined, to: undefined, includeResolution: true });
  });
  it('the served handler forwards a HISTORICAL window into acquisition — from/to survive the destructure (r2 Sol F9)', async () => {
    // The core-level forwarding test cannot see a handler that drops
    // from/to before calling core; this drives the windowed shape through
    // the SDK and asserts the acquisition args.
    sCalls.length = 0;
    await callOk({ indicator: 'vwap', from: 100, to: 200 });
    assert.deepEqual(sCalls[0], { summary: false, count: undefined, from: 100, to: 200, includeResolution: true });
  });
  it('served non-vwap responses do NOT carry the vwap-only field — the handler must not synthesize it (r2 Sol F10)', async () => {
    const r = await callOk({ indicator: 'sma', period: 8 });
    assert.equal('zero_volume_nulls_total' in r.metadata, false, 'zero_volume_nulls_total synthesized at the served seam');
  });
  it('served vwap: window-anchored values, vwap-only metadata, and NO period field', async () => {
    // 60 equal-volume bars, closes 100..159 with symmetric spread → hlc3 =
    // close exactly, so vwap[i] = mean(100..100+i) = 100 + i/2 — dyadic-exact.
    const r = await callOk({ indicator: 'vwap', last: 2 });
    assert.deepEqual(r.series.value, [129, 129.5]);
    assert.equal(r.metadata.total, 60);
    assert.equal(r.metadata.returned, 2);
    assert.equal(r.metadata.warmup_nulls_total, 0);
    assert.equal(r.metadata.zero_volume_nulls_total, 0);
    assert.equal('period' in r, false, 'the served vwap result omits period — not null, not 0');
  });
  it('served vwap values are RAW doubles — a non-dyadic value survives the handler bit-exactly (r3 Sol F8)', async () => {
    // The shared served stub's equal-volume bars only ever produce
    // integers and halves, which a 2-dp rounding mutant preserves; this
    // fixture's (10 + 40) / 3 does not.
    const lServer = new McpServer({ name: 'a2-served-raw-test', version: '0.0.0' });
    const bars = [
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: 2, open: 20, high: 20, low: 20, close: 20, volume: 2 },
    ];
    const getOhlcv = async () => ({ success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, resolution: '1' });
    registerAnalyticsTools(lServer, { getOhlcv });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const lClient = new Client({ name: 'a2-served-raw-client', version: '0.0.0' });
    await Promise.all([lServer.connect(st), lClient.connect(ct)]);
    try {
      const res = await lClient.callTool({ name: 'data_compute_indicator', arguments: { indicator: 'vwap' } });
      assert.ok(!res.isError, res.content?.[0]?.text?.slice(0, 120));
      const r = JSON.parse(res.content[0].text);
      assert.equal(r.series.value[1], (10 + 20 * 2) / 3, 'a handler-side rounding layer breaks bit-exact transport');
    } finally {
      await lClient.close();
      await lServer.close();
    }
  });
  it('served timeframe "5" derives completed 5m analytics through the SDK (B+ amendment)', async () => {
    const lServer = new McpServer({ name: 'a2-served-5m-derive', version: '0.0.0' });
    const bars = [
      { time: 0, open: 4, high: 4, low: 4, close: 4, volume: 1 },
      { time: 60, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: 300, open: 40, high: 40, low: 40, close: 40, volume: 2 },
      { time: 600, open: 9, high: 9, low: 9, close: 9, volume: 5 }, // terminal — excluded
    ];
    const getOhlcv = async () => ({ success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, resolution: '1' });
    registerAnalyticsTools(lServer, { getOhlcv });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const lClient = new Client({ name: 'a2-served-5m-derive-client', version: '0.0.0' });
    await Promise.all([lServer.connect(st), lClient.connect(ct)]);
    try {
      const res = await lClient.callTool({ name: 'data_compute_indicator', arguments: { indicator: 'vwap', timeframe: '5' } });
      assert.ok(!res.isError, res.content?.[0]?.text?.slice(0, 160));
      const r = JSON.parse(res.content[0].text);
      assert.equal(r.timeframe, '5');
      assert.deepEqual(r.times, [0, 300]);
      assert.deepEqual(r.series.value, [7, 23.5]);
      assert.equal(r.metadata.excluded_terminal_1m_bars, 1);
      const smaRes = await lClient.callTool({ name: 'data_compute_indicator', arguments: { indicator: 'sma', period: 1, timeframe: '5' } });
      assert.ok(!smaRes.isError);
      const s = JSON.parse(smaRes.content[0].text);
      assert.deepEqual(s.series.value, [10, 40], 'A1 sma over the derived 5m closes');
      assert.equal('zero_volume_nulls_total' in s.metadata, false);
    } finally {
      await lClient.close();
      await lServer.close();
    }
  });
  it('served vwap on a non-1-minute chart is refused by the gate, naming required and actual', async () => {
    const lServer = new McpServer({ name: 'a2-served-5m-test', version: '0.0.0' });
    const bars = [bar(1, 10), bar(2, 11)];
    const getOhlcv = async () => ({ success: true, bar_count: bars.length, total_available: 999, source: 'direct_bars', mode: 'latest', bars, resolution: '60' });
    registerAnalyticsTools(lServer, { getOhlcv });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const lClient = new Client({ name: 'a2-served-5m-client', version: '0.0.0' });
    await Promise.all([lServer.connect(st), lClient.connect(ct)]);
    try {
      const res = await lClient.callTool({ name: 'data_compute_indicator', arguments: { indicator: 'vwap' } });
      assert.equal(res.isError, true);
      // parse first: inside the served JSON the quotes are escaped (\"1\")
      const body = JSON.parse(res.content[0].text);
      assert.equal(body.success, false);
      assert.match(body.error, /exactly "1", got: "60"/);
    } finally {
      await lClient.close();
      await lServer.close();
    }
  });
});

// ── static invariants ───────────────────────────────────────────────────────

describe('A2 invariants', () => {
  it('core/analytics owns no acquisition: only core/data + the A1 kernel are imported', () => {
    const src = readFileSync(join(here, '../src/core/analytics.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ['../analytics/indicators.js', '../analytics/timeframe.js', '../analytics/vwap.js', './data.js']);
    for (const banned of ['connection', 'evaluate', 'fetch', 'WebSocket', 'CDP']) {
      assert.ok(!code.includes(banned), `core/analytics must not reference ${banned}`);
    }
  });
  it('tools/analytics owns no acquisition either: only zod, format, temporal, and core/analytics', () => {
    const src = readFileSync(join(here, '../src/tools/analytics.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ['../core/analytics.js', './_format.js', './_temporal.js', 'zod']);
    for (const banned of ['connection', 'evaluate(', 'fetch', 'XMLHttpRequest', 'WebSocket', 'CDP', 'http://', 'ws://']) {
      assert.ok(!code.includes(banned), `tools/analytics must not reference ${banned}`);
    }
  });
  it('the A1 kernel file is byte-identical to its A1-closed state (A2 changes nothing numerical)', () => {
    // Pinned via content hash of the file as merged in A1 (commit 49ded0f /
    // main dfdf17a). Any A2-era edit to the kernel must fail loudly here.
    const kernel = readFileSync(join(here, '../src/analytics/indicators.js'));
    assert.equal(createHash('sha256').update(kernel).digest('hex'),
      'b21df40abaa392c5905db3335b78028ab3d84b98ca53c24724529abcaac1cfed');
  });
});
