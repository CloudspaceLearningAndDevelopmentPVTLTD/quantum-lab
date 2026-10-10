# Deploying Quantum Lab to AWS (App Runner)

A paste-along: three App Runner services, three ECR repositories, three
committed service definitions under `infra/aws/`. Written for someone who has
an AWS account, a credit card, and this repository, and has read nothing else.
Where this document and `docs/DEPLOYMENT.md` overlap (env vars, Supabase,
Stripe), that document is the deeper reference; this one is the AWS-shaped
path through it. The GCP equivalent (`docs/DEPLOYMENT-GCP.md`) remains valid —
this is the path the owner chose.

---

## 0. What is verified and what is not — read this first

**Every `aws` command in this document is [UNVERIFIED].** It was written in a
sandbox with no `aws` binary, no Docker daemon, and no AWS account — not one
of these commands has ever been executed. The same markers as
`docs/DEPLOYMENT.md` apply:

| Marker | Means |
| --- | --- |
| **[RUN]** | Executed in the authoring container against this exact tree. |
| **[READ]** | Verified by reading code or a pinned dependency's source. Not executed. |
| **[UNVERIFIED]** | Neither. Written from provider documentation and reasoning. Your first run is the test. |

What *is* more than guesswork:

- **[READ]** The three Dockerfiles exist (`apps/web/Dockerfile`,
  `services/api/Dockerfile`, `services/agent/Dockerfile`), every path each one
  `COPY`s exists in its build context, and the context/`-f` pairing matches
  `docker-compose.yml` and `cloudbuild.yaml`.
- **[READ]** All three containers bind `0.0.0.0` and honour an injected
  `$PORT`; the App Runner `Port` values in `infra/aws/*.json` (3000, 8000,
  8001) match each image's default, so no override is needed anywhere below.
- **[READ]** The health endpoints named in §10 exist:
  `apps/web/app/api/health/route.ts` (with the `?deep=1` opt-in),
  `/api/health` in `services/api` (exempt from the shared-secret gate —
  `EXEMPT_PATHS` in `app/core/security.py`, so App Runner's probe works when
  `API_SHARED_SECRET` is set), `/api/agent/health` in `services/agent`.
- **[RUN]** The three JSON files under `infra/aws/` parse as JSON, and their
  field names/shapes were checked against the current `aws apprunner
  create-service` reference — but no `create-service` has ever consumed them.

**No `docker build` of any of these images has ever succeeded anywhere** —
not here, not in CI, not locally (`docs/DEPLOYMENT.md` §10). If the build
fails at a `COPY` or during `next build`, suspect the image, not your AWS
setup, and read the FALLBACK comment at the bottom of `apps/web/Dockerfile`.

**What stays outside AWS, on purpose.** Supabase (accounts/data), Upstash
(shared rate-limit store), Stripe (billing) and Resend (email) are external
SaaS. The code speaks their APIs directly — do **not** try to substitute RDS
for Supabase or ElastiCache for Upstash; `lib/rateLimit.ts` speaks the
Upstash *REST* dialect, not the Redis wire protocol, and the Supabase client
is not a generic Postgres client. Yes, this means an AWS deployment still
depends on non-AWS SaaS; that is the design, not an oversight. (`REDIS_URL`
on `services/api` *is* real Redis — ElastiCache would work there, but App
Runner would need a VPC connector to reach it; skip it at this scale, see the
`REDIS_URL` row in §5.)

**All of it is optional.** As in every other deployment path of this repo, an
empty environment boots and works — course, simulator, visualizations,
offline tutor. Each variable in §§5–7 only unlocks an extra.

---

## 1. Why App Runner, and what it costs to sit idle — the honest version

Research done August 2026 against current AWS pricing pages. Three candidate
shapes for three small containers at ~50 users:

| | App Runner | ECS Fargate + one ALB | Lightsail Containers |
| --- | --- | --- | --- |
| Closest analog to | Cloud Run (minus one thing, below) | Kubernetes-lite | Heroku-ish flat rate |
| Scale to zero | **No** — min 1 provisioned instance per service, billed for **memory only** while idle ($0.007/GB-hr) | No — a Fargate task runs 24/7 or you build your own scheduler | No — nodes run 24/7 |
| Idle floor, our three sizes | **≈ $15/mo** (1 GB + 1 GB + 1 GB provisioned memory — deliberately minimal, no real users yet; ≈ $26/mo at the safer 2+2+1 GB sizing) | ≈ $90/mo tasks + **≈ $17/mo ALB fixed** ($0.0225/hr) + LCUs | ≈ $90–95/mo (web `medium` $40 + api `medium` $40 + agent `small` $15) |
| Active compute | +$0.064/vCPU-hr only while serving requests | included in the 24/7 task price | included in the flat price |
| HTTPS + domain | managed, per service | you configure ACM + ALB listeners | managed |
| Moving parts you own | ~none | cluster, task defs, target groups, listeners, security groups, ACM | few |

