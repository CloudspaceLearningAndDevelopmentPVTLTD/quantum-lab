/**
 * track.ts — local-first analytics.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  BY DEFAULT, NOTHING RECORDED HERE EVER LEAVES THE DEVICE.
 *
 *  Events are appended to a ring buffer in this browser's localStorage and
 *  read back by /insights, which computes every number in the page locally.
 *  There is no network call, no third-party script, no cookie, no pixel, no
 *  fingerprint, and no cross-site identifier anywhere in this file.
 *
 *  The ONLY way an event can be transmitted is if the deployment sets
 *  NEXT_PUBLIC_ANALYTICS_ENDPOINT *and* something calls `flush()`. With that
 *  variable unset — which is the default, and the shipped configuration —
 *  `flush()` is a no-op that resolves immediately.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every export is SSR-guarded (returns an empty/neutral value when `window` is
 * undefined) and none of them throw: storage can be full, disabled, or blocked
 * by private-browsing rules, and analytics is never important enough to break a
 * page over.
 */

import {
  normalizeEvent,
  sanitizeProps,
  type AnalyticsEvent,
  type EventName,
  type EventPropValue,
} from '@/lib/analytics/events'

const EVENTS_KEY = 'quantum-lab.events'
const OPTOUT_KEY = 'quantum-lab.analytics-optout'
const SESSION_KEY = 'quantum-lab.analytics-session'

/** Ring-buffer cap. Oldest events are dropped once the buffer is full. */
export const MAX_EVENTS = 1000

// ── environment ───────────────────────────────────────────────

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

/**
 * The ingestion endpoint, or null.
 *
 * Read via the full `process.env.NEXT_PUBLIC_…` expression so Next's build-time
 * inlining picks it up. Empty string counts as unset.
 */
export function analyticsEndpoint(): string | null {
  const value = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** True when this build could ever transmit. Useful for honest UI copy. */
export const REMOTE_INGESTION_CONFIGURED = analyticsEndpoint() !== null

// ── opt-out ───────────────────────────────────────────────────

/**
 * Browser-level privacy signals.
 *
 * `navigator.globalPrivacyControl` is not in the DOM lib yet, so it is read off a
 * narrowly-typed view of `navigator` rather than with `any`.
 */
interface PrivacySignals {
  doNotTrack?: string | null
  globalPrivacyControl?: boolean
}

function privacySignals(): PrivacySignals {
  if (!hasWindow() || typeof navigator === 'undefined') return {}
  return navigator as Navigator & PrivacySignals
}

/**
 * Do Not Track / Global Privacy Control are treated as an AUTOMATIC opt-out that
 * the in-app toggle cannot override.
 *
 * The reasoning: DNT and GPC are the user telling their browser, once, that they
 * do not want to be measured. Letting a per-site switch turn that back on would
 * make the browser-level setting meaningless — and a setting that a site can
 * quietly revoke is worse than no setting at all. So the browser signal wins, and
 * the toggle on /insights is disabled with an explanation when it is present.
 * (The cost is small: the only thing lost is this person's own dashboard, which
 * is exactly the trade someone sending GPC has already said they want.)
 */
export function hasBrowserPrivacySignal(): boolean {
  const nav = privacySignals()
  if (nav.globalPrivacyControl === true) return true
  return nav.doNotTrack === '1'
}

export function isOptedOut(): boolean {
  if (!hasWindow()) return true // Nothing to record during SSR anyway.
  if (hasBrowserPrivacySignal()) return true
  try {
    return window.localStorage.getItem(OPTOUT_KEY) === '1'
  } catch {
    // If we cannot read the preference we cannot honour it — so assume opt-out.
    return true
  }
}

export function setOptedOut(value: boolean): void {
  if (!hasWindow()) return
  try {
    if (value) {
      window.localStorage.setItem(OPTOUT_KEY, '1')
      // Opting out also discards what was already collected — leaving a buffer
      // behind would make "off" mean "paused", which is not what people expect.
      window.localStorage.removeItem(EVENTS_KEY)
    } else {
      window.localStorage.removeItem(OPTOUT_KEY)
    }
  } catch {
    // Storage unavailable — nothing is being recorded either, so this is safe.
  }
}

// ── session id ────────────────────────────────────────────────

function randomId(): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    try {
      return cryptoRef.randomUUID()
    } catch {
      // Fall through to the timestamp id below.
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A per-TAB id held in sessionStorage, so it dies when the tab does.
 * It is not a user id: it is not stable across tabs, reloads of a closed tab, or
 * devices, and it is never sent anywhere by default.
 */
export function getSessionId(): string {
  if (!hasWindow()) return ''
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const fresh = randomId()
    window.sessionStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    return randomId()
  }
}

// ── buffer ────────────────────────────────────────────────────

function readBuffer(): AnalyticsEvent[] {
  if (!hasWindow()) return []
  try {
    const raw = window.localStorage.getItem(EVENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const events: AnalyticsEvent[] = []
    for (const item of parsed) {
      const event = normalizeEvent(item)
      if (event) events.push(event)
    }
    return events
  } catch {
    return []
  }
}

function writeBuffer(events: AnalyticsEvent[]): void {
  if (!hasWindow()) return
  try {
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
  } catch {
    // Quota exceeded or storage disabled. Drop the write rather than retrying —
    // losing analytics is always preferable to breaking the page.
  }
}

/** Append an event to the local ring buffer. Never throws, never transmits. */
export function track(name: EventName, props?: Record<string, unknown>): void {
  if (!hasWindow()) return
  if (isOptedOut()) return

  try {
    const event: AnalyticsEvent = {
      name,
      at: new Date().toISOString(),
      props: sanitizeProps(props),
      sessionId: getSessionId(),
    }
    const buffer = readBuffer()
    buffer.push(event)
    // Ring buffer: keep the newest MAX_EVENTS, drop the oldest.
    writeBuffer(buffer.length > MAX_EVENTS ? buffer.slice(buffer.length - MAX_EVENTS) : buffer)
  } catch {
    // Analytics must never surface as an application error.
  }
}

export function getEvents(): AnalyticsEvent[] {
  return readBuffer()
}

export function clearEvents(): void {
  if (!hasWindow()) return
  try {
    window.localStorage.removeItem(EVENTS_KEY)
  } catch {
    // Nothing sensible to do; the caller re-reads an empty list either way.
  }
}

/** Replace the buffer wholesale — used by the sample-data seeder on /insights. */
export function replaceEvents(events: AnalyticsEvent[]): void {
  const capped = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events
  writeBuffer(capped)
}

/**
 * Optionally POST the buffer to a self-hosted ingestion endpoint.
 *
 * Does nothing at all unless NEXT_PUBLIC_ANALYTICS_ENDPOINT is set — the default
 * for every shipped build. Also does nothing when the user has opted out or a
 * DNT/GPC signal is present. The buffer is NOT cleared on success: this device
 * still owns its own copy for the dashboard.
 */
export async function flush(): Promise<void> {
  if (!hasWindow()) return
  const endpoint = analyticsEndpoint()
  if (!endpoint) return
  if (isOptedOut()) return

  const events = readBuffer()
  if (events.length === 0) return

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No cookies, no credentials, no ambient identity of any kind.
      credentials: 'omit',
      body: JSON.stringify({ events }),
      keepalive: true,
    })
  } catch {
    // Offline, blocked, or endpoint down. The local copy is the source of truth.
  }
}

export type { AnalyticsEvent, EventName, EventPropValue }
