#!/usr/bin/env bash
# Quantum Lab — one-shot AWS App Runner deploy.
# Run this INSIDE AWS CloudShell (console top bar -> the ">_" icon), logged
# in as the account that has the Activate credit ($1,100, acct 611597330285).
# CloudShell already has `aws` authenticated and `docker` working — nothing
# to install.
#
# What it does, in order (mirrors docs/DEPLOYMENT-AWS.md):
#   1. Unpacks quantum-lab-deploy.tar.gz (upload it via CloudShell's Actions
#      -> Upload file button first) into ~/quantum-lab
#   2. Creates the 3 ECR repos, builds+pushes pass-1 images (empty NEXT_PUBLIC_*)
#   3. Creates IAM roles + SSM secrets (prompts for ANTHROPIC_API_KEY, or skip)
#   4. Creates api + agent App Runner services, waits for them, captures URLs
#   5. Rebuilds the web image (pass 2) with real API/AGENT URLs baked in,
#      deploys the web service
#   6. Wires ALLOWED_ORIGINS on api+agent to the real web URL
#   7. Sets a $50/mo CloudWatch billing alarm
#   8. Prints the 3 live URLs + curl checks
#
# Safe to re-run: every `aws` call either checks-first or uses an
# idempotent flag. Costs real money against your AWS account the moment
# step 4 finishes (~$26-42/mo floor per docs/DEPLOYMENT-AWS.md §11) — this
# script does not ask for a second confirmation once you launch it, so only
# run it when you mean it.
set -euo pipefail

# ---------------------------------------------------------------- 0. config
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ECR="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/quantum-lab"
WORKDIR="$HOME/quantum-lab"
TARBALL="$HOME/quantum-lab-deploy.tar.gz"

echo "==> Account: $ACCOUNT_ID   Region: $AWS_REGION"

if [ ! -d "$WORKDIR" ]; then
  if [ ! -f "$TARBALL" ]; then
    echo "!! $TARBALL not found. In CloudShell: Actions menu (top right) ->"
    echo "   Upload file -> pick quantum-lab-deploy.tar.gz, then re-run this script."
    exit 1
  fi
  mkdir -p "$WORKDIR"
  tar -xzf "$TARBALL" -C "$WORKDIR"
fi
cd "$WORKDIR"
export TAG="$(date +%Y%m%d%H%M%S)"
echo "==> Image tag: $TAG"

# ---------------------------------------------------------- 1. ECR + build
echo "==> ECR repositories"
for repo in web api agent; do
  aws ecr describe-repositories --repository-names "quantum-lab/$repo" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "quantum-lab/$repo" >/dev/null
done

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

echo "==> Building pass-1 images (no NEXT_PUBLIC_* yet — filled in at step 5)"
docker build -f apps/web/Dockerfile -t "$ECR/web:$TAG" .
docker build -t "$ECR/api:$TAG"   services/api
docker build -t "$ECR/agent:$TAG" services/agent

echo "==> Pushing pass-1 images"
docker push "$ECR/web:$TAG"
docker push "$ECR/api:$TAG"
docker push "$ECR/agent:$TAG"

# --------------------------------------------------------- 2. IAM + secrets
echo "==> IAM roles"
if ! aws iam get-role --role-name quantum-lab-apprunner-ecr-access >/dev/null 2>&1; then
  cat > /tmp/ecr-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
  aws iam create-role --role-name quantum-lab-apprunner-ecr-access \
    --assume-role-policy-document file:///tmp/ecr-trust.json >/dev/null
  aws iam attach-role-policy --role-name quantum-lab-apprunner-ecr-access \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
fi
ECR_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/quantum-lab-apprunner-ecr-access"

