/**
 * The chart correctness contract.
 *
 * Five clauses, each one a counterexample that was REPRODUCED on the release
 * tree before any of this was written. They are deliberately small and
 * falsifiable: this contract does not attempt cadence inference, forming-bar
 * tolerance, padding, or completeness flags. Those were the previous campaign's
 * refinements of a contract that had never been stated, and re-importing them
 * would repeat that mistake.
 *
 *   C1 temporal binding    — bar data is attributable to the caller's window,
 *                            or the tool refuses. It NEVER answers a historical
 *                            question with the newest bars.
 *   C2 observable achievement — success means the read-back range was observed
 *                            to contain the request. False negatives are
 *                            acceptable; false positives are not.
 *   C3 unknown stays unknown — an unreadable or null endpoint is reported as
 *                            unknown, never masked to a value. Epoch 0 must
 *                            remain a distinguishable legal timestamp.
 *   C4 no silent substitution — a window outside loaded data is not answered
 *                            with the nearest available data.
 *   C5 verified identity    — readiness verifies the symbol AND resolution it
 *                            was actually asked about.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setVisibleRange, setTimeframe } from '../src/core/chart.js';
import { getOhlcv } from '../src/core/data.js';
import { waitForChartReady } from '../src/wait.js';

const MIN = 60;

/**
 * A synthetic page world. Expressions are EXECUTED, never pattern-matched, so a
 * change to what src/ sends fails loudly instead of silently matching nothing.
 */
function world(times, { visibleRange = null, symbol = 'NASDAQ:AAPL', resolution = '1' } = {}) {
  const loaded = [...times];
  const zoom = [];
  const bars = {
    firstIndex: () => 0,
    lastIndex: () => loaded.length - 1,
    valueAt: (i) => (i >= 0 && i < loaded.length ? [loaded[i], 10, 11, 9, 10, 100] : null),
    size: () => loaded.length,
  };
  const chart = {
    _chartWidget: { model: () => ({
      mainSeries: () => ({ bars: () => bars, requestMoreDataAvailable: () => false, requestMoreData: () => {} }),
      timeScale: () => ({ zoomToBarsRange: (a, b) => zoom.push([a, b]) }),
    }) },
    getVisibleRange: () => visibleRange ?? (zoom.length
      ? { from: loaded[zoom.at(-1)[0]], to: loaded[zoom.at(-1)[1]] }
      : { from: 0, to: 0 }),
    symbol: () => symbol,
    resolution: () => resolution,
    chartType: () => 1,
    setResolution: () => {},
    setSymbol: () => {},
  };
  const win = { TradingViewApi: { _activeChartWidgetWV: { value: () => chart } } };
  const evaluate = async (expr) => new Function('window', 'document', `return (${expr});`)(win, {});
  return { zoom, evaluate, _deps: { evaluate } };
}

// A trade far away from the newest loaded bars — the situation the product exists for.
const TRADE = 1_700_000_000;
const barsAround = (start, n, step = MIN) => Array.from({ length: n }, (_, i) => start + i * step);

describe('C1 — bar data is bound to the caller\'s window, or refused', () => {
  it('a historical window returns bars FROM that window, never the newest ones', async () => {
    // 300 one-minute bars starting at the trade: the trade sits at the far left,
    // the newest bar is ~5 hours later. Answering with the newest bars would be
    // a silent semantic substitution — the caller asked about the trade.
    const w = world(barsAround(TRADE, 300));
    const res = await getOhlcv({ from: TRADE, to: TRADE + 5 * MIN, summary: false, _deps: w._deps });
    assert.equal(res.success, true);
    const times = res.bars.map(b => b.time);
    assert.ok(times.length > 0, 'the window is covered by loaded bars, so it must return them');
    for (const t of times) {
      assert.ok(t >= TRADE && t <= TRADE + 5 * MIN, `bar ${t} is outside the requested window`);
    }
    assert.ok(times.includes(TRADE), "the trade's own bar must be present");
  });

  it('a window with NO loaded bars is a structured refusal, never a fallback to latest', async () => {
    const w = world(barsAround(TRADE, 300));
    await assert.rejects(
      () => getOhlcv({ from: TRADE - 30 * 86400, to: TRADE - 29 * 86400, summary: false, _deps: w._deps }),
      /no loaded bars|not covered|outside/i,
      'answering with the newest bars would be a silent substitution',
    );
  });

  it('from/to must be given TOGETHER — half a window is a caller error, not a guess', async () => {
    const w = world(barsAround(TRADE, 10));
    await assert.rejects(() => getOhlcv({ from: TRADE, _deps: w._deps }), /both|together/i);
    await assert.rejects(() => getOhlcv({ to: TRADE, _deps: w._deps }), /both|together/i);
    await assert.rejects(() => getOhlcv({ from: TRADE + 60, to: TRADE, _deps: w._deps }), /greater/i);
  });

  it('the latest-bars mode is PRESERVED — omitting the window is not an error', async () => {
    // A correctness fix must not become a breaking API change.
    const w = world(barsAround(TRADE, 300));
    const res = await getOhlcv({ count: 5, summary: false, _deps: w._deps });
    assert.equal(res.success, true);
    assert.equal(res.bars.length, 5);
    assert.equal(res.bars.at(-1).time, TRADE + 299 * MIN, 'latest mode still returns the newest bars');
  });
});

