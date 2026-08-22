// Issue #5 — identity canonicalization matcher (owner-adjudicated contract,
// measured on live TradingView Desktop 3.3.0, 2026-08-22).
//
// The comparison accepts exactly the measured canonical aliases and nothing
// broader: a bare symbol request matches an authoritative EXCHANGE:TICKER iff
// the ticker part is an exact case-insensitive match; a qualified request
// keeps full-identity exactness (a data-plan substitution such as
// NASDAQ:AAPL -> BATS:AAPL stays an honest false); D/W/M are equivalent only
// to 1D/1W/1M, one way; minutes stay exact. The served enum is unchanged.
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolMatches, resolutionMatches, waitForChartReady } from '../src/wait.js';

describe('symbolMatches — the adjudicated matrix', () => {
  // The five binding examples from the adjudication, verbatim:
  it('AAPL ↔ BATS:AAPL → match (bare request, exchange-qualified truth)', () => {
    assert.equal(symbolMatches('AAPL', 'BATS:AAPL'), true);
  });
  it('BTCUSD ↔ BITSTAMP:BTCUSD → match', () => {
    assert.equal(symbolMatches('BTCUSD', 'BITSTAMP:BTCUSD'), true);
  });
  it('NASDAQ:AAPL ↔ NASDAQ:AAPL → match', () => {
    assert.equal(symbolMatches('NASDAQ:AAPL', 'NASDAQ:AAPL'), true);
  });
  it('NASDAQ:AAPL ↔ BATS:AAPL → NOT match (qualified stays full-identity exact)', () => {
    assert.equal(symbolMatches('NASDAQ:AAPL', 'BATS:AAPL'), false);
  });
  it('AAPL ↔ BATS:MSFT → NOT match (ticker part must be exact)', () => {
    assert.equal(symbolMatches('AAPL', 'BATS:MSFT'), false);
  });

  it('exact bare-to-bare and case-insensitivity hold', () => {
    assert.equal(symbolMatches('AAPL', 'AAPL'), true);
    assert.equal(symbolMatches('aapl', 'BATS:AAPL'), true);
    assert.equal(symbolMatches('nasdaq:aapl', 'NASDAQ:AAPL'), true);
  });
  it('substring is NOT identity (pre-existing rule preserved)', () => {
    assert.equal(symbolMatches('AAPL', 'BATS:AAPL2'), false);
    assert.equal(symbolMatches('AAPL2', 'BATS:AAPL'), false);
    assert.equal(symbolMatches('TSLA', 'BATS:AAPL'), false);
  });
  it('a qualified request never matches a bare truth', () => {
    assert.equal(symbolMatches('BATS:AAPL', 'AAPL'), false);
  });
  it('degenerate truths fail closed', () => {
    assert.equal(symbolMatches('AAPL', null), false);
    assert.equal(symbolMatches('AAPL', undefined), false);
    assert.equal(symbolMatches('AAPL', ''), false);
    assert.equal(symbolMatches('AAPL', ':AAPL'), false, 'empty exchange part is not the measured EXCHANGE:TICKER form');
  });
  it('degenerate REQUESTS fail closed — coercion artifacts never match', () => {
    assert.equal(symbolMatches(null, 'NULL'), false, 'String(null) must not become a matchable identity');
    assert.equal(symbolMatches(undefined, 'UNDEFINED'), false);
    assert.equal(symbolMatches('', ''), false);
    assert.equal(symbolMatches('', 'BATS:'), false, 'an empty request must not match an empty ticker part');
    assert.equal(symbolMatches(42, '42'), false);
    assert.equal(resolutionMatches(null, 'NULL'), false);
    assert.equal(resolutionMatches('', ''), false);
  });
  it('multi-colon truths: the bare-request branch stays conservative', () => {
    assert.equal(symbolMatches('C', 'A:B:C'), false, 'ticker part is everything after the FIRST colon');
    assert.equal(symbolMatches('B:C', 'A:B:C'), false, 'a colon in the request means full-identity exactness');
  });
  it('exact equality on out-of-grammar shapes is the unchanged pre-#5 semantics (adjudicated disposition, pinned)', () => {
    // If the authoritative chart reports exactly the requested identity, the
    // chart is on what was asked for. Shape validation here was reviewed and
    // rejected-with-reason: it would turn an honestly reached identity into
    // never-ready, and the adjudication adds measured aliases only — it does
    // not add a grammar gate to the pre-existing equality path.
    assert.equal(symbolMatches(':AAPL', ':AAPL'), true);
    assert.equal(symbolMatches('BATS:AAPL:EXTRA', 'BATS:AAPL:EXTRA'), true);
  });
});

