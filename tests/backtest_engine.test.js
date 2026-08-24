// BT4 — the generalized strategy-consulted execution engine, tested against
// the RATIFIED BT4 contract (docs/BT4-CONTRACT.md, ratified @ 8351804, merged
// e3f674b; Amendment A @ dcc79a8, merged e4dc65b). Oracle discipline:
//
//   1. D5 GOLDEN REGRESSION (contract §5): the generalized engine driven by
//      the Donchian adapter reproduces the CLOSED BT1 behaviour on the whole
//      ratified corpus — BT0's F1–F12 plus the four supplementary sequences —
//      compared as WHOLE RESULT OBJECTS, which covers the owner's six
//      dimensions (executions, closed trades, pending terminal signal, open
//      terminal position, signal/fill timing, fill prices) in one assertion.
//      Per the owner's constraint no second comparator abstraction is built.
//      The facade is then proven to be a pure pass-through of that same
//      result, so a facade bug cannot mask an engine bug or vice versa.
//   2. D4 NO-LOOKAHEAD, in the two mandatory executable forms: the NORMATIVE
//      prefix-determinism criterion ("the signal produced for i must be
//      invariant under arbitrary changes to bars strictly after i") and the
//      SF7 adversarial spy probe over every surface the view offers. Both are
//      shown RED-able: a deliberately future-reading strategy breaks them.
//   3. D1a STRICTNESS: an inapplicable signal is a behavioural no-op — no
//      pending order, no execution, no counter increment, no accounting
//      effect, no synthetic rejection record.
//   4. D7 / §7.3 IDENTITY INDEPENDENCE: for an identical signal sequence the
//      result is independent of which strategy implementation produced it.
//   5. STATIC INVARIANTS: the engine is a zero-import pure module with no
//      capability and no nondeterminism (contract §5.1.1 B, per-module scan).
//
// Contract reminders (ratified, none reviewable here): the engine owns
// signal → pending → next-bar-raw-open fill → position transition; strategies
// see bars 0..i and flat|long and nothing else; the vocabulary is exactly
// ENTER_LONG | EXIT_LONG | NONE; warm-up is the strategy's business and is
// expressed as the outcome NONE, never as a skipped consultation.
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStrategyBacktest } from '../src/analytics/engine.js';
import { donchianStrategy } from '../src/analytics/strategies/donchian.js';
import { donchianBreakoutBacktest } from '../src/analytics/backtest.js';
import { accountBacktest } from '../src/analytics/accounting.js';

const here = dirname(fileURLToPath(import.meta.url));

const B = ([open, high, low, close]) => ({ open, high, low, close });
const bars = (rows) => rows.map(B);
const flat10 = [10, 10, 10, 10];
const flatN = (v, n) => Array.from({ length: n }, () => [v, v, v, v]);

const E = (kind, signalIndex, fillIndex, fillPrice) => ({ kind, signalIndex, fillIndex, fillPrice });
const T = (entrySignalIndex, entryFillIndex, entryPrice, exitSignalIndex, exitFillIndex, exitPrice) =>
  ({ entrySignalIndex, entryFillIndex, entryPrice, exitSignalIndex, exitFillIndex, exitPrice });
const result = (executions, closedTrades, openPosition, pendingSignal) => ({
  executions,
  closedTrades,
  openPosition,
  pendingSignal,
  totalExecutions: executions.length,
  totalClosedTrades: closedTrades.length,
});
const OPEN = (entrySignalIndex, entryFillIndex, entryPrice) => ({ entrySignalIndex, entryFillIndex, entryPrice });
const PEND = (kind, signalIndex) => ({ kind, signalIndex, unfillable: true });
const EMPTY = result([], [], null, null);

// A test-side recorder: the engine's result shape is fixed by BT0 §4.5 and
// must NOT grow a signals field, so signal streams are observed here instead.
const recording = (inner) => {
  const seen = [];
  return { seen, evaluate: (view) => { const s = inner.evaluate(view); seen.push(s); return s; } };
};
const signalsOf = (rows, strategy) => {
  const rec = recording(strategy);
  runStrategyBacktest(bars(rows), rec);
  return rec.seen;
};
const scripted = (stream) => ({ evaluate: ({ index }) => stream[index] });

