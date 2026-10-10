# Request lifecycle & trust boundaries

This page explains who is trusted to say what, and where each claim is checked. The rule that organises everything: **a value supplied by the caller is a claim; identity comes only from a verified token; authorisation happens in the route handler that touches the data.**

## Identity

The Supabase session lives in browser storage, not in a cookie. The browser attaches it as `Authorization: Bearer <access_token>` through `lib/authFetch.ts`. On the server, `lib/security/auth.ts` is the only module that turns a token into an identity:

- `verifiedCaller(req)` calls `supabase.auth.getUser(token)` and returns `{ id, email }`. The email comes from the token, never from the request body.
- `verifiedApiCaller(req)` additionally accepts a scoped API key (`qb16_sk_…`) and returns the key's owner and scopes.
- Tokens over 4,096 characters are rejected before any network call.

A `userId` in a request body or query string is never used as a credential. Several audit findings (BILL-1, BILL-2, ORG-1, INV-1) were exactly this class of bug, and the fixes are regression-tested.

## Why there is no authentication middleware

`proxy.ts` (Next 16's middleware) does one thing: it attaches the security headers to every response. It performs no awaits, no fetches and no cookie parsing, and it is explicitly **not an authorisation boundary**. Because the session is not in a cookie, nothing at the edge can tell who is calling; and a proxy that authorises some routes invites the assumption that routes behind it are safe. Every handler that reads or writes user data verifies the token itself.

The same reasoning applies to pages: a page marked `noIndex` or reachable only by URL is not protected. Protection is the 401/402 the data route returns.

## The gate chain

The hardware submission route is the most consequential request in the system, because a successful one spends money with a vendor. Its handler applies eight checks in a fixed order, and the order is part of the design:

```mermaid
flowchart TD
  A[1 · IP rate limit<br/>5 submits/min] --> B[2 · verify token or API key<br/>→ 401]
  B --> C[3 · per-account rate limit]
  C --> D[4 · validate shape<br/>QASM ≤ 128 KB, shots ≤ 20,000]
  D --> E[4b · resolve BYOK credential<br/>store failure → refuse, never fall back]
  E --> F[5 · requireFeature 'hardware.real'<br/>→ 402 on Free]
  F --> G[6 · reserve quota atomically<br/>SQL advisory lock per user → 402 if exhausted]
  G --> H[7 · forward to services/api<br/>with X-Quantum-Lab-Secret]
  H --> I{upstream 2xx?}
  I -- yes --> J[8 · record provider job handle]
  I -- no --> K[release reservation]
```

Rate limiting runs **before** token verification so that a flood of guesses never costs a Supabase call. Quota reservation runs **before** forwarding so that two concurrent submissions cannot both pass a count-then-insert race; `reserve_hardware_job` is a `security definer` SQL function serialised per user. A BYOK (bring-your-own-key) job is recorded but not metered, and the response header `X-Qubit16-Credential-Owner` says whether the user's or the operator's account paid.

`lib/hardware/submitGate.test.ts` exists because an earlier version of this route had only an IP limit while the proxy attached the operator secret for anonymous callers. The test fails if any step is removed.

## Service-to-service trust

| Hop | Mechanism |
| --- | --- |
| web → services/api | `X-Quantum-Lab-Secret` header, set server-side from `QUANTUM_API_SECRET`. Compared with `hmac.compare_digest` against every configured value (a comma-separated list allows rotation with no outage: api `old,new` → web `new` → api `new`). A custom header rather than `Authorization`, because it proves *which service* is calling, not which person. Browser headers are never relayed upstream. |
| web → services/agent | No credential; protected by network placement plus the web route's rate limits, clamps and tier policy. The agent re-applies the same clamps so it does not depend on its only caller. |
| email cron → web | `Authorization: Bearer EMAIL_DISPATCH_SECRET`, constant-time compare, ignored entirely when the variable is unset (an empty secret must never authorise anything). |
| operator → billing reconcile | `x-reconcile-secret`, same rules. |
| Stripe → web webhook | Signature verified against the raw body; the webhook is the **only** writer of `subscriptions`, with an idempotency log and out-of-order protection keyed on `event.created`. |

The API service is unauthenticated by design when `API_SHARED_SECRET` is unset, and its Dockerfile says in its header not to publish the port in that state. The supported deployments are "keep it private" or "set the secret and route through Next".

## Untrusted content inside trusted contexts

Two places feed caller-controlled text to a language model, and both fence it:

- The learner's circuit is wrapped in `<<<UNTRUSTED_LEARNER_DATA>>>` … `<<<END_UNTRUSTED_LEARNER_DATA>>>` before it reaches the tutor.
- Retrieved course excerpts and arXiv abstracts are wrapped by `as_reference_material` in `<<<REFERENCE_MATERIAL>>>` markers with a preamble instructing the model not to obey them; the markers are stripped from the payload first so a document cannot forge the boundary.

The Algorithm Evolution workbench interprets candidate programs in a tiny line-based DSL and never evaluates model output as code.

## Database trust

All 29 tables have row-level security enabled. User-facing policies exist only where a browser legitimately reads or writes with the anon key (own circuits, own progress, own org, public runs). Tables that must never be written by a browser, among them `subscriptions`, `hardware_usage`, `api_keys`, `stripe_events`, `platform_settings` and `user_provider_credentials`, have RLS enabled with **zero** policies, which makes them service-role only. The service-role key is read by server-only modules and is never shipped to the client. See [Data & accounts](data.md).
