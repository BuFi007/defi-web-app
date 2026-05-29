#!/usr/bin/env bash
# Fire the whole stack in background. Logs to /tmp/bufi-*.log.
# Web on https://localhost:3001 (mkcert-trusted self-signed).
# Stop with: bun run dev:down

set -u
LOG_DIR="/tmp"
WEB_LOG="$LOG_DIR/bufi-web.log"
REST_LOG="$LOG_DIR/bufi-rest.log"
RELAYER_LOG="$LOG_DIR/bufi-relayer.log"
MCP_LOG="$LOG_DIR/bufi-mcp.log"
PID_FILE="$LOG_DIR/bufi-dev.pids"
# Privacy relayer + MCP ports (the ghost private flow runs here).
RELAYER_PORT="${RELAYER_PORT:-8787}"
MCP_PORT="${MCP_PORT:-4002}"

# 1. Kill any stale procs on our ports (incl. relayer + MCP)
for p in 3000 3001 3002 3003 3004 3005 3006 42069 "$MCP_PORT" "$RELAYER_PORT"; do
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

# 2b. Privacy relayer (fx-Telaraña relayer-privacy) + the hyper-mcp, wired together
# so the full ghost private flow works locally: deposit -> proof -> relayer-submitted
# withdrawal (relayer = on-chain msg.sender, not the user). The relayer self-skips
# if no key resolves (see scripts/dev-relayer.sh); the MCP still boots either way.
export RELAYER_PORT MCP_PORT
export GHOST_RELAYER_URL="${GHOST_RELAYER_URL:-http://localhost:$RELAYER_PORT}"
: >"$RELAYER_LOG"
nohup bash scripts/dev-relayer.sh </dev/null >>"$RELAYER_LOG" 2>&1 &
echo "$!" >>"$PID_FILE"
: >"$MCP_LOG"
nohup bash -c "cd '$PWD/apps/hyper-mcp' && GHOST_RELAYER_URL='$GHOST_RELAYER_URL' PORT='$MCP_PORT' exec bun src/app.ts" </dev/null >>"$MCP_LOG" 2>&1 &
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
wait_port "$MCP_PORT" "hyper-mcp" 45 || true
# Relayer is optional (skips without a key) — report status without failing the stack.
if lsof -i :"$RELAYER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  printf "  ✓ %-12s :%d\n" "relayer" "$RELAYER_PORT"
else
  printf "  · %-12s :%d  (skipped — no PRIVATE_KEY; see %s)\n" "relayer" "$RELAYER_PORT" "$RELAYER_LOG"
fi

ENVIO_URL_DISPLAY="${ENVIO_GRAPHQL_URL:-${ENVIO_URL:-https://indexer.dev.hyperindex.xyz/6ff8fed/v1/graphql}}"

cat <<EOF

→ Web:      $WEB_URL
→ API:      http://localhost:3002
→ Matcher:  gRPC localhost:3005
→ MCP:      http://localhost:$MCP_PORT  (GHOST_RELAYER_URL=$GHOST_RELAYER_URL)
→ Relayer:  http://localhost:$RELAYER_PORT  (ghost private withdrawals)
→ Envio:    $ENVIO_URL_DISPLAY

Logs:
  tail -f /tmp/bufi-web.log       # web only
  tail -f /tmp/bufi-rest.log      # api + matcher
  tail -f /tmp/bufi-relayer.log   # privacy relayer
  tail -f /tmp/bufi-mcp.log       # hyper-mcp
  bun run dev:logs                # all

Stop the stack:
  bun run dev:down
EOF
