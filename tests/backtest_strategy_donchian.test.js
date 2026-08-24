// BT4 — the Donchian strategy adapter. This file is where BT1's A1-channel
// consumption tripwire LIVES NOW: the responsibility moved here when the
// execution loop was generalized out of src/analytics/backtest.js, and the
// owner ratified moving the tripwire with it (contract §1.6 Amendment A,
// normative text §5.1.1 A). Nothing was dropped in the move — the token-level
// pins are carried over verbatim, and two behavioural pins were ADDED that
// the old source-shape-only tripwire could not express:
//
//   * the PR #71 pathology is now pinned by BEHAVIOUR, not only by text: a
//     self-referential band (current-bar window instead of the prior one) is
//     shown to silently produce zero trades on a trace where the real
//     adapter trades;
//   * the current-bar subscript is banned outright — the decision may read
//     upper[index - 1] / lower[index - 1] and never upper[index] /
//     lower[index].
//
// Per contract §5.1.1 B the capability scan is now PER MODULE: this adapter
// is permitted exactly one dependency, the CLOSED A1 kernel.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStrategyBacktest } from '../src/analytics/engine.js';
import { donchianStrategy } from '../src/analytics/strategies/donchian.js';
import { donchian } from '../src/analytics/indicators.js';

const here = dirname(fileURLToPath(import.meta.url));

const B = ([open, high, low, close]) => ({ open, high, low, close });
const bars = (rows) => rows.map(B);
const flat10 = [10, 10, 10, 10];

// F1, the ratified round-trip trace: entry signal 3 → fill @10, exit signal
// 6 → fill @8.
const F1 = [flat10, flat10, flat10, [10, 12, 10, 11], [10, 12, 10, 10], [10, 11, 10, 10], [8, 8, 7, 7], [8, 9, 8, 9]];

describe('Donchian adapter — prior-channel semantics (contract §5.1.1 A, behavioural)', () => {
  it('the adapter trades on F1 exactly as the CLOSED kernel did', () => {
    const r = runStrategyBacktest(bars(F1), donchianStrategy(3));
    assert.equal(r.totalExecutions, 2);
    assert.equal(r.totalClosedTrades, 1);
    assert.deepStrictEqual(r.executions.map((e) => [e.kind, e.signalIndex, e.fillIndex, e.fillPrice]),
      [['entry', 3, 4, 10], ['exit', 6, 7, 8]]);
  });

  it('PR #71 pathology: a self-referential band silently produces zero trades — and this is why the prior window is binding', () => {
    // The donor's post-#71 lesson, as an executable pin. A1's donchian
    // window INCLUDES the current bar, so upper[i] >= highs[i] always: an
    // adapter that compared against its own bar's band could never signal an
    // entry, and would report an empty result with no error at all.
    const selfReferential = {
      evaluate: ({ index, position, highs, lows }) => {
        if (index < 3) return 'NONE';
        const { upper, lower } = donchian(highs, lows, 3);
        if (position === 'flat') return highs[index] > upper[index] ? 'ENTER_LONG' : 'NONE';
        return lows[index] < lower[index] ? 'EXIT_LONG' : 'NONE';
      },
    };
    const sick = runStrategyBacktest(bars(F1), selfReferential);
    assert.equal(sick.totalExecutions, 0, 'the pathology is silent — zero trades, no error');
    assert.notDeepStrictEqual(sick, runStrategyBacktest(bars(F1), donchianStrategy(3)),
      'the real adapter must differ from the pathological one — otherwise this trace proves nothing');
  });

  it('the channel comes from the CLOSED A1 kernel, not from a local recomputation', () => {
    // Consumption equivalence: the adapter's decisions must be the ones A1's
    // own output dictates at index-1, on every eligible bar of F1.
    const highs = F1.map((r) => r[1]);
    const lows = F1.map((r) => r[2]);
    const { upper, lower } = donchian(highs, lows, 3);
    const strategy = donchianStrategy(3);
    let position = 'flat';
    for (let i = 3; i < F1.length; i++) {
      const view = Object.freeze({
        index: i,
        position,
        opens: F1.slice(0, i + 1).map((r) => r[0]),
        highs: highs.slice(0, i + 1),
        lows: lows.slice(0, i + 1),
        closes: F1.slice(0, i + 1).map((r) => r[3]),
      });
      const expected = position === 'flat'
        ? (highs[i] > upper[i - 1] ? 'ENTER_LONG' : 'NONE')
        : (lows[i] < lower[i - 1] ? 'EXIT_LONG' : 'NONE');
      assert.equal(strategy.evaluate(view), expected, `A1-dictated decision at bar ${i}`);
      if (expected === 'ENTER_LONG') position = 'long';
      if (expected === 'EXIT_LONG') position = 'flat';
    }
  });

  it('warm-up is the strategy\'s own business and reads NONE, never a skipped call (D1b)', () => {
    const strategy = donchianStrategy(3);
    for (let i = 0; i < 3; i++) {
      const view = Object.freeze({
        index: i, position: 'flat',
        opens: [], highs: F1.slice(0, i + 1).map((r) => r[1]), lows: F1.slice(0, i + 1).map((r) => r[2]), closes: [],
      });
      assert.equal(strategy.evaluate(view), 'NONE', `bar ${i} is warm-up`);
    }
  });

  it('rejects a non-positive-integer period at construction', () => {
    for (const bad of [0, -3, 2.5, '20', NaN, null]) {
      assert.throws(() => donchianStrategy(bad), /donchianStrategy: period must be a positive integer/);
    }
  });

  it('defaults to period 20, matching the facade and A1', () => {
    assert.equal(donchianStrategy().evaluate({ index: 19, position: 'flat', highs: [], lows: [] }), 'NONE');
  });
});

