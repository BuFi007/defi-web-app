#!/usr/bin/env bash
# Wire the matcher's vendored skills into .claude/skills/ so Claude Code
# picks them up at session start. Idempotent — safe to re-run.
#
# Skills tracked in-tree:
#   - services/matcher/skills/rust-matcher        (master /rust-matcher skill)
#   - .agents/skills/<name>/                      (6 npx-installed packs)
#   - references/actionbook-rust-skills/skills/*  (32 actionbook skills, Phase 0)
#
# Run from the worktree root:
#   bash services/matcher/skills/setup.sh

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
mkdir -p .claude/skills

link() {
  local src=$1
  local name=$2
  local dst=.claude/skills/$name
  if [ -L "$dst" ] || [ -e "$dst" ]; then
    rm -rf "$dst"
  fi
  ln -s "$src" "$dst"
  echo "linked $name -> $src"
}

# 1. Master matcher skill.
link "../../services/matcher/skills/rust-matcher" rust-matcher

# 2. npx-installed packs under .agents/skills/.
if [ -d .agents/skills ]; then
  for s in .agents/skills/*/; do
    n=$(basename "$s")
    link "../../$s" "$n"
  done
fi

# 3. actionbook/rust-skills clone under references/ (Phase 0 install).
if [ -d references/actionbook-rust-skills/skills ]; then
  for s in references/actionbook-rust-skills/skills/*/; do
    n=$(basename "$s")
    # Don't clobber an already-linked skill of the same name (the npx
    # m15-anti-pattern install wins over the actionbook clone if both exist).
    if [ ! -L ".claude/skills/$n" ]; then
      link "../../$s" "$n"
    fi
  done
fi

echo
echo "Done. Restart your Claude Code session for the new skills to load."
