/**
 * The MCP boundary regression suite.
 *
 * WHY THIS FILE EXISTS. The chart contract's C1 tests call `getOhlcv()` directly,
 * so nothing ever exercised `registerDataTools`' schema — the code path every real
 * caller goes through. A cross-model review found the gap immediately: the tool
 * schema used `z.coerce.number().int().optional()`, and zod's `.optional()`
 * short-circuits only `undefined`. An MCP client sending `from: null` (the ordinary
 * way a client says "not specified") was handed to `Number(null)` → epoch **0**,
 * which defeated the half-window guard in core BEFORE core could apply it. On a
 * real chart `{from: null, to: <newest bar>}` came back
 * `success:true, mode:'window', requested_window:{from:0,…}` carrying the OLDEST
 * loaded bars — the same temporal substitution C1 exists to forbid, mirrored.
 *
 * The division of responsibility this suite pins:
 *
 *   the boundary rejects a malformed REPRESENTATION
 *   core enforces the TEMPORAL contract
 *
 * Neither substitutes for the other, so `tests/chart_contract.test.js` keeps its
 * own half-window and window-membership assertions against core.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerDataTools } from '../src/tools/data.js';
import { registerChartTools } from '../src/tools/chart.js';

/**
 * The schema the server actually registers — captured from the real
 * registration call, never re-declared here. A copy would drift and pass while
 * production broke. Registration-form-agnostic: a legacy `tool()` raw shape is
 * wrapped in `z.object()` (the strip-unknowns semantics the SDK applies to raw
 * shapes); a `registerTool()` object schema is used AS-IS — the SDK validates
 * call arguments against that same object through its zod-compat layer, so
 * there is no separate "SDK parse" to imitate and nothing to drift from.
 */
function capturedSchema(register, toolName) {
  let schema;
  register({
    tool: (name, _desc, paramsSchema) => { if (name === toolName) schema = z.object(paramsSchema); },
    registerTool: (name, config) => { if (name === toolName) schema = config.inputSchema; },
  });
  assert.ok(schema, `${toolName} was not registered`);
  return schema;
}

const parseArgs = (args) => capturedSchema(registerDataTools, 'data_get_ohlcv').safeParse(args);
const parseRangeArgs = (args) => capturedSchema(registerChartTools, 'chart_set_visible_range').safeParse(args);

