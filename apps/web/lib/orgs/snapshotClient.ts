/**
 * orgs/snapshotClient.ts — build the learner's shareable snapshot, in the browser.
 *
 * BROWSER ONLY, and deliberately the only module in lib/orgs that reads a
 * learner's own progress. It is separate from progressShare.ts so that the API
 * routes, which validate an incoming snapshot, never import localStorage code —
 * and so that the set of places that can read course progress stays small
 * enough to audit by grepping for this file's importers.
 *
 * Every source here is one the learner already owns and can already see:
 *   lessons + quiz scores → lib/lessons/progress.ts   (localStorage)
 *   challenges            → lib/challenges/types.ts   (localStorage)
 *   exams                 → GET /api/exams/summary    (the learner's own attempts)
 *
 * The exam figure is the one that is not local, because exam attempts were moved
 * server-side by the certification workstream (lib/exams/store.ts). That call is
 * a read of the CALLER'S OWN results through their own token; it sends nothing.
 * If it fails — offline, signed out, store unavailable — the snapshot reports no
 * exams rather than failing. An assignment that names an exam then shows as
 * incomplete, which is the safe direction to be wrong in: it never invents a pass.
 *
 * NOTHING HERE UPLOADS. Collection and transmission are separate on purpose;
 * transmission happens only from the consent-gated path in
 * components/admin/AssignedWork.tsx.
 */

import { loadProgress } from '@/lib/lessons/progress'
import { readProgress as readChallengeProgress } from '@/lib/challenges/types'
import { authFetch } from '@/lib/authFetch'
import { emptySnapshot, type ProgressSnapshot } from '@/lib/orgs/assignments'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Exam ids the caller has passed, or [] if that cannot be established. */
async function passedExams(): Promise<string[]> {
  try {
    const response = await authFetch('/api/exams/summary', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return []
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body.summaries)) return []
    const out: string[] = []
    for (const raw of body.summaries) {
      if (!isRecord(raw)) continue
      if (raw.passed === true && typeof raw.examId === 'string') out.push(raw.examId)
    }
    return out
  } catch {
    return []
  }
}

/**
 * The local half of the snapshot. Synchronous and SSR-safe.
 */
function collectLocalSnapshot(): ProgressSnapshot {
  if (typeof window === 'undefined') return emptySnapshot()
  const snapshot = emptySnapshot()
  try {
    const progress = loadProgress()
    snapshot.lessons = [...progress.completed].sort()
    snapshot.quizScores = { ...progress.quizScores }
  } catch {
    // Blocked or corrupt storage. An empty half is better than no snapshot.
  }
  try {
    snapshot.challenges = Object.entries(readChallengeProgress())
      .filter(([, entry]) => entry.solved)
      .map(([id]) => id)
      .sort()
  } catch {
    // As above.
  }
  return snapshot
}

/** The complete snapshot, including the server-held exam results. */
export async function collectSnapshot(): Promise<ProgressSnapshot> {
  const snapshot = collectLocalSnapshot()
  snapshot.exams = (await passedExams()).sort()
  return snapshot
}
