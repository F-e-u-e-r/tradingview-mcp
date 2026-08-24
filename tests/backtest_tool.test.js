// BT5 — the served `data_compute_backtest` boundary, tested against the
// RATIFIED BT5 contract (docs/BT5-CONTRACT.md, ratified @ 35a31c52, merged
// ab85e472). Oracle discipline:
//
//   1. SERVED METADATA IS THE PUBLIC CONTRACT (D8). Every claim about what
//      this tool is — and is not — is asserted against the REAL registered
//      config and the REAL served seam, never against a source comment. This
//      is the VWAP lesson made binding.
//   2. REFUSE BEFORE ACQUISITION (D3). Every error decidable from the request
//      alone must fail with the acquisition spy at ZERO calls. A refusal that
//      touched the chart first is a contract violation even if the message is
//      right.
//   3. THE STRATEGY SURFACE IS A CLOSED NESTED DISCRIMINATED OBJECT (D2/D2a).
//      The five binding rejections are pinned here, and a foreign field is
//      REFUSED — never silently ignored, which is the failure mode the ruling
//      exists to prevent.
//
// Contract reminders (ratified, none reviewable here): the tool is the sole
// new MCP capability and takes the allowlist 8 -> 9; V1 exposes exactly
// `donchian` and `sma_crossover`; the three cost parameters are REQUIRED
// because BT2 §3 forbids silent defaults ("a zero-cost run states its
// zeros"); acquisition is inherited unchanged with the <=500 cap.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerBacktestTools } from '../src/tools/backtest.js';
import { computeBacktest } from '../src/core/backtest.js';
import { getOhlcv as realGetOhlcv } from '../src/core/data.js';

const TOOL = 'data_compute_backtest';

// A bar series with a proven-complete terminal bar, so a legal call succeeds
// and the refusal tests are not passing for the wrong reason.
const bar = (i, close) => ({ time: 1700000000 + i * 60, open: close, high: close + 2, low: close - 2, close, volume: 100 });
const BARS = Array.from({ length: 40 }, (_, i) => bar(i, 100 + ((i * 7) % 23)));

function servedConfig() {
  let captured;
  registerBacktestTools({ registerTool: (name, config) => { if (name === TOOL) captured = { name, config }; } });
  return captured;
}

// ── 1. served metadata — the public contract (D8) ──────────────────────────

describe('served metadata is the public contract (D8)', () => {
  const served = servedConfig();

  it('registers exactly one tool, under the ratified name', () => {
    assert.ok(served, `${TOOL} must be registered`);
    assert.equal(served.name, TOOL);
  });

  it('states SIMULATION ONLY, in the served description itself', () => {
    // Owner wording, binding: a caller must not be able to read this as a
    // trading or trade-retrieval capability.
    assert.match(served.config.description, /Simulation only/i);
    assert.match(served.config.description, /does not place, submit, modify, replay, or retrieve real trades or orders/i);
  });

  it('the served surface never advertises a trading, replay, or trade-retrieval capability', () => {
    const blob = JSON.stringify(served.config).toLowerCase();
    for (const forbidden of ['data_get_trades', 'data_get_equity', 'data_get_strategy_results',
      'replay_trade', 'replay_start', 'place order', 'submit order', 'live trading']) {
      assert.ok(!blob.includes(forbidden), `the served surface must not mention ${forbidden}`);
    }
  });

  it('exposes exactly the two CLOSED strategies, as a nested discriminated object (D2/D2a)', () => {
    const strategy = served.config.inputSchema.shape.strategy;
    assert.ok(strategy, 'the strategy input exists');
    // The two arms, discriminated by `type`, and nothing else.
    const types = strategy.options.map((o) => o.shape.type.value).sort();
    assert.deepStrictEqual(types, ['donchian', 'sma_crossover']);
  });

  it('the three cost parameters are REQUIRED — BT2 forbids silent defaults', () => {
    for (const key of ['initialCash', 'commissionRate', 'slippageRate']) {
      const field = served.config.inputSchema.shape[key];
      assert.ok(field, `${key} is part of the served surface`);
      assert.equal(field.safeParse(undefined).success, false, `${key} must be required, not optional`);
    }
  });

  it('inherits the two window modes and the <=500 cap, unchanged (D4)', () => {
    const shape = served.config.inputSchema.shape;
    for (const key of ['count', 'from', 'to']) assert.ok(shape[key], `${key} is inherited`);
    assert.equal(shape.count.safeParse(501).success, false, 'the 500-bar cap is inherited');
    assert.equal(shape.count.safeParse(500).success, true);
    assert.match(served.config.description, /from\+to|from and to/i, 'the two modes are documented on the served surface');
  });

  it('the description tells the caller that an unprovable terminal bar is excluded (D5)', () => {
    assert.match(served.config.description, /complet/i);
    assert.match(served.config.description, /exclud/i);
  });
});

