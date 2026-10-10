# Deploying Quantum Lab

Written for someone who has never seen this repository, on a machine that is not
the one it was built on. Follow it top to bottom and you get a running
deployment. Nothing here assumes you have read the source.

---

## 0. Two things to know before you start

**This app has no required environment variables.** Not "sensible defaults" —
genuinely none. The lesson track, the circuit simulator, the eight
visualizations, the challenges, the exams and the tutor's offline answer set are
self-contained client and server TypeScript with no external dependency. Deploy
with a completely empty environment, hand the URL to a student, and everything
they can see works. Variables only switch on *extras*: live Claude answers, real
quantum hardware, accounts, billing, email, error reporting. A missing key
degrades a feature on purpose; it does not throw.

If a change to this deployment ever makes an empty environment fail to boot, the
change is wrong.

**What is verified, and what is not.** This document distinguishes them
throughout, because a deployment guide that overstates its own testing is worse
than one that admits a gap.

| Marker | Means |
| --- | --- |
| **[RUN]** | Executed, in the authoring container, against this exact tree. |
| **[READ]** | Verified by reading the code or a pinned dependency's source. Not executed. |
| **[UNVERIFIED]** | Neither. Written from documentation and reasoning. Treat your first run as the test. |

The Azure path is **[RUN]**: all three images are built from these Dockerfiles
by Azure Container Registry and run on Container Apps behind qubit16.ai, and
GitHub Actions runs CI on every push and the Azure CD workflow on `main`. The
Docker Compose, Vercel/Railway, AWS and GCP paths remain **[UNVERIFIED]** by
execution. Section 10 lists exactly what was run.

---

## 1. Choose a path

| | Path A — managed | Path B — one box |
| --- | --- | --- |
| Web app | Vercel | Docker Compose |
| Python services | Railway | Docker Compose |
| Time to first deploy | ~5 minutes | ~10 minutes plus image builds |
| You operate | nothing | the box, TLS, restarts, backups |
| Verified here | build commands **[RUN]** | Dockerfiles **[READ]** |

Path A is the shortest route to a URL. Path B is the shortest route to a stack
you fully control. They are not exclusive — many people run the web app on
Vercel and the two Python services on their own box.

Since this section was written, the owner has picked a third target: **AWS**,
via ECR + App Runner, and that is now the chosen production path.
`docs/DEPLOYMENT-AWS.md` is the paste-along for it — same env vars, same
external SaaS (Supabase/Upstash/Stripe/Resend stay outside the cloud
provider), same [RUN]/[READ]/[UNVERIFIED] honesty markers as this document,
plus the committed service definitions under `infra/aws/`. The earlier GCP
kit (`docs/DEPLOYMENT-GCP.md` + `cloudbuild.yaml`) remains in the tree as a
working alternative, and Paths A and B below stay valid for anyone not
deploying to a big-cloud account at all.

---

## 2. Path A — Vercel (web) + Railway (Python services)

### 2.1 Push to GitHub

```bash
git remote add origin <your repo>
git push -u origin main
```

`scripts/push-to-github.sh` wraps this. Note that the remote committed in this
repository points at someone else's account and has never accepted a push from
the build container; use your own.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: preflight,
typecheck, unit tests, build, Playwright, and both Python test suites. Let it go
green before you deploy. **[RUN]** on GitHub Actions on every push.

### 2.2 The web app on Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. **Set the root directory to the repository root — NOT `apps/web`.** This is
   the only setting that matters and the only one people get wrong. `apps/web`
   is an npm workspace; the single `package-lock.json` lives at the repository
   root, and an install run from `apps/web` cannot see it. **[RUN]**: running
   `npm ci` with only the root `package.json`, the root lockfile and
   `apps/web/package.json` installs 484 packages, all hoisted to the root — that
   is the layout the build expects.
3. `vercel.json` at the root already sets the commands:

   ```json
   "installCommand": "npm ci",
   "buildCommand":   "npm run build --workspace=web",
   "outputDirectory": "apps/web/.next"
   ```

