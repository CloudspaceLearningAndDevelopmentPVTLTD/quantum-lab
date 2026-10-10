#!/usr/bin/env bash
# One-time setup for .github/workflows/deploy.yml: creates the Azure identity
# GitHub Actions deploys with, and tells GitHub about it.
#
# Run by a human, once:   bash infra/azure/setup-github-oidc.sh
#
# What it grants: an Entra app "quantum-lab-github-deploy" gets Contributor on
# the resource group quantum-lab-rg ONLY, usable ONLY by workflow jobs of this
# repo running in the `production` environment (OIDC — no password is created
# or stored anywhere). Safe to re-run. To undo:
#   az ad app delete --id <appId printed below>
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash would rewrite /subscriptions/... otherwise

REPO="${REPO:-cdandlc/quantum-lab}"
RESOURCE_GROUP="${RESOURCE_GROUP:-quantum-lab-rg}"
APP_NAME="quantum-lab-github-deploy"

SUB="$(az account show --query id -o tsv)"
TENANT="$(az account show --query tenantId -o tsv)"
echo "==> Subscription $SUB, tenant $TENANT, repo $REPO"

APP_ID="$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)"
if [ -z "$APP_ID" ]; then
  APP_ID="$(az ad app create --display-name "$APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  echo "==> Created app registration $APP_ID"
else
  echo "==> Reusing app registration $APP_ID"
fi

SP_ID="$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)"
[ -z "$SP_ID" ] && SP_ID="$(az ad sp create --id "$APP_ID" --query id -o tsv)"

# GitHub's OIDC subject claim embeds the numeric owner and repository ids:
#   repo:<owner>@<owner_id>/<repo>@<repo_id>:environment:production
# The older id-less form (repo:<owner>/<repo>:environment:production) is no
# longer what the token carries, so a credential written in that form fails
# with AADSTS700213 "No matching federated identity record". Both forms are
# registered so the identity keeps working whichever one GitHub presents.
OWNER_ID="$(gh api "repos/$REPO" --jq .owner.id)"
REPO_ID="$(gh api "repos/$REPO" --jq .id)"
OWNER="${REPO%%/*}"; NAME="${REPO##*/}"
add_subject() { # <credential name> <subject>
  if [ -z "$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='$1'].name" -o tsv)" ]; then
    FIC="$(mktemp)"
    printf '{"name":"%s","issuer":"https://token.actions.githubusercontent.com","subject":"%s","audiences":["api://AzureADTokenExchange"]}' "$1" "$2" > "$FIC"
    az ad app federated-credential create --id "$APP_ID" --parameters "@$FIC" >/dev/null
    rm -f "$FIC"
    echo "==> Federated credential added: $2"
  fi
}
add_subject github-production-ids "repo:$OWNER@$OWNER_ID/$NAME@$REPO_ID:environment:production"
add_subject github-production     "repo:$REPO:environment:production"

echo "==> Granting Contributor on $RESOURCE_GROUP (retries while the principal propagates)"
for _ in 1 2 3 4 5 6; do
  az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
    --role Contributor --scope "/subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP" >/dev/null 2>&1 && break
  sleep 10
done
az role assignment list --assignee "$SP_ID" --scope "/subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP" \
  --query "[0].roleDefinitionName" -o tsv | grep -q Contributor || { echo "!! Role assignment failed"; exit 1; }

echo "==> Writing GitHub secrets and switching the deploy workflow on"
gh secret set AZURE_CLIENT_ID -R "$REPO" --body "$APP_ID"
gh secret set AZURE_TENANT_ID -R "$REPO" --body "$TENANT"
gh secret set AZURE_SUBSCRIPTION_ID -R "$REPO" --body "$SUB"
gh variable set AZURE_DEPLOY_ENABLED -R "$REPO" --body true

echo "==> Done. Test it:  gh workflow run Deploy -R $REPO -f services=web"
