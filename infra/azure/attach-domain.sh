#!/usr/bin/env bash
# Quantum Lab — attach qubit16.ai to the already-deployed quantum-lab-web
# Azure Container App.
#
# Run this AFTER infra/azure/deploy.sh has already deployed quantum-lab-web,
# quantum-lab-api, and quantum-lab-agent successfully. This script does not
# create any of those apps — it only points a custom domain at the web app,
# rebuilds web with that domain baked in, and updates the api/agent CORS
# allow-list to include it.
#
# VERIFIED IN PRODUCTION (October 2026): qubit16.ai is bound to quantum-lab-web
# with a managed certificate, which is what this script does.
# It is idempotent (every step is check-then-act), so re-running it after a
# partial failure — or after you've finally added the DNS record — is safe.
#
# What it does, in order:
#   1. Reads quantum-lab-web's live *.azurecontainerapps.io FQDN and prints
#      the exact DNS records you need to add at your registrar (TXT for
#      verification, ALIAS/ANAME/flattened-CNAME for the apex).
#   2. Polls `az containerapp hostname add` every 30s for up to ~10 minutes,
#      giving you time to go add those DNS records while it waits.
#   3. Once hostname add succeeds, binds the free managed TLS certificate.
#   4. Rebuilds apps/web with NEXT_PUBLIC_APP_URL=https://qubit16.ai baked
#      in, using this repo's existing two-pass ACR build pattern.
#   5. Adds https://qubit16.ai to ALLOWED_ORIGINS on quantum-lab-api and
#      quantum-lab-agent (additive — the azurecontainerapps.io origin keeps
#      working too).
#   6. Prints the final https://qubit16.ai URL and a curl health check.
#
# This script cannot create the DNS records themselves — that requires
# action in your registrar's dashboard (Namecheap/GoDaddy/Cloudflare/etc.).
# Step 1/2 below tell you exactly what to add and then wait for it to
# propagate and verify.
set -euo pipefail

# ---------------------------------------------------------------- 0. config
RESOURCE_GROUP="${RESOURCE_GROUP:-quantum-lab-rg}"
DOMAIN="${DOMAIN:-qubit16.ai}"
ACR_NAME="${ACR_NAME:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Checking az login"
az account show >/dev/null 2>&1 || { echo "!! Not logged in. Run: az login"; exit 1; }

echo "==> Container Apps CLI extension"
az extension add --name containerapp --upgrade -y >/dev/null 2>&1 || true

echo "==> Checking quantum-lab-web exists in $RESOURCE_GROUP"
if ! az containerapp show -n quantum-lab-web -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "!! quantum-lab-web not found in resource group $RESOURCE_GROUP."
  echo "   Run infra/azure/deploy.sh first."
  exit 1
fi

WEB_FQDN="$(az containerapp show -n quantum-lab-web -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
echo "==> quantum-lab-web live FQDN: $WEB_FQDN"

# --------------------------------------------------------- 1. DNS instructions
#
# `az containerapp hostname add` is the same command that both reports the
# TXT verification requirement AND performs the actual verified-hostname add
# once DNS is in place — there is no separate "dry run" flag as of this
# writing, so this script calls it for real on every attempt in step 2. The
# very first call typically fails (DNS isn't in place yet) with the TXT
# record name/value in the error text; we surface that verbatim below.
ASUID_TXT_NAME="asuid.${DOMAIN#*.}"
if [ "$DOMAIN" = "${DOMAIN#*.}" ]; then
  # DOMAIN has no dot-separated subdomain component (shouldn't happen for a
  # normal TLD like qubit16.ai, but guard anyway).
  ASUID_TXT_NAME="asuid"
fi
# For a bare apex domain (qubit16.ai, no subdomain) the TXT verification
# record name Azure expects is "asuid.qubit16.ai" itself (not asuid.<www> or
# similar) — i.e. "asuid." prepended to the domain.
ASUID_TXT_NAME="asuid.$DOMAIN"

echo ""
echo "================================================================"
echo " DNS records needed at your registrar for $DOMAIN"
echo "================================================================"
echo ""
echo " 1) TXT record (domain ownership verification):"
echo "      Name:  $ASUID_TXT_NAME"
echo "      Value: <shown below, from Azure — same value as"
echo "             quantum-lab-web's custom domain verification ID>"
CUSTOM_DOMAIN_VERIFICATION_ID="$(az containerapp show -n quantum-lab-web -g "$RESOURCE_GROUP" \
  --query properties.customDomainVerificationId -o tsv 2>/dev/null || echo "")"
if [ -n "$CUSTOM_DOMAIN_VERIFICATION_ID" ]; then
  echo "      -> TXT value: $CUSTOM_DOMAIN_VERIFICATION_ID"
else
  echo "      -> (could not read customDomainVerificationId live — the first"
  echo "         retry in step 2 below will print the exact value Azure wants"
  echo "         if this value is wrong or missing)"
