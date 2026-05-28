#!/usr/bin/env bash
# Fire the whole stack in background. Logs to /tmp/bufi-*.log.
# Web on https://localhost:3001 (mkcert-trusted self-signed).
# Stop with: bun run dev:down

set -u
LOG_DIR="/tmp"
WEB_LOG="$LOG_DIR/bufi-web.log"
REST_LOG="$LOG_DIR/bufi-rest.log"
PID_FILE="$LOG_DIR/bufi-dev.pids"

# 1. Kill any stale procs on our ports
for p in 3000 3001 3002 3003 3004 3005 3006 42069; do
  pids=$(lsof -ti :$p 2>/dev/null || true)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done
rm -f "$PID_FILE"

# 2. Boot web (https) + everything-else in background
cd "$(dirname "$0")/.."

# Export .env.local so cargo subprocess (matcher) sees KEEPER_PRIVATE_KEY etc.
# Bun's auto-source feeds JS subprocesses but not cargo. Without this the
# Rust matcher exits at boot with `no signer set`.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# Pin matcher DB to the root .bufi/ — without this it tries to write to
# services/matcher/.bufi/ (its CWD) which doesn't exist, and SQLite
# refuses to create parent dirs ("unable to open database file").
mkdir -p .bufi
export BUFI_DB_PATH="$PWD/.bufi/trading-machine.sqlite"

# Use HTTPS only when explicitly requested (BUFI_HTTPS=1 or dev:complete:https).
# Default to plain HTTP on :3000 — avoids self-signed cert pain in browsers.
if [ "${BUFI_HTTPS:-}" = "1" ]; then
  nohup bun run --filter @bufi/web dev:https </dev/null >"$WEB_LOG" 2>&1 &
else
  nohup bun run --filter @bufi/web dev </dev/null >"$WEB_LOG" 2>&1 &
fi
echo "$!" >>"$PID_FILE"

# Keep API and matcher in separate process groups. The matcher touches live
# RPCs during boot; if it exits, the API should stay up for UI/API dogfood.
: >"$REST_LOG"
nohup bun run --filter @bufi/api dev </dev/null >>"$REST_LOG" 2>&1 &
echo "$!" >>"$PID_FILE"
nohup bun run --filter @bufi/matcher dev </dev/null >>"$REST_LOG" 2>&1 &
echo "$!" >>"$PID_FILE"

# 3. Wait for web + key services to bind
echo "Booting BUFI dev stack..."
wait_port() {
  local port=$1 label=$2 max=${3:-60}
  for i in $(seq 1 "$max"); do
    if lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      printf "  ✓ %-12s :%d\n" "$label" "$port"
      return 0
    fi
    sleep 1
  done
  printf "  ✗ %-12s :%d  (timeout — see %s)\n" "$label" "$port" "$REST_LOG"
  return 1
}

if [ "${BUFI_HTTPS:-}" = "1" ]; then
  WEB_PORT=3001; WEB_LABEL="web https"; WEB_URL="https://localhost:3001"
else
  WEB_PORT=3000; WEB_LABEL="web"; WEB_URL="http://localhost:3000"
fi

wait_port "$WEB_PORT" "$WEB_LABEL" 60 || true
wait_port 3002 "api"         45 || true
wait_port 3005 "matcher gRPC" 90 || true
lsof -i :3006 -sTCP:LISTEN >/dev/null 2>&1 && printf "  ✓ matcher HTTP :3006\n" || printf "  · matcher HTTP :3006  (not on this branch, gRPC is canonical)\n"

ENVIO_URL_DISPLAY="${ENVIO_GRAPHQL_URL:-${ENVIO_URL:-https://indexer.dev.hyperindex.xyz/6ff8fed/v1/graphql}}"

cat <<EOF

→ Web:      $WEB_URL
→ API:      http://localhost:3002
→ Matcher:  gRPC localhost:3005
→ Envio:    $ENVIO_URL_DISPLAY

Logs:
  tail -f /tmp/bufi-web.log     # web only
  tail -f /tmp/bufi-rest.log    # everything else
  bun run dev:logs              # both

Stop the stack:
  bun run dev:down
EOF