**Chosen: App Runner.** At 50 users the fleet is idle most of every day, and
App Runner is the only one of the three whose idle price is memory-only:
roughly **$26/month floor** for our sizing versus ~$107/month for
Fargate+ALB and ~$90–95/month for Lightsail, with active vCPU billed
per-second on top only while requests are in flight. It is also the closest
operational match to the Cloud Run kit this document mirrors: give it an
image, get a HTTPS URL, no VPC/ALB/cluster to own.

**The one honest asterisk:** unlike Cloud Run, **App Runner cannot scale to
zero** — the feature request (aws/apprunner-roadmap#9) has been open since
2021 and is still open. Each service keeps ≥1 provisioned instance whose
*memory* bills around the clock: at $0.007/GB-hour that is ~$10.22/mo per
2 GB service and ~$5.11/mo for the 1 GB agent, **even with zero traffic**.
`aws apprunner pause-service` stops a service (and, per AWS's pricing page,
is offered as the cost lever) — but a paused service serves nothing until you
`resume-service`; it is a manual off-switch, not autoscaling. [UNVERIFIED]
whether a paused service bills $0 — AWS markets pause as cost control but
does not print "billed: nothing" anywhere we could cite.

A second App Runner limit worth knowing before you commit: the **request
timeout is a fixed 120 seconds** and not configurable
(aws/apprunner-roadmap#104, still open — [UNVERIFIED] as a number). The GCP
kit gave the api 300 s. At 50 users, simulator calls complete in seconds and
hardware submissions are job-based (submit, then poll), so 120 s should not
bite — but a pathological long synchronous circuit run will be cut off at the
edge where Cloud Run would have waited.

**Runner-up: Lightsail Containers** — flat, predictable, HTTPS included, and
the simplest console on AWS. Take it if you would trade ~$65/month extra for
never thinking about per-second billing: `micro` ($10, 0.25 vCPU/1 GB) is too
small for qiskit imports, so the api really wants `medium` ($40, 1 vCPU/2 GB)
and the bill lands near $90/mo for the trio. Rejected here on price, not
quality. **ECS Fargate + ALB rejected** for this scale: the ALB alone has a
~$17/month fixed floor before a single request, the tasks bill 24/7, and it
is by far the most moving parts.

**Build/push:** plain `docker build` + `docker push` to ECR is still the
standard, current path (§3); AWS CodeBuild is the managed alternative if you
have no local Docker, but at ~10 builds/month it adds a service and a
buildspec for no gain — this document uses local Docker, matching §3.2 of the
GCP doc. **Secrets:** App Runner natively injects from **SSM Parameter
Store** and **Secrets Manager** (`RuntimeEnvironmentSecrets`, §4). This
document uses SSM `SecureString` parameters because standard-tier parameters
are free where Secrets Manager charges $0.40/secret/month; swap the ARNs if
your org standardizes on Secrets Manager.

---

## 2. Account setup

[UNVERIFIED] throughout. Pick a region once and stay in it; this document
writes `us-east-1` — substitute yours consistently, including inside the
`infra/aws/*.json` files.

```bash
# Install the CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
aws configure          # access key, secret, region, output=json

export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

No "enable APIs" step exists on AWS — ECR, App Runner, SSM and IAM are live
in every account. Do set a **billing alarm** before anything else (§11).

---

## 3. ECR + build + push the three images

One repository per image (ECR repositories hold one image name each — this is
the ECR shape, unlike Artifact Registry's one-repo-many-images):

```bash
aws ecr create-repository --repository-name quantum-lab/web
aws ecr create-repository --repository-name quantum-lab/api
aws ecr create-repository --repository-name quantum-lab/agent

# Log local docker into ECR (token lasts 12h; rerun when pushes start 403ing):
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

export ECR="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/quantum-lab"
export TAG=$(git rev-parse --short HEAD)
```

**Order matters, and it is backwards from what you would guess** — same dance
as the GCP doc §3. The web image freezes `NEXT_PUBLIC_API_URL` (and every
other `NEXT_PUBLIC_*`) into its compiled output at build time — see "BUILD
TIME vs RUN TIME" in `.env.example`. The api and agent URLs do not exist
until those services are deployed. So:

1. Build all three once with no build args (the web image gets empty
   `NEXT_PUBLIC_*` values — a valid, extras-off configuration).
2. Deploy api and agent (§5, §6) and note their URLs.
3. **Rebuild the web image** with the real URLs and deploy it (§7).

The api and agent images never need the rebuild; only web does.

```bash
# Pass 1 — from the REPO ROOT. Web context is the root (npm workspace, root
# lockfile — see the header of apps/web/Dockerfile); Python services build
# from their own directories:
docker build -f apps/web/Dockerfile -t "$ECR/web:$TAG" .
docker build -t "$ECR/api:$TAG"   services/api
docker build -t "$ECR/agent:$TAG" services/agent

docker push "$ECR/web:$TAG" && docker push "$ECR/api:$TAG" && docker push "$ECR/agent:$TAG"
```

Pass 2 (run it after §5–§6, before §7) rebuilds **web only** with the five
build args the Dockerfile declares — this exact list is the `ARG` block in
`apps/web/Dockerfile` **[READ]**, and matches `cloudbuild.yaml`:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_URL=https://<your-web-url> \
  --build-arg NEXT_PUBLIC_API_URL=https://<your-api-url> \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=<blank or your supabase url> \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<blank or anon key> \
  --build-arg NEXT_PUBLIC_SENTRY_DSN=<blank or dsn> \
  -t "$ECR/web:$TAG-web" .
docker push "$ECR/web:$TAG-web"
```

Notes that will save you a support search:

- These build args are compile-time-inlined and served to every browser. They
  are not secrets and must never become secrets — the Supabase *anon* key
  belongs here; the service-role key never does (`docker history` shows ARG
  values, on top of the browser seeing them).
- On Apple Silicon add `--platform linux/amd64` to all three builds: App
  Runner runs amd64 (it does not run arm64 images at all — [UNVERIFIED] as of
  this writing), and the Python images fall back to compiling qiskit from
  source on arm64 anyway (that is what their `build-essential` layer is for —
  it works, slowly).
- No local Docker? `aws codebuild` with a five-line buildspec per image is
  the managed route; not written out here because it adds a third way to do
  the same thing.

---

## 4. One-time IAM + secrets plumbing

App Runner needs two roles — one to *pull from ECR* (service-level), one that
the *running container* assumes to read secrets (instance-level). Then the
secrets themselves go into SSM Parameter Store as `SecureString`s.

```bash
# ── Role 1: ECR access (trusted by build.apprunner.amazonaws.com) ──────────
cat > /tmp/apprunner-ecr-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "build.apprunner.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF
aws iam create-role --role-name quantum-lab-apprunner-ecr-access \
  --assume-role-policy-document file:///tmp/apprunner-ecr-trust.json
aws iam attach-role-policy --role-name quantum-lab-apprunner-ecr-access \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

# ── Role 2: instance role (trusted by tasks.apprunner.amazonaws.com) ───────
cat > /tmp/apprunner-instance-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF
aws iam create-role --role-name quantum-lab-apprunner-instance \
  --assume-role-policy-document file:///tmp/apprunner-instance-trust.json

cat > /tmp/apprunner-ssm-read.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ssm:GetParameters"],
    "Resource": "arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/quantum-lab/*"
  }]
}
EOF
aws iam put-role-policy --role-name quantum-lab-apprunner-instance \
  --policy-name read-quantum-lab-parameters \
  --policy-document file:///tmp/apprunner-ssm-read.json

# ── The secrets. SecureString, standard tier (free). ───────────────────────
# One shared secret, generated once, used by the api (as its gate) and the
# web service (as the credential its proxy presents) — two names, one value.
aws ssm put-parameter --name /quantum-lab/api-shared-secret \
  --type SecureString --value "$(openssl rand -hex 32)"

# Your Anthropic key (skip for the offline tutor — the agent boots and
# reports configured:false):
aws ssm put-parameter --name /quantum-lab/anthropic-api-key \
  --type SecureString --value 'sk-ant-...'
```

The pattern for every further secret in §7's table is identical:
`aws ssm put-parameter --name /quantum-lab/<name> --type SecureString
--value '...'`, then reference its ARN in `RuntimeEnvironmentSecrets`.
**Never** put `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
`ANTHROPIC_API_KEY` or `API_SHARED_SECRET` in plain
`RuntimeEnvironmentVariables` — plain values are visible in the App Runner
console, in `describe-service` output, and to anyone with read access to the
account. Non-secret config (`ALLOWED_ORIGINS`, `AGENT_SERVICE_URL`, clamps)
stays plain on purpose.

Note the SecureString/KMS wrinkle: with the default `aws/ssm` key the
`ssm:GetParameters` grant above suffices; if you encrypt with a customer KMS
key, add `kms:Decrypt` on that key to the instance-role policy. [UNVERIFIED]

---

## 5. Deploy `services/api`

**Read the warning box at the top of `services/api/Dockerfile` first.** This
service executes user-supplied circuits and can spend real IBM/Braket money,
and it is unauthenticated unless `API_SHARED_SECRET` is set. An App Runner
URL is public by default — the public internet. On this platform the web app
must reach the API over HTTPS without AWS SigV4 (the code does not sign
requests), so the deployment below is public **and the shared secret is
treated as mandatory, not optional** — which §4 already created.

App Runner has no `--min-instances/--max-instances` flags; those live in a
reusable **auto scaling configuration**. The api gets `max-size 1` — see the
`REDIS_URL` row below for why that is deliberate and not a typo:

```bash
aws apprunner create-auto-scaling-configuration \
  --auto-scaling-configuration-name quantum-lab-api \
  --min-size 1 --max-size 1 --max-concurrency 8
# Note the AutoScalingConfigurationArn in the output.
```

`--max-concurrency 8`: a circuit run saturates a core; the default 100
concurrent requests on 1 vCPU would queue behind each other inside the one
instance. `--min-size 1` is not a choice — 1 is App Runner's minimum (§1).

Now edit `infra/aws/apprunner-api.json` (committed in this repo): replace
`<ACCOUNT_ID>`, `<REGION>`, `<TAG>`, the autoscaling ARN, and leave
`ALLOWED_ORIGINS` at the localhost placeholder until §8. Then:

```bash
aws apprunner create-service --cli-input-json file://infra/aws/apprunner-api.json

# Poll until Status is RUNNING, then capture the URL:
export API_ARN=$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='quantum-lab-api'].ServiceArn" --output text)
aws apprunner describe-service --service-arn "$API_ARN" \
  --query "Service.{Status:Status,Url:ServiceUrl}"
export API_URL=https://$(aws apprunner describe-service --service-arn "$API_ARN" \
  --query Service.ServiceUrl --output text)