4. **Set no environment variables.** Skip the whole screen.
5. Deploy.

Visit it. The course, `/simulator`, `/visualizations/*`, `/challenges`,
`/certify` and `/tutor` (offline tier) all work. Nothing is a stub.

**Then set one variable and redeploy:**

```
NEXT_PUBLIC_APP_URL=https://your-domain.example
```

It is inlined at build time, so setting it in the dashboard changes nothing
until a new build runs. §9 explains what breaks if you skip it.

Before you deploy, change the `/docs` redirect in `vercel.json` — it points at
`https://github.com/punith-naga/quantum-lab/tree/main/docs`, which is not your
repository.

### 2.3 services/api on Railway

The web app does not need this. It executes circuits on server-side simulators
and real hardware.

1. Railway → New Project → Deploy from GitHub repo → this repository.
2. Service settings → **Root Directory: `services/api`**.
3. Railway reads `services/api/railway.json`: builder `DOCKERFILE`, start
   command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, healthcheck path
   `/api/health`, restart `ON_FAILURE`.
4. Variables, all optional: `ALLOWED_ORIGINS` (set it — see below),
   `IBM_QUANTUM_TOKEN`, `DEFAULT_BACKEND`, `AWS_*`, `API_SHARED_SECRET`.
5. Generate a public domain and note the URL.

`$PORT` is injected by Railway and must be honoured; a service hardcoded to 8000
fails its healthcheck and restarts forever. `railway.json`'s start command does
this, which is why it overrides the Dockerfile's `CMD` — that `CMD` exists for
Compose, where the port is fixed.

> **Consequence of that override, worth knowing:** the Dockerfile's `CMD` runs
> `python -m app.core.env_check` before uvicorn. Railway's start command does
> not. The check still runs, because `app/main.py` calls it at import — but on
> Railway a fatal misconfiguration surfaces as a failed import in the deploy log
> rather than as a clean pre-start message.

**This service is unauthenticated by default.** It runs user-supplied circuits
and can spend IBM/Braket credits with no credential. A Railway public domain is
the public internet. Either leave it private and reach it only from your own
network, or set `API_SHARED_SECRET` and read
`docs/SECURITY.md` § "Exposing services/api safely" first — the hardware page
reaches this service through the Next server's proxy
(`apps/web/lib/hardware/proxy.ts`), which presents `QUANTUM_API_SECRET`, so the
two values must match.

### 2.4 services/agent on Railway

Identical, with **Root Directory: `services/agent`**, start command
`uvicorn agent.server:app --host 0.0.0.0 --port $PORT`, healthcheck
`/api/agent/health`, and variables `ANTHROPIC_API_KEY`, `ALLOWED_ORIGINS`, and
`QUANTUM_API_URL` pointing at the API service's URL.

### 2.5 Wire them back to the web app

In Vercel → Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL = https://your-api.up.railway.app
AGENT_SERVICE_URL   = https://your-agent.up.railway.app
```

Then **redeploy**. `NEXT_PUBLIC_API_URL` is inlined at build time (the `env`
block in `apps/web/next.config.mjs`), so a dashboard edit alone does nothing.
**[RUN]** confirmation that this is real, not folklore: the committed build
output contains the literal `http://localhost:8000` inside
`.next/server/app/hardware/page.js` and `.next/server/middleware.js`.

On the API and agent services set:

```
ALLOWED_ORIGINS = https://your-domain.example
```

or the browser blocks every call. Verify:

```bash
curl https://your-api.up.railway.app/api/health
curl https://your-agent.up.railway.app/api/agent/health
```

---

## 3. Path B — one box, Docker Compose

```bash
cp .env.example .env      # an untouched copy is a valid configuration
docker compose up --build
```

- web → http://localhost:3000
- api → http://127.0.0.1:8000
- agent → http://127.0.0.1:8001
- redis → only with `docker compose --profile queue up` (§3.4)

