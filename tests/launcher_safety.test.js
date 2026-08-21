// Launcher safety contract — issue #6 (scripts/launch_tv_debug_mac.sh).
//
// Behavioral tests drive the script's own functions (the file is source-able;
// direct execution is guarded) against a FAKE bundle in a temp dir: a copy of
// /bin/sleep, ad-hoc re-signed (AMFI SIGKILLs a copied platform binary
// otherwise), placed at <fixture>/Contents/MacOS/TradingView gives a live
// process whose kernel-reported executable path (`ps -o comm=`) sits exactly
// where a resolved TradingView main's would — so both contract directions are
// exercised without TradingView installed and without this test signalling
// any process it did not spawn. macOS-only: the identification mechanism is
// specified against BSD ps comm semantics, so these tests skip elsewhere
// (CI runs ubuntu; the static contract tests below still run there).
//
// TV_LAUNCHER_UNDER_TEST overrides the script path — used to demonstrate RED
// on the pre-fix revision and on mutants; defaults to the repo script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pexecFile = promisify(execFile);
const isDarwin = process.platform === 'darwin';
const SCRIPT = process.env.TV_LAUNCHER_UNDER_TEST
  || join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'launch_tv_debug_mac.sh');
const scriptText = readFileSync(SCRIPT, 'utf8');
// The negative invariants are about executable code; the script's comments
// deliberately RECORD the removed patterns as rationale, so strip them first.
const codeText = scriptText.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
// teardown_existing's own body, for invariants scoped to the teardown path.
const teardownBody = (() => {
  const start = scriptText.indexOf('teardown_existing()');
  const end = scriptText.indexOf('\n}', start);
  return start >= 0 && end > start ? scriptText.slice(start, end) : '';
})();

// ---------- static contract invariants (all platforms, incl. CI) ----------

test('launcher: exactly one kill, TERM, single quoted operand, no escalation', () => {
  assert.ok(!/pkill/.test(codeText), 'pkill must not reappear (issue #6 direction 1)');
  assert.ok(!/killall/.test(codeText), 'killall must not appear');
  // command-position kill only — echo strings legitimately SAY "kill"
  const killSites = codeText.match(/^\s*kill /gm) || [];
  assert.equal(killSites.length, 1, 'exactly one kill invocation in the whole script');
  assert.match(codeText, /kill -TERM "\$main_pid" 2>\/dev\/null/, 'the one kill is SIGTERM to the single quoted main pid');
  assert.ok(!/kill\s+-9|kill\s+-KILL/.test(codeText), 'no SIGKILL escalation path');
});

test('launcher: measured bundle id present in code, dead id gone from code', () => {
  assert.ok(codeText.includes('com.tradingview.tradingviewapp.desktop'), 'measured CFBundleIdentifier queried');
  assert.ok(!codeText.includes('com.niceincontact'), 'previous dead bundle id removed from code');
});

test('launcher: teardown sleeps only via the drain poll interval', () => {
  assert.ok(teardownBody.length > 0, 'teardown_existing body found');
  const sleeps = teardownBody.match(/sleep [^\n]*/g) || [];
  assert.ok(sleeps.length >= 1, 'drain loop polls');
  for (const s of sleeps) {
    assert.equal(s.trim(), 'sleep "$DRAIN_POLL_INTERVAL"', `teardown sleep is the poll interval only, got: ${s}`);
  }
  assert.match(codeText, /DRAIN_TIMEOUT_POLLS=50/, 'adjudicated 10s bound (50 x 0.2s)');
  assert.match(codeText, /DRAIN_POLL_INTERVAL=0\.2/, 'poll interval');
});

test('launcher: paths cross into awk via ENVIRON, never -v (byte-faithful match)', () => {
  assert.ok(!/awk -v/.test(codeText), 'awk -v backslash-expands values; ENVIRON is byte-faithful');
  assert.match(codeText, /ENVIRON\["TV_LAUNCH_APP"\]/, 'main match reads the path from ENVIRON');
});

test('launcher: pre-signal identity recheck present in the teardown path', () => {
  assert.match(teardownBody, /ps -p "\$main_pid" -o comm=/, 'identity re-validated at the instant of signalling');
});

