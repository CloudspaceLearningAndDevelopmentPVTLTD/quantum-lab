# Observability & email

## Error reporting

Sentry is switched on by one variable, `NEXT_PUBLIC_SENTRY_DSN`. Without it the SDK is never imported: `next.config.mjs` wraps the configuration with `withSentryConfig` only when the DSN is present, and `instrumentation.ts` loads the server or edge configuration conditionally. The three configurations set a 10 % trace sample rate (2 % on the edge), pin session replay to zero for both sessions and errors, set `sendDefaultPii: false`, honour the analytics opt-out stored in the browser, and strip query strings from captured URLs because shared circuits travel in `?c=`.

Application code never imports the Sentry SDK. `lib/observability/report.ts` exposes `reportError`, `reportMessage`, `setUserContext` and `withErrorReporting`, and the SDK registers itself as the reporter from the Sentry configuration files. Every call is a no-op when nothing is registered, nothing throws, and context is scrubbed before it is sent. `lib/observability/release.ts` ties reports to the build stamp, so an error can be matched to the exact image that produced it.

## Health and logs

Health endpoints are described under [Operations](index.md). On Azure, all three Container Apps write to a shared Log Analytics workspace; locally, uvicorn and Next.js log to stdout. The API service logs a `RuntimeWarning` at startup when CORS is left at its localhost default, and the rate limiter warns when it is running without a shared store.

## Analytics

Analytics are local-first and privacy-preserving by construction rather than by policy:

- Events are 15 named kinds (`lesson.viewed`, `circuit.run`, `tutor.asked`, `exam.completed`, …) with properties restricted to strings, numbers and booleans.
- Properties whose keys match PII patterns are dropped and strings are truncated to 64 characters **before** they leave the device.
- Nothing is sent unless an endpoint is configured; the `/insights` page computes its dashboards from the local buffer and offers sample data for a fresh browser.
- The ingest route validates and sanitises again, caps batches at 500, and stores nothing unless both a table name and Supabase are configured.
- A `localStorage` opt-out key disables both analytics and error reporting.

## Transactional email

`lib/email/client.ts` wraps Resend. `isEmailConfigured` is true only with an API key, `sendEmail` returns `{ sent: false, reason }` rather than throwing when it cannot send, and an unconfigured deployment is a valid state in which every template is a no-op.

Templates are a closed set (organisation invite, magic link, welcome, subscription confirmation, exam passed, the seven course days). The `POST /api/email` route accepts only a template name and verified inputs; the recipient and every URL in the body are determined server-side, because an earlier version accepted a recipient from the request and could have been used to send mail to anyone. A test asserts that every link in the course emails resolves to a real route.

### The seven-day course

A learner who subscribes receives one lesson a day for a week. The subscription is **double opt-in**: `POST /api/email/subscribe` stores an unconfirmed row and mails a confirmation link; the link confirms. Tokens are stored as SHA-256 hashes. Every message carries a one-click unsubscribe whose landing page always says "unsubscribed", so the page cannot be used to probe whether an address is on the list.

Sending is driven by `POST /api/email/dispatch`, an operator-only endpoint (bearer secret, constant-time compare, ignored entirely when unset) that processes at most `limit` subscriptions per call and sends at most one message to each. Day *N* is due at confirmation plus (N − 1) × 24 h; a backlog drains one day per run; the `sent_days` column is the idempotency record. The endpoint refuses outright, with a 503, if the subscription store is the in-memory fallback, because a store that forgets opt-outs on restart is precisely what must never drive a scheduler. In production an hourly Azure Container Apps Job calls it, so every subscriber receives their next lesson within the hour it falls due.
