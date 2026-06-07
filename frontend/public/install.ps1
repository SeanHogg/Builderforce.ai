#Requires -Version 5.1
<#
.SYNOPSIS
  BuilderForce Agents — installer & agent-host connector (Windows).

.DESCRIPTION
  Installs the BuilderForce Agents runtime (the `builderforce` CLI). When a
  workspace token is present in the session — which the "Connect a new agent"
  one-liner on https://builderforce.ai/workforce sets via
  $env:BUILDERFORCE_TOKEN / $env:BUILDERFORCE_WORKSPACE — it also registers THIS
  machine as an agent host in your workgroup and starts the gateway so it shows
  up online.

  Designed to be run via `iwr -useb https://builderforce.ai/install.ps1 | iex`.
  It NEVER calls `exit` (that would terminate the calling PowerShell session
  under `iex`); it uses `return` so a failure ends the script cleanly.

.PARAMETER Tag
  npm dist-tag or version of @seanhogg/builderforce-agents to install.
  Default: latest.

.PARAMETER ApiUrl
  Builderforce API base URL. Default: $env:BUILDERFORCE_URL or
  https://api.builderforce.ai

.PARAMETER NoStart
  Install + register only; do not start the gateway.
#>
param(
    [string]$Tag    = "latest",
    [string]$ApiUrl = "",
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }

Say ""
Say "  ╔═══════════════════════════════════════════════╗" Cyan
Say "  ║      BuilderForce.ai  Agent  Installer         ║" Cyan
Say "  ╚═══════════════════════════════════════════════╝" Cyan
Say ""

# ---------------------------------------------------------------------------
# 1. Preflight — the runtime is a Node.js CLI, so npm must be available.
# ---------------------------------------------------------------------------
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Say "  X  Node.js / npm was not found on PATH." Red
    Say "     Install Node.js 20+ from https://nodejs.org and re-run this command." DarkGray
    Say ""
    return
}

# ---------------------------------------------------------------------------
# 2. Install the runtime CLI.
# ---------------------------------------------------------------------------
Say "  Installing the BuilderForce Agents runtime (@seanhogg/builderforce-agents@$Tag)..." DarkGray
try {
    & npm install -g "@seanhogg/builderforce-agents@$Tag" 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
} catch {
    Say "  X  Could not install the runtime." Red
    Say "     $_" DarkGray
    Say ""
    return
}
Say "  OK  Runtime installed — try 'builderforce --help'." Green

# ---------------------------------------------------------------------------
# 3. Resolve the API URL (param > env > default).
# ---------------------------------------------------------------------------
if (-not $ApiUrl) {
    $ApiUrl = if ($env:BUILDERFORCE_URL) { $env:BUILDERFORCE_URL } else { "https://api.builderforce.ai" }
}

# ---------------------------------------------------------------------------
# 4. If a workspace token is present, register this machine + (optionally) start.
#    The token + workspace are read from the environment by `builderforce
#    connect`, so they never appear on the command line / in history.
# ---------------------------------------------------------------------------
if ($env:BUILDERFORCE_TOKEN) {
    $env:BUILDERFORCE_URL = $ApiUrl
    Say ""
    Say "  Registering this machine as an agent host..." DarkGray
    try {
        & builderforce connect
        if ($LASTEXITCODE -ne 0) { throw "connect exited with code $LASTEXITCODE" }
    } catch {
        Say "  X  Registration failed." Red
        Say "     $_" DarkGray
        Say ""
        return
    }

    if ($NoStart) {
        Say ""
        Say "  Start the agent any time with:  builderforce gateway" DarkGray
    } else {
        Say ""
        Say "  Starting the gateway (Ctrl+C to stop)..." DarkGray
        & builderforce gateway
    }
} else {
    Say ""
    Say "  No workspace token in this session." Yellow
    Say "  - To connect interactively:  builderforce onboard" DarkGray
    Say "  - Or copy the 'Connect a new agent' command from" DarkGray
    Say "    https://builderforce.ai/workforce (it carries your workspace token)." DarkGray
}

Say ""