describe('C2/C4 — success means an OBSERVED containment, and nothing is substituted', () => {
  it('a zoom whose read-back range does not contain the request is NOT success', async () => {
    const w = world([1000, 2000, 3000], { visibleRange: { from: 999999, to: 999999 } });
    const res = await setVisibleRange({ from: 1500, to: 2500, _deps: w._deps });
    assert.equal(res.success, false, 'a read-back nowhere near the request cannot be a success');
  });

  it('a window entirely outside loaded data is refused, not answered with the nearest bars', async () => {
    const w = world([5000, 6000, 7000]);
    const res = await setVisibleRange({ from: 1000, to: 2000, _deps: w._deps });
    assert.equal(res.success, false, 'the requested window is not on the chart');
    assert.equal(w.zoom.length, 0, 'and nothing may be zoomed to as a substitute for it');
  });

  it('an achieved zoom IS success (the contract must not be vacuously false)', async () => {
    const w = world([1000, 2000, 3000, 4000]);
    const res = await setVisibleRange({ from: 2000, to: 3000, _deps: w._deps });
    assert.equal(res.success, true);
    assert.ok(res.actual.from <= 2000 && res.actual.to >= 3000, 'the observed range contains the request');
  });
});

describe('C3 — unknown stays unknown, and epoch 0 stays a real timestamp', () => {
  it('a null endpoint is reported as null, not masked to 0', async () => {
    const w = world([1000, 2000, 3000], { visibleRange: { from: null, to: 4000 } });
    const res = await setVisibleRange({ from: 1500, to: 2500, _deps: w._deps });
    assert.equal(res.actual.from, null, '0 would be indistinguishable from a real epoch');
    assert.equal(res.success, false, 'an unreadable endpoint cannot certify the zoom');
  });

  it('an unreadable range is not success', async () => {
    const w = world([1000, 2000, 3000], { visibleRange: { from: 'x', to: undefined } });
    const res = await setVisibleRange({ from: 1500, to: 2500, _deps: w._deps });
    assert.equal(res.success, false);
    assert.equal(res.actual.from, null);
    assert.equal(res.actual.to, null);
  });

  it('a genuine range AT epoch 0 is still a legal, reported value', async () => {
    // The fix must not trade one masking bug for another: 0 is a valid instant.
    const w = world([0, 1000, 2000], { visibleRange: { from: 0, to: 2000 } });
    const res = await setVisibleRange({ from: 0, to: 2000, _deps: w._deps });
    assert.equal(res.actual.from, 0, 'epoch 0 must survive as itself');
    assert.equal(res.success, true);
  });
});

describe('C5 — readiness verifies the identity it was asked about', () => {
  it('a chart still on the old resolution is NOT ready for the requested one', async () => {
    const w = world([1000, 2000, 3000], { resolution: '1' });
    const ready = await waitForChartReady(null, '60', 300, w.evaluate);
    assert.equal(ready, false, 'expectedTf was passed and must actually be checked');
  });

  it('a chart on the requested resolution IS ready', async () => {
    const w = world([1000, 2000, 3000], { resolution: '60' });
    const ready = await waitForChartReady(null, '60', 2000, w.evaluate);
    assert.equal(ready, true);
  });

  it('setTimeframe surfaces the unconfirmed switch through chart_ready', async () => {
    // SCOPE NOTE. C5 is about readiness verifying the identity it was given, and
    // that is what this asserts. Whether `success` itself should become false
    // when chart_ready is false is a DIFFERENT clause (achievement semantics for
    // setSymbol/setTimeframe) and is deliberately not decided here.
    //
    // It is worth recording that this contract makes the gap more visible rather
    // than less: before C5, readiness ignored expectedTf and so usually returned
    // true, hiding the disagreement. Now a genuinely unconfirmed switch reports
    // chart_ready:false while success stays true — awaiting adjudication of
    // whose domain that belongs to.
    const w = world([1000, 2000, 3000], { resolution: '1' });
    const res = await setTimeframe({
      timeframe: '60',
      _deps: { evaluate: w.evaluate, waitForChartReady: async () => false },
    });
    assert.equal(res.chart_ready, false, 'the unconfirmed switch must be visible to the caller');
  });

  it('the symbol check is exact, not a substring match', async () => {
    // 'AAPL' must not satisfy a request for a different ticker that contains it.
    const w = world([1000, 2000, 3000], { symbol: 'NASDAQ:AAPL' });
    assert.equal(await waitForChartReady('NASDAQ:AAPL', null, 2000, w.evaluate), true);
    assert.equal(await waitForChartReady('NASDAQ:AAP', null, 300, w.evaluate), false,
      'a prefix of the current symbol is not the requested symbol');
  });
});
