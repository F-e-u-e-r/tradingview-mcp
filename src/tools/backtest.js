import { z } from 'zod';
import { jsonResult } from './_format.js';
import { unixSeconds } from './_temporal.js';
import * as core from '../core/backtest.js';

/**
 * BT5 (contract ratified 2026-08-24 @ 35a31c52, merged ab85e472): ONE curated
 * tool exposing the CLOSED BT1–BT4 simulation pipeline over the SAME validated
 * OHLCV source data_get_ohlcv serves — no new acquisition path, no bar-cap
 * change, no trading capability.
 *
 * Named data_compute_backtest, continuing the repo's split: `get` is
 * authoritative/source retrieval, `compute` is local deterministic
 * computation over validated data. Upstream's dropped
 * `data_get_strategy_results` / `data_get_trades` / `data_get_equity` stay on
 * the denylist and are NOT being reintroduced under a new name — the served
 * description says so in words a caller cannot miss, because the served
 * surface is the public contract.
 *
 * Registered STRICT for the same measured reason as data_get_ohlcv and
 * data_compute_indicator: {from,to} PRESENCE selects the window mode, so
 * unknown-key stripping would silently flip a historical request into a
 * latest-mode call (issue-#3 class). Unknown keys are a fast -32602 refusal
 * via registerTool + z.strictObject.
 *
 * The strategy surface is a NESTED STRICT DISCRIMINATED object (D2a): the
 * type and its parameters are one object, so a parameter belonging to the
 * other strategy is structurally refused rather than being carried as a
 * top-level field some runtime policy then has to ignore. Silent-ignore is
 * exactly the failure mode the ruling forbids.
 *
 * The three cost parameters are REQUIRED, not defaulted: BT2 §3 forbids
 * silent defaults ("a zero-cost run states its zeros"), so a default invented
 * here would be this layer manufacturing an assumption the caller never made.
 */
// _deps follows the repo's standard injection seam one layer up: tests hand a
// stubbed getOhlcv THROUGH the real registered handler so the full MCP seam
// (SDK validation -> handler destructuring -> core -> jsonResult) is the
// tested path; production (server.js) passes nothing and gets the real
// core/data acquisition. The seam carries no capability of its own.
export function registerBacktestTools(server, _deps) {
  server.registerTool('data_compute_backtest', {
    description: 'Run a deterministic strategy simulation over the SAME validated OHLCV bars data_get_ohlcv serves. SIMULATION ONLY — this tool does not place, submit, modify, replay, or retrieve real trades or orders; every execution, trade, and equity figure it returns is simulated from local computation over chart bars. TWO MODES, inherited unchanged: pass from+to (unix seconds) to simulate over THAT historical window, or omit both for the newest `count` bars (max 500). `strategy` is one nested object carrying its own parameters: {type:"donchian", period} or {type:"sma_crossover", fastPeriod, slowPeriod} with fastPeriod < slowPeriod — a parameter belonging to the other strategy is refused, never ignored. `initialCash`, `commissionRate` and `slippageRate` are REQUIRED and are reported back as applied: a zero-cost run states its zeros rather than hiding them. Execution model: a signal is produced on a COMPLETED bar and fills at the next bar\'s raw open; long-only, one position, no pyramiding, and an open position at the end is reported, never force-closed. A terminal bar whose completion cannot be proven from the same data snapshot is EXCLUDED from evaluation and the exclusion is reported in source.excluded_incomplete_terminal_bars — completion is established from data (a later bar in the same snapshot), never from a clock. The response is three blocks: `source` (what was read — symbol, resolution, window, bars acquired vs used, the completion basis), `assumptions` (what was assumed — strategy, execution model, costs, position rules), and `result` (executions, closed trades, terminal open position, pending terminal signal, accounting and metrics).',
    inputSchema: z.strictObject({
      strategy: z.discriminatedUnion('type', [
        z.strictObject({
          type: z.literal('donchian'),
          period: z.number().int().min(1).describe('Donchian channel period — a positive-integer JSON number; never coerced, no default'),
        }),
        z.strictObject({
          type: z.literal('sma_crossover'),
          fastPeriod: z.number().int().min(1).describe('Fast SMA period — a positive-integer JSON number, strictly less than slowPeriod'),
          slowPeriod: z.number().int().min(1).describe('Slow SMA period — a positive-integer JSON number, strictly greater than fastPeriod'),
        }),
      ]).describe('The strategy and its parameters, as ONE object. V1 supports exactly donchian and sma_crossover; any other type, or a parameter belonging to the other strategy, is refused before any chart access.'),
      initialCash: z.number().positive().describe('Starting cash — a finite number > 0. REQUIRED: no default is invented for you.'),
      commissionRate: z.number().min(0).lt(1).describe('Commission rate per side, in [0, 1). REQUIRED — pass 0 for a zero-commission run.'),
      slippageRate: z.number().min(0).lt(1).describe('Slippage rate per side, in [0, 1). REQUIRED — pass 0 for a zero-slippage run.'),
      count: z.coerce.number().int().min(1).max(500).optional().describe('Number of bars to consider (max 500, default 100)'),
      from: unixSeconds.optional().describe('Start of window (unix seconds) — provide with `to`, or neither'),
      to: unixSeconds.optional().describe('End of window (unix seconds) — provide with `from`, or neither'),
    }),
  }, async ({ strategy, initialCash, commissionRate, slippageRate, count, from, to }) => {
    try {
      return jsonResult(await core.computeBacktest({
        strategy, initialCash, commissionRate, slippageRate, count, from, to, _deps,
      }));
    } catch (err) {
      // Transparent transport (D7a): a CLOSED-kernel typed error reaches the
      // caller with its own wording. No BT5 prefix, no stacking.
      return jsonResult({ success: false, error: err.message }, true);
    }
  });
}
