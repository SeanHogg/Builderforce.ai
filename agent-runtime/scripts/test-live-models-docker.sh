#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${BUILDERFORCE_AGENTS_IMAGE:-${BUILDERFORCE_AGENTS_IMAGE:-builderforce:local}}"
CONFIG_DIR="${BUILDERFORCE_AGENTS_CONFIG_DIR:-${BUILDERFORCE_AGENTS_CONFIG_DIR:-$HOME/.builderforce}}"
WORKSPACE_DIR="${BUILDERFORCE_AGENTS_WORKSPACE_DIR:-${BUILDERFORCE_AGENTS_WORKSPACE_DIR:-$HOME/.builderforce/workspace}}"
PROFILE_FILE="${BUILDERFORCE_AGENTS_PROFILE_FILE:-${BUILDERFORCE_AGENTS_PROFILE_FILE:-$HOME/.profile}}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e BUILDERFORCE_AGENTS_LIVE_TEST=1 \
  -e BUILDERFORCE_AGENTS_LIVE_MODELS="${BUILDERFORCE_AGENTS_LIVE_MODELS:-${BUILDERFORCE_AGENTS_LIVE_MODELS:-all}}" \
  -e BUILDERFORCE_AGENTS_LIVE_PROVIDERS="${BUILDERFORCE_AGENTS_LIVE_PROVIDERS:-${BUILDERFORCE_AGENTS_LIVE_PROVIDERS:-}}" \
  -e BUILDERFORCE_AGENTS_LIVE_MODEL_TIMEOUT_MS="${BUILDERFORCE_AGENTS_LIVE_MODEL_TIMEOUT_MS:-${BUILDERFORCE_AGENTS_LIVE_MODEL_TIMEOUT_MS:-}}" \
  -e BUILDERFORCE_AGENTS_LIVE_REQUIRE_PROFILE_KEYS="${BUILDERFORCE_AGENTS_LIVE_REQUIRE_PROFILE_KEYS:-${BUILDERFORCE_AGENTS_LIVE_REQUIRE_PROFILE_KEYS:-}}" \
  -v "$CONFIG_DIR":/home/node/.builderforce \
  -v "$WORKSPACE_DIR":/home/node/.builderforce/workspace \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
