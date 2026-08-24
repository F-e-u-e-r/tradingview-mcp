// BT4 — the SMA-crossover second strategy: the FALSIFICATION INSTRUMENT.
//
// Acceptance, owner-binding (contract §7.1, D7): "加入第二策略後，不修改
// execution/accounting/metrics semantics即可完整跑完." So the load-bearing
// assertion in this file is not that SMA crossover is a good strategy — it is
// that plugging it in changes NOTHING downstream. SF9 runs it end to end
// through the CLOSED BT2 accounting and CLOSED BT3 metrics, imported
// unmodified, against hand-derived values.
//
// Oracle discipline: the SF tables are transcribed from docs/BT4-CONTRACT.md
// §6.2, where the derivations live and the reviewer recomputes. Every SMA
// value in them is exact in binary64 — integer closes make SMA-2 exact halves
// and SMA-4 exact quarters — so no tolerance appears anywhere.
//
// D6a semantics under test (contract §6.1a, ratified prev-inclusive /
// current-strict), the owner's three enumerated cases:
//   touch then move through -> ENTER_LONG   (SF-core i=5, SF10 i=5)
//   current equality        -> NONE          (SF-core i=4, SF10 i=4, SF5 i=6)
//   staying above           -> NONE          (SF2b, SF-core i=6/7)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStrategyBacktest } from '../src/analytics/engine.js';
import { smaCrossoverStrategy } from '../src/analytics/strategies/sma-crossover.js';
import { sma } from '../src/analytics/indicators.js';
import { accountBacktest } from '../src/analytics/accounting.js';
import { computeBacktestMetrics } from '../src/analytics/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));

const B = ([open, high, low, close]) => ({ open, high, low, close });
const bars = (rows) => rows.map(B);
const flatN = (v, n) => Array.from({ length: n }, () => [v, v, v, v]);
const E = (kind, signalIndex, fillIndex, fillPrice) => ({ kind, signalIndex, fillIndex, fillPrice });

// Signals are observed with a test-side recorder: the engine's §4.5 result
// shape is fixed and must not grow a signal log.
const signalsOf = (rows, strategy) => {
  const seen = [];
  runStrategyBacktest(bars(rows), { evaluate: (v) => { const s = strategy.evaluate(v); seen.push(s); return s; } });
  return seen;
};

// ── SF-core (contract §6.2): warm-up, equality, prev-inclusive cross, hold,
// cross-down. closes [10,10,10,10,10,12,14,14,10,6]:
//   f2 = [·,10,10,10,10,11,13,14,12,8]
//   s4 = [·,·,·,10,10,10.5,11.5,12.5,12.5,11]
const SFCORE = [
  ...flatN(10, 5), [10, 12, 10, 12], [14, 15, 13, 14], [14, 15, 13, 14],
  [12, 12, 9, 10], [8, 9, 5, 6],
];

describe('SF-core — the ratified D6/D6a table (fast 2 / slow 4)', () => {
  it('every SMA value in the contract table is exact against the CLOSED A1 sma()', () => {
    const closes = SFCORE.map((r) => r[3]);
    assert.deepStrictEqual(sma(closes, 2), [null, 10, 10, 10, 10, 11, 13, 14, 12, 8]);
    assert.deepStrictEqual(sma(closes, 4), [null, null, null, 10, 10, 10.5, 11.5, 12.5, 12.5, 11]);
  });

  it('signals match the table bar by bar', () => {
    assert.deepStrictEqual(signalsOf(SFCORE, smaCrossoverStrategy(2, 4)), [
      'NONE',       // i0 warm-up
      'NONE',       // i1 warm-up (s4 undefined)
      'NONE',       // i2 warm-up
      'NONE',       // i3 s4[2] is null
      'NONE',       // i4 f == s — equality at the current bar never signals
      'ENTER_LONG', // i5 11 > 10.5 with prev 10 <= 10 — prev-inclusive crossing
      'NONE',       // i6 still bullish while long — a state, not an event
      'NONE',       // i7 same
      'EXIT_LONG',  // i8 12 < 12.5 with prev 14 >= 12.5
      'NONE',       // i9 flat again
    ]);
  });

  it('executes as the table says — next-bar raw-open fills, one closed trade, flat end', () => {
    const r = runStrategyBacktest(bars(SFCORE), smaCrossoverStrategy(2, 4));
    assert.deepStrictEqual(r.executions, [E('entry', 5, 6, 14), E('exit', 8, 9, 8)]);
    assert.equal(r.totalClosedTrades, 1);
    assert.equal(r.openPosition, null);
    assert.equal(r.pendingSignal, null);
  });
});

