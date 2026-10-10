/**
 * journey.ts — the derivation that replaced a resume pointer that never moved.
 *
 * The bug this file guards against is specific and was live: `nextStep()` was
 * fed `completedSteps`, and no path step id was ever written into that list, so
 * the resume banner pointed at step 1 forever. The first test below fails if
 * that regresses — a learner with real, recorded work behind them must not be
 * offered step 1 again.
 *
 * The step data is imported from the real `PATHS`, not from a fixture, so a
 * step whose href moves to a route with no signal is caught here.
 */

import { describe, expect, it } from 'vitest'

import {
  EMPTY_EVIDENCE,
  collectEvidence,
  hasEvidence,
  journeyProgress,
  stepStatus,
} from '@/lib/analytics/journey'
import type { AnalyticsEvent, EventName } from '@/lib/analytics/events'
import type { ProgressMap } from '@/lib/challenges/types'
import type { Progress } from '@/lib/lessons/progress'
import { PATHS } from '@/lib/onboarding/steps'

function ev(
  name: EventName,
  props: Record<string, string | number | boolean> = {}
): AnalyticsEvent {
  return { name, at: new Date(2026, 2, 5, 12).toISOString(), props, sessionId: 's1' }
}

const NO_PROGRESS: Progress = { completed: [], quizScores: {} }
const NO_CHALLENGES: ProgressMap = {}

describe('collectEvidence', () => {
  it('unions lesson completions from the course store and the event buffer', () => {
    const evidence = collectEvidence(
      [ev('lesson.completed', { slug: 'interference' })],
      { completed: ['what-is-a-qubit'], quizScores: {} },
      NO_CHALLENGES
    )
    expect([...evidence.lessonsCompleted].sort()).toEqual(['interference', 'what-is-a-qubit'])
  })

  it('survives an emptied event buffer, because opting out deletes it', () => {
    // Turning analytics off wipes `quantum-lab.events`. Course progress lives
    // in a different key and must keep driving the journey — otherwise opting
    // out of measurement would silently erase visible progress, which is a
    // penalty for exercising a privacy control.
    const evidence = collectEvidence([], { completed: ['interference'], quizScores: {} }, {})
    expect(evidence.lessonsCompleted.has('interference')).toBe(true)
    expect(evidence.circuitRuns).toBe(0)
  })

  it('reads visualizations from both opened and interacted', () => {
    const evidence = collectEvidence(
      [ev('viz.opened', { slug: 'grover' }), ev('viz.interacted', { slug: 'qft' })],
      NO_PROGRESS,
      NO_CHALLENGES
    )
    expect([...evidence.vizOpened].sort()).toEqual(['grover', 'qft'])
  })

  it('counts runs and hardware submissions, and only solved challenges', () => {
    const evidence = collectEvidence(
      [ev('circuit.run'), ev('circuit.run'), ev('hardware.submitted')],
      NO_PROGRESS,
      {
        'flip-it': { solved: true, hintsUsed: 0 },
        'bell-pair': { solved: false, hintsUsed: 2 },
      }
    )
    expect(evidence.circuitRuns).toBe(2)
    expect(evidence.hardwareSubmissions).toBe(1)
    expect([...evidence.challengesSolved]).toEqual(['flip-it'])
  })

  it('ignores non-string slugs rather than stringifying them', () => {
    const evidence = collectEvidence([ev('viz.opened', { slug: 42 })], NO_PROGRESS, {})
    expect(evidence.vizOpened.size).toBe(0)
  })
})

