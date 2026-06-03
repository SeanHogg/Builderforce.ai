#!/usr/bin/env bash
set -euo pipefail

cd /repo

export BUILDERFORCE_AGENTS_STATE_DIR="/tmp/builderforce-test"
export BUILDERFORCE_AGENTS_CONFIG_PATH="${BUILDERFORCE_AGENTS_STATE_DIR}/builderforce.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${BUILDERFORCE_AGENTS_STATE_DIR}/credentials"
mkdir -p "${BUILDERFORCE_AGENTS_STATE_DIR}/agents/main/sessions"
echo '{}' >"${BUILDERFORCE_AGENTS_CONFIG_PATH}"
echo 'creds' >"${BUILDERFORCE_AGENTS_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${BUILDERFORCE_AGENTS_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm builderforce reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${BUILDERFORCE_AGENTS_CONFIG_PATH}"
test ! -d "${BUILDERFORCE_AGENTS_STATE_DIR}/credentials"
test ! -d "${BUILDERFORCE_AGENTS_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${BUILDERFORCE_AGENTS_STATE_DIR}/credentials"
echo '{}' >"${BUILDERFORCE_AGENTS_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm builderforce uninstall --state --yes --non-interactive

test ! -d "${BUILDERFORCE_AGENTS_STATE_DIR}"

echo "OK"
