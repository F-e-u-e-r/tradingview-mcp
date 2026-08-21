/**
 * Core data access logic — review subset (OHLCV only).
 * summary defaults to TRUE in this build: reviews want compact context,
 * and raw-bar dumps are opt-in via summary=false.
 *
 * TWO EXPLICIT MODES (chart contract C1).
 *
 *   latest      — no from/to. Returns the newest `count` loaded bars. This is
 *                 the original behaviour and stays, so a correctness fix does
 *                 not become a breaking API change.
 *   historical  — from AND to, both present and valid. Returns only bars inside
 *                 that window.
 *
 * The historical mode exists because the product's whole purpose is reviewing a
 * PAST trade, and the latest mode cannot answer that: it returns the newest
 * bars no matter where the chart was navigated, so a caller reviewing a trade
 * from last Tuesday silently received this afternoon's prices. That is a silent
 * semantic substitution, which is worse than refusing.
 *
 * So the historical mode never falls back: bars come from the window, or the
 * call fails with a structured reason. It also does not widen the window on the
 * caller's behalf — a caller who wants context around a trade passes a wider
 * from/to. Guessing here is exactly what produced the bug.
 */
import { evaluate as _evaluate, KNOWN_PATHS } from '../connection.js';

const MAX_OHLCV_BARS = 500;

// Round to 8 dp — enough to kill float noise (29899.999999997 → 29900) without
// destroying precision on forex/crypto prices (upstream issue #77).
const roundPrice = (v) => (v == null ? null : Math.round(v * 1e8) / 1e8);
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

export async function getOhlcv({ count, summary = true, from, to, _deps } = {}) {
  // Injection seam, same shape the other core modules already use. It carries no
  // capability of its own: production passes nothing and gets connection.js's
  // narrow evaluate().
  const evaluate = _deps?.evaluate || _evaluate;
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);

  // IH2 (issue #3): presence and representation are decided SEPARATELY, and
  // only OMISSION (undefined) selects the latest mode. A supplied value must
  // be an integer or an unambiguous integer string — generic coercion invented
  // epochs here (Number('') and Number(false) are 0, Number(true) is 1) and an
  // explicit {from:null, to:null} silently became a latest-mode call. Epoch 0
  // stays a real timestamp. Deliberately NOT connection.js's requireFinite:
  // that helper answers finiteness of a number it is handed, not whether the
  // caller's representation was temporal to begin with.
  const parseUnixSeconds = (v, name) => {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
    throw new Error(`${name} must be an integer unix-seconds timestamp (or an integer string), got: ${JSON.stringify(v)}`);
  };

  // A half-window is a caller error, not something to infer.
  let f = null, t = null;
  if (from !== undefined || to !== undefined) {
    if (from === undefined || to === undefined) {
      throw new Error('Provide both from and to (unix seconds), or neither. A half-open window cannot be answered.');
    }
    f = parseUnixSeconds(from, 'from');
    t = parseUnixSeconds(to, 'to');
    if (t <= f) throw new Error(`to (${t}) must be greater than from (${f})`);
  }
  const windowed = f !== null;
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var first = bars.firstIndex(), end = bars.lastIndex();
        var windowed = ${windowed ? 'true' : 'false'};
        var result = [], truncated = false;
        var mk = function(v) { return {time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0}; };
        if (windowed) {
          // Membership only. No enclosing-bar rule and no widening: a bar is in
          // the answer if it is in the window the caller asked for.
          for (var i = first; i <= end; i++) {
            var v = bars.valueAt(i);
            if (!v) continue;
            if (v[0] >= ${f} && v[0] <= ${t}) result.push(mk(v));
          }
          if (result.length > ${limit}) {
            // Keep the START of the window: the trade being reviewed is usually
            // at its left edge, so dropping from the front would discard the
            // very bar the caller asked about.
            result = result.slice(0, ${limit});
            truncated = true;
          }
        } else {
          var start = Math.max(first, end - ${limit} + 1);
          for (var j = start; j <= end; j++) {
            var w = bars.valueAt(j);
            if (w) result.push(mk(w));
          }
        }
        return {bars: result, total_bars: bars.size(), truncated: truncated, source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }
  if (data.bars.length === 0) {
    if (windowed) {
      // The refusal IS the feature. Returning the newest bars here is the
      // silent substitution this mode exists to prevent.
      throw new Error(`No loaded bars fall within [${f}, ${t}] — the requested window is outside the chart's loaded history. Call chart_set_visible_range for that window first so the chart pages it in, then retry.`);
    }
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, mode: windowed ? 'window' : 'latest',
      ...(windowed ? { requested_window: { from: f, to: t } } : {}),
      ...(data.truncated ? { truncated: true } : {}),
      bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: roundPrice(Math.max(...highs) - Math.min(...lows)),
      change: roundPrice(last.close - first.open),
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  const base = { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
  if (windowed) {
    base.mode = 'window';
    base.requested_window = { from: f, to: t };
    if (data.truncated) {
      base.truncated = true;
      base.note = `More than ${limit} bars fall inside the requested window; returned the first ${limit} from its start. Narrow the window or raise count.`;
    }
  } else {
    base.mode = 'latest';
  }
  return base;
}
