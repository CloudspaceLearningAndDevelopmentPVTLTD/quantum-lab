/**
 * recommend.ts — the deterministic recommender behind the AI Coach.
 *
 * There is no model in this file and no network call anywhere in it. Given the
 * learner's local progress and their local exam attempts, the same input always
 * produces the same three recommendations, offline, with no API key. An LLM may
 * later be asked to *rephrase* a `why` in friendlier prose, but it is never the
 * mechanism deciding what to study — a recommender the learner cannot audit is
 * a recommender the learner cannot trust.
 *
 * The ranking rules below are the product. Their ORDER is the opinion: shaky
 * foundations outrank new material, a stated goal outranks the default path,
 * and doing outranks reading. Each rule is commented where it is implemented.
 */

import { LESSONS, TRACKS } from '@/lib/lessons'
import type { Progress } from '@/lib/lessons/progress'
import type { ExamAttempt } from '@/lib/exams/types'
import { EXAMS } from '@/lib/exams/catalogue'
import {
  CONCEPT_GRAPH,
  SIMULATOR_SLUG,
  firstUnmetPrerequisite,
  nodeFor,
  topologicalOrder,
} from './graph'

export interface Recommendation {
  kind: 'revise' | 'advance' | 'practise' | 'explore'
  lessonSlug?: string
  vizSlug?: string
  title: string
  why: string
  confidence: number
  estimatedMinutes: number
}

/**
 * Behavioural signals that do not live in `Progress`.
 *
 * Both are optional and both are treated as ABSENT rather than zero when
 * missing: rule 3 is skipped entirely when `circuitsBuilt` is undefined, because
 * telling someone "you have never built a circuit" on the strength of a signal
 * we cannot read would be a guess dressed as a fact.
 */
export interface CoachSignals {
  /** Circuits the learner has saved or run, if that store could be read. */
  circuitsBuilt?: number
  /** Visualization slugs the learner has opened, if analytics is available. */
  seenVizSlugs?: string[]
}

/** Quiz scores are stored as a RAW COUNT of correct answers, not a percentage. */
const QUIZ_PASS_RATIO = 0.7
const MASTERED = 0.8

const VIZ_MINUTES = 6
const SIMULATOR_MINUTES = 10

/** Number of quiz questions in a lesson, so a raw score can become a ratio. */
function questionCount(slug: string): number {
  const lesson = LESSONS.find((l) => l.slug === slug)
  if (!lesson) return 0
  return lesson.blocks.reduce(
    (sum, block) => (block.kind === 'quiz' ? sum + block.questions.length : sum),
    0
  )
}

/** Quiz ratio 0..1 for a lesson, or null when the learner has not taken it. */
function quizRatio(progress: Progress, slug: string): number | null {
  const raw = progress.quizScores[slug]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const total = questionCount(slug)
  if (total <= 0) return null
  return Math.min(1, Math.max(0, raw / total))
}

function lessonTitle(slug: string): string {
  const lesson = LESSONS.find((l) => l.slug === slug)
  if (lesson) return lesson.title
  const node = nodeFor(slug)
  return node ? node.label : slug
}

function lessonMinutes(slug: string): number {
  const lesson = LESSONS.find((l) => l.slug === slug)
  return lesson ? lesson.minutes : 10
}

