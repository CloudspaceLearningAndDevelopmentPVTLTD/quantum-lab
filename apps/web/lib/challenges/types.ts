/**
 * types.ts — the data model for the Challenge Generator.
 *
 * A challenge is a goal state (or distribution) plus enough metadata to grade a
 * learner's circuit LOCALLY and DETERMINISTICALLY. Nothing here touches the
 * network: grading runs the learner's circuit through `lib/quantum.ts` and
 * compares numbers. An LLM may decorate the result with prose, never decide it.
 */

import type { Circuit } from '@/lib/quantum'

export type ChallengeKind =
  | 'target-state'
  | 'target-distribution'
  | 'gate-golf'
  | 'fix-the-bug'
  | 'oracle'

export interface Challenge {
  id: string
  title: string
  brief: string
  kind: ChallengeKind
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  numQubits: number
  lessonSlug: string
  /**
   * The circuit the workbench opens with. Always the broken circuit for
   * fix-the-bug; also used by challenges that hand the learner a fixed piece of
   * apparatus they are meant to build around rather than re-derive — an oracle,
   * a state preparation, or a rotation whose angle the θ slider cannot express
   * (it steps in π/16, see the note at the top of catalogue.ts).
   */
  startingCircuit?: Circuit
  /** target-state: the probability each basis state must have. */
  targetProbabilities?: number[]
  /** target-distribution: allowed tolerance per basis state. */
  tolerance?: number
  /** gate-golf: the maximum gate count that counts as a full pass. */
  maxGates?: number
  /**
   * oracle: the required SIGN (+1 or -1) of each basis amplitude, measured
   * relative to the first non-zero amplitude.
   *
   * An oracle is invisible in the probability distribution — it only rewrites
   * phases — so probabilities alone cannot grade one. This is the only extra
   * field the oracle kind needs, and it is relative by construction so that a
   * global phase never changes the verdict.
   */
  targetSigns?: number[]
  /** Ordered hints, revealed one at a time. */
  hints: string[]
  successNote: string
}

export interface GradeCheck {
  label: string
  passed: boolean
  detail: string
}

export interface Grade {
  passed: boolean
  score: number
  checks: GradeCheck[]
  summary: string
  gateCount: number
  parCount?: number
}

// ────────────────────────────────────────────────────────────
// Per-learner progress
//
// Lives here (rather than in its own module) because both the client page and
// the workbench need it and the file set for this feature is fixed. It is pure
// browser storage — no React, safe to import from a server component too, as
// long as nothing calls it during render.
// ────────────────────────────────────────────────────────────

export const CHALLENGE_STORAGE_KEY = 'quantum-lab.challenges'

export interface ChallengeProgress {
  solved: boolean
  /** Fewest gates the learner has ever passed this challenge with. */
  bestGates?: number
  hintsUsed: number
}

export type ProgressMap = Record<string, ChallengeProgress>

function isProgress(value: unknown): value is ChallengeProgress {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.solved === 'boolean' && typeof v.hintsUsed === 'number'
}

/** Read saved progress. SSR-safe and defensive: bad JSON yields an empty map. */
export function readProgress(): ProgressMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CHALLENGE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: ProgressMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isProgress(value)) out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Merge one challenge's progress into storage. Never throws. */
export function writeProgress(id: string, entry: ChallengeProgress): void {
  if (typeof window === 'undefined') return
  try {
    const all = readProgress()
    all[id] = entry
    window.localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Private browsing / quota exceeded. Progress is a nicety, not the product.
  }
}
