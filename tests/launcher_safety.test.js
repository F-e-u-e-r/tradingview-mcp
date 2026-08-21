// Launcher safety contract — issue #6 (scripts/launch_tv_debug_mac.sh).
//
// Behavioral tests drive the script's own functions (the file is source-able;
// direct execution is guarded) against a FAKE bundle in a temp dir: a copy of
// /bin/sleep placed at <fake>/Contents/MacOS/TradingView gives a live process
// whose kernel-reported executable path (`ps -o comm=`) sits exactly where a
// resolved TradingView main's would — so both contract directions are
// exercised without TradingView installed and without this test signalling
// any process it did not spawn. macOS-only: the identification mechanism is
// specified against BSD ps comm semantics, so these tests skip elsewhere
// (CI runs ubuntu; the static contract tests below still run there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pexecFile = promisify(execFile);
const isDarwin = process.platform === 'darwin';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'launch_tv_debug_mac.sh');
const scriptText = readFileSync(SCRIPT, 'utf8');
// The negative invariants are about executable code; the script's comments
// deliberately RECORD the removed patterns as rationale, so strip them first.
const codeText = scriptText.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// ---------- static contract invariants (all platforms, incl. CI) ----------

test('launcher: no pkill/killall and no kill escalation anywhere', () => {
  assert.ok(!/pkill/.test(codeText), 'pkill must not reappear (issue #6 direction 1)');
  assert.ok(!/killall/.test(codeText), 'killall must not appear');
  assert.ok(!/kill\s+-9|kill\s+-KILL/.test(codeText), 'no SIGKILL escalation path');
  const termSites = codeText.match(/kill\s+-TERM/g) || [];
  assert.equal(termSites.length, 1, 'exactly one SIGTERM call site (main PID only)');
});

test('launcher: measured bundle id present in code, dead id gone from code', () => {
  assert.ok(codeText.includes('com.tradingview.tradingviewapp.desktop'), 'measured CFBundleIdentifier queried');
  assert.ok(!codeText.includes('com.niceincontact'), 'previous dead bundle id removed from code');
});

test('launcher: drain is a bounded state poll, not a fixed delay', () => {
  assert.ok(/DRAIN_TIMEOUT_POLLS=50/.test(scriptText), 'adjudicated 10s bound (50 x 0.2s)');
  assert.ok(/DRAIN_POLL_INTERVAL=0\.2/.test(scriptText), 'poll interval');
  assert.ok(!/^\s*sleep 1\s*$/m.test(scriptText) || /seq 1 15/.test(scriptText),
    'no standalone fixed teardown sleep (the CDP wait loop is the only sleep 1)');
});

// ---------- behavioral tests (darwin only) ----------

const FIXTURE_SLEEP = '/bin/sleep';

function makeFakeBundle() {
  const root = mkdtempSync(join(tmpdir(), 'tv-launcher-test-'));
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
// bound so the fail-closed timeout test finishes in ~3s, then run `body`.
async function harness(app, body) {
  const shell = [
    'set -u',
    `source ${JSON.stringify(SCRIPT)}`,
    `APP=${JSON.stringify(app)}`,
    'BUNDLE="${APP%/Contents/MacOS/TradingView}"',
    'DRAIN_TIMEOUT_POLLS=15',
    body,
  ].join('\n');
  try {
    const { stdout, stderr } = await pexecFile('/bin/bash', ['-c', shell], { timeout: 30000 });
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
