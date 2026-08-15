/**
 * Loopback-containment gates (xcheck round 2 CRITICALs).
 *
 * These are BEHAVIORAL, run against the actually-installed chrome-remote-
 * interface + ws: the round-1/round-2 source-text checks could not see a
 * WebSocket-handshake redirect. Here a rogue server really redirects a
 * CDP connection and we assert the shipped guard refuses it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import pkg from 'ws';
import CDP from 'chrome-remote-interface';
// Importing the module APPLIES the no-redirect override to CRI's prototype, so
// the CDP() calls below exercise the shipped dial path — not a copy of it.
import {
  isLoopbackWsUrl,
  isTradingViewChartUrl,
  isLoopbackAddr,
  assertLoopbackSocket,
} from '../src/connection.js';

const WebSocketServer = pkg.Server || pkg.WebSocketServer;
const { default: CDPChromeProto } = await import('chrome-remote-interface/lib/chrome.js');
// Reject (not hang) if the sandbox blocks a loopback bind, so a failed bind
// surfaces as a test error instead of a pending before-hook (luna #14).
const listen = (server) => new Promise((res, rej) => {
  server.once('error', rej);
  server.listen(0, '127.0.0.1', () => res(server.address().port));
});

// ── isLoopbackWsUrl: parser-differential bypass (luna #1) ─────────────────

describe('isLoopbackWsUrl — canonical-literal loopback only', () => {
  it('accepts bare loopback IP literals on the pinned port', () => {
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1:9222/devtools/page/AB'), true);
    assert.equal(isLoopbackWsUrl('ws://[::1]:9222/devtools/page/AB'), true);
  });

  it('rejects `localhost` — a name, not a pinnable literal (luna #1)', () => {
    // localhost could resolve off-host via a poisoned hosts/NSS entry; we pin to
    // 127.0.0.1 and require literals, letting the socket guard backstop.
    assert.equal(isLoopbackWsUrl('ws://localhost:9222/devtools/page/AB'), false);
  });

  it('rejects octal/hex/decimal-int host forms that WHATWG normalizes but url.parse+dns.lookup do not', () => {
    // These pass a naive new URL().hostname check (all normalize to 127.0.0.1)
    // but chrome-remote-interface consumes them via legacy url.parse + dns.lookup
    // on the RAW host — a parser differential that could resolve off-host.
    for (const bad of [
      'ws://0177.0.0.1:9222/x',   // octal
      'ws://0x7f.0.0.1:9222/x',   // hex
      'ws://2130706433:9222/x',   // 32-bit int
      'ws://127.1:9222/x',        // short form
    ]) {
      assert.equal(isLoopbackWsUrl(bad), false, `${bad} must be rejected (parser differential)`);
    }
  });

  it('rejects wrong port, wrong host, non-ws scheme, and junk', () => {
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1:9223/x'), false);
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1/x'), false, 'portless is not the pinned 9222');
    assert.equal(isLoopbackWsUrl('ws://evil.example:9222/x'), false);
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1.evil.example:9222/x'), false);
    assert.equal(isLoopbackWsUrl('http://127.0.0.1:9222/x'), false);
    assert.equal(isLoopbackWsUrl(''), false);
    assert.equal(isLoopbackWsUrl(undefined), false);
    assert.equal(isLoopbackWsUrl('not a url'), false);
  });

  it('rejects leading/trailing/embedded whitespace and control chars (sol #3)', () => {
    // Both parsers strip a leading space, so " ws://127.0.0.1:9222/x" would
    // validate; CRI then fails its ^wss?: test and re-fetches /json/list by id.
    assert.equal(isLoopbackWsUrl(' ws://127.0.0.1:9222/x'), false);
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1:9222/x '), false);
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1:9222/x\n'), false);
    assert.equal(isLoopbackWsUrl('\tws://127.0.0.1:9222/x'), false);
    assert.equal(isLoopbackWsUrl('ws://127.0.0.1 :9222/x'), false);
  });
});

// ── isTradingViewChartUrl (unchanged behavior, kept pinned) ───────────────

describe('isTradingViewChartUrl — https tradingview.com/chart origin', () => {
  it('accepts real chart origins, rejects lookalikes and non-https', () => {
    assert.equal(isTradingViewChartUrl('https://www.tradingview.com/chart/AbC/'), true);
    assert.equal(isTradingViewChartUrl('http://www.tradingview.com/chart/x'), false);
    assert.equal(isTradingViewChartUrl('https://eviltradingview.com/chart/x'), false);
    assert.equal(isTradingViewChartUrl('https://www.tradingview.com.evil.example/chart/x'), false);
    assert.equal(isTradingViewChartUrl('https://www.tradingview.com/screener/'), false);
  });
});

// ── isLoopbackAddr: peer-address classifier ───────────────────────────────

describe('isLoopbackAddr — live socket peer classification', () => {
  it('accepts loopback, rejects everything else', () => {
    for (const [a, exp] of [
      ['127.0.0.1', true], ['127.1.2.3', true], ['::1', true], ['::ffff:127.0.0.1', true],
      ['10.0.0.5', false], ['0.0.0.0', false], ['8.8.8.8', false], ['::ffff:8.8.8.8', false],
      ['169.254.0.1', false], ['128.0.0.1', false], [undefined, false], ['', false], [null, false],
    ]) {
      assert.equal(isLoopbackAddr(a), exp, `isLoopbackAddr(${a}) should be ${exp}`);
    }
  });
});

// ── assertLoopbackSocket: unit ────────────────────────────────────────────

describe('assertLoopbackSocket — refuses redirected / off-host sockets', () => {
  it('passes a direct loopback socket with zero redirects', () => {
    assert.doesNotThrow(() => assertLoopbackSocket({ _ws: { _redirects: 0, _socket: { remoteAddress: '127.0.0.1' } } }));
  });
  it('throws when the ws followed any redirect', () => {
    assert.throws(() => assertLoopbackSocket({ _ws: { _redirects: 1, _socket: { remoteAddress: '127.0.0.1' } } }), /redirect/i);
  });
  it('throws on a non-loopback peer address', () => {
    assert.throws(() => assertLoopbackSocket({ _ws: { _redirects: 0, _socket: { remoteAddress: '203.0.113.9' } } }), /not loopback/i);
  });
  it('fails closed on an unreadable socket / renamed internals', () => {
    // _redirects undefined (renamed field, or no _ws) must be refused, not
    // silently treated as zero (luna #2).
    assert.throws(() => assertLoopbackSocket({ _ws: {} }), /refusing/i);
    assert.throws(() => assertLoopbackSocket({}), /refusing/i);
    assert.throws(() => assertLoopbackSocket({ _ws: { _socket: { remoteAddress: '127.0.0.1' } } }), /redirect|confirmed zero/i);
  });
});

// ── REAL redirect: a rogue :port that 302s the WS handshake to another host ─

describe('CDP WebSocket redirect — the redirect target receives NOTHING', () => {
  let aHttp, bHttp, wss, portA, portB, bConnections;

  before(async () => {
    bConnections = 0;
    // Server B is the redirect TARGET. In production this is wherever the
    // attacker points us — the whole question is whether it hears from us.
    bHttp = http.createServer();
    wss = new WebSocketServer({ server: bHttp });
    wss.on('connection', (ws) => { bConnections++; ws.on('message', () => {}); });
    bHttp.on('upgrade', () => { /* counted via wss connection */ });
    portB = await listen(bHttp);

    // Server A is the rogue listener on the pinned port: it answers the
    // WebSocket upgrade with a 302 pointing at B.
    aHttp = http.createServer();
    aHttp.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 302 Found\r\n' + `Location: ws://127.0.0.1:${portB}/devtools/page/EXFIL\r\n` + 'Connection: close\r\n\r\n');
      socket.end();
    });
    portA = await listen(aHttp);
  });

  after(() => {
    try { wss.close(); } catch { /* ignore */ }
    try { aHttp.close(); } catch { /* ignore */ }
    try { bHttp.close(); } catch { /* ignore */ }
  });

  it('a 3xx on the CDP upgrade is a connection FAILURE — nothing is sent to the redirect target', { timeout: 15000 }, async () => {
    // This is the load-bearing assertion of this branch. The previous form of
    // this test asserted that B DID receive the redirected socket and that the
    // guard then refused the client — which proved the guard worked while
    // conceding that the upgrade request, including the debugger target path,
    // had already been delivered to a host of the attacker's choosing. A
    // security boundary that fires after the request is sent is not a boundary
    // for the request. Refusing to follow the redirect is.
    const verifiedWsUrl = `ws://127.0.0.1:${portA}/devtools/page/LOOKS-LOOPBACK`;

    let client = null;
    let dialError = null;
    try {
      client = await CDP({ host: '127.0.0.1', port: portA, target: verifiedWsUrl, local: true });
    } catch (err) {
      dialError = err;
    } finally {
      try { await client?.close(); } catch { /* ignore */ }
    }

    assert.ok(dialError, 'a redirected upgrade must FAIL the dial, not be followed and then refused');
    assert.match(String(dialError.message), /30[12378]|redirect|unexpected server response/i,
      `the failure must be the refused redirect (got: ${dialError.message})`);
    // Give any followed connection a chance to land before asserting absence.
    await new Promise(r => setTimeout(r, 250));
    assert.equal(bConnections, 0,
      'THE invariant: the redirect target must receive ZERO connections — no upgrade, no metadata, nothing');
  });

  it('a DIRECT loopback endpoint still connects and passes the guard (no over-blocking)', { timeout: 15000 }, async () => {
    // The override must refuse redirects without breaking the normal path.
    const okHttp = http.createServer();
    const okWss = new WebSocketServer({ server: okHttp });
    okWss.on('connection', (ws) => { ws.on('message', () => {}); });
    const okPort = await listen(okHttp);
    let client = null;
    try {
      client = await CDP({ host: '127.0.0.1', port: okPort, target: `ws://127.0.0.1:${okPort}/devtools/page/OK`, local: true });
      assert.equal(client._ws._redirects, 0, 'a direct dial follows no redirects');
      assert.doesNotThrow(() => assertLoopbackSocket(client), 'a direct loopback peer must pass the guard');
    } finally {
      try { await client?.close(); } catch { /* ignore */ }
      try { okWss.close(); } catch { /* ignore */ }
      try { okHttp.close(); } catch { /* ignore */ }
    }
  });

  it('the CRI internal this override replaces is PINNED — an upstream change fails here, loudly', () => {
    // The override copies one upstream method and flips one option. If upstream
    // edits that method, this build would silently ship stale logic; if upstream
    // stops hardcoding the option, the override is no longer needed and the
    // coupling should be dropped. Either way a human must look, so pin the
    // installed source rather than trusting the version range.
    const criSrc = readFileSync(
      new URL('../node_modules/chrome-remote-interface/lib/chrome.js', import.meta.url), 'utf8',
    );
    const body = criSrc.slice(criSrc.indexOf('_connectToWebSocket() {'));
    assert.ok(body.startsWith('_connectToWebSocket() {'), 'upstream no longer defines _connectToWebSocket');
    const method = body.slice(0, body.indexOf('\n    }') + 6);
    assert.match(method, /followRedirects:\s*true/,
      'upstream no longer hardcodes followRedirects:true — re-derive or drop the override in src/connection.js');
    assert.match(method, /maxPayload:\s*256 \* 1024 \* 1024/, 'upstream ws options changed — re-derive the override');
    assert.match(method, /perMessageDeflate:\s*false/, 'upstream ws options changed — re-derive the override');
    for (const handler of ["on\\('open'", "on\\('message'", "on\\('close'", "on\\('error'"]) {
      assert.match(method, new RegExp(handler), `upstream event wiring changed (${handler}) — re-derive the override`);
    }
    // And the shipped module must actually have replaced it.
    assert.equal(CDPChromeProto.prototype._connectToWebSocket.name, '_connectToWebSocketNoRedirect',
      'the no-redirect override is not installed on the shipped CRI prototype');
  });
});