let client, server;
before(async () => {
  server = new McpServer({ name: 'boundary-test', version: '0.0.0' });
  registerDataTools(server);
  registerChartTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'boundary-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});
after(async () => { await client?.close(); await server?.close(); });

/**
 * A schema rejection surfaces as JSON-RPC -32602 in the tool result. It is also
 * the FAST path: validation fails before the handler runs, so no CDP connection
 * is attempted. An accepted call, by contrast, reaches the handler and pays the
 * connection retry budget — which is why the accepted cases below are asserted
 * against the schema rather than dispatched, with one deliberate exception.
 */
const rejected = (res) => res?.isError === true
  && /-32602|Input validation error/.test(res?.content?.[0]?.text ?? '');

const call = (args) => client.callTool({ name: 'data_get_ohlcv', arguments: args });
const callRange = (args) => client.callTool({ name: 'chart_set_visible_range', arguments: args });

const T = 1_700_000_000;
const T2 = 1_700_000_600;

describe('MCP boundary — unknown temporal keys must not silently become latest mode (IH1)', () => {
  // data_get_ohlcv has TWO legal modes ({} → latest; {from,to} → window), so
  // stripping unknown keys is not a harmless normalization: it rewrites an
  // expressed historical request into a latest-mode request. These four were
  // measured on the pre-fix boundary arriving at the handler as {summary:true}
  // (or with the unknown key silently dropped) and RUNNING.
  it('{FROM,TO} is REFUSED before the handler, not silently read as latest', async () => {
    assert.ok(rejected(await call({ FROM: T, TO: T2 })),
      'uppercase temporal keys must be a validation refusal, not latest mode');
  });

  it('{From,To} is REFUSED before the handler', async () => {
    assert.ok(rejected(await call({ From: T, To: T2 })));
  });

  it('{banana:123} is REFUSED — unknown keys are caller errors on this tool', async () => {
    assert.ok(rejected(await call({ banana: 123 })));
  });

  it('{from,to,banana} is REFUSED — a legal window plus an unknown key is still a caller error', async () => {
    assert.ok(rejected(await call({ from: T, to: T2, banana: 123 })),
    'strictness must not only catch the all-keys-misspelled shape');
  });
});

describe('MCP boundary — chart_set_visible_range: malformed primitives must not become timestamps (IH2, live twin)', () => {
  // Measured on the pre-fix boundary: z.coerce.number() laundered null/''/true
  // into 0/0/1, which then drove the history-paging loop toward the invented
  // bound on a live chart. A schema refusal is the FAST pre-handler path, so
  // these also prove malformed input can never reach paging.
  it('from:null is REFUSED, not read as epoch 0', async () => {
    assert.ok(rejected(await callRange({ from: null, to: T })));
  });

  it('from:"" is REFUSED, not read as epoch 0', async () => {
    assert.ok(rejected(await callRange({ from: '', to: T })));
  });

  it('from:true is REFUSED, not read as 1', async () => {
    assert.ok(rejected(await callRange({ from: true, to: T })));
  });

  it('from:false is REFUSED, not read as epoch 0', async () => {
    assert.ok(rejected(await callRange({ from: false, to: T })));
  });

  it('a fractional second is REFUSED — the representation is an integer', async () => {
    assert.ok(rejected(await callRange({ from: 1.5, to: T })));
  });

  it('a non-numeric string stays REFUSED (control — already failed pre-fix)', async () => {
    assert.ok(rejected(await callRange({ from: 'yesterday', to: T })));
  });

  it('every legal representation still passes at the schema: integers, integer strings, epoch 0', () => {
    for (const args of [{ from: T, to: T2 }, { from: String(T), to: String(T2) }, { from: 0, to: T }]) {
      const r = parseRangeArgs(args);
      assert.equal(r.success, true, r.error && JSON.stringify(r.error.issues));
    }
    assert.equal(parseRangeArgs({ from: 0, to: T }).data.from, 0, 'epoch 0 stays a real timestamp');
    assert.equal(parseRangeArgs({ from: String(T), to: String(T2) }).data.from, T, 'integer strings still convert');
  });

  it('both bounds stay REQUIRED — the unknown-key shape keeps failing closed', async () => {
    assert.ok(rejected(await callRange({ FROM: T, TO: T2 })),
      'stripped/missing required fields must remain a refusal');
  });
});

describe('MCP boundary — a malformed window representation is refused, never coerced', () => {
  it('from:null with a real to is REFUSED, not read as epoch 0', async () => {
    // The exact counterexample: null must not become a timestamp. Before the fix
    // this was accepted and forwarded as {from: 0, to: T}.
    const res = await call({ from: null, to: T });
    assert.ok(rejected(res), `expected a validation refusal, got: ${JSON.stringify(res).slice(0, 300)}`);
  });

  it('to:null with a real from is REFUSED', async () => {
    // This direction already failed closed, but via core's `to <= from` check
    // with a message about ordering rather than about the null. Pin the refusal
    // at the boundary so the reason matches the cause.
    const res = await call({ from: T, to: null });
    assert.ok(rejected(res), `expected a validation refusal, got: ${JSON.stringify(res).slice(0, 300)}`);
  });

  it('from:null AND to:null is REFUSED — it must never collapse to the window [0,0]', async () => {
    const res = await call({ from: null, to: null });
    assert.ok(rejected(res), `expected a validation refusal, got: ${JSON.stringify(res).slice(0, 300)}`);
  });

  it('an empty string is REFUSED — Number("") is 0 and that is exactly the bug', async () => {
    const res = await call({ from: '', to: T });
    assert.ok(rejected(res), `expected a validation refusal, got: ${JSON.stringify(res).slice(0, 300)}`);
  });

  it('a boolean is REFUSED — Number(true) is 1, a timestamp one second after epoch', async () => {
    const res = await call({ from: true, to: T });
    assert.ok(rejected(res), `expected a validation refusal, got: ${JSON.stringify(res).slice(0, 300)}`);
  });

  it('a non-integer and a non-numeric string are REFUSED', async () => {
    assert.ok(rejected(await call({ from: 1.5, to: T })), 'a fractional second is not a bar timestamp');
    assert.ok(rejected(await call({ from: 'yesterday', to: T })), 'prose is not a timestamp');
  });
});

describe('MCP boundary — every legal representation still passes (no overcorrection)', () => {
  it('epoch 0 stays a legal, distinguishable timestamp', () => {
    // C3's pin, restated at the boundary: the fix must not make 0 unreachable
    // while removing the paths that INVENT it.
    const r = parseArgs({ from: 0, to: T });
    assert.equal(r.success, true, r.error && JSON.stringify(r.error.issues));
    assert.equal(r.data.from, 0);
    assert.equal(r.data.to, T);
  });

  it('omitting both bounds is still the latest mode — not a breaking API change', () => {
    const r = parseArgs({ count: 5 });
    assert.equal(r.success, true, r.error && JSON.stringify(r.error.issues));
    assert.equal(r.data.from, undefined);
    assert.equal(r.data.to, undefined);
    assert.equal(r.data.count, 5);
  });

  it('numeric strings are still accepted — MCP clients routinely send them', () => {
    const r = parseArgs({ from: '1700000000', to: '1700000600' });
    assert.equal(r.success, true, r.error && JSON.stringify(r.error.issues));
    assert.equal(r.data.from, 1_700_000_000, 'and are converted to numbers for core');
    assert.equal(r.data.to, 1_700_000_600);
  });

  it('a negative timestamp is still representable — the fix is about form, not range', () => {
    const r = parseArgs({ from: -86_400, to: 0 });
    assert.equal(r.success, true, r.error && JSON.stringify(r.error.issues));
    assert.equal(r.data.from, -86_400);
  });

  it('count keeps its own validation', () => {
    assert.equal(parseArgs({ count: 5 }).success, true);
    assert.equal(parseArgs({ count: 0 }).success, false, 'min(1) still applies');
    assert.equal(parseArgs({ count: 501 }).success, false, 'max(500) still applies');
  });
});

describe('MCP boundary — the served surface is unchanged', () => {
  it('data_get_ohlcv still advertises count/from/to/summary with nothing required', async () => {
    // The schema type changed; the ADVERTISED contract must not. This is the cheap
    // guard on JSON-Schema generation, which a raw zod parse test cannot see.
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'data_get_ohlcv');
    assert.ok(tool, 'data_get_ohlcv must still be served');
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['count', 'from', 'summary', 'to']);
    assert.deepEqual(tool.inputSchema.required ?? [], [], 'both modes stay reachable: nothing is required');
    // The advertised TYPE is the half a client reads before it ever calls. If the
    // schema type were ever emitted as untyped, a client could infer null is fine.
    assert.equal(tool.inputSchema.properties.from.type, 'integer');
    assert.equal(tool.inputSchema.properties.to.type, 'integer');
    // IH1: the unknown-key policy is part of the served contract now.
    assert.equal(tool.inputSchema.additionalProperties, false,
      'data_get_ohlcv must advertise additionalProperties:false');
  });

  it('a legal call still reaches the handler through the REAL dispatch path', async (t) => {
    // Deliberately end-to-end, and deliberately the only slow test here: it is the
    // one assertion that covers the SDK's own normalize+parse of the new schema
    // type, which a direct z.object(shape).safeParse cannot exercise. The handler
    // then fails on the absent CDP connection — that failure is the PROOF it got
    // past validation, since a rejected call never reaches the handler at all.
    // Cost: the connection retry budget in src/connection.js (5 attempts,
    // exponential from 500ms). Do not add more cases to this shape.
    t.diagnostic('reaches the real handler; pays the CDP retry budget (~7s)');
    const res = await call({ from: 0, to: T, summary: false });
    assert.equal(rejected(res), false, 'a legal window must not be refused by validation');
    assert.match(res.content[0].text, /Could not extract OHLCV|CDP|chart may still be loading/i,
      'expected the handler-side failure that proves validation passed');
  });
});