// ── the ratified D5 corpus ──────────────────────────────────────────────────
// BT0 §7's twelve contract fixtures plus the four supplementary sequences,
// transcribed with their RATIFIED expected results. The derivations live in
// docs/BT0-CONTRACT.md and tests/backtest_kernel.test.js; nothing is
// recomputed here. This is the migration oracle: whatever the CLOSED kernel
// produced, the generalized engine must produce.
const UP = 0.5 + Number.EPSILON / 2;
const DOWN = 0.5 - Number.EPSILON / 4;

const D5_CORPUS = [
  {
    name: 'F1 complete round trip',
    period: 3,
    rows: [flat10, flat10, flat10, [10, 12, 10, 11], [10, 12, 10, 10], [10, 11, 10, 10], [8, 8, 7, 7], [8, 9, 8, 9]],
    expected: result([E('entry', 3, 4, 10), E('exit', 6, 7, 8)], [T(3, 4, 10, 6, 7, 8)], null, null),
  },
  {
    name: 'F2 boundary equality is not a breakout',
    period: 3,
    rows: [[10, 10, 8, 9], [10, 12, 9, 10], [10, 11, 9, 10], [11, 12, 10, 11], [11, 12, 10, 11]],
    expected: EMPTY,
  },
  {
    name: 'F3 warm-up bars cannot signal',
    period: 3,
    rows: [flat10, [10, 20, 10, 15], [15, 25, 15, 20], [20, 21, 19, 20]],
    expected: EMPTY,
  },
  {
    name: 'F4 terminal entry signal never fills',
    period: 3,
    rows: [flat10, flat10, flat10, [10, 15, 10, 14]],
    expected: result([], [], null, PEND('entry', 3)),
  },
  {
    name: 'F5 entry fills, never exits — open at end',
    period: 3,
    rows: [flat10, flat10, flat10, [10, 15, 10, 14], [13, 16, 13, 15], [15, 16, 14, 15]],
    expected: result([E('entry', 3, 4, 13)], [], OPEN(3, 4, 13), null),
  },
  {
    name: 'F6 donor seven-bar fixture under the V1 model',
    period: 3,
    rows: [flat10, flat10, flat10, flat10, [20, 20, 15, 18], [20, 20, 18, 18], [20, 20, 5, 8]],
    expected: result([E('entry', 4, 5, 20)], [], OPEN(4, 5, 20), PEND('exit', 6)),
  },
  {
    name: 'F7 breakouts while positioned are ignored',
    period: 3,
    rows: [flat10, flat10, flat10, [10, 12, 10, 12], [13, 15, 11, 14], [14, 18, 13, 17], [17, 17, 9, 10], [11, 11, 9, 11]],
    expected: result([E('entry', 3, 4, 13), E('exit', 6, 7, 11)], [T(3, 4, 13, 6, 7, 11)], null, null),
  },
  {
    name: 'F8 flat series never signals',
    period: 3,
    rows: flatN(10, 10),
    expected: EMPTY,
  },
  { name: 'F9a empty input', period: 3, rows: [], expected: EMPTY },
  {
    name: 'F9b insufficient bars (N = p)',
    period: 3,
    rows: [flat10, [10, 50, 5, 30], [30, 60, 20, 40]],
    expected: EMPTY,
  },
  {
    name: 'F10 quick reversal — entry fill and exit signal on the same bar',
    period: 3,
    rows: [flat10, flat10, flat10, [10, 14, 10, 13], [12, 14, 8, 9], [8, 9, 8, 9]],
    expected: result([E('entry', 3, 4, 12), E('exit', 4, 5, 8)], [T(3, 4, 12, 4, 5, 8)], null, null),
  },
  {
    name: 'F11 both bands breached while flat — entry only',
    period: 3,
    rows: [[10, 12, 8, 10], [10, 12, 8, 10], [10, 12, 8, 10], [13, 13, 7, 9], [8, 10, 8, 9]],
    expected: result([E('entry', 3, 4, 8)], [], OPEN(3, 4, 8), null),
  },
  {
    name: 'F12 final bar fills an exit, then evaluates and signals',
    period: 3,
    rows: [flat10, flat10, flat10, [10, 12, 10, 11], [12, 12, 7, 8], [9, 20, 8, 19]],
    expected: result([E('entry', 3, 4, 12), E('exit', 4, 5, 9)], [T(3, 4, 12, 4, 5, 9)], null, PEND('entry', 5)),
  },
  {
    name: 'S1 two closed round trips in ascending exit-fill order (p=2)',
    period: 2,
    rows: [flat10, flat10, [10, 12, 10, 11], [13, 13, 9, 10], [9, 10, 8, 9],
      [9, 15, 9, 14], [15, 16, 14, 15], [15, 15, 7, 8], [7, 9, 7, 8]],
    expected: result(
      [E('entry', 2, 3, 13), E('exit', 3, 4, 9), E('entry', 5, 6, 15), E('exit', 7, 8, 7)],
      [T(2, 3, 13, 3, 4, 9), T(5, 6, 15, 7, 8, 7)],
      null,
      null,
    ),
  },
  {
    name: 'S2 closed history + re-entered open position + terminal exit signal (p=1)',
    period: 1,
    rows: [flat10, [10, 12, 10, 11], [10, 11, 9, 9], [8, 13, 8, 11], [12, 12, 7, 9]],
    expected: result(
      [E('entry', 1, 2, 10), E('exit', 2, 3, 8), E('entry', 3, 4, 12)],
      [T(1, 2, 10, 2, 3, 8)],
      OPEN(3, 4, 12),
      PEND('exit', 4),
    ),
  },
  {
    name: 'S3 twenty-bar warm-up (p=20, the facade default)',
    period: 20,
    rows: [...flatN(10, 20), [10, 15, 10, 14], [12, 12, 11, 12]],
    expected: result([E('entry', 20, 21, 12)], [], OPEN(20, 21, 12), null),
  },
  {
    name: 'S3b nineteen flat bars then a breakout at index 19 (p=20) — still warm-up',
    period: 20,
    rows: [...flatN(10, 19), [10, 15, 10, 14]],
    expected: EMPTY,
  },
  {
    name: 'S4 adjacent-double bands and raw fractional opens (p=1)',
    period: 1,
    rows: [[0.5, 0.5, 0.5, 0.5], [0.5, UP, 0.5, 0.5], [1.23456789, 1.3, DOWN, 0.6], [0.987654321, 1.1, 0.6, 0.7]],
    expected: result(
      [E('entry', 1, 2, 1.23456789), E('exit', 2, 3, 0.987654321)],
      [T(1, 2, 1.23456789, 2, 3, 0.987654321)],
      null,
      null,
    ),
  },
];

