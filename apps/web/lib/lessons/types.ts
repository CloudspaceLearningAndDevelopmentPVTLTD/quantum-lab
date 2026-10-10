/**
 * Core data model for the Qubit16 course system.
 *
 * Lessons are plain typed TypeScript data — no MDX, no runtime parsing. Each
 * lesson is a list of `LessonBlock`s, a discriminated union on `kind`, which
 * `LessonShell` switches over to render. Adding a new block type means adding a
 * member here and a case in the renderer; the compiler finds every site that
 * needs updating.
 */

export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface QuizQuestion {
  id: string
  prompt: string
  options: { id: string; text: string }[]
  correctId: string
  /** Shown after answering, whether the learner was right or wrong. */
  explanation: string
}

export type LessonBlock =
  | { kind: 'prose'; title?: string; paragraphs: string[] }
  | { kind: 'callout'; tone: 'insight' | 'warning' | 'aside'; title: string; body: string }
  | { kind: 'code'; language: string; code: string; caption?: string }
  /** Links out to a live visualization route elsewhere in the app. */
  | { kind: 'embed'; href: string; title: string; blurb: string }
  | { kind: 'quiz'; questions: QuizQuestion[] }
  | { kind: 'keypoints'; points: string[] }
  /**
   * One question posed BEFORE the section it introduces (Brilliant's
   * question-first pattern — commit to a prediction, then read the answer).
   * The renderer withholds the blocks after an unrevealed check, but only
   * visually and only until the learner answers OR skips: the gate is a
   * pedagogical nudge, never an access control. See
   * `lib/lessons/inlineCheck.ts` for the state machine and the gating rule.
   */
  | {
      kind: 'inline-check'
      /** Stable within the lesson — the renderer's reveal bookkeeping keys on it. */
      id: string
      /**
       * 'predict' (the default when omitted) frames the question as a guess
       * about material NOT yet read; 'recall' frames it as retrieval of a
       * previous lesson's material. Copy only — behaviour is identical.
       */
      framing?: 'predict' | 'recall'
      question: string
      options: { id: string; text: string }[]
      correctId: string
      /** Shown after answering, whether the learner was right or wrong. */
      explanation: string
    }

/** The 'inline-check' member of `LessonBlock`, named for component props. */
export type InlineCheckBlock = Extract<LessonBlock, { kind: 'inline-check' }>

/**
 * The SHAPE of a lesson body with none of its text: one entry per block, in
 * order, carrying the block's `kind` and — for a quiz — the ids of its
 * questions and nothing else.
 *
 * This exists so that code which only needs to count things (how many blocks,
 * how many quiz questions) can stay on the client side of the metadata/body
 * split. Two callers outside this folder do exactly that:
 * `lib/coach/recommend.ts` and `components/admin/CohortProgress.tsx` both run
 * `lesson.blocks.reduce((sum, b) => b.kind === 'quiz' ? sum + b.questions.length : sum, 0)`
 * to turn a raw quiz score into a ratio. Keeping the field named `blocks` and
 * discriminated on `kind` is what lets those two files stay untouched.
 *
 * The type is the guard, not a comment: an outline entry has no `paragraphs`,
 * no `body`, no `code`, no `prompt`. Anyone who tries to RENDER `LessonMeta.blocks`
 * gets a compile error rather than a silently empty lesson, and anyone who
 * tries to smuggle prose in here has to widen this union first.
 */
export type LessonBlockOutline =
  | { kind: Exclude<LessonBlock['kind'], 'quiz'> }
  | { kind: 'quiz'; questions: { id: string }[] }

/**
 * Everything about a lesson EXCEPT its body. This is the half that may be
 * imported by client components; see `lib/lessons/index.ts` for why that
 * boundary exists and `lib/lessons/bundle.test.ts` for the test that keeps it.
 */
export interface LessonMeta {
  slug: string
  title: string
  subtitle: string
  level: Level
  minutes: number
  /** Slugs of other lessons that should be read first. */
  prerequisites: string[]
  objectives: string[]
  /** Structure only — see `LessonBlockOutline`. No lesson text lives here. */
  blocks: LessonBlockOutline[]
}

/** A lesson body: the blocks, keyed back to their lesson by slug. */
export interface LessonBody {
  slug: string
  blocks: LessonBlock[]
}

/**
 * A whole lesson, metadata and body. Only server code can obtain one — it is
 * assembled by `lib/lessons/server.ts`, which is the only module that imports
 * the bodies. `Lesson` is assignable to `LessonMeta` (a `LessonBlock` satisfies
 * `LessonBlockOutline`), so anything typed against metadata also accepts a full
 * lesson; the reverse is correctly rejected.
 */
export interface Lesson extends Omit<LessonMeta, 'blocks'> {
  blocks: LessonBlock[]
}

export interface Track {
  id: string
  name: string
  blurb: string
  lessonSlugs: string[]
}
