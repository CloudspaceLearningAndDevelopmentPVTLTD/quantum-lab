'use client'

/**
 * PracticeMore.tsx — "Practice more like this", mounted under the workbench.
 *
 * Sits BELOW ChallengeWorkbench rather than inside its result card because
 * that component is owned elsewhere; this file plus the page that mounts it is
 * the whole footprint of the feature on the app router side. Everything
 * interesting — building the puzzle, verifying it solvable — lives in
 * lib/challenges/generate.ts, which is pure and seeded. The ONLY unseeded
 * randomness in the feature is here, where it belongs: picking a fresh seed
 * when the learner clicks the button. From that click on, everything is
 * deterministic, and the seed is shown so a puzzle can be talked about
 * ("seed 91231 is a nasty one") and regenerated bit-for-bit.
 *
 * The generated challenge renders in the same ChallengeWorkbench the
 * catalogue uses, so grading, hints, progress storage and reset behave
 * identically. Generated ids embed kind/difficulty/seed, so localStorage
 * progress entries for them are stable across visits too.
 */

import { useMemo, useState } from 'react'
import ChallengeWorkbench from '@/components/challenge/ChallengeWorkbench'
import {
  generateChallenge,
  nextSeed,
  type Difficulty,
  type GeneratedChallenge,
  type GeneratedKind,
} from '@/lib/challenges/generate'
import type { Challenge } from '@/lib/challenges/types'

/**
 * Map a catalogue kind onto the nearest kind the generator supports. Gate golf
 * is a target-state with a scoring twist, and oracles need phase grading the
 * generator does not attempt — a target-state drill is the honest fallback.
 */
function siblingKind(kind: Challenge['kind']): GeneratedKind {
  switch (kind) {
    case 'target-distribution':
      return 'target-distribution'
    case 'fix-the-bug':
      return 'fix-the-bug'
    default:
      return 'target-state'
  }
}

function siblingDifficulty(level: Challenge['level']): Difficulty {
  switch (level) {
    case 'Beginner':
      return 1
    case 'Intermediate':
      return 2
    default:
      return 3
  }
}

export default function PracticeMore({ challenge }: { challenge: Challenge }) {
  const [seed, setSeed] = useState<number | null>(null)

  const kind = siblingKind(challenge.kind)
  const difficulty = siblingDifficulty(challenge.level)

  const generated: GeneratedChallenge | null = useMemo(() => {
    if (seed === null) return null
    try {
      return generateChallenge(kind, difficulty, seed)
    } catch {
      // The generator throws only when every derived attempt fails
      // verification, which its test suite makes vanishingly unlikely — but a
      // broken button is worse than a hidden one.
      return null
    }
  }, [kind, difficulty, seed])

  return (
    <section className="mt-6 space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <span className="section-label">Practice more like this</span>
          <p className="mt-2 max-w-2xl text-[13px] text-ink-secondary">
            Generate a fresh {kind.replace(/-/g, ' ')} drill at this difficulty. Every generated
            puzzle is verified solvable by execution before you see it — the generator runs its own
            solution through the same simulator and grader that will judge yours.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            setSeed((current) =>
              current === null
                ? // First click: a fresh seed. This is the one deliberately
                  // unseeded draw in the feature; see the header comment.
                  Math.floor(Math.random() * 0xffffffff)
                : nextSeed(current)
            )
          }
        >
          {generated ? 'Another one' : 'Practice more like this'}
        </button>
      </div>

      {seed !== null && generated === null ? (
        <p className="text-xs text-ink-muted">
          Could not generate a verified puzzle just now — try again.
        </p>
      ) : null}

      {generated ? (
        <div className="space-y-3">
          <p className="font-mono text-xs text-ink-muted">
            generated drill · seed {generated.seed} · same seed, same puzzle
          </p>
          {/* Keyed by id so the workbench fully resets between generations. */}
          <ChallengeWorkbench key={generated.id} challenge={generated} />
        </div>
      ) : null}
    </section>
  )
}