// ── 1. D5 golden regression (contract §5) ───────────────────────────────────

describe('D5 golden regression — generalized engine + Donchian adapter == CLOSED BT1', () => {
  for (const f of D5_CORPUS) {
    it(`${f.name} — engine result equals the ratified CLOSED result`, () => {
      assert.deepStrictEqual(runStrategyBacktest(bars(f.rows), donchianStrategy(f.period)), f.expected);
    });
  }

  it('the whole-result comparison covers the owner\'s six dimensions on a trace that exercises all of them', () => {
    // S2 carries, simultaneously: executions (3), a closed trade, an open
    // terminal position, a terminal pending signal, signal-vs-fill timing
    // (every fill is one bar after its signal), and fill prices that differ
    // from their signal bar's close (10≠11, 8≠9, 12≠11).
    const r = runStrategyBacktest(bars(D5_CORPUS[14].rows), donchianStrategy(1));
    assert.equal(r.totalExecutions, 3);
    assert.equal(r.totalClosedTrades, 1);
    assert.notEqual(r.openPosition, null);
    assert.notEqual(r.pendingSignal, null);
    for (const e of r.executions) assert.equal(e.fillIndex, e.signalIndex + 1, 'fill is the next bar');
    assert.deepStrictEqual(r.executions.map((e) => e.fillPrice), [10, 8, 12], 'raw next-bar opens');
  });
});

