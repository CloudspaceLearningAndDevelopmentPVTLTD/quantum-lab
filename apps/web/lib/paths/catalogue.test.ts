/**
 * catalogue.test.ts — a path may only point at things that exist, and its
 * progress must be read from the stores those things already keep.
 */

import { describe, expect, it } from 'vitest'

import { allSteps, getPath, PATHS, stepKey } from './catalogue'
import { isStepDone, pathProgress, resolveStep, type CompletionSources } from './resolve'

const NONE: CompletionSources = { completedLessons: [], solvedChallenges: [], ticked: [] }

describe('learning paths catalogue', () => {
  it('has unique slugs', () => {
    const slugs = PATHS.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it.each(PATHS.map((p) => [p.slug, p] as const))('%s: every step resolves', (_slug, path) => {
    for (const step of allSteps(path)) {
      expect(resolveStep(step), `${stepKey(step)} does not resolve`).not.toBeNull()
    }
  })

  it.each(PATHS.map((p) => [p.slug, p] as const))('%s: no step repeats within the path', (_slug, path) => {
    const keys = allSteps(path).map(stepKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(PATHS.map((p) => [p.slug, p] as const))('%s: is fully described', (_slug, path) => {
    expect(path.milestones.length).toBeGreaterThanOrEqual(3)
    expect(path.outcomes.length).toBeGreaterThanOrEqual(3)
    expect(path.beyond.length).toBeGreaterThanOrEqual(1)
    for (const milestone of path.milestones) {
      expect(milestone.steps.length).toBeGreaterThanOrEqual(2)
      for (const step of milestone.steps) expect(step.why.length).toBeGreaterThan(10)
    }
  })

  it('page steps link to internal routes', () => {
    for (const path of PATHS) {
      for (const step of allSteps(path)) {
        if (step.kind === 'page') expect(step.ref).toMatch(/^\/[a-z]/)
      }
    }
  })

  it('getPath finds by slug and rejects unknown slugs', () => {
    expect(getPath('quantum-software-engineer')?.title).toBe('Quantum software engineer')
    expect(getPath('nope')).toBeUndefined()
  })
})

describe('path progress', () => {
  const path = getPath('quantum-software-engineer')!

  it('starts at the first step with nothing done', () => {
    const progress = pathProgress(path, NONE)
    expect(progress.done).toBe(0)
    expect(progress.total).toBe(allSteps(path).length)
    expect(progress.next).toEqual(allSteps(path)[0])
  })

  it('reads lessons from lesson progress and challenges from the grader', () => {
    const sources: CompletionSources = {
      completedLessons: ['what-is-a-qubit'],
      solvedChallenges: ['flip-it'],
      ticked: [],
    }
    expect(isStepDone({ kind: 'lesson', ref: 'what-is-a-qubit' }, sources)).toBe(true)
    expect(isStepDone({ kind: 'challenge', ref: 'flip-it' }, sources)).toBe(true)
    // A manual tick must NOT complete a lesson: only the lesson page can.
    expect(
      isStepDone({ kind: 'lesson', ref: 'gates-and-circuits' }, { ...NONE, ticked: ['lesson:gates-and-circuits'] }),
    ).toBe(false)
  })

  it('uses manual ticks for things the site cannot observe', () => {
    const step = { kind: 'visualization', ref: '/visualizations/bloch-sphere', why: '' } as const
    expect(isStepDone(step, NONE)).toBe(false)
    expect(isStepDone(step, { ...NONE, ticked: [stepKey(step)] })).toBe(true)
  })

  it('points at the first undone step, skipping done ones', () => {
    const sources: CompletionSources = {
      completedLessons: ['what-is-a-qubit', 'gates-and-circuits'],
      solvedChallenges: ['flip-it'],
      ticked: [],
    }
    const progress = pathProgress(path, sources)
    expect(progress.done).toBe(3)
    expect(progress.next).toMatchObject({ kind: 'challenge', ref: 'fair-coin' })
  })

  it('has no next step once everything is done', () => {
    const steps = allSteps(path)
    const sources: CompletionSources = {
      completedLessons: steps.filter((s) => s.kind === 'lesson').map((s) => s.ref),
      solvedChallenges: steps.filter((s) => s.kind === 'challenge').map((s) => s.ref),
      ticked: steps.map(stepKey),
    }
    const progress = pathProgress(path, sources)
    expect(progress.done).toBe(progress.total)
    expect(progress.next).toBeUndefined()
  })
})