curl "$API_URL/api/health"    # 200 — exempt from the secret gate on purpose
```

Sizing (`0.5 vCPU / 1 GB` in the JSON, since 2026-08): the deliberately
minimal tier — no real users yet, so this trades simulation speed for the
lowest idle-memory floor App Runner offers at this vCPU tier (App Runner's
valid pairs are fixed; `0.5 vCPU` only pairs with `1 GB`, not `2 GB` — see
the full table in App Runner's architecture docs). **Read this before
trusting it blindly**: `qiskit` + `qiskit-aer` + `pennylane`'s import alone
can use several hundred MB, so 1 GB is close to the edge, not comfortably
above it — [UNVERIFIED] whether it OOMs under real concurrent load, since
this was never run against live traffic. If the service crash-loops or
health checks fail, the fix is `"Cpu": "1 vCPU", "Memory": "2 GB"` (the
previous, safer default; ≈ +$10.22/mo idle memory) — check App Runner's
event log for an OOM signal before assuming it's something else.
The health check is HTTP on `/api/health` with a 10 s interval; App Runner
allows deployments up to five minutes to become healthy, which covers the
several-second qiskit/aer/pennylane import (the Docker `HEALTHCHECK`'s 40 s
`start-period` exists for the same physics — App Runner ignores Docker
`HEALTHCHECK`s and uses its own configuration).

### Environment variables — `services/api`

All optional. Plain ones go in `RuntimeEnvironmentVariables`, secrets in
`RuntimeEnvironmentSecrets` (as SSM parameter ARNs), both in
`infra/aws/apprunner-api.json` — then `aws apprunner update-service` (§8).
From `.env.example` and `docs/DEPLOYMENT.md` §4.3:

| Variable | What breaks when unset |
| --- | --- |
| `ALLOWED_ORIGINS` | Browser CORS calls from your real domain are blocked (looks like a network error, not config). `*` is refused — the service will not start. |
| `API_SHARED_SECRET` | The service is completely unauthenticated: anyone with the URL runs circuits and can spend your IBM/Braket credits. Set it (§4 did). **Secret — SSM ARN, never plain.** |
| `DEFAULT_BACKEND` | Defaults to `aer_simulator` (fine). An unknown id refuses to start. |
| `IBM_QUANTUM_TOKEN` | IBM backends report unavailable. (Also needs `qiskit-ibm-runtime` in the image — not in `requirements.txt` today.) Secret if set. |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_DEFAULT_REGION` | Braket reports unavailable. Key id without secret refuses to start. On App Runner prefer granting Braket permissions to the **instance role** instead of static keys — boto3 picks up the role automatically. [UNVERIFIED] that the app's availability check accepts role credentials without `AWS_ROLE_ARN` set — see `.env.example`'s Braket block. |
| `BRAKET_S3_BUCKET` / `BRAKET_S3_PREFIX` | Non-local Braket submissions cannot run. |
| `AZURE_QUANTUM_RESOURCE_ID` / `AZURE_QUANTUM_LOCATION` | Azure targets report unavailable. |
| `REDIS_URL` | Job store is in-process: jobs lost on restart, invisible across instances. **This is why the api's autoscaling config pins `max-size 1`** — with two instances a job poll can hit an instance that never heard of the job. Cheapest fix at this scale: keep `max-size 1`. To scale past one instance, provide real Redis first (ElastiCache needs a VPC connector; Upstash's `redis://` TCP endpoint also works and needs none) and raise `max-size` after. |

