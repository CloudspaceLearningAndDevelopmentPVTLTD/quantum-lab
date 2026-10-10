# Operations

Qubit16 is designed to be operated by a small team. The operating principle is that every integration is optional, every degradation is visible, and every environment is validated before it serves a request.

## Zero required configuration

The whole stack builds and runs with an empty environment. `.env.example` documents about 66 variables and not one is required. What each unlocks:

| Variable group | Unlocks | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `…_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Accounts, saved circuits in the cloud, orgs, exams, quotas | Everything persists in `localStorage`; the account page says accounts are not configured |
| `STRIPE_SECRET_KEY`, price ids, webhook secret | Checkout, portal, subscriptions | Pricing renders; checkout says it is not configured |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_API_*` | The live tutor tiers | The offline FAQ tier |
| `IBM_QUANTUM_TOKEN`, AWS keys, `AZURE_QUANTUM_*` | Real hardware | Devices listed as unavailable with the reason |
| `UPSTASH_REDIS_REST_*` | Shared rate-limit store | In-process limiter, with a startup warning |
| `RESEND_API_KEY`, `EMAIL_DISPATCH_SECRET` | Transactional email, the 7-day course | Email is a no-op that reports `sent: false` |
| `NEXT_PUBLIC_SENTRY_DSN` | Error reporting | The SDK is never imported |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT`, `ANALYTICS_SUPABASE_TABLE` | Aggregate analytics | Events stay on the device |

Three validators enforce this at boot: `lib/env.ts` in the web app (run from `instrumentation.ts`), `app/core/env_check.py` in the API and `agent/env_check.py` in the agent. They error only on *half*-configuration (a Stripe key with no price ids, an AWS access key with no secret, a wildcard CORS origin) and warn on everything else. `scripts/preflight.mjs` runs the same logic before a deploy, and CI asserts that an empty environment passes.

## Health

Each service has a health endpoint that is safe to poll:

| Service | Path | What it probes |
| --- | --- | --- |
| Web | `GET /api/health` | Configuration of Supabase, Stripe, the two services and the model providers; `?deep=1` (optionally gated by `HEALTH_DEEP_TOKEN`) adds live reachability |
| API | `GET /api/health` | Runs a real one-qubit circuit end to end, pings the job store, reports provider readiness from credential and SDK presence with `checked: false` |
| Agent | `GET /api/agent/health` | API reachability, whether the course index loaded, model provider configuration; makes no model call |

Probe states are `ok`, `degraded` (still 200), `failing` (503) and `skipped` (never red). A service with nothing configured is healthy, because that is a valid state. Each container declares a `HEALTHCHECK` against its endpoint and the deployment's smoke test curls the public one.

## Errors

API errors share one shape from `lib/apiError.ts`: a stable code, an HTTP status and a human message, with 400 for bad input, 401 for no identity, 402 for a locked feature or exhausted quota, 409 for a conflict, 429 for rate limiting, 503 for an unavailable dependency. Pages have route-level error boundaries and a global one. Nothing returns 500 on a bad request body.

## Runbooks in the repository

| Document | Covers |
| --- | --- |
| `docs/OPERATIONS.md` | Environment variables with build/run annotations, health, error model, privacy decisions |
| `docs/DEPLOYMENT.md` | Vercel + Railway and one-box Docker Compose paths, first-deploy checklist, rollback |
| `docs/DEPLOYMENT-AZURE.md` | The production path (next page) |
| `docs/DEPLOYMENT-AWS.md`, `docs/DEPLOYMENT-GCP.md` | App Runner and Cloud Run alternatives |
| `docs/STRIPE-SETUP.md` | Test-mode billing in fifteen minutes, with the smoke script |

Rollback is documented as a platform operation (promote the previous image or deployment) with the explicit note that it does not undo processed Stripe events, browser service-worker caches or schema migrations; migrations are idempotent and additive for that reason.
