# Deploying Quantum Lab to Google Cloud (Cloud Run)

A paste-along: three Cloud Run services, one Artifact Registry repository, one
`cloudbuild.yaml`. Written for someone who has a Google account, a credit card,
and this repository, and has read nothing else. Where this document and
`docs/DEPLOYMENT.md` overlap (env vars, Supabase, Stripe), that document is the
deeper reference; this one is the GCP-shaped path through it.

---

## 0. What is verified and what is not — read this first

**Every `gcloud` command in this document is [UNVERIFIED].** It was written in
a sandbox with no `gcloud` binary, no Docker daemon, and no Google Cloud
project — not one of these commands has ever been executed. The same markers as
`docs/DEPLOYMENT.md` apply:

| Marker | Means |
| --- | --- |
| **[RUN]** | Executed in the authoring container against this exact tree. |
| **[READ]** | Verified by reading code or a pinned dependency's source. Not executed. |
| **[UNVERIFIED]** | Neither. Written from provider documentation and reasoning. Your first run is the test. |

What *is* more than guesswork:

- **[READ]** The three Dockerfiles referenced by `cloudbuild.yaml` exist
  (`apps/web/Dockerfile`, `services/api/Dockerfile`,
  `services/agent/Dockerfile`), every path each one `COPY`s exists in its
  build context, and the context/`-f` pairing matches `docker-compose.yml`.
- **[READ]** All three containers honour Cloud Run's injected `$PORT`: the web
  standalone server reads `process.env.PORT`, and both Python `CMD`s use
  `${PORT:-…}`. No `--port` flag is needed anywhere below.
- **[READ]** The health endpoints named in §9 exist:
  `apps/web/app/api/health/route.ts` (with the `?deep=1` opt-in),
  `/api/health` in `services/api` (exempt from the shared-secret gate in
  `app/core/security.py`), `/api/agent/health` in `services/agent`.
- **[READ]** `NEXT_PRIVATE_STANDALONE`, which the web Dockerfile relies on,
  still exists in the pinned Next **16.3.2** (now `^16.4.0`, upgraded 2026-10-09 for
  the image-optimiser and `next/og` RCE advisories — re-check the line number):
  `node_modules/next/dist/server/config-shared.js` line 142. (The Dockerfile's
  own comment cites Next 14.2.35 / line 88 — stale version, same mechanism.)
- **[RUN]** `cloudbuild.yaml` parses as YAML; the `npm ci` layout the web image
  depends on was reproduced by hand (see `docs/DEPLOYMENT.md` §10).

**No `docker build` of any of these images has ever succeeded anywhere** — not
here, not in CI, not locally. If Cloud Build fails at a `COPY` or during
`next build`, suspect the image, not your GCP setup, and read the FALLBACK
comment at the bottom of `apps/web/Dockerfile`.

**What stays outside GCP, on purpose.** Supabase (accounts/data), Upstash
(shared rate-limit store), Stripe (billing) and Resend (email) are external
SaaS. The code speaks their APIs directly — do **not** try to substitute
Cloud SQL for Supabase or Memorystore for Upstash; `lib/rateLimit.ts` speaks
the Upstash *REST* dialect, not the Redis wire protocol, and the Supabase
client is not a generic Postgres client. (`REDIS_URL` on `services/api` *is*
real Redis — Memorystore would work there, but needs a VPC connector; skip it
at this scale.)

**All of it is optional.** As in every other deployment path of this repo, an
empty environment boots and works — course, simulator, visualizations,
offline tutor. Each variable in §§4–6 only unlocks an extra.

---

## 1. Project setup

[UNVERIFIED] throughout. Pick a region once and stay in it; `us-central1` is
the default baked into `cloudbuild.yaml` (override with `_REGION`).

```bash
# Install the CLI: https://cloud.google.com/sdk/docs/install  — then:
gcloud auth login

# A fresh project. Project ids are globally unique; suffix yours.
export PROJECT_ID=quantum-lab-yourname
export REGION=us-central1
gcloud projects create "$PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# Billing must be linked or every later command fails with a billing error.
gcloud billing accounts list
gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX

# The four APIs this document uses.
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

---

## 2. Artifact Registry

One Docker repository holds all three images.

```bash
gcloud artifacts repositories create quantum-lab \
  --repository-format=docker \
  --location="$REGION" \
  --description="Quantum Lab images (web, api, agent)"
