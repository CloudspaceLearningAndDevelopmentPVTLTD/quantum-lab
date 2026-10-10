/**
 * Spaced-repetition scheduler — SM-2-lite over the lesson quiz bank.
 *
 * Quantum Country's pattern applied to the quizzes this app already has: a
 * question you have answered becomes a card; answering it again on /review
 * pushes its next appearance further out on success and pulls it close on
 * failure. Like every other kind of progress in this product, the whole
 * schedule lives in this browser's localStorage (one key, below) and nothing
 * about it ever leaves the device — docs/ANALYTICS.md is the authority on that
 * stance and this module adds no exception to it.
 *
 * DESIGN RULES:
 *  · Every scheduling function here is PURE and takes the clock as a `Date`
 *    argument. No `Date.now()`, no `new Date()` — determinism is what makes
 *    the tests in scheduler.test.ts mean anything. Only the two storage
 *    functions at the bottom touch the browser, and they are SSR-safe no-ops
 *    on the server, matching lib/lessons/progress.ts.
 *  · Card keys are `${lessonSlug}:${questionId}`. Question ids are only unique
 *    WITHIN a lesson (`q1`, `q2`, …), so the slug is load-bearing, not
 *    decoration.
 *  · The algorithm is deliberately smaller than full SM-2: a binary
 *    right/wrong grade instead of a 0–5 quality scale, because the quiz UI is
 *    multiple-choice and inventing a self-assessed quality slider would be
 *    asking the learner to grade their own homework.
 */

export interface CardState {
  /** SM-2 ease factor; the multiplier applied to the interval on success. */
  ease: number
  /** Current inter-review interval in whole days. 0 = relearning. */
  intervalDays: number
  /** ISO-8601 instant this card next comes due. */
  due: string
  /** Consecutive successful reviews since the last failure (or ever). */
  streak: number
}

export interface ReviewSchedule {
  cards: Record<string, CardState>
}

/** The single localStorage key the whole review system uses. */
export const REVIEW_KEY = 'quantum-lab.review'

export const EASE_START = 2.5
export const EASE_MIN = 1.3
export const EASE_MAX = 2.8
const EASE_GAIN = 0.05
const EASE_LOSS = 0.2
/** First and second successful intervals, in days (then interval × ease). */
const FIRST_INTERVAL_DAYS = 1
const SECOND_INTERVAL_DAYS = 3
/** A failed card comes back within the same sitting, not tomorrow. */
const RELEARN_MINUTES = 10

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export function cardKey(lessonSlug: string, questionId: string): string {
  return `${lessonSlug}:${questionId}`
}

export function emptySchedule(): ReviewSchedule {
  return { cards: {} }
}

/** A brand-new card: due immediately, never reviewed. */
export function newCard(now: Date): CardState {
  return { ease: EASE_START, intervalDays: 0, due: now.toISOString(), streak: 0 }
}

/**
 * Grade one card. Success grows the interval (1d → 3d → interval × ease) and
 * nudges ease up; failure resets the card to relearning — due again in ten
 * minutes — and drops ease, floored at EASE_MIN so a hard card slows down but
 * never stops moving.
 */
export function gradeCard(
  prev: CardState | undefined,
  correct: boolean,
  now: Date,
): CardState {
  const card = prev ?? newCard(now)

  if (!correct) {
    return {
      ease: Math.max(EASE_MIN, card.ease - EASE_LOSS),
      intervalDays: 0,
      due: new Date(now.getTime() + RELEARN_MINUTES * MINUTE_MS).toISOString(),
      streak: 0,
    }
  }

  const intervalDays =
    card.intervalDays === 0
      ? FIRST_INTERVAL_DAYS
      : card.intervalDays === FIRST_INTERVAL_DAYS
        ? SECOND_INTERVAL_DAYS
        : Math.round(card.intervalDays * card.ease)

  return {
    ease: Math.min(EASE_MAX, card.ease + EASE_GAIN),
    intervalDays,
    due: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    streak: card.streak + 1,
  }
}