// ---------- behavioral tests (darwin only) ----------

const FIXTURE_SLEEP = '/bin/sleep';

function makeFakeBundle(parent) {
  const root = parent || mkdtempSync(join(tmpdir(), 'tv-launcher-test-'));
  // The bundle DIRECTORY name is deliberately not "TradingView.app": nothing in
  // the mechanism depends on it (BUNDLE is derived by suffix-stripping APP), and
  // if macOS ever surfaces a damaged-app dialog for a fixture it must not read
  // as the real app. Only the BINARY name must be TradingView.
  const bundle = join(root, 'LauncherTestFixture.app');
  const appDir = join(bundle, 'Contents', 'MacOS');
  const fwDir = join(bundle, 'Contents', 'Frameworks');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(fwDir, { recursive: true });
  const app = join(appDir, 'TradingView');
  const helper = join(fwDir, 'FakeHelper');
  copyFileSync(FIXTURE_SLEEP, app);
  copyFileSync(FIXTURE_SLEEP, helper);
  chmodSync(app, 0o755);
  chmodSync(helper, 0o755);
  // A copied platform binary is SIGKILLed at exec by AMFI (measured: exit 137);
  // an ad-hoc re-sign turns the copy into a runnable non-platform binary.
  execFileSync('codesign', ['-s', '-', '-f', app], { stdio: 'ignore' });
  execFileSync('codesign', ['-s', '-', '-f', helper], { stdio: 'ignore' });
  return { root, bundle, app, helper };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function reap(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// Source the launcher, pin APP/BUNDLE to the fake bundle, shrink the drain
// bound so timeout paths finish in ~3s, then run `body`.
async function harness(app, body, { pathOverride } = {}) {
  const shell = [
    'set -u',
    `source ${JSON.stringify(SCRIPT)}`,
    `APP=${JSON.stringify(app)}`,
    'BUNDLE="${APP%/Contents/MacOS/TradingView}"',
    // Hermetic foreign-main scan: scope the bundle-relative suffix to the
    // fixture layout so a REAL TradingView running on the dev machine is not
    // picked up as a foreign install by these tests. Same code path — only
    // the suffix variable changes.
    'MAIN_REL_PATH="/LauncherTestFixture.app/Contents/MacOS/TradingView"',
    'DRAIN_TIMEOUT_POLLS=15',
    body,
  ].join('\n');
  const env = pathOverride ? { ...process.env, PATH: pathOverride } : process.env;
  try {
    const { stdout, stderr } = await pexecFile('/bin/bash', ['-c', shell], { timeout: 30000, env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    if (err.killed) throw err;
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('identification: argv mentions of the path do not match; only the real executable does', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  const bait = join(root, 'TradingView-issue6.txt');
  writeFileSync(bait, '');
  const main = spawn(app, ['600'], { stdio: 'ignore' });
  // unrelated process whose ARGV contains both the substring and the full path
  const tail = spawn('tail', ['-f', bait, '--', `ignored-${app}`], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, 'tv_main_pids; echo ---; tv_bundle_pids');
    const [mains, bundles] = r.stdout.split('---').map((s) => s.trim().split('\n').filter(Boolean).map(Number));
    assert.deepEqual(mains, [main.pid], 'main set = exactly the fake main');
    assert.ok(bundles.includes(main.pid), 'bundle set includes main');
    assert.ok(!bundles.includes(tail.pid), 'argv-only match excluded from bundle set');
    assert.ok(!mains.includes(tail.pid), 'argv-only match excluded from main set');
  } finally {
    reap(main.pid); reap(tail.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('identification: a backslash-bearing path still matches byte-exactly', { skip: !isDarwin }, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'tv-launcher-test-'));
  const weird = join(parent, 'weird\\tdir'); // literal backslash-t in the path
  mkdirSync(weird, { recursive: true });
  const { app } = makeFakeBundle(weird);
  const main = spawn(app, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, 'tv_main_pids');
    const mains = r.stdout.trim().split('\n').filter(Boolean).map(Number);
    assert.deepEqual(mains, [main.pid], 'backslash in the path must not break the exact match (awk -v would expand it)');
  } finally {
    reap(main.pid); rmSync(parent, { recursive: true, force: true });
  }
});

test('identification: canonicalize_app resolves a symlinked spelling to the physical path', { skip: !isDarwin }, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'tv-launcher-test-'));
  const { app } = makeFakeBundle(parent);
  const linkDir = join(parent, 'Linked.app');
  symlinkSync(join(parent, 'LauncherTestFixture.app'), linkDir);
  const linkedApp = join(linkDir, 'Contents', 'MacOS', 'TradingView');
  const physicalApp = realpathSync(linkedApp);
  // Spawn via the PHYSICAL path (as a real install would be launched), so the
  // kernel-reported comm is the physical spelling the canonicalized APP must hit.
  const main = spawn(physicalApp, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const body = [
      `APP=${JSON.stringify(linkedApp)}`,
      'canonicalize_app',
      'BUNDLE="${APP%/Contents/MacOS/TradingView}"',
      'echo "APP=$APP"',
      'tv_main_pids',
    ].join('\n');
    const r = await harness(linkedApp, body);
    assert.match(r.stdout, new RegExp(`APP=${physicalApp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'APP canonicalized to the physical path');
    const mains = r.stdout.trim().split('\n').slice(1).filter(Boolean).map(Number);
    assert.deepEqual(mains, [main.pid], 'the live main is visible under the canonicalized spelling');
  } finally {
    reap(main.pid); rmSync(parent, { recursive: true, force: true });
  }
});

test('fail closed: unreadable process table is never "nothing running"', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  const main = spawn(app, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    // Sabotage PATH so `ps` cannot resolve: observation must fail loudly,
    // not read as an empty set.
    const r = await harness(app, 'PATH=/nonexistent teardown_existing');
    assert.notEqual(r.code, 0, 'teardown refuses when the table is unreadable');
    assert.match(r.stdout, /process table/i);
    assert.equal(alive(main.pid), true, 'nothing signalled');
  } finally {
    reap(main.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('foreign install: detected and reported, observation-only — flow proceeds, nothing signalled', { skip: !isDarwin }, async () => {
  // Owner ruling 2026-08-22: the adjudicated criteria are the ONLY normative
  // accept/reject conditions; a foreign install is diagnostic, never a
  // rejection condition and never a reason to signal.
  const a = makeFakeBundle(); // resolved install (nothing running from it)
  const b = makeFakeBundle(); // foreign install with a live main
  const foreign = spawn(b.app, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(a.app, 'teardown_existing');
    assert.equal(r.code, 0, 'foreign install never adjudicates the teardown');
    assert.match(r.stdout, /foreign_install_detected/);
    assert.equal(alive(foreign.pid), true, 'foreign main untouched');
  } finally {
    reap(foreign.pid);
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  }
});

test('teardown: one TERM to main drains the set; unrelated survivor untouched', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  const bait = join(root, 'TradingView-issue6.txt');
  writeFileSync(bait, '');
  const main = spawn(app, ['600'], { stdio: 'ignore' });
  const tail = spawn('tail', ['-f', bait], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, 'teardown_existing');
    assert.equal(r.code, 0, `teardown succeeds: ${r.stdout}`);
    assert.match(r.stdout, /Sending one SIGTERM to the main process only/);
    assert.match(r.stdout, /Teardown complete/);
    await settle(200);
    assert.equal(alive(main.pid), false, 'main terminated');
    assert.equal(alive(tail.pid), true, 'unrelated process with matching argv is untouched');
  } finally {
    reap(main.pid); reap(tail.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('teardown: a live bundle helper is NEVER signalled — drain times out instead', { skip: !isDarwin }, async () => {
  // Discriminates the "kill every bundle pid once a main exists" mutant: the
  // helper here is independent (a real Electron helper dies via its main), so
  // the correct script TERMs only the main, the helper survives, the drain
  // times out, and the launcher fails closed.
  const { root, app, helper } = makeFakeBundle();
  const main = spawn(app, ['600'], { stdio: 'ignore' });
  const h = spawn(helper, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, 'teardown_existing');
    assert.notEqual(r.code, 0, 'drain cannot complete while the helper lives');
    assert.match(r.stdout, /FAILING CLOSED/);
    await settle(200);
    assert.equal(alive(main.pid), false, 'main got the one TERM');
    assert.equal(alive(h.pid), true, 'helper was never signalled');
  } finally {
    reap(main.pid); reap(h.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('fail closed: bundle-owned helper with no identifiable main is never signalled', { skip: !isDarwin }, async () => {
  const { root, app, helper } = makeFakeBundle();
  const h = spawn(helper, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, 'teardown_existing');
    assert.notEqual(r.code, 0, 'teardown refuses');
    assert.match(r.stdout, /no main process/);
    assert.equal(alive(h.pid), true, 'helper still alive — not signalled');
  } finally {
    reap(h.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('fail closed: TERM-resistant main -> drain timeout, no escalation, no relaunch path', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  // exec keeps ignored signal dispositions: the resulting process has the fake
  // main's executable path AND ignores SIGTERM, forcing the drain to time out.
  const main = spawn('/bin/bash', ['-c', `trap '' TERM; exec ${JSON.stringify(app)} 600`], { stdio: 'ignore' });
  try {
    await settle(600);
    const r = await harness(app, 'teardown_existing');
    assert.notEqual(r.code, 0, 'teardown fails closed on timeout');
    assert.match(r.stdout, /FAILING CLOSED/);
    assert.equal(alive(main.pid), true, 'no SIGKILL escalation — process still alive after timeout');
  } finally {
    reap(main.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('fail closed: more than one main candidate -> refuse, signal nothing', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  const m1 = spawn(app, ['600'], { stdio: 'ignore' });
  const m2 = spawn(app, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, 'teardown_existing');
    assert.notEqual(r.code, 0, 'teardown refuses');
    assert.match(r.stdout, /expected exactly one TradingView main process/);
    assert.equal(alive(m1.pid), true, 'first candidate untouched');
    assert.equal(alive(m2.pid), true, 'second candidate untouched');
  } finally {
    reap(m1.pid); reap(m2.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('no instance running: teardown is a silent no-op', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  try {
    const r = await harness(app, 'teardown_existing');
    assert.equal(r.code, 0);
    assert.ok(!/SIGTERM/.test(r.stdout), 'nothing signalled');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The top-level gate: teardown failure must PREVENT the relaunch. Driven
// through launch_tv_debug_main with resolve_app/launch_with_cdp stubbed
// (resolution would otherwise find a real installed app).
function gateBody(app, marker) {
  return [
    `resolve_app() { APP=${JSON.stringify(app)}; BUNDLE="\${APP%/Contents/MacOS/TradingView}"; }`,
    `launch_with_cdp() { : > ${JSON.stringify(marker)}; }`,
    'launch_tv_debug_main',
  ].join('\n');
}

test('gate: teardown failure prevents relaunch', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  const marker = join(root, 'relaunched');
  const main = spawn('/bin/bash', ['-c', `trap '' TERM; exec ${JSON.stringify(app)} 600`], { stdio: 'ignore' });
  try {
    await settle(600);
    const r = await harness(app, gateBody(app, marker));
    assert.notEqual(r.code, 0, 'launcher exits non-zero');
    assert.equal(existsSync(marker), false, 'relaunch was NOT reached');
    assert.equal(alive(main.pid), true, 'no escalation');
  } finally {
    reap(main.pid); rmSync(root, { recursive: true, force: true });
  }
});

test('gate: successful teardown proceeds to relaunch', { skip: !isDarwin }, async () => {
  const { root, app } = makeFakeBundle();
  const marker = join(root, 'relaunched');
  const main = spawn(app, ['600'], { stdio: 'ignore' });
  try {
    await settle(400);
    const r = await harness(app, gateBody(app, marker));
    assert.equal(r.code, 0, `launcher succeeds: ${r.stdout}`);
    assert.equal(existsSync(marker), true, 'relaunch was reached after a clean drain');
    assert.equal(alive(main.pid), false, 'previous main terminated');
  } finally {
    reap(main.pid); rmSync(root, { recursive: true, force: true });
  }
});