// ── 2. refuse before acquisition (D3), over the REAL served seam ────────────

describe('the nested discriminated schema refuses BEFORE acquisition (D2a / D3)', () => {
  let client; let server; let calls;

  before(async () => {
    server = new McpServer({ name: 'bt5-served-test', version: '0.0.0' });
    calls = [];
    const getOhlcv = async (args) => {
      calls.push(args);
      return {
        success: true, mode: 'latest', bar_count: BARS.length, total_available: BARS.length,
        source: 'direct_bars', bars: BARS, resolution: '1', symbol: 'NASDAQ:TQQQ',
        terminalCompletion: { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: 1700009999 },
      };
    };
    registerBacktestTools(server, { getOhlcv });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'bt5-served-client', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });
  after(async () => { await client.close(); await server.close(); });

  const LEGAL_COSTS = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
  const call = (args) => client.callTool({ name: TOOL, arguments: args });

  const REFUSALS = [
    ['unknown strategy type', { strategy: { type: 'rsi_reversion', period: 14 }, ...LEGAL_COSTS }],
    ['a field belonging to no strategy', { strategy: { type: 'donchian', period: 20, bogus: 1 }, ...LEGAL_COSTS }],
    ['an extra field from the OTHER strategy', { strategy: { type: 'donchian', period: 20, slowPeriod: 50 }, ...LEGAL_COSTS }],
    ['a missing required parameter', { strategy: { type: 'sma_crossover', fastPeriod: 10 }, ...LEGAL_COSTS }],
    ['an invalid period relation', { strategy: { type: 'sma_crossover', fastPeriod: 20, slowPeriod: 10 }, ...LEGAL_COSTS }],
    ['a coerced string period', { strategy: { type: 'donchian', period: '20' }, ...LEGAL_COSTS }],
    ['a fractional period', { strategy: { type: 'donchian', period: 2.5 }, ...LEGAL_COSTS }],
    ['an unknown top-level key', { strategy: { type: 'donchian', period: 20 }, ...LEGAL_COSTS, extra: 1 }],
    ['a missing cost parameter', { strategy: { type: 'donchian', period: 20 }, initialCash: 1000, commissionRate: 0 }],
    ['an inadmissible commissionRate', { strategy: { type: 'donchian', period: 20 }, initialCash: 1000, commissionRate: 1, slippageRate: 0 }],
    ['a non-positive initialCash', { strategy: { type: 'donchian', period: 20 }, initialCash: 0, commissionRate: 0, slippageRate: 0 }],
  ];
  // NOTE — the half-open window is deliberately NOT in this list. Its refusal
  // belongs to the DATA layer, which D4 requires BT5 to inherit verbatim
  // rather than re-implement, and that guard already fires before the layer
  // touches the chart. Asserting it here would measure getOhlcv invocations
  // rather than capability spend, and a stubbed getOhlcv cannot refuse it at
  // all. It is tested against the REAL data layer below, with an `evaluate`
  // spy — the assertion D3 actually cares about.

  for (const [label, args] of REFUSALS) {
    it(`refuses ${label} — with ZERO acquisitions`, async () => {
      const before = calls.length;
      const res = await call(args);
      assert.ok(res.isError || res.error, `${label} must be refused`);
      assert.equal(calls.length, before, `${label} must not reach acquisition`);
    });
  }

  it('a foreign field is REFUSED, never silently ignored', async () => {
    // The failure mode the ruling exists to prevent: the caller believes a
    // parameter took effect when it did not.
    const res = await call({ strategy: { type: 'sma_crossover', fastPeriod: 5, slowPeriod: 10, period: 20 }, ...LEGAL_COSTS });
    assert.ok(res.isError || res.error, 'a stray `period` on sma_crossover must be refused');
  });

  it('both legal shapes DO acquire — the refusals are not passing vacuously', async () => {
    const before = calls.length;
    const a = await call({ strategy: { type: 'donchian', period: 5 }, ...LEGAL_COSTS });
    assert.ok(!a.isError, `donchian must succeed: ${a.content?.[0]?.text?.slice(0, 200)}`);
    const b = await call({ strategy: { type: 'sma_crossover', fastPeriod: 3, slowPeriod: 8 }, ...LEGAL_COSTS });
    assert.ok(!b.isError, `sma_crossover must succeed: ${b.content?.[0]?.text?.slice(0, 200)}`);
    assert.equal(calls.length, before + 2, 'exactly the two legal calls acquired');
  });

  it('acquisition is the inherited call shape — summary:false plus the internal opt-ins (D4)', async () => {
    calls.length = 0;
    await call({ strategy: { type: 'donchian', period: 5 }, ...LEGAL_COSTS, from: 1700000000, to: 1700009999 });
    assert.equal(calls.length, 1);
    const args = calls[0];
    assert.equal(args.summary, false, 'BT5 needs raw bars');
    assert.equal(args.from, 1700000000);
    assert.equal(args.to, 1700009999);
    assert.ok(args.includeResolution === true, 'the authoritative resolution is requested');
    assert.ok(args.includeProvenance === true, 'symbol and completion evidence are requested in the SAME snapshot');
  });
});

