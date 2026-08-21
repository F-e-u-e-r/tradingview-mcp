#!/bin/bash
# Launch TradingView Desktop on macOS with Chrome DevTools Protocol enabled
# Usage: ./scripts/launch_tv_debug_mac.sh [port]
#
# Teardown contract — issue #6, mechanism adjudicated 2026-08-22 against
# live-app measurements (TradingView Desktop 3.3.0, macOS 26.5.2):
#
#   * The only process this script may ever signal is the TradingView MAIN
#     process, identified by EXACT executable-path equality against the
#     resolved bundle binary ("$APP") — never by argv substring matching.
#     (The previous `pkill -f "TradingView"` matched any process whose argv
#     contained the substring — e.g. `tail -f /tmp/TradingView.txt` — a
#     measured false positive, issue #6 direction 1.) The identity is
#     re-validated at the instant of signalling: kill-by-pid has no atomic
#     form, so the recheck narrows the exit-and-reuse race, and a PID whose
#     executable changed is refused.
#   * One SIGTERM to the main PID tears down the entire bundle-owned process
#     set, including the ppid=1 crashpad handler (measured full-clear: 0.4s /
#     2.16s / 4.28s). Helpers and crashpad are never signalled directly.
#   * Teardown completion is a STATE, not a delay: the bundle-owned process
#     set must be observed EMPTY (it can transiently GROW mid-teardown —
#     measured), bounded by DRAIN_TIMEOUT_POLLS. On timeout this script FAILS
#     CLOSED: it reports and exits without relaunching; it never escalates to
#     a broader kill and never "finishes off" helpers.
#   * An UNREADABLE process table is never treated as "nothing running" or
#     "drained": observation failure aborts with nothing signalled and no
#     relaunch (fail closed, cross-model review finding).
#   * Bundle-owned processes present with no identifiable main process:
#     abort rather than touch helpers (fail closed).
#   * A TradingView main running from a DIFFERENT install than the resolved
#     one is DETECTED and reported (foreign_install_detected) but is
#     OBSERVATION-ONLY (owner ruling 2026-08-22): the adjudicated teardown
#     criteria above stay the only normative accept/reject conditions. The
#     shared profile singleton means a relaunch alongside that instance may
#     not yield a durable CDP endpoint — reported, never adjudicated, and
#     never a reason to signal anything. If dual-install is ever shown to
#     break correctness, that becomes a spec change, not a guard.
#   * Why teardown exists at all (direction 2): with an instance alive, a
#     direct relaunch with --remote-debugging-port prints "DevTools
#     listening", exits 0, and leaves NO durable CDP endpoint — the port dies
#     with the singleton-handoff process (measured). Skipping teardown does
#     not work; it only looks like it worked.

PORT="${1:-9222}"
APP=""
BUNDLE=""

# The bundle-relative location of the main executable inside TradingView.app.
MAIN_REL_PATH="/Contents/MacOS/TradingView"

# Bundle-set drain bound: 50 polls x 0.2s = 10s (adjudicated; measured
# teardowns took 0.4-4.3s, so the previous fixed `sleep 1` was wrong in both
# directions — too short to be safe, yet unconditionally spent).
DRAIN_TIMEOUT_POLLS=50
DRAIN_POLL_INTERVAL=0.2

# ps reports the kernel's physical executable path, and the exact-equality
# match must compare like with like: resolve directory symlinks and case
# aliases in the resolved path. (A symlink at the binary itself is not
# resolved — none ships in the bundle; that exotic case fails CLOSED via the
# foreign-main guard or a visible non-durable relaunch, never a mis-signal.)
canonicalize_app() {
  local dir
  dir=$(cd "$(dirname "$APP")" 2>/dev/null && pwd -P) || return 0
  [ -n "$dir" ] && APP="$dir/$(basename "$APP")"
}