describe('hasEvidence', () => {
  const step = (path: keyof typeof PATHS, index: number) => PATHS[path].steps[index]

  it('matches a lesson step by its slug', () => {
    const lesson = PATHS.student.steps[0] // /learn/what-is-a-qubit
    expect(hasEvidence(lesson, EMPTY_EVIDENCE)).toBe(false)
    expect(
      hasEvidence(lesson, { ...EMPTY_EVIDENCE, lessonsCompleted: new Set(['what-is-a-qubit']) })
    ).toBe(true)
    // A different lesson is not this lesson.
    expect(
      hasEvidence(lesson, { ...EMPTY_EVIDENCE, lessonsCompleted: new Set(['interference']) })
    ).toBe(false)
  })

  it('matches a visualization step by its slug', () => {
    const viz = PATHS.curious.steps[0] // /visualizations/double-slit
    expect(
      hasEvidence(viz, { ...EMPTY_EVIDENCE, vizOpened: new Set(['double-slit']) })
    ).toBe(true)
    expect(hasEvidence(viz, { ...EMPTY_EVIDENCE, vizOpened: new Set(['grover']) })).toBe(false)
  })

  it('matches a specific challenge, and the index page by any solve', () => {
    const specific = step('student', 5) // /challenges/flip-it
    const index = step('developer', 2) // /challenges
    const solvedOther = { ...EMPTY_EVIDENCE, challengesSolved: new Set(['ghz']) }

    expect(hasEvidence(specific, solvedOther)).toBe(false)
    expect(hasEvidence(index, solvedOther)).toBe(true)
    expect(
      hasEvidence(specific, { ...EMPTY_EVIDENCE, challengesSolved: new Set(['flip-it']) })
    ).toBe(true)
  })

  it('matches simulator and hardware steps by their own signals', () => {
    const sim = step('developer', 0)
    const hw = step('developer', 3)
    expect(hasEvidence(sim, { ...EMPTY_EVIDENCE, circuitRuns: 1 })).toBe(true)
    // A circuit run is not a hardware submission. Hardware costs real money;
    // claiming it happened because a simulation did would be a plain lie.
    expect(hasEvidence(hw, { ...EMPTY_EVIDENCE, circuitRuns: 99 })).toBe(false)
    expect(hasEvidence(hw, { ...EMPTY_EVIDENCE, hardwareSubmissions: 1 })).toBe(true)
  })

  it('every step in every path points at a route this module can read', () => {
    // A step whose href moves somewhere with no signal would be permanently
    // un-completable and would freeze the resume pointer — the exact failure
    // this module exists to fix. `all` is the evidence of someone who has done
    // absolutely everything; every step must register as done.
    const all = {
      lessonsCompleted: new Set<string>(),
      vizOpened: new Set<string>(),
      challengesSolved: new Set<string>(),
      circuitRuns: 1,
      hardwareSubmissions: 1,
    }
    for (const path of Object.values(PATHS)) {
      for (const s of path.steps) {
        const [root, child] = s.href.split('/').filter(Boolean)
        if (root === 'learn' && child) all.lessonsCompleted.add(child)
        if (root === 'visualizations' && child) all.vizOpened.add(child)
        if (root === 'challenges' && child) all.challengesSolved.add(child)
      }
    }
    for (const [name, path] of Object.entries(PATHS)) {
      for (const s of path.steps) {
        expect(hasEvidence(s, all), `${name}: ${s.id} (${s.href}) has no readable signal`).toBe(
          true
        )
      }
    }
  })
})

describe('stepStatus', () => {
  const lesson = PATHS.student.steps[0]

  it('prefers evidence over a recorded visit', () => {
    const done = { ...EMPTY_EVIDENCE, lessonsCompleted: new Set(['what-is-a-qubit']) }
    expect(stepStatus(lesson, done, [lesson.id])).toBe('done')
  })

  it('reports a click-through as visited, never as done', () => {
    expect(stepStatus(lesson, EMPTY_EVIDENCE, [lesson.id])).toBe('visited')
    expect(stepStatus(lesson, EMPTY_EVIDENCE, [])).toBe('todo')
  })
})

describe('journeyProgress', () => {
  it('advances past work already done instead of re-offering step 1', () => {
    // THE regression this file exists for. A student who has finished the
    // first two lessons must be pointed at the third.
    const evidence = collectEvidence(
      [],
      { completed: ['what-is-a-qubit', 'superposition-and-measurement'], quizScores: {} },
      NO_CHALLENGES
    )
    const progress = journeyProgress('student', evidence, [])

    expect(progress.completed).toBe(2)
    expect(progress.total).toBe(PATHS.student.steps.length)
    expect(progress.next?.id).toBe('student/interference')
    expect(progress.allDone).toBe(false)
  })

  it('skips a step that was visited but not finished, without counting it', () => {
    const progress = journeyProgress('student', EMPTY_EVIDENCE, ['student/what-is-a-qubit'])
    expect(progress.next?.id).toBe('student/superposition-and-measurement')
    // Opening a lesson is not finishing it, and the counter must not say it is.
    expect(progress.completed).toBe(0)
  })

  it('falls back to the first visited step when nothing is left untouched', () => {
    const visited = PATHS.curious.steps.map((s) => s.id)
    const progress = journeyProgress('curious', EMPTY_EVIDENCE, visited)
    expect(progress.next?.id).toBe(PATHS.curious.steps[0].id)
    expect(progress.allDone).toBe(false)
  })

  it('has no next step once every step has evidence', () => {
    const evidence = {
      ...EMPTY_EVIDENCE,
      vizOpened: new Set(['double-slit', 'bloch-sphere']),
      lessonsCompleted: new Set(['what-is-a-qubit']),
    }
    const progress = journeyProgress('curious', evidence, [])
    expect(progress.completed).toBe(3)
    expect(progress.allDone).toBe(true)
    expect(progress.next).toBeNull()
  })

  it('is empty and inert with no path chosen', () => {
    expect(journeyProgress(null, EMPTY_EVIDENCE, [])).toEqual({
      steps: [],
      completed: 0,
      total: 0,
      next: null,
      allDone: false,
    })
  })
})