function vizTitle(slug: string): string {
  if (slug === SIMULATOR_SLUG) return 'Circuit Simulator'
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Best exam evidence per lesson, 0..1.
 *
 * An exam covers a whole track, so a strong result raises the floor for every
 * lesson in that track — it is weaker evidence than a per-lesson quiz, which is
 * why it only ever raises a floor and never lowers a score.
 */
function examFloorByLesson(attempts: readonly ExamAttempt[]): Record<string, number> {
  const floor: Record<string, number> = {}
  for (const attempt of attempts) {
    if (typeof attempt.score !== 'number' || !Number.isFinite(attempt.score)) continue
    const exam = EXAMS.find((e) => e.id === attempt.examId)
    if (!exam) continue
    const track = TRACKS.find((t) => t.id === exam.trackId)
    if (!track) continue
    const value = Math.min(1, Math.max(0, attempt.score))
    for (const slug of track.lessonSlugs) {
      floor[slug] = Math.max(floor[slug] ?? 0, value)
    }
  }
  return floor
}

/**
 * Mastery per concept, 0..1, blending completion and assessment.
 *
 *   not started              → 0
 *   read, never assessed     → 0.7  (below the 0.8 mastery bar on purpose:
 *                                    reading a page is not evidence of much)
 *   read and quizzed         → half completion, half quiz ratio
 *   plus an exam floor       → a strong exam on the track lifts the whole track
 *
 * Feeds the SkillMap fill and the recommender's own "already solid" checks.
 */
export function masteryByConcept(
  progress: Progress,
  examAttempts: readonly ExamAttempt[]
): Record<string, number> {
  const completed = new Set(progress.completed)
  const floor = examFloorByLesson(examAttempts)
  const mastery: Record<string, number> = {}

  for (const node of CONCEPT_GRAPH) {
    const slug = node.lessonSlug
    const ratio = quizRatio(progress, slug)
    const isDone = completed.has(slug)

    let value: number
    if (!isDone && ratio === null) {
      value = 0
    } else if (!isDone && ratio !== null) {
      // Quizzed without marking the lesson complete — credit the assessment
      // only, since the reading is unconfirmed.
      value = 0.5 * ratio
    } else if (ratio === null) {
      value = 0.7
    } else {
      value = 0.5 + 0.5 * ratio
    }

    mastery[node.id] = Math.min(1, Math.max(0, Math.max(value, floor[slug] ?? 0)))
  }
  return mastery
}

interface Candidate {
  /** Lower is better. The rule number that produced this candidate. */
  rule: number
  rec: Recommendation
}

function dedupeKey(rec: Recommendation): string {
  return `${rec.kind}:${rec.lessonSlug ?? ''}:${rec.vizSlug ?? ''}`
}

/**
 * The recommender.
 *
 * Rules are evaluated in priority order and every match is collected; the sort
 * at the end is by rule number first and confidence second, so a rule-1 match
 * always outranks a rule-4 match no matter how confident the latter is.
 */
export function recommend(
  progress: Progress,
  examAttempts: readonly ExamAttempt[],
  goal?: string,
  signals?: CoachSignals
): Recommendation[] {
  const completed = new Set(progress.completed)
  const candidates: Candidate[] = []
  const order = topologicalOrder()

  // ── Rule 1 — REVISE ────────────────────────────────────────────────────
  // A lesson marked complete whose quiz came in under 70%. Shaky foundations
  // beat new material every time: everything downstream of a half-understood
  // concept is built on sand, so this rule outranks all of the others even
  // when the learner has explicitly asked to move forward.
  for (const id of order) {
    if (!completed.has(id)) continue
    const ratio = quizRatio(progress, id)
    if (ratio === null || ratio >= QUIZ_PASS_RATIO) continue
    candidates.push({
      rule: 1,
      rec: {
        kind: 'revise',
        lessonSlug: id,
        title: lessonTitle(id),
        why: `You scored ${Math.round(ratio * 100)}% on this quiz, below the 70% mark. Everything after it leans on this, so a second pass here will save you time later.`,
        // More confident the worse the score was.
        confidence: Math.min(0.97, 0.8 + (QUIZ_PASS_RATIO - ratio) * 0.5),
        estimatedMinutes: Math.max(4, Math.round(lessonMinutes(id) * 0.6)),
      },
    })
  }

  // ── Rule 2 — ADVANCE toward a stated goal ──────────────────────────────
  // If the learner has told us where they are heading, the next step is the
  // EARLIEST unmet prerequisite of that goal, not the next lesson in the
  // default order and not the goal itself. Someone aiming at Shor from a
  // standing start gets sent to "What Is a Qubit?".
  if (goal !== undefined && goal !== '' && nodeFor(goal)) {
    const blocker = firstUnmetPrerequisite(goal, progress.completed)
    if (blocker !== null) {
      const isGoalItself = blocker === goal
      candidates.push({
        rule: 2,
        rec: {
          kind: 'advance',
          lessonSlug: blocker,
          title: lessonTitle(blocker),
          why: isGoalItself
            ? 'Every prerequisite for your goal is done — this is the goal itself, and you are ready for it now.'
            : `You are aiming at ${lessonTitle(goal)}. This is the earliest thing still blocking you, so it unblocks the most.`,
          confidence: isGoalItself ? 0.95 : 0.9,
          estimatedMinutes: lessonMinutes(blocker),
        },
      })
    }
  }

  // ── Rule 3 — PRACTISE ──────────────────────────────────────────────────
  // Prerequisites met and the lesson read, but nothing ever built in the
  // simulator. Reading about gates is not the same as placing one.
  //
  // This rule is SKIPPED ENTIRELY when the circuit signal is unavailable
  // (`circuitsBuilt` undefined) rather than assuming zero — claiming "you have
  // never built a circuit" on the basis of a signal we could not read would be
  // a guess presented as a fact, and this recommender does not guess.
  if (typeof signals?.circuitsBuilt === 'number' && signals.circuitsBuilt === 0) {
    for (const id of order) {
      const node = nodeFor(id)
      if (!node || !node.vizSlugs.includes(SIMULATOR_SLUG)) continue
      if (!completed.has(id)) continue
      if (!node.requires.every((r) => completed.has(r))) continue
      candidates.push({
        rule: 3,
        rec: {
          kind: 'practise',
          lessonSlug: id,
          vizSlug: SIMULATOR_SLUG,
          title: 'Build your first circuit',
          why: `You have read ${lessonTitle(id)} but never built anything. Place an H and a CNOT in the simulator and watch the state vector move — the idea lands differently once you have done it.`,
          confidence: 0.78,
          estimatedMinutes: SIMULATOR_MINUTES,
        },
      })
    }
  }

  // ── Rule 4 — ADVANCE along the default path ────────────────────────────
  // No goal set, or the goal is already handled: take the first lesson in
  // dependency order that is not done and whose prerequisites all are. This is
  // the plain "keep going" recommendation, and it is deliberately below the
  // goal rule so a stated intention always wins over the default curriculum.
  for (const id of order) {
    if (completed.has(id)) continue
    const node = nodeFor(id)
    if (!node) continue
    if (!node.requires.every((r) => completed.has(r))) continue
    const readyBecause =
      node.requires.length === 0
        ? 'It has no prerequisites, so it is the natural place to start.'
        : `You have finished ${node.requires.map(lessonTitle).join(' and ')}, so you are ready for this.`
    candidates.push({
      rule: 4,
      rec: {
        kind: 'advance',
        lessonSlug: id,
        title: lessonTitle(id),
        why: `${readyBecause} It opens up ${node.unlocks.length > 0 ? node.unlocks.map(lessonTitle).join(' and ') : 'the rest of the track'}.`,
        confidence: 0.72,
        estimatedMinutes: lessonMinutes(id),
      },
    })
  }

  // ── Rule 5 — EXPLORE ───────────────────────────────────────────────────
  // A visualization for a concept they have READ but not SEEN. Lowest priority
  // because it never unblocks anything — but a concept you have only met in
  // prose is a concept you half know, and these are cheap.
  const seen = new Set(signals?.seenVizSlugs ?? [])
  for (const id of order) {
    if (!completed.has(id)) continue
    const node = nodeFor(id)
    if (!node) continue
    for (const viz of node.vizSlugs) {
      if (viz === SIMULATOR_SLUG) continue
      if (seen.has(viz)) continue
      candidates.push({
        rule: 5,
        rec: {
          kind: 'explore',
          lessonSlug: id,
          vizSlug: viz,
          title: vizTitle(viz),
          why: `You have read ${lessonTitle(id)} but not opened the visualization that goes with it. A few minutes of pushing the sliders will make the maths feel less abstract.`,
          confidence: 0.5,
          estimatedMinutes: VIZ_MINUTES,
        },
      })
    }
  }

  // Rule number first, then confidence. Sorting on confidence alone would let a
  // very confident "keep going" jump over a genuine gap in the foundations.
  candidates.sort((a, b) =>
    a.rule !== b.rule ? a.rule - b.rule : b.rec.confidence - a.rec.confidence
  )

  const out: Recommendation[] = []
  const usedKeys = new Set<string>()
  const usedLessons = new Set<string>()
  for (const candidate of candidates) {
    const rec = candidate.rec
    const key = dedupeKey(rec)
    if (usedKeys.has(key)) continue
    // One card per lesson: three recommendations that all point at the same
    // lesson is a list of one wearing a disguise.
    if (rec.lessonSlug !== undefined && usedLessons.has(rec.lessonSlug)) continue
    usedKeys.add(key)
    if (rec.lessonSlug !== undefined) usedLessons.add(rec.lessonSlug)
    out.push(rec)
    if (out.length === 3) break
  }
  return out
}

/** Destination for a recommendation card's primary action. */
export function destinationFor(rec: Recommendation): string {
  if (rec.vizSlug === SIMULATOR_SLUG) return '/simulator'
  if (rec.vizSlug !== undefined) return `/visualizations/${rec.vizSlug}`
  if (rec.lessonSlug !== undefined) return `/learn/${rec.lessonSlug}`
  return '/learn'
}

/** Count of concepts at or above the mastery bar, for the summary line. */
export function masteredCount(mastery: Record<string, number>): number {
  return Object.values(mastery).filter((m) => m >= MASTERED).length
}

export { MASTERED as MASTERY_THRESHOLD }