**[UNVERIFIED] by execution** as a Compose stack: the images it builds are the
same Dockerfiles Azure builds successfully, but `docker compose up` itself has
not been run. What *has* been checked, by reading: every Dockerfile referenced by `docker-compose.yml` exists;
every path each one `COPY`s exists in its build context; and the one line that
provably broke the web build has been removed (§3.1).

### 3.1 The web image

Built from **the repository root** with `dockerfile: apps/web/Dockerfile`, not
from `apps/web`. That is deliberate: `apps/web` is an npm workspace, the only
lockfile is at the root, and `npm ci` refuses to run without it. By hand:

```bash
docker build -f apps/web/Dockerfile -t quantum-lab-web .
docker run --rm -p 3000:3000 quantum-lab-web        # no env needed
```

Three stages — deps → builder → runner. The runner is `node:20-alpine`, runs as
the non-root `nextjs:nodejs` user, exposes 3000, `HEALTHCHECK`s by fetching `/`
with the Node runtime already in the image, and serves Next's standalone output.

**A bug that was in this file until now, in case you hit a cached variant of
it.** The builder stage copied `apps/web/node_modules` out of the deps stage.
That directory does not exist: with this lockfile npm hoists everything to the
root and never creates it, so the build failed at that line with
`COPY failed: ... file does not exist`. **[RUN]**: reproduced by running the deps
stage's exact install (root `package.json` + root `package-lock.json` +
`apps/web/package.json`, then `npm ci`) in an empty directory — 484 packages,
all at the root, no `apps/web/node_modules`. The line is gone.

**Standalone output.** `apps/web/next.config.mjs` does not set
`output: 'standalone'`; it is deliberately left unset so a local `next build`
keeps its conventional output, and the builder
sets `NEXT_PRIVATE_STANDALONE=true` instead. **[READ]**: Next 16 still reads that
flag in `node_modules/next/dist/server/config-shared.js`
(`output: !!process.env.NEXT_PRIVATE_STANDALONE ? "standalone" : undefined`; the
line number moves between releases), and a user config that leaves `output`
undefined does not override it.
**[RUN]**: the emitted tree
(`standalone/apps/web/server.js` beside a hoisted `standalone/node_modules`) is
what the production image built in Azure Container Registry runs. It is a
private flag; if a future Next renames it, the build
fails loudly at the `COPY .../standalone` line and the fallback runner written
out at the bottom of `apps/web/Dockerfile` is the fix.

**Build args, not environment variables.** Every `NEXT_PUBLIC_*` value is frozen
into the compiled output, so `docker-compose.yml` passes them under `build.args`.
Setting them under `environment:` looks right and does nothing — which is what
this file used to do with `NEXT_PUBLIC_API_URL`. Change one and you must rebuild:
`docker compose up --build`.

### 3.2 The Python images

Both were single-stage, root-running, healthcheck-less images. Both are now
builder + runtime, install into a `/opt/venv` the runtime stage copies, drop
`pytest` from the runtime install, run as the non-root `quantum` user, and
define a `HEALTHCHECK` against their real health endpoint with a 40-second start
period (importing qiskit, aer and pennylane takes seconds, and a shorter grace
window restarts a service that is still starting, forever).

`/api/health` is exempt from the shared-secret gate on purpose
(`EXEMPT_PATHS` in `services/api/app/core/security.py`) — a liveness probe cannot
be handed a secret, and a service that fails its probe is a service that is down.

**Two fixes worth naming:**

- `services/agent/Dockerfile` never copied `data/`, which holds
  `course_index.json` — the TF-IDF index the RAG layer retrieves from. Retrieval
  **fails open**: the tutor still answers, just without the course under it, and
  nothing in the response or the health endpoint says so. It is copied now, and
  `agent/env_check.py` warns at boot if it is missing. **[RUN]**: with
  `QUANTUM_LAB_RAG_INDEX` pointed at a nonexistent path, the service logs
  `env: The course RAG index is missing at …` and starts.
