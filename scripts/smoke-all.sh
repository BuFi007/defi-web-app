#!/usr/bin/env bash
# Runs the per-surface smoke trio in sequence: perps, bento, telarana.
#
# After creating/refreshing this file, the writer should `chmod +x
# scripts/smoke-all.sh` to make it directly executable. Without the
# executable bit you can still invoke it via `bash scripts/smoke-all.sh`.
#
# Env passthrough: every SMOKE_* env var the individual smokes read is
# inherited from the calling shell — this script does NOT shadow them.
# Override the API URL across all three with `SMOKE_API_URL=...`, or
# tune each smoke independently (e.g. SMOKE_TELARANA_MARKET_KEY=M2_USDC_EURC).
#
# Exit code: non-zero on first failure, with a `FAIL at <name>` line so a CI
# log scan can pinpoint the broken surface without scrolling.
#
# Usage: scripts/smoke-all.sh   (or `bash scripts/smoke-all.sh`)

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

run_smoke() {
  local name="$1"
  local script="$2"
  echo
  echo "=== smoke-${name} ==="
  if ! (cd "${ROOT_DIR}" && bun run "${script}"); then
    echo
    echo "FAIL at smoke-${name}" >&2
    exit 1
  fi
}

run_smoke "perps"    "scripts/smoke-perps.ts"
run_smoke "bento"    "scripts/smoke-bento.ts"
run_smoke "telarana" "scripts/smoke-telarana.ts"

echo
echo "=== smoke-all OK ==="
