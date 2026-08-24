// BT1 — deterministic Donchian breakout execution kernel, tested against the
// RATIFIED BT0 contract (docs/BT0-CONTRACT.md, ratified @ 438a59e, merged
// ae68572). Oracle discipline:
//
//   1. CONTRACT FIXTURES: F1–F12 below are transcribed verbatim from the
//      contract's §7 hand-derived tables (bars, period, and every expected
//      field). The derivations live in the contract; the reviewer recomputes
//      there, not here. These are the binding oracle — the implementation
//      conforms to THEM, never the other way around.
//   2. SUPPLEMENTARY SEQUENCES: multi-trade and mixed-terminal scenarios the
//      contract's fixture set does not cover (array ordering across two
//      closed trades; closed history + open position + terminal exit). Each
//      carries its own in-comment hand derivation.
//   3. STATIC INVARIANTS: facade purity (exactly the two sanctioned local
//      imports, no capability tokens, no clock/randomness), the §5.1.1 C
//      facade shape (delegation only — no channel arithmetic and no second
//      execution loop), zero product wiring (no MCP exposure before BT5), A1
//      kernel immutability (owner ruling 2026-08-23: BT work must not change
//      A1 Donchian semantics), and a §4.5 field-name readback against the
//      contract document.
//
// BT4 NOTE (Amendment A, docs/BT4-CONTRACT.md §1.6 / §5.1.1). BT4 generalized
// the execution loop out of src/analytics/backtest.js: the loop now lives in
// src/analytics/engine.js and the Donchian rules in
// src/analytics/strategies/donchian.js, with `donchianBreakoutBacktest()`
// retained as an adapter-backed compatibility facade (D8a). Sections 1–4 and 6
// below — the BEHAVIOURAL oracle — are untouched by that change and are
// exactly the D5 golden regression: every ratified expected value still holds
// through the facade. Only the source-shape tripwires in section 5 moved, to
// the modules that now own what they guarded.
//
// Execution-model reminders (all owner-ratified, none reviewable here):
// completed-bar signal → next-bar raw-open fill; strict inequalities;
// flat→entry-only / long→exit-only; initial state flat; terminal signal
// without a next bar never fills; open position at end is preserved;
// executions ≠ closed trades; the kernel treats every supplied bar as
// completed (completion detection is an integration concern, not BT1's).
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { donchianBreakoutBacktest } from '../src/analytics/backtest.js';

const here = dirname(fileURLToPath(import.meta.url));

// Bars are contract-table rows [open, high, low, close]; the kernel reads
// exactly the record fields the validated OHLCV boundary serves.
const B = ([open, high, low, close]) => ({ open, high, low, close });
const bars = (rows) => rows.map(B);
const flat10 = [10, 10, 10, 10];

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

// ── 1. the twelve contract fixtures (BT0 §7, verbatim) ──────────────────────

const CONTRACT_FIXTURES = [
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
    rows: Array.from({ length: 10 }, () => flat10),
    expected: EMPTY,
  },
  {
    name: 'F9a empty input',
    period: 3,
    rows: [],
    expected: EMPTY,
  },
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
];

describe('BT0 contract fixtures (binding oracle, transcribed verbatim)', () => {
  for (const f of CONTRACT_FIXTURES) {
    it(f.name, () => {
      assert.deepStrictEqual(donchianBreakoutBacktest(bars(f.rows), f.period), f.expected);
    });
  }
});

// ── 2. supplementary hand-derived sequences (beyond the contract set) ───────

