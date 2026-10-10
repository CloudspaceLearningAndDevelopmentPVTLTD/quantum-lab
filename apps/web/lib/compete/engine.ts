/**
 * compete/engine.ts — the weekly gate-golf competition, derived, not scheduled.
 *
 * There is no operator. The competition for any moment in time is a pure
 * function of the ISO week that moment falls in: the week key ('2026-W35') is
 * hashed with FNV-1a — the same seeding style as the daily challenge pick in
 * app/challenges/page.tsx — and fed to the verified challenge generator
 * (lib/challenges/generate.ts), which never returns a puzzle it has not proven
 * solvable by execution. Same week, same puzzle, on every server instance and
 * for every visitor; the week rolls over at Monday 00:00 UTC and the next
 * puzzle simply exists. ISO weeks rather than calendar weeks because ISO
 * defines the year boundary unambiguously (week 1 is the week containing the
 * first Thursday), so December 31st and January 1st can share a competition
 * instead of splitting one at an arbitrary seam.
 *
 * The generated challenge is re-badged as `gate-golf`: the generator's
 * reference solution length becomes par, and the score that matters is the
 * SERVER'S recount of the submitted circuit's gates. `validateEntry` is the
 * only door: it parses the submitted OpenQASM with the same parser the share
 * links use, runs it through the real grader, and recomputes the gate count
 * itself. A gate count claimed by the client is checked against that recount
 * and a mismatch is a rejection, not a correction — an honest client's claim
 * always matches (it came from the same grader), so a mismatch means a stale
 * or lying client and neither should be silently scored.
 *
 * WHAT MUST NEVER REACH THE BROWSER: the generator's hints and reference
 * solution spell out a par-length answer, which for a competition is the
 * answer key. `currentCompetition` therefore strips hints and returns no
 * reference; `competitionReference` exists for this module's own tests and for
 * server-side verification only. The API route serialises an explicit field
 * list, never the whole object, as a second fence.
 */

import { generateChallenge, type GeneratedChallenge } from '@/lib/challenges/generate'
import { gateCount, grade } from '@/lib/challenges/grade'
import type { Challenge } from '@/lib/challenges/types'
import { fromQasm } from '@/lib/quantum'

/** Weekly puzzles are all three qubits: wide enough to golf, cheap to grade. */
const DIFFICULTY = 3 as const

/**
 * More ops than any honest 3-qubit golf entry could want. Bounds the work one
 * request can make the grader do — the simulator is O(ops · 2^n) and n is 3,
 * but "cheap per op" is not "free times unbounded".
 */
export const MAX_ENTRY_OPS = 256

export interface WeeklyCompetition {
  /** 'weekly-2026-W35' — also the row id in supabase/schema-competitions.sql. */
  id: string
  /** '2026-W35': ISO week-numbering year and week. */
  weekKey: string
  /** Monday 00:00 UTC of the ISO week, ISO 8601. */
  startsAt: string
  /** The following Monday 00:00 UTC — the factual deadline. */
  endsAt: string
  /** Reference solution length: the score to beat, never a pass condition. */
  par: number
  /** The graded challenge. Hints stripped — see the header. */
  challenge: Challenge
}

// ────────────────────────────────────────────────────────────
// ISO week arithmetic
// ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

/** ISO week-numbering year and week for a UTC instant. */
export function isoWeekOf(date: Date): { year: number; week: number } {
  // Move to the Thursday of this date's ISO week; that Thursday's calendar
  // year IS the week-numbering year, which is the whole trick of ISO 8601.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7 // Monday 1 … Sunday 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const year = d.getUTCFullYear()
  const yearStart = Date.UTC(year, 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7)
  return { year, week }
}

