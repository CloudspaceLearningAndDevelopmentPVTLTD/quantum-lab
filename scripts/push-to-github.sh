#!/usr/bin/env bash
#
# push-to-github.sh — publish this repo to a new GitHub repository.
#
# The repo already has its full commit history. This script only creates the
# remote and pushes. Run it from anywhere:
#
#   ./scripts/push-to-github.sh quantum-lab            # public
#   ./scripts/push-to-github.sh quantum-lab --private  # private
#
set -euo pipefail

REPO_NAME="${1:-quantum-lab}"
VISIBILITY="--public"
if [[ "${2:-}" == "--private" ]]; then
  VISIBILITY="--private"
fi

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

say()  { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%s  !%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
say "Repository root: ${DIM}${ROOT}${RESET}"

# ── Preflight ───────────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || die "git is not installed."
[[ -d .git ]] || die "No .git directory here. Run 'git init' first."

if [[ -n "$(git status --porcelain)" ]]; then
  warn "You have uncommitted changes. Committing them now."
  git add -A
  git commit -m "chore: local changes before publishing"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
say "Publishing branch '${BRANCH}' as repository '${REPO_NAME}' (${VISIBILITY#--})."

# ── Path A: gh CLI is available and authenticated ───────────────────────────
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  ok "GitHub CLI is authenticated — creating the repository for you."

  if git remote get-url origin >/dev/null 2>&1; then
    warn "A remote named 'origin' already exists: $(git remote get-url origin)"
    read -r -p "  Replace it? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted. Remove the remote yourself and re-run."
    git remote remove origin
  fi

  gh repo create "$REPO_NAME" "$VISIBILITY" \
    --source=. \
    --remote=origin \
    --description "Interactive quantum mechanics learning platform: visualizations, a circuit simulator, and an AI tutor." \
    --push

  ok "Pushed. Opening the repository..."
  gh repo view --web || true
  exit 0
fi

# ── Path B: no gh CLI — guide the manual route ──────────────────────────────
warn "GitHub CLI not found or not authenticated."
echo
echo "  Two options:"
echo
echo "  ${BOLD}Option 1 — install and authenticate gh, then re-run this script:${RESET}"
echo "    macOS:  brew install gh"
echo "    Linux:  see https://github.com/cli/cli#installation"
echo "    then:   gh auth login && ./scripts/push-to-github.sh ${REPO_NAME}"
echo
echo "  ${BOLD}Option 2 — create the repo in the browser, then run:${RESET}"
echo "    1. Go to https://github.com/new"
echo "    2. Name it '${REPO_NAME}'. Do NOT add a README, .gitignore, or licence."
echo "    3. Then run these two commands here:"
echo
echo "       ${DIM}git remote add origin https://github.com/<your-username>/${REPO_NAME}.git${RESET}"
echo "       ${DIM}git push -u origin ${BRANCH}${RESET}"
echo
exit 1
