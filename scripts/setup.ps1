<#
.SYNOPSIS
    One-time setup for Quantum Lab on Windows.

.DESCRIPTION
    The Windows counterpart to scripts/setup.sh, which is bash and will not run
    natively here. Installs the Node dependencies, optionally creates the two
    Python virtual environments, and copies the env templates into place.

    Nothing in this script needs an API key. The web app is fully functional
    without one — the Python services are optional and only matter if you want
    to run circuits on real quantum hardware.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipPython
#>

[CmdletBinding()]
param(
    # Skip the Python services entirely. The web app does not need them.
    [switch]$SkipPython
)

$ErrorActionPreference = 'Stop'

# Run from the repo root regardless of where the script was invoked from.
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step  { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "  [ok] $m" -ForegroundColor Green }
function Write-Warn2 { param($m) Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Write-Fail  { param($m) Write-Host "  [x]  $m" -ForegroundColor Red }

Write-Host "Quantum Lab setup" -ForegroundColor Magenta
Write-Host "Repository: $RepoRoot" -ForegroundColor DarkGray

# ── Node ────────────────────────────────────────────────────────────────────
Write-Step 'Checking Node.js'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Fail 'Node.js is not installed, or is not on your PATH.'
    Write-Host '     Install the LTS build from https://nodejs.org and reopen this terminal.'
    exit 1
}

$nodeVersion = (& node -v).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Fail "Node $nodeVersion found, but this project needs 18 or newer."
    Write-Host '     Next.js 14 will not build on older versions.'
    exit 1
}
Write-Ok "Node $nodeVersion"

# ── npm install ─────────────────────────────────────────────────────────────
Write-Step 'Installing Node dependencies (this takes a minute the first time)'

# Run from the repo root: this is an npm workspace, so the root install also
# wires up apps/web. Installing inside apps/web directly would break the link.
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Fail 'npm install failed. Scroll up for the reason.'
    Write-Host '     A common cause on Windows is a path-length limit. Try:'
    Write-Host '       git config --system core.longpaths true'
    exit 1
}
Write-Ok 'Node dependencies installed'

# ── Environment templates ───────────────────────────────────────────────────
Write-Step 'Creating environment files'

if (-not (Test-Path '.env') -and (Test-Path '.env.example')) {
    Copy-Item '.env.example' '.env'
    Write-Ok 'Created .env from .env.example'
} elseif (Test-Path '.env') {
    Write-Ok '.env already exists — left untouched'
}

# apps/web/.env.local.example could not be transferred by the file bridge
# (anything matching .env.local is blocked), so write it directly.
$webEnvLocal = 'apps\web\.env.local'
if (-not (Test-Path $webEnvLocal)) {
    @'
# Quantum Lab web app — local environment.
#
# THE APP WORKS FULLY WITHOUT EITHER OF THESE.
# The eight visualizations, the circuit simulator and the whole course are pure
# client-side TypeScript. The tutor falls back to a built-in offline FAQ.

# Optional. Base URL of services/api. Only used if you opt into server-side
# circuit execution (real hardware, vendor backends).
NEXT_PUBLIC_API_URL=http://localhost:8000

# Optional. Base URL of services/agent, the tool-calling tutor.
AGENT_SERVICE_URL=http://localhost:8001

# Optional. Set this for live Claude answers in /tutor instead of the offline
# FAQ. Server-side only — never exposed to the browser.
ANTHROPIC_API_KEY=
'@ | Set-Content -Path $webEnvLocal -Encoding UTF8
    Write-Ok "Created $webEnvLocal"
} else {
    Write-Ok "$webEnvLocal already exists — left untouched"
}

# ── Python (optional) ───────────────────────────────────────────────────────
if ($SkipPython) {
    Write-Step 'Skipping the Python services (-SkipPython)'
} else {
    Write-Step 'Checking Python (optional — only needed for real hardware)'

    $py = $null
    foreach ($candidate in @('python', 'py')) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) { $py = $candidate; break }
    }

    if (-not $py) {
        Write-Warn2 'Python not found. Skipping the API and agent services.'
        Write-Host '     That is fine — the web app does not need them.'
        Write-Host '     Install 3.10+ from https://python.org if you want them later.'
    } else {
        $pyVersionRaw = & $py --version 2>&1
        Write-Ok "$pyVersionRaw"

        foreach ($svc in @('services\api', 'services\agent')) {
            $req = Join-Path $svc 'requirements.txt'
            if (-not (Test-Path $req)) {
                Write-Warn2 "No requirements.txt in $svc — skipped"
                continue
            }

            $venv = Join-Path $svc '.venv'
            if (-not (Test-Path $venv)) {
                Write-Host "  Creating virtualenv in $svc ..."
                & $py -m venv $venv
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn2 "Could not create a virtualenv in $svc — skipped"
                    continue
                }
            }

            # On Windows the interpreter lives in Scripts\, not bin\.
            $venvPy = Join-Path $venv 'Scripts\python.exe'
            if (-not (Test-Path $venvPy)) {
                Write-Warn2 "No interpreter at $venvPy — skipped"
                continue
            }

            Write-Host "  Installing $svc dependencies (Qiskit is large; be patient) ..."
            & $venvPy -m pip install --quiet --upgrade pip
            & $venvPy -m pip install --quiet -r $req
            if ($LASTEXITCODE -ne 0) {
                Write-Warn2 "pip install failed for $svc — the web app still works"
            } else {
                Write-Ok "$svc ready"
            }
        }
    }
}

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host "`n────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host ''
Write-Host 'Start the web app:' -ForegroundColor White
Write-Host '  npm run dev' -ForegroundColor Cyan
Write-Host '  then open http://localhost:3000'
Write-Host ''
Write-Host 'No API key is needed. Everything below is optional:' -ForegroundColor White
Write-Host '  .\scripts\dev.ps1 -WithApi        # also start the quantum API on :8000'
Write-Host '  .\scripts\dev.ps1 -WithApi -WithAgent'
Write-Host ''
Write-Host 'Run the tests:' -ForegroundColor White
Write-Host '  npm test --workspace=web          # 66 unit tests'
Write-Host '────────────────────────────────────────────────' -ForegroundColor DarkGray