// ── 3. data-layer refusals are INHERITED, not re-implemented (D4) ───────────
// D3's substance is capability spend and error provenance, so the honest
// measurement is chart access — an `evaluate` spy — not getOhlcv invocations.
// These run the REAL data layer through BT5's own injection seam.

describe('inherited data-layer refusals (D4), measured by chart access', () => {
  const LEGAL = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
  const withEvaluate = (evaluate) => ({
    getOhlcv: (args) => realGetOhlcv({ ...args, _deps: { evaluate } }),
  });

  it('a half-open window is refused by the inherited guard, at ZERO chart reads', async () => {
    let reads = 0;
    const evaluate = async () => { reads += 1; return null; };
    await assert.rejects(
      () => computeBacktest({
        strategy: { type: 'donchian', period: 20 }, ...LEGAL, from: 1700000000,
        _deps: withEvaluate(evaluate),
      }),
      // The DATA layer's own wording, verbatim — BT5 does not restate it.
      /Provide both from and to \(unix seconds\), or neither/,
    );
    assert.equal(reads, 0, 'a request-decidable refusal must cost no chart access');
  });

  it('a window with no loaded bars propagates the data-layer refusal unchanged', async () => {
    let reads = 0;
    const evaluate = async () => {
      reads += 1;
      return { bars: [], total_bars: 0, truncated: false, source: 'direct_bars', resolution: '1', symbol: 'X', successorTime: null };
    };
    await assert.rejects(
      () => computeBacktest({
        strategy: { type: 'donchian', period: 20 }, ...LEGAL, from: 1700000000, to: 1700009999,
        _deps: withEvaluate(evaluate),
      }),
      /No loaded bars fall within \[1700000000, 1700009999\]/,
    );
    // Contrast with the case above: this one is a DATA condition, not a
    // request error, so reading the chart to discover it is correct.
    assert.equal(reads, 1, 'a data-condition refusal legitimately reads the chart once');
  });

  it('acquisition happens EXACTLY once per call — no second evaluate anywhere (§6.3)', async () => {
    let reads = 0;
    const rows = Array.from({ length: 30 }, (_, i) => [1700000000 + i * 60, 100 + i, 102 + i, 98 + i, 101 + i, 10]);
    const evaluate = async () => {
      reads += 1;
      return {
        bars: rows.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })),
        total_bars: rows.length, truncated: false, source: 'direct_bars',
        resolution: '1', symbol: 'NASDAQ:TQQQ', successorTime: 1700009999,
      };
    };
    const r = await computeBacktest({
      strategy: { type: 'donchian', period: 5 }, ...LEGAL, _deps: withEvaluate(evaluate),
    });
    assert.equal(reads, 1, 'exactly one page evaluation per call');
    assert.equal(r.source.symbol, 'NASDAQ:TQQQ');
    assert.equal(r.source.resolution, '1');
    assert.deepStrictEqual(r.source.terminal_completion,
      { established: true, evidence: 'later_bar_in_same_snapshot', successor_time: 1700009999 });
  });
});