- Neither service directory had a `.dockerignore`, and the root one does not
  apply to them (Docker reads `<context>/.dockerignore`, and these build with
  `context: ./services/api` and `./services/agent`). Their build contexts
  therefore included the host-built `.venv` — hundreds of megabytes of
  wrong-architecture files uploaded to the daemon on every build. Both now have
  one. `data/` is deliberately *not* excluded from the agent's; see above.

### 3.3 Ports are bound to 127.0.0.1

`docker-compose.yml` publishes the API and agent on `127.0.0.1:8000` and
`127.0.0.1:8001`, not on all interfaces. The web container reaches them over the
Compose network and does not need the published port at all; the binding exists
so you can `curl` them. On a machine reachable from outside, delete those `ports`
blocks entirely, or set `API_SHARED_SECRET`.

### 3.4 Redis is optional and off

Redis is in the `queue` profile, so plain `docker compose up` skips it. Bring it
up with `docker compose --profile queue up` and set `REDIS_URL=redis://redis:6379`.

Without it, `services/api/app/jobs/store.py` uses a bounded in-process dict: jobs
are lost on restart and invisible to other replicas, so with more than one
replica a poll can hit an instance that has never heard of the job. With one
replica on one box that is fine, which is why it is off by default.

---

## 4. Environment variables

`.env.example` is the authoritative list and is derived by grepping the source
for `process.env.` and `os.environ`, not copied from prose. The same list exists
in machine-readable form in three places:

| Runtime | Module | Runs |
| --- | --- | --- |
| Next app | `apps/web/lib/env.ts` | from `instrumentation.ts` — **but see the gap below** |
| `services/api` | `app/core/env_check.py` | at import of `app.main`, and as `python -m app.core.env_check` |
| `services/agent` | `agent/env_check.py` | at import of `agent.server`, and as `python -m agent.env_check` |

Each one fails loudly on an error and warns on everything else. `QUANTUM_LAB_SKIP_ENV_CHECK=1`
downgrades errors to warnings in all three — for an incident where the validator
is what is keeping you from booting, not as a setting.

> **Closed.** On Next 14 the validator in `instrumentation.ts` only ran when
> `experimental.instrumentationHook` was set, which happened only with a Sentry
> DSN. Next 16 loads `instrumentation.ts` unconditionally (the flag was removed),
> so `assertEnv()` runs on every boot, with or without a DSN.
> Until then, run `node scripts/preflight.mjs` before every deploy — it covers
> the same ground with no build and no dependencies. **[RUN]**: exits 0 on this
> tree. Note that preflight's own table predates this audit and does not yet
> list `QUANTUM_API_SECRET`, `API_SHARED_SECRET`, `ANALYTICS_SUPABASE_TABLE`,
> `AZURE_*`, `BRAKET_S3_*`, `REDIS_URL` or `QUANTUM_LAB_RAG_INDEX`;
> `.env.example` does.

### 4.1 Required

None. See §0.

### 4.2 Optional — the web app

`[BUILD]` means the value is inlined by the compiler and frozen at `next build`.
Changing it anywhere else has no effect until you rebuild.

