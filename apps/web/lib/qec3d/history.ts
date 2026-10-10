/**
 * lib/qec3d/history.ts — a syndrome history for the teaching page's time axis.
 *
 * The 2-D surface-code page has one round of perfect measurement. To show WHY a
 * decoder works on a stack of rounds, the page needs a history with the two things
 * that only exist in time:
 *
 *   1. A data error that happens in some round and PERSISTS. The syndrome flips in
 *      that round and then stays flipped, so there is exactly one pair of detection
 *      events, at the round the error occurred; every later round is quiet.
 *
 *   2. A measurement error: one stabiliser's readout is wrong for one round. Nothing
 *      happened to the data, so the outcome flips and flips straight back — two
 *      detection events on the same stabiliser, one round apart. The decoder
 *      matches them to each other along a VERTICAL edge and flips no data qubit.
 *
 * `buildHistory` assembles that history from the flat syndrome of the placed errors.
 * `historyMatching` lifts the flat decoder's matching to the error round and adds the
 * vertical blip edge — which IS the minimum-weight matching of these events: the blip
 * pair has weight 1 and the remaining events are the flat problem at one height. A
 * genuine space-time decoder recovers the same thing from the events alone; this
 * module only avoids running one on a page that is not about decoders.
 */

import type { Lattice3D, MatchingEdge } from './layout'

export type Blip = { stabiliser: number; round: number }

export type HistorySpec = {
  /** Total number of rounds, ≥ 1. */
  rounds: number
  /** Round in which the placed errors occur. Clamped to [0, rounds − 1]. */
  errorRound: number
  /** One-round readout error, or null. Rounds outside the history are ignored. */
  blip: Blip | null
}

/** The round the demo puts the errors in: the middle of the history. */
export function defaultErrorRound(rounds: number): number {
  return Math.floor(Math.max(1, rounds) / 2)
}

/**
 * Pick where the demo's measurement error goes: the last-but-one round (so its
 * second event exists), on the first bulk stabiliser the placed errors do not
 * already light. Null when the history is too short to show both events, or when
 * every bulk stabiliser is lit.
 */
export function defaultBlip(lattice: Lattice3D, flatSyndrome: ReadonlyArray<boolean>, rounds: number): Blip | null {
  if (rounds < 3) return null
  const s = lattice.stabilisers.find((st) => st.qubits.length === 4 && !flatSyndrome[st.id])
  return s ? { stabiliser: s.id, round: rounds - 2 } : null
}

export function buildHistory(
  lattice: Lattice3D,
  flatSyndrome: ReadonlyArray<boolean>,
  spec: HistorySpec
): boolean[][] {
  const n = lattice.stabilisers.length
  const rounds = Math.max(1, Math.floor(spec.rounds))
  const errorRound = Math.min(rounds - 1, Math.max(0, spec.errorRound))
  const out: boolean[][] = []
  for (let t = 0; t < rounds; t++) {
    const row = new Array<boolean>(n).fill(false)
    if (t >= errorRound) for (let s = 0; s < n; s++) row[s] = flatSyndrome[s] === true
    if (spec.blip && spec.blip.round === t && spec.blip.stabiliser >= 0 && spec.blip.stabiliser < n) {
      row[spec.blip.stabiliser] = !row[spec.blip.stabiliser]
    }
    out.push(row)
  }
  return out
}

/**
 * The space-time matching for a history built by `buildHistory`: the flat matching
 * at `errorRound`, plus the blip's vertical edge when its second event exists.
 */
export function historyMatching(
  flatEdges: ReadonlyArray<MatchingEdge>,
  spec: HistorySpec
): MatchingEdge[] {
  const rounds = Math.max(1, Math.floor(spec.rounds))
  const errorRound = Math.min(rounds - 1, Math.max(0, spec.errorRound))
  const out: MatchingEdge[] = flatEdges.map((e) => ({
    from: { stabiliser: e.from.stabiliser, round: errorRound },
    to: e.to === 'boundary' ? 'boundary' : { stabiliser: e.to.stabiliser, round: errorRound },
  }))
  if (spec.blip && spec.blip.round >= 0 && spec.blip.round + 1 < rounds) {
    out.push({
      from: { stabiliser: spec.blip.stabiliser, round: spec.blip.round },
      to: { stabiliser: spec.blip.stabiliser, round: spec.blip.round + 1 },
    })
  }
  return out
}
