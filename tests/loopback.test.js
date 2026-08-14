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
import pkg from 'ws';
import CDP from 'chrome-remote-interface';
import {
  isLoopbackWsUrl,
  isTradingViewChartUrl,
  isLoopbackAddr,
  assertLoopbackSocket,
  connect,
  disconnect,
} from '../src/connection.js';

const WebSocketServer = pkg.Server || pkg.WebSocketServer;
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

describe('CDP WebSocket handshake redirect (real chrome-remote-interface + ws)', () => {
  let aHttp, bHttp, wss, portA, portB, bGotConnection;

  before(async () => {
    bGotConnection = false;
    bHttp = http.createServer();
    wss = new WebSocketServer({ server: bHttp });
    wss.on('connection', (ws) => { bGotConnection = true; ws.on('message', () => {}); });
    portB = await listen(bHttp);

    aHttp = http.createServer();
    aHttp.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 302 Found\r\n' + `Location: ws://127.0.0.1:${portB}/devtools/page/EXFIL\r\n` + 'Connection: close\r\n\r\n');
      socket.end();
    });
    portA = await listen(aHttp);
  });

  after(() => {
    try { wss.close(); } catch {}
    try { aHttp.close(); } catch {}
    try { bHttp.close(); } catch {}
  });

  it('the shipped guard refuses a connection that was redirected off the verified URL', { timeout: 15000 }, async () => {
    // (integration; skipped implicitly if the sandbox blocks binds — see before)
    // Loopback host on an ephemeral port (the 9222 pin is exercised separately;
    // a test can't bind the privileged fixed port). What this exercises is the
    // handshake-redirect guard, which is port-independent.
    const verifiedWsUrl = `ws://127.0.0.1:${portA}/devtools/page/LOOKS-LOOPBACK`;

    let client;
    try {
      client = await CDP({ host: '127.0.0.1', port: portA, target: verifiedWsUrl, local: true });
      // The ws transport followed the 302 to server B (the vulnerability). The
      // guard MUST catch it before any command is issued.
      assert.ok(client._ws._redirects > 0, 'precondition: ws followed the redirect (else the vuln did not reproduce)');
      assert.equal(bGotConnection, true, 'precondition: server B received the redirected socket');
      assert.throws(() => assertLoopbackSocket(client), /redirect/i, 'guard must refuse the redirected client');
    } finally {
      try { await client?.close(); } catch {}
    }
  });
});

// ── connect() ORDERING: the guard runs before any CDP command (sol #1/luna #3) ─
// This drives the production connect() with an injected CDP factory, so moving
// or deleting assertLoopbackSocket() in connect() — the actual regression the
// manual-guard test above cannot catch — fails here. No socket bind needed.

describe('connect() — guard precedes any CDP command', () => {
  const okTarget = async () => ({
    id: 'T', url: 'https://www.tradingview.com/chart/x/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/x',
  });
  function fakeClient(over) {
    const calls = [];
    const mk = (name) => async () => { calls.push(name); };
    return {
      calls,
      client: {
        _ws: over._ws,
        Runtime: { enable: mk('Runtime.enable') },
        Page: { enable: mk('Page.enable') },
        DOM: { enable: mk('DOM.enable') },
        close: mk('close'),
      },
    };
  }

  after(async () => { try { await disconnect(); } catch {} });

  it('refuses a redirected client and issues ZERO commands, tearing it down', async () => {
    const f = fakeClient({ _ws: { _redirects: 1, _socket: { remoteAddress: '203.0.113.9' } } });
    await assert.rejects(
      () => connect({ findChartTarget: okTarget, CDP: async () => f.client, maxRetries: 1, baseDelay: 0 }),
      /redirect|confirmed zero/i,
    );
    assert.ok(!f.calls.includes('Runtime.enable'), 'no CDP command may run before the guard rejects');
    assert.ok(!f.calls.includes('Page.enable'));
    assert.ok(f.calls.includes('close'), 'the refused client is torn down');
  });

  it('enables domains only AFTER the guard passes for a loopback client', async () => {
    const f = fakeClient({ _ws: { _redirects: 0, _socket: { remoteAddress: '127.0.0.1' } } });
    const c = await connect({ findChartTarget: okTarget, CDP: async () => f.client, maxRetries: 1, baseDelay: 0 });
    assert.equal(c, f.client);
    assert.deepEqual(f.calls, ['Runtime.enable', 'Page.enable', 'DOM.enable'], 'guard passed, then domains enabled in order');
  });

  it('refuses a non-loopback peer even with zero redirects, issuing zero commands', async () => {
    const f = fakeClient({ _ws: { _redirects: 0, _socket: { remoteAddress: '8.8.8.8' } } });
    await assert.rejects(
      () => connect({ findChartTarget: okTarget, CDP: async () => f.client, maxRetries: 1, baseDelay: 0 }),
      /not loopback/i,
    );
    assert.ok(!f.calls.includes('Runtime.enable'));
    assert.ok(f.calls.includes('close'));
  });
});
