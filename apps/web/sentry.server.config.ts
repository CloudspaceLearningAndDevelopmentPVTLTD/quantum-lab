/**
 * sentry.server.config.ts — server-side error tracking, OFF unless a DSN is set.
 *
 * Same guard as the client config: no DSN, no init, no cost.
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
    tracesSampleRate: 0.1,

    // No IP addresses, no cookies, no request headers, no request bodies.
    sendDefaultPii: false,

    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = stripQuery(event.request.url)
      }
      if (event.request) {
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