---

## 6. Deploy `services/agent`

```bash
aws apprunner create-auto-scaling-configuration \
  --auto-scaling-configuration-name quantum-lab-agent \
  --min-size 1 --max-size 2 --max-concurrency 8
```

Edit `infra/aws/apprunner-agent.json` the same way (account, region, tag,
autoscaling ARN — the `ANTHROPIC_API_KEY` secret ARN points at §4's
parameter; delete that key from `RuntimeEnvironmentSecrets` for the offline
tutor), then:

```bash
aws apprunner create-service --cli-input-json file://infra/aws/apprunner-agent.json

export AGENT_ARN=$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='quantum-lab-agent'].ServiceArn" --output text)
export AGENT_URL=https://$(aws apprunner describe-service --service-arn "$AGENT_ARN" \
  --query Service.ServiceUrl --output text)

curl "$AGENT_URL/api/agent/health"
```

Sizing: `0.5 vCPU / 1 GB` — the agent mostly waits on the Anthropic API; its
own budget is `MAX_AGENT_SECONDS=60` (`agent/config.py`), comfortably inside
App Runner's fixed 120 s request ceiling (§1).

**Deliberately NOT set: `QUANTUM_API_URL`.** [READ] Same finding as the GCP
doc, unchanged by the platform: the agent sends **no** `X-Quantum-Lab-Secret`
header (no code in `services/agent/agent/` reads either secret name), so
pointing it at the now-secret-gated API of §5 gets it a 401 on every circuit
tool call — after which it falls back to a local Aer run inside its own
process anyway. Leaving `QUANTUM_API_URL` unset goes straight to that
fallback: answers identical, one failed round trip saved. If the agent ever
learns to present the secret, set `QUANTUM_API_URL=$API_URL` and revisit
this paragraph.

