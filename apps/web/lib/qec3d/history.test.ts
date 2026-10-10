import { describe, expect, it } from 'vitest'
import {
  buildLattice3D,
  detectionEvents,
  errorsFromChannels,
  matchingSegments,
  syndromeFromErrors,
} from './layout'
import { buildHistory, defaultBlip, defaultErrorRound, historyMatching } from './history'

const middleXError = (d: number) => {
  const L = buildLattice3D(d)
  const mid = Math.floor((d * d) / 2)
  const errors = errorsFromChannels(
    Array.from({ length: d * d }, (_, q) => (q === mid ? 1 : 0)),
    new Array(d * d).fill(0)
  )
  return { L, flat: syndromeFromErrors(L, errors) }
}

describe('buildHistory', () => {
  it('a persisting error is exactly one pair of detection events, at the round it happened', () => {
    const { L, flat } = middleXError(5)
    const rounds = buildHistory(L, flat, { rounds: 6, errorRound: 2, blip: null })
    expect(rounds).toHaveLength(6)
    expect(rounds[0].some(Boolean)).toBe(false)
    expect(rounds[1].some(Boolean)).toBe(false)
    for (let t = 2; t < 6; t++) expect(rounds[t]).toEqual(flat)
    const events = detectionEvents(rounds)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.round === 2)).toBe(true)
  })

  it('a measurement blip is two events on one stabiliser, one round apart, and no data change', () => {
    const { L, flat } = middleXError(5)
    const blip = defaultBlip(L, flat, 6)!
    expect(blip.round).toBe(4)
    expect(L.stabilisers[blip.stabiliser].qubits).toHaveLength(4)
    expect(flat[blip.stabiliser]).toBe(false)
    const rounds = buildHistory(L, flat, { rounds: 6, errorRound: 3, blip })
    const events = detectionEvents(rounds).filter((e) => e.stabiliser === blip.stabiliser)
    expect(events.map((e) => e.round)).toEqual([4, 5])
    // The last round reads the same as the round before the blip.
    expect(rounds[5]).toEqual(rounds[3])
  })

  it('clamps the error round and refuses a blip the history cannot show', () => {
    const { L, flat } = middleXError(3)
    expect(defaultErrorRound(5)).toBe(2)
    expect(defaultErrorRound(1)).toBe(0)
    expect(defaultBlip(L, flat, 2)).toBeNull()
    const rounds = buildHistory(L, flat, { rounds: 3, errorRound: 9, blip: null })
    expect(detectionEvents(rounds).every((e) => e.round === 2)).toBe(true)
    const one = buildHistory(L, flat, { rounds: 0, errorRound: 0, blip: null })
    expect(one).toHaveLength(1)
    expect(one[0]).toEqual(flat)
  })

  it('returns null for the blip when every bulk stabiliser is already lit', () => {
    const L = buildLattice3D(3)
    const all = L.stabilisers.map(() => true)
    expect(defaultBlip(L, all, 5)).toBeNull()
  })
})

describe('historyMatching', () => {
  it('lifts the flat edges to the error round and adds a vertical edge for the blip', () => {
    const { L, flat } = middleXError(5)
    const lit = L.stabilisers.filter((s) => flat[s.id]).map((s) => s.id)
    const flatEdges = [{ from: { stabiliser: lit[0] }, to: { stabiliser: lit[1] } }]
    const blip = { stabiliser: 7, round: 4 }
    const edges = historyMatching(flatEdges, { rounds: 6, errorRound: 2, blip })
    expect(edges).toHaveLength(2)
    expect(edges[0]).toEqual({
      from: { stabiliser: lit[0], round: 2 },
      to: { stabiliser: lit[1], round: 2 },
    })
    expect(edges[1]).toEqual({ from: { stabiliser: 7, round: 4 }, to: { stabiliser: 7, round: 5 } })
    // The blip edge is exactly vertical: same x and z, one round spacing apart.
    const segs = matchingSegments(L, edges, 0.8)
    const v = segs[1]
    expect(v.a[0]).toBeCloseTo(v.b[0], 9)
    expect(v.a[2]).toBeCloseTo(v.b[2], 9)
    expect(v.b[1] - v.a[1]).toBeCloseTo(0.8, 9)
  })

  it('keeps boundary edges as boundary edges and drops a blip whose second event is off the end', () => {
    const edges = historyMatching([{ from: { stabiliser: 3 }, to: 'boundary' }], {
      rounds: 4,
      errorRound: 1,
      blip: { stabiliser: 5, round: 3 },
    })
    expect(edges).toEqual([{ from: { stabiliser: 3, round: 1 }, to: 'boundary' }])
  })
})
