#!/usr/bin/env bash
# Restrict the public Container Apps (web, api) to Cloudflare's edge addresses.
#
# qubit16.ai is served through Cloudflare, but the Container Apps also answer
# on their own *.azurecontainerapps.io hostnames. Anyone who finds one of those
# can talk to the origin directly: no WAF, no bot protection, and they can set
# `cf-connecting-ip` to anything, which is the header the rate limiters trust.
# Ingress IP restrictions close that: only Cloudflare's published ranges may
# connect, everything else gets 403 from Azure before it reaches the app.
#
# Idempotent — re-run it when Cloudflare changes its ranges (rare; the lists
# are at https://www.cloudflare.com/ips/). The agent is not touched: it has
# internal ingress and is not reachable from the internet at all.
#
#   RESOURCE_GROUP=quantum-lab-rg bash infra/azure/restrict-origin-to-cloudflare.sh
#   bash infra/azure/restrict-origin-to-cloudflare.sh --remove   # undo
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-quantum-lab-rg}"
APPS=(${APPS:-quantum-lab-web quantum-lab-api})

# Azure: list rules and build the rule names once per app.
existing() { az containerapp ingress access-restriction list -n "$1" -g "$RESOURCE_GROUP" --query '[].name' -o tsv 2>/dev/null || true; }

if [ "${1:-}" = "--remove" ]; then
  for app in "${APPS[@]}"; do
    for name in $(existing "$app"); do
      az containerapp ingress access-restriction remove -n "$app" -g "$RESOURCE_GROUP" --rule-name "$name" -o none
    done
    echo "$app: open to the internet again"
  done
  exit 0
fi

echo "==> fetching Cloudflare ranges"
V4="$(curl -fsS https://www.cloudflare.com/ips-v4)"
V6="$(curl -fsS https://www.cloudflare.com/ips-v6)"
[ -n "$V4" ] && [ -n "$V6" ] || { echo "could not fetch Cloudflare's ranges" >&2; exit 1; }

for app in "${APPS[@]}"; do
  echo "==> $app"
  have="$(existing "$app")"
  i=0
  for cidr in $V4 $V6; do
    i=$((i+1))
    name="cloudflare-$i"
    if grep -qx "$name" <<<"$have"; then
      az containerapp ingress access-restriction set -n "$app" -g "$RESOURCE_GROUP" \
        --rule-name "$name" --ip-address "$cidr" --action Allow -o none
    else
      az containerapp ingress access-restriction set -n "$app" -g "$RESOURCE_GROUP" \
        --rule-name "$name" --ip-address "$cidr" --action Allow --description "Cloudflare edge" -o none
    fi
  done
  # Drop rules from an older, longer list.
  for name in $have; do
    n="${name#cloudflare-}"
    if [[ "$name" == cloudflare-* ]] && [ "$n" -gt "$i" ] 2>/dev/null; then
      az containerapp ingress access-restriction remove -n "$app" -g "$RESOURCE_GROUP" --rule-name "$name" -o none
    fi
  done
  echo "   $i allow rules; every other address now gets 403 from Azure"
done

echo
echo "Verify: the site works through https://qubit16.ai, and the raw"
echo "*.azurecontainerapps.io hostname of each app answers 403."
echo "Also set Cloudflare → SSL/TLS → Overview → Full (strict), so the edge"
echo "checks the origin certificate (Container Apps' certificate is valid)."