// ── 4. the same-snapshot enrichment, against the REAL acquisition script ────
// House pattern (chart_contract.test.js): drive the actual page script built
// by src/core/data.js against a fake chart, so this is the shipped script's
// behaviour and not a paraphrase of it.

describe('same-snapshot provenance enrichment (§6.3), through the REAL acquisition script', () => {
  const T0 = 1700000000;
  const ROWS = Array.from({ length: 12 }, (_, i) => [T0 + i * 60, 100 + i, 105 + i, 95 + i, 102 + i, 10]);
  const fakeChart = ({ rows = ROWS, symbol = 'NASDAQ:TQQQ', resolution = '1' } = {}) => {
    const bars = {
      firstIndex: () => 0,
      lastIndex: () => rows.length - 1,
      size: () => rows.length,
      valueAt: (i) => (i >= 0 && i < rows.length ? rows[i] : null),
    };
    const chart = {
      symbol: () => symbol,
      resolution: () => resolution,
      _chartWidget: { model: () => ({ mainSeries: () => ({ bars: () => bars }) }) },
    };
    const win = { TradingViewApi: { _activeChartWidgetWV: { value: () => chart } } };
    return async (expr) => new Function('window', 'document', `return (${expr});`)(win, {});
  };

  it('an INTERIOR window proves its terminal bar complete — and the successor never enters the bars', async () => {
    const r = await realGetOhlcv({
      summary: false, from: ROWS[2][0], to: ROWS[5][0],
      includeResolution: true, includeProvenance: true, _deps: { evaluate: fakeChart() },
    });
    assert.equal(r.bar_count, 4, 'exactly the requested window');
    assert.deepStrictEqual(r.terminalCompletion,
      { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: ROWS[6][0] });
    // EVIDENCE ONLY: the proving bar is not delivered as data.
    assert.ok(!r.bars.some((b) => b.time === ROWS[6][0]), 'the successor must never be returned as a bar');
    assert.equal(r.bars[r.bars.length - 1].time, ROWS[5][0], 'the window was not widened');
  });

  it('a TERMINAL window cannot prove its last bar, and says so', async () => {
    const r = await realGetOhlcv({
      summary: false, from: ROWS[8][0], to: ROWS[11][0],
      includeResolution: true, includeProvenance: true, _deps: { evaluate: fakeChart() },
    });
    assert.deepStrictEqual(r.terminalCompletion, { established: false, evidence: null, successorTime: null });
  });

  it('LATEST mode ends on the chart terminal bar, which is never self-provable', async () => {
    const r = await realGetOhlcv({
      summary: false, count: 500, includeResolution: true, includeProvenance: true, _deps: { evaluate: fakeChart() },
    });
    assert.equal(r.bar_count, ROWS.length);
    assert.equal(r.terminalCompletion.established, false);
  });

  it('symbol and resolution are transported verbatim, and null when unestablished', async () => {
    const ok = await realGetOhlcv({ summary: false, includeResolution: true, includeProvenance: true, _deps: { evaluate: fakeChart() } });
    assert.equal(ok.symbol, 'NASDAQ:TQQQ');
    assert.equal(ok.resolution, '1');
    const blank = await realGetOhlcv({
      summary: false, includeResolution: true, includeProvenance: true,
      _deps: { evaluate: fakeChart({ symbol: null, resolution: null }) },
    });
    assert.equal(blank.symbol, null, 'unestablished symbol is null, never invented');
    assert.equal(blank.resolution, null);
  });

  it('the decision is CLOCK-FREE: the same data a whole day later decides identically', async () => {
    const shifted = ROWS.map((r) => [r[0] + 86400, ...r.slice(1)]);
    const a = await realGetOhlcv({ summary: false, from: ROWS[2][0], to: ROWS[5][0], includeProvenance: true, _deps: { evaluate: fakeChart() } });
    const b = await realGetOhlcv({ summary: false, from: shifted[2][0], to: shifted[5][0], includeProvenance: true, _deps: { evaluate: fakeChart({ rows: shifted }) } });
    assert.equal(a.terminalCompletion.established, b.terminalCompletion.established);
    assert.equal(b.terminalCompletion.successorTime, shifted[6][0]);
  });

  it('the PUBLIC data_get_ohlcv shape is unchanged — the opt-ins are internal only', async () => {
    for (const summary of [true, false]) {
      const r = await realGetOhlcv({ summary, _deps: { evaluate: fakeChart() } });
      assert.equal('symbol' in r, false, `summary=${summary}: symbol must not appear without the opt-in`);
      assert.equal('terminalCompletion' in r, false, `summary=${summary}: completion must not appear without the opt-in`);
      assert.equal('resolution' in r, false, `summary=${summary}: resolution stays opt-in too`);
    }
  });
});

