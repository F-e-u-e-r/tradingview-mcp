// Issue #2 regression matrix: loading is present iff at least one candidate
// matching any supported loading selector is observably visible. Hidden
// candidates must neither mask visible candidates (across selectors or within
// a single selector) nor keep readiness blocked. Shapes s1–s6 mirror the
// orientation harness on the issue; each node carries the values a real
// browser produced for that shape (offsetParent, client rects, computed
// style, checkVisibility), so the expressions under test see the same world
// the page would give them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForChartReady, waitForChartRender, LOADING_PROBE_JS } from '../src/wait.js';

const BODY_SENTINEL = {};

// visible:false models display:none (no box, offsetParent null).
// fixed:true models a visible position:fixed overlay: it HAS a box and is
// observably visible, but offsetParent is null — the measured real-browser
// divergence that motivated replacing the offsetParent proxy.
function el({ classes = '', dataName = null, visible = true, fixed = false, cv = true }) {
  const node = {
    className: classes,
    dataset: dataName ? { name: dataName } : {},
    parentElement: null,
    offsetParent: visible && !fixed ? BODY_SENTINEL : null,
    getClientRects: () => (visible ? [{ width: 20, height: 20 }] : []),
    style: {
      display: visible ? 'block' : 'none',
      visibility: 'visible',
      opacity: '1',
      position: fixed ? 'fixed' : 'static',
    },
  };
  if (cv) node.checkVisibility = () => visible;
  return node;
}

function makeDoc(bySelector) {
  const canvas = { getBoundingClientRect: () => ({ width: 300, height: 150 }) };
  return {
    querySelector(sel) {
      if (sel === '[data-name="pane-canvas"] canvas') return canvas;
      const list = bySelector[sel] || [];
      return list.length ? list[0] : null;
    },
    querySelectorAll(sel) {
      return bySelector[sel] || [];
    },
  };
}

const chartStub = {
  symbol: () => 'FAKE:SYM',
  resolution: () => 'D',
  _chartWidget: {
    model: () => ({ mainSeries: () => ({ bars: () => ({ size: () => 100 }) }) }),
  },
};
const windowStub = { TradingViewApi: { _activeChartWidgetWV: { value: () => chartStub } } };

// Runs the exact expression string a wait function hands to evaluate(),
// against the shape's fake DOM, recording every per-poll state.
function fakeEvaluateFor(doc, states) {
  return async (expr) => {
    const fn = new Function('document', 'getComputedStyle', 'window', `return (${expr});`);
    const state = fn(doc, (n) => n.style, windowStub);
    states.push(state);
    return state;
  };
}

// expected 'busy'  → the loading indicator set contains a visible candidate:
//                    the expression must judge loading, and the wait must not
//                    report success within its timeout.
// expected 'ready' → no candidate is observably visible: the wait must still
//                    succeed (a hidden spinner must not fail closed).
function makeShapes(cv = true) {
  const E = (opts) => el({ ...opts, cv });
  return {
    's1 hidden [class*="loading"] + visible [data-name="loading"]': {
      expected: 'busy',
      doc: makeDoc({
        '[class*="loader"]': [],
        '[class*="loading"]': [E({ classes: 'loading-x', visible: false })],
        '[data-name="loading"]': [E({ dataName: 'loading' })],
      }),
    },
    's2 visible [class*="loader"] (first selector)': {
      expected: 'busy',
      doc: makeDoc({
        '[class*="loader"]': [E({ classes: 'loader-x' })],
        '[class*="loading"]': [],
        '[data-name="loading"]': [],
      }),
    },
    's3 candidates for all selectors, all hidden': {
      expected: 'ready',
      doc: makeDoc({
        '[class*="loader"]': [E({ classes: 'loader-x', visible: false })],
        '[class*="loading"]': [E({ classes: 'loading-x', visible: false })],
        '[data-name="loading"]': [E({ dataName: 'loading', visible: false })],
      }),
    },
    's4 no candidates': {
      expected: 'ready',
      doc: makeDoc({
        '[class*="loader"]': [],
        '[class*="loading"]': [],
        '[data-name="loading"]': [],
      }),
    },
    's5 same selector: hidden DOM-first + visible second': {
      expected: 'busy',
      doc: makeDoc({
        '[class*="loader"]': [
          E({ classes: 'loader-a', visible: false }),
          E({ classes: 'loader-b' }),
        ],
        '[class*="loading"]': [],
        '[data-name="loading"]': [],
      }),
    },
    's6 visible position:fixed spinner': {
      expected: 'busy',
      doc: makeDoc({
        '[class*="loader"]': [E({ classes: 'loader-x', fixed: true })],
        '[class*="loading"]': [],
        '[data-name="loading"]': [],
      }),
    },
  };
}