describe('the compatibility facade is a pure pass-through (D8a)', () => {
  for (const f of D5_CORPUS) {
    it(`${f.name} — donchianBreakoutBacktest equals the engine result`, () => {
      assert.deepStrictEqual(
        donchianBreakoutBacktest(bars(f.rows), f.period),
        runStrategyBacktest(bars(f.rows), donchianStrategy(f.period)),
      );
    });
  }
});

// ── 2. D4 no-lookahead — the normative criterion and the SF7 spy ────────────

describe('D4 no-lookahead (contract §4)', () => {
  // The corpus traces that actually produce signals; flat/empty ones cannot
  // discriminate a lookahead defect.
  const SIGNALLING = D5_CORPUS.filter((f) => f.expected.totalExecutions > 0 || f.expected.pendingSignal !== null);

  it('NORMATIVE: the signal at bar i is invariant under arbitrary changes to bars strictly after i', () => {
    // The owner's ratified acceptance criterion, in its direct executable
    // form: rewrite the tail with hostile values and require every signal at
    // or before i to be unchanged.
    const HOSTILE = [999, 1000, -999, -1000];
    let compared = 0;
    for (const f of SIGNALLING) {
      const baseline = signalsOf(f.rows, donchianStrategy(f.period));
      for (let i = 0; i < f.rows.length; i++) {
        const mutated = f.rows.map((row, j) => (j > i ? HOSTILE : row));
        const got = signalsOf(mutated, donchianStrategy(f.period));
        assert.deepStrictEqual(got.slice(0, i + 1), baseline.slice(0, i + 1),
          `${f.name}: signals 0..${i} must not move when bars after ${i} are rewritten`);
        compared += 1;
      }
    }
    assert.ok(compared >= 50, `the criterion was exercised broadly (${compared} tail rewrites)`);
  });

  it('prefix determinism: running over bars[0..k) reproduces the first k signals of the full run', () => {
    let compared = 0;
    for (const f of SIGNALLING) {
      const full = signalsOf(f.rows, donchianStrategy(f.period));
      for (let k = 1; k <= f.rows.length; k++) {
        assert.deepStrictEqual(signalsOf(f.rows.slice(0, k), donchianStrategy(f.period)), full.slice(0, k),
          `${f.name}: prefix determinism at k=${k}`);
        compared += 1;
      }
    }
    assert.ok(compared >= 50, `prefix determinism exercised broadly (${compared} truncations)`);
  });

  it('RED-able: a future-reading strategy breaks the normative criterion', () => {
    // The criterion is worthless unless a lookahead defect actually trips it.
    // This strategy smuggles the full series in through its closure — exactly
    // what the bounded view denies — and reads bar i+1.
    const rows = D5_CORPUS[0].rows; // F1
    const lookahead = (all) => ({
      evaluate: ({ index, position }) => {
        const next = all[index + 1];
        if (next === undefined) return 'NONE';
        if (position === 'flat') return next[1] > 11 ? 'ENTER_LONG' : 'NONE';
        return 'NONE';
      },
    });
    const baseline = signalsOf(rows, lookahead(rows));
    const mutated = rows.map((row, j) => (j > 0 ? [999, 1000, -999, -1000] : row));
    const got = signalsOf(mutated, lookahead(mutated));
    assert.notDeepStrictEqual(got.slice(0, 1), baseline.slice(0, 1),
      'a strategy that reads bar i+1 must break the criterion — otherwise the criterion proves nothing');
  });

  it('SF7 spy probe: every surface of the view is bounded at the current bar', () => {
    const rows = D5_CORPUS[0].rows; // F1, 8 bars
    const observed = [];
    const spy = {
      evaluate: (view) => {
        const { index, position, opens, highs, lows, closes } = view;
        observed.push({
          index,
          position,
          keys: Object.keys(view).sort(),
          lengths: [opens.length, highs.length, lows.length, closes.length],
          // every attempt to read past the window, through every surface
          pastEnd: [opens[index + 1], highs[index + 1], lows[index + 1], closes[index + 1]],
          negative: closes[-1],
          sliceBeyond: closes.slice(index + 1),
          atBeyond: typeof closes.at === 'function' ? closes.at(index + 1) : undefined,
          spread: [...closes].length,
          frozen: [Object.isFrozen(view), Object.isFrozen(opens), Object.isFrozen(highs),
            Object.isFrozen(lows), Object.isFrozen(closes)],
        });
        return 'NONE';
      },
    };
    const r = runStrategyBacktest(bars(rows), spy);
    assert.deepStrictEqual(r, EMPTY, 'an all-NONE strategy trades nothing');
    assert.equal(observed.length, rows.length, 'the engine consults on EVERY bar (D1b)');
    for (const o of observed) {
      assert.deepStrictEqual(o.keys, ['closes', 'highs', 'index', 'lows', 'opens', 'position'],
        'the view exposes exactly the ratified surfaces — no bars array, no engine internals');
      assert.deepStrictEqual(o.lengths, [o.index + 1, o.index + 1, o.index + 1, o.index + 1],
        'every column is bounded at the current bar');
      assert.deepStrictEqual(o.pastEnd, [undefined, undefined, undefined, undefined], 'bar i+1 is unreachable');
      assert.equal(o.negative, undefined, 'no negative-index surface');
      assert.deepStrictEqual(o.sliceBeyond, [], 'slice past the window yields nothing');
      assert.equal(o.atBeyond, undefined, '.at past the window yields nothing');
      assert.equal(o.spread, o.index + 1, 'spreading the column cannot widen it');
      assert.deepStrictEqual(o.frozen, [true, true, true, true, true], 'the view and its columns are frozen');
      assert.ok(o.position === 'flat' || o.position === 'long', 'position is exactly flat|long (D3)');
    }
  });

  it('SF7: the view carries no cash, P&L, equity, cost, or trade-count surface (D3)', () => {
    const seen = new Set();
    runStrategyBacktest(bars(D5_CORPUS[0].rows), {
      evaluate: (view) => { for (const k of Object.keys(view)) seen.add(k); return 'NONE'; },
    });
    for (const forbidden of ['cash', 'equity', 'pnl', 'realizedPnl', 'unrealizedPnl', 'costs',
      'commission', 'slippage', 'entryPrice', 'trades', 'closedTrades', 'executions',
      'totalExecutions', 'profitability', 'bars', 'result']) {
      assert.ok(!seen.has(forbidden), `the view must not expose ${forbidden}`);
    }
  });

  it('a strategy cannot mutate the view to influence later bars', () => {
    const vandal = {
      evaluate: ({ index, closes }) => {
        try { closes[index] = 1e9; } catch { /* frozen — the expected path */ }
        return 'NONE';
      },
    };
    assert.deepStrictEqual(runStrategyBacktest(bars(D5_CORPUS[0].rows), vandal), EMPTY);
  });

  it('the engine does not mutate its input bars', () => {
    const f = D5_CORPUS[0];
    const frozen = Object.freeze(bars(f.rows).map((b) => Object.freeze(b)));
    assert.deepStrictEqual(runStrategyBacktest(frozen, donchianStrategy(f.period)), f.expected);
  });
});

