/**
 * observability/report.ts — the ONLY module in the app that knows Sentry exists.
 *
 * Everything else calls reportError / reportMessage / setUserContext. That is the
 * same argument the infrastructure doc made about keeping PennyLane behind a
 * service boundary: the vendor is an implementation detail, and a thin seam here
 * means swapping it is a one-file change rather than a grep across the codebase.
 *
 * DEFAULT STATE IS OFF. With no NEXT_PUBLIC_SENTRY_DSN set — which is what every
 * local developer has — nothing is sent and nothing is logged in production.
 * Nothing in this module throws at import time, and no exported function ever
 * throws: an error reporter that itself throws turns a handled failure into an
 * unhandled one, which is strictly worse than having no reporter at all.
 *
 * NOTE THE MISSING IMPORT. This file deliberately does NOT import
 * '@sentry/nextjs'. Doing so would pull @sentry/node into the webpack graph of
 * every route and client component that reports an error, which (a) emits
 * "Critical dependency" warnings on a build with no Sentry configured and (b)
 * ships vendor code to developers who never asked for it. Instead the SDK
 * registers itself here from sentry.client.config.ts / sentry.server.config.ts,
 * which are only ever loaded when a DSN exists. Unconfigured, the registry stays
 * empty and Sentry is not in the bundle at all.
 */

const DSN = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim()

/** The slice of the Sentry API this app uses. Kept small on purpose. */
export interface ErrorReporterBackend {
  captureException(error: unknown, hint?: { extra?: Record<string, unknown> }): void
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void
  setUser(user: { id: string } | null): void
}

const REGISTRY_KEY = '__quantumLabErrorReporter'

type Registry = { [REGISTRY_KEY]?: ErrorReporterBackend }

/**
 * Called by the Sentry config files after a successful init. Kept on globalThis
 * rather than in module state because the config files and this module can end
 * up in different webpack chunks.
 */
export function registerErrorReporter(backend: ErrorReporterBackend): void {
  ;(globalThis as unknown as Registry)[REGISTRY_KEY] = backend
}

function backend(): ErrorReporterBackend | null {
  return (globalThis as unknown as Registry)[REGISTRY_KEY] ?? null
}

/** True only when a DSN is present. Everything below is a no-op when false. */
export const isErrorTrackingConfigured: boolean = DSN.length > 0

const isDevelopment = process.env.NODE_ENV === 'development'

/**
 * Context-key patterns that smell like personal data. Matched case-insensitively
 * as substrings, so `userEmail`, `EMAIL_ADDRESS` and `api_key` are all caught.
 * Deliberately the same list as lib/analytics/events.ts — one definition of
 * "PII-shaped" across the product is easier to audit than two that drift.
 */
const PII_KEY_PATTERNS = [
  'email',
  'name',
  'token',
  'key',
  'secret',
  'password',
  'phone',
  'address',
] as const

/** Longest string allowed on a context value before it is clipped. */
const MAX_CONTEXT_STRING_LENGTH = 200

function looksLikePii(key: string): boolean {
  const lower = key.toLowerCase()
  return PII_KEY_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Drop PII-shaped keys and truncate long strings before anything leaves the
 * process. Call sites are not supposed to pass personal data at all; this is the
 * backstop for when one eventually does.
 */
export function scrubContext(
  context: Record<string, unknown> | undefined | null
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {}
  if (typeof context !== 'object' || context === null) return clean

  for (const [key, value] of Object.entries(context)) {
    if (!key || looksLikePii(key)) continue

    if (typeof value === 'string') {
      clean[key] = value.slice(0, MAX_CONTEXT_STRING_LENGTH)
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) clean[key] = value
    } else if (typeof value === 'boolean') {
      clean[key] = value
    }
    // Objects, arrays, null and functions are dropped: a flat map of scalars is
    // the only shape we can reason about privately.
  }

  return clean
}

/**
 * Report an error. Safe to call from anywhere, at any time, configured or not.
 * Never throws.
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  const scrubbed = scrubContext(context)

  if (!isErrorTrackingConfigured) {
    // Unconfigured: noisy in development where a developer wants to see it,
    // completely silent in production where there is nobody to read it.
    if (isDevelopment) {
      console.error('[report]', err, Object.keys(scrubbed).length > 0 ? scrubbed : '')
    }
    return
  }

  try {
    backend()?.captureException(
      err,
      Object.keys(scrubbed).length > 0 ? { extra: scrubbed } : undefined
    )
  } catch {
    // Reporting failed. That is not the caller's problem and must not surface.
  }
}

/** Report a non-exception message (a degraded state, a fallback taken). */
export function reportMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (typeof msg !== 'string' || msg.length === 0) return

  if (!isErrorTrackingConfigured) {
    if (isDevelopment) console.info(`[report:${level}]`, msg.slice(0, MAX_CONTEXT_STRING_LENGTH))
    return
  }

  try {
    backend()?.captureMessage(msg.slice(0, MAX_CONTEXT_STRING_LENGTH), level)
  } catch {
    /* never throw from the reporter */
  }
}

/**
 * Attach (or clear) the current user.
 *
 * ONLY AN OPAQUE ID IS EVER ATTACHED. No email, no username, no IP. An account
 * id is enough to group a user's errors together, which is the entire reason to
 * set user context; an email address adds nothing operationally and turns every
 * error report into a personal-data record. Do not add fields here.
 */
export function setUserContext(id: string | null): void {
  if (!isErrorTrackingConfigured) return
  try {
    backend()?.setUser(id ? { id } : null)
  } catch {
    /* never throw from the reporter */
  }
}

/**
 * Run an async operation, report anything it throws, and rethrow so the caller's
 * own error handling is unchanged. Reporting is an observation, not a catch.
 */
export async function withErrorReporting<T>(
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    reportError(err, context)
    throw err
  }
}