fi
echo ""
echo " 2) Apex record pointing $DOMAIN at $WEB_FQDN:"
echo "      $DOMAIN has NO subdomain (it's a bare apex domain), so an"
echo "      ordinary CNAME record is not valid there per the DNS spec (a"
echo "      CNAME cannot coexist with other records at the zone apex)."
echo "      Use whatever your registrar calls its apex-CNAME workaround:"
echo "        - Cloudflare: CNAME (Cloudflare auto-flattens apex CNAMEs)"
echo "        - Namecheap:  ALIAS record"
echo "        - GoDaddy:    forwarding, or move DNS to a provider that"
echo "                      supports ALIAS/ANAME (GoDaddy's own DNS does not)"
echo "        - others:     look for \"ALIAS\", \"ANAME\", or \"flattened CNAME\""
echo "      Name/Host: @  (or blank, meaning the bare domain)"
echo "      Value:     $WEB_FQDN"
echo ""
echo " Add both records now, then leave this script running — it will poll"
echo " for DNS verification below (usually a few minutes, sometimes up to"
echo " the DNS TTL your registrar uses)."
echo "================================================================"
echo ""

# ------------------------------------------------ 2. poll hostname add
echo "==> Verifying + adding hostname $DOMAIN to quantum-lab-web (retrying every 30s, up to ~10 min)"
HOSTNAME_ADDED=false
if az containerapp hostname list -n quantum-lab-web -g "$RESOURCE_GROUP" --query "[?name=='$DOMAIN']" -o tsv 2>/dev/null | grep -q "$DOMAIN"; then
  echo "   $DOMAIN already added to quantum-lab-web, skipping"
  HOSTNAME_ADDED=true
else
  WAITED=0
  MAX_WAIT=600
  while [ "$WAITED" -lt "$MAX_WAIT" ]; do
    if az containerapp hostname add -n quantum-lab-web -g "$RESOURCE_GROUP" --hostname "$DOMAIN" >/tmp/attach-domain-hostname-add.log 2>&1; then
      echo "   hostname add succeeded"
      HOSTNAME_ADDED=true
      break
    fi
    echo "   [${WAITED}s] not verified yet. Azure said:"
    sed 's/^/     /' /tmp/attach-domain-hostname-add.log | tail -5
    sleep 30
    WAITED=$((WAITED + 30))
  done
fi

if [ "$HOSTNAME_ADDED" != true ]; then
  echo ""
  echo "!! Timed out after ~10 minutes waiting for DNS verification of $DOMAIN."
  echo "   This usually means the DNS records above haven't been added yet, or"
  echo "   haven't propagated (some registrars take longer than their stated"
  echo "   TTL). Add/check the TXT and apex records, wait a bit, then just"
  echo "   re-run this script — it picks up right where it left off."
  exit 1
fi

# ------------------------------------------------------- 3. bind managed TLS
echo "==> Binding managed TLS certificate for $DOMAIN"
EXISTING_BINDING="$(az containerapp hostname list -n quantum-lab-web -g "$RESOURCE_GROUP" \
  --query "[?name=='$DOMAIN'].bindingType" -o tsv 2>/dev/null || echo "")"
if [ "$EXISTING_BINDING" = "SniEnabled" ]; then
  echo "   TLS already bound for $DOMAIN, skipping"
else
  az containerapp hostname bind -n quantum-lab-web -g "$RESOURCE_GROUP" \
    --hostname "$DOMAIN" --environment quantum-lab-env --validation-method CNAME >/dev/null
  echo "   managed certificate requested/bound (Azure issues + auto-renews this free)"
fi

# --------------------------------------------------------- 4. rebuild web
#
# Same two-pass ACR build pattern as deploy.sh's own "6. web" section: pass 1
# there left NEXT_PUBLIC_APP_URL blank because web's own URL wasn't known
# until after its first deploy. It's known now — this is that promised
# follow-up rebuild, baking in https://$DOMAIN so canonical URLs, the
# sitemap, and OG tags stop pointing at the azurecontainerapps.io URL.
if [ -z "$ACR_NAME" ]; then
  ACR_NAME="$(az acr list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || echo "")"
fi
if [ -z "$ACR_NAME" ]; then
  echo "!! Could not auto-detect the ACR in $RESOURCE_GROUP. Set ACR_NAME=<your-acr-name> and re-run."
  exit 1
fi
echo "==> Using Container Registry: $ACR_NAME"

ACR_LOGIN_SERVER="$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query loginServer -o tsv)"
ACR_USER="$(az acr credential show -n "$ACR_NAME" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "$ACR_NAME" --query 'passwords[0].value' -o tsv)"

# Read web's current API/agent URLs back off the running container app so
# this rebuild doesn't regress them — deploy.sh baked these in at deploy
# time and there's no need to ask for them again.
API_FQDN="$(az containerapp show -n quantum-lab-api -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo "")"
API_URL="${API_FQDN:+https://$API_FQDN}"

TAG="$(date +%Y%m%d%H%M%S)"

