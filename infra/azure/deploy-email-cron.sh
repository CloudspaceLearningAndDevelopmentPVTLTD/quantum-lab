#!/usr/bin/env bash
# Quantum Lab — hourly scheduler for the 7-day onboarding email course.
#
# WHY THIS EXISTS: apps/web/app/api/email/dispatch (route.ts) is fully built
# and, as of this script, fully configured in production — RESEND_API_KEY,
# EMAIL_FROM, EMAIL_DISPATCH_SECRET and Supabase are all set (see
# infra/azure/.env.production). But that route is deliberately
# operator-triggered, not a background job (this deployment has no job
# runner of its own — see the comment at the top of route.ts), so a
# subscriber who confirms today gets mailed NOTHING, ever, until something
# calls `POST /api/email/dispatch` on a schedule. This script is that
# schedule: an Azure Container Apps Job on trigger-type Schedule, running
# once an hour — the exact cadence route.ts's own comment recommends ("a
# cron hitting it hourly gives every subscriber their next due day within
# the hour it falls due").
#
# THE IMAGE: infra/azure/email-cron/{Dockerfile,dispatch.sh} bakes the one
# curl call this job ever makes into the image's ENTRYPOINT, rather than
# passing a shell one-liner via `--command`/`--args` on the CLI. That was
# tried first and failed ("unrecognized arguments") in a way that did not
# match any of `az containerapp job create --help`'s own examples, which
# also never override command/args — baking it into the image sidesteps CLI
# argument quoting entirely. See that Dockerfile's comment for the detail.
#
# Run this AFTER infra/azure/deploy.sh has deployed quantum-lab-web at least
# once (it needs the same resource group, environment, and reuses the same
# ACR). Idempotent — re-running rebuilds the image and updates the job.
#
# Cost: a Container Apps Job on Consumption bills only for the seconds each
# execution actually runs. One curl call finishing in ~1-2s, 24 times a day,
# is negligible — well under $1/mo, not the ~$10-15/mo floor of an always-on
# Container App (this is a Job, not an App: nothing runs between triggers).
set -euo pipefail

# See the identical guard and comment in deploy.sh: on Git Bash/MSYS
# (Windows), a leading "/" in an argument gets silently rewritten into a
# Windows path before `az`/`docker` see it. This script also calls `az acr
# build`, so it gets the same defensive no-op-elsewhere export.
export MSYS_NO_PATHCONV=1

RESOURCE_GROUP="${RESOURCE_GROUP:-quantum-lab-rg}"
ENV_NAME="quantum-lab-env"
JOB_NAME="quantum-lab-email-cron"
# Every hour, on the hour. route.ts processes up to `limit` (default 25, max
# 100) due subscribers per call and is safe to call on an empty queue — an
# idle hour costs one no-op HTTP round trip.
CRON_EXPRESSION="${CRON_EXPRESSION:-0 * * * *}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/infra/azure/.env.production}"
if [ -f "$ENV_FILE" ]; then
  echo "==> Loading $ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
fi

echo "==> Checking az login"
az account show >/dev/null 2>&1 || { echo "!! Not logged in. Run: az login"; exit 1; }

if [ -z "${EMAIL_DISPATCH_SECRET:-}" ]; then
  echo "!! EMAIL_DISPATCH_SECRET is not set (in the environment or in $ENV_FILE)."
  echo "   Without it the dispatch route ignores the Authorization header entirely"
  echo "   (an empty secret must never authorise anything — see route.ts), so this"
  echo "   job would call an endpoint it cannot pass. Set EMAIL_DISPATCH_SECRET and"
  echo "   re-run."
  exit 1
fi

az extension add --name containerapp --upgrade -y >/dev/null 2>&1 || true

if [ -z "${ACR_NAME:-}" ]; then
  ACR_NAME="$(az acr list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || true)"
  [ -n "$ACR_NAME" ] || { echo "!! No Container Registry found in $RESOURCE_GROUP. Run infra/azure/deploy.sh first."; exit 1; }
fi
ACR_LOGIN_SERVER="$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query loginServer -o tsv)"
ACR_USER="$(az acr credential show -n "$ACR_NAME" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "$ACR_NAME" --query 'passwords[0].value' -o tsv)"

