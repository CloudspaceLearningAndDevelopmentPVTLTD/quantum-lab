/**
 * sessionPlan.test.ts — pins the plan EXACTLY.
 *
 * The plan is sent off-device (to the tutor endpoint, when the learner allows
 * it), so these tests assert deep equality on whole plans rather than spot
 * properties: any new field, reordered step, or reworded note is a change to
 * what leaves the browser and must show up as a failing diff someone reads.
 */

import { describe, expect, it } from 'vitest'
import type { Progress } from '@/lib/lessons/progress'
import { buildSessionPlan, type SessionPlan } from './sessionPlan'

const EMPTY: Progress = { completed: [], quizScores: {} }

describe('buildSessionPlan', () => {
  it('answers empty progress with the start-here plan', () => {
    const plan = buildSessionPlan(EMPTY, [])

    // recommend() ranks a blank slate to the one zero-prerequisite lesson, so
    // the plan is teach → practice → check on 'what-is-a-qubit', nothing weak.
    const expected: SessionPlan = {
      weakSkills: [],
      nextConcepts: ['what-is-a-qubit'],
      suggestedSession: [
        {
          kind: 'teach',
          ref: { lessonSlug: 'what-is-a-qubit' },
          note: 'Read "What Is a Qubit?" next — every prerequisite for it is met.',
        },
        {
          kind: 'practice',
          // 'flip-it' is the first catalogue challenge for this lesson; the
          // challenge catalogue's own tests pin that entry.
          ref: { lessonSlug: 'what-is-a-qubit', challengeId: 'flip-it' },
          note: 'Apply "What Is a Qubit?" hands-on in this challenge.',
        },
        {
          kind: 'check',
          ref: { lessonSlug: 'what-is-a-qubit' },
          note: 'Finish with the "What Is a Qubit?" quiz to confirm it stuck.',
        },
      ],
    }
    expect(plan).toEqual(expected)
  })

  it('builds a diagnose-first plan around a failed quiz', () => {
    // Two lessons read; the superposition quiz scored 0 of its 3 questions.
    // Rule 1 makes that the revise target; rule 4 offers interference and
    // tunneling (both unlocked by superposition) as the next concepts.
    const progress: Progress = {
      completed: ['what-is-a-qubit', 'superposition-and-measurement'],
      quizScores: { 'superposition-and-measurement': 0 },
    }

    const plan = buildSessionPlan(progress, [])

    const expected: SessionPlan = {
      weakSkills: [
        // Read but never quizzed sits at 0.7 — below the 0.8 mastery bar.
        { id: 'what-is-a-qubit', mastery: 0.7 },
        // Completed with a 0/3 quiz: 0.5 + 0.5·0 = 0.5.
        { id: 'superposition-and-measurement', mastery: 0.5 },
      ],
      nextConcepts: ['interference', 'tunneling'],
      suggestedSession: [
        {
          kind: 'diagnose',
          ref: { lessonSlug: 'superposition-and-measurement' },
          note: 'Retake the "Superposition & Measurement" quiz to pin down the gap — the last score was below the 70% bar.',
        },
        {
          kind: 'teach',
          ref: { lessonSlug: 'interference' },
          note: 'Read "Interference" next — every prerequisite for it is met.',
        },
        {
          kind: 'practice',
          // 'fair-coin' is the first catalogue challenge for superposition.
          ref: { lessonSlug: 'superposition-and-measurement', challengeId: 'fair-coin' },
          note: 'Apply "Superposition & Measurement" hands-on in this challenge.',
        },
        {
          kind: 'check',
          ref: { lessonSlug: 'superposition-and-measurement' },
          note: 'Finish with the "Superposition & Measurement" quiz to confirm it stuck.',
        },
      ],
    }
    expect(plan).toEqual(expected)
  })

  it('is deterministic and stays comfortably under the wire clamp', () => {
    const progress: Progress = {
      completed: ['what-is-a-qubit', 'superposition-and-measurement'],
      quizScores: { 'superposition-and-measurement': 1 },
    }
    const a = buildSessionPlan(progress, [])
    const b = buildSessionPlan(progress, [])
    expect(a).toEqual(b)
    // /api/agent drops learnerContext.plan above 2048 serialised chars; the
    // plan this module builds must never be the thing that trips that clamp.
    expect(JSON.stringify(a).length).toBeLessThanOrEqual(2048)
  })
})