// ── 5. the completion POLICY, and the three-block response (D5/D6) ─────────

describe('completion policy and response shape (D5 / D6)', () => {
  const T0 = 1700000000;
  const mkBars = (n) => Array.from({ length: n }, (_, i) => ({
    time: T0 + i * 60, open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i, volume: 10,
  }));
  const LEGAL = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
  const envelope = (bars, completion) => ({
    success: true, mode: 'latest', bar_count: bars.length, total_available: bars.length,
    source: 'direct_bars', bars, resolution: '1', symbol: 'NASDAQ:TQQQ', terminalCompletion: completion,
  });
  const run = (bars, completion, extra = {}) => computeBacktest({
    strategy: { type: 'donchian', period: 3 }, ...LEGAL, ...extra,
    _deps: { getOhlcv: async () => envelope(bars, completion) },
  });

  it('a PROVEN terminal bar is used — nothing is excluded', async () => {
    const bars = mkBars(20);
    const r = await run(bars, { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: T0 + 9999 });
    assert.equal(r.source.bars_acquired, 20);
    assert.equal(r.source.bars_used, 20);
    assert.equal(r.source.excluded_incomplete_terminal_bars, 0);
    assert.equal(r.source.to, bars[19].time);
  });

  it('an UNPROVEN terminal bar is excluded, and the exclusion is observable (BT0 §4.7)', async () => {
    const bars = mkBars(20);
    const r = await run(bars, { established: false, evidence: null, successorTime: null });
    assert.equal(r.source.bars_acquired, 20);
    assert.equal(r.source.bars_used, 19, 'the unprovable terminal bar does not participate');
    assert.equal(r.source.excluded_incomplete_terminal_bars, 1);
    assert.equal(r.source.to, bars[18].time, 'the evaluated window ends one bar earlier');
    assert.deepStrictEqual(r.source.terminal_completion, { established: false, evidence: null, successor_time: null });
  });

  it('exclusion changes the simulation, so it is not a cosmetic label', async () => {
    // A breakout on the FINAL bar produces a terminal pending signal when that
    // bar is used, and nothing at all when it is excluded.
    const bars = [...mkBars(4).map((b) => ({ ...b, high: 105, low: 95, open: 100, close: 100 })),
      { time: T0 + 240, open: 100, high: 130, low: 99, close: 128, volume: 10 }];
    const used = await run(bars, { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: T0 + 300 });
    const dropped = await run(bars, { established: false, evidence: null, successorTime: null });
    assert.notDeepStrictEqual(used.result.pendingSignal, dropped.result.pendingSignal);
    assert.equal(dropped.source.bars_used, used.source.bars_used - 1);
  });

  it('the response is exactly the three ratified blocks', async () => {
    const r = await run(mkBars(20), { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: T0 + 9999 });
    assert.deepStrictEqual(Object.keys(r).sort(), ['assumptions', 'result', 'source', 'success']);
  });

  it('assumptions state what a caller would otherwise have to guess', async () => {
    const r = await computeBacktest({
      strategy: { type: 'sma_crossover', fastPeriod: 2, slowPeriod: 5 },
      initialCash: 2000, commissionRate: 0.001, slippageRate: 0.002,
      _deps: { getOhlcv: async () => envelope(mkBars(20), { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: T0 + 9999 }) },
    });
    assert.deepStrictEqual(r.assumptions.strategy, { type: 'sma_crossover', fastPeriod: 2, slowPeriod: 5 });
    assert.equal(r.assumptions.signal_model, 'completed_bar');
    assert.equal(r.assumptions.execution, 'next_bar_open');
    assert.equal(r.assumptions.long_only, true);
    assert.equal(r.assumptions.max_open_positions, 1);
    assert.equal(r.assumptions.pyramiding, false);
    assert.equal(r.assumptions.force_close, false);
    assert.equal(r.assumptions.max_bars, 500);
    // The reported costs are the ones the CLOSED layer actually applied.
    assert.deepStrictEqual(
      { initialCash: r.assumptions.initialCash, commissionRate: r.assumptions.commissionRate, slippageRate: r.assumptions.slippageRate },
      r.result.accounting.assumptions);
  });

  it('the result keeps every BT0 §4.5 distinction — it is not reshaped', async () => {
    const r = await run(mkBars(20), { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: T0 + 9999 });
    for (const key of ['executions', 'closedTrades', 'openPosition', 'pendingSignal',
      'totalExecutions', 'totalClosedTrades', 'accounting', 'metrics']) {
      assert.ok(key in r.result, `result.${key} is present`);
    }
    // executions vs closed trades are distinct counts, never conflated.
    assert.equal(typeof r.result.totalExecutions, 'number');
    assert.equal(typeof r.result.totalClosedTrades, 'number');
    assert.equal(r.result.metrics.closedTrades, r.result.totalClosedTrades);
  });
});