/** '2026-W35' for any instant in that ISO week. */
export function isoWeekKey(date: Date): string {
  const { year, week } = isoWeekOf(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** [Monday 00:00 UTC, next Monday 00:00 UTC) around `date`. */
export function isoWeekWindow(date: Date): { startsAt: Date; endsAt: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  const monday = new Date(d.getTime() - (day - 1) * DAY_MS)
  return { startsAt: monday, endsAt: new Date(monday.getTime() + 7 * DAY_MS) }
}

/** FNV-1a — same hash, same constants, as the daily challenge pick. */
function fnv1a(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// ────────────────────────────────────────────────────────────
// The competition
// ────────────────────────────────────────────────────────────

/**
 * The generated puzzle behind a week key — reference solution and all.
 * SERVER/TEST ONLY: everything a client may see comes from
 * `currentCompetition`, which strips it.
 */
export function competitionReference(weekKey: string): GeneratedChallenge {
  return generateChallenge('target-state', DIFFICULTY, fnv1a(`compete:${weekKey}`))
}

/** The competition in force at `now`. Pure: same week in, same puzzle out. */
export function currentCompetition(now: Date): WeeklyCompetition {
  const weekKey = isoWeekKey(now)
  const { startsAt, endsAt } = isoWeekWindow(now)
  const generated = competitionReference(weekKey)
  const par = generated.maxGates ?? generated.referenceSolution.ops.length

  const challenge: Challenge = {
    id: `weekly-${weekKey}`,
    title: `Weekly gate golf — ${weekKey}`,
    brief:
      `This week's community puzzle, the same for everyone until Monday 00:00 UTC. ` +
      `Build a ${generated.numQubits}-qubit circuit whose histogram matches the target, ` +
      `in as few gates as you can. Par is ${par}; the leaderboard ranks by gate count, ` +
      `ties by who got there first.`,
    kind: 'gate-golf',
    level: 'Advanced',
    numQubits: generated.numQubits,
    lessonSlug: 'gates-and-circuits',
    targetProbabilities: generated.targetProbabilities,
    // The generator's per-state tolerance: entries are circuits, not shot
    // noise, but two routes to one distribution can differ in the last digits.
    tolerance: 0.03,
    maxGates: par,
    // Hints deliberately empty: the generator's hints contain the reference
    // solution, and a competition with the answer in its hints is not one.
    hints: [],
    successNote:
      'On the board. A shorter circuit that reaches the same state replaces this one; ' +
      'a longer one changes nothing.',
  }

  return {
    id: challenge.id,
    weekKey,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    par,
    challenge,
  }
}

// ────────────────────────────────────────────────────────────
// Entry validation — the only path onto the leaderboard
// ────────────────────────────────────────────────────────────

export type EntryVerdict =
  | { ok: true; /** The SERVER'S gate count — the only one ever stored. */ gates: number; summary: string }
  | { ok: false; reason: string }

/**
 * Grade one submitted entry. Trusts nothing from the client:
 *
 *   - the circuit is re-parsed from the submitted QASM (`fromQasm` is total —
 *     garbage lines are dropped, so an empty parse means an empty entry);
 *   - the target check runs through the real grader (`lib/challenges/grade`),
 *     the same code that grades every catalogue challenge;
 *   - the gate count is recomputed here, and a `claimedGates` that disagrees
 *     with the recount REJECTS the entry rather than being quietly fixed up.
 */
export function validateEntry(
  competition: WeeklyCompetition,
  qasm: string,
  claimedGates?: number
): EntryVerdict {
  const circuit = fromQasm(qasm)
  if (circuit.ops.length === 0) {
    return { ok: false, reason: 'No gates could be read from that QASM.' }
  }
  if (circuit.ops.length > MAX_ENTRY_OPS) {
    return { ok: false, reason: `That circuit has more than ${MAX_ENTRY_OPS} operations.` }
  }
  if (circuit.numQubits !== competition.challenge.numQubits) {
    return {
      ok: false,
      reason: `This week's puzzle is on ${competition.challenge.numQubits} qubits; that circuit uses ${circuit.numQubits}.`,
    }
  }

  const result = grade(competition.challenge, circuit)
  if (!result.passed) return { ok: false, reason: result.summary }

  const gates = gateCount(circuit)
  if (claimedGates !== undefined && claimedGates !== gates) {
    return {
      ok: false,
      reason: `Your client counted ${claimedGates} gates but the server counts ${gates}. The entry was not recorded — re-export the circuit and submit again.`,
    }
  }
  return { ok: true, gates, summary: result.summary }
}