### Environment variables — `services/agent`

| Variable | What breaks when unset |
| --- | --- |
| `ANTHROPIC_API_KEY` | Tutor is offline-tier: `configured: false`, chat returns setup instructions. Everything else works. **Secret — SSM ARN, never plain.** |
| `MODEL` | Defaults to the id in `agent/config.py`. |
| `ALLOWED_ORIGINS` | Browser calls blocked by CORS; `*` refuses to start. (Only matters if a browser ever calls the agent directly — the app goes through the Next server.) |
| `QUANTUM_API_URL` | Circuit tool runs locally in-process (see above — on this platform that is the *correct* setting today). |
| `QUANTUM_LAB_RAG_INDEX` | Uses the committed `data/course_index.json` (the image copies it). Warns at boot if missing. |
| `MAX_TOOL_ROUNDS`, `MAX_AGENT_SECONDS`, `MAX_HISTORY_TURNS`, `MAX_MESSAGE_CHARS`, `MAX_SHOTS` | Sane defaults from `agent/config.py`; non-positive values refuse to start. |

---

## 7. Build and deploy the web app

Now that `$API_URL` and `$AGENT_URL` exist, the two-pass dance from §3. One
wrinkle: the web app's own URL is also a build arg (`NEXT_PUBLIC_APP_URL`),
and it does not exist until the first web deploy. Two options:

- Deploy web once from the pass-1 image (empty `NEXT_PUBLIC_*`), read its
  `…awsapprunner.com` URL, rebuild with real args, redeploy. (What this doc
  assumes.)
