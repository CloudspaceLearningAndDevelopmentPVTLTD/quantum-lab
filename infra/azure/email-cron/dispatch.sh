#!/bin/sh
# One bounded call to the 7-day course scheduler. Both EMAIL_DISPATCH_SECRET
# and DISPATCH_URL come from this container's own env (set as --env-vars by
# infra/azure/deploy-email-cron.sh — the secret via secretref, so it is never
# a literal in the job definition or in `az` CLI history).
set -eu

if [ -z "${EMAIL_DISPATCH_SECRET:-}" ] || [ -z "${DISPATCH_URL:-}" ]; then
  echo "dispatch: EMAIL_DISPATCH_SECRET or DISPATCH_URL is unset — nothing to call" >&2
  exit 1
fi

status="$(curl -fsS -m 90 -o /tmp/dispatch-body.json -w '%{http_code}' \
  -X POST -H "Authorization: Bearer ${EMAIL_DISPATCH_SECRET}" "${DISPATCH_URL}")"
echo "dispatch: HTTP ${status}"
cat /tmp/dispatch-body.json
echo ""

case "$status" in
  2??) exit 0 ;;
  *) exit 1 ;;
esac
