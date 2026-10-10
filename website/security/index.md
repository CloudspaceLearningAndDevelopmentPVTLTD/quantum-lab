# Security

Security in Qubit16 is a set of enforced invariants, each with a test, rather than a checklist. This page lays out the threat model and the controls; the two sub-pages cover [rate limiting](rate-limiting.md) and [dependencies](supply-chain.md). The full audit history, including findings by identifier and the fixes that closed them, is in `docs/SECURITY.md` in the repository.

## Threat model

What an attacker could want, and what stands in the way:

| Goal | Primary control |
| --- | --- |
| Read another user's data | Row-level security on all 29 tables; identity only from a verified token; no user id accepted from a request body |
| Use a paid feature without paying | Entitlements resolved and enforced server-side only (ADR-0005); the paid lesson text is in neither the HTML nor the client bundle |
| Spend the operator's hardware budget | Eight-step gate chain ending in an atomic, per-user-locked quota reservation that fails closed |
| Grant themselves a plan or seats | `subscriptions` has no user write policy; the Stripe webhook is its only writer; org creation requires the caller's own subscription at that plan |
| Steal credentials or keys | API keys stored as SHA-256 hashes; provider secrets sealed with AES-256-GCM; secrets never logged or placed in error text; no secrets in the repository |
| Inject instructions through content the model reads | Learner circuits and retrieved documents fenced with untrusted-content markers; model output parsed, never evaluated |
| Reach internal services | The hardware API is behind a shared secret and only the needed endpoints are republished; webhooks have an SSRF guard |
| Abuse an endpoint at volume | Two-layer rate limiting keyed on the Cloudflare-supplied client address, applied before any expensive work |
| Script injection on the site | A Content-Security-Policy with `default-src 'self'`, `react/no-danger` as a lint error with two reviewed exceptions, HSTS, frame ancestors restricted |

## Headers

`lib/security/headers.ts` is the single source of the response headers, applied by `proxy.ts` to every page and API response, and mirrored byte-for-byte in `vercel.json` for that deployment path:

- `Content-Security-Policy`: `default-src 'self'`, with `connect-src` widened only to the configured service origins, `frame-ancestors 'self'` (widened only for `/embed/*` and only to the allow-list), and `'wasm-unsafe-eval'` on `script-src` only when the on-device tutor is enabled. `script-src` carries `'unsafe-inline'`, and the file documents the trade-off: a per-request nonce would require dynamic rendering of every page, which would undo the static-by-default architecture, so the CSP's value here is in restricting where scripts may *send* data rather than whether inline scripts may run.
- `Strict-Transport-Security` with a two-year max-age and subdomains, set whenever the request arrived over HTTPS.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, and a `Permissions-Policy` that disables camera, microphone, geolocation, payment, USB and interest-cohort.

## Authentication and authorisation

Covered in [Trust boundaries](../architecture/trust-boundaries.md). The essentials: the session is in browser storage and travels as a bearer header; `supabase.auth.getUser(token)` is the only path from a token to an identity; every route handler that touches user data verifies and authorises for itself; the middleware is not an authorisation boundary and says so.

## Secrets

- **None in the repository.** The deploy script loads a gitignored `.env.production`; the CD workflow uses OIDC federation to Azure with no stored client secret; mobile signing keys are environment variables; `.env.example` contains only placeholders.
- **Public versus private is explicit.** Only `NEXT_PUBLIC_*` variables are baked into the browser bundle; a `NEXT_PUBLIC_` name is deliberately not accepted for the API shared secret.
- **Rotation without an outage.** The API accepts a comma-separated list of secrets and compares against every one in constant time with no early exit; blank entries are dropped so a trailing comma cannot admit anonymous requests.
- **At rest.** Provider keys and bring-your-own hardware credentials are sealed with AES-256-GCM under `SETTINGS_ENCRYPTION_KEY`; a column check requires the sealed shape.
- **API keys** are shown once at creation and stored as a SHA-256 hash plus a 16-character display prefix.

## Inputs

Every route handler validates its body through `lib/security/validate.ts` (typed string, integer, array, enumeration, UUID, email and HTTPS-URL checkers, and a `safeJson` reader with a byte limit) and answers 400 with a stable error shape from `lib/apiError.ts`. Bodies are size-capped before parsing. The MCP endpoint checks the `Origin` header against the deployment host as a DNS-rebinding defence and rejects unsupported protocol versions.

## Services

- `services/api` refuses to start if `ALLOWED_ORIGINS` contains `*`, warns when it is the localhost default, and runs its environment validator before uvicorn. Its container runs as a non-root user and its health endpoint makes no vendor calls.
- `services/agent` applies the same clamps as its caller, bounds tool rounds and wall clock, and returns a partial answer rather than a 500 when a limit is hit.
- Both containers are two-stage builds from `python:3.11-slim` with test tooling stripped from the runtime image.

## Edge

The production deployment sits behind Cloudflare, which terminates TLS, provides a WAF, and supplies the `cf-connecting-ip` header the rate limiters key on. The operational checklist in the repository records the remaining edge hardening: restricting the Azure origin hostnames to Cloudflare's address ranges (which is what makes `cf-connecting-ip` trustworthy), Full (strict) TLS mode, and WAF rules for scanner paths.

## Audit history

`docs/SECURITY.md` records a full audit with a threat model, a findings table (identifiers such as BILL-1, PROXY-1, ORG-3, INJ-1, CORS-1, PY-1, MAIL-1, INV-1), the regression test added for each fix, and a list of what was checked and found clean. Findings reference their tests by path, so a reader can confirm a fix is still in force by running the suite. The practice is to write the test first against the vulnerable build, confirm it fails, then fix.
