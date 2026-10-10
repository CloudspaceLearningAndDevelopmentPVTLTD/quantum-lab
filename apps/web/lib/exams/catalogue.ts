/**
 * catalogue.ts — the exam metadata, and ONLY the metadata.
 *
 * This file exists because `questions.ts` had to become server-only and the
 * catalogue did not. `/certify`, `/certify/[examId]`, the sitemap, the search
 * corpus and the coach all need to know that "foundations-cert" is called the
 * Quantum Foundations Certification, is 15 questions in 25 minutes at a 70%
 * pass mark, and is free. None of them needs — or may have — the answers.
 *
 * WHAT IS SAFE HERE: titles, counts, time limits, pass marks, the required
 * feature, and `poolIds`. An id such as 'f17' tells a candidate nothing; the
 * question it names, its correct option and its explanation all live in
 * `questions.ts`, which throws if it is ever pulled into a browser bundle.
 *
 * WHAT MUST NEVER BE ADDED HERE: prompts, options, `correctIds`,
 * `correctNumber`, `tolerance`, `explanation`. `lib/exams/boundary.test.ts`
 * walks the import graph of every client component and fails if a server-only
 * exam module is reachable from one; it cannot see a leak that happens by
 * someone pasting an answer key into this file. Do not.
 */

import type { Exam } from './types'

/**
 * The advanced certification also draws on the harder foundations items — an
 * advanced credential that could not ask about entanglement or interference
 * would not be worth much, and the advanced pool alone is barely larger than
 * the paper.
 *
 * The gate on this list is "does an advanced candidate need this to follow the
 * advanced material?", not "is it difficult?". Global phase (f16) and the
 * Clifford/T distinction (f50) are here because the error-correction lesson
 * assumes both; separability (f52) because entanglement measures do; the Bell
 * state's invariance under H⊗H (f51) because it is the same reflection
 * structure Grover and syndrome extraction reuse. Deliberately excluded: the
 * whole tunnelling block, which is physics the advanced track never builds on,
 * and the arithmetic drill items (f04, f30) that test nothing an advanced
 * candidate has not proved twice over by getting this far.
 */
const ADVANCED_PREREQ_IDS = [
  'f02', 'f09', 'f11', 'f15', 'f16', 'f17', 'f19', 'f24',
  'f39', 'f40', 'f47', 'f50', 'f51', 'f52', 'f55', 'f57',
]

/**
 * The foundations pool: f01…f58, in the order they were written.
 *
 * Spelled out rather than derived from the bank, because deriving it would mean
 * importing the bank, which is the whole thing this file exists to avoid.
 * `questions.test.ts` asserts that these lists and the bank agree in both
 * directions, so an id added to one and not the other fails the suite rather
 * than silently shrinking a paper.
 */
const FOUNDATION_POOL_IDS = Array.from(
  { length: 58 },
  (_unused, i) => `f${String(i + 1).padStart(2, '0')}`
)

/** The advanced pool: a01…a51, same convention (a46…a51 are post-quantum cryptography). */
const ADVANCED_POOL_IDS = Array.from(
  { length: 51 },
  (_unused, i) => `a${String(i + 1).padStart(2, '0')}`
)

/**
 * Lesson count for the foundations subtitle. Hard-coded rather than read from
 * `lib/lessons` so this module stays a leaf: the search corpus and the sitemap
 * both import it, and dragging the lesson bodies in behind it would undo the
 * bundle work in `lib/lessons/access.ts`. `catalogue.test.ts` checks the number
 * against `TRACKS`, so a lesson added to the track fails the suite here.
 */
export const FOUNDATIONS_LESSON_COUNT = 8

export const EXAMS: Exam[] = [
  {
    id: 'foundations-cert',
    title: 'Quantum Foundations Certification',
    subtitle:
      `Fifteen questions from the ${FOUNDATIONS_LESSON_COUNT}-lesson foundations track — qubits, measurement, interference, tunnelling, gates, entanglement and Grover's search. The hardware lesson is taught, not examined.`,
    trackId: 'foundations',
    level: 'Intermediate',
    questionCount: 15,
    passMark: 0.7,
    timeLimitMinutes: 25,
    poolIds: FOUNDATION_POOL_IDS,
  },
  {
    id: 'advanced-cert',
    title: 'Advanced Quantum Computing Certification',
    subtitle:
      'Twenty questions on Shor, error correction, variational methods on NISQ hardware, quantum cryptography, quantum machine learning and the post-quantum migration — plus the foundations they rest on.',
    trackId: 'advanced',
    level: 'Advanced',
    questionCount: 20,
    passMark: 0.75,
    timeLimitMinutes: 40,
    requiresFeature: 'certification',
    poolIds: [...ADVANCED_POOL_IDS, ...ADVANCED_PREREQ_IDS],
  },
]

export function getExam(id: string): Exam | undefined {
  return EXAMS.find((exam) => exam.id === id)
}

/**
 * How many questions the exam draws from. Client-safe: it counts ids, so
 * `/certify` can state the ratio without the bank being anywhere near it.
 */
export function examPoolSize(examId: string): number {
  return getExam(examId)?.poolIds.length ?? 0
}
