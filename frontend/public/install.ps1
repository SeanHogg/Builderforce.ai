#Requires -Version 5.1
<#
.SYNOPSIS
  Builderforce.ai Agent Installer
  Fetch agents from the Builderforce Workforce Registry and install them locally.

.DESCRIPTION
  Run interactively to choose from all available agents, or pass -AgentId to
  install a specific agent directly.

.EXAMPLE
  # Interactive — shows all available agents:
  iwr -useb https://coderclaw.ai/install.ps1 | iex

  # Non-interactive — install a specific agent by ID:
  & ([scriptblock]::Create((iwr -useb https://coderclaw.ai/install.ps1 -UseBasicParsing).Content)) -AgentId "agent-abc123"

.PARAMETER AgentId
  Optional. Install a specific agent by its registry ID without showing the menu.

.PARAMETER ApiUrl
  Optional. Override the Builderforce API base URL.
  Default: https://worker.coderclaw.ai

.PARAMETER InstallDir
  Optional. Directory where agent packages are saved.
  Default: $env:USERPROFILE\.builderforce\agents
#>
param(
    [string]$AgentId   = "",
    [string]$ApiUrl    = "https://worker.coderclaw.ai",
    [string]$InstallDir = "$env:USERPROFILE\.builderforce\agents"
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║      Builderforce.ai  Agent  Installer        ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Ensure install directory exists
# ---------------------------------------------------------------------------
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "  Created install directory: $InstallDir" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Fetch available agents from the registry
# ---------------------------------------------------------------------------
Write-Host "  Fetching agents from the Builderforce registry..." -ForegroundColor DarkGray

try {
    $agents = Invoke-RestMethod -Uri "$ApiUrl/api/agents" -Method GET -UseBasicParsing
} catch {
    Write-Host ""
    Write-Host "  ✗  Could not reach the Builderforce registry." -ForegroundColor Red
    Write-Host "     URL tried: $ApiUrl/api/agents" -ForegroundColor DarkGray
    Write-Host "     Error    : $_" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}

if (-not $agents -or $agents.Count -eq 0) {
    Write-Host ""
    Write-Host "  No agents are currently published in the registry." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# ---------------------------------------------------------------------------
# If no AgentId was supplied, show an interactive selection menu
# ---------------------------------------------------------------------------
if (-not $AgentId) {
    Write-Host ""
    Write-Host "  Available Agents  ($($agents.Count) total)" -ForegroundColor White
    Write-Host "  $(([string]([char]0x2500)) * 51)" -ForegroundColor DarkGray

    for ($i = 0; $i -lt $agents.Count; $i++) {
        $a      = $agents[$i]
        $skills = if ($a.skills -is [array]) { $a.skills -join ", " } else { "" }
        Write-Host ""
        Write-Host "  [$($i + 1)]  $($a.name)" -ForegroundColor Cyan -NoNewline
        Write-Host "  -  $($a.title)" -ForegroundColor White
        Write-Host "       $($a.bio)" -ForegroundColor DarkGray
        if ($skills) {
            Write-Host "       Skills: $skills" -ForegroundColor DarkGray
        }
        Write-Host "       Hired $($a.hire_count) time(s)  |  ID: $($a.id)" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "  [A]  Install all agents" -ForegroundColor Yellow
    Write-Host "  [Q]  Quit" -ForegroundColor DarkGray
    Write-Host ""

    $choice = Read-Host "  Enter number(s) to install (e.g. 1  or  1,3  or  A)"

    if ($choice -match "^[Qq]") {
        Write-Host ""
        Write-Host "  Cancelled." -ForegroundColor DarkGray
        Write-Host ""
        exit 0
    }

    $selectedAgents = @()

    if ($choice -match "^[Aa]") {
        $selectedAgents = $agents
    } else {
        foreach ($token in ($choice -split ",")) {
            $n = $token.Trim()
            if ($n -match "^\d+$") {
                $idx = [int]$n - 1
                if ($idx -ge 0 -and $idx -lt $agents.Count) {
                    $selectedAgents += $agents[$idx]
                } else {
                    Write-Host "  ⚠  '$n' is out of range — skipping." -ForegroundColor Yellow
                }
            } else {
                Write-Host "  ⚠  '$n' is not a valid selection — skipping." -ForegroundColor Yellow
            }
        }
    }

    if ($selectedAgents.Count -eq 0) {
        Write-Host ""
        Write-Host "  No valid agents selected. Nothing installed." -ForegroundColor Yellow
        Write-Host ""
        exit 0
    }
} else {
    # Direct install by ID (non-interactive)
    $selectedAgents = @($agents | Where-Object { $_.id -eq $AgentId })
    if (-not $selectedAgents -or $selectedAgents.Count -eq 0) {
        Write-Host ""
        Write-Host "  ✗  No agent with ID '$AgentId' was found in the registry." -ForegroundColor Red
        Write-Host ""
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Download and save each selected agent package
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  Installing $($selectedAgents.Count) agent(s)..." -ForegroundColor White
Write-Host ""

$successCount = 0
$failCount    = 0

foreach ($agent in $selectedAgents) {
    $safeName = ($agent.name -replace '[^\w-]', '-') -replace '-+', '-'
    $fileName = "$safeName.agent.json"
    $filePath = Join-Path $InstallDir $fileName

    Write-Host "  * $($agent.name)" -ForegroundColor White -NoNewline

    try {
        $pkg = Invoke-RestMethod -Uri "$ApiUrl/api/agents/$($agent.id)/package" -Method GET -UseBasicParsing
        $pkg | ConvertTo-Json -Depth 10 | Out-File -FilePath $filePath -Encoding UTF8
        Write-Host "  OK" -ForegroundColor Green
        Write-Host "    -> $filePath" -ForegroundColor DarkGray
        $successCount++
    } catch {
        Write-Host "  FAILED" -ForegroundColor Red
        Write-Host "    Error: $_" -ForegroundColor DarkGray
        $failCount++
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
if ($successCount -gt 0) {
    Write-Host "  $successCount agent(s) installed to: $InstallDir" -ForegroundColor Green
}
if ($failCount -gt 0) {
    Write-Host "  $failCount agent(s) failed to install." -ForegroundColor Red
}
Write-Host ""