describe('SF2b — a cross inside warm-up is missed by design and never fires late', () => {
  it('fast is already above slow at the first fully-defined bar → all NONE, empty result', () => {
    // closes [10,10,12,14,16]: f2 = [·,10,11,13,15]; s4 = [·,·,·,11.5,13].
    // At i=4 fast is above slow with fPrev > sPrev — a STATE, not an event.
    const rows = [[10, 10, 10, 10], [10, 10, 10, 10], [12, 12, 10, 12], [14, 14, 12, 14], [16, 16, 14, 16]];
    assert.deepStrictEqual(signalsOf(rows, smaCrossoverStrategy(2, 4)), ['NONE', 'NONE', 'NONE', 'NONE', 'NONE']);
    assert.equal(runStrategyBacktest(bars(rows), smaCrossoverStrategy(2, 4)).totalExecutions, 0);
  });
});

describe('SF5 — equality while long is a touch, not an exit', () => {
  const SF5 = [...flatN(10, 5), [10, 12, 10, 12], [8, 10, 7, 8], [7, 8, 5, 6], [6, 7, 5, 6]];
  it('i6 f == s → NONE; the true cross below at i7 exits', () => {
    // f2 = [·,10,10,10,10,11,10,7,6]; s4 = [·,·,·,10,10,10.5,10,9,8].
    assert.deepStrictEqual(signalsOf(SF5, smaCrossoverStrategy(2, 4)),
      ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'ENTER_LONG', 'NONE', 'EXIT_LONG', 'NONE']);
    assert.deepStrictEqual(runStrategyBacktest(bars(SF5), smaCrossoverStrategy(2, 4)).executions,
      [E('entry', 5, 6, 8), E('exit', 7, 8, 6)]);
  });
});

describe('SF6 — a final-bar crossover never fills and is preserved as terminal', () => {
  it('SF-core truncated to bars 0–5 → zero executions, unfillable pending entry', () => {
    const r = runStrategyBacktest(bars(SFCORE.slice(0, 6)), smaCrossoverStrategy(2, 4));
    assert.equal(r.totalExecutions, 0);
    assert.deepStrictEqual(r.pendingSignal, { kind: 'entry', signalIndex: 5, unfillable: true });
    assert.equal(r.openPosition, null);
  });
});

