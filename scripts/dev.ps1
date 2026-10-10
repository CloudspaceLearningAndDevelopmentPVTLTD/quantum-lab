<#
.SYNOPSIS
    Start Quantum Lab in development on Windows.

.DESCRIPTION
    The Windows counterpart to scripts/dev.sh. Starts the Next.js dev server,
    and optionally the two Python services, each in its own window so you can
    read their logs separately. Closing this script's window does not kill the
    children — close their windows, or press Ctrl+C in each.

    By default only the web app starts, because that is all you need: the
    visualizations, simulator and course are entirely client-side.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -WithApi -WithAgent
#>

[CmdletBinding()]
param(
    # Also start services/api (quantum execution, real hardware) on port 8000.
    [switch]$WithApi,
    # Also start services/agent (tool-calling tutor) on port 8001.
    [switch]$WithAgent
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  [ok] $m" -ForegroundColor Green }
function Write-Warn2{ param($m) Write-Host "  [!]  $m" -ForegroundColor Yellow }

Write-Host 'Quantum Lab — development' -ForegroundColor Magenta

if (-not (Test-Path 'node_modules')) {
    Write-Warn2 'node_modules is missing. Run .\scripts\setup.ps1 first.'
    exit 1
}

# Warn early rather than letting a port clash produce a confusing Next error.
function Test-PortFree {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return -not $conn
}

foreach ($p in @(3000)) {
    if (-not (Test-PortFree $p)) {
        Write-Warn2 "Port $p is already in use. Next.js will pick another port, or stop the other process first."
    }
}

# ── Python services ─────────────────────────────────────────────────────────
# Started first so the web app finds them already listening.

if ($WithApi) {
    Write-Step 'Starting the quantum API on http://localhost:8000'
    $apiPy = Join-Path $RepoRoot 'services\api\.venv\Scripts\python.exe'
    if (Test-Path $apiPy) {
        Start-Process -FilePath $apiPy `
            -ArgumentList '-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000' `
            -WorkingDirectory (Join-Path $RepoRoot 'services\api')
        Write-Ok 'API starting in a new window (docs at http://localhost:8000/docs)'
    } else {
        Write-Warn2 'No virtualenv at services\api\.venv — run setup.ps1 without -SkipPython'
    }
}

if ($WithAgent) {
    Write-Step 'Starting the tutor agent on http://localhost:8001'
    $agentPy = Join-Path $RepoRoot 'services\agent\.venv\Scripts\python.exe'
    if (Test-Path $agentPy) {
        Start-Process -FilePath $agentPy `
            -ArgumentList '-m', 'uvicorn', 'agent.server:app', '--reload', '--port', '8001' `
            -WorkingDirectory (Join-Path $RepoRoot 'services\agent')
        Write-Ok 'Agent starting in a new window'
        Write-Warn2 'The agent needs ANTHROPIC_API_KEY to actually answer; without it'
        Write-Host '       the tutor silently falls back to its offline FAQ.'
    } else {
        Write-Warn2 'No virtualenv at services\agent\.venv — run setup.ps1 without -SkipPython'
    }
}

# ── Web app (foreground) ────────────────────────────────────────────────────
Write-Step 'Starting the web app on http://localhost:3000'
Write-Host '  Press Ctrl+C to stop it.' -ForegroundColor DarkGray
Write-Host ''

& npm run dev