/** Immutable helper: the schedule with one card graded. */
export function gradeInSchedule(
  schedule: ReviewSchedule,
  key: string,
  correct: boolean,
  now: Date,
): ReviewSchedule {
  return {
    cards: { ...schedule.cards, [key]: gradeCard(schedule.cards[key], correct, now) },
  }
}

/**
 * The keys due at `now`, from most-overdue first; ties broken by key so the
 * order is a pure function of (schedule, keys, now). Only keys that exist in
 * BOTH the schedule and `keys` qualify: a card whose question was removed from
 * the course silently drops out rather than becoming an unanswerable prompt.
 */
export function dueKeys(schedule: ReviewSchedule, keys: string[], now: Date): string[] {
  const nowMs = now.getTime()
  return keys
    .filter((key) => {
      const card = schedule.cards[key]
      if (!card) return false
      const dueMs = Date.parse(card.due)
      return Number.isFinite(dueMs) && dueMs <= nowMs
    })
    .sort((a, b) => {
      const byDue = Date.parse(schedule.cards[a]!.due) - Date.parse(schedule.cards[b]!.due)
      return byDue !== 0 ? byDue : a < b ? -1 : a > b ? 1 : 0
    })
}

/**
 * Seed the queue from lesson quizzes already taken. `quizScores` is the
 * per-lesson score map that components/lesson/Quiz already writes (via
 * lib/lessons/progress) — read here, never written: a lesson slug appearing in
 * it is the evidence the learner met that lesson's questions, so each of those
 * questions gets a card, due now. Idempotent: existing cards are never
 * touched, and when nothing needs adding the same schedule object comes back.
 */
export function seedFromQuizScores(
  schedule: ReviewSchedule,
  quizScores: Record<string, number>,
  questionIdsByLesson: Record<string, string[]>,
  now: Date,
): ReviewSchedule {
  let added: Record<string, CardState> | null = null
  for (const slug of Object.keys(quizScores).sort()) {
    const ids = questionIdsByLesson[slug]
    if (!ids) continue
    for (const id of ids) {
      const key = cardKey(slug, id)
      if (schedule.cards[key] !== undefined) continue
      if (added === null) added = {}
      added[key] = newCard(now)
    }
  }
  if (added === null) return schedule
  return { cards: { ...schedule.cards, ...added } }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Storage. Same contract as lib/lessons/progress.ts: SSR-safe, never throws,
 * corrupt JSON reads as empty.
 * ──────────────────────────────────────────────────────────────────────────── */

function isCardState(value: unknown): value is CardState {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.ease === 'number' &&
    Number.isFinite(c.ease) &&
    typeof c.intervalDays === 'number' &&
    Number.isFinite(c.intervalDays) &&
    typeof c.due === 'string' &&
    Number.isFinite(Date.parse(c.due)) &&
    typeof c.streak === 'number' &&
    Number.isFinite(c.streak)
  )
}

/**
 * Coerce unknown parsed JSON into a schedule, dropping malformed cards one by
 * one rather than discarding the lot — a single hand-edited entry should not
 * erase months of review history.
 */
export function normalizeSchedule(raw: unknown): ReviewSchedule {
  if (typeof raw !== 'object' || raw === null) return emptySchedule()
  const cards = (raw as Record<string, unknown>).cards
  if (typeof cards !== 'object' || cards === null || Array.isArray(cards)) {
    return emptySchedule()
  }
  const out: Record<string, CardState> = {}
  for (const [key, value] of Object.entries(cards)) {
    if (isCardState(value)) {
      out[key] = {
        ease: value.ease,
        intervalDays: value.intervalDays,
        due: value.due,
        streak: value.streak,
      }
    }
  }
  return { cards: out }
}

export function loadSchedule(): ReviewSchedule {
  if (typeof window === 'undefined') return emptySchedule()
  try {
    const raw = window.localStorage.getItem(REVIEW_KEY)
    if (!raw) return emptySchedule()
    return normalizeSchedule(JSON.parse(raw) as unknown)
  } catch {
    return emptySchedule()
  }
}

export function saveSchedule(schedule: ReviewSchedule): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(schedule))
  } catch {
    // Quota or disabled storage — the in-memory schedule still serves this
    // session; carry on, exactly as lib/lessons/progress.ts does.
  }
}
