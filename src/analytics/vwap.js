/**
 * VWAP kernel (issue #16) — window-relative volume-weighted average price.
 *
 * ADJACENT to the A1 indicator kernel, never an amendment of it (owner
 * ruling D1, 2026-08-23): src/analytics/indicators.js is A1-CLOSED and
 * sha-pinned by both the A2 invariants and the BT1 kernel suite, so this
 * kernel lives in its own module and imports NOTHING. Same zero-capability
 * invariants as A1: no MCP registration, no CDP, no network, no
 * filesystem, no process/env access, no mutable module state, no clock,
 * no randomness; deterministic inputs → outputs; the input arrays are
 * never mutated. Owner-specified semantics (issue #16) — NOT donor-ported.
 *
 * SEMANTICS (issue #16, decided): the running Σ(hlc3 × volume) / Σ(volume)
 * accumulated from the FIRST bar of the supplied window — the caller
 * chooses the anchor by choosing the window. This is WINDOW-RELATIVE VWAP:
 * no session/reset semantics are implied or performed here, and no
 * timeframe is ever inferred from the data (the 1-minute canonical-input
 * rule is enforced by core/analytics against the same-snapshot
 * authoritative chart resolution — owner ruling D2 — never guessed from
 * bar spacing).
 *
 * Unlike sma/ema/rsi/atr there is NO warm-up: the series is defined at the
 * first bar (it equals that bar's hlc3 when its volume is positive). A
 * point where the CUMULATIVE volume is still zero is null — undefined, not
 * 0 (issue #16: a silent 0 would be a wrong value, not a missing one).
 * Because volumes are validated non-negative, the cumulative volume is
 * non-decreasing and the null set is always a PREFIX: an interior bar with
 * zero volume contributes nothing and the value repeats.
 *
 * Values are RAW doubles evaluated in the written order (the A2
 * transparent-transport rule); like the A1 kernels this module adds no
 * GENERAL overflow/finiteness policy on prices — the owner's 2026-08-23
 * disposition records that as outside issue #16's bounded edge contract
 * (BT2's guard doctrine is accounting-specific, not an indicator-kernel
 * rule). Exactly TWO narrow guards exist, each admitted under that
 * disposition's carve-out by executable proof of a binding output-
 * invariant violation: the subnormal-contribution guard (a contribution
 * inside the subnormal gap quantizes with unbounded relative error —
 * dropout to 0, r2 Luna F1; interior quantization [2] for hlc3 1.5, r3
 * Sol F1) and the cumulative-sum finiteness guard (overflow to Infinity
 * serializes as JSON null while the null count claims zero — r2 Sol F1;
 * both sums guarded, r3). A zero-volume bar's prices are never read at
 * all (r3 Sol F2 — Infinity × 0 = NaN must not poison the sums; the
 * zero-volume semantics promise the bar contributes NOTHING). Nothing
 * else is guarded.
 *
 * DEFERRED (owner ruling D3 — recorded as binding on future work, not
 * implemented here): higher-timeframe VWAP, if later added, MUST aggregate
 * the canonical 1-minute weighted-value and volume contributions; it MUST
 * NOT recompute VWAP from higher-timeframe aggregated OHLC.
 */

// Smallest NORMAL double (2^-1022). Contributions below this line live in
// the subnormal gap, where relative quantization error is unbounded — the
// admitted guard in vwap() refuses them rather than misweighting silently.
const MIN_NORMAL = 2.2250738585072014e-308;

function requireEqualLengths(name, columns) {
  const n = columns[0].length;
  for (const col of columns) {
    if (col.length !== n) {
      throw new Error(`${name}: input columns must have equal lengths`);
    }
  }
}

/**
 * Window-relative VWAP over aligned OHLCV columns.
 *
 * vwap[i] = Σ_{j≤i}(hlc3_j × volume_j) / Σ_{j≤i}(volume_j) with
 * hlc3 = (high + low + close) / 3, or null while the cumulative volume is
 * still zero. Volumes must be non-negative numbers — a missing volume
 * column reaches this layer as all zeros via the validated OHLCV
 * boundary's `v[5] || 0` coercion, so a window whose TOTAL volume is zero
 * is refused loudly rather than answered with an all-null series that
 * reads as a computed result for a feed carrying no volume at all.
 */
export function vwap(highs, lows, closes, volumes) {
  requireEqualLengths('vwap', [highs, lows, closes, volumes]);
  const result = new Array(closes.length).fill(null);
  let cumWeighted = 0;
  let cumVolume = 0;
  for (let i = 0; i < closes.length; i++) {
    const volume = volumes[i];
    if (typeof volume !== 'number' || !(volume >= 0)) {
      throw new Error(`vwap: volume must be a non-negative number, got: ${volume} (index ${i})`);
    }
    // A zero-volume bar contributes NOTHING — its prices are never even
    // read (r3 Sol F2, same admission as the guards below: an extreme
    // price on a volume-0 bar must not poison the sums through
    // Infinity × 0 = NaN; the point stays null or repeats the prior
    // value, exactly as the zero-volume semantics promise).
    if (volume > 0) {
      const hlc3 = (highs[i] + lows[i] + closes[i]) / 3;
      const contribution = hlc3 * volume;
      // Subnormal-contribution guard (r2 Luna F1, GENERALIZED by r3 Sol
      // F1, each admitted under the owner's overflow disposition by
      // executable proof): a nonzero contribution inside the subnormal
      // gap carries unbounded relative quantization error — volume
      // Number.MIN_VALUE at hlc3 0.5 dropped to 0 (r2), and at hlc3 1.5
      // it rounded to 2×MIN_VALUE, answering [2] where the contract
      // requires the first bar to equal its hlc3 (r3). Below the normal
      // range the weighted sum cannot be faithful — fail loud.
      if (hlc3 !== 0 && Math.abs(contribution) < MIN_NORMAL) {
        throw new Error(`vwap: contribution is below the normal floating-point range (hlc3 ${hlc3} × volume ${volume} = ${contribution}, index ${i}) — subnormal quantization would silently misweight the average`);
      }
      cumWeighted += contribution;
      cumVolume += volume;
      // Overflow twin (r2 Sol F1, same admission): 2 × Number.MAX_VALUE
      // overflows the weighted sum to Infinity, the emitted value
      // serializes to JSON null, and the response would still claim
      // zero_volume_nulls_total: 0 — a silently ABSENT value this time.
      // Both sums are guarded: a cumVolume overflow alone would emit a
      // silently wrong 0 (finite ÷ Infinity).
      if (!Number.isFinite(cumWeighted) || !Number.isFinite(cumVolume)) {
        throw new Error(`vwap: cumulative sums are no longer finite (Σweighted ${cumWeighted}, Σvolume ${cumVolume}, index ${i}) — the average cannot be represented faithfully`);
      }
    }
    if (cumVolume > 0) result[i] = cumWeighted / cumVolume;
  }
  if (closes.length > 0 && cumVolume === 0) {
    throw new Error('vwap: cumulative volume is zero across the entire window — the feed carries no volume (a missing volume column arrives as all zeros), so VWAP is undefined at every bar');
  }
  return result;
}
