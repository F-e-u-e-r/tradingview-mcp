#!/usr/bin/env node
// Deterministic synthetic OHLC series for the analytics kernel fixtures.
// Regenerating this file MUST byte-reproduce series.json (fixed seed, fixed
// rounding): both the Python donor oracle (port-fidelity vectors) and the JS
// tests consume the same JSON, so the inputs are identical on both sides.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;

// Series A — 120-bar seeded walk with periodic gap bars.
function seriesA() {
  const rnd = mulberry32(0xA1);
  const highs = []; const lows = []; const closes = [];
  let close = 100;
  for (let i = 0; i < 120; i++) {
    let drift = (rnd() - 0.5) * 0.04;
    if (i > 0 && i % 17 === 0) drift += (rnd() - 0.5) * 0.12; // gap bar
    close = close * (1 + drift);
    const range = close * 0.02;
    const h = close + range * rnd();
    const l = close - range * rnd();
    closes.push(r6(close)); highs.push(r6(h)); lows.push(r6(l));
  }
  return { highs, lows, closes };
}

// Series B — deterministic ramp / flat / ramp-down / flat tail (includes
// constant-price stretches, which exercise the RSI zero-loss branch and
// zero-range ATR bars when H=L is not forced — here H=C+1, L=C-1).
function seriesB() {
  const closes = [];
  for (let i = 0; i < 120; i++) {
    if (i < 40) closes.push(r6(100 + i * 0.5));
    else if (i < 60) closes.push(120);
    else if (i < 100) closes.push(r6(120 - (i - 60) * 0.75));
    else closes.push(90);
  }
  return {
    highs: closes.map((c) => r6(c + 1)),
    lows: closes.map((c) => r6(c - 1)),
    closes,
  };
}

const out = {
  meta: {
    purpose: 'shared deterministic inputs for donor port-fidelity vectors and JS kernel tests',
    generator: 'tests/fixtures/analytics/generate_series.mjs (mulberry32 seeds, 6dp rounding)',
  },
  A: seriesA(),
  B: seriesB(),
};

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'series.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log('series.json written:', out.A.closes.length, 'A bars,', out.B.closes.length, 'B bars');
console.log('A first/last close:', out.A.closes[0], out.A.closes.at(-1));
