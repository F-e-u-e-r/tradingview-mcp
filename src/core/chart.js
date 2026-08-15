/**
 * Core chart control logic — review subset.
 * Kept: getState, setSymbol, setTimeframe, setVisibleRange.
 * chart_set_visible_range also serves as jump-to-date: it pages in older
 * history until the requested window is loaded, which the upstream
 * chart_scroll_to_date never did.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, safeString, requireFinite } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    waitForChartReady: deps?.waitForChartReady || _waitForChartReady,
  };
}

export async function getState({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const state = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var studies = [];
      try {
        var allStudies = chart.getAllStudies();
        studies = allStudies.map(function(s) {
          return { id: s.id, name: s.name || s.title || 'unknown' };
        });
      } catch(e) {}
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        chartType: chart.chartType(),
        studies: studies,
      };
    })()
  `);
  return { success: true, ...state };
}

export async function setSymbol({ symbol, _deps }) {
  const { evaluateAsync, waitForChartReady } = _resolve(_deps);
  await evaluateAsync(`
    (function() {
      var chart = ${CHART_API};
      return new Promise(function(resolve) {
        chart.setSymbol(${safeString(symbol)}, {});
        setTimeout(resolve, 500);
      });
    })()
  `);
  const ready = await waitForChartReady(symbol);
  return { success: true, symbol, chart_ready: ready };
}

export async function setTimeframe({ timeframe, _deps }) {
  const { evaluate, waitForChartReady } = _resolve(_deps);
  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      chart.setResolution(${safeString(timeframe)}, {});
    })()
  `);
  const ready = await waitForChartReady(null, timeframe);
  return { success: true, timeframe, chart_ready: ready };
}

export async function setVisibleRange({ from, to, _deps }) {
  const { evaluate } = _resolve(_deps);
  const f = requireFinite(from, 'from');
  const t = requireFinite(to, 'to');
  if (t <= f) throw new Error(`to (${t}) must be greater than from (${f})`);

  // Ensure enough history is loaded to cover `from`. The chart lazy-loads bars
  // (~300 initially), so without this a multi-year range clamps to whatever is
  // already loaded. Page back via requestMoreData until the earliest loaded bar
  // reaches `from`, the feed runs out, or a guard trips.
  for (let i = 0; i < 25; i++) {
    const state = await evaluate(`(function() {
      var ms = ${CHART_API}._chartWidget.model().mainSeries();
      var b = ms.bars(); var fv = b.valueAt(b.firstIndex());
      var more = true; try { more = ms.requestMoreDataAvailable(); } catch (e) {}
      return { firstTime: fv && fv[0], more: more };
    })()`);
    if (!state || state.firstTime == null || state.firstTime <= f || !state.more) break;
    await evaluate(`(function() { try { ${CHART_API}._chartWidget.model().mainSeries().requestMoreData(1000); } catch (e) {} })()`);
    await new Promise(r => setTimeout(r, 1800));
  }

  // Select and zoom ONLY if the loaded bars actually cover the request
  // (contract C4). Zooming to the nearest available bars would answer a
  // question the caller did not ask with data they did not request — the
  // silent substitution this contract exists to forbid.
  const sel = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = chart._chartWidget.model();
      var bars = m.mainSeries().bars();
      var startIdx = bars.firstIndex(), endIdx = bars.lastIndex();
      var fromIdx = null, toIdx = null, hasLeft = false, hasRight = false, inWindow = false;
      for (var i = startIdx; i <= endIdx; i++) {
        var v = bars.valueAt(i);
        if (!v) continue;
        if (v[0] <= ${f}) { hasLeft = true; fromIdx = i; }          // last bar at/before from
        if (v[0] >= ${t}) { hasRight = true; if (toIdx === null) toIdx = i; } // first bar at/after to
        if (v[0] >= ${f} && v[0] <= ${t}) inWindow = true;
      }
      // Covered = loaded data spans the request, or part of the request has bars.
      if (!((hasLeft && hasRight) || inWindow)) return { covered: false };
      if (fromIdx === null) fromIdx = startIdx;
      if (toIdx === null) toIdx = endIdx;
      if (toIdx < fromIdx) toIdx = fromIdx;
      m.timeScale().zoomToBarsRange(fromIdx, toIdx);
      return { covered: true, fromIdx: fromIdx, toIdx: toIdx };
    })()
  `);

  if (!sel || !sel.covered) {
    return {
      success: false,
      requested: { from, to },
      actual: { from: null, to: null },
      note: 'The requested window is not covered by the chart\'s loaded bars, so the view was left where it was rather than moved to the nearest available data. Widen the window, or load more history, then retry.',
    };
  }

  await new Promise(r => setTimeout(r, 500));
  const actual = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      try {
        var r = chart.getVisibleRange();
        // Number.isFinite, and NEVER a || 0 fallback (contract C3): epoch 0 is a
        // real instant, so masking an unreadable endpoint to 0 would make
        // "unknown" indistinguishable from a legitimate answer.
        return { from: (r && Number.isFinite(r.from)) ? r.from : null,
                 to:   (r && Number.isFinite(r.to))   ? r.to   : null };
      } catch(e) { return { from: null, to: null, error: e.message }; }
    })()
  `);

  const from_ = actual ? actual.from : null;
  const to_ = actual ? actual.to : null;
  // success = the read-back range was OBSERVED to contain the request
  // (contract C2). No cadence, no padding, no forming-bar inference: this may
  // false-NEGATIVE when the UI snaps the view, and that is the acceptable
  // direction. It must never false-positive.
  const success = Number.isFinite(from_) && Number.isFinite(to_) && from_ <= f && to_ >= t;
  const result = { success, requested: { from, to }, actual: { from: from_, to: to_ } };
  if (!success) {
    result.note = (from_ === null || to_ === null)
      ? 'The chart did not return a readable visible range, so the zoom could not be confirmed. Retry once the chart is loaded.'
      : 'The visible range the chart reported does not contain the requested window, so the zoom is unconfirmed (the view may not have moved). Retry once the chart is loaded.';
    if (actual && actual.error) result.error = actual.error;
  }
  return result;
}