resolve_app() {
  APP=""
  local loc
  local locations=(
    "/Applications/TradingView.app$MAIN_REL_PATH"
    "$HOME/Applications/TradingView.app$MAIN_REL_PATH"
  )
  for loc in "${locations[@]}"; do
    if [ -f "$loc" ]; then
      APP="$loc"
      break
    fi
  done

  # Fallback: search with mdfind (Spotlight). Bundle id measured from the
  # installed app (issue #6): com.tradingview.tradingviewapp.desktop — the id
  # this script previously queried (com.niceincontact.TradingView) matches
  # nothing and made this fallback dead code.
  if [ -z "$APP" ]; then
    APP=$(mdfind "kMDItemCFBundleIdentifier == 'com.tradingview.tradingviewapp.desktop'" 2>/dev/null | head -1)
    if [ -n "$APP" ]; then
      APP="$APP$MAIN_REL_PATH"
    fi
  fi

  # Fallback: find any TradingView.app
  if [ -z "$APP" ] || [ ! -f "$APP" ]; then
    APP=$(find /Applications "$HOME/Applications" -name "TradingView.app" -maxdepth 2 2>/dev/null | head -1)
    if [ -n "$APP" ]; then
      APP="$APP$MAIN_REL_PATH"
    fi
  fi

  if [ -z "$APP" ] || [ ! -f "$APP" ]; then
    echo "Error: TradingView not found."
    echo "Checked: /Applications/TradingView.app, ~/Applications/TradingView.app"
    echo ""
    echo "If installed elsewhere, run manually:"
    echo "  /path/to/TradingView.app$MAIN_REL_PATH --remote-debugging-port=$PORT"
    return 1
  fi

  canonicalize_app
  BUNDLE="${APP%"$MAIN_REL_PATH"}"
  if [ "$BUNDLE" = "$APP" ]; then
    echo "Error: resolved executable does not sit at <bundle>$MAIN_REL_PATH: $APP"
    return 1
  fi
}

observation_error() {
  echo "Error: could not read the process table (ps failed). An unreadable table is"
  echo "never treated as 'nothing running' — fail closed: nothing signalled, no relaunch."
}

# PIDs whose EXECUTABLE PATH equals the resolved main binary exactly.
# ps `comm` is the executable path, not the argument list, so an unrelated
# process that merely mentions the path in its arguments does not match.
# Paths cross into awk via ENVIRON, which is byte-faithful — `awk -v` would
# expand backslash escapes and break the exact-equality contract.
# Returns non-zero if the process table cannot be read.
tv_main_pids() {
  local table
  table=$(ps -axo pid=,comm=) || return 1
  printf '%s\n' "$table" | TV_LAUNCH_APP="$APP" awk '
    BEGIN { app = ENVIRON["TV_LAUNCH_APP"] }
    {
      pid = $1
      line = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", line)
      if (line == app) print pid
    }
  '
}

# Non-destructive OBSERVATION only — never a kill set: PIDs whose executable
# lives under the resolved bundle. Decides when teardown is complete; a false
# positive here makes the launcher fail closed instead of killing anything.
# Returns non-zero if the process table cannot be read.
tv_bundle_pids() {
  local table
  table=$(ps -axo pid=,comm=) || return 1
  printf '%s\n' "$table" | TV_LAUNCH_PREFIX="$BUNDLE/" awk '
    BEGIN { prefix = ENVIRON["TV_LAUNCH_PREFIX"] }
    {
      pid = $1
      line = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", line)
      if (index(line, prefix) == 1) print pid
    }
  '
}

# Main processes of ANY TradingView install OTHER than the resolved one:
# comm ends with the bundle-relative main path but is not "$APP".
# OBSERVATION ONLY — the result is printed and aborted on, never signalled.
# Returns non-zero if the process table cannot be read.
tv_foreign_mains() {
  local table
  table=$(ps -axo pid=,comm=) || return 1
  printf '%s\n' "$table" | TV_LAUNCH_APP="$APP" TV_LAUNCH_SUFFIX="$MAIN_REL_PATH" awk '
    BEGIN {
      app = ENVIRON["TV_LAUNCH_APP"]
      suffix = ENVIRON["TV_LAUNCH_SUFFIX"]
      slen = length(suffix)
    }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      pidline = line
      sub(/^[0-9]+[[:space:]]+/, "", line)
      if (length(line) >= slen && substr(line, length(line) - slen + 1) == suffix && line != app) print "  " pidline
    }
  '
}

list_bundle_processes() {
  local table
  table=$(ps -axo pid=,comm=) || { echo "  (process table unreadable)"; return 0; }
  printf '%s\n' "$table" | TV_LAUNCH_PREFIX="$BUNDLE/" awk '
    BEGIN { prefix = ENVIRON["TV_LAUNCH_PREFIX"] }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      rest = line
      sub(/^[0-9]+[[:space:]]+/, "", rest)
      if (index(rest, prefix) == 1) print "  " line
    }
  '
}

