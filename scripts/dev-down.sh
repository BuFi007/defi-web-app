#!/usr/bin/env bash
# Stop the BUFI dev stack started by scripts/dev-up.sh.
set -u
LOG_DIR="/tmp"
PID_FILE="$LOG_DIR/bufi-dev.pids"

# Kill tracked PIDs (parent bun shells) first
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
  done <"$PID_FILE"
  sleep 1
fi

# Kill anything still bound to our ports (defensive — child procs)
for p in 3001 3002 3003 3004 3005 3006 42069; do
  pids=$(lsof -ti :$p 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
    echo "  killed :$p"
  fi
done

# Catch any orphaned bun --filter / next dev / matcher / keeper procs
pkill -9 -f "next dev --experimental-https" 2>/dev/null || true
pkill -9 -f "matcher-server\|bufi-matc" 2>/dev/null || true
pkill -9 -f "ponder dev" 2>/dev/null || true
pkill -9 -f "@bufi/keeper" 2>/dev/null || true

rm -f "$PID_FILE"
echo "✓ stack stopped"
