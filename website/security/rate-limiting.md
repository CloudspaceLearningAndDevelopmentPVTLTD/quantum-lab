# Rate limiting & abuse

Every public endpoint is rate-limited, and the limit runs **before** any expensive work: before a Supabase token lookup, before a model call, before a vendor submission. A flood of bad requests should cost the platform nothing downstream.

## Two limiters

| Module | Store | Used for |
| --- | --- | --- |
| `lib/security/ratelimit.ts` | In-process fixed window, 10,000-key map dropped wholesale when full, no timers, no environment access | Advisory tier: analytics ingest, lesson content, badges |
| `lib/rateLimit.ts` | Upstash Redis REST, then Vercel KV, then in-process memory | Money-spending and model-calling tier: hardware, tutor, MCP, email dispatch, checkout, keys, webhooks |

The shared-store limiter talks to Redis over plain `fetch` with no SDK dependency. If Redis is configured but a call fails, that decision falls back to memory and the decision object says `store: 'memory'`, because failing closed would turn a Redis outage into an outage of the tutor, the pricing page and transactional mail. With no store configured at all, startup logs a warning that names both failure modes.

## Caller keys

`callerKey(headers, prefix, subject?)` decides who is being counted:

1. A **verified subject** (a Supabase user id, passed only after token verification) gives a per-account key. An account is not rotatable without creating another account, which is a much higher bar than rotating an address.
2. Otherwise the **client address**, taken from `cf-connecting-ip` first, then the first hop of `x-forwarded-for`, then `x-real-ip`, truncated to 64 characters. Cloudflare's edge overwrites `cf-connecting-ip` and only *appends* to `x-forwarded-for`, so behind Cloudflare the first is trustworthy and the second is caller-controlled. The ordering was changed after an audit of production traffic showed the limiter keyed on the spoofable header.
3. **IPv6 is collapsed to its /64.** A residential customer is normally delegated a whole /64, so counting full addresses would let one customer rotate for free.
4. With no address at all, every such caller shares one bucket. That is a small self-inflicted denial of service, and it is the safe direction.

Keys are prefixed per route so two endpoints never share a bucket, and bounded in length so a header cannot become a memory-growth primitive.

## Representative limits

| Endpoint | Limit |
| --- | --- |
| Hardware reads | 60 / min per address |
| Hardware submit | 5 / min per address, then a per-account limit |
| Tutor | 12 / min and 100 / hour per caller |
| MCP | 60 / min and 1,000 / hour per caller; 128 KB body; 20,000 characters of QASM; 16 qubits; 4,096 shots |
| REST tools | 30 / min per address |
| Email dispatch | 10 / min, before the secret is even examined |

A 429 carries `retry-after` and `x-ratelimit-reset` so a well-behaved client can back off correctly.

## Honest limits of the design

The security documentation states what per-address limiting does and does not stop. It stops one machine. It does not stop a distributed attacker with a residential proxy pool, who multiplies the limit by the addresses they buy. The per-person cost of the anonymous tutor is therefore bounded only by the per-day message policy in the tier configuration, and the documentation records that tighter bounds would require authentication, which conflicts with the tutor being deliberately usable without an account. Platform edge rate limiting in front of the application is recommended as a second layer and is part of the Cloudflare configuration.

## Clamps that are not rate limits

Size and shape limits sit beside the rate limits and are applied in the same early position: body byte caps before JSON parsing, QASM character caps, shot caps, qubit caps, message and history caps for the tutor, batch caps for analytics, term caps for observables. Each is a constant in the route or module with a comment giving the reason, and `lib/rateLimitRoutes.test.ts` asserts that the routes that should be limited are.
