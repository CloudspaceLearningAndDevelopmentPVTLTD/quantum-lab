/**
 * sentry.client.config.ts — browser-side error tracking, OFF unless a DSN is set.
 *
 * The whole file is guarded: with no NEXT_PUBLIC_SENTRY_DSN (the default for
 * every local developer) Sentry.init is never called, so there is no transport,
 * no instrumentation, no performance cost and no console noise.
 */

import * as Sentry from '@sentry/nextjs'
import { registerErrorReporter } from '@/lib/observability/report'
import { ENVIRONMENT, RELEASE } from '@/lib/observability/release'

const DSN = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim()

/** localStorage key written by lib/analytics — the visitor's global opt-out. */
const OPTOUT_KEY = 'quantum-lab.analytics-optout'

function hasOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPTOUT_KEY) === 'true'
  } catch {
    // Private mode, disabled storage, SSR — unknown preference. Treat unknown as
    // "not opted out" only because the error payload is already PII-free.
    return false
  }
}

/**
 * Strip query strings from any URL we are about to send.
 *
 * A shared circuit travels as a query parameter (?c=...), so a raw URL in an
 * error report would ship the user's own work to a third party. Path only.
 */
function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

if (DSN) {
  Sentry.init({
    dsn: DSN,

    // Without these two a minified browser stack maps to nothing: source maps
    // are uploaded under a release name and an event with no release matches no
    // map. See lib/observability/release.ts for the NEXT_PUBLIC_ caveat — this
    // is the runtime that needs the explicit variable.
    release: RELEASE,
    environment: ENVIRONMENT,

    tracesSampleRate: 0.1,

    // Session replay records the user's screen. Qubit16's stated position is
    // local-first and privacy-preserving; silently filming a learner's session to
    // debug it would contradict that in the most direct way possible. Both rates
    // are pinned to 0 so replay is inert even if the integration is bundled.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Never let the SDK attach IPs, cookies or headers on its own.
    sendDefaultPii: false,

    beforeSend(event) {
      // A visitor who opted out of analytics has opted out of being observed.
      // Error reports are no exception — drop the event entirely.
      if (hasOptedOut()) return null

      if (event.request?.url) {
        event.request.url = stripQuery(event.request.url)
      }
      if (event.request?.query_string) {
        delete event.request.query_string
      }
      for (const crumb of event.breadcrumbs ?? []) {
        if (typeof crumb.data?.url === 'string') {
          crumb.data.url = stripQuery(crumb.data.url)
        }
      }
      return event
    },
  })

  // Hand the SDK to lib/observability/report.ts, which never imports it itself.
  registerErrorReporter(Sentry)
}
