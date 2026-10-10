/**
 * progressSync.ts — course progress follows the account.
 *
 * BROWSER ONLY. Course progress (completed lessons, quiz scores) lives in
 * localStorage (lib/lessons/progress.ts), which meant a learner who signed in
 * on a second device started from zero. Once a user is signed in this module:
 *
 *   1. pulls their `public.user_progress` row and MERGES it with this browser's
 *      progress — union of completed lessons, best quiz score per lesson — so
 *      signing in never loses work done on either side;
 *   2. writes the merged result back to both places;
 *   3. registers a save hook so every later local change is pushed (debounced).
 *
 * Everything here fails soft: with the table missing or the network down,
 * progress simply stays local, exactly as before.
 */

import { getSupabase } from '@/lib/supabase'
import {
  loadProgress,
  normalizeProgress,
  setProgressSaveHook,
  writeProgressLocally,
  type Progress,
} from '@/lib/lessons/progress'

const PUSH_DELAY_MS = 1500

/** Merge two progress records without losing anything from either. */
export function mergeProgress(local: Progress, remote: Progress): Progress {
  const completed = Array.from(new Set([...remote.completed, ...local.completed]))
  const quizScores: Record<string, number> = { ...remote.quizScores }
  for (const [slug, score] of Object.entries(local.quizScores)) {
    quizScores[slug] = Math.max(score, quizScores[slug] ?? Number.NEGATIVE_INFINITY)
  }
  // This browser's "where I was" is the more recent intent on this device.
  const lastVisited = local.lastVisited ?? remote.lastVisited
  return lastVisited !== undefined ? { completed, quizScores, lastVisited } : { completed, quizScores }
}

function sameProgress(a: Progress, b: Progress): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function push(userId: string, progress: Progress): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    await supabase
      .from('user_progress')
      .upsert({ user_id: userId, progress, updated_at: new Date().toISOString() })
  } catch {
    // Stays local; the next change or sign-in retries.
  }
}

let activeUser: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Pull, merge and start pushing for `userId`. Idempotent per user.
 *
 * @returns The merged progress, or null when the remote could not be read.
 */
export async function startProgressSync(userId: string): Promise<Progress | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  if (activeUser !== userId) {
    activeUser = userId
    setProgressSaveHook((progress) => {
      if (timer) clearTimeout(timer)
      const owner = activeUser
      if (!owner) return
      timer = setTimeout(() => void push(owner, progress), PUSH_DELAY_MS)
    })
  }

  let remote: Progress
  try {
    const { data, error } = await supabase
      .from('user_progress')
      .select('progress')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return null
    remote = normalizeProgress((data as { progress?: unknown } | null)?.progress ?? {})
  } catch {
    return null
  }

  const local = loadProgress()
  const merged = mergeProgress(local, remote)
  if (!sameProgress(merged, local)) {
    writeProgressLocally(merged)
    // Pages that already rendered progress can pick this up.
    try {
      window.dispatchEvent(new CustomEvent('quantum-lab:progress-synced'))
    } catch {
      // ignore
    }
  }
  if (!sameProgress(merged, remote)) await push(userId, merged)
  return merged
}

/** Stop pushing (on sign-out). Local progress is left as it is. */
export function stopProgressSync(): void {
  activeUser = null
  if (timer) clearTimeout(timer)
  timer = null
  setProgressSaveHook(null)
}
