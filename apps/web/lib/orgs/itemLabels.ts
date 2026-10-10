/**
 * orgs/itemLabels.ts — turning an assignment item into something a person reads.
 *
 * Kept out of lib/orgs/assignments.ts on purpose: that module must stay free of
 * the catalogues so it can be imported anywhere, including by a route handler
 * that has no business pulling the challenge catalogue (and lib/quantum with it)
 * into its graph. This module is for the UI, which already has all three.
 *
 * `LESSONS` here is the metadata module, not the bodies. See the header of
 * lib/lessons/index.ts for why that distinction is load-bearing.
 */

import { LESSONS } from '@/lib/lessons'
import { CHALLENGES } from '@/lib/challenges/catalogue'
import { EXAMS } from '@/lib/exams/catalogue'
import type { AssignmentItem, AssignmentItemKind } from '@/lib/orgs/assignments'

export interface CatalogueEntry {
  kind: AssignmentItemKind
  ref: string
  title: string
  /** Level or duration — whatever helps an instructor choose. May be empty. */
  detail: string
  href: string
}

/** Everything assignable in this deployment, grouped for the picker. */
export const CATALOGUE: Record<AssignmentItemKind, CatalogueEntry[]> = {
  lesson: LESSONS.map((lesson) => ({
    kind: 'lesson' as const,
    ref: lesson.slug,
    title: lesson.title,
    detail: `${lesson.level} · ${lesson.minutes} min`,
    href: `/learn/${lesson.slug}`,
  })),
  challenge: CHALLENGES.map((challenge) => ({
    kind: 'challenge' as const,
    ref: challenge.id,
    title: challenge.title,
    detail: `${challenge.level} · ${challenge.numQubits} qubit${challenge.numQubits === 1 ? '' : 's'}`,
    href: `/challenges/${challenge.id}`,
  })),
  exam: EXAMS.map((exam) => ({
    kind: 'exam' as const,
    ref: exam.id,
    title: exam.title,
    detail: `${exam.questionCount} questions · ${exam.timeLimitMinutes} min`,
    href: `/certify/${exam.id}`,
  })),
}

const BY_KEY = new Map<string, CatalogueEntry>(
  Object.values(CATALOGUE)
    .flat()
    .map((entry) => [`${entry.kind}:${entry.ref}`, entry])
)

/**
 * Look one up. Returns a placeholder rather than undefined when an assignment
 * names something this deployment no longer has — a removed lesson must render
 * as "lesson: old-slug (no longer available)", not crash the learner's list.
 */
export function describeItem(item: AssignmentItem): CatalogueEntry {
  const found = BY_KEY.get(`${item.kind}:${item.ref}`)
  if (found) return found
  return {
    kind: item.kind,
    ref: item.ref,
    title: item.ref,
    detail: 'No longer available on this deployment',
    href: '',
  }
}

export const KIND_LABEL: Record<AssignmentItemKind, string> = {
  lesson: 'Lesson',
  challenge: 'Challenge',
  exam: 'Exam',
}
