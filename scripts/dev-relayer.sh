#!/usr/bin/env bash
# Boot the privacy relayer-api (fx-Telaraña relayer-privacy) for local dev so the
# full ghost private flow (deposit -> proof -> relayer-submitted withdrawal) works
# end-to-end against a local MCP. The relayer is the on-chain msg.sender, so
# withdrawals don't leak the user's wallet.
#
#   bun run dev:relayer            # standalone, foreground
#   (also launched by scripts/dev-up.sh as part of dev:complete)
#
# Key resolution (first hit wins; nothing is committed):
#   1. $RELAYER_PRIVATE_KEY        explicit env
#   2. $PRIVATE_KEY                explicit env
#   3. ../fx-telarana/packages/relayer-privacy/.env.arc   PRIVATE_KEY=
#   4. ../fx-telarana/contracts/.env.local                DEPLOYER_PRIVATE_KEY=
# If none resolve, the relayer is skipped with a clear message (dev stack still
# boots; relayerSubmission.available just stays false until a key is provided).
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX_DIR="${FX_TELARANA_DIR:-$REPO_ROOT/../fx-telarana}"
RELAYER_DIR="$FX_DIR/packages/relayer-privacy"

if [ ! -d "$RELAYER_DIR" ]; then
  echo "dev:relayer — fx-telarana relayer not found at $RELAYER_DIR (set FX_TELARANA_DIR). Skipping."
  exit 0
fi

read_env() { # file, key
  [ -f "$1" ] || return 1
  grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r' | sed 's/[[:space:]]*$//'
}

KEY="${RELAYER_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
[ -z "$KEY" ] && KEY="$(read_env "$RELAYER_DIR/.env.arc" PRIVATE_KEY)"
[ -z "$KEY" ] || [ "$KEY" = "0x" ] && KEY="$(read_env "$FX_DIR/contracts/.env.local" DEPLOYER_PRIVATE_KEY)"

if [ -z "$KEY" ] || [ "$KEY" = "0x" ]; then
  echo "dev:relayer — no PRIVATE_KEY resolved (set RELAYER_PRIVATE_KEY, or fill $RELAYER_DIR/.env.arc). Skipping relayer."
  exit 0
fi
case "$KEY" in 0x*) : ;; *) KEY="0x$KEY";; esac

export RPC_URL="${RPC_URL:-https://rpc.drpc.testnet.arc.network}"
export ENTRYPOINT_ADDRESS="${ENTRYPOINT_ADDRESS:-0xD11cDdd1f04e850d3810a71608A49907c80f2736}"
export RELAYER_PORT="${RELAYER_PORT:-8787}"
export RELAYER_MAX_FEE_BPS="${RELAYER_MAX_FEE_BPS:-500}"
export RELAYER_RATE_LIMIT_PER_MIN="${RELAYER_RATE_LIMIT_PER_MIN:-60}"
# relayer-api reads DRY_RUN === "true" exactly; normalize the RELAYER_DRY_RUN toggle.
case "${RELAYER_DRY_RUN:-}" in 1|true|yes|TRUE) export DRY_RUN=true ;; *) export DRY_RUN=false ;; esac
export PRIVATE_KEY="$KEY"

echo "dev:relayer — starting relayer-api on :$RELAYER_PORT (entrypoint $ENTRYPOINT_ADDRESS, dryRun=$DRY_RUN)"
exec bun run --cwd "$RELAYER_DIR" relayer-api