| Variable | | What it unlocks | What happens without it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | [BUILD] | Canonical URLs, sitemap, OG images, Stripe return URLs | Everything points at `http://localhost:3000` — see §9 |
| `NEXT_PUBLIC_API_URL` | [BUILD] | Points the server-side hardware proxy at `services/api` | Defaults to `localhost:8000`; the hardware page shows setup guidance |
| `AGENT_SERVICE_URL` | | Routes `/api/agent` to the agent service (the tier that runs circuits to check itself) | Tutor drops to a direct model call, then to the offline set |
| `ANTHROPIC_API_KEY` | | Live Claude answers | Offline answer set; `/tutor` says which tier is live |
| `NEXT_PUBLIC_SUPABASE_URL` | [BUILD] | Accounts, cloud sync, orgs | localStorage only, and it works |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | [BUILD] | Client-side Supabase access | As above |
| `SUPABASE_SERVICE_ROLE_KEY` | | Server-side writes: billing sync, org membership | Entitlements fall back to free |
| `STRIPE_SECRET_KEY` | | Checkout, portal, plan gating | Everyone is on free and all free content works |
| `STRIPE_WEBHOOK_SECRET` | | Webhook signature verification | Every webhook rejected; payments never become plans |
| `STRIPE_PRICE_PRO_MONTHLY` / `_PRO_YEARLY` / `_TEAM_MONTHLY` / `_TEAM_YEARLY` | | Map price ids to plans | A paying customer resolves to free — see §9 |
| `RESEND_API_KEY` | | Real outbound email | `sendEmail` returns `{sent:false}` and prints the message to the console in dev |
| `EMAIL_FROM` | | From-address on your verified domain | Resend's sandbox sender, which only reaches your own address |
| `NEXT_PUBLIC_SENTRY_DSN` | [BUILD] | All error tracking, one switch | No Sentry code is bundled at all; faster builds |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | [BUILD] | Source-map upload | Stack traces stay minified |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT` | [BUILD] | Ships the analytics buffer to a collector | Analytics stay in the browser |
| `ANALYTICS_SUPABASE_TABLE` | | Server-side analytics ingestion | `/api/analytics` validates, stores nothing, says so |
| `QUANTUM_API_SECRET` (or `API_SHARED_SECRET`) | | Sends `X-Quantum-Lab-Secret` upstream to `services/api` | No header sent — correct as long as the API has no secret set |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN`, or `KV_REST_API_URL` + `_TOKEN` | | A **shared** rate-limit store for every route that spends money (`lib/rateLimit.ts`) | An in-process counter, not shared between instances, reset by every cold start — on a serverless platform that approaches no limit |
| `HEALTH_DEEP_TOKEN` | | Requires a token for `/api/health?deep=1` | Deep probes are open to anyone, bounded only by a 6/min limit |
| `BILLING_RECONCILE_SECRET` | | The operator path on `POST /api/billing/reconcile` (`x-reconcile-secret`) | That path is closed |
| `NEXT_PUBLIC_SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | [BUILD] | The release tag and environment on browser events | Browser events fall back to `unknown` and to `NODE_ENV` — see `docs/OPERATIONS.md` |
| `GOOGLE_SITE_VERIFICATION` | [BUILD] | The `google-site-verification` meta tag — Search Console ownership proof, a prerequisite for coverage data and manual indexing requests on a new domain | No tag rendered; verify ownership via DNS TXT or file upload instead |
| `BING_SITE_VERIFICATION` | [BUILD] | The `msvalidate.01` meta tag — same proof for Bing Webmaster Tools (also feeds Yahoo and, via IndexNow, DuckDuckGo) | No tag rendered |

**The five rows above `NEXT_PUBLIC_SENTRY_RELEASE`, plus `BRAKET_S3_BUCKET`/`_PREFIX`, are read by
shipped code and are absent from `.env.example`.** That file describes itself as the authoritative
list, derived by grepping the source; verified against this tree, it is not. Treat this table and
`docs/OPERATIONS.md` as the current list until it is regenerated.

### 4.3 Optional — the Python services

| Variable | Service | What it unlocks | Without it |
| --- | --- | --- | --- |
| `ALLOWED_ORIGINS` | both | CORS origins. **`*` is refused and the service will not start** | Only `http://localhost:3000`, so a deployed app is blocked by the browser |
| `API_SHARED_SECRET` | api | Requires `X-Quantum-Lab-Secret` on everything but `/api/health` | The service is completely unauthenticated |
| `DEFAULT_BACKEND` | api | Backend for a run that names none | `aer_simulator`. An unknown id now refuses to start |
| `IBM_QUANTUM_TOKEN` | api | `ibm_quantum` backend (+ `pip install qiskit-ibm-runtime`) | IBM backends report unavailable |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` | api | Braket (+ `pip install amazon-braket-sdk`) | Braket reports unavailable. A key id with no secret refuses to start |
| `BRAKET_S3_BUCKET` / `BRAKET_S3_PREFIX` | api | Result destination for non-local Braket | Those submissions cannot run |
| `AZURE_QUANTUM_RESOURCE_ID` / `AZURE_QUANTUM_LOCATION` | api | Azure Quantum targets | Azure targets report unavailable |
| `REDIS_URL` | api | Shared job store | In-process dict — see §3.4 |
| `ANTHROPIC_API_KEY` / `MODEL` | agent | Live tutor | `configured: false`; chat returns setup instructions |
| `QUANTUM_API_URL` | agent | Where the circuit tool sends work | Falls back to a local Aer run inside the agent process |
| `QUANTUM_LAB_RAG_INDEX` | agent | Override the course index path | Uses the committed artifact; warns if it is missing |
| `MAX_TOOL_ROUNDS`, `MAX_AGENT_SECONDS`, `MAX_HISTORY_TURNS`, `MAX_MESSAGE_CHARS`, `MAX_SHOTS` | agent | Prompt-injection clamps | Defaults in `agent/config.py`. Non-positive values refuse to start |

---

## 5. Supabase — and what the schema files are actually worth

Skip this entirely if you do not want accounts. Without Supabase, progress and
saved circuits live in the browser and every feature that uses them works.

Setup is in `supabase/README.md`: create a project, take the URL and the anon key
from Project Settings → API, run the SQL, set the two `NEXT_PUBLIC_SUPABASE_*`
variables, and **rebuild** (they are `[BUILD]` variables).

Run the files in this order — later ones reuse the `set_updated_at()` helper the
first one defines:

1. `supabase/schema.sql` — saved circuits.
2. `supabase/schema-billing.sql` — subscriptions, hardware usage, the Stripe event ledger, and the
   `reserve_hardware_job()` / `apply_stripe_subscription()` functions.
3. `supabase/schema-exams.sql` — server-graded exam attempts and issued certificates. **This file
   was added after the rest of this section was written**; without it the exam routes have no store
   and refuse rather than accepting an ungradeable attempt.
4. `supabase/schema-orgs.sql` — orgs, seats, invites, classroom assignments, progress consent and
   shared progress. **Read §5.2 first.**

### 5.1 The row-level security policies are unverified against a live project

Say this out loud before you enable accounts: **none of the four schema files
has ever been run against a real Supabase project.** The RLS policies in them are
written and reviewed but not executed, and the `anon` key is public by design —
RLS is the only thing between a browser and every row in the database. The
control that is actually load-bearing today is the application-layer check in
`apps/web/lib/orgs/access.ts`.

So: run the files on a **throwaway project first** and test them as an ordinary
signed-in user with the anon key, not as the service role. Item 1 of the
pre-production checklist in `docs/SECURITY.md` is the test. At minimum, with a
second account's session, confirm that:

- selecting another user's `circuits` row returns nothing,
- `update subscriptions set plan_id='pro'` is refused — no user write policy
  exists on that table, and its absence is the entire billing security model,
- inserting yourself into another org's `org_members` is refused.

Until you have done that, treat "Supabase configured" as "the app-layer check is
what protects this data".

### 5.2 `schema-orgs.sql` DELETES unclaimed invites, on purpose

Lines 115-152 of that file are a migration block that runs only when the old
`org_invites.token` column exists — that is, on a project created before invite
tokens were hashed. When it runs it executes:

```sql
delete from public.org_invites where accepted_at is null;
```

**Every unclaimed invitation is destroyed, deliberately.** The old scheme stored
raw, forgeable tokens; hashing them would preserve keys an attacker can compute,
so they are dropped rather than migrated. Accepted rows survive with a
`retired-<id>` placeholder hash that can never match a lookup.

Before you re-run that file on a project that has ever sent an invite:

1. Export the pending invitations you will need to re-send:

   ```sql
   select o.name, i.email, i.role, i.expires_at
     from public.org_invites i
     join public.orgs o on o.id = i.org_id
    where i.accepted_at is null;
   ```

2. Run the schema file.
3. Re-send every invitation from the admin console. Old links are dead and will
   stay dead — that is the fix working.

On a fresh project the block does not run at all: there is no `token` column, so
there is nothing to migrate and nothing to delete.

---

## 6. Stripe webhooks

Only if you are charging money.

1. Deploy first — you need your real domain.
2. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
3. Endpoint URL, exactly this path:

   ```
   https://<your-domain>/api/billing/webhook
   ```

4. Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`.
5. Create it. Stripe shows a **Signing secret** starting `whsec_…`.

   **This is where people get stuck: `STRIPE_WEBHOOK_SECRET` is that `whsec_…`
   value, produced by creating this endpoint. It is not on the API keys page**,
   which has only `pk_…` and `sk_…`. Paste an `sk_…` and every webhook fails
   signature verification, Stripe retries and gives up, customers pay and get
   nothing, and no log line looks like an outage.