describe('resolutionMatches — D/W/M aliases only, one way; minutes exact', () => {
  it('D ≡ 1D, W ≡ 1W, M ≡ 1M', () => {
    assert.equal(resolutionMatches('D', '1D'), true);
    assert.equal(resolutionMatches('W', '1W'), true);
    assert.equal(resolutionMatches('M', '1M'), true);
  });
  it('canonical forms are fixed points', () => {
    assert.equal(resolutionMatches('1D', '1D'), true);
    assert.equal(resolutionMatches('1W', '1W'), true);
    assert.equal(resolutionMatches('1M', '1M'), true);
  });
  it('minutes remain exact', () => {
    assert.equal(resolutionMatches('60', '60'), true);
    assert.equal(resolutionMatches('120', '120'), true);
    assert.equal(resolutionMatches('60', '1h'), false, 'unmeasured aliases are not invented');
    assert.equal(resolutionMatches('60', '1D'), false);
  });
  it('the alias runs ONE way — no generalized prefix handling', () => {
    assert.equal(resolutionMatches('1D', 'D'), false, 'canonical requested, alias truth: not a measured state');
    assert.equal(resolutionMatches('D', 'D'), true, 'exact equality still holds');
    assert.equal(resolutionMatches('D', '2D'), false);
    assert.equal(resolutionMatches('3D', 'D'), false);
    assert.equal(resolutionMatches('D', '1W'), false);
  });
  it('case-insensitive; degenerate truths fail closed', () => {
    assert.equal(resolutionMatches('d', '1D'), true);
    assert.equal(resolutionMatches('D', null), false);
    assert.equal(resolutionMatches('D', ''), false);
  });
  it('prototype names are not aliases', () => {
    assert.equal(resolutionMatches('constructor', '1D'), false);
    assert.equal(resolutionMatches('toString', '1D'), false);
  });
});

// Integration: the REAL waitForChartReady loop against a canonical-form chart
// state — the measured live shape that motivated this issue.
function readyEvaluateFor(state) {
  return async () => ({ loading: false, barCount: 300, ...state });
}

test('waitForChartReady: bare symbol request is ready on the exchange-qualified truth', async () => {
  const ready = await waitForChartReady('AAPL', null, 2000, readyEvaluateFor({ symbol: 'BATS:AAPL', resolution: '120' }));
  assert.equal(ready, true);
});

test('waitForChartReady: served D request is ready on the canonical 1D truth', async () => {
  const ready = await waitForChartReady(null, 'D', 2000, readyEvaluateFor({ symbol: 'BATS:AAPL', resolution: '1D' }));
  assert.equal(ready, true);
});

test('waitForChartReady: a data-plan substitution stays an honest NOT-ready', async () => {
  const ready = await waitForChartReady('NASDAQ:AAPL', null, 300, readyEvaluateFor({ symbol: 'BATS:AAPL', resolution: '120' }));
  assert.equal(ready, false);
});

test('waitForChartReady: a different ticker is still NOT ready for a bare request', async () => {
  const ready = await waitForChartReady('AAPL', null, 300, readyEvaluateFor({ symbol: 'BATS:MSFT', resolution: '120' }));
  assert.equal(ready, false);
});
