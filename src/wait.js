import { evaluate as _evaluate, KNOWN_PATHS } from './connection.js';

const CHART_API = KNOWN_PATHS.chartApi;

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

// Issue #2: loading is present iff at least one candidate matching any
// supported loading selector is observably visible. The previous first-match
// querySelector chain let a hidden candidate mask a visible one (across
// selectors, and equally within a single selector), and `offsetParent !== null`
// misreads visible position:fixed overlays as hidden. The selector set itself
// is unchanged. Exported so tests can pin that BOTH wait functions embed this
// exact primitive rather than re-growing private copies.
export const LOADING_PROBE_JS = `
  (function() {
    var sels = ['[class*="loader"]', '[class*="loading"]', '[data-name="loading"]'];
    function visible(el) {
      if (typeof el.checkVisibility === 'function') {
        // Older Chromium spells these options checkVisibilityCSS/checkOpacity;
        // the current spec spells them visibilityProperty/opacityProperty.
        // Unknown dictionary members are ignored, so pass both generations.
        return el.checkVisibility({
          visibilityProperty: true, opacityProperty: true,
          checkVisibilityCSS: true, checkOpacity: true
        });
      }
      if (el.getClientRects().length === 0) return false;
      // visibility is resolved AT the element: the computed value already
      // carries both inheritance and descendant override, so a
      // visibility:visible child inside a visibility:hidden ancestor is
      // painted and must count. Scanning ancestors for visibility would
      // wrongly hide exactly that case (cross-model review finding).
      var vis = getComputedStyle(el).visibility;
      if (vis === 'hidden' || vis === 'collapse') return false;
      // opacity composites (an ancestor's 0 hides descendants regardless of
      // their own value) and a content-visibility:hidden ancestor skips the
      // subtree while children still report client rects (measured), so BOTH
      // must be ancestor-scanned; display:none anywhere already implies no
      // rects, the explicit check is belt-and-braces.
      for (var n = el; n; n = n.parentElement) {
        var cs = getComputedStyle(n);
        if (cs.display === 'none' || parseFloat(cs.opacity) === 0
          || cs.contentVisibility === 'hidden') return false;
      }
      return true;
    }
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i]);
      for (var j = 0; j < nodes.length; j++) {
        if (visible(nodes[j])) return true;
      }
    }
    return false;
  })()
`;

// Issue #5: the identity comparison accepts exactly the canonicalization
// measured on a live TradingView Desktop session (3.3.0, 2026-08-22) and
// nothing broader. Measured ground truth: chart.symbol() always returns
// EXCHANGE:TICKER — a bare requested ticker is exchange-qualified by data
// routing, and even an explicitly requested exchange can be substituted by
// data entitlement (NASDAQ:AAPL -> BATS:AAPL on a Cboe-fed account);
// chart.resolution() reports daily/weekly/monthly as 1D/1W/1M while minute
// forms round-trip verbatim, and canonical forms are fixed points.
// Owner-adjudicated matcher contract:
//   - a BARE symbol request matches an authoritative EXCHANGE:TICKER iff the
//     ticker part is an exact case-insensitive match;
//   - an exchange-QUALIFIED request keeps full-identity exactness — a
//     data-plan substitution stays an HONEST chart_ready:false, never
//     quietly widened away, and no data-plan normalizer is invented;
//   - D === 1D, W === 1W, M === 1M, one way only (requested alias ->
//     canonical); minutes stay exact; no generalized prefix add/strip.
// Exported so tests can pin the exact matrix.
const TIMEFRAME_CANONICAL = new Map([['D', '1D'], ['W', '1W'], ['M', '1M']]);

export function symbolMatches(requested, actual) {
  const req = String(requested).toUpperCase();
  const act = String(actual ?? '').toUpperCase();
  if (req === act) return true;
  if (!req.includes(':')) {
    // The measured authoritative form is EXCHANGE:TICKER (single colon):
    // compare the part after the first colon, so a bare request matches its
    // own ticker under any exchange — and nothing else.
    const sep = act.indexOf(':');
    if (sep > 0 && act.slice(sep + 1) === req) return true;
  }
  return false;
}

export function resolutionMatches(requested, actual) {
  const req = String(requested).toUpperCase();
  const act = String(actual ?? '').toUpperCase();
  if (req === act) return true;
  return TIMEFRAME_CANONICAL.get(req) === act;
}

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT, evaluate = _evaluate) {
  const start = Date.now();
  let lastBarCount = -1;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    // Read the AUTHORITATIVE state: the chart API's own symbol()/resolution(),
    // the same source chart_get_state reports. The previous version scraped the
    // DOM legend for a symbol and counted `[class*="bar"]` elements, and never
    // looked at the resolution at all — so setTimeframe could report ready while
    // the chart was still on the old one (contract C5).
    const state = await evaluate(`
      (function() {
        var out = { loading: false, symbol: null, resolution: null, barCount: -1 };
        try {
          out.loading = ${LOADING_PROBE_JS};
        } catch (e) {}
        try {
          var chart = ${CHART_API};
          var sym = chart.symbol();
          if (typeof sym === 'string') out.symbol = sym;
          var res = chart.resolution();
          if (res !== null && res !== undefined) out.resolution = String(res);
          out.barCount = chart._chartWidget.model().mainSeries().bars().size();
        } catch (e) {}
        return out;
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Not ready if still loading
    if (state.loading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Identity must MATCH, not merely contain: a substring test let a request
    // for one ticker be satisfied by a different one that contains it. The
    // matcher accepts exactly the measured canonical aliases and nothing
    // broader — see symbolMatches/resolutionMatches above (issue #5).
    if (expectedSymbol && !symbolMatches(expectedSymbol, state.symbol)) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }
    // The resolution was passed in and must actually be verified (C5).
    if (expectedTf && !resolutionMatches(expectedTf, state.resolution)) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check bar count stability
    if (state.barCount === lastBarCount && state.barCount > 0) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarCount = state.barCount;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timed out without ever observing the requested state.
  return false;
}

/**
 * Wait for the chart to finish (re)rendering — used before screenshots so a
 * capture right after chart_set_symbol / chart_set_timeframe doesn't grab a
 * stale frame (issue #144). Waits for any loading spinner to clear, then for
 * the symbol/resolution/canvas signature to hold stable across 3 polls.
 */
export async function waitForChartRender(timeout = 5000, evaluate = _evaluate) {
  const start = Date.now();
  let lastSignature = null;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        var canvas = document.querySelector('[data-name="pane-canvas"] canvas')
          || document.querySelector('[data-name="pane-canvas"]')
          || document.querySelector('canvas');
        var rect = canvas ? canvas.getBoundingClientRect() : null;
        var symbol = '', resolution = '';
        try {
          var chart = window.TradingViewApi._activeChartWidgetWV.value();
          symbol = chart.symbol();
          resolution = chart.resolution();
        } catch(e) {}
        var loading = ${LOADING_PROBE_JS};
        return {
          symbol: symbol,
          resolution: resolution,
          isLoading: loading,
          canvasWidth: rect ? Math.round(rect.width) : 0,
          canvasHeight: rect ? Math.round(rect.height) : 0
        };
      })()
    `);

    if (!state || state.isLoading || !state.canvasWidth || !state.canvasHeight) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    const signature = [state.symbol, state.resolution, state.canvasWidth, state.canvasHeight].join('|');
    if (signature === lastSignature) stableCount++;
    else { stableCount = 0; lastSignature = signature; }

    if (stableCount >= 3) return true;
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  return false;
}