# Resolve the public dispatch URL the same way attach-domain.sh / deploy.sh
# do: PUBLIC_URL if set, else the first custom domain bound to
# quantum-lab-web, else its *.azurecontainerapps.io FQDN.
if [ -z "${PUBLIC_URL:-}" ]; then
  if ! az containerapp show -n quantum-lab-web -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "!! quantum-lab-web not found in $RESOURCE_GROUP. Run infra/azure/deploy.sh first."
    exit 1
  fi
  CUSTOM_DOMAIN="$(az containerapp hostname list -n quantum-lab-web -g "$RESOURCE_GROUP" --query "[?bindingType=='SniEnabled'] | [0].name" -o tsv 2>/dev/null || true)"
  if [ -n "$CUSTOM_DOMAIN" ]; then
    PUBLIC_URL="https://$CUSTOM_DOMAIN"
  else
    PUBLIC_URL="https://$(az containerapp show -n quantum-lab-web -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
  fi
fi
DISPATCH_URL="${PUBLIC_URL%/}/api/email/dispatch"
echo "==> Dispatch target: $DISPATCH_URL"
echo "==> Schedule: $CRON_EXPRESSION (UTC)"

IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
IMAGE="$ACR_LOGIN_SERVER/quantum-lab/email-cron:$IMAGE_TAG"
echo "==> Building email-cron image in the cloud: $IMAGE"
az acr build -r "$ACR_NAME" -g "$RESOURCE_GROUP" -t "quantum-lab/email-cron:$IMAGE_TAG" \
  infra/azure/email-cron >/dev/null
echo "   build succeeded"

if ! az containerapp job show -n "$JOB_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Creating job: $JOB_NAME"
  az containerapp job create \
    -n "$JOB_NAME" -g "$RESOURCE_GROUP" --environment "$ENV_NAME" \
    --trigger-type Schedule --cron-expression "$CRON_EXPRESSION" \
    --replica-timeout 120 --replica-retry-limit 1 --parallelism 1 --replica-completion-count 1 \
    --image "$IMAGE" --cpu 0.25 --memory 0.5Gi \
    --registry-server "$ACR_LOGIN_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --secrets "email-dispatch-secret=$EMAIL_DISPATCH_SECRET" \
    --env-vars "EMAIL_DISPATCH_SECRET=secretref:email-dispatch-secret" "DISPATCH_URL=$DISPATCH_URL" \
    >/dev/null
else
  echo "==> Updating existing job: $JOB_NAME (image, secret, URL, schedule)"
  az containerapp job registry set -n "$JOB_NAME" -g "$RESOURCE_GROUP" \
    --server "$ACR_LOGIN_SERVER" --username "$ACR_USER" --password "$ACR_PASS" >/dev/null
  az containerapp job secret set -n "$JOB_NAME" -g "$RESOURCE_GROUP" \
    --secrets "email-dispatch-secret=$EMAIL_DISPATCH_SECRET" >/dev/null
  az containerapp job update -n "$JOB_NAME" -g "$RESOURCE_GROUP" \
    --cron-expression "$CRON_EXPRESSION" \
    --image "$IMAGE" \
    --set-env-vars "EMAIL_DISPATCH_SECRET=secretref:email-dispatch-secret" "DISPATCH_URL=$DISPATCH_URL" \
    >/dev/null
fi

echo "==> Triggering one run now, to prove it actually works end to end"
RUN_NAME="$(az containerapp job start -n "$JOB_NAME" -g "$RESOURCE_GROUP" --query name -o tsv)"
echo "   started execution: $RUN_NAME"
STATUS="Running"; WAITED=0
while [ "$STATUS" = "Running" ] && [ "$WAITED" -lt 120 ]; do
  sleep 5; WAITED=$((WAITED + 5))
  STATUS="$(az containerapp job execution show -n "$JOB_NAME" -g "$RESOURCE_GROUP" --job-execution-name "$RUN_NAME" --query properties.status -o tsv 2>/dev/null || echo "Running")"
done
echo "   execution status after ${WAITED}s: $STATUS"
if [ "$STATUS" != "Succeeded" ]; then
  echo "   check logs: az containerapp job logs show -n $JOB_NAME -g $RESOURCE_GROUP --container email-cron"
fi

echo ""
echo "================================================================"
echo " Email dispatch cron: $JOB_NAME"
echo "   schedule: $CRON_EXPRESSION (UTC)"
echo "   target:   $DISPATCH_URL"
echo "   Every confirmed 7-day-course subscriber whose next day is due now"
echo "   gets mailed within the hour, from here on."
echo "================================================================"
