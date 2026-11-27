#!/usr/bin/env bash
set -euo pipefail

required=${1:?API commit required}
live=$(curl -fsS --max-time 20 https://api.builderforce.ai/health | jq -er .commit)
if [[ ! "$live" =~ ^[a-f0-9]{40}$ ]]; then
  echo "::error::The production API did not report a valid commit."
  exit 1
fi
status=$(gh api "repos/${GH_REPO}/compare/${required}...${live}" --jq .status)
if [[ "$status" != identical && "$status" != ahead ]]; then
  echo "::error::The production API at $live must include $required before client publication."
  exit 1
fi