# acr_build_async — copied verbatim from deploy.sh's own function of the same
# name (see the comment there for why this polls instead of streaming logs).
acr_build_async() {
  local image="$1" dockerfile="$2" context="$3"; shift 3
  local build_args=("$@")
  local cmd=(az acr build -r "$ACR_NAME" -g "$RESOURCE_GROUP" -t "$image")
  [ -n "$dockerfile" ] && cmd+=(-f "$dockerfile")
  local ba
  for ba in "${build_args[@]:-}"; do
    [ -n "$ba" ] && cmd+=(--build-arg "$ba")
  done
  cmd+=(--no-wait "$context")
  "${cmd[@]}" >/dev/null
  sleep 3
  local run_id
  run_id="$(az acr task list-runs -r "$ACR_NAME" --top 1 --query "[0].runId" -o tsv)"
  echo "   queued run $run_id for $image"
  local status="Queued" waited=0
  while [ "$status" != "Succeeded" ] && [ "$status" != "Failed" ] \
        && [ "$status" != "Error" ] && [ "$status" != "Canceled" ]; do
    sleep 15
    waited=$((waited + 15))
    status="$(az acr task show-run -r "$ACR_NAME" --run-id "$run_id" --query status -o tsv 2>/dev/null || echo "$status")"
    echo "   [${waited}s] $image build status: $status"
    if [ "$waited" -gt 1800 ]; then
      echo "!! Timed out after 30 minutes waiting for $image. Check: az acr task logs -r $ACR_NAME --run-id $run_id"
      exit 1
    fi
  done
  if [ "$status" != "Succeeded" ]; then
    echo "!! ACR build of $image ended with status: $status"
    echo "   Full logs: az acr task logs -r $ACR_NAME --run-id $run_id"
    exit 1
  fi
  echo "   $image build succeeded"
}

echo "==> Rebuilding apps/web with NEXT_PUBLIC_APP_URL=https://$DOMAIN baked in (az acr build, queued + polled)"
acr_build_async "quantum-lab/web:$TAG-domain" "apps/web/Dockerfile" "." \
  "NEXT_PUBLIC_APP_URL=https://$DOMAIN" \
  "NEXT_PUBLIC_API_URL=${API_URL:-}" \
  "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-}" \
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
  "NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN:-}"

echo "==> Deploying the rebuilt image to quantum-lab-web"
# See deploy.sh's refresh_registry_creds comment: `containerapp update
# --image` never refreshes stored registry credentials, only `create` does.
# Cheap insurance here even though this script's ACR_NAME is already
# correctly auto-detected (unlike deploy.sh's former bug) — if the ACR admin
# password was ever rotated since the app was created, this keeps the pull
# working instead of failing with an unhelpful UNAUTHORIZED.
az containerapp registry set -n quantum-lab-web -g "$RESOURCE_GROUP" \
  --server "$ACR_LOGIN_SERVER" --username "$ACR_USER" --password "$ACR_PASS" >/dev/null
az containerapp update -n quantum-lab-web -g "$RESOURCE_GROUP" \
  --image "$ACR_LOGIN_SERVER/quantum-lab/web:$TAG-domain" >/dev/null

# ---------------------------------------------------------- 5. wire origins
#
# Additive, unlike deploy.sh's own step 7 (which sets ALLOWED_ORIGINS to a
# single value). Here we read the current value and append the new origin
# only if it isn't already present, so the azurecontainerapps.io origin
# keeps working alongside https://$DOMAIN.
add_origin() {
  local app="$1"
  local current
  current="$(az containerapp show -n "$app" -g "$RESOURCE_GROUP" \
    --query "properties.template.containers[0].env[?name=='ALLOWED_ORIGINS'].value | [0]" -o tsv 2>/dev/null || echo "")"
  if [ -z "$current" ]; then
    echo "   $app: ALLOWED_ORIGINS currently unset, setting to https://$DOMAIN"
    az containerapp update -n "$app" -g "$RESOURCE_GROUP" \
      --set-env-vars ALLOWED_ORIGINS="https://$DOMAIN" >/dev/null
    return
  fi
  if echo ",$current," | grep -qF ",https://$DOMAIN,"; then
    echo "   $app: https://$DOMAIN already in ALLOWED_ORIGINS ($current), skipping"
    return
  fi
  local new="$current,https://$DOMAIN"
  echo "   $app: ALLOWED_ORIGINS -> $new"
  az containerapp update -n "$app" -g "$RESOURCE_GROUP" \
    --set-env-vars ALLOWED_ORIGINS="$new" >/dev/null
}

echo "==> Adding https://$DOMAIN to ALLOWED_ORIGINS on quantum-lab-api + quantum-lab-agent (additive)"
add_origin quantum-lab-api
add_origin quantum-lab-agent

# ------------------------------------------------------------- done
echo ""
echo "================================================================"
echo " $DOMAIN attached to quantum-lab-web"
echo "================================================================"
echo "   https://$DOMAIN"
curl -s -o /dev/null -w "   /api/health -> %{http_code}\n" "https://$DOMAIN/api/health" || true
echo ""
echo " TLS certificate issuance can take a few minutes after binding — if the"
echo " curl above fails or the browser shows a cert warning immediately after"
echo " this script finishes, wait a few minutes and retry."
echo "================================================================"