describe('supplementary sequences', () => {
  it('two closed round trips arrive in ascending exit-fill order (§4.5 ordering)', () => {
    // p=2. Derivation (0-based; ch[i−1] = donchian over the 2 bars ending at i−1):
    //   i2 (10,12,10,11): ch[1]=10/10, flat, 12>10  → entry signal 2
    //   i3 (13,13,9,10):  fill @13; ch[2]=12/10, long, 9<10 → exit signal 3
    //   i4 (9,10,8,9):    fill @9 (trade 1: 13→9); ch[3]=13/9, flat, 10>13 false
    //   i5 (9,15,9,14):   ch[4]=13/8, flat, 15>13 → entry signal 5
    //   i6 (15,16,14,15): fill @15; ch[5]=15/8, long, 14<8 false
    //   i7 (15,15,7,8):   ch[6]=16/9, long, 7<9 → exit signal 7
    //   i8 (7,9,7,8):     fill @7 (trade 2: 15→7); ch[7]=16/7, flat, 9>16 false
    // Every fill price differs from its signal bar's close (13≠11, 9≠10,
    // 15≠14, 7≠8) — same-bar-close mutants fail on price too.
    const rows = [flat10, flat10, [10, 12, 10, 11], [13, 13, 9, 10], [9, 10, 8, 9],
      [9, 15, 9, 14], [15, 16, 14, 15], [15, 15, 7, 8], [7, 9, 7, 8]];
    assert.deepStrictEqual(
      donchianBreakoutBacktest(bars(rows), 2),
      result(
        [E('entry', 2, 3, 13), E('exit', 3, 4, 9), E('entry', 5, 6, 15), E('exit', 7, 8, 7)],
        [T(2, 3, 13, 3, 4, 9), T(5, 6, 15, 7, 8, 7)],
        null,
        null,
      ),
    );
  });

  it('closed history + re-entered open position + terminal exit signal coexist (§4.4 orthogonality)', () => {
    // p=1 (ch[i−1] = bar i−1's high/low). Derivation:
    //   i1 (10,12,10,11): ch[0]=10/10, flat, 12>10 → entry signal 1
    //   i2 (10,11,9,9):   fill @10; ch[1]=12/10, long, 9<10 → exit signal 2
    //   i3 (8,13,8,11):   fill @8 (trade: 10→8); ch[2]=11/9, flat, 13>11 → entry signal 3
    //   i4 (12,12,7,9):   fill @12; ch[3]=13/8, long, 7<8 → exit signal 4; no i5 → terminal
    // Fill-vs-signal-close: 10≠11, 8≠9, 12≠11.
    const rows = [flat10, [10, 12, 10, 11], [10, 11, 9, 9], [8, 13, 8, 11], [12, 12, 7, 9]];
    assert.deepStrictEqual(
      donchianBreakoutBacktest(bars(rows), 1),
      result(
        [E('entry', 1, 2, 10), E('exit', 2, 3, 8), E('entry', 3, 4, 12)],
        [T(1, 2, 10, 2, 3, 8)],
        OPEN(3, 4, 12),
        PEND('exit', 4),
      ),
    );
  });

  it('default period is 20 (kernel-internal default, mirroring donchian())', () => {
    // 20 flat warm-up bars; i20 breaks ch[19]=10/10 (15>10) → entry signal 20;
    // i21 fills @12; ch[20] = bars 1..20 → 15/10, low 11<10 false → held open.
    const rows = [...Array.from({ length: 20 }, () => flat10), [10, 15, 10, 14], [12, 12, 11, 12]];
    assert.deepStrictEqual(
      donchianBreakoutBacktest(bars(rows)),
      result([E('entry', 20, 21, 12)], [], OPEN(20, 21, 12), null),
    );
    // Distinguisher (round-1 advisory): 19 flat bars + a breakout bar at index
    // 19 (N = 20). Under the default p=20, i=19 is warm-up → empty result; any
    // lower default (19, 18, …) would instead emit a terminal entry signal.
    const rows19 = [...Array.from({ length: 19 }, () => flat10), [10, 15, 10, 14]];
    assert.deepStrictEqual(donchianBreakoutBacktest(bars(rows19)), EMPTY);
  });

  it('adjacent-double breakouts signal and raw fractional opens fill exactly (strict rules, raw doubles)', () => {
    // p=1 (ch[i−1] = bar i−1's high/low), bands at 0.5 where binary64 spacing
    // is exact on both sides: nextUp(0.5) = 0.5 + EPSILON/2 and
    // nextDown(0.5) = 0.5 − EPSILON/4 are the ADJACENT representable doubles
    // (round-2: at magnitude 1, +EPSILON/2 is absorbed by rounding and
    // 1−EPSILON is two steps down, which let half-epsilon dead-band mutants
    // survive the previous fixture). Derivation:
    //   i1 (0.5, 0.5+EPS/2, 0.5, 0.5):        ch[0]=0.5/0.5, flat,
    //                                         nextUp(0.5) > 0.5 → entry signal 1
    //   i2 (1.23456789, 1.3, 0.5−EPS/4, 0.6): fill @1.23456789 exactly (raw
    //                                         double, no precision transform);
    //                                         ch[1]=(0.5+EPS/2)/0.5, long,
    //                                         nextDown(0.5) < 0.5 → exit signal 2
    //   i3 (0.987654321, 1.1, 0.6, 0.7):      fill @0.987654321 exactly;
    //                                         ch[2]=1.3/(0.5−EPS/4), flat,
    //                                         1.1 > 1.3 false
    // Class closure: ANY dead band must reject at least the adjacent double,
    // so the minimal mutant (± the band's own ULP) already fails here — and
    // with it every larger tolerance, including ±EPSILON/2 and ±1e-9.
    // Rounding mutants fail on the exact fractional fills.
    const up = 0.5 + Number.EPSILON / 2;
    const down = 0.5 - Number.EPSILON / 4;
    const rows = [[0.5, 0.5, 0.5, 0.5], [0.5, up, 0.5, 0.5], [1.23456789, 1.3, down, 0.6], [0.987654321, 1.1, 0.6, 0.7]];
    assert.ok(up > 0.5 && down < 0.5 && up !== 0.5 && down !== 0.5, 'the adjacent doubles are distinct from the band');
    assert.deepStrictEqual(
      donchianBreakoutBacktest(bars(rows), 1),
      result(
        [E('entry', 1, 2, 1.23456789), E('exit', 2, 3, 0.987654321)],
        [T(1, 2, 1.23456789, 2, 3, 0.987654321)],
        null,
        null,
      ),
    );
  });
});