// ── migrated token-level tripwire (BT1's, carried over verbatim + hardened) ─

describe('Donchian adapter module invariants (§5.1.1 A and B)', () => {
  const src = readFileSync(join(here, '../src/analytics/strategies/donchian.js'), 'utf8');
  // Scan CODE only — comments legitimately describe capabilities they forbid.
  // Block comments, full-line comments, AND trailing `//` comments are all
  // stripped; the trailing strip is a plain regex, safe here because this
  // module's only string literal is its error message, which has no slashes.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  it('imports exactly the A1 kernel and nothing else', () => {
    const imports = [...code.matchAll(/\bimport\b[^;]*;/g)].map((m) => m[0]);
    assert.equal(imports.length, 1, `exactly one import statement, got ${imports.length}`);
    assert.match(imports[0], /from\s*'\.\.\/indicators\.js'/, 'the single import is ../indicators.js');
    const rest = code.replace(imports[0], '');
    assert.ok(!/\bimport\b/.test(rest), 'no further import token in code');
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

  it('consumes the A1 channel — the migrated named tripwire', () => {
    // Carried over from BT1 verbatim: the exact sanctioned call shape, the
    // occurrence COUNTS that close the dead-reference escape (a mutant that
    // keeps dead upper[t-1] reads while deciding from a local recomputation
    // changes a counted number), and the verbatim decision lines.
    assert.match(code, /const \{ upper, lower \} = donchian\(highs, lows, period\);/,
      'the exact sanctioned donchian call shape');
    assert.equal([...code.matchAll(/\bdonchian\b/g)].length, 2,
      'donchian appears exactly twice: the import and the call');
    assert.equal([...code.matchAll(/\bupper\b/g)].length, 2,
      'upper appears exactly twice: the destructure and the entry decision');
    assert.equal([...code.matchAll(/\blower\b/g)].length, 2,
      'lower appears exactly twice: the destructure and the exit decision');
    assert.match(code, /return highs\[index\] > upper\[index - 1\] \? 'ENTER_LONG' : 'NONE';/,
      'the verbatim entry decision consumes upper[index - 1]');
    assert.match(code, /return lows\[index\] < lower\[index - 1\] \? 'EXIT_LONG' : 'NONE';/,
      'the verbatim exit decision consumes lower[index - 1]');
    for (const banned of ['Math.max', 'Math.min', 'Infinity', '.reduce', '.sort', '.slice', '.filter']) {
      assert.ok(!code.includes(banned), `no local channel arithmetic: ${banned}`);
    }
  });

  it('HARDENED: the current bar can never enter the band it must break (the #71 shape, textually)', () => {
    assert.ok(!/\bupper\[index\]/.test(code), 'the entry threshold is never the current bar\'s own upper band');
    assert.ok(!/\blower\[index\]/.test(code), 'the exit threshold is never the current bar\'s own lower band');
    assert.equal([...code.matchAll(/\bupper\[index - 1\]/g)].length, 1, 'exactly one prior-window upper read');
    assert.equal([...code.matchAll(/\blower\[index - 1\]/g)].length, 1, 'exactly one prior-window lower read');
  });

  it('the adapter never reaches for the future, textually or structurally', () => {
    assert.ok(!/\[index \+ 1\]/.test(code), 'no index+1 read');
    assert.ok(!/\bopens\b/.test(code), 'the Donchian rule consults no open price at all');
  });
});
