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

/**
 * The schema object the server actually registers — captured from the real
 * registration call, never re-declared here. A copy would drift and pass while
 * production broke.
 */
function registeredShape(toolName = 'data_get_ohlcv') {
  let shape;
  registerDataTools({ tool: (name, _desc, paramsSchema) => { if (name === toolName) shape = paramsSchema; } });
  assert.ok(shape, `${toolName} was not registered`);
  return shape;
}

/** Parse exactly as the SDK does: it normalizes the raw shape to an object schema. */
const parseArgs = (args) => z.object(registeredShape()).safeParse(args);

let client, server;
before(async () => {
  server = new McpServer({ name: 'boundary-test', version: '0.0.0' });
  registerDataTools(server);
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

const T = 1_700_000_000;

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