// ── 3. D1a — an inapplicable signal is a strict behavioural no-op ───────────

describe('D1a strictness (contract §3.1)', () => {
  // F1 with inapplicable signals injected at every state where one is
  // possible: EXIT_LONG while flat (bars 0,1,2 and the tail after the exit
  // fills) and ENTER_LONG while long (bars 4,5,6 before the exit fills).
  const rows = D5_CORPUS[0].rows;
  const baseline = ['NONE', 'NONE', 'NONE', 'ENTER_LONG', 'NONE', 'NONE', 'EXIT_LONG', 'NONE'];
  const injected = ['EXIT_LONG', 'EXIT_LONG', 'EXIT_LONG', 'ENTER_LONG', 'ENTER_LONG', 'ENTER_LONG', 'EXIT_LONG', 'EXIT_LONG'];

  it('the baseline stream really trades (the comparison is not vacuous)', () => {
    assert.deepStrictEqual(runStrategyBacktest(bars(rows), scripted(baseline)), D5_CORPUS[0].expected);
  });

  it('replacing an inapplicable signal with NONE leaves the execution result bit-identical', () => {
    assert.deepStrictEqual(
      runStrategyBacktest(bars(rows), scripted(injected)),
      runStrategyBacktest(bars(rows), scripted(baseline)),
    );
  });

  it('…and leaves the CLOSED BT2 accounting bit-identical (no accounting effect)', () => {
    const b = bars(rows);
    const opts = { initialCash: 1000, commissionRate: 0, slippageRate: 0 };
    assert.deepStrictEqual(
      accountBacktest(b, runStrategyBacktest(b, scripted(injected)), opts),
      accountBacktest(b, runStrategyBacktest(b, scripted(baseline)), opts),
    );
  });

  it('no synthetic rejection record and no extra counter appear in the result shape', () => {
    const r = runStrategyBacktest(bars(rows), scripted(injected));
    assert.deepStrictEqual(Object.keys(r).sort(), [
      'closedTrades', 'executions', 'openPosition', 'pendingSignal', 'totalClosedTrades', 'totalExecutions',
    ], 'the §4.5 result shape gains nothing when inapplicable signals arrive');
    assert.equal(r.totalExecutions, 2);
    assert.equal(r.totalClosedTrades, 1);
  });

  it('an inapplicable terminal signal leaves no pending order', () => {
    // EXIT_LONG on the final bar while flat: nothing may be queued.
    const stream = ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'EXIT_LONG'];
    assert.deepStrictEqual(runStrategyBacktest(bars(rows), scripted(stream)), EMPTY);
  });

  it('an out-of-vocabulary signal is a protocol violation, not a no-op (D2 closed vocabulary)', () => {
    // D1a's no-op covers INAPPLICABLE signals. An unknown token is a different
    // thing: the vocabulary is closed, so it fails loud rather than being
    // silently swallowed.
    for (const bad of ['BUY', 'SELL', 'ENTER_SHORT', '', null, undefined, 0, 'none']) {
      assert.throws(
        () => runStrategyBacktest(bars(rows), { evaluate: () => bad }),
        /runStrategyBacktest: strategy returned an unknown signal/,
        `unknown signal must fail loud: ${String(bad)}`,
      );
    }
  });
});

