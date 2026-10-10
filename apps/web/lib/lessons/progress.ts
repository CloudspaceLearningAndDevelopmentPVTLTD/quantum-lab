/**
 * localStorage-backed course progress.
 *
 * Every function here is SSR-safe and never throws: during server rendering
 * `window` is undefined, so reads return an empty Progress and writes are
 * no-ops. Corrupt or hand-edited JSON is treated the same as no data at all.
 *
 * Components must therefore render the empty state first and load real
 * progress in a useEffect after mount, or the server and client markup will
 * disagree and React will report a hydration mismatch.
 */

const KEY = 'quantum-lab.progress'

export interface Progress {
  completed: string[]
  quizScores: Record<string, number>
  lastVisited?: string
}

function emptyProgress(): Progress {
  return { completed: [], quizScores: {} }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isScoreMap(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
}

/**
 * Coerce unknown parsed JSON into a Progress, dropping anything malformed.
 * `unknown` (not `any`) so every field access has to be guarded.
 */
function normalize(raw: unknown): Progress {
  if (typeof raw !== 'object' || raw === null) return emptyProgress()
  const record = raw as Record<string, unknown>

  const completed = isStringArray(record.completed) ? record.completed : []
  const quizScores = isScoreMap(record.quizScores) ? record.quizScores : {}
  const lastVisited =
    typeof record.lastVisited === 'string' ? record.lastVisited : undefined

  return lastVisited !== undefined
    ? { completed, quizScores, lastVisited }
    : { completed, quizScores }
}

export function loadProgress(): Progress {
  if (typeof window === 'undefined') return emptyProgress()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return emptyProgress()
    return normalize(JSON.parse(raw) as unknown)
  } catch {
    return emptyProgress()
  }
}

/**
 * Called after every local write. lib/lessons/progressSync.ts registers here
 * once a user is signed in, so progress follows the account; with nobody
 * signed in (or no backend) nothing is registered and this stays local-only.
 * A hook rather than an import keeps this module free of the network.
 */
let onSaved: ((progress: Progress) => void) | null = null
export function setProgressSaveHook(hook: ((progress: Progress) => void) | null): void {
  onSaved = hook
}

/** Write without notifying the hook — for the sync merging remote progress in. */
export function writeProgressLocally(progress: Progress): Progress {
  if (typeof window === 'undefined') return progress
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // Quota exceeded, private-browsing restrictions, disabled storage — the
    // in-memory value is still correct for this session, so carry on.
  }
  return progress
}

function saveProgress(progress: Progress): Progress {
  writeProgressLocally(progress)
  onSaved?.(progress)
  return progress
}

/** Coerce anything (e.g. a JSON column) into a valid Progress. */
export function normalizeProgress(raw: unknown): Progress {
  return normalize(raw)
}

export function markComplete(slug: string): Progress {
  const current = loadProgress()
  if (current.completed.includes(slug)) return current
  return saveProgress({ ...current, completed: [...current.completed, slug] })
}

export function recordQuizScore(slug: string, score: number): Progress {
  const current = loadProgress()
  return saveProgress({
    ...current,
    quizScores: { ...current.quizScores, [slug]: score },
  })
}

export function setLastVisited(slug: string): Progress {
  const current = loadProgress()
  return saveProgress({ ...current, lastVisited: slug })
}

export function resetProgress(): Progress {
  const fresh = emptyProgress()
  if (typeof window === 'undefined') return fresh
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing sensible to do — the caller still gets an empty Progress back.
  }
  return fresh
}

export function isComplete(slug: string): boolean {
  return loadProgress().completed.includes(slug)
}

/** Fraction of `slugs` that are marked complete, clamped to 0..1. */
export function completionRatio(slugs: string[]): number {
  if (slugs.length === 0) return 0
  const { completed } = loadProgress()
  const done = slugs.filter((slug) => completed.includes(slug)).length
  return Math.min(1, Math.max(0, done / slugs.length))
}