- Or, if you already know your custom domain (§9), bake that domain in
  directly and skip a pass.

```bash
aws apprunner create-auto-scaling-configuration \
  --auto-scaling-configuration-name quantum-lab-web \
  --min-size 1 --max-size 3 --max-concurrency 100
```

Edit `infra/aws/apprunner-web.json`: account, region, `<TAG>` (pass-1 tag for
now), autoscaling ARN, `AGENT_SERVICE_URL` → `$AGENT_URL`. The
`QUANTUM_API_SECRET` secret ARN already points at §4's shared parameter —
same value the api reads as `API_SHARED_SECRET`; one parameter, two mounts,
which is what keeps the proxy's header equal to the api's gate.

```bash
aws apprunner create-service --cli-input-json file://infra/aws/apprunner-web.json

export WEB_ARN=$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='quantum-lab-web'].ServiceArn" --output text)
export WEB_URL=https://$(aws apprunner describe-service --service-arn "$WEB_ARN" \
  --query Service.ServiceUrl --output text)
```

Rebuild web with the real URLs frozen in (pass 2 of §3), then point the
service at the new tag — edit `ImageIdentifier` in
`infra/aws/apprunner-web.json` to `:$TAG-web` and:

```bash
aws apprunner update-service --service-arn "$WEB_ARN" \
  --cli-input-json file://infra/aws/apprunner-web.json
```

(`update-service` rejects `ServiceName` alongside `--service-arn`? If it
complains about an unexpected `ServiceName` field, delete that one key from a
copy of the JSON for updates — [UNVERIFIED]; the console is the low-friction
fallback for a one-field change.)

Visit `$WEB_URL`. Course, `/simulator`, `/visualizations/*`, `/challenges`,
`/tutor` (offline tier) all work with nothing else configured.

### Environment variables — web (App Runner runtime)

These are **run-time**, server-side reads — set them on the service, change
them without rebuilding. Everything `NEXT_PUBLIC_*` is **build-time** and
goes through §3's `--build-arg` list instead; putting a `NEXT_PUBLIC_*` name
in `RuntimeEnvironmentVariables` does nothing at all, which is the single
most expensive misunderstanding available in this repository (`.env.example`,
top comment). Rows marked **secret** go in `RuntimeEnvironmentSecrets` as
SSM parameter ARNs (§4 pattern), never plain:

| Variable | What breaks when unset |
| --- | --- |
| `AGENT_SERVICE_URL` | Tutor skips the agent tier (the one that runs circuits to check itself); drops to direct model call, then offline set. |
| `ANTHROPIC_API_KEY` | Direct-model tutor tier off; offline answer set remains. **Secret.** |
| `QUANTUM_API_SECRET` | The Next server's hardware proxy sends no `X-Quantum-Lab-Secret`, so the secret-gated API (§5) 401s every hardware request. Must equal `API_SHARED_SECRET` — same SSM parameter, two mounts. **Secret.** |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes off: billing sync, org membership. Entitlements fall back to free. **Secret, always.** |
| `STRIPE_SECRET_KEY` | No checkout/portal; everyone is free-plan. **Secret.** |
| `STRIPE_WEBHOOK_SECRET` | Every webhook rejected — payments never become plans. **Secret.** |
| `STRIPE_PRICE_PRO_MONTHLY` / `_PRO_YEARLY` / `_TEAM_MONTHLY` / `_TEAM_YEARLY` | **With a secret key set but any price id missing, a paying customer resolves to free** (`docs/DEPLOYMENT.md` §9.2). The validators treat that combination as a hard failure. |
| `RESEND_API_KEY` | `sendEmail` returns `{sent:false}`; invites/certificates print to the server log instead of sending. **Secret.** |
| `EMAIL_FROM` | Resend sandbox sender — delivers only to your own address. |
| `EMAIL_DISPATCH_SECRET` | `POST /api/email/dispatch` refuses every caller (also needs Supabase + Resend to actually send). **Secret.** |
| `BILLING_RECONCILE_SECRET` | Operator path on `POST /api/billing/reconcile` closed; self-service reconcile still works. **Secret.** |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` (or `KV_REST_API_URL` + `_TOKEN`) | Rate limits count per-instance in memory. App Runner recycles and scales instances, so money-spending routes are effectively barely limited. At 50 users the Upstash free tier covers this — set it. Token is a **secret**. |
| `HEALTH_DEEP_TOKEN` | `/api/health?deep=1` open to anyone, bounded only by 6/min. **Secret.** |
| `ANALYTICS_SUPABASE_TABLE` | `/api/analytics` validates and stores nothing (says so in the response). |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Build-time concerns for source maps; only relevant if `NEXT_PUBLIC_SENTRY_DSN` was baked in at §3. |

External SaaS setup (Supabase schemas — **including the org-invite deletion
trap**, Stripe webhook endpoint at `https://<domain>/api/billing/webhook`,
Resend domain verification) is identical on every platform and is written up
once, in `docs/DEPLOYMENT.md` §§5–6. Do not skim §5.2 of that document before
re-running `schema-orgs.sql`.