```

Image names from here on:

```
$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/web:<tag>
$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/api:<tag>
$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/agent:<tag>
```

---

## 3. Build the images

**Order matters, and it is backwards from what you would guess.** The web
image freezes `NEXT_PUBLIC_API_URL` (and every other `NEXT_PUBLIC_*`) into its
compiled output at build time — see "BUILD TIME vs RUN TIME" in `.env.example`.
The API and agent URLs do not exist until those services are deployed. So:

1. Build all three once with no substitutions (the web image gets empty
   `NEXT_PUBLIC_*` values — a valid, extras-off configuration).
2. Deploy api and agent (§4, §5) and note their URLs.
3. **Rebuild the web image** with the real URLs and deploy it (§6).

The api and agent images never need the rebuild; only web does.

### 3.1 With Cloud Build (recommended)

`cloudbuild.yaml` at the repo root builds all three in parallel and pushes
them. From the repo root:

```bash
# Pass 1 — everything, no config:
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_TAG=$(git rev-parse --short HEAD)

# Pass 2 — web only... except cloudbuild.yaml builds all three; the api and
# agent steps are cheap cache hits the second time. Run after §4–§5:
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_TAG=$(git rev-parse --short HEAD)-web,\
_NEXT_PUBLIC_APP_URL=https://<your-web-url>,\
_NEXT_PUBLIC_API_URL=https://<your-api-url>,\
_NEXT_PUBLIC_SUPABASE_URL=<blank or your supabase url>,\
_NEXT_PUBLIC_SUPABASE_ANON_KEY=<blank or anon key>,\
_NEXT_PUBLIC_SENTRY_DSN=<blank or dsn>
```

[UNVERIFIED] — and one honest caveat about "cheap cache hits": Cloud Build
workers start cold, so without a configured cache the api/agent steps *rebuild*
rather than hit cache on pass 2. It costs build minutes, not correctness. If
that bothers you, comment the api/agent steps out of a local copy for pass 2.

Notes that will save you a support search:

- The upload is filtered by the committed `.gcloudignore` (which includes
  `.gitignore`), **not** by any `.dockerignore`. The `.dockerignore` files are
  applied afterwards, per build context, by the docker steps themselves.
- These `_NEXT_PUBLIC_*` values are compile-time-inlined and served to every
  browser. They are not secrets and must never become secrets — the Supabase
  *anon* key belongs here; the service-role key never does.
- `--substitutions` is one comma-separated argument; the backslash-newline
  form above keeps it readable.

### 3.2 Or: local docker build + push

If you have Docker locally, the same three builds by hand:

```bash
gcloud auth configure-docker "$REGION-docker.pkg.dev"

export AR="$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab"
export TAG=$(git rev-parse --short HEAD)

# Web: context is the REPO ROOT (npm workspace, root lockfile) — see the
# header of apps/web/Dockerfile. Add --build-arg NEXT_PUBLIC_* on pass 2.
docker build -f apps/web/Dockerfile -t "$AR/web:$TAG" .

# Python services: context is the service directory.
docker build -t "$AR/api:$TAG"   services/api
docker build -t "$AR/agent:$TAG" services/agent

docker push "$AR/web:$TAG" && docker push "$AR/api:$TAG" && docker push "$AR/agent:$TAG"
```

If you are on Apple Silicon add `--platform linux/amd64`: Cloud Run runs
amd64, and the Python images fall back to compiling qiskit from source on an
arm64 build (that is what the `build-essential` layer in their Dockerfiles is
for — it works, slowly).

---

## 4. Deploy `services/api`

**Read the warning box at the top of `services/api/Dockerfile` first.** This
service executes user-supplied circuits and can spend real IBM/Braket money,
and it is unauthenticated unless `API_SHARED_SECRET` is set. A Cloud Run URL
with `--allow-unauthenticated` is the public internet. On this platform the
web app must be able to reach the API over HTTPS without Google IAM tokens
(the code does not mint them), so the deployment below is public **and the
shared secret is treated as mandatory, not optional**.

```bash
# One secret, generated once, shared by the api (as its gate) and the web
# service (as the credential its proxy presents). Store it in Secret Manager.
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create quantum-api-secret --data-file=-

