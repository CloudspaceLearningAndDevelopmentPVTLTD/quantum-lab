/**
 * onboarding/state.ts — localStorage-backed first-run state.
 *
 * Mirrors the contract of `lib/lessons/progress.ts`: every function is
 * SSR-safe and never throws. During server rendering `window` is undefined,
 * so reads return a fresh empty state and writes are no-ops. Corrupt or
 * hand-edited JSON is treated exactly like no data at all.
 *
 * Because of that, components must render the empty/hidden state first and
 * read real onboarding state in a `useEffect` after mount — otherwise the
 * server and client markup disagree and React reports a hydration mismatch.
 */

const KEY = 'quantum-lab.onboarding'

export type OnboardingPath = 'curious' | 'student' | 'developer'

export interface OnboardingState {
  /** The user has begun the flow at all (landed on /welcome, picked a path…). */
  seen: boolean
  completedSteps: string[]
  path: OnboardingPath | null
  /** ISO timestamp of an explicit dismissal. Absent means never dismissed. */
  dismissedAt?: string
  firstCircuitRun: boolean
}

/**
 * The step id recorded when the flow is finished end-to-end. Kept here rather
 * than in steps.ts so the storage layer never has to import step data.
 */
export const ONBOARDING_DONE_STEP = 'onboarding-complete'

/** The id recorded when the guided Bell-state build has been run. */
export const FIRST_CIRCUIT_STEP = 'first-circuit'

function emptyState(): OnboardingState {
  return { seen: false, completedSteps: [], path: null, firstCircuitRun: false }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isPath(value: unknown): value is OnboardingPath {
  return value === 'curious' || value === 'student' || value === 'developer'
}

/**
 * Coerce unknown parsed JSON into an OnboardingState, dropping anything
 * malformed. `unknown` (not `any`) so every field access has to be guarded.
 */
function normalize(raw: unknown): OnboardingState {
  if (typeof raw !== 'object' || raw === null) return emptyState()
  const record = raw as Record<string, unknown>

  const base: OnboardingState = {
    seen: record.seen === true,
    completedSteps: isStringArray(record.completedSteps) ? record.completedSteps : [],
    path: isPath(record.path) ? record.path : null,
    firstCircuitRun: record.firstCircuitRun === true,
  }

  return typeof record.dismissedAt === 'string'
    ? { ...base, dismissedAt: record.dismissedAt }
    : base
}

export function loadOnboarding(): OnboardingState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return emptyState()
    return normalize(JSON.parse(raw) as unknown)
  } catch {
    return emptyState()
  }
}

function save(state: OnboardingState): OnboardingState {
  if (typeof window === 'undefined') return state
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Quota exceeded, private browsing, storage disabled — the in-memory value
    // is still correct for this session, so carry on rather than blowing up
    // the one screen whose job is to be welcoming.
  }
  return state
}

/** Record that the user has actually started the flow. */
export function markSeen(): OnboardingState {
  const current = loadOnboarding()
  if (current.seen) return current
  return save({ ...current, seen: true })
}

export function markStepComplete(id: string): OnboardingState {
  const current = loadOnboarding()
  if (current.completedSteps.includes(id)) {
    return current.seen ? current : save({ ...current, seen: true })
  }
  return save({ ...current, seen: true, completedSteps: [...current.completedSteps, id] })
}

export function setPath(path: OnboardingPath): OnboardingState {
  return save({ ...loadOnboarding(), seen: true, path })
}

/** Record that the guided first circuit was built and run. */
export function markFirstCircuitRun(): OnboardingState {
  const current = loadOnboarding()
  const withStep = current.completedSteps.includes(FIRST_CIRCUIT_STEP)
    ? current.completedSteps
    : [...current.completedSteps, FIRST_CIRCUIT_STEP]
  return save({ ...current, seen: true, firstCircuitRun: true, completedSteps: withStep })
}

/**
 * Permanent opt-out. Stored as a timestamp rather than a boolean so a later
 * version can tell "dismissed last year" from "dismissed a minute ago" — but
 * nothing here ever un-dismisses on its own. Escaping onboarding has to stick.
 */
export function dismissOnboarding(): OnboardingState {
  return save({ ...loadOnboarding(), seen: true, dismissedAt: new Date().toISOString() })
}

export function resetOnboarding(): OnboardingState {
  const fresh = emptyState()
  if (typeof window === 'undefined') return fresh
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing sensible to do — the caller still gets an empty state back.
  }
  return fresh
}

/** True until the user has interacted with onboarding in any way. */
export function isFirstVisit(): boolean {
  return !loadOnboarding().seen
}

/** Finished = ran the guided circuit AND reached the end of the flow. */
export function isOnboardingComplete(state: OnboardingState = loadOnboarding()): boolean {
  return state.completedSteps.includes(ONBOARDING_DONE_STEP)
}