---

## 8. Wire the three services together

The api and agent still allow only `http://localhost:3000` origins. Fix both
(no rebuild — these are run-time): edit `ALLOWED_ORIGINS` in
`infra/aws/apprunner-api.json` and `apprunner-agent.json` to `$WEB_URL`, then

```bash
aws apprunner update-service --service-arn "$API_ARN"   --cli-input-json file://infra/aws/apprunner-api.json
aws apprunner update-service --service-arn "$AGENT_ARN" --cli-input-json file://infra/aws/apprunner-agent.json
```

Each `update-service` triggers a rolling redeploy of that service. When you
attach a custom domain (§9), update these again to the real origin — and
rebuild/redeploy web with `NEXT_PUBLIC_APP_URL` set to it, because that one
is frozen at compile time. Comma-separate to allow both during a migration:
`"ALLOWED_ORIGINS": "https://quantumlab.example,https://<web>.awsapprunner.com"`.

---

## 9. Custom domain + HTTPS

[UNVERIFIED]. Only the **web** service needs a domain; browsers never talk
to the api or agent directly (the Next server proxies), so their
`…awsapprunner.com` URLs are fine forever.

App Runner manages the certificate itself (via ACM) once you prove DNS
control:

```bash
aws apprunner associate-custom-domain \
  --service-arn "$WEB_ARN" \
  --domain-name quantumlab.example \
  --enable-www-subdomain

# → the output (and describe-custom-domains) lists CertificateValidationRecords:
aws apprunner describe-custom-domains --service-arn "$WEB_ARN"
```

Add the printed records at your DNS host: the certificate-validation CNAMEs,
plus a CNAME from your (sub)domain to the service's `…awsapprunner.com`
hostname. An **apex** domain cannot carry a CNAME at most DNS hosts — use
Route 53 (ALIAS record to the App Runner domain) or a host with ANAME/CNAME
flattening. Certificate issuance follows within minutes-to-hours of DNS
propagating; `describe-custom-domains` shows the status walking to `active`.

Afterwards, per §8: rebuild web with
`NEXT_PUBLIC_APP_URL=https://quantumlab.example` (compile-time!), redeploy,
and point `ALLOWED_ORIGINS` on both Python services at the new origin. Then
re-run the §10 checks against the domain.

---

## 10. Verify the deployment

All three health endpoints exist in the code **[READ]**; the curls are
[UNVERIFIED] only in the sense that no live deployment has run them.

```bash
# Web — shallow: "process up and wired", NOT "dependencies answer".
curl -i "$WEB_URL/api/health"

# Web — deep: makes the real upstream probes (Supabase / api / agent).
# 200 = everything CONFIGURED answers; 503 = something configured is down.
# Rate-limited to 6/min; if HEALTH_DEEP_TOKEN is set, add it — note a wrong
# token silently returns the SHALLOW report rather than 401 (by design).
curl -i "$WEB_URL/api/health?deep=1&token=$HEALTH_DEEP_TOKEN"

# API — exempt from the shared-secret gate on purpose (EXEMPT_PATHS).
curl -i "$API_URL/api/health"

# API — everything else must 401/403 WITHOUT the secret. If this returns 200
# your secret is not set and the service is open. (Exact status [UNVERIFIED].)
curl -i -X POST "$API_URL/api/circuits/run" -H 'content-type: application/json' -d '{}'

# Agent — health reports configured true/false; an unconfigured agent is
# HEALTHY on purpose (offline tier is a working state).
curl -i "$AGENT_URL/api/agent/health"
```

Then the human checks, same as any platform (`docs/DEPLOYMENT.md` §7): a
lesson advances and survives reload, `/simulator` runs a circuit, `/tutor`
states which tier is live, view-source shows the canonical `<link>` is your
domain and not localhost (if it is localhost you skipped the
`NEXT_PUBLIC_APP_URL` rebuild), and — with hardware configured — the
hardware page reaches the API through the proxy without a 401 (if it 401s,
`QUANTUM_API_SECRET` ≠ `API_SHARED_SECRET`).

