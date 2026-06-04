#!/usr/bin/env bash
# AgentNodeDock - Docker helpers for BuilderForceAgents
# Inspired by Simon Willison's "Running BuilderForceAgents in Docker"
# https://til.simonwillison.net/llms/builderforce-docker
#
# Installation:
#   mkdir -p ~/.agentNodedock && curl -sL https://raw.githubusercontent.com/builderforce/builderforce/main/scripts/shell-helpers/agentNodedock-helpers.sh -o ~/.agentNodedock/agentNodedock-helpers.sh
#   echo 'source ~/.agentNodedock/agentNodedock-helpers.sh' >> ~/.zshrc
#
# Usage:
#   agentNodedock-help    # Show all available commands

# =============================================================================
# Colors
# =============================================================================
_CLR_RESET='\033[0m'
_CLR_BOLD='\033[1m'
_CLR_DIM='\033[2m'
_CLR_GREEN='\033[0;32m'
_CLR_YELLOW='\033[1;33m'
_CLR_BLUE='\033[0;34m'
_CLR_MAGENTA='\033[0;35m'
_CLR_CYAN='\033[0;36m'
_CLR_RED='\033[0;31m'

# Styled command output (green + bold)
_clr_cmd() {
  echo -e "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# Inline command for use in sentences
_cmd() {
  echo "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# =============================================================================
# Config
# =============================================================================
CLAWDOCK_CONFIG="${HOME}/.agentNodedock/config"

# Common paths to check for BuilderForceAgents
CLAWDOCK_COMMON_PATHS=(
  "${HOME}/builderforce"
  "${HOME}/workspace/builderforce"
  "${HOME}/projects/builderforce"
  "${HOME}/dev/builderforce"
  "${HOME}/code/builderforce"
  "${HOME}/src/builderforce"
)

_agentNodedock_filter_warnings() {
  grep -v "^WARN\|^time="
}

_agentNodedock_trim_quotes() {
  local value="$1"
  value="${value#\"}"
  value="${value%\"}"
  printf "%s" "$value"
}

_agentNodedock_read_config_dir() {
  if [[ ! -f "$CLAWDOCK_CONFIG" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^CLAWDOCK_DIR=//p' "$CLAWDOCK_CONFIG" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _agentNodedock_trim_quotes "$raw"
}

# Ensure CLAWDOCK_DIR is set and valid
_agentNodedock_ensure_dir() {
  # Already set and valid?
  if [[ -n "$CLAWDOCK_DIR" && -f "${CLAWDOCK_DIR}/docker-compose.yml" ]]; then
    return 0
  fi

  # Try loading from config
  local config_dir
  config_dir=$(_agentNodedock_read_config_dir)
  if [[ -n "$config_dir" && -f "${config_dir}/docker-compose.yml" ]]; then
    CLAWDOCK_DIR="$config_dir"
    return 0
  fi

  # Auto-detect from common paths
  local found_path=""
  for path in "${CLAWDOCK_COMMON_PATHS[@]}"; do
    if [[ -f "${path}/docker-compose.yml" ]]; then
      found_path="$path"
      break
    fi
  done

  if [[ -n "$found_path" ]]; then
    echo ""
    echo "🦞 Found BuilderForceAgents at: $found_path"
    echo -n "   Use this location? [Y/n] "
    read -r response
    if [[ "$response" =~ ^[Nn] ]]; then
      echo ""
      echo "Set CLAWDOCK_DIR manually:"
      echo "  export CLAWDOCK_DIR=/path/to/builderforce"
      return 1
    fi
    CLAWDOCK_DIR="$found_path"
  else
    echo ""
    echo "❌ BuilderForceAgents not found in common locations."
    echo ""
    echo "Clone it first:"
    echo ""
    echo "  git clone https://github.com/seanhogg/builderforce.git ~/builderforce"
    echo "  cd ~/builderforce && ./docker-setup.sh"
    echo ""
    echo "Or set CLAWDOCK_DIR if it's elsewhere:"
    echo ""
    echo "  export CLAWDOCK_DIR=/path/to/builderforce"
    echo ""
    return 1
  fi

  # Save to config
  if [[ ! -d "${HOME}/.agentNodedock" ]]; then
    /bin/mkdir -p "${HOME}/.agentNodedock"
  fi
  echo "CLAWDOCK_DIR=\"$CLAWDOCK_DIR\"" > "$CLAWDOCK_CONFIG"
  echo "✅ Saved to $CLAWDOCK_CONFIG"
  echo ""
  return 0
}

# Wrapper to run docker compose commands
_agentNodedock_compose() {
  _agentNodedock_ensure_dir || return 1
  command docker compose -f "${CLAWDOCK_DIR}/docker-compose.yml" "$@"
}

_agentNodedock_read_env_token() {
  _agentNodedock_ensure_dir || return 1
  if [[ ! -f "${CLAWDOCK_DIR}/.env" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^BUILDERFORCE_AGENTS_GATEWAY_TOKEN=//p' "${CLAWDOCK_DIR}/.env" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _agentNodedock_trim_quotes "$raw"
}

# Basic Operations
agentNodedock-start() {
  _agentNodedock_compose up -d builderforce-gateway
}

agentNodedock-stop() {
  _agentNodedock_compose down
}

agentNodedock-restart() {
  _agentNodedock_compose restart builderforce-gateway
}

agentNodedock-logs() {
  _agentNodedock_compose logs -f builderforce-gateway
}

agentNodedock-status() {
  _agentNodedock_compose ps
}

# Navigation
agentNodedock-cd() {
  _agentNodedock_ensure_dir || return 1
  cd "${CLAWDOCK_DIR}"
}

agentNodedock-config() {
  cd ~/.builderforce
}

agentNodedock-workspace() {
  cd ~/.builderforce/workspace
}

# Container Access
agentNodedock-shell() {
  _agentNodedock_compose exec builderforce-gateway \
    bash -c 'echo "alias builderforce=\"./builderforce.mjs\"" > /tmp/.bashrc_builderforce && bash --rcfile /tmp/.bashrc_builderforce'
}

agentNodedock-exec() {
  _agentNodedock_compose exec builderforce-gateway "$@"
}

agentNodedock-cli() {
  _agentNodedock_compose run --rm builderforce-cli "$@"
}

# Maintenance
agentNodedock-rebuild() {
  _agentNodedock_compose build builderforce-gateway
}

agentNodedock-clean() {
  _agentNodedock_compose down -v --remove-orphans
}

# Health check
agentNodedock-health() {
  _agentNodedock_ensure_dir || return 1
  local token
  token=$(_agentNodedock_read_env_token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${CLAWDOCK_DIR}/.env"
    return 1
  fi
  _agentNodedock_compose exec -e "BUILDERFORCE_AGENTS_GATEWAY_TOKEN=$token" builderforce-gateway \
    node dist/index.js health
}

# Show gateway token
agentNodedock-token() {
  _agentNodedock_read_env_token
}

# Fix token configuration (run this once after setup)
agentNodedock-fix-token() {
  _agentNodedock_ensure_dir || return 1

  echo "🔧 Configuring gateway token..."
  local token
  token=$(agentNodedock-token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${CLAWDOCK_DIR}/.env"
    return 1
  fi

  echo "📝 Setting token: ${token:0:20}..."

  _agentNodedock_compose exec -e "TOKEN=$token" builderforce-gateway \
    bash -c './builderforce.mjs config set gateway.remote.token "$TOKEN" && ./builderforce.mjs config set gateway.auth.token "$TOKEN"' 2>&1 | _agentNodedock_filter_warnings

  echo "🔍 Verifying token was saved..."
  local saved_token
  saved_token=$(_agentNodedock_compose exec builderforce-gateway \
    bash -c "./builderforce.mjs config get gateway.remote.token 2>/dev/null" 2>&1 | _agentNodedock_filter_warnings | tr -d '\r\n' | head -c 64)

  if [[ "$saved_token" == "$token" ]]; then
    echo "✅ Token saved correctly!"
  else
    echo "⚠️  Token mismatch detected"
    echo "   Expected: ${token:0:20}..."
    echo "   Got: ${saved_token:0:20}..."
  fi

  echo "🔄 Restarting gateway..."
  _agentNodedock_compose restart builderforce-gateway 2>&1 | _agentNodedock_filter_warnings

  echo "⏳ Waiting for gateway to start..."
  sleep 5

  echo "✅ Configuration complete!"
  echo -e "   Try: $(_cmd agentNodedock-devices)"
}

# Open dashboard in browser
agentNodedock-dashboard() {
  _agentNodedock_ensure_dir || return 1

  echo "🦞 Getting dashboard URL..."
  local output exit_status url
  output=$(_agentNodedock_compose run --rm builderforce-cli dashboard --no-open 2>&1)
  exit_status=$?
  url=$(printf "%s\n" "$output" | _agentNodedock_filter_warnings | grep -o 'http[s]\?://[^[:space:]]*' | head -n 1)
  if [[ $exit_status -ne 0 ]]; then
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd agentNodedock-restart)"
    return 1
  fi

  if [[ -n "$url" ]]; then
    echo "✅ Opening: $url"
    open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || echo "   Please open manually: $url"
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see 'pairing required' error:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd agentNodedock-devices)"
    echo "   2. Copy the Request ID from the Pending table"
    echo -e "   3. Run: $(_cmd 'agentNodedock-approve <request-id>')"
  else
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd agentNodedock-restart)"
  fi
}

# List device pairings
agentNodedock-devices() {
  _agentNodedock_ensure_dir || return 1

  echo "🔍 Checking device pairings..."
  local output exit_status
  output=$(_agentNodedock_compose exec builderforce-gateway node dist/index.js devices list 2>&1)
  exit_status=$?
  printf "%s\n" "$output" | _agentNodedock_filter_warnings
  if [ $exit_status -ne 0 ]; then
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see token errors above:${_CLR_RESET}"
    echo -e "   1. Verify token is set: $(_cmd agentNodedock-token)"
    echo "   2. Try manual config inside container:"
    echo -e "      $(_cmd agentNodedock-shell)"
    echo -e "      $(_cmd 'builderforce config get gateway.remote.token')"
    return 1
  fi

  echo ""
  echo -e "${_CLR_CYAN}💡 To approve a pairing request:${_CLR_RESET}"
  echo -e "   $(_cmd 'agentNodedock-approve <request-id>')"
}

# Approve device pairing request
agentNodedock-approve() {
  _agentNodedock_ensure_dir || return 1

  if [[ -z "$1" ]]; then
    echo -e "❌ Usage: $(_cmd 'agentNodedock-approve <request-id>')"
    echo ""
    echo -e "${_CLR_CYAN}💡 How to approve a device:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd agentNodedock-devices)"
    echo "   2. Find the Request ID in the Pending table (long UUID)"
    echo -e "   3. Run: $(_cmd 'agentNodedock-approve <that-request-id>')"
    echo ""
    echo "Example:"
    echo -e "   $(_cmd 'agentNodedock-approve 6f9db1bd-a1cc-4d3f-b643-2c195262464e')"
    return 1
  fi

  echo "✅ Approving device: $1"
  _agentNodedock_compose exec builderforce-gateway \
    node dist/index.js devices approve "$1" 2>&1 | _agentNodedock_filter_warnings

  echo ""
  echo "✅ Device approved! Refresh your browser."
}

# Show all available agentNodedock helper commands
agentNodedock-help() {
  echo -e "\n${_CLR_BOLD}${_CLR_CYAN}🦞 AgentNodeDock - Docker Helpers for BuilderForceAgents${_CLR_RESET}\n"

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚡ Basic Operations${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-start)       ${_CLR_DIM}Start the gateway${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-stop)        ${_CLR_DIM}Stop the gateway${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-restart)     ${_CLR_DIM}Restart the gateway${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-status)      ${_CLR_DIM}Check container status${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-logs)        ${_CLR_DIM}View live logs (follows)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🐚 Container Access${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-shell)       ${_CLR_DIM}Shell into container (builderforce alias ready)${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-cli)         ${_CLR_DIM}Run CLI commands (e.g., agentNodedock-cli status)${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-exec) ${_CLR_CYAN}<cmd>${_CLR_RESET}  ${_CLR_DIM}Execute command in gateway container${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🌐 Web UI & Devices${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-dashboard)   ${_CLR_DIM}Open web UI in browser ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-devices)     ${_CLR_DIM}List device pairings ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-approve) ${_CLR_CYAN}<id>${_CLR_RESET} ${_CLR_DIM}Approve device pairing ${_CLR_CYAN}(with examples)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚙️  Setup & Configuration${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-fix-token)   ${_CLR_DIM}Configure gateway token ${_CLR_CYAN}(run once)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🔧 Maintenance${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-rebuild)     ${_CLR_DIM}Rebuild Docker image${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-clean)       ${_CLR_RED}⚠️  Remove containers & volumes (nuclear)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🛠️  Utilities${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-health)      ${_CLR_DIM}Run health check${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-token)       ${_CLR_DIM}Show gateway auth token${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-cd)          ${_CLR_DIM}Jump to builderforce project directory${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-config)      ${_CLR_DIM}Open config directory (~/.builderforce)${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-workspace)   ${_CLR_DIM}Open workspace directory${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo -e "${_CLR_BOLD}${_CLR_GREEN}🚀 First Time Setup${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  1.${_CLR_RESET} $(_cmd agentNodedock-start)          ${_CLR_DIM}# Start the gateway${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  2.${_CLR_RESET} $(_cmd agentNodedock-fix-token)      ${_CLR_DIM}# Configure token${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  3.${_CLR_RESET} $(_cmd agentNodedock-dashboard)      ${_CLR_DIM}# Open web UI${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  4.${_CLR_RESET} $(_cmd agentNodedock-devices)        ${_CLR_DIM}# If pairing needed${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  5.${_CLR_RESET} $(_cmd agentNodedock-approve) ${_CLR_CYAN}<id>${_CLR_RESET}   ${_CLR_DIM}# Approve pairing${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_GREEN}💬 WhatsApp Setup${_CLR_RESET}"
  echo -e "  $(_cmd agentNodedock-shell)"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'builderforce channels login --channel whatsapp')"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'builderforce status')"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_CYAN}💡 All commands guide you through next steps!${_CLR_RESET}"
  echo -e "${_CLR_BLUE}📚 Docs: ${_CLR_RESET}${_CLR_CYAN}https://docs.builderforce.ai${_CLR_RESET}"
  echo ""
}
