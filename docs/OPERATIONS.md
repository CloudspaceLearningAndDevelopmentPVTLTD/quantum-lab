# Operations

How you find out that Quantum Lab is broken: error tracking, error boundaries,
the API error shape, health endpoints, email delivery and analytics ingestion.

**Error tracking, email and analytics ingestion are off by default.** With an
empty environment the app builds, runs and behaves exactly as it does with
everything configured, minus the sending. That is the intended state for local
development: no warnings, no errors, no slowdown, no accounts to create. Nothing
in this stack throws at import time and nothing in it can fail a request.

**Error boundaries, the API error shape and the health endpoints are always on**
and need no configuration — they are behaviour, not integrations.

---

## Environment variables

| Variable | Unlocks | Default when unset |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | All error tracking: `Sentry.init` on client and server, the `withSentryConfig` build wrapper, the `instrumentation.ts` hook. | No Sentry code runs at all. `reportError` logs to the console in development and does nothing in production. |
| `SENTRY_ORG` | Names the Sentry organisation for the build plugin. | Ignored (plugin not loaded). |
| `SENTRY_PROJECT` | Names the Sentry project for the build plugin. | Ignored. |
| `SENTRY_AUTH_TOKEN` | Source-map upload during `next build`, so stack traces are readable. | No upload is attempted. Traces stay minified. |
| `NEXT_PUBLIC_SENTRY_RELEASE` | The release tag on every event, client and server. **Set this if you set `SENTRY_AUTH_TOKEN`** — source maps are stored under a release name, and an event with no release matches no map. | Falls back to `VERCEL_GIT_COMMIT_SHA`, then `GITHUB_SHA`, then the literal `unknown`. Both fallbacks are server-only: Next inlines only `NEXT_PUBLIC_*` into the browser bundle, so browser events — the ones with minified frames — get `unknown` unless this is set. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | The environment Sentry groups and filters by. | Falls back to `VERCEL_ENV`, then `NODE_ENV`. `VERCEL_ENV` is what separates preview from production; `NODE_ENV` is `production` in both, and an alert firing on a preview deploy at 2am is how people learn to ignore alerts. |
| `RESEND_API_KEY` | Real outbound email through Resend. | `sendEmail` returns `{ sent: false, reason }` and prints the full message to the console in development. |
| `EMAIL_FROM` | The From address, e.g. `Quantum Lab <hello@yourdomain.com>`. Requires a verified domain in Resend. | `Quantum Lab <onboarding@resend.dev>` — Resend's sandbox sender, which needs no domain verification. |
| `ANALYTICS_SUPABASE_TABLE` | Server-side analytics ingestion into that table. Requires Supabase to also be configured. | `/api/analytics` accepts and validates batches, stores nothing, and says so. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` + `KV_REST_API_TOKEN` | A **shared** store for `lib/rateLimit.ts`, which guards every route that spends money. Vercel KV is Upstash underneath, so one code path serves both pairs. | An in-process counter that is not shared between instances and resets on every cold start — on a serverless platform that approaches no limit at all. |
| `HEALTH_DEEP_TOKEN` | Requires a token for `/api/health?deep=1`. A wrong or missing token silently falls back to the shallow report rather than 401-ing. | Deep probes are open to anyone, bounded only by a 6/min per-caller limit. |
| `BILLING_RECONCILE_SECRET` | Lets an operator drive `POST /api/billing/reconcile` with an `x-reconcile-secret` header. | The operator path is closed; the route serves only its self-service mode. |

**These four are read by shipped code and are missing from `.env.example`**, along with
`BRAKET_S3_BUCKET` / `BRAKET_S3_PREFIX`. That file describes itself as the authoritative list
derived by grepping the source; today it is not, and it is not this document's file to fix.

`NEXT_PUBLIC_SENTRY_DSN` is the single switch for error tracking — the client
config, the server config, the **edge config**, the instrumentation hook and the
build wrapper all read the same variable, so there is no half-on state.

There are three Sentry configs, not two. `sentry.edge.config.ts` exists because
`withSentryConfig` looks for that filename when it instruments the build: a
project with only client and server configs leaves `middleware.ts` and any
`runtime = 'edge'` route completely uninstrumented. Its `tracesSampleRate` is
`0.02` against `0.1` on the other two, because middleware runs on **every**
request including static assets and would otherwise eat the transaction quota.

This table is the operations subset. The authoritative list of every variable
any runtime reads is `.env.example`, derived by grepping the source, with the
prose version in `docs/DEPLOYMENT.md` § 4.

---

## Startup validation

Three modules hold the same rules for three runtimes:

| Runtime | Module | Entry point |
| --- | --- | --- |
| Next app | `apps/web/lib/env.ts` | `assertEnv()` from `instrumentation.ts` |
| `services/api` | `app/core/env_check.py` | import of `app.main`, or `python -m app.core.env_check` |
| `services/agent` | `agent/env_check.py` | import of `agent.server`, or `python -m agent.env_check` |

They **fail** on a misconfiguration and **warn** on an unset optional variable.
Nothing fails on absence alone, because an entirely empty environment is a
supported configuration; what they refuse to start on is a combination that
cannot work and that would otherwise fail in silence:

- a Stripe secret key without all four `STRIPE_PRICE_*` ids, or without the
  webhook secret;
- one half of the Supabase pair;
- a secret behind a `NEXT_PUBLIC_` name (that publishes it to every visitor);
- `ALLOWED_ORIGINS` containing `*` on either Python service;
- `DEFAULT_BACKEND` naming a backend that does not exist;
- an AWS key id with no secret;
- an agent prompt-injection clamp set to zero or below.

The Python entry points are also CLIs, which is what CI and the container `CMD`s
use: `python -m app.core.env_check` prints its findings and exits non-zero on an
error. Both are run in CI against an empty environment, so the "deploys with no
configuration" property is tested rather than asserted.

`QUANTUM_LAB_SKIP_ENV_CHECK=1` downgrades every error to a warning in all three
runtimes. It exists for one situation: an incident where the validator is what
is keeping you from booting. It is not a setting — left on, the next silent
misconfiguration ships without a word.

**Known gap.** The Next-side check runs from `instrumentation.ts`, and Next 14
loads that file only when `experimental.instrumentationHook` is true, which
`next.config.mjs` sets only when a Sentry DSN is present. On a deployment
without Sentry, the runtime check does not run. `node scripts/preflight.mjs`
covers the same ground before a deploy, with no build and no dependencies.

---

## CI

`.github/workflows/ci.yml`, on every push and pull request. Five checks, each of
which fails the build:

```
Preflight — env + lockfile
Web — typecheck, lint, unit tests, service-worker invalidation, build, bundle budgets
Web — end-to-end (Playwright, chromium)
API service — pytest (Qiskit + Aer + PennyLane)   + env validation against an empty environment
Agent service — pytest (LangChain + RAG)          + env validation against an empty environment
```

Things to know when it goes red:

- **Preflight fails first and cheaply.** It runs on node builtins with no
  install, so a lockfile that has drifted from a workspace `package.json` is
  caught in seconds rather than after a five-minute install on the deploy
  runner.
- **Lint runs.** `apps/web/eslint.config.mjs` (flat config) extends
  `next/core-web-vitals` and the TypeScript preset; `react/no-danger` and a
  no-argument `toLocaleString()` are errors. The CI step runs it on every push.
- **Playwright's browser.** The dev container here pins one through
  `PW_CHROMIUM`; CI must not set that variable at all, because
  `playwright.config.ts` reads it as `process.env.PW_CHROMIUM ?? undefined` and
  `??` does not fall through an empty string — an empty value would be passed
  to Playwright as a literal path and every test would fail to launch. CI
  installs its own chromium with `npx playwright install --with-deps chromium`
  and caches `~/.cache/ms-playwright` on the lockfile hash.
- **The e2e job builds the app a second time**, because `playwright.config.ts`
  owns its `webServer` and runs `npm run build && npm run start` itself. About
  90 seconds, left in deliberately rather than reaching into a config another
  workstream owns.
- **`node_modules` is cached** on the lockfile hash and `npm ci` is skipped on a
  hit. `apps/web/node_modules` is not in the cache path: with this lockfile npm
  hoists everything to the root and never creates it.
- **The workflow runs on every push and pull request** on GitHub Actions, and
  `deploy.yml` (Azure, OIDC) and `pages.yml` (the docs site, to Cloudflare
  Pages) chain off it on `main`. The 2026-10-09 run added Node to the API job so the JS-vs-Qiskit
  cross-checks execute there instead of skipping.

---

## Container operations

Full deployment instructions are in `docs/DEPLOYMENT.md`. What matters once it
is running:

- **Every service has a real `HEALTHCHECK`.** Web fetches `/` with the Node
  runtime already in the image (a page render, not just a listening socket) —
  it should now fetch `/api/health` instead; see § Health endpoints.
  `services/api` fetches `/api/health`; `services/agent` fetches
  `/api/agent/health`, and both of those now probe their own dependencies rather
  than answering 200 unconditionally. Both Python probes use a 40-second start period —
  importing qiskit, aer and pennylane takes seconds, and a shorter grace window
  restarts a service that is still starting, forever.
- **`/api/health` is exempt from the shared-secret gate** on purpose: a liveness
  probe cannot be handed a secret, and a service that fails its probe is down.
- **`docker compose` waits for health**, not for container creation:
  `depends_on: condition: service_healthy`. The web app used to start while the
  API was still importing qiskit.
- **The Python ports bind to `127.0.0.1`.** `services/api` is unauthenticated
  unless `API_SHARED_SECRET` is set, and it executes user-supplied circuits and
  can spend hardware credits. On a machine reachable from outside, delete those
  `ports` blocks — the web container reaches them over the Compose network
  regardless.
- **Nothing runs as root**, and no runtime image carries pytest or a compiler.
- **Redis is in the `queue` profile and off by default.** Without it the job
  store is a bounded in-process dict: jobs are lost on restart and invisible to
  other replicas.
- **No image in this repository has ever been built.** There was no Docker
  daemon where these files were written. The first real build is the test.

---

## API error shape

Every non-2xx response from `apps/web/app/api/**` returns the same JSON:

```json
{ "error": "Too many checkout attempts. Wait a moment and try again.",
  "code": "rate_limited" }
```

`error` is a sentence written in this repository and safe to render verbatim.
`code` is stable across releases — **branch on the code, never on the sentence**.
Some routes add keys on top (`sent: false` on `/api/email`, `stored: false` on
`/api/analytics`, `seatsUsed`/`upgradeUrl` on a seat-limit 409); the two
canonical keys are always present.

The shape is flat rather than `{ error: { code, message } }` because eight call
sites in `components/` and `app/` already read `typeof body.error === 'string'`.
Nesting would have made all eight silently render nothing. `lib/apiError.ts`
says this in a comment; do not tidy it away without fixing those call sites.

### The codes

| Code | Status | Means |
| --- | --- | --- |
| `bad_request` | 400 | The body or query string did not validate. |
| `unauthorized` | 401 | No credential, or one that did not verify. |
| `forbidden` | 403 | Authenticated, but not allowed to do this to this resource. |
| `not_found` | 404 | Does not exist, or the caller may not know that it does. |
| `conflict` | 409 | Conflicts with current state — invite already used, no seats left, no Stripe customer yet. |
| `payload_too_large` | 413 | Body over the route's cap; refused before parsing. |
| `rate_limited` | 429 | Always accompanied by `Retry-After`. |
| `internal` | 500 | Ours, and unexplained. Detail is in the error tracker. |
| `upstream_error` | 502 | A dependency answered, with a failure we cannot act on. |
| `not_configured` | 503 | Needs an environment variable this deployment has not set. |
| `upstream_unavailable` | 504 | A dependency did not answer in time. |

The set is closed, like the analytics `EventName` union: a client can switch
exhaustively, and the whole vocabulary fits on one screen. Adding one means
editing `API_ERROR_STATUS` in `lib/apiError.ts` *and* this table.

### What is never sent

An exception's `.message`, a stack, a Stripe/Supabase/Anthropic error body, and
an upstream 500's text. Provider errors routinely embed record ids, key
prefixes, table names and SQL, and a learner-facing error box is the worst place
to publish them. `failure(code, err, context)` puts the detail in the error
tracker and returns only the code and a fixed sentence.

The one exception is deliberate and narrow: the seat-limit 409 in
`/api/orgs/members` forwards `err.message`, because `isSeatLimitError` narrows
to an error this codebase constructs whose message is written for the admin
reading it. No provider error reaches that branch.

### Three routes answer 200 on failure, on purpose

Each is a product decision, and each still **reports** the failure, so it is
visible in the error tracker even though it is invisible in the browser.

- **`/api/agent`** — the tutor's contract is "you always get a reply". A 500
  would replace the tutor's own honest degradation message with the browser's
  generic failure path.
- **`/api/billing/entitlement`** — falls back to the free tier. A paying user
  seeing an error box on every page load because Supabase blipped is worse than
  a plan badge that is briefly wrong; the entitlement is re-checked server-side
  by every route that actually grants a paid capability, so nothing is unlocked.
- **`/api/analytics`** — the client posts fire-and-forget from a
  `visibilitychange` handler and does not retry. A non-2xx would produce console
  noise in every visitor's browser and change nothing.

### Fixed in this pass

Three billing paths called `NextResponse.json({ error: … })` with **no status
argument**, which is an HTTP **200**. `PricingTable`'s and `/account`'s `res.ok`
checks passed, the browser fell through to reading `body.url` — `undefined` —
and did nothing visible. A Stripe failure and a Supabase failure both looked
like a click that did not register.

---

## Error boundaries

`app/global-error.tsx` is the last line of defence: it replaces the root layout
when *that* fails, so it renders its own `<html>`/`<body>` and inline styles.
Leave that shape alone — it cannot rely on `globals.css` having loaded.

Everything else uses `error.tsx` per route group, all rendering
`lib/observability/RouteError.tsx`. One shared component rather than twelve
near-copies, because the failure mode of near-copies is that eleven of them stop
reporting the day someone edits the twelfth.

| Route group | `error.tsx` | `not-found.tsx` | What its copy tells the learner |
| --- | --- | --- | --- |
| `/` (fallback) | yes | yes | Generic; every route without its own lands here. |
| `/simulator` | yes | — | Saved circuits are safe; a wide circuit can exhaust tab memory (2ⁿ statevector). |
| `/visualizations` | yes | — | Nothing was sent anywhere; a 3D view may have been refused a WebGL context. |
| `/tutor` | yes | — | **Not** a connection problem — the tutor answers offline, so a network fault would have shown an answer. |
| `/hardware` | yes | — | Submitted jobs are unaffected and no credit was spent. |
| `/certify` | yes | `[examId]` | The attempt is saved after every answer and the clock is not being consumed. |
| `/challenges` | yes | `[id]` | Progress and par scores are local and untouched. |
| `/learn` | yes | `[slug]` | Often the embedded experiment rather than the lesson text. |
| `/admin` | yes | — | Nothing was changed; a persistent failure is the operator's, not the user's. |
| `/account` | yes | — | The subscription is unchanged; a checkout that redirected here still went through. |
| `/insights` | yes | — | Nothing left the device; a corrupt local buffer is safe to delete from this page. |

Still on the generic fallback, and fine there: `/coach`, `/circuits`,
`/pricing`, `/instructor`, `/welcome`, `/offline`. None of them has a failure
mode where naming the feature would tell the learner anything they could act on.
Adding one is four lines — copy `app/simulator/error.tsx`.

**Neither shared component renders a `<main>`.** `app/layout.tsx` already
renders the single `main` landmark and a boundary renders inside it; a second
one is the `main > main` defect closed across 19 routes.

**Neither renders `error.message` or a stack.** A production build replaces
server-thrown messages with a generic string, but client-thrown ones survive and
can carry a URL, a field value, or a fragment of the learner's own circuit. The
`digest` — Next's own hash — is the only identifier shown, and it is what a
support conversation should start with.

`not-found.tsx` files are **not** client components and report nothing.
`notFound()` is a routing outcome, not a failure; sending 404s to the tracker
fills it with crawler traffic and buries the errors that matter. Every
`notFound()` in this app fires for one reason — a slug outside a small, local,
complete set — so each 404 names the set and links to the list.

---

## Health endpoints

One per service, and each reports what it can actually reach. **A health check
that cannot fail is decoration**: before this pass all three returned `ok`
unconditionally, which proved the process was listening — something the TCP
connect had already proven.

| Service | Path | Probes |
| --- | --- | --- |
| Next app | `GET /api/health` | Supabase (a head-count read), `services/api`, `services/agent`, Stripe (config only), Anthropic (config only) |
| `services/api` | `GET /api/health` | Executes a one-qubit circuit end to end; job store; hardware backends (config only) |
| `services/agent` | `GET /api/agent/health` | `services/api` reachability; the RAG index actually loaded; Anthropic (config only) |

### The four probe states

- **`ok`** — reachable and working.
- **`degraded`** — working, with a caveat. Stays **HTTP 200**. Paging on a
  caveat teaches people to ignore the page.
- **`failing`** — configured, and not working. Drives **HTTP 503**.
- **`skipped`** — not configured on this deployment. **Never** turns a service
  red. Quantum Lab is designed to run with an empty environment; if `skipped`
  counted as unhealthy, every local developer and every container's own
  `HEALTHCHECK` would sit permanently red, and a check that is always red is a
  check nobody reads.

**The status code is the contract, not the body.** Docker, Kubernetes and every
uptime monitor read the code; none of them parses JSON. A health endpoint that
returns 200 with `{"status":"failing"}` never fires an alert.

### What is deliberately not probed

Stripe and Anthropic are reported from **key presence only**, and each such
result carries `checked: false` so nobody mistakes "configured" for "reachable".
Neither vendor has a free liveness endpoint; a call on every probe at a
30-second interval is 2,880 requests a day per replica against a rate limit, and
against Anthropic it is billed. IBM and Braket are the same case in
`services/api`. If you need real vendor reachability, poll it on a schedule
measured in minutes and cache it — do not put it on the liveness path.

### Notable probe behaviours

- **`services/api` runs a real circuit.** Measured in this container: ~1350ms on
  the first call (cold import of the PennyLane/Aer stack), **~3ms warm**. The
  first number is why the container gets a 40-second `start_period`; the second
  is why a real circuit per probe is affordable at a 30-second interval. An Aer
  import that only breaks on first use, a broken OpenQASM 3 parser and a missing
  transpiler pass are all invisible to `import qiskit` and visible here.
- **`REDIS_URL` set but the in-memory job store live is `degraded`.** The
  service keeps working, jobs are silently lost on restart and invisible to
  other replicas, and nothing anywhere else says so.
- **A missing RAG index is `degraded` on `services/agent`.** `search_concepts`
  falls back, the tutor keeps answering, and the answers quietly stop being
  grounded in the course.
- **An unreachable `services/api` is `degraded` on `services/agent`, not
  failing.** The tutor is impaired — it can no longer run circuits to check its
  own answers — but it still answers.
- **Supabase configured with only the anon key is `degraded`.** RLS would deny
  the probe read, and a denial is indistinguishable from an outage at that
  layer, so reporting `ok` would be a lie.

### The Next app's probes are opt-in, and that changed after this section was first written

`/api/health` on the Next app used to run the live Supabase HEAD count and both upstream fetches on
**every** request, unauthenticated and unlimited. That is a free amplifier: one cheap request from
anywhere on the internet became three expensive ones against our own dependencies. Two things
changed, and any monitor configured before them is now measuring the wrong thing:

- **Deep is opt-in.** `?deep=1` (or `deep=true`) runs the real probes. Without it the response is a
  cheap "the process is up and wired" report. **Do not alert on a shallow `ok`** — it does not mean
  the dependencies answer.
- **Deep can require a token.** With `HEALTH_DEEP_TOKEN` set, deep additionally needs it in an
  `x-health-token` header or a `token=` query parameter (so a monitor that can only be handed a URL
  still works). A wrong or missing token **silently falls back to the shallow report** rather than
  401-ing, so the endpoint never becomes an oracle for whether a token is configured. With no token
  configured, deep is open to anyone — bounded by the limiter and nothing else. Setting it is
  recommended; see `docs/SECURITY.md`, finding HEALTH-1.
- **Two rate-limit buckets**, so exhausting the deep allowance cannot stop the orchestrator's cheap
  probe from answering: shallow 60/min per caller (a 30s `HEALTHCHECK` needs 2), deep 6/min.

Point the orchestrator at `/api/health` and the uptime monitor at `/api/health?deep=1&token=…`.

The two Python services have no equivalent split: their probes are always live, and `services/api`
runs a real one-qubit circuit on every call (~3ms warm).

### Checking them

```bash
curl -s localhost:3000/api/health | jq                 # cheap: process is up and wired
curl -s 'localhost:3000/api/health?deep=1' | jq        # the real probes; 200, or 503 if something
                                                       # configured is down
curl -s 'localhost:3000/api/health?deep=1&verbose=0'   # statuses only, for a monitor
curl -s localhost:8000/api/health | jq
curl -s localhost:8001/api/agent/health | jq
```

No probe mutates anything, no probe costs money, and no response body carries an
environment-variable value, an internal hostname or port, an upstream response
body, or an exception message — these endpoints are unauthenticated and
reachable by anyone who can reach the app. Every `detail` string is written by
hand and reviewed as public copy.

**Not done, and it belongs to whoever owns the Dockerfiles:**
`apps/web/Dockerfile`'s `HEALTHCHECK` still fetches `/`, which renders the home
page and proves nothing about Supabase or the Python services. It should fetch
`/api/health` now that one exists. The two Python Dockerfiles already point at
the right paths and pick up the new behaviour with no change.

---

## Verifying each locally

### Error tracking

With no DSN (the default):

```bash
npm run build        # succeeds, no Sentry output, no source-map upload
```

With a DSN, and with readable stack traces:

```bash
export NEXT_PUBLIC_SENTRY_DSN='https://…@…ingest.sentry.io/…'
export SENTRY_ORG=… SENTRY_PROJECT=… SENTRY_AUTH_TOKEN=…
# The same value must reach the runtime AND the source-map upload, or the maps
# are stored under a release name no event carries.
export NEXT_PUBLIC_SENTRY_RELEASE=$(git rev-parse HEAD)
npm run build
npx next start
```

Then trigger a client error and confirm it appears in Sentry within a minute,
**with a readable stack** — a minified frame like `t.default @ 4821-9c1.js:1:20461`
means the release tag and the uploaded maps do not agree.
`app/global-error.tsx` reports through `reportError` and shows the Next.js
`digest` in monospace — that id is what a user quotes and what you search for.

To check scrubbing without a Sentry account, call `reportError` in development
with a context object containing an `email` key: the console line shows the key
was dropped.

### Email

```bash
npx next build && npx next start -p 3000
curl -s localhost:3000/api/email \
  -H 'content-type: application/json' \
  -d '{"type":"invite","to":"someone@example.com",
       "data":{"orgName":"Acme","inviterEmail":"admin@acme.test",
               "role":"member","acceptUrl":"http://localhost:3000/admin?invite=abc",
               "expiresInDays":14}}'
```

Unconfigured, that returns `200` with
`{"sent":false,"reason":"Email is not configured; …"}`. Run the same request
under `npm run dev` and the whole plain-text message — including the accept URL,
which you can click — is printed to the server console. That is the point: the
invite flow is end-to-end testable with no provider account.

With `RESEND_API_KEY` set the same call returns `{"sent":true,"id":"…"}`.

### Analytics ingestion

```bash
curl -s localhost:3000/api/analytics   # → { "configured": false, "mode": "local-first", … }
```

Set `ANALYTICS_SUPABASE_TABLE` (and the Supabase variables) and POST a batch;
the response becomes `{ "stored": true, "count": n }`. The table needs columns
`name text`, `at timestamptz`, `props jsonb`, `session_id text`.

---

## Privacy decisions

These are choices, not oversights. Changing one is a product decision.

- **No session replay.** `replaysSessionSampleRate` and
  `replaysOnErrorSampleRate` are both `0`. Replay films the user's screen, and
  filming a learner's session to debug it contradicts a stated local-first
  privacy position in the most direct way available.
- **No PII in error reports.** `sendDefaultPii: false` on both runtimes.
  `reportError` scrubs its context through a key filter (`email`, `name`,
  `token`, `key`, `secret`, `password`, `phone`, `address` — substring,
  case-insensitive) and truncates strings to 200 characters *before* attaching
  them. Non-scalar values are dropped entirely.
- **Only an opaque id identifies a user.** `setUserContext(id)` attaches an
  account id and nothing else — never an email or a username. An id is enough to
  group one user's errors; an email adds nothing operationally and turns every
  report into a personal-data record.
- **Query strings are stripped** from every reported URL. A shared circuit
  travels as a query parameter, so a raw URL would ship a user's own work to a
  third party. Paths only.
- **The analytics opt-out is honoured by error tracking too.** If
  `localStorage['quantum-lab.analytics-optout']` is `'true'`, `beforeSend`
  returns `null` and the event is discarded client-side. Someone who opted out
  of being measured has opted out of being observed.
- **Server reports carry no request context**: cookies, headers, body and query
  string are deleted before send. The edge config deletes the same four, and the
  reason is sharper there: middleware requests carry the Supabase access token
  in an `Authorization` header and the session in a cookie.
- **The release tag is a commit sha, not a person or a machine.** It is the only
  thing added to every event by this pass, and it identifies the build.
- **Error boundaries report the `digest` and nothing else** — not
  `error.message`, which on a client-thrown error can carry a URL, a field
  value, or a fragment of the learner's own circuit.
- **404s are never reported.** `notFound()` is a routing outcome, not a failure.

---

## `/api/email` — closed, and no longer relying on a rate limit

This section used to say the endpoint was open, that its limiter was a plain in-process `Map`, and
that authentication or a shared store was needed "before untrusted callers can reach it". **Both
halves have since been done**, and the reasons are worth keeping because the same mistake is easy
to make again.

- **It requires a verified caller, and will only send to that caller's own verified address.**
  `verifiedCaller(request)` resolves a Supabase-validated identity, and the recipient is taken from
  the token rather than the body. Mailing a stranger is structurally impossible, not merely
  rate-limited. Before that, an anonymous `curl` could name any recipient — unsolicited mail
  wearing the product's own sending reputation, DKIM-signed and SPF-passing.
- **Caller-supplied URLs are pinned to this app's hosts.** The `invite` and `magic-link` templates
  put a URL behind a "Sign in" button; unconstrained, that is a phishing mail from the product's
  own domain.
- **The limiter is now `lib/rateLimit.ts`**, which counts in a shared Redis when
  `UPSTASH_REDIS_REST_URL` + `_TOKEN` (or the identical `KV_REST_API_*` pair — Vercel KV is Upstash
  underneath) are set. With neither set it falls back to an in-process counter, which on a
  serverless platform approaches "no limit at all" because every cold start begins with an empty
  map. **Set one of those pairs in production.** The key is the caller's IP, normalised to a /64
  for IPv6, and its own header is honest that this bounds one machine and not a distributed
  attacker.

`lib/email/route.test.ts` fails if either gate is removed.

Org invites never went through this route: `/api/orgs/invite` calls `sendEmail` from
`lib/email/client.ts` directly, server-side, behind its own authentication and role check. Nothing
else in the product calls `/api/email` at all.

---

## Before you let real users in

- [ ] `NEXT_PUBLIC_SENTRY_DSN` set in production, and a real error verified
      end-to-end from the browser through to the Sentry issue page.
- [ ] `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` set in CI so stack
      traces are readable rather than minified.
- [ ] `NEXT_PUBLIC_SENTRY_RELEASE` set at build time to the same commit the
      source maps are uploaded under, and one real browser error confirmed to
      show an unminified frame. Without this the maps are uploaded and never
      matched — the most expensive way to have no stack traces.
- [ ] `/api/health` on all three services returning 200 from the real
      deployment — **with `?deep=1` on the Next app**, which is the only variant that probes
      anything — and at least one dependency deliberately stopped to confirm it goes 503. A health
      check nobody has ever seen fail is untested.
- [ ] An uptime monitor pointed at `/api/health?deep=1` (not `/`, and not the shallow path),
      alerting on the status code.
- [ ] A Sentry alert rule that reaches a human — an issue nobody is paged for is
      a log line.
- [ ] `RESEND_API_KEY` set and a domain verified; the sandbox `resend.dev`
      sender only delivers to your own address.
- [ ] `EMAIL_FROM` on your verified domain, with SPF, DKIM and DMARC published.
- [ ] One real invite sent to an external address and received, not just
      accepted by the API.
- [ ] `UPSTASH_REDIS_REST_URL` + `_TOKEN` (or `KV_REST_API_*`) set, so the limiter on every
      money-spending route counts in a shared store instead of one instance's memory.
- [ ] `HEALTH_DEEP_TOKEN` set, and the uptime monitor's URL updated to
      `/api/health?deep=1&token=…`. A monitor still pointed at the bare path is watching a shallow
      check that cannot go red for a dependency outage.
- [ ] Decide explicitly whether `ANALYTICS_SUPABASE_TABLE` is set at all; the
      default of storing nothing is a defensible product position.
- [ ] If ingestion is on, publish what is collected and confirm the opt-out is
      reachable from the UI.
- [ ] Confirm a build with an empty environment still succeeds — that path is
      what every new contributor hits first.
- [ ] Every image actually built once on a real Docker daemon, and each
      container reporting `healthy` — none of them has ever been built.
- [ ] `services/api` confirmed unreachable from the internet, or
      `API_SHARED_SECRET` set on it and `QUANTUM_API_SECRET` matching on the web
      side. It is unauthenticated by default and spends hardware credits.
- [ ] `ALLOWED_ORIGINS` set on BOTH Python services to the real web origin.
- [ ] Supabase RLS tested on a throwaway project as an ordinary signed-in user
      — the policies in `supabase/*.sql` have never been run anywhere.
- [ ] Pending invitations exported before `supabase/schema-orgs.sql` is re-run
      on any project that has sent one; it DELETES every unclaimed invite.
