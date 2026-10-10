/**
 * events.ts — the closed event taxonomy.
 *
 * There are no free-form event names in Qubit16. Every event a call site can
 * emit is listed in `EventName`, which means the whole set of things we record is
 * readable in one screen and reviewable in a diff. Adding a new event is a
 * deliberate, typed change — not something that happens by typo.
 *
 * Nothing here touches the browser: this module is pure data + pure functions so
 * it can be imported from a route handler, a test, or a client component alike.
 */

export type EventName =
  | 'lesson.viewed'
  | 'lesson.completed'
  | 'quiz.answered'
  | 'circuit.built'
  | 'circuit.run'
  | 'circuit.saved'
  | 'circuit.shared'
  | 'viz.opened'
  | 'viz.interacted'
  | 'tutor.asked'
  | 'exam.started'
  | 'exam.completed'
  | 'hardware.submitted'
  | 'upgrade.viewed'
  | 'upgrade.started'

/** The value types an event property is allowed to carry. No nested objects. */
export type EventPropValue = string | number | boolean

export interface AnalyticsEvent {
  name: EventName
  /** ISO-8601 timestamp. */
  at: string
  props: Record<string, EventPropValue>
  /** Per-tab identifier. Not a user id, not persisted across tabs or restarts. */
  sessionId: string
}

/** Every name, in a stable order — useful for iteration and for docs/tables. */
export const EVENT_NAMES: readonly EventName[] = [
  'lesson.viewed',
  'lesson.completed',
  'quiz.answered',
  'circuit.built',
  'circuit.run',
  'circuit.saved',
  'circuit.shared',
  'viz.opened',
  'viz.interacted',
  'tutor.asked',
  'exam.started',
  'exam.completed',
  'hardware.submitted',
  'upgrade.viewed',
  'upgrade.started',
] as const

/** Human-readable labels for display in the dashboard and the table views. */
export const EVENT_LABELS: Record<EventName, string> = {
  'lesson.viewed': 'Lesson viewed',
  'lesson.completed': 'Lesson completed',
  'quiz.answered': 'Quiz answered',
  'circuit.built': 'Circuit edited',
  'circuit.run': 'Circuit run',
  'circuit.saved': 'Circuit saved',
  'circuit.shared': 'Circuit shared',
  'viz.opened': 'Visualization opened',
  'viz.interacted': 'Visualization explored',
  'tutor.asked': 'Tutor question asked',
  'exam.started': 'Exam started',
  'exam.completed': 'Exam completed',
  'hardware.submitted': 'Hardware job submitted',
  'upgrade.viewed': 'Upgrade page viewed',
  'upgrade.started': 'Upgrade started',
}

export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && (EVENT_NAMES as readonly string[]).includes(value)
}

/**
 * Property-key patterns that smell like personal data.
 *
 * Matched case-insensitively as substrings, so `userEmail`, `EMAIL_ADDRESS` and
 * `api_key` are all caught.
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

/** Strings longer than this are truncated — no free-text essays in a prop. */
export const MAX_PROP_STRING_LENGTH = 64

function looksLikePii(key: string): boolean {
  const lower = key.toLowerCase()
  return PII_KEY_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Drop PII-shaped keys and truncate long strings.
 *
 * This is DEFENCE IN DEPTH, not the primary control. The call sites are supposed
 * to never pass personal data in the first place — the taxonomy is deliberately
 * built around slugs, counts and booleans. `sanitizeProps` exists so that when
 * somebody does make that mistake (and eventually somebody will), the mistake is
 * cheap: the offending key never reaches storage, and an accidentally-pasted blob
 * is clipped to 64 characters. It runs on the client before writing and again on
 * the server before any ingestion, so neither side has to trust the other.
 */
export function sanitizeProps(
  props: Record<string, unknown> | undefined | null
): Record<string, EventPropValue> {
  const clean: Record<string, EventPropValue> = {}
  if (typeof props !== 'object' || props === null) return clean

  for (const [key, value] of Object.entries(props)) {
    if (!key || looksLikePii(key)) continue

    if (typeof value === 'string') {
      clean[key] = value.slice(0, MAX_PROP_STRING_LENGTH)
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) clean[key] = value
    } else if (typeof value === 'boolean') {
      clean[key] = value
    }
    // Everything else (objects, arrays, null, undefined, functions) is dropped:
    // a closed taxonomy of flat scalars is far easier to reason about privately.
  }

  return clean
}

/**
 * Coerce an untrusted value into an AnalyticsEvent, or return null.
 * Shared by the localStorage reader and the ingestion route so both agree on
 * exactly what counts as a valid event.
 */
export function normalizeEvent(raw: unknown): AnalyticsEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>

  if (!isEventName(record.name)) return null
  if (typeof record.at !== 'string') return null
  if (Number.isNaN(Date.parse(record.at))) return null

  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  const props = sanitizeProps(
    typeof record.props === 'object' && record.props !== null
      ? (record.props as Record<string, unknown>)
      : {}
  )

  return { name: record.name, at: record.at, props, sessionId }
}
