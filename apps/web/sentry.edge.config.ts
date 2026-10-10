/**
 * sentry.edge.config.ts — error tracking for the edge runtime, OFF unless a DSN
 * is set. Same guard as the other two configs: no DSN, no init, no cost.
 *
 * WHY A THIRD FILE, when instrumentation.ts used to import the server config on
 * edge and the comment there said that was fine. Two reasons, both concrete:
 *
 * 1. `withSentryConfig` looks for `sentry.edge.config.ts` BY NAME when it
 *    instruments the build. A project with only client + server configs gets
 *    edge code paths — any route with `export const runtime = 'edge'` (the
 *    opengraph-image.tsx routes) — that are not wired at all, so a failure
 *    there is exactly as invisible as it was before this workstream.
 * 2. As of Next.js 16, proxy.ts (formerly middleware.ts) always runs on the
 *    nodejs runtime, not edge — it no longer reads this config at all. This
 *    file's `tracesSampleRate` was originally set low (0.02, vs. 0.1 for the
 *    other runtimes) because middleware saw EVERY request, including static
 *    asset requests. Left at 0.02 since the edge runtime here is still only
 *    reached by the low-value opengraph-image routes; revisit if that changes.
 *
 * There is no `process.on`, no `fs`, and no Node global referenced below —
 * the edge runtime has none of them.
 */

import * as Sentry from '@sentry/nextjs'
import { registerErrorReporter } from '@/lib/observability/report'
import { ENVIRONMENT, RELEASE } from '@/lib/observability/release'

const DSN = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim()

/** Query strings can carry a shared circuit; only the path is ever sent. */
function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

if (DSN) {
  Sentry.init({
    dsn: DSN,
    release: RELEASE,
    environment: ENVIRONMENT,

    // See the header: this is deliberately a fifth of the other runtimes'
    // rate, a holdover from when middleware.ts ran on this runtime and saw
    // every request. Do not raise it to "match" them without re-reading why.
    tracesSampleRate: 0.02,

    // No IP addresses, no cookies, no request headers, no request bodies.
    sendDefaultPii: false,

    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = stripQuery(event.request.url)
      }
      if (event.request) {
        // Requests through this runtime can carry the Supabase access token in
        // an Authorization header and the session in a cookie. Neither is ever
        // worth a debugging session; both are credentials.
        delete event.request.query_string
        delete event.request.cookies
        delete event.request.headers
        delete event.request.data
      }
      return event
    },
  })

  // Hand the SDK to lib/observability/report.ts, which never imports it itself.
  registerErrorReporter(Sentry)
}