6. Set in your host and redeploy:

   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_PRO_MONTHLY=price_...
   STRIPE_PRICE_PRO_YEARLY=price_...
   STRIPE_PRICE_TEAM_MONTHLY=price_...
   STRIPE_PRICE_TEAM_YEARLY=price_...
   ```

7. Send a test event from the dashboard and confirm a `200`.

Test mode and live mode have entirely separate keys, price ids and webhook
secrets. Mixing them is the second most common failure here.

---

## 7. First-deploy checklist

```
[ ] node scripts/preflight.mjs              → no FAIL lines
[ ] Pushed to GitHub; all five CI checks green
[ ] Vercel root directory = repository root (NOT apps/web)
[ ] First deploy done with ZERO env vars, and the site works
[ ] A lesson advances and progress survives a reload
[ ] /simulator runs a circuit and shows results
[ ] All eight listed /visualizations render (shor, surface-code and vqe are unlisted
                and linked from nowhere — check them by URL if you care)
[ ] /tutor answers from the offline set and says which tier is live
[ ] /docs redirect in vercel.json points at YOUR repository
[ ] NEXT_PUBLIC_APP_URL set to the real domain, then REDEPLOYED
[ ] View source on the home page: canonical <link> is your domain, not localhost
[ ] (optional) Railway api deployed, /api/health returns 200
[ ] (optional) Railway agent deployed, /api/agent/health returns 200
[ ] (optional) NEXT_PUBLIC_API_URL + AGENT_SERVICE_URL set, then REDEPLOYED
[ ] (optional) ALLOWED_ORIGINS set on BOTH Python services to the web origin
[ ] (optional) services/api is NOT reachable from the internet, or has API_SHARED_SECRET
[ ] (optional) Supabase schema run on a THROWAWAY project and RLS tested as a
                signed-in user (§5.1) before touching the real one
