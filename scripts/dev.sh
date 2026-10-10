#!/usr/bin/env bash
#
# Quantum Lab — start every locally available service in one terminal.
#
#   ./scripts/dev.sh
#
# Always starts the Next.js dev server. Additionally starts services/api and
# services/agent if (and only if) their virtualenvs exist — run
# ./scripts/setup.sh to create them. Ctrl-C tears everything down.

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RESET=""
fi

say()  { printf '%s\n' "${BOLD}$*${RESET}"; }
ok()   { printf '%s\n' "${GREEN}  ok${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}  ..${RESET} $*"; }

# ── Repo root ───────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Child process bookkeeping ───────────────────────────────────────────────
PIDS=()

cleanup() {
  # Avoid recursing if a kill triggers another trap.
  trap - EXIT INT TERM
  printf '\n'
  say "Shutting down"
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    wait "$pid" 2>/dev/null || true
  done
  ok "all services stopped"
}

trap cleanup EXIT INT TERM

say "Quantum Lab dev"
printf '  %s\n\n' "$ROOT"

STARTED=()

# ── Web (always) ────────────────────────────────────────────────────────────
npm run dev &
PIDS+=("$!")
STARTED+=("web      http://localhost:3000   Next.js dev server")
ok "web dev server starting (pid $!)"

# ── services/api (optional) ─────────────────────────────────────────────────
if [ -x "services/api/.venv/bin/uvicorn" ]; then
  (
    cd services/api
    exec .venv/bin/uvicorn app.main:app --reload --port 8000
  ) &
  PIDS+=("$!")
  STARTED+=("api      http://localhost:8000   FastAPI + Qiskit Aer")
  ok "services/api starting (pid $!)"
else
  warn "services/api not started — no .venv (optional; run ./scripts/setup.sh)"
fi

# ── services/agent (optional) ───────────────────────────────────────────────
if [ -x "services/agent/.venv/bin/uvicorn" ]; then
  (
    cd services/agent
    exec .venv/bin/uvicorn agent.server:app --reload --port 8001
  ) &
  PIDS+=("$!")
  STARTED+=("agent    http://localhost:8001   LangChain + Claude agent")
  ok "services/agent starting (pid $!)"
else
  warn "services/agent not started — no .venv (optional; run ./scripts/setup.sh)"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
printf '\n'
say "Running:"
for line in ${STARTED[@]+"${STARTED[@]}"}; do
  printf '  %s\n' "$line"
done
printf '\n'
printf '%s\n' "  Open http://localhost:3000 — no API key required."
printf '%s\n' "  Ctrl-C stops everything."
printf '\n'

wait
