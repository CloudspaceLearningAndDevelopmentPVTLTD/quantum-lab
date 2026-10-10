#!/usr/bin/env bash
#
# Quantum Lab — one-shot development setup.
#
# Installs the web app's Node dependencies, optionally provisions the two
# Python services, and seeds .env files from their templates.
#
#   ./scripts/setup.sh
#
# Node 18.17+ is required. Python is optional — the web app (visualizations,
# circuit simulator, tutor) runs entirely without it.

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
  RESET=$'\033[0m'
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  RESET=""
fi

say()  { printf '%s\n' "${BOLD}$*${RESET}"; }
ok()   { printf '%s\n' "${GREEN}  ok${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}  ..${RESET} $*"; }
die()  { printf '%s\n' "${RED}  xx${RESET} $*" >&2; exit 1; }

# ── Repo root ───────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
say "Quantum Lab setup"
printf '  %s\n\n' "$ROOT"

# ── Node ────────────────────────────────────────────────────────────────────
say "Checking Node"
command -v node >/dev/null 2>&1 \
  || die "node not found. Install Node 18.17 or newer: https://nodejs.org"

NODE_RAW="$(node -v)"                       # e.g. v20.16.0
NODE_VER="${NODE_RAW#v}"
NODE_MAJOR="${NODE_VER%%.*}"

case "$NODE_MAJOR" in
  ''|*[!0-9]*) die "could not parse node version from '$NODE_RAW'" ;;
esac

if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node $NODE_RAW is too old — Quantum Lab needs Node 18.17 or newer."
fi
ok "node $NODE_RAW"

# ── Python (optional) ───────────────────────────────────────────────────────
say "Checking Python (optional)"
HAVE_PYTHON=0

if command -v python3 >/dev/null 2>&1; then
  PY_RAW="$(python3 --version 2>&1)"        # e.g. Python 3.11.9
  PY_VER="${PY_RAW#Python }"
  PY_MAJOR="${PY_VER%%.*}"
  PY_REST="${PY_VER#*.}"
  PY_MINOR="${PY_REST%%.*}"

  case "$PY_MAJOR$PY_MINOR" in
    ''|*[!0-9]*)
      warn "could not parse python version from '$PY_RAW' — skipping Python services"
      ;;
    *)
      if [ "$PY_MAJOR" -gt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ]; }; then
        HAVE_PYTHON=1
        ok "python3 $PY_VER"
      else
        warn "python3 $PY_VER is older than 3.10 — skipping the optional Python services"
      fi
      ;;
  esac
else
  warn "python3 not found — skipping the optional Python services"
  warn "they are only needed for real hardware and the full tool-calling agent"
fi

# ── Node dependencies ───────────────────────────────────────────────────────
say "Installing Node dependencies"
npm install
ok "npm install complete"

# ── Python services ─────────────────────────────────────────────────────────
setup_python_service() {
  svc_dir="$1"
  svc_name="$2"

  if [ ! -d "$svc_dir" ]; then
    warn "$svc_name: directory missing, skipping"
    return 0
  fi

  if [ ! -f "$svc_dir/requirements.txt" ]; then
    warn "$svc_name: no requirements.txt, skipping"
    return 0
  fi

  if [ ! -d "$svc_dir/.venv" ]; then
    warn "$svc_name: creating virtualenv"
    python3 -m venv "$svc_dir/.venv"
  fi

  warn "$svc_name: installing requirements (this can take a minute)"
  "$svc_dir/.venv/bin/pip" install -q --upgrade pip
  "$svc_dir/.venv/bin/pip" install -q -r "$svc_dir/requirements.txt"
  ok "$svc_name ready"
}

if [ "$HAVE_PYTHON" -eq 1 ]; then
  say "Setting up Python services"
  setup_python_service "services/api" "services/api"
  setup_python_service "services/agent" "services/agent"
fi

# ── Environment files ───────────────────────────────────────────────────────
say "Seeding environment files"

seed_env() {
  template="$1"
  target="$2"

  if [ ! -f "$template" ]; then
    warn "$template missing, skipping"
    return 0
  fi

  if [ -f "$target" ]; then
    ok "$target already exists, left untouched"
  else
    cp "$template" "$target"
    ok "created $target from $template"
  fi
}

seed_env ".env.example" ".env"
seed_env "apps/web/.env.local.example" "apps/web/.env.local"

# ── Summary ─────────────────────────────────────────────────────────────────
printf '\n'
say "Setup complete."
printf '\n'
printf '%s\n' "  Start the web app (this is all you need):"
printf '%s\n' "    npm run dev            → http://localhost:3000"
printf '\n'
printf '%s\n' "  Or start everything at once:"
printf '%s\n' "    ./scripts/dev.sh"
printf '\n'

if [ "$HAVE_PYTHON" -eq 1 ]; then
  printf '%s\n' "  Optional Python services (only for real hardware / the full agent):"
  printf '%s\n' "    cd services/api   && .venv/bin/uvicorn app.main:app --reload --port 8000"
  printf '%s\n' "    cd services/agent && .venv/bin/uvicorn agent.server:app --reload --port 8001"
  printf '\n'
fi

printf '%s\n' "${GREEN}  No API key is needed to start.${RESET} The visualizations and the circuit"
printf '%s\n' "  simulator are pure client-side TypeScript, and the tutor falls back to a"
printf '%s\n' "  built-in offline FAQ when ANTHROPIC_API_KEY is unset."
printf '\n'