# Cloud Run's runtime service account must be allowed to read it.
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding quantum-api-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

gcloud run deploy quantum-lab-api \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/api:$TAG" \
  --region="$REGION" \
  --allow-unauthenticated \
  --cpu=2 --memory=2Gi \
  --min-instances=0 --max-instances=2 \
  --concurrency=8 \
  --timeout=300 \
  --cpu-boost \
  --set-secrets=API_SHARED_SECRET=quantum-api-secret:latest \
  --set-env-vars=ALLOWED_ORIGINS=http://localhost:3000
```

`ALLOWED_ORIGINS` is a placeholder until the web URL exists; §7 fixes it.
Flag rationale, all [UNVERIFIED] as numbers, [READ] as constraints:

- `--cpu=2 --memory=2Gi` — Aer simulation is CPU-bound and qiskit+aer+
  pennylane are heavy imports; this is the sizing already used elsewhere in
  this repo's planning.
- `--min-instances=0` — scale to zero; at ~50 users you are paying for
  requests, not idle. The price is a cold start measured in seconds (the
  Docker `HEALTHCHECK` uses a 40s start period for the same import cost —
  Cloud Run ignores Docker `HEALTHCHECK`s entirely, but the physics is the
  same). `--cpu-boost` shortens it.
- `--concurrency=8` — a circuit run saturates a core; the default 80
  concurrent requests on 2 vCPUs would queue behind each other inside one
  instance instead of scaling out.
- `--max-instances=2` — a cost ceiling, not a performance target. This
  service can spend vendor credits; cap it.
- No `--port`: Cloud Run injects `PORT=8080` and the image's `CMD` honours
  `${PORT:-8000}`. **[READ]**

Get the URL (also printed by the deploy):

```bash
export API_URL=$(gcloud run services describe quantum-lab-api --region="$REGION" --format='value(status.url)')
curl "$API_URL/api/health"       # 200 — exempt from the secret gate on purpose
```

### Environment variables — `services/api`

All optional. Set with `--set-env-vars` / `--set-secrets` (secrets → Secret
Manager, never plain env vars). From `.env.example` and
`docs/DEPLOYMENT.md` §4.3:

| Variable | What breaks when unset |
| --- | --- |
| `ALLOWED_ORIGINS` | Browser CORS calls from your real domain are blocked (looks like a network error, not config). `*` is refused — the service will not start. |
| `API_SHARED_SECRET` | The service is completely unauthenticated: anyone with the URL runs circuits and can spend your IBM/Braket credits. Set it (above). |
| `DEFAULT_BACKEND` | Defaults to `aer_simulator` (fine). An unknown id refuses to start. |
| `IBM_QUANTUM_TOKEN` | IBM backends report unavailable. (Also needs `qiskit-ibm-runtime` in the image — not in `requirements.txt` today.) |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_DEFAULT_REGION` | Braket reports unavailable. Key id without secret refuses to start. |
| `BRAKET_S3_BUCKET` / `BRAKET_S3_PREFIX` | Non-local Braket submissions cannot run. |
| `AZURE_QUANTUM_RESOURCE_ID` / `AZURE_QUANTUM_LOCATION` | Azure targets report unavailable. |
| `REDIS_URL` | Job store is in-process: jobs lost on restart, invisible across instances. **With `--max-instances=2` a job poll can hit an instance that never heard of the job** — either set `--max-instances=1` or provide Redis. Cheapest fix at this scale: `--max-instances=1`. |

---

## 5. Deploy `services/agent`

```bash
# Your Anthropic key, into Secret Manager (skip both secret lines for the
# offline tutor — the service boots and reports configured:false).
printf '%s' 'sk-ant-...' | gcloud secrets create anthropic-api-key --data-file=-
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

gcloud run deploy quantum-lab-agent \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/agent:$TAG" \
  --region="$REGION" \
  --allow-unauthenticated \
  --cpu=1 --memory=1Gi \
  --min-instances=0 --max-instances=2 \
  --concurrency=8 \
  --timeout=120 \
  --cpu-boost \
  --set-secrets=ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --set-env-vars=ALLOWED_ORIGINS=http://localhost:3000

export AGENT_URL=$(gcloud run services describe quantum-lab-agent --region="$REGION" --format='value(status.url)')
curl "$AGENT_URL/api/agent/health"
```