One difference from the Cloud Run kit worth naming: there are **no cold
starts from zero** here, because nothing ever scales to zero (§1). The flip
side is that the provisioned instance's memory bills continuously; first
requests after idle are fast, and you pay ~$26/month for that fastness
whether anyone shows up or not.

---

## 11. What ~50 users costs

**Estimates, not measurements** — pricing as published August 2026,
us-east-1, and nothing in this table has been observed on a real bill.
Assumptions: pre-launch, effectively zero real traffic, so this is the
deliberately minimal 1 GB / 1 GB / 1 GB sizing (§1, §5) — no headroom for
real concurrent load, resize once there are actual users. **The floor is
honest and unavoidable: App Runner cannot scale to zero, so ≈ $15/month of
provisioned-instance memory bills even at zero traffic.**

| Item | Est. / month | Why |
| --- | --- | --- |
| App Runner — web, provisioned (1 GB) | **$5.11** | 1 GB × $0.007/GB-hr × 730 h. Bills always. |
| App Runner — api, provisioned (1 GB) | **$5.11** | Same. `0.5 vCPU` only pairs with `1 GB` (§5) — smallest valid tier. |
| App Runner — agent, provisioned (1 GB) | **$5.11** | Same, smallest valid pairing for `0.25 vCPU`. |
| App Runner — active vCPU, all three | **$1–6** | $0.064/vCPU-hr only while serving; with ~0 users, active hours should be near-zero — top of range assumes occasional smoke-testing/health-check load. |
| ECR storage | **~$0.50–1** | ~5 GB of images at $0.10/GB-mo (the two Python images carry qiskit/aer/pennylane). Delete old tags. |
| SSM Parameter Store | **$0** | Standard-tier parameters are free (Secrets Manager would be $0.40/secret/mo). |
| Data transfer out | **$0–1** | Near-zero real traffic; AWS's first 100 GB/mo out is free regardless. |
| **AWS subtotal** | **≈ $17–28** | ≈ $15 of that is the no-scale-to-zero floor. |
| Supabase | $0 | Free tier covers pre-launch usage. |
| Upstash Redis | $0 | Free tier covers rate-limit counters at this volume. |
| Resend | $0 | Free tier 3k emails/mo. |
| Stripe | 2.9% + $0.30/txn | Per transaction, not monthly; irrelevant with no real customers yet. |
| Anthropic API | $0–5 | Cheapest-first gateway routes to Gemini/Groq first (docs/LLM-GATEWAY.md); Anthropic is the fallback, not the default. |
| Quantum hardware (IBM/Braket/Azure) | $0 unless used | Real-hardware runs bill per task/shot on the vendor. `API_SHARED_SECRET` + the api's `max-size 1` cap the blast radius. |

Realistic total: **≈ $17–33/month on AWS + SaaS** while there are no real
users — about $11/month less than the safer 2 GB/2 GB/1 GB sizing's ≈ $26
floor, in exchange for zero burst headroom (§5's `[UNVERIFIED]` OOM flag
applies). Once there's real signup/usage traffic, re-run the sizing
decision: bump `apprunner-{web,api}.json` back to `1 vCPU`/`2 GB` and
`--max-size` above 1 in `deploy.sh` before it matters. If the fleet will
sit dark for weeks,
`aws apprunner pause-service --service-arn …` is the manual lever (§1).
Set a **billing alarm** before the first deploy: CloudWatch → Billing →
alarm at e.g. $50/month (or an AWS Budgets budget with an email action).

---

## 12. Exactly what was never tested

Repeated from §0 because it matters more than anything else here: **the
authoring sandbox had no aws CLI, no Docker daemon, no AWS account, and no
network path to AWS.** Therefore, all [UNVERIFIED]:

- Every `aws` invocation, flag, IAM trust policy and role binding in this
  document.
- The three `infra/aws/*.json` files end to end — they parse **[RUN]** and
  their shapes match the current `create-service` reference, but no
  `create-service` has ever consumed them; whether `update-service` accepts
  the same file unmodified is explicitly flagged in §7.
- All three `docker build`s (true of every path in this repo, not just AWS —
  `docs/DEPLOYMENT.md` §10) and every `docker push` to ECR.
- Custom domain association, certificate issuance, the fixed 120 s request
  timeout as a number, pause-service billing behaviour, and every figure in
  the cost table.

If you are the first person to run this for real, correct this document with
what actually happened — starting with whichever step failed first.
