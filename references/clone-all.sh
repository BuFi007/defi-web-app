#!/usr/bin/env bash
# Shallow-clone every reference repo listed in docs/matcher-architecture.md.
# Idempotent: skips repos that already have a .git dir.
#
# Usage:
#   bash references/clone-all.sh         # all repos
#   bash references/clone-all.sh prio    # just the 4 priority repos
#
# Disk: ~600MB-1.5GB depending on filters host accepts.

set -u

cd "$(dirname "$0")"

# Each line: <local-dirname> <git-url>
ALL_REPOS=$(cat <<'EOF'
Polymarket-ctf-exchange-v2          https://github.com/Polymarket/ctf-exchange-v2
Polymarket-ctf-exchange             https://github.com/Polymarket/ctf-exchange
Polymarket-rs-clob-client-v2        https://github.com/Polymarket/rs-clob-client-v2
ahollic-polymarket-architecture     https://github.com/ahollic/polymarket-architecture
KaustubhPatange-polymarket-trade-engine https://github.com/KaustubhPatange/polymarket-trade-engine
dydxprotocol-v4-chain               https://github.com/dydxprotocol/v4-chain
drift-labs-protocol-v2              https://github.com/drift-labs/protocol-v2
drift-labs-drift-rs                 https://github.com/drift-labs/drift-rs
drift-labs-gateway                  https://github.com/drift-labs/gateway
drift-labs-keep-rs                  https://github.com/drift-labs/keep-rs
gmx-io-gmx-contracts                https://github.com/gmx-io/gmx-contracts
gmx-io-gmx-synthetics               https://github.com/gmx-io/gmx-synthetics
Fkleppe-awesome-perp-trading        https://github.com/Fkleppe/awesome-perp-trading
joaquinbejar-OrderBook-rs           https://github.com/joaquinbejar/OrderBook-rs
auralshin-orderbook                 https://github.com/auralshin/orderbook
dylanlott-orderflow                 https://github.com/dylanlott/orderflow
hroptatyr-clob                      https://github.com/hroptatyr/clob
hyperium-tonic                      https://github.com/hyperium/tonic
paupino-rust-decimal                https://github.com/paupino/rust-decimal
EOF
)

PRIO_REPOS=$(cat <<'EOF'
Polymarket-ctf-exchange-v2          https://github.com/Polymarket/ctf-exchange-v2
Polymarket-rs-clob-client-v2        https://github.com/Polymarket/rs-clob-client-v2
dydxprotocol-v4-chain               https://github.com/dydxprotocol/v4-chain
joaquinbejar-OrderBook-rs           https://github.com/joaquinbejar/OrderBook-rs
drift-labs-protocol-v2              https://github.com/drift-labs/protocol-v2
EOF
)

case "${1:-all}" in
  prio) LIST="$PRIO_REPOS" ;;
  all)  LIST="$ALL_REPOS"  ;;
  *)    echo "Usage: $0 [all|prio]"; exit 1 ;;
esac

clone_one() {
  local dir="$1" url="$2"
  if [ -d "$dir/.git" ]; then
    echo "  ✓ $dir already cloned, skipping"
    return 0
  fi
  echo "→ $dir"
  # --depth=1 + --filter=blob:none for minimum disk
  if git clone --depth=1 --filter=blob:none "$url" "$dir" 2>&1 | tail -3 | sed 's/^/    /'; then
    echo "  ✓ $dir"
  else
    echo "  ✗ $dir (failed — see error above)"
    return 1
  fi
}

export -f clone_one

echo "$LIST" | while read -r dir url; do
  [ -z "$dir" ] && continue
  clone_one "$dir" "$url" &
  # Cap parallelism at 6
  if [ "$(jobs -r | wc -l)" -ge 6 ]; then wait -n 2>/dev/null || wait; fi
done
wait

echo
echo "Done. Disk usage:"
du -sh references/* 2>/dev/null | sort -h | tail -20