// ── 4. D7 / §7.3 — strategy identity is unobservable downstream ─────────────

describe('identity independence (contract §7.1 acceptance criterion, §7.3 invariant)', () => {
  it('an identical signal sequence produces an identical result, whatever produced it', () => {
    for (const f of D5_CORPUS) {
      const stream = signalsOf(f.rows, donchianStrategy(f.period));
      assert.deepStrictEqual(
        runStrategyBacktest(bars(f.rows), scripted(stream)),
        runStrategyBacktest(bars(f.rows), donchianStrategy(f.period)),
        `${f.name}: a scripted replay is indistinguishable from the adapter`,
      );
    }
  });

  it('…and downstream BT2 accounting is likewise identity-blind', () => {
    const f = D5_CORPUS[0];
    const b = bars(f.rows);
    const opts = { initialCash: 1000, commissionRate: 0.001, slippageRate: 0.002 };
    const stream = signalsOf(f.rows, donchianStrategy(f.period));
    assert.deepStrictEqual(
      accountBacktest(b, runStrategyBacktest(b, scripted(stream)), opts),
      accountBacktest(b, runStrategyBacktest(b, donchianStrategy(f.period)), opts),
    );
  });

  it('naming a strategy, or hanging extra properties on it, changes nothing', () => {
    const f = D5_CORPUS[6]; // F7
    const plain = donchianStrategy(f.period);
    const dressed = { name: 'donchian', kind: 'breakout', period: f.period, evaluate: plain.evaluate };
    assert.deepStrictEqual(
      runStrategyBacktest(bars(f.rows), dressed),
      runStrategyBacktest(bars(f.rows), plain),
      'the engine must not branch on strategy identity',
    );
  });
});

