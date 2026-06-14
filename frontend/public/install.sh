#!/bin/bash
# BuilderForce Agents — installer & agent-host connector (macOS / Linux).
#
# Installs the BuilderForce Agents runtime (the `builderforce` CLI). When a
# workspace token is present in the environment — which the "Connect a new agent"
# one-liner on https://builderforce.ai/workforce sets via BUILDERFORCE_TOKEN /
# BUILDERFORCE_WORKSPACE — it also registers THIS machine as an agent host in
# your workgroup and starts the gateway so it shows up online.
#
# Run via:
#   curl -fsSL https://builderforce.ai/install.sh | bash
# The token/workspace are read from the environment by `builderforce connect`,
# so they never appear on the command line / in shell history.
#
# Env vars:
#   BUILDERFORCE_TOKEN      workspace token (triggers auto-register)
#   BUILDERFORCE_WORKSPACE  workgroup slug to register into
#   BUILDERFORCE_URL        API base URL (default https://api.builderforce.ai)
#   BUILDERFORCE_TAG        npm dist-tag/version to install (default latest)
#   BUILDERFORCE_NO_START   set to skip starting the gateway after registering
set -eu

BOLD='\033[1m'; CYAN='\033[38;2;0;229;204m'; GREEN='\033[38;2;0;229;204m'
RED='\033[38;2;230;57;70m'; DIM='\033[38;2;136;146;176m'; YELLOW='\033[38;2;255;176;32m'; NC='\033[0m'
say() { printf '%b\n' "${1:-}"; }

say ""
say "  ${CYAN}╔═══════════════════════════════════════════════╗${NC}"
say "  ${CYAN}║      ${BOLD}BuilderForce.ai  Agent  Installer${NC}${CYAN}         ║${NC}"
say "  ${CYAN}╚═══════════════════════════════════════════════╝${NC}"
say ""

# 1. Preflight — the runtime is a Node.js CLI, so npm must be available.
if ! command -v npm >/dev/null 2>&1; then
  say "  ${RED}X  Node.js / npm was not found on PATH.${NC}"
  say "     ${DIM}Install Node.js 20+ from https://nodejs.org and re-run this command.${NC}"
  say ""
  exit 1
fi

# 2. Install the runtime CLI.
TAG="${BUILDERFORCE_TAG:-latest}"
say "  ${DIM}Installing the BuilderForce Agents runtime (@seanhogg/builderforce-agents@${TAG})...${NC}"
if ! npm install -g "@seanhogg/builderforce-agents@${TAG}"; then
  say "  ${RED}X  Could not install the runtime.${NC}"
  say ""
  exit 1
fi
say "  ${GREEN}OK  Runtime installed — try 'builderforce --help'.${NC}"

# 3. Resolve the API URL (env > default).
API_URL="${BUILDERFORCE_URL:-https://api.builderforce.ai}"

# 4. If a workspace token is present, register this machine + (optionally) start.
if [ -n "${BUILDERFORCE_TOKEN:-}" ]; then
  export BUILDERFORCE_URL="$API_URL"
  say ""
  say "  ${DIM}Registering this machine as an agent host...${NC}"
  if ! builderforce connect; then
    say "  ${RED}X  Registration failed.${NC}"
    say ""
    exit 1
  fi

  if [ -n "${BUILDERFORCE_NO_START:-}" ]; then
    say ""
    say "  ${DIM}Start the agent any time with:  builderforce gateway${NC}"
  else
    say ""
    say "  ${DIM}Starting the gateway (Ctrl+C to stop)...${NC}"
    builderforce gateway
  fi
else
  say ""
  say "  ${YELLOW}No workspace token in this session.${NC}"
  say "  ${DIM}- To connect interactively:  builderforce onboard${NC}"
  say "  ${DIM}- Or copy the 'Connect a new agent' command from${NC}"
  say "  ${DIM}    https://builderforce.ai/workforce (it carries your workspace token).${NC}"
fi

say ""