// ── 3. determinism and purity of behavior ───────────────────────────────────

describe('determinism', () => {
  it('identical input twice → deep-equal results (no clock, no randomness)', () => {
    const f = CONTRACT_FIXTURES[6]; // F7
    const a = donchianBreakoutBacktest(bars(f.rows), f.period);
    const b = donchianBreakoutBacktest(bars(f.rows), f.period);
    assert.deepStrictEqual(a, b);
  });

  it('does not mutate its input (runs on frozen bars)', () => {
    const f = CONTRACT_FIXTURES[0]; // F1
    const frozen = Object.freeze(bars(f.rows).map((b) => Object.freeze(b)));
    assert.deepStrictEqual(donchianBreakoutBacktest(frozen, f.period), f.expected);
  });

  it('extra record fields (time, volume) are carried by the boundary and ignored here', () => {
    const f = CONTRACT_FIXTURES[0]; // F1
    const withExtras = bars(f.rows).map((b, i) => ({ time: 1700000000 + i * 60, ...b, volume: 100 }));
    assert.deepStrictEqual(donchianBreakoutBacktest(withExtras, f.period), f.expected);
  });
});

// ── 4. boundary validation (A1 approved-delta doctrine: fail loud, typed) ───

describe('input validation', () => {
  const periodError = /donchianBreakoutBacktest: period must be a positive integer/;
  it('rejects non-positive, fractional, and non-number periods', () => {
    for (const bad of [0, -3, 2.5, '20', NaN, null]) {
      assert.throws(() => donchianBreakoutBacktest(bars([flat10]), bad), periodError);
    }
  });
  it('rejects non-array bars', () => {
    const barsError = /donchianBreakoutBacktest: bars must be an array/;
    for (const bad of [null, undefined, 'bars', 42, { length: 3 }]) {
      assert.throws(() => donchianBreakoutBacktest(bad, 3), barsError);
    }
  });
});

// ── 5. static invariants — purity, isolation, A1 immutability ───────────────