- `--timeout=120` — the agent's own budget is `MAX_AGENT_SECONDS=60`
  (`agent/config.py`); 120 leaves headroom rather than having Cloud Run kill a
  request the agent was about to finish.

**Deliberately NOT set: `QUANTUM_API_URL`.** [READ] The agent sends **no**
`X-Quantum-Lab-Secret` header (no code in `services/agent/agent/` reads either
secret name), so pointing it at the now-secret-gated API of §4 gets it a 401
on every circuit tool call — after which it falls back to a local Aer run
inside its own process anyway. Leaving `QUANTUM_API_URL` unset goes straight
to that fallback: answers identical, one failed round trip saved. If the
agent ever learns to present the secret, set
`QUANTUM_API_URL=$API_URL` and revisit this paragraph.

### Environment variables — `services/agent`

| Variable | What breaks when unset |
| --- | --- |
| `ANTHROPIC_API_KEY` | Tutor is offline-tier: `configured: false`, chat returns setup instructions. Everything else works. |
| `MODEL` | Defaults to the id in `agent/config.py`. |
| `ALLOWED_ORIGINS` | Browser calls blocked by CORS; `*` refuses to start. (Only matters if a browser ever calls the agent directly — the app goes through the Next server.) |
| `QUANTUM_API_URL` | Circuit tool runs locally in-process (see above — on this platform that is the *correct* setting today). |
| `QUANTUM_LAB_RAG_INDEX` | Uses the committed `data/course_index.json` (the image copies it). Warns at boot if missing. |
| `MAX_TOOL_ROUNDS`, `MAX_AGENT_SECONDS`, `MAX_HISTORY_TURNS`, `MAX_MESSAGE_CHARS`, `MAX_SHOTS` | Sane defaults from `agent/config.py`; non-positive values refuse to start. |

---

## 6. Build and deploy the web app

Now that `$API_URL` and the web URL can be known, the two-pass dance from §3.
One wrinkle: the web app's own URL is also a build arg
(`NEXT_PUBLIC_APP_URL`), and it does not exist until the first web deploy. Two
options:

- Deploy web once with empty args, read its `…run.app` URL, rebuild with real
  args, redeploy. (What this doc assumes.)
- Or, if you already know your custom domain (§8), bake that domain in
  directly and skip a pass.

```bash
# First web deploy — image from pass 1 (empty NEXT_PUBLIC_*), just to get a URL:
gcloud run deploy quantum-lab-web \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/web:$TAG" \
  --region="$REGION" \
  --allow-unauthenticated \
  --cpu=1 --memory=1Gi \
  --min-instances=0 --max-instances=3 \
  --cpu-boost \
  --set-secrets=QUANTUM_API_SECRET=quantum-api-secret:latest \
  --set-env-vars=AGENT_SERVICE_URL=$AGENT_URL

export WEB_URL=$(gcloud run services describe quantum-lab-web --region="$REGION" --format='value(status.url)')

# Rebuild with the real URLs frozen in (pass 2 of §3.1), then:
gcloud run deploy quantum-lab-web \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/quantum-lab/web:$TAG-web" \
  --region="$REGION"
# (a redeploy keeps the env vars and secrets already set on the service)
```

Visit `$WEB_URL`. Course, `/simulator`, `/visualizations/*`, `/challenges`,
`/tutor` (offline tier) all work with nothing else configured.

### Environment variables — web (Cloud Run runtime)

These are **run-time**, server-side reads — set them on the service, change
them without rebuilding. Everything `NEXT_PUBLIC_*` is **build-time** and goes
through §3's substitutions instead; setting a `NEXT_PUBLIC_*` name here does
nothing at all, which is the single most expensive misunderstanding available
in this repository (`.env.example`, top comment).