[ ] (optional) Pending invites exported before re-running schema-orgs.sql (§5.2)
[ ] (optional) Stripe: all four price ids set alongside the secret key, same mode
[ ] (optional) Stripe test webhook returns 200
[ ] Hard-reload once and confirm the service worker updated (§9.3)
```

---

## 8. Rollback

**Vercel.** Deployments → last known-good build → **Promote to Production**.
Instantaneous; the old output is still stored. Do this first, diagnose after.

**Railway.** Service → Deployments → previous successful deploy → **Redeploy**.

**Docker Compose.** Tag images per build and keep the previous tag, or
`git checkout <last-good-sha> && docker compose up --build`.

Two things a rollback does not undo:

- **Stripe webhook events already processed.** Plan state lives in Stripe and
  Supabase, not in the deployment. Reconcile in the Stripe dashboard.
- **Service worker caches already in browsers.** A rolled-back deploy serves
  older assets, but returning visitors may keep running the newer cached shell
  until it revalidates.

A schema migration does not roll back either — §5.2 in particular is a deletion.

`RUNBOOK.md` covers incident handling once the site is live; `docs/OPERATIONS.md`
covers the day-to-day.

---

## 9. What breaks silently if you skip it

No error, no 500, no alert. Worth memorising.

**9.1 `NEXT_PUBLIC_APP_URL` unset → everything points at localhost.** Canonical
tags, the sitemap and OG image URLs all derive from it, so search engines index
localhost and every social preview is blank. Stripe checkout success and cancel
URLs come from the same value: a customer completes a real payment and is
redirected to `http://localhost:3000/…`, which on their machine is nothing. It is
a `[BUILD]` variable — set it and **rebuild**.