describe('facade invariants (BT4 Amendment A — migrated from the pre-generalization kernel)', () => {
  const src = readFileSync(join(here, '../src/analytics/backtest.js'), 'utf8');
  // Scan CODE only — comments legitimately describe capabilities they forbid.
  // Block comments, full-line comments, AND trailing `//` comments are all
  // stripped (round-1: a trailing comment previously survived the filter).
  // The trailing strip is a plain regex; safe here because this module's
  // string literals are its two error messages and its two import paths, none
  // of which contains a `//` sequence.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  // MIGRATED by BT4 Amendment A (docs/BT4-CONTRACT.md §1.6, normative text
  // §5.1.1). Two tripwires that used to live here pinned the PRE-generalization
  // source shape of this file, and the responsibilities they guarded moved when
  // BT4 lifted the execution loop out:
  //
  //   * `imports exactly the A1 kernel and nothing else` and
  //     `consumes the A1 channel — named tripwire` now live in
  //     tests/backtest_strategy_donchian.test.js, on the module that actually
  //     consumes the A1 channel. Nothing was weakened in the move: the exact
  //     call shape, the occurrence counts, the verbatim decision lines and the
  //     no-local-channel-arithmetic ban are carried over unchanged, and two
  //     pins were ADDED — the current-bar subscript is banned outright, and the
  //     PR #71 self-referential-band pathology is now pinned BEHAVIOURALLY.
  //   * the capability scan became PER MODULE (§5.1.1 B); this file keeps its
  //     own, rewritten below for a facade that legitimately imports two local
  //     pure modules. The invariant was never "the token `import` may appear
  //     once" — that was a technique for the old single-file architecture.
  //
  // What replaces them HERE is the §5.1.1 C facade test: this file must be a
  // facade and nothing else.

  it('imports exactly the generic engine and the Donchian adapter — local pure modules only', () => {
    const imports = [...code.matchAll(/\bimport\b[^;]*;/g)].map((m) => m[0]);
    assert.equal(imports.length, 2, `exactly two import statements, got ${imports.length}`);
    assert.match(imports[0], /from\s*'\.\/engine\.js'/, 'the generic engine');
    assert.match(imports[1], /from\s*'\.\/strategies\/donchian\.js'/, 'the Donchian adapter');
    const rest = imports.reduce((acc, i) => acc.replace(i, ''), code);
    assert.ok(!/\bimport\b/.test(rest), 'no further import token in code');
  });

  it('reaches for no capability and no nondeterminism source', () => {
    // Word-boundary regexes so optional chaining (`process?.`), bare global
    // references, and dynamic import() cannot slip past a substring scan
    // (round-1 finding: `process?.hrtime.bigint()` evaded 'process.').
    const rest = [...code.matchAll(/\bimport\b[^;]*;/g)]
      .map((m) => m[0])
      .reduce((acc, i) => acc.replace(i, ''), code);
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

  it('is a facade and nothing else — delegation, no channel arithmetic, no second execution loop (§5.1.1 C)', () => {
    // The REQUIRED shape is  backtest.js -> Donchian adapter -> generic engine.
    // The FORBIDDEN shape is this file keeping a Donchian execution path of its
    // own alongside the generic one, which would leave the CLOSED kernel in
    // place and make the D5 equivalence proof meaningless.
    assert.match(code, /export function donchianBreakoutBacktest\(bars, period = 20\) \{/,
      'the D8a public surface keeps its exact signature');
    assert.match(code, /return runStrategyBacktest\(bars, donchianStrategy\(period\)\);/,
      'the verbatim delegation line — the whole body of the facade');

    // No channel arithmetic of its own.
    for (const banned of ['upper', 'lower', 'Math.max', 'Math.min', 'Infinity',
      '.reduce', '.sort', '.slice', '.filter']) {
      assert.ok(!code.includes(banned), `the facade must carry no channel arithmetic: ${banned}`);
    }
    // The adapter's module PATH legitimately contains the word; what must not
    // appear is a CALL to the A1 channel function from this file.
    assert.ok(!/\bdonchian\s*\(/.test(code),
      'the facade never calls the A1 channel itself — the adapter does');
    assert.equal([...code.matchAll(/\bdonchianStrategy\b/g)].length, 2,
      'donchianStrategy appears exactly twice: the import and the delegation');

    // No second execution loop, and no execution bookkeeping.
    for (const banned of [/\bfor\s*\(/, /\bwhile\s*\(/, /\bexecutions\b/, /\bclosedTrades\b/,
      /\bopenPosition\b/, /\bpending\b/, /\bsignalIndex\b/, /\bfillIndex\b/, /\bfillPrice\b/]) {
      assert.ok(!banned.test(code), `the facade owns no execution machinery: ${banned}`);
    }

    // No strategy-specific special case reaching downstream (§7.3).
    assert.ok(!/\bif\s*\(\s*strategy/.test(code), 'no branch on strategy identity');
  });

  it('has zero product wiring — no MCP exposure before BT5', () => {
    const roots = ['../src/server.js', '../src/connection.js', '../src/wait.js'];
    for (const f of readdirSync(join(here, '../src/tools'))) roots.push(`../src/tools/${f}`);
    for (const f of readdirSync(join(here, '../src/core'))) {
      if (f.endsWith('.js')) roots.push(`../src/core/${f}`);
    }
    for (const rel of roots) {
      const text = readFileSync(join(here, rel), 'utf8');
      assert.ok(!text.includes('backtest'), `${rel} must not wire the backtest kernel (BT5 gate)`);
    }
  });

  it('A1 indicator kernel is byte-identical to its CLOSED state (owner ruling 2026-08-23)', () => {
    // "BT work must not change A1 Donchian indicator semantics." Any change to
    // src/analytics/indicators.js under the BT workstream requires an explicit
    // owner adjudication — this pin makes a silent touch fail loudly, by name.
    const a1 = readFileSync(join(here, '../src/analytics/indicators.js'));
    assert.equal(
      createHash('sha256').update(a1).digest('hex'),
      'b21df40abaa392c5905db3335b78028ab3d84b98ca53c24724529abcaac1cfed',
      'src/analytics/indicators.js changed — A1 is CLOSED; a change requires owner adjudication, then update this pin in the same reviewed commit',
    );
  });
});

// ── 6. contract readback — code shape is bound to the ratified document ─────

test('BT0 contract document pins the §4.5 result fields this kernel returns', () => {
  const contract = readFileSync(join(here, '../docs/BT0-CONTRACT.md'), 'utf8');
  for (const needle of [
    'executions[]', 'closedTrades[]', 'openPosition', 'pendingSignal',
    'totalExecutions', 'totalClosedTrades',
    'raw open of bar `i+1`', 'unfillable', 'starts flat',
  ]) {
    assert.ok(contract.includes(needle), `contract must contain: ${needle}`);
  }
});
