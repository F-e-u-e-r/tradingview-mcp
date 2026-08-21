/**
 * Direct-core temporal honesty (issue #3, IH2 — defense-in-depth half).
 *
 * The served boundary already refuses malformed representations
 * (tests/mcp_boundary.test.js); this suite pins that core.getOhlcv() itself
 * cannot be talked into inventing a timestamp by a FUTURE internal caller
 * that bypasses the tool schema. Division of responsibility stays: the
 * boundary rejects malformed REPRESENTATION, core enforces the TEMPORAL
 * contract — but core's own mode selection must key on PRESENCE
 * (undefined = omitted), never on what Number() happens to return.
 *
 *   both omitted            → latest
 *   exactly one supplied    → half-open caller error
 *   both supplied           → canonical representation parse → window
 *   null/bool/''/junk/float → representation error, never an epoch
 *
 * Epoch 0 stays a real timestamp. connection.js's requireFinite is
 * deliberately NOT part of this contract: it answers finiteness of a number
 * it is handed, not whether a representation was temporal.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOhlcv } from '../src/core/data.js';

const T = 1_700_000_000, T2 = 1_700_000_600;

// Synthetic bars through the real in-page expression: 100 bars inside [T, T2],
// then 100 newest bars ~28h later — so a latest-mode result is visibly from a
// different period than the window.
const times = [];
for (let i = 0; i < 100; i++) times.push(T + i * 6);
for (let i = 0; i < 100; i++) times.push(T2 + 100_000 + i * 60);
const barsStub = {
  firstIndex: () => 0, lastIndex: () => times.length - 1, size: () => times.length,
  valueAt: (i) => [times[i], 10, 11, 9, 10.5, 1000],
};
const windowStub = {
  TradingViewApi: { _activeChartWidgetWV: { value: () => ({ _chartWidget: { model: () => ({ mainSeries: () => ({ bars: () => barsStub }) }) } }) } },
};
const fakeEvaluate = async (expr) => new Function('window', `return (${expr});`)(windowStub);
const run = (args) => getOhlcv({ ...args, _deps: { evaluate: fakeEvaluate } });

const REPRESENTATION = /integer unix-seconds/;
const HALF_OPEN = /both from and to/;

describe('core temporal honesty — supplied malformed values are representation errors, never epochs', () => {
  it("from:'' must not become epoch 0", async () => {
    await assert.rejects(run({ from: '', to: T }), REPRESENTATION);
  });

  it('from:true must not become 1', async () => {
    await assert.rejects(run({ from: true, to: T }), REPRESENTATION);
  });

  it('from:false must not become epoch 0 — false passes a != null presence test', async () => {
    await assert.rejects(run({ from: false, to: T }), REPRESENTATION);
  });

  it('{from:null, to:null} is a representation error — explicit null is SUPPLIED, not omitted', async () => {
    await assert.rejects(run({ from: null, to: null }), REPRESENTATION);
  });

  it('from:null with a real to is refused as representation, not mislabeled half-open', async () => {
    await assert.rejects(run({ from: null, to: T }), REPRESENTATION);
  });

  it("to-side malformed values are refused for the RIGHT reason — representation, not ordering", async () => {
    await assert.rejects(run({ from: T, to: '' }), REPRESENTATION,
      "to:'' previously failed as 'to (0) must be greater than from', blaming order for a coercion");
    await assert.rejects(run({ from: T, to: true }), REPRESENTATION);
  });

  it('junk strings and fractional seconds are representation errors', async () => {
    await assert.rejects(run({ from: 'banana', to: T }), REPRESENTATION);
    await assert.rejects(run({ from: 1.5, to: T }), REPRESENTATION);
  });

  // Cross-model review round on d06efd1: a digit string long enough to
  // overflow Number() passed the regex and became Infinity — the baseline's
  // finite check refused the same call. Core now mirrors the served
  // boundary's measured zod-v4 semantics (finite SAFE integers), which also
  // stops >2^53 strings from being silently altered to a different timestamp
  // and huge float-integers like 1e300 from posing as temporal values.
  it("a digit string that overflows Number() must not become Infinity", async () => {
    await assert.rejects(run({ from: '0', to: '9'.repeat(400) }), REPRESENTATION);
  });

  it('a digit string beyond 2^53 must be refused, not silently altered', async () => {
    await assert.rejects(run({ from: 0, to: '9007199254740993' }), REPRESENTATION);
  });

  it('a huge integral float like 1e300 is not a timestamp representation', async () => {
    await assert.rejects(run({ from: 0, to: 1e300 }), REPRESENTATION);
  });

  it('the largest safe integer itself stays legal', async () => {
    const r = await run({ from: 0, to: Number.MAX_SAFE_INTEGER });
    assert.equal(r.mode, 'window');
    assert.equal(r.requested_window.to, Number.MAX_SAFE_INTEGER);
  });
});

describe('core temporal honesty — presence semantics and legal forms are preserved', () => {
  it('both omitted stays the latest mode', async () => {
    const r = await run({});
    assert.equal(r.success, true);
    assert.equal(r.mode, 'latest');
  });

  it('exactly one supplied stays the half-open caller error', async () => {
    await assert.rejects(run({ from: T }), HALF_OPEN);
    await assert.rejects(run({ to: T }), HALF_OPEN);
  });

  it('integers still select the window', async () => {
    const r = await run({ from: T, to: T2 });
    assert.equal(r.mode, 'window');
    assert.deepEqual(r.requested_window, { from: T, to: T2 });
    assert.ok(r.period.from >= T && r.period.to <= T2, 'bars come from the window');
  });

  it('integer strings stay accepted — the currently legal representation is not narrowed', async () => {
    const r = await run({ from: String(T), to: String(T2) });
    assert.equal(r.mode, 'window');
    assert.deepEqual(r.requested_window, { from: T, to: T2 });
  });

  it('epoch 0 stays a real, usable timestamp', async () => {
    const r = await run({ from: 0, to: T });
    assert.equal(r.mode, 'window');
    assert.equal(r.requested_window.from, 0);
  });

  it('ordering is still enforced after representation passes', async () => {
    await assert.rejects(run({ from: T2, to: T }), /must be greater/);
  });
});