// ── connect() ORDERING and the capability surface ─────────────────────────
// connect() is module-private now and takes no injected dialer, so these can no
// longer drive it with a fake CDP factory — that seam WAS the capability hole.
// What replaces it: the guard's behaviour is proven against real listeners
// above and by the predicate tests, and its ORDERING inside connect() is pinned
// against the shipped source here. A source pin is weaker evidence than driving
// the function, and it is the honest cost of removing the injection surface.

describe('connection.js — capability surface and guard ordering', () => {
  const src = readFileSync(new URL('../src/connection.js', import.meta.url), 'utf8');

  it('exports NO raw-client producer and NO transport replacement seam', async () => {
    const mod = await import('../src/connection.js');
    for (const forbidden of ['connect', 'getClient', '_dialCDP', '_fetchControl', 'setDeps', '_internals']) {
      assert.equal(mod[forbidden], undefined,
        `${forbidden} must not be exported — a production module could obtain or replace the CDP transport through it`);
    }
    // What production code MAY have: narrow operations only.
    for (const allowed of ['ensureConnected', 'capturePage', 'evaluate', 'evaluateAsync', 'disconnect', 'getTargetInfo']) {
      assert.equal(typeof mod[allowed], 'function', `${allowed} is part of the narrow surface`);
    }
  });

  it('connect() accepts no injected dialer, target finder, or retry budget', () => {
    const body = src.slice(src.indexOf('async function connect()'));
    assert.ok(src.includes('async function connect()'),
      'connect must take NO parameters — an options bag is a transport replacement seam');
    assert.ok(!/^export async function connect/m.test(src), 'connect must not be exported');
    assert.ok(!/_deps\.CDP|_deps\.findChartTarget/.test(body.slice(0, 2000)),
      'no injected dialer or target finder may remain');
  });

  it('the loopback guard precedes every CDP command inside connect()', () => {
    const body = src.slice(src.indexOf('async function connect()'), src.indexOf('async function fetchTargets'));
    const guardAt = body.indexOf('assertLoopbackSocket(');
    assert.ok(guardAt > -1, 'connect() must call assertLoopbackSocket');
    for (const cmd of ['Runtime.enable', 'Page.enable', 'DOM.enable']) {
      const at = body.indexOf(cmd);
      assert.ok(at > -1, `connect() should still enable ${cmd}`);
      assert.ok(guardAt < at, `assertLoopbackSocket must run BEFORE ${cmd}`);
    }
    // targetInfo is committed only after the URL passed isLoopbackWsUrl, so
    // getTargetInfo() can never serve a target this file refused. (The client
    // singleton is assigned the dial result directly and is nulled+closed if the
    // guard refuses; a post-guard ENABLE failure leaves it set — that is the
    // lifecycle issue recorded as out of scope for this branch, not a loopback
    // boundary violation, since the guard has already proven the peer.)
    assert.ok(body.indexOf('isLoopbackWsUrl(') < body.indexOf('targetInfo = target'),
      'targetInfo must be committed only after the debugger URL passed the loopback check');
    assert.ok(body.indexOf('client = null') > guardAt,
      'a guard refusal must clear the client singleton');
  });
});