describe('SF10 — the D6a reconciliation walked in one trace (contract §6.1a)', () => {
  // closes [20,16,10,8,18,24,26]: f2 = [·,18,13,9,13,21,25];
  // s4 = [·,·,·,13.5,13,15,19].
  const SF10 = [
    [20, 20, 20, 20], [20, 20, 16, 16], [16, 16, 10, 10], [10, 10, 8, 8],
    [8, 18, 8, 18], [18, 24, 18, 24], [26, 27, 25, 26],
  ];

  it('the discriminating SMA values are EXACT, not near-equal', () => {
    const closes = SF10.map((r) => r[3]);
    const f = sma(closes, 2);
    const s = sma(closes, 4);
    assert.equal(f[3], 9); assert.equal(s[3], 13.5); // i3: strictly below
    assert.equal(f[4], 13); assert.equal(s[4], 13);  // i4: exactly equal
    assert.equal(f[5], 21); assert.equal(s[5], 15);  // i5: strictly through
  });

  it('i4 falsifies "current equality signals"; i5 falsifies "previous equality blocks"', () => {
    const signals = signalsOf(SF10, smaCrossoverStrategy(2, 4));
    assert.deepStrictEqual(signals, ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'ENTER_LONG', 'NONE']);
    assert.equal(signals[4], 'NONE', 'prev strictly below + current exactly equal is a touch, not a crossing');
    assert.equal(signals[5], 'ENTER_LONG', 'equality at i−1 IS a boundary state to cross from');
  });

  it('executes the entry at the next raw open and carries the open position', () => {
    const r = runStrategyBacktest(bars(SF10), smaCrossoverStrategy(2, 4));
    assert.deepStrictEqual(r.executions, [E('entry', 5, 6, 26)]);
    assert.equal(r.totalClosedTrades, 0);
    assert.deepStrictEqual(r.openPosition, { entrySignalIndex: 5, entryFillIndex: 6, entryPrice: 26 });
    assert.equal(r.pendingSignal, null);
  });

  it('RED-able: both ruled comparisons are discriminating on this trace', () => {
    // A gate that cannot fail proves nothing. Mutating either side of the
    // ruled rule must flip a signal on SF10.
    const closes = SF10.map((r) => r[3]);
    const f = sma(closes, 2);
    const s = sma(closes, 4);
    // current side made non-strict → i4 would enter
    assert.ok(f[4] >= s[4] && f[3] <= s[3], 'a non-strict current side would ENTER at i4');
    assert.ok(!(f[4] > s[4]), 'the ruled strict current side does not');
    // previous side made strict → i5 would not enter
    assert.ok(!(f[4] < s[4]), 'a strict previous side would block the i5 crossing');
    assert.ok(f[4] <= s[4] && f[5] > s[5], 'the ruled prev-inclusive side allows it');
  });
});

// ── SF9: the D7 acceptance proof, end to end through the CLOSED layers ──────

describe('SF9 — the second strategy flows through CLOSED BT2 + BT3 with zero special cases (D7)', () => {
  it('accounting and metrics match the hand-derived contract values exactly', () => {
    const b = bars(SFCORE);
    const execution = runStrategyBacktest(b, smaCrossoverStrategy(2, 4));
    // cash 1400, zero costs: entry qty = 1400/14 = 100 exact; exit @8 → cash
    // 800; realized −600. Equity [1400 × 8, 1000, 800].
    const acc = accountBacktest(b, execution, { initialCash: 1400, commissionRate: 0, slippageRate: 0 });
    assert.deepStrictEqual(acc.closedTradePnl, [{ realizedPnl: -600 }]);
    assert.deepStrictEqual(acc.equitySeries, [1400, 1400, 1400, 1400, 1400, 1400, 1400, 1400, 1000, 800]);
    assert.equal(acc.finalEquity, 800);
    assert.deepStrictEqual(computeBacktestMetrics(acc), {
      totalReturn: -600 / 1400,
      realizedPnlTotal: -600,
      unrealizedPnl: 0,
      netPnl: -600,
      closedTrades: 1,
      winningTrades: 0,
      losingTrades: 1,
      breakevenTrades: 0,
      winRate: 0,
      winRateReason: null,
      maxDrawdown: 600 / 1400,
      profitFactor: 0,
      profitFactorReason: null,
    });
  });

  it('the CLOSED downstream modules are consumed unmodified — their pins still hold elsewhere', () => {
    // A behavioural statement of the same fact: BT2 and BT3 accept this
    // strategy's execution result with no argument, flag, or shape of their
    // own. If the abstraction had failed, this call would need a special case.
    const b = bars(SFCORE.slice(0, 6)); // SF6: terminal unfillable pending
    const acc = accountBacktest(b, runStrategyBacktest(b, smaCrossoverStrategy(2, 4)),
      { initialCash: 1000, commissionRate: 0.001, slippageRate: 0.002 });
    assert.equal(acc.finalEquity, 1000, 'a never-filled terminal signal moves no money');
    assert.deepStrictEqual(computeBacktestMetrics(acc).closedTrades, 0);
  });
});