if ! aws iam get-role --role-name quantum-lab-apprunner-instance >/dev/null 2>&1; then
  cat > /tmp/instance-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
  aws iam create-role --role-name quantum-lab-apprunner-instance \
    --assume-role-policy-document file:///tmp/instance-trust.json >/dev/null
  cat > /tmp/ssm-read.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ssm:GetParameters"],"Resource":"arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/quantum-lab/*"}]}
EOF
  aws iam put-role-policy --role-name quantum-lab-apprunner-instance \
    --policy-name read-quantum-lab-parameters --policy-document file:///tmp/ssm-read.json
fi
INSTANCE_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/quantum-lab-apprunner-instance"
echo "==> Waiting 10s for IAM propagation..."
sleep 10

echo "==> Secrets (SSM SecureString)"
if ! aws ssm get-parameter --name /quantum-lab/api-shared-secret >/dev/null 2>&1; then
  aws ssm put-parameter --name /quantum-lab/api-shared-secret \
    --type SecureString --value "$(openssl rand -hex 32)" >/dev/null
fi
API_SECRET_ARN="arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/quantum-lab/api-shared-secret"

# Cheapest-first, same order as docs/LLM-GATEWAY.md: Gemini (free tier) >
# Groq (cheap) > Anthropic (premium). Only writes a key not already stored.
#
# NON-INTERACTIVE ON PURPOSE (also fixes a real bug: the old `read -r -p`
# below ran unconditionally with no `[ -t 0 ]` guard, so under `set -euo
# pipefail` a non-interactive run — CI, a piped invocation, anything with
# closed stdin — would have `read` fail and abort the whole deploy). Apart
# from Supabase (NEXT_PUBLIC_* is baked into the client bundle at build
# time, so it genuinely can't be changed without a rebuild), every other
# piece of config here has a real runtime path: LLM keys are the ENV LAYER
# only, and a platform admin (PLATFORM_ADMIN_EMAILS) can add, replace, test
# and remove them at /admin/platform without touching this script again.
# Pass GEMINI_KEY / GROQ_KEY / ANTHROPIC_KEY as env vars if you want one
# wired in from the start; leave them unset and this deploys straight
# through with the tutor on its offline tier.
GEMINI_KEY="${GEMINI_KEY:-}"
GROQ_KEY="${GROQ_KEY:-}"
ANTHROPIC_KEY="${ANTHROPIC_KEY:-}"
if [ -z "$GEMINI_KEY" ] && [ -z "$GROQ_KEY" ] && [ -z "$ANTHROPIC_KEY" ] \
   && ! aws ssm get-parameter --name /quantum-lab/gemini-api-key >/dev/null 2>&1 \
   && ! aws ssm get-parameter --name /quantum-lab/groq-api-key >/dev/null 2>&1 \
   && ! aws ssm get-parameter --name /quantum-lab/anthropic-api-key >/dev/null 2>&1; then
  echo "   No LLM key in the environment or SSM — deploying with the tutor on its"
  echo "   offline tier. Add one anytime at https://<your-domain>/admin/platform (needs"
  echo "   PLATFORM_ADMIN_EMAILS) with no redeploy needed, or set GEMINI_KEY / GROQ_KEY /"
  echo "   ANTHROPIC_KEY as env vars and re-run this script."
fi

GEMINI_SECRET_ARN=""
if ! aws ssm get-parameter --name /quantum-lab/gemini-api-key >/dev/null 2>&1; then
  if [ -n "$GEMINI_KEY" ]; then
    aws ssm put-parameter --name /quantum-lab/gemini-api-key \
      --type SecureString --value "$GEMINI_KEY" >/dev/null
  fi
fi
if aws ssm get-parameter --name /quantum-lab/gemini-api-key >/dev/null 2>&1; then
  GEMINI_SECRET_ARN="arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/quantum-lab/gemini-api-key"
fi

GROQ_SECRET_ARN=""
if [ -z "$GEMINI_SECRET_ARN" ] && ! aws ssm get-parameter --name /quantum-lab/groq-api-key >/dev/null 2>&1; then
  if [ -n "$GROQ_KEY" ]; then
    aws ssm put-parameter --name /quantum-lab/groq-api-key \
      --type SecureString --value "$GROQ_KEY" >/dev/null
  fi
fi
if aws ssm get-parameter --name /quantum-lab/groq-api-key >/dev/null 2>&1; then
  GROQ_SECRET_ARN="arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/quantum-lab/groq-api-key"
fi

ANTHROPIC_SECRET_ARN=""
if [ -z "$GEMINI_SECRET_ARN" ] && [ -z "$GROQ_SECRET_ARN" ] \
   && ! aws ssm get-parameter --name /quantum-lab/anthropic-api-key >/dev/null 2>&1; then
  if [ -n "$ANTHROPIC_KEY" ]; then
    aws ssm put-parameter --name /quantum-lab/anthropic-api-key \
      --type SecureString --value "$ANTHROPIC_KEY" >/dev/null
  fi
fi
if aws ssm get-parameter --name /quantum-lab/anthropic-api-key >/dev/null 2>&1; then
  ANTHROPIC_SECRET_ARN="arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/quantum-lab/anthropic-api-key"
fi

# The model id each service picks up — cheapest configured provider wins.
if [ -n "$GEMINI_SECRET_ARN" ]; then
  AGENT_MODEL="gemini/gemini-2.5-flash"; WEB_TUTOR_MODEL="gemini-2.5-flash"
elif [ -n "$GROQ_SECRET_ARN" ]; then
  AGENT_MODEL="groq/llama-3.3-70b-versatile"; WEB_TUTOR_MODEL="llama-3.3-70b-versatile"
elif [ -n "$ANTHROPIC_SECRET_ARN" ]; then
  AGENT_MODEL="anthropic/claude-sonnet-4-6"; WEB_TUTOR_MODEL="claude-sonnet-4-6"
else
  AGENT_MODEL="gemini/gemini-2.5-flash"; WEB_TUTOR_MODEL=""
fi

# ------------------------------------------------------- 3. deploy: api
echo "==> Deploying services/api"
API_ASG_ARN=$(aws apprunner list-auto-scaling-configurations \
  --auto-scaling-configuration-name quantum-lab-api \
  --query "AutoScalingConfigurationSummaryList[0].AutoScalingConfigurationArn" --output text 2>/dev/null || echo "None")
if [ "$API_ASG_ARN" = "None" ] || [ -z "$API_ASG_ARN" ]; then
  API_ASG_ARN=$(aws apprunner create-auto-scaling-configuration \
    --auto-scaling-configuration-name quantum-lab-api \
    --min-size 1 --max-size 1 --max-concurrency 8 \
    --query "AutoScalingConfiguration.AutoScalingConfigurationArn" --output text)
fi

sed \
  -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" -e "s|<REGION>|$AWS_REGION|g" -e "s|<TAG>|$TAG|g" \
  -e "s|<API_AUTOSCALING_CONFIG_ARN>|$API_ASG_ARN|g" \
  -e "s|<WEB_ORIGIN_OR_http://localhost:3000_UNTIL_KNOWN>|http://localhost:3000|g" \
  infra/aws/apprunner-api.json > /tmp/apprunner-api.json
python3 - "$API_SECRET_ARN" <<'PYEOF' /tmp/apprunner-api.json
import json,sys
secret = sys.argv[1]
path = sys.argv[2]
d = json.load(open(path))
d["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"]["RuntimeEnvironmentSecrets"]["API_SHARED_SECRET"] = secret
json.dump(d, open(path,"w"), indent=2)
PYEOF

if ! API_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='quantum-lab-api'].ServiceArn" --output text) || [ -z "$API_ARN" ]; then
  API_ARN=$(aws apprunner create-service --cli-input-json file:///tmp/apprunner-api.json --query "Service.ServiceArn" --output text)
fi
echo "==> Waiting for api to be RUNNING (this takes a few minutes — qiskit import)..."
aws apprunner wait service-running --service-arn "$API_ARN" || true
API_URL="https://$(aws apprunner describe-service --service-arn "$API_ARN" --query Service.ServiceUrl --output text)"
echo "==> api: $API_URL"
curl -s -o /dev/null -w "   /api/health -> %{http_code}\n" "$API_URL/api/health" || true

# ------------------------------------------------------- 4. deploy: agent
echo "==> Deploying services/agent"
AGENT_ASG_ARN=$(aws apprunner list-auto-scaling-configurations \
  --auto-scaling-configuration-name quantum-lab-agent \
  --query "AutoScalingConfigurationSummaryList[0].AutoScalingConfigurationArn" --output text 2>/dev/null || echo "None")
if [ "$AGENT_ASG_ARN" = "None" ] || [ -z "$AGENT_ASG_ARN" ]; then
  # max-size 1, same reasoning as web/api: no traffic to serve yet.
  AGENT_ASG_ARN=$(aws apprunner create-auto-scaling-configuration \
    --auto-scaling-configuration-name quantum-lab-agent \
    --min-size 1 --max-size 1 --max-concurrency 8 \
    --query "AutoScalingConfiguration.AutoScalingConfigurationArn" --output text)
fi

sed \
  -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" -e "s|<REGION>|$AWS_REGION|g" -e "s|<TAG>|$TAG|g" \
  -e "s|<AGENT_AUTOSCALING_CONFIG_ARN>|$AGENT_ASG_ARN|g" \
  -e "s|<WEB_ORIGIN_OR_http://localhost:3000_UNTIL_KNOWN>|http://localhost:3000|g" \
  infra/aws/apprunner-agent.json > /tmp/apprunner-agent.json
# Cheapest-first: whichever of Gemini/Groq/Anthropic is configured goes in as
# a secret, and MODEL (set above from the same choice) picks which one the
# agent actually calls at runtime — see docs/LLM-GATEWAY.md.
python3 - "$GEMINI_SECRET_ARN" "$GROQ_SECRET_ARN" "$ANTHROPIC_SECRET_ARN" "$AGENT_MODEL" <<'PYEOF' /tmp/apprunner-agent.json
import json,sys
gemini, groq, anthropic, model = sys.argv[1:5]
path = sys.argv[5]
d = json.load(open(path))
cfg = d["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"]
secrets = cfg["RuntimeEnvironmentSecrets"]
for name, value in (("GEMINI_API_KEY", gemini), ("GROQ_API_KEY", groq), ("ANTHROPIC_API_KEY", anthropic)):
    if value:
        secrets[name] = value
    else:
        secrets.pop(name, None)
cfg.setdefault("RuntimeEnvironmentVariables", {})["MODEL"] = model
json.dump(d, open(path,"w"), indent=2)
PYEOF

if ! AGENT_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='quantum-lab-agent'].ServiceArn" --output text) || [ -z "$AGENT_ARN" ]; then
  AGENT_ARN=$(aws apprunner create-service --cli-input-json file:///tmp/apprunner-agent.json --query "Service.ServiceArn" --output text)
fi
echo "==> Waiting for agent to be RUNNING..."
aws apprunner wait service-running --service-arn "$AGENT_ARN" || true
AGENT_URL="https://$(aws apprunner describe-service --service-arn "$AGENT_ARN" --query Service.ServiceUrl --output text)"
echo "==> agent: $AGENT_URL"
curl -s -o /dev/null -w "   /api/agent/health -> %{http_code}\n" "$AGENT_URL/api/agent/health" || true

# --------------------------------------------------------- 5. deploy: web
echo "==> Deploying services/web (pass 1 — empty NEXT_PUBLIC_*, just to get a URL)"
WEB_ASG_ARN=$(aws apprunner list-auto-scaling-configurations \
  --auto-scaling-configuration-name quantum-lab-web \
  --query "AutoScalingConfigurationSummaryList[0].AutoScalingConfigurationArn" --output text 2>/dev/null || echo "None")
if [ "$WEB_ASG_ARN" = "None" ] || [ -z "$WEB_ASG_ARN" ]; then
  # max-size 1: no real traffic yet, so no reason to allow scale-out — every
  # extra instance is another provisioned-memory floor cost. Raise this once
  # there's real usage to protect against (docs/DEPLOYMENT-AWS.md §1).
  WEB_ASG_ARN=$(aws apprunner create-auto-scaling-configuration \
    --auto-scaling-configuration-name quantum-lab-web \
    --min-size 1 --max-size 1 --max-concurrency 100 \
    --query "AutoScalingConfiguration.AutoScalingConfigurationArn" --output text)
fi

sed \
  -e "s|<ACCOUNT_ID>|$ACCOUNT_ID|g" -e "s|<REGION>|$AWS_REGION|g" -e "s|<TAG>|$TAG|g" \
  -e "s|<WEB_AUTOSCALING_CONFIG_ARN>|$WEB_ASG_ARN|g" \
  -e "s|<AGENT_SERVICE_URL_https://xxxx.region.awsapprunner.com>|$AGENT_URL|g" \
  infra/aws/apprunner-web.json > /tmp/apprunner-web.json
python3 - "$API_SECRET_ARN" "$GEMINI_SECRET_ARN" "$GROQ_SECRET_ARN" "$ANTHROPIC_SECRET_ARN" "$WEB_TUTOR_MODEL" <<'PYEOF' /tmp/apprunner-web.json
import json,sys
api_secret, gemini, groq, anthropic, tutor_model = sys.argv[1:6]
path = sys.argv[6]
d = json.load(open(path))
cfg = d["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"]
cfg["RuntimeEnvironmentSecrets"]["QUANTUM_API_SECRET"] = api_secret
# Tier 2 (direct model call) — same cheapest-first provider keys as the
# agent service, via the open-source Vercel AI SDK. See docs/LLM-GATEWAY.md.
for name, value in (("GEMINI_API_KEY", gemini), ("GROQ_API_KEY", groq), ("ANTHROPIC_API_KEY", anthropic)):
    if value:
        cfg["RuntimeEnvironmentSecrets"][name] = value
if tutor_model:
    cfg.setdefault("RuntimeEnvironmentVariables", {})["TUTOR_MODEL"] = tutor_model
json.dump(d, open(path,"w"), indent=2)
PYEOF

if ! WEB_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='quantum-lab-web'].ServiceArn" --output text) || [ -z "$WEB_ARN" ]; then
  WEB_ARN=$(aws apprunner create-service --cli-input-json file:///tmp/apprunner-web.json --query "Service.ServiceArn" --output text)
  echo "==> Waiting for web (pass 1) to be RUNNING..."
  aws apprunner wait service-running --service-arn "$WEB_ARN" || true
fi
WEB_URL="https://$(aws apprunner describe-service --service-arn "$WEB_ARN" --query Service.ServiceUrl --output text)"
echo "==> web (pass 1) live at: $WEB_URL"

echo "==> Rebuilding web (pass 2) with real URLs baked in"
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_URL="$WEB_URL" \
  --build-arg NEXT_PUBLIC_API_URL="$API_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
  --build-arg NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN:-}" \
  -t "$ECR/web:$TAG-web" .
docker push "$ECR/web:$TAG-web"

sed -i "s|$ECR/web:$TAG\"|$ECR/web:$TAG-web\"|" /tmp/apprunner-web.json
python3 - <<'PYEOF' /tmp/apprunner-web.json
import json,sys
path = sys.argv[1]
d = json.load(open(path))
d.pop("ServiceName", None)
json.dump(d, open(path,"w"), indent=2)
PYEOF
echo "==> Redeploying web with real URLs"
aws apprunner update-service --service-arn "$WEB_ARN" --cli-input-json file:///tmp/apprunner-web.json >/dev/null
aws apprunner wait service-running --service-arn "$WEB_ARN" || true
echo "==> web: $WEB_URL"
curl -s -o /dev/null -w "   /api/health -> %{http_code}\n" "$WEB_URL/api/health" || true

# ---------------------------------------------------------- 6. wire origins
echo "==> Pointing api + agent ALLOWED_ORIGINS at $WEB_URL"
sed -i "s|http://localhost:3000|$WEB_URL|" /tmp/apprunner-api.json /tmp/apprunner-agent.json
python3 - <<'PYEOF' /tmp/apprunner-api.json /tmp/apprunner-agent.json
import json,sys
for path in sys.argv[1:]:
    d = json.load(open(path))
    d.pop("ServiceName", None)
    json.dump(d, open(path,"w"), indent=2)
PYEOF
aws apprunner update-service --service-arn "$API_ARN"   --cli-input-json file:///tmp/apprunner-api.json   >/dev/null
aws apprunner update-service --service-arn "$AGENT_ARN" --cli-input-json file:///tmp/apprunner-agent.json >/dev/null
aws apprunner wait service-running --service-arn "$API_ARN" || true
aws apprunner wait service-running --service-arn "$AGENT_ARN" || true

# ------------------------------------------------------ 7. billing alarm
echo "==> Billing alarm at \$50/mo (us-east-1 required for billing metrics)"
aws cloudwatch put-metric-alarm --region us-east-1 \
  --alarm-name quantum-lab-billing-50usd \
  --alarm-description "Quantum Lab AWS spend over \$50 estimated for the month" \
  --namespace "AWS/Billing" --metric-name EstimatedCharges \
  --dimensions Name=Currency,Value=USD \
  --statistic Maximum --period 21600 --evaluation-periods 1 \
  --threshold 50 --comparison-operator GreaterThanThreshold >/dev/null 2>&1 \
  || echo "   (skipped — enable 'Receive Billing Alerts' in Billing Preferences first, then re-run just this step)"

# ------------------------------------------------------------- done
echo ""
echo "================================================================"
echo " DEPLOYED"
echo "   web:   $WEB_URL"
echo "   api:   $API_URL   (internal — browsers never call this directly)"
echo "   agent: $AGENT_URL (internal — same)"
echo ""
echo " Open the web URL above. Course/simulator/visualizations/challenges"
echo " work immediately. Tutor is offline-tier until Supabase/Anthropic"
echo " secrets are added — see docs/DEPLOYMENT-AWS.md §5-7 for the rest."
echo "================================================================"
