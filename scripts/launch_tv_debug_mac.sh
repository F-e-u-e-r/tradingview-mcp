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
#     measured false positive, issue #6 direction 1.)
#   * One SIGTERM to the main PID tears down the entire bundle-owned process
#     set, including the ppid=1 crashpad handler (measured full-clear: 2.16s
#     and 4.28s). Helpers and crashpad are never signalled directly.
#   * Teardown completion is a STATE, not a delay: the bundle-owned process
#     set must be observed EMPTY (it can transiently GROW mid-teardown —
#     measured), bounded by DRAIN_TIMEOUT_POLLS. On timeout this script FAILS
#     CLOSED: it reports and exits without relaunching; it never escalates to
#     a broader kill and never "finishes off" helpers.
#   * Bundle-owned processes present with no identifiable main process:
#     abort rather than touch helpers (fail closed).
#   * Why teardown exists at all (direction 2): with an instance alive, a
#     direct relaunch with --remote-debugging-port prints "DevTools
#     listening", exits 0, and leaves NO durable CDP endpoint — the port dies
#     with the singleton-handoff process (measured). Skipping teardown does
#     not work; it only looks like it worked.

PORT="${1:-9222}"
APP=""
BUNDLE=""

# Bundle-set drain bound: 50 polls x 0.2s = 10s (adjudicated; measured
# teardowns took 2.16s and 4.28s, so the previous fixed `sleep 1` was wrong
# in both directions — too short to be safe, yet unconditionally spent).
DRAIN_TIMEOUT_POLLS=50
DRAIN_POLL_INTERVAL=0.2

resolve_app() {
  APP=""
  local loc
  local locations=(
    "/Applications/TradingView.app/Contents/MacOS/TradingView"
    "$HOME/Applications/TradingView.app/Contents/MacOS/TradingView"
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
      APP="$APP/Contents/MacOS/TradingView"
    fi
  fi

  # Fallback: find any TradingView.app
  if [ -z "$APP" ] || [ ! -f "$APP" ]; then
    APP=$(find /Applications "$HOME/Applications" -name "TradingView.app" -maxdepth 2 2>/dev/null | head -1)
    if [ -n "$APP" ]; then
      APP="$APP/Contents/MacOS/TradingView"
    fi
  fi

  if [ -z "$APP" ] || [ ! -f "$APP" ]; then
    echo "Error: TradingView not found."
    echo "Checked: /Applications/TradingView.app, ~/Applications/TradingView.app"
    echo ""
    echo "If installed elsewhere, run manually:"
    echo "  /path/to/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=$PORT"
    return 1
  fi
  BUNDLE="${APP%/Contents/MacOS/TradingView}"
}

# PIDs whose EXECUTABLE PATH equals the resolved main binary exactly.
# ps `comm` is the executable path, not the argument list, so an unrelated
# process that merely mentions the path in its arguments does not match.
tv_main_pids() {
  ps -axo pid=,comm= | awk -v app="$APP" '
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
tv_bundle_pids() {
  ps -axo pid=,comm= | awk -v prefix="$BUNDLE/" '
    {
      pid = $1
      line = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", line)
      if (index(line, prefix) == 1) print pid
    }
  '
}

list_bundle_processes() {
  ps -axo pid=,comm= | awk -v prefix="$BUNDLE/" '
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
  local bundle_pids main_pids main_count main_pid i
  bundle_pids=$(tv_bundle_pids)
  if [ -z "$bundle_pids" ]; then
    return 0 # nothing running; nothing to signal
  fi

  main_pids=$(tv_main_pids)
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
  echo "Existing TradingView instance found (main PID $main_pid)."
  echo "Sending one SIGTERM to the main process only..."
  kill -TERM "$main_pid" 2>/dev/null \
    || echo "(SIGTERM not delivered — the process may have already exited; relying on the drain check)"

  i=0
  while [ "$i" -lt "$DRAIN_TIMEOUT_POLLS" ]; do
    sleep "$DRAIN_POLL_INTERVAL"
    bundle_pids=$(tv_bundle_pids)
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