**9.2 `STRIPE_SECRET_KEY` set with any price id missing → paying customers get
downgraded.** Plan resolution matches the price id on the subscription against
the four `STRIPE_PRICE_*` names. An unset one matches nothing, so the webhook
falls through to free — for someone who has just been charged — and existing
subscribers are downgraded on their next renewal webhook. Stripe reports success
and so do your logs; the only signal is support email. `scripts/preflight.mjs`
and `apps/web/lib/env.ts` both treat this exact combination as a hard failure.

**9.3 Forgetting the service worker cache version → returning visitors see the
old app.** `apps/web/public/sw.js` names its cache from `CACHE_VERSION` and
deletes any cache whose name does not match on activate. Hashed
`/_next/static/*` URLs change every build and are handled; the precached app
shell is not. Bump `CACHE_VERSION` when you change the shell, the offline
fallback or the precache list. First-time visitors see the new build and cannot
reproduce the bug, which makes this expensive to diagnose.

**9.4 Agent image without `data/` → the tutor stops using the course.** Fixed in
the Dockerfile and warned about at boot, but if you build a variant image, copy
`data/`. Retrieval fails open and nothing in any response says so.

**9.5 `ALLOWED_ORIGINS` unset on a deployed Python service → every browser call
is blocked by CORS,** and it looks like a network error rather than a
configuration one. Both services warn at startup when it is left at the
localhost default.

---

## 10. Exactly what was verified, and how

Run in the authoring container against this tree:

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| Unit tests | `cd apps/web && npx vitest run` | 860 passed, 43 files (was 199 when this section was written) |
| API tests | `cd services/api && .venv/bin/python -m pytest -q` | 172 passed (was 129 before the queue-semantics, noise-model and QASM3 tests landed; 59 before that) |
| Agent tests | `cd services/agent && .venv/bin/python -m pytest -q` | 82 passed, same (was 81) |
| API validator, empty env | `python -m app.core.env_check` | exits 0, warns about `ALLOWED_ORIGINS` |
| API validator, bad backend | `DEFAULT_BACKEND=nope python -m app.core.env_check` | exits 1 and names the valid ids |
| API validator, wildcard CORS | `ALLOWED_ORIGINS='*' python -c 'import app.main'` | refuses to import |
| Agent validator, empty env | `python -m agent.env_check` | exits 0, warns about the missing key |
| Agent validator, clamp at 0 | `MAX_TOOL_ROUNDS=0 python -c 'import agent.server'` | refuses to import |
| Agent validator, no index | `QUANTUM_LAB_RAG_INDEX=/tmp/nope.json python -m agent.env_check` | warns, starts |
| The `npm ci` layout the web image depends on | `npm ci` in an empty dir with the three manifests | 484 packages, all hoisted; no `apps/web/node_modules` |
| Preflight | `node scripts/preflight.mjs` | exits 0, 20 pass / 0 warn / 0 fail |
| `NEXT_PUBLIC_*` inlining | grep of the committed `.next` output | `http://localhost:8000` found baked into two server files |
| Workflow + Compose syntax | parsed as YAML | both valid |

Not run, and therefore not claimed:

- **No `docker compose up`.** The images are built by `az acr build` in Azure
  (the web image also by the CD workflow); the Compose stack itself has not been
  started.
- **`next build`, the Playwright suite and GitHub Actions all run** on every push
  (`.github/workflows/ci.yml`), and the web image is built end-to-end in Azure.
  `STATUS.md` carries the current test counts; read them there, not here.
- **The Supabase project exists** (production accounts run on it). **No Stripe
  account in production yet, no Railway project, no Vercel project.** §§2, 5 and
  6 are written from the code and the providers' documentation.

If you are the first person to run any of the above for real, correct this
section with what actually happened. A guide that quietly keeps claiming
something it has never done is how a deployment doc rots.