// ── 6. D7a — CLOSED-kernel typed errors propagate UNCHANGED ────────────────

describe('CLOSED-kernel typed errors propagate unchanged (D7a)', () => {
  let client; let server;
  const T0 = 1700000000;
  // A breakout at bar 3 fills at bar 4's open, which is 0 — BT2 refuses it
  // with its own ratified wording.
  const BAD = [
    { time: T0, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: T0 + 60, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: T0 + 120, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: T0 + 180, open: 10, high: 12, low: 10, close: 11, volume: 1 },
    { time: T0 + 240, open: 0, high: 1, low: 0, close: 0.5, volume: 1 },
  ];
  before(async () => {
    server = new McpServer({ name: 'bt5-err-test', version: '0.0.0' });
    const getOhlcv = async () => ({
      success: true, mode: 'latest', bar_count: BAD.length, total_available: BAD.length,
      source: 'direct_bars', bars: BAD, resolution: '1', symbol: 'X',
      terminalCompletion: { established: true, evidence: 'later_bar_in_same_snapshot', successorTime: T0 + 300 },
    });
    registerBacktestTools(server, { getOhlcv });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'bt5-err-client', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });
  after(async () => { await client.close(); await server.close(); });

  it('a BT2 refusal reaches the caller with its OWN wording, and no BT5 prefix', async () => {
    const res = await client.callTool({
      name: TOOL,
      arguments: { strategy: { type: 'donchian', period: 3 }, initialCash: 1000, commissionRate: 0, slippageRate: 0 },
    });
    assert.ok(res.isError, 'the CLOSED layer must refuse this');
    const { error } = JSON.parse(res.content[0].text);
    assert.match(error, /^accountBacktest: /, 'the error identity closest to the fault survives');
    assert.ok(!error.includes('computeBacktest:'), 'no BT5 prefix');
    assert.equal((error.match(/:/g) || []).length <= 2, true, 'no prefix stacking');
  });
});

// ── 7. D8a — the five negatives the migrated containment gate must prove ────