teardown_existing() {
  local foreign bundle_pids main_pids main_count main_pid comm_now psrc i

  # Observation only — never adjudication (owner ruling 2026-08-22): a foreign
  # install is diagnostic, not a rejection condition. An unreadable table here
  # is tolerated silently; the normative observations below fail closed on it.
  foreign=$(tv_foreign_mains) || foreign=""
  if [ -n "$foreign" ]; then
    echo "Warning: foreign_install_detected — a TradingView main process is running from a different location than the resolved app:"
    printf '%s\n' "$foreign"
    echo "(observation only; teardown/relaunch proceed on the resolved app: $APP."
    echo " A relaunch alongside that instance may not yield a durable CDP endpoint — the profile singleton is shared.)"
  fi

  bundle_pids=$(tv_bundle_pids) || { observation_error; return 1; }
  if [ -z "$bundle_pids" ]; then
    return 0 # nothing running; nothing to signal
  fi

  main_pids=$(tv_main_pids) || { observation_error; return 1; }
  if [ -z "$main_pids" ]; then
    echo "Error: TradingView bundle-owned processes are running, but no main process"
    echo "($APP) could be identified. Refusing to signal helper processes (fail closed)."
    list_bundle_processes
    echo "Quit TradingView manually, then re-run this script."
    return 1
  fi

  main_count=$(printf '%s\n' "$main_pids" | wc -l | tr -d ' ')
  if [ "$main_count" -ne 1 ]; then
    echo "Error: expected exactly one TradingView main process, found $main_count:"
    printf '%s\n' "$main_pids"
    echo "Refusing to guess a termination target (fail closed). Quit TradingView manually, then re-run."
    return 1
  fi

  main_pid="$main_pids"
  # Identity recheck at the instant of signalling. A PID that is simply GONE
  # is fine — teardown may already be underway and the drain check below
  # adjudicates; a PID whose executable CHANGED is refused.
  comm_now=$(ps -p "$main_pid" -o comm= 2>/dev/null); psrc=$?
  if [ "$psrc" -eq 0 ] && [ "$comm_now" != "$APP" ]; then
    echo "Error: PID $main_pid no longer runs the resolved executable (now: $comm_now)."
    echo "Refusing to signal (fail closed)."
    return 1
  fi
  if [ "$psrc" -eq 0 ]; then
    echo "Existing TradingView instance found (main PID $main_pid)."
    echo "Sending one SIGTERM to the main process only..."
    kill -TERM "$main_pid" 2>/dev/null \
      || echo "(SIGTERM not delivered — the process may have just exited; relying on the drain check)"
  else
    echo "Main PID $main_pid exited before signalling; waiting for the bundle set to drain."
  fi

  i=0
  while [ "$i" -lt "$DRAIN_TIMEOUT_POLLS" ]; do
    sleep "$DRAIN_POLL_INTERVAL"
    bundle_pids=$(tv_bundle_pids) || { observation_error; return 1; }
    if [ -z "$bundle_pids" ]; then
      echo "Teardown complete: TradingView bundle process set is empty."
      return 0
    fi
    i=$((i + 1))
  done

  echo "Error: TradingView processes are still present after the drain timeout. FAILING CLOSED:"
  echo "no relaunch, and no broader kill will be attempted. Still running:"
  list_bundle_processes
  echo "Quit TradingView manually, then re-run this script."
  return 1
}

launch_with_cdp() {
  echo "Found TradingView at: $APP"
  echo "Launching with --remote-debugging-port=$PORT ..."
  "$APP" --remote-debugging-port="$PORT" &
  TV_PID=$!
  echo "PID: $TV_PID"

  # Wait for CDP to be ready
  echo "Waiting for CDP..."
  local i
  for i in $(seq 1 15); do
    if curl -s "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
      echo "CDP ready at http://localhost:$PORT"
      curl -s "http://localhost:$PORT/json/version" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:$PORT/json/version"
      return 0
    fi
    sleep 1
  done

  echo "Warning: CDP not responding after 15s. TradingView may still be loading."
  echo "Check manually: curl http://localhost:$PORT/json/version"
}

launch_tv_debug_main() {
  resolve_app || exit 1
  teardown_existing || exit 1
  launch_with_cdp
}

# Sourcing this file (e.g. from tests) loads the functions without executing;
# running it directly performs the launch.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  launch_tv_debug_main "$@"
fi