| Variable | What breaks when unset |
| --- | --- |
| `AGENT_SERVICE_URL` | Tutor skips the agent tier (the one that runs circuits to check itself); drops to direct model call, then offline set. |
| `ANTHROPIC_API_KEY` | Direct-model tutor tier off; offline answer set remains. |
| `QUANTUM_API_SECRET` | The Next server's hardware proxy sends no `X-Quantum-Lab-Secret`, so a secret-gated API (§4) 401s every hardware request. Must equal `API_SHARED_SECRET` — same Secret Manager secret, two mounts. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes off: billing sync, org membership. Entitlements fall back to free. **Secret Manager, always.** |
| `STRIPE_SECRET_KEY` | No checkout/portal; everyone is free-plan. |
| `STRIPE_WEBHOOK_SECRET` | Every webhook rejected — payments never become plans. |
| `STRIPE_PRICE_PRO_MONTHLY` / `_PRO_YEARLY` / `_TEAM_MONTHLY` / `_TEAM_YEARLY` | **With a secret key set but any price id missing, a paying customer resolves to free** (`docs/DEPLOYMENT.md` §9.2). The validators treat that combination as a hard failure. |
| `RESEND_API_KEY` | `sendEmail` returns `{sent:false}`; invites/certificates print to the server log instead of sending. |
| `EMAIL_FROM` | Resend sandbox sender — delivers only to your own address. |
| `EMAIL_DISPATCH_SECRET` | `POST /api/email/dispatch` refuses every caller (also needs Supabase + Resend to actually send). |
| `BILLING_RECONCILE_SECRET` | Operator path on `POST /api/billing/reconcile` closed; self-service reconcile still works. |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` (or `KV_REST_API_URL` + `_TOKEN`) | Rate limits count per-instance in memory. Cloud Run with `min-instances=0` recycles instances, so money-spending routes are effectively barely limited. At 50 users the Upstash free tier covers this — set it. |
| `HEALTH_DEEP_TOKEN` | `/api/health?deep=1` open to anyone, bounded only by 6/min. |
| `ANALYTICS_SUPABASE_TABLE` | `/api/analytics` validates and stores nothing (says so in the response). |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Build-time concerns for source maps; only relevant if `NEXT_PUBLIC_SENTRY_DSN` was baked in at §3. |

External SaaS setup (Supabase schemas — **including the org-invite deletion
trap**, Stripe webhook endpoint at `https://<domain>/api/billing/webhook`,
Resend domain verification) is identical on every platform and is written up
once, in `docs/DEPLOYMENT.md` §§5–6. Do not skim §5.2 of that document before
re-running `schema-orgs.sql`.

---

## 7. Wire the three services together

The api and agent still allow only `http://localhost:3000` origins. Fix both
(no rebuild — these are run-time):

```bash
gcloud run services update quantum-lab-api   --region="$REGION" \
  --update-env-vars=ALLOWED_ORIGINS=$WEB_URL
gcloud run services update quantum-lab-agent --region="$REGION" \
  --update-env-vars=ALLOWED_ORIGINS=$WEB_URL
```

When you attach a custom domain (§8), update these again to the real origin —
and rebuild/redeploy web with `NEXT_PUBLIC_APP_URL` set to it, because that
one is frozen at compile time.

Comma-separate to allow both during a migration:
`ALLOWED_ORIGINS=https://quantumlab.example,$WEB_URL`.

---

## 8. Custom domain + HTTPS

[UNVERIFIED]. Only the **web** service needs a domain; browsers never talk to
the api or agent directly (the Next server proxies), so their `…run.app` URLs
are fine forever.

The low-effort path is Cloud Run **domain mapping**: Google provisions and
renews the certificate; HTTPS is automatic and HTTP redirects.

```bash
gcloud domains verify quantumlab.example        # one-time ownership proof
gcloud beta run domain-mappings create \
  --service=quantum-lab-web --domain=quantumlab.example --region="$REGION"
gcloud beta run domain-mappings describe \
  --domain=quantumlab.example --region="$REGION"   # → the DNS records to add
```

Add the printed A/AAAA (apex) or CNAME (subdomain) records at your DNS host;
certificate issuance follows within minutes-to-hours of DNS propagating. Two
caveats worth knowing before you rely on it: domain mappings are a
long-standing *preview* feature and are only offered in certain regions
(`us-central1` is one); Google's own docs steer latency-sensitive production
toward a global external Application Load Balancer with a serverless NEG
instead — more moving parts and a ~$18/month ALB charge, unnecessary at this
scale.

