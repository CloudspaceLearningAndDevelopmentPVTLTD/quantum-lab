/**
 * lib/paths/resolve.ts — turn a path step into something a page can render,
 * and work out which steps this learner has already done.
 *
 * Titles and levels come from each step's OWN catalogue, never from the path,
 * so a path cannot drift from what it links to. `resolveStep` returns null for
 * a reference that does not exist; the test suite asserts it never does.
 *
 * Completion is read from the stores those features already keep:
 *   lesson     → lib/lessons/progress   (marked complete by the lesson page)
 *   challenge  → lib/challenges/types   (solved by the grader)
 *   everything else → this module's own store, ticked by the learner, because
 *   "I have explored this visualization" is not something the site can detect
 *   honestly. Opening a page is not understanding it.
 */

import { CHALLENGES } from '@/lib/challenges/catalogue'
import { readProgress as readChallengeProgress } from '@/lib/challenges/types'
import { LESSONS } from '@/lib/lessons/index'
import { loadProgress } from '@/lib/lessons/progress'
import { VISUALIZATIONS } from '@/lib/visualizations'
import { WORKBENCH } from '@/lib/workbench'
import { allSteps, stepKey, type LearningPath, type PathStep } from './catalogue'

export interface ResolvedStep {
  key: string
  kind: PathStep['kind']
  ref: string
  title: string
  href: string
  why: string
  icon: string
  level?: string
  minutes?: number
  /** True when completion comes from another feature, not a manual tick. */
  autoTracked: boolean
}

const KIND_ICON: Record<PathStep['kind'], string> = {
  lesson: '📘',
  visualization: '🔭',
  challenge: '🎯',
  workbench: '🛠️',
  page: '🧭',
}

export const STEP_KIND_LABEL: Record<PathStep['kind'], string> = {
  lesson: 'Lesson',
  visualization: 'Visualization',
  challenge: 'Challenge',
  workbench: 'Workbench',
  page: 'Do it',
}

export function resolveStep(step: PathStep): ResolvedStep | null {
  const base = { key: stepKey(step), kind: step.kind, ref: step.ref, why: step.why }
  switch (step.kind) {
    case 'lesson': {
      const lesson = LESSONS.find((l) => l.slug === step.ref)
      if (!lesson) return null
      return {
        ...base,
        title: lesson.title,
        href: `/learn/${lesson.slug}`,
        icon: KIND_ICON.lesson,
        level: lesson.level,
        minutes: lesson.minutes,
        autoTracked: true,
      }
    }
    case 'visualization': {
      const viz = VISUALIZATIONS.find((v) => v.href === step.ref)
      if (!viz) return null
      return { ...base, title: viz.title, href: viz.href, icon: viz.icon, level: viz.level, autoTracked: false }
    }
    case 'challenge': {
      const challenge = CHALLENGES.find((c) => c.id === step.ref)
      if (!challenge) return null
      return {
        ...base,
        title: challenge.title,
        href: `/challenges/${challenge.id}`,
        icon: KIND_ICON.challenge,
        level: challenge.level,
        autoTracked: true,
      }
    }
    case 'workbench': {
      const tool = WORKBENCH.find((t) => t.href === step.ref)
      if (!tool) return null
      return { ...base, title: tool.title, href: tool.href, icon: tool.icon, autoTracked: false }
    }
    case 'page':
      return { ...base, title: step.title, href: step.ref, icon: KIND_ICON.page, autoTracked: false }
  }
}

/** Resolve every step, dropping any that fail (tests guarantee none do). */
export function resolveSteps(steps: PathStep[]): ResolvedStep[] {
  return steps.map(resolveStep).filter((s): s is ResolvedStep => s !== null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual ticks, for steps the site cannot observe being done
// ─────────────────────────────────────────────────────────────────────────────

export const PATHS_STORAGE_KEY = 'quantum-lab.paths'

export interface PathsState {
  /** Step keys the learner ticked themselves. Shared across paths on purpose:
   *  exploring the Bloch sphere counts wherever the Bloch sphere appears. */
  ticked: string[]
  /** The path the learner chose to follow, if any. */
  active?: string
}

function emptyState(): PathsState {
  return { ticked: [] }
}

export function loadPathsState(): PathsState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(PATHS_STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyState()
    const record = parsed as Record<string, unknown>
    const ticked = Array.isArray(record.ticked)
      ? record.ticked.filter((v): v is string => typeof v === 'string')
      : []
    return typeof record.active === 'string' ? { ticked, active: record.active } : { ticked }
  } catch {
    return emptyState()
  }
}

function savePathsState(state: PathsState): PathsState {
  if (typeof window === 'undefined') return state
  try {
    window.localStorage.setItem(PATHS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private browsing or quota: the in-memory state is still right for now.
  }
  return state
}

export function setTicked(key: string, ticked: boolean): PathsState {
  const current = loadPathsState()
  const has = current.ticked.includes(key)
  if (has === ticked) return current
  const next = ticked ? [...current.ticked, key] : current.ticked.filter((k) => k !== key)
  return savePathsState({ ...current, ticked: next })
}

export function setActivePath(slug: string | undefined): PathsState {
  const current = loadPathsState()
  const next: PathsState = { ticked: current.ticked }
  if (slug) next.active = slug
  return savePathsState(next)
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion
// ─────────────────────────────────────────────────────────────────────────────

/** Everything completion depends on, gathered once so it is testable. */
export interface CompletionSources {
  completedLessons: string[]
  solvedChallenges: string[]
  ticked: string[]
}

export function readCompletionSources(): CompletionSources {
  const lessons = loadProgress()
  const challenges = readChallengeProgress()
  return {
    completedLessons: lessons.completed,
    solvedChallenges: Object.entries(challenges)
      .filter(([, p]) => p.solved)
      .map(([id]) => id),
    ticked: loadPathsState().ticked,
  }
}

export function isStepDone(step: Pick<PathStep, 'kind' | 'ref'>, sources: CompletionSources): boolean {
  switch (step.kind) {
    case 'lesson':
      return sources.completedLessons.includes(step.ref)
    case 'challenge':
      return sources.solvedChallenges.includes(step.ref)
    default:
      return sources.ticked.includes(stepKey(step))
  }
}

export interface PathProgress {
  done: number
  total: number
  /** The first step not yet done, in path order; undefined when finished. */
  next?: PathStep
}

export function pathProgress(path: LearningPath, sources: CompletionSources): PathProgress {
  const steps = allSteps(path)
  const done = steps.filter((s) => isStepDone(s, sources)).length
  return { done, total: steps.length, next: steps.find((s) => !isStepDone(s, sources)) }
}
