/**
 * access.ts — which certification exams need a plan.
 *
 * Pure and dependency-light, so /certify, the exam page and the route handlers
 * can all read the same answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE IS NOW LOAD-BEARING, WHICH IT WAS NOT BEFORE.
 *
 * The header this replaced said, at length and correctly, that nothing here was
 * a security boundary: the question bank shipped in the client bundle, scores
 * lived in localStorage, and no server ever saw one, so there was nothing to
 * withhold and nothing to refuse. All three of those facts have changed.
 *
 *   · `lib/exams/questions.ts` is server-only and throws if it is bundled for a
 *     browser. A paper is served without keys and without explanations.
 *   · Grading happens in `lib/exams/service.ts`, against a Supabase-verified
 *     caller, from answers the server stored.
 *   · `entitlementOrNull` in that same file calls `assertFeature` with the
 *     value THIS module returns, before a single question is drawn. An
 *     anonymous `curl` at /api/exams/advanced-cert/attempt gets a 402.
 *
 * So `featureForExam` is the input to a real gate now. The client-side check
 * that used to live in `app/certify/[examId]/ExamAccessGate.tsx` has been
 * deleted rather than kept alongside it: a second, cosmetic copy of a gate is
 * how the product ends up claiming one thing on a page and another at the
 * route, which is precisely what that file existed to apologise for.
 *
 * What remains client-side is presentation — /certify renders a lock card for
 * an exam the visitor's plan does not include, so they are not sent to a page
 * that will refuse them. If that display check and this gate ever disagree, the
 * gate wins, because the gate is the one holding the questions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FeatureId } from '@/lib/plans'
import type { Exam } from './types'

/**
 * The plan feature an exam sits behind, or null when it is free to everyone.
 * Reads the exam's own `requiresFeature`, so the catalogue stays the single
 * source of truth and this never becomes a second list to keep in sync.
 */
export function featureForExam(exam: Exam): FeatureId | null {
  return exam.requiresFeature ?? null
}

/** True when the exam needs no plan at all — the foundations certification. */
export function isExamFree(exam: Exam): boolean {
  return exam.requiresFeature === undefined
}