Afterwards, per §7: rebuild web with `NEXT_PUBLIC_APP_URL=https://quantumlab.example`
(compile-time!), redeploy, and point `ALLOWED_ORIGINS` on both Python services
at the new origin. Then re-run the §9 checks against the domain.

---

## 9. Verify the deployment

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
`NEXT_PUBLIC_APP_URL` rebuild), and — with hardware configured — the hardware
page reaches the API through the proxy without a 401 (if it 401s,
`QUANTUM_API_SECRET` ≠ `API_SHARED_SECRET`).

Cold starts: with `min-instances=0` the first request after idle pays the
boot. The Python services import qiskit/aer/pennylane — expect seconds, which
is why their Docker `HEALTHCHECK`s use a 40s grace. A monitor that alerts on
p99 latency will "discover" this nightly; that is scale-to-zero working, not
an outage.

---

## 10. What ~50 users costs

**Estimates, not measurements** — pricing as published August 2026,
us-central1, and nothing in this table has been observed on a real bill.
Assumptions: ~50 active learners, ~200k web requests/month, a few thousand
simulator/tutor calls, `min-instances=0` everywhere.

| Item | Est. / month | Why |
| --- | --- | --- |
| Cloud Run — web (1cpu/1Gi) | **$0–5** | Request-billed at min 0; much of this fits the free tier (180k vCPU-s, 2M requests/mo). |
| Cloud Run — api (2cpu/2Gi) | **$0–8** | Same billing; 2 vCPU burns the free tier twice as fast, but only while simulating. |
| Cloud Run — agent (1cpu/1Gi) | **$0–4** | Only busy during tutor conversations. |
| Artifact Registry | **~$1** | ~4–6 GB of images (the two Python images carry qiskit/aer/pennylane); $0.10/GB after 0.5 GB free. Delete old tags. |
| Cloud Build | **$2–8** | E2_HIGHCPU_8 is paid (~$0.016/build-min); ~10 builds × ~20 min. Drop `machineType` to use free-tier minutes, slower. |
| Network egress | **$0–3** | Static assets dominate; browsers cache them. |
| **GCP subtotal** | **≈ $5–25** | Scale-to-zero is doing the work here. |
| Supabase | $0–25 | Free tier likely suffices at 50 users; Pro $25 removes the pause-on-idle behaviour. |
| Upstash Redis | $0 | Free tier covers rate-limit counters at this volume. |
| Resend | $0 | Free tier 3k emails/mo. |
| Stripe | 2.9% + $0.30/txn | Per transaction, not monthly. |
| Anthropic API | $5–50 | The real variable: tutor usage. The `MAX_*` clamps in `agent/config.py` are your budget control. |
| Quantum hardware (IBM/Braket/Azure) | $0 unless used | Real-hardware runs bill per task/shot on the vendor. `API_SHARED_SECRET` + `--max-instances` cap the blast radius. |

Realistic total: **$10–50/month on GCP + SaaS**, dominated by Anthropic usage
and whether Supabase is on a paid tier. Set a GCP **budget alert** before the
first deploy: Billing → Budgets & alerts → e.g. $50/month.

---

## 11. Exactly what was never tested

Repeated from §0 because it matters more than anything else here: **the
authoring sandbox had no gcloud, no Docker daemon, no GCP project, and no
network path to Google.** Therefore, all [UNVERIFIED]:

- Every `gcloud` invocation, flag and IAM binding in this document.
- `cloudbuild.yaml` end to end — it parses **[RUN]**, its Dockerfile paths and
  contexts are correct **[READ]**, but no Cloud Build has ever executed it.
- All three `docker build`s (true of every path in this repo, not just GCP —
  `docs/DEPLOYMENT.md` §10).
- The claim that Cloud Run's injected `PORT` reaches each process is **[READ]**
  from the CMDs/server code, not observed under Cloud Run.
- Domain mapping, certificate issuance, and every number in the cost table.

If you are the first person to run this for real, correct this document with
what actually happened — starting with whichever step failed first.