// ── construction-time validation and module invariants ──────────────────────

describe('SMA strategy construction', () => {
  it('rejects non-positive-integer periods', () => {
    for (const bad of [0, -3, 2.5, '4', NaN, null]) {
      assert.throws(() => smaCrossoverStrategy(bad, 4), /smaCrossoverStrategy: fastPeriod must be a positive integer/);
      assert.throws(() => smaCrossoverStrategy(2, bad), /smaCrossoverStrategy: slowPeriod must be a positive integer/);
    }
  });
  it('rejects fastPeriod >= slowPeriod at construction (contract §6.1)', () => {
    for (const [f, s] of [[4, 4], [5, 4], [20, 2]]) {
      assert.throws(() => smaCrossoverStrategy(f, s), /fastPeriod must be less than slowPeriod/);
    }
  });
});

describe('SMA strategy module invariants (§5.1.1 B)', () => {
  const src = readFileSync(join(here, '../src/analytics/strategies/sma-crossover.js'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  it('imports exactly the A1 kernel and nothing else', () => {
    const imports = [...code.matchAll(/\bimport\b[^;]*;/g)].map((m) => m[0]);
    assert.equal(imports.length, 1, `exactly one import statement, got ${imports.length}`);
    assert.match(imports[0], /from\s*'\.\.\/indicators\.js'/, 'the single import is ../indicators.js');
    assert.ok(!/\bimport\b/.test(code.replace(imports[0], '')), 'no further import token in code');
  });

  it('reaches for no capability and no nondeterminism source', () => {
    const rest = code.replace(/\bimport\b[^;]*;/, '');
    for (const banned of [
      /\bprocess\b/, /\bperformance\b/, /\bglobalThis\b/, /\bcrypto\b/,
      /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bchild_process\b/,
      /\beval\b/, /\bFunction\b/, /\bDate\b/, /\bMath\.random\b/,
      /\bsetTimeout\b/, /\bsetInterval\b/, /\bsetImmediate\b/, /\brequire\b/,
      /\bimport\s*\(/, /\bimport\b/, /node:/, /\bfs\b/,
    ]) {
      assert.ok(!banned.test(rest), `no ${banned}`);
    }
  });

  it('holds no mutable module state', () => {
    assert.deepStrictEqual(code.split('\n').filter((l) => /^(let|var)\s/.test(l)), []);
  });

  it('consumes the A1 sma() and never recomputes a mean locally', () => {
    assert.equal([...code.matchAll(/\bsma\b/g)].length, 3,
      'sma appears exactly three times: the import and the two window calls');
    assert.match(code, /const fast = sma\(closes, fastPeriod\);/, 'the exact sanctioned fast call');
    assert.match(code, /const slow = sma\(closes, slowPeriod\);/, 'the exact sanctioned slow call');
    for (const banned of ['Math.max', 'Math.min', 'Infinity', '.reduce', '.sort', '.slice', '.filter', '+=']) {
      assert.ok(!code.includes(banned), `no local mean arithmetic: ${banned}`);
    }
  });

  it('pins the ruled D6a comparison shape verbatim (prev-inclusive / current-strict)', () => {
    assert.match(code, /fast\[index\] > slow\[index\] && fast\[index - 1\] <= slow\[index - 1\] \? 'ENTER_LONG' : 'NONE'/,
      'entry: current strict, previous inclusive');
    assert.match(code, /fast\[index\] < slow\[index\] && fast\[index - 1\] >= slow\[index - 1\] \? 'EXIT_LONG' : 'NONE'/,
      'exit: current strict, previous inclusive');
    assert.ok(!/\[index \+ 1\]/.test(code), 'no index+1 read');
  });
});
