import { z } from 'zod';

/**
 * A unix-seconds window bound — the ONE temporal representation policy for
 * every served tool that accepts a timestamp (issue #3). Pure validation:
 * this module must never grow CDP/network/filesystem capability.
 *
 * Deliberately NOT `z.coerce.number()`. That routes every value through
 * `Number()`, and `Number(null) === 0`, `Number('') === 0`, `Number(true) === 1`
 * — while zod's `.optional()` short-circuits only `undefined`. So a client
 * saying "not specified" the ordinary way, `from: null`, arrived at core as a
 * real timestamp: epoch 0 — and on chart_set_visible_range the invented bound
 * then drove the history-paging loop. Core's guards test for absence and could
 * never fire on an invented value.
 *
 * Two representations are accepted and no others: an integer, and a string
 * that is unambiguously one. Everything else is a caller error reported as a
 * caller error. The boundary rejects a malformed REPRESENTATION; core still
 * enforces the TEMPORAL contract (pair-or-neither, ordering, window
 * membership) — this does not move that responsibility, it stops corrupting
 * the input to it.
 */
export const unixSeconds = z.preprocess(
  (v) => (typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v),
  z.number().int(),
);