// ── 5. engine input validation (house fail-loud doctrine) ───────────────────

describe('engine input validation', () => {
  it('rejects non-array bars', () => {
    for (const bad of [null, undefined, 'bars', 42, { length: 3 }]) {
      assert.throws(() => runStrategyBacktest(bad, donchianStrategy(3)),
        /runStrategyBacktest: bars must be an array/);
    }
  });
  it('rejects a strategy without an evaluate function', () => {
    for (const bad of [null, undefined, {}, { evaluate: 42 }, 'donchian']) {
      assert.throws(() => runStrategyBacktest(bars([flat10]), bad),
        /runStrategyBacktest: strategy must expose an evaluate/);
    }
  });
});

// ── 6. static invariants — the engine is a zero-import pure module ──────────
// Contract §5.1.1 B (Amendment A): the per-module capability scan replaces
// BT1's strip-the-first-import technique. The invariant is no network /
// filesystem / clock / random / process / dynamic evaluation / external
// capability — not "the token `import` may appear once".

describe('engine module invariants (§5.1.1 B)', () => {
  const src = readFileSync(join(here, '../src/analytics/engine.js'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  it('imports nothing at all — the generic engine has no dependency, not even A1', () => {
    assert.equal([...code.matchAll(/\bimport\b/g)].length, 0, 'zero import tokens in code');
    assert.equal([...code.matchAll(/\brequire\b/g)].length, 0, 'no require');
  });

  it('reaches for no capability and no nondeterminism source', () => {
    for (const banned of [
      /\bprocess\b/, /\bperformance\b/, /\bglobalThis\b/, /\bcrypto\b/,
      /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bchild_process\b/,
      /\beval\b/, /\bFunction\b/, /\bDate\b/, /\bMath\.random\b/,
      /\bsetTimeout\b/, /\bsetInterval\b/, /\bsetImmediate\b/,
      /\bimport\s*\(/, /node:/, /\bfs\b/, /\breadFileSync\b/,
    ]) {
      assert.ok(!banned.test(code), `no ${banned}`);
    }
  });

  it('holds no mutable module state', () => {
    const topLevel = code.split('\n').filter((l) => /^(let|var)\s/.test(l));
    assert.deepStrictEqual(topLevel, [], 'no top-level let/var');
  });

  it('carries no strategy-specific knowledge (§7.3 architecture line)', () => {
    for (const leak of ['donchian', 'Donchian', 'sma', 'SMA', 'period', 'fastPeriod', 'slowPeriod', 'minimumBars']) {
      assert.ok(!code.includes(leak), `the generic engine must not mention ${leak}`);
    }
  });

  it('is deterministic — identical input twice gives deep-equal results', () => {
    const f = D5_CORPUS[6];
    assert.deepStrictEqual(
      runStrategyBacktest(bars(f.rows), donchianStrategy(f.period)),
      runStrategyBacktest(bars(f.rows), donchianStrategy(f.period)),
    );
  });
});

// ── 7. contract readback ────────────────────────────────────────────────────

test('BT4 contract pins the boundary this engine implements', () => {
  const contract = readFileSync(join(here, '../docs/BT4-CONTRACT.md'), 'utf8');
  for (const needle of [
    'ENTER_LONG | EXIT_LONG | NONE',
    'defined no-op',
    'no synthetic rejection record',
    'invariant under arbitrary changes to bars strictly after',
    'Strategy identity must not be observable downstream of signal',
  ]) {
    assert.ok(contract.includes(needle), `contract must contain: ${needle}`);
  }
});
