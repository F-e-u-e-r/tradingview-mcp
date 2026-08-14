import CDP from 'chrome-remote-interface';
import { parse as legacyParse } from 'node:url';

let client = null;
let targetInfo = null;
// Review build: the CDP endpoint is pinned to local loopback by design.
// No env override — a config file cannot redirect the bridge to another host.
// 127.0.0.1 rather than localhost: on some machines localhost resolves to ::1
// first, and Electron's --remote-debugging-port only listens on IPv4.
export const CDP_HOST = '127.0.0.1';
export const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// Known direct API paths discovered via live probing (inherited from upstream)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

// PRIVATE. A CDP client is a transport capability, and the loopback guarantee
// below is a property of how this file uses it — handing the raw client to
// another module would put that guarantee outside this file's control, and no
// source audit can restore it once the capability has left. Callers get the
// three narrow operations underneath instead.
async function getClient() {
  if (client) {
    try {
      // Liveness + origin recheck: read the LIVE location. Reuse the cached
      // client only if the page is still a real tradingview.com/chart origin —
      // the SAME predicate findChartTarget used to accept it. If it navigated
      // anywhere else (another TV page or off-site), drop and reconnect rather
      // than operate on an unknown page (xcheck round 2 luna #10, tightened to
      // the exact chart-origin predicate round 3 sol #4 / luna #4). An
      // unreadable href falls through to reconnect.
      const res = await client.Runtime.evaluate({ expression: 'location.href', returnByValue: true });
      const href = res?.result?.value;
      if (href && isTradingViewChartUrl(href)) {
        return client;
      }
      await disconnect();
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

// The CDP target list is fetched from the local debug port, but its entries
// are attacker-influenceable if something other than TradingView Desktop is
// listening (or a page controls its own URL/title). To keep ALL traffic on
// loopback (xcheck round 1, findings on redirect-following and target-host
// trust), the local fetch refuses to follow redirects, and a target is used
// only when its webSocketDebuggerUrl is PRESENT and pinned to loopback:9222.
// Missing/empty is rejected (fail closed): Chrome always publishes the URL,
// and passing an id instead would make chrome-remote-interface re-fetch
// /json/list and trust whatever URL that second response carries.
// Bare IP loopback literals ONLY. `localhost` is deliberately excluded: it is a
// name, not a literal, and a poisoned hosts/NSS entry could resolve it off-host
// (the socket guard would still catch that, but the URL check should not vouch
// for a name it cannot pin). We connect to CDP_HOST=127.0.0.1, so Chrome
// publishes 127.0.0.1-based debugger URLs anyway (xcheck round 2 verification,
// luna #1).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

export function isLoopbackWsUrl(wsUrl) {
  if (!wsUrl) return false;
  // Reject any whitespace/control character (leading, trailing, or embedded):
  // both URL parsers strip a leading " " so `" ws://127.0.0.1:9222/x"` would
  // validate, yet chrome-remote-interface's `^wss?:` prefix test then fails to
  // recognize it as a URL and falls back to re-fetching /json/list by "id",
  // trusting an unverified second response (xcheck round 3 sol #3).
  if (/[\x00-\x20\x7f]/.test(wsUrl)) return false;
  let u;
  try { u = new URL(wsUrl); } catch { return false; }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return false;
  if (u.port !== String(CDP_PORT)) return false;

  // chrome-remote-interface consumes the URL with the LEGACY url.parse() and
  // resolves the host via dns.lookup — NOT the WHATWG URL parser we validate
  // with. Those two disagree on exotic numeric hosts: `new URL()` silently
  // normalizes 0177.0.0.1 / 0x7f.0.0.1 / 2130706433 / 127.1 to 127.0.0.1,
  // while url.parse keeps the raw string and hands it to getaddrinfo, which may
  // resolve it off-host (xcheck round 2 CRITICAL — parser differential). Reject
  // unless BOTH parsers agree on a canonical loopback literal, so the string we
  // bless is the same one CRI dials. Chrome only ever publishes 127.0.0.1 /
  // localhost / [::1], all of which parse identically here.
  const norm = (h) => (h || '').toLowerCase().replace(/^\[|\]$/g, '');
  const whatwgHost = norm(u.hostname);
  const legacyHost = norm(legacyParse(wsUrl).hostname);
  return legacyHost === whatwgHost && LOOPBACK_HOSTS.has(whatwgHost);
}

// Only require the URL to be TradingView's real chart origin — never a page
// that merely contains the substring "tradingview" somewhere in an
// attacker-chosen URL. https only: the desktop app never serves the chart
// over plain http.
export function isTradingViewChartUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:'
      && /(^|\.)tradingview\.com$/i.test(u.hostname)
      && /^\/chart(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

// True only for a loopback peer address as reported by the live socket:
// 127.0.0.0/8, ::1, or the IPv4-mapped ::ffff:127.x form. Anything else
// (an external host) is rejected.
export function isLoopbackAddr(addr) {
  if (!addr || typeof addr !== 'string') return false;
  let a = addr.trim().toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  if (a === '::1') return true;
  const m = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((x) => x > 255)) return false;
  return octets[0] === 127;
}

// Verify the ACTUAL socket the CDP client opened, not just the URL we asked
// for. chrome-remote-interface hard-codes followRedirects:true on its ws
// transport (chrome.js) with no override hook, so a rogue listener on 9222 can
// answer the WebSocket upgrade with a 3xx and the ws library will silently dial
// the redirect's Location — any host — even though the URL we handed it was
// loopback-verified (xcheck round 2 CRITICAL, reproduced). This runs after the
// socket opens but BEFORE any Runtime/Page command is issued, so no CDP payload
// (nor any evaluate() argument) is ever sent to a redirected peer. Fails closed:
// a redirect that was followed, or a non-loopback / unreadable peer address, is
// refused.
export function assertLoopbackSocket(client) {
  const ws = client && client._ws;
  const sock = ws && ws._socket;
  const redirects = ws ? ws._redirects : undefined;
  const addr = sock && sock.remoteAddress;
  // Fail CLOSED on the redirect check: require a confirmed zero redirect count.
  // ws initializes _redirects to 0 on every connect (pinned 7.5.11), so a
  // normal connection reads 0; a followed redirect reads >=1; and if a future
  // ws renames the field it reads undefined — all of which except an explicit 0
  // must be refused, so a silent field rename can't turn the guard fail-open
  // (xcheck round 2 verification, luna #2). A redirect to another LOOPBACK port
  // would pass the address check below, so this count is the only thing that
  // catches an on-host redirect to a rogue service.
  if (redirects !== 0) {
    throw new Error(`CDP WebSocket redirect count is not a confirmed zero (${redirects}) — refusing (possible redirect off the verified target by a rogue :${CDP_PORT} listener, or an unrecognized ws version).`);
  }
  if (!isLoopbackAddr(addr)) {
    throw new Error(`CDP WebSocket peer address is not loopback (${addr ?? 'unreadable'}) — refusing.`);
  }
}

// _deps injects the CDP factory, target finder, retry budget, and delay so a
// test can drive the real ordering (guard BEFORE any command) without a live
// Chrome; production passes nothing and uses the real implementations.
export async function connect(_deps = {}) {
  const cdp = _deps.CDP || CDP;
  const findTarget = _deps.findChartTarget || findChartTarget;
  const maxRetries = _deps.maxRetries ?? MAX_RETRIES;
  const baseDelay = _deps.baseDelay ?? BASE_DELAY;
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const target = await findTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      if (!isLoopbackWsUrl(target.webSocketDebuggerUrl)) {
        throw new Error(`Refusing CDP target whose debugger URL is missing or not loopback:${CDP_PORT}: ${target.webSocketDebuggerUrl}`);
      }
      targetInfo = target;
      // Connect via the VERIFIED webSocketDebuggerUrl string. Passing target.id
      // here would make chrome-remote-interface re-fetch /json/list itself and
      // connect to whatever webSocketDebuggerUrl that second, unverified
      // response names (it rewrites its host/port from that URL) — the check
      // above must bind to the exact URL the socket actually dials.
      // local:true → use CRI's bundled CDP protocol instead of fetching
      // /json/protocol over HTTP; that fetch would otherwise resolve the
      // legacy-parsed host via dns.lookup and could leave loopback before our
      // socket guard runs (xcheck round 2 — the protocol-fetch leg).
      client = await cdp({ host: CDP_HOST, port: CDP_PORT, target: target.webSocketDebuggerUrl, local: true });

      // The ws transport may have followed a handshake redirect off-loopback
      // despite the verified URL; verify the live peer BEFORE issuing any
      // command, and tear down if it isn't loopback. This ordering is the whole
      // guarantee — no Runtime/Page command (nor any evaluate payload) may run
      // before this line.
      try {
        assertLoopbackSocket(client);
      } catch (guardErr) {
        try { await client.close(); } catch {}
        client = null;
        throw guardErr;
      }

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) { // no pointless sleep after the final failure
        const delay = Math.min(baseDelay * Math.pow(2, attempt), 30000);
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`CDP connection failed after ${maxRetries} attempts: ${lastError?.message}`);
}

async function fetchTargets() {
  // redirect:'manual' → a 3xx from whatever is on the port is NOT followed to
  // an external host; we only accept a direct 200 from loopback.
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`, { redirect: 'manual' });
  if (!resp.ok) {
    throw new Error(`CDP /json/list returned ${resp.status} ${resp.statusText || ''} (expected a direct 200 from ${CDP_HOST}:${CDP_PORT})`);
  }
  return resp.json();
}

async function findChartTarget() {
  const targets = await fetchTargets();
  return targets.find(t => t.type === 'page' && isTradingViewChartUrl(t.url)) || null;
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

// Establish (or reuse) the guarded connection without handing back the client.
// health_check only needs to know the bridge is up.
export async function ensureConnected() {
  await getClient();
  return true;
}

// The screenshot command. capture.js asks for a picture; it never holds a
// client. Params are CDP capture options (format/clip) — they carry no page
// code, which is why this can be a narrow pass-through rather than a sink.
export async function capturePage(params) {
  const c = await getClient();
  return c.Page.captureScreenshot(params);
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}