describe('exactly one approved path, and the five negatives (D8a)', () => {
  const here2 = dirname(fileURLToPath(import.meta.url));
  const read = (rel) => readFileSync(join(here2, rel), 'utf8');
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  const toolFiles = readdirSync(join(here2, '../src/tools')).filter((f) => f.endsWith('.js'));
  const coreFiles = readdirSync(join(here2, '../src/core')).filter((f) => f.endsWith('.js'));

  it('1. there is NO second backtest tool — the registration appears exactly once', () => {
    let registrations = 0;
    for (const f of toolFiles) {
      registrations += (strip(read(`../src/tools/${f}`)).match(/registerTool\(\s*'data_compute_backtest'/g) || []).length;
    }
    assert.equal(registrations, 1, 'exactly one registration of the BT5 tool, in exactly one file');
    // …and no other tool file registers anything backtest-shaped.
    for (const f of toolFiles.filter((x) => x !== 'backtest.js')) {
      assert.ok(!/registerTool\(\s*'[^']*backtest[^']*'/.test(strip(read(`../src/tools/${f}`))),
        `${f} must not register a second backtest-shaped tool`);
    }
  });

  it('2. there is NO generic arbitrary-strategy executor', () => {
    const bt5 = [strip(read('../src/tools/backtest.js')), strip(read('../src/core/backtest.js'))].join('\n');
    for (const banned of [/\beval\b/, /\bnew Function\b/, /\bFunction\s*\(/, /\bimport\s*\(/, /\brequire\b/,
      /\bvm\b/, /\bcompile\b/, /\buserCode\b/, /\bexpression\b/]) {
      assert.ok(!banned.test(bt5), `BT5 must expose no arbitrary-code capability: ${banned}`);
    }
    // The strategy set is closed and named, not discovered at runtime.
    const core = strip(read('../src/core/backtest.js'));
    assert.match(core, /const STRATEGY_SPEC = \{/, 'the strategy set is a fixed literal');
    assert.equal((core.match(/^\s{2}(donchian|sma_crossover):/gm) || []).length, 2,
      'exactly two strategy arms, written out');
  });

  it('3. the generalized engine has NO direct MCP exposure', () => {
    for (const f of toolFiles) {
      assert.ok(!strip(read(`../src/tools/${f}`)).includes('analytics/engine.js'),
        `${f} must not reach the engine directly — only core/backtest.js may`);
    }
    const importers = coreFiles.filter((f) => strip(read(`../src/core/${f}`)).includes('analytics/engine.js'));
    assert.deepStrictEqual(importers, ['backtest.js'], 'exactly one core module imports the engine');
  });

  it('4. nothing in the BT5 path routes to replay or trading', () => {
    // Scanned in three positions, deliberately — a blunt substring ban would
    // trip on the served description itself, whose whole job is to say this
    // tool does NOT place, submit, modify, replay, or retrieve real orders.
    // A denial is not a route.
    const code = [strip(read('../src/tools/backtest.js')), strip(read('../src/core/backtest.js'))].join('\n');
    const noStrings = code.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');

    // (a) no identifier or call reaching a trading/replay capability
    for (const banned of [/\breplay[A-Za-z_]*\b/, /\bplaceOrder\b/, /\bsubmitOrder\b/,
      /\bcreateOrder\b/, /\bcancelOrder\b/, /\bbroker[A-Za-z_]*\b/, /\bsendOrder\b/]) {
      assert.ok(!banned.test(noStrings), `the BT5 path must not call anything matching ${banned}`);
    }
    // (b) no module import that reaches one
    assert.ok(!/from\s*'[^']*(replay|order|broker|trading)[^']*'/i.test(code),
      'no BT5 module may import a replay/order/broker/trading module');
    // (c) the dropped upstream capability NAMES appear nowhere at all, not
    // even in prose — they must not be reintroduced under this tool's cover.
    for (const name of ['data_get_trades', 'data_get_equity', 'data_get_strategy_results']) {
      assert.ok(!code.includes(name), `the BT5 path must not reference ${name}`);
    }
    // (d) and the description's mention of those verbs really is a DENIAL.
    assert.match(read('../src/tools/backtest.js'),
      /does not place, submit, modify, replay, or retrieve real trades or orders/i,
      'the only mention of replay/orders on this surface is the denial itself');
  });

  it('5. every other denylisted capability stays forbidden — the list is intact', () => {
    const gate = read('../tests/tool_surface.test.js');
    const deny = gate.slice(gate.indexOf('const DENYLIST'));
    for (const name of ['data_get_strategy_results', 'data_get_trades', 'data_get_equity',
      'replay_trade', 'replay_start', 'replay_step', 'replay_stop', 'ui_evaluate',
      'pine_set_source', 'alert_create', 'batch_run', 'data_get_indicator']) {
      assert.ok(deny.includes(`'${name}'`), `the denylist must still name ${name}`);
    }
    // BT5 did not grow the denylist with speculative names (D1a).
    assert.ok(!deny.includes("'data_compute_backtest'"), 'the approved tool is not denylisted');
  });

  it('the one approved path is wired, end to end', () => {
    const server = strip(read('../src/server.js'));
    assert.match(server, /registerBacktestTools\(server\)/);
    assert.match(server, /from '\.\/tools\/backtest\.js'/);
    assert.match(strip(read('../src/tools/backtest.js')), /from '\.\.\/core\/backtest\.js'/);
    assert.match(strip(read('../src/core/backtest.js')), /from '\.\/data\.js'/);
  });
});