const BUSY_TIMEOUT = 450;
const READY_TIMEOUT = 5000;

for (const [name, { expected }] of Object.entries(makeShapes())) {
  test(`waitForChartReady — ${name} → ${expected}`, async () => {
    const { doc } = makeShapes()[name];
    const states = [];
    if (expected === 'busy') {
      const ready = await waitForChartReady(null, null, BUSY_TIMEOUT, fakeEvaluateFor(doc, states));
      assert.equal(states.at(-1).loading, true,
        'a visible loading candidate must be judged as loading');
      assert.equal(ready, false,
        'must not report ready while a loading indicator is observably visible');
    } else {
      const ready = await waitForChartReady(null, null, READY_TIMEOUT, fakeEvaluateFor(doc, states));
      assert.equal(states.at(-1).loading, false,
        'hidden-only/no candidates must not be judged as loading');
      assert.equal(ready, true,
        'hidden candidates must not keep readiness blocked (no fail-closed hang)');
    }
  });

  test(`waitForChartRender — ${name} → ${expected}`, async () => {
    const { doc } = makeShapes()[name];
    const states = [];
    if (expected === 'busy') {
      const done = await waitForChartRender(BUSY_TIMEOUT, fakeEvaluateFor(doc, states));
      assert.equal(states.at(-1).isLoading, true,
        'a visible loading candidate must be judged as loading');
      assert.equal(done, false,
        'must not report render-complete while a loading indicator is observably visible');
    } else {
      const done = await waitForChartRender(READY_TIMEOUT, fakeEvaluateFor(doc, states));
      assert.equal(states.at(-1).isLoading, false,
        'hidden-only/no candidates must not be judged as loading');
      assert.equal(done, true,
        'hidden candidates must not keep render-wait blocked (no fail-closed hang)');
    }
  });
}

// The shared primitive itself, exercised in BOTH visibility branches: nodes
// exposing Element.checkVisibility(), and nodes without it (compatibility
// fallback: client rects + self/ancestor computed-style walk).
function runProbe(doc) {
  return new Function('document', 'getComputedStyle', `return (${LOADING_PROBE_JS});`)(
    doc, (n) => n.style);
}

for (const cv of [true, false]) {
  const mode = cv ? 'checkVisibility' : 'fallback';
  for (const [name, { expected, doc }] of Object.entries(makeShapes(cv))) {
    test(`loading probe (${mode}) — ${name} → ${expected}`, () => {
      assert.equal(runProbe(doc), expected === 'busy');
    });
  }
}

// Drift guard: both wait functions must carry the SAME loading primitive.
// Captures the exact expression each function hands to evaluate() and asserts
// the shared probe is embedded verbatim in both.
test('both wait functions embed the shared loading primitive', async () => {
  const captured = [];
  const capture = async (expr) => { captured.push(expr); return null; };
  await waitForChartReady(null, null, 250, capture);
  const readyCount = captured.length;
  await waitForChartRender(250, capture);
  assert.ok(readyCount >= 1 && captured.length > readyCount, 'both functions polled');
  assert.ok(captured.slice(0, readyCount).every((e) => e.includes(LOADING_PROBE_JS)),
    'waitForChartReady must embed LOADING_PROBE_JS verbatim');
  assert.ok(captured.slice(readyCount).every((e) => e.includes(LOADING_PROBE_JS)),
    'waitForChartRender must embed LOADING_PROBE_JS verbatim');
});
