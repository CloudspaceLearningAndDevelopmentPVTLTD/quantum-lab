import { describe, expect, it } from 'vitest'
import { buildLattice3D, errorsFromChannels, matchingSegments } from './layout'
import {
  SIZES,
  dataInstances,
  edgeInstances,
  layerCount,
  sliceOutline,
  stabiliserInstances,
} from './instances'

describe('data instances', () => {
  it('one per data qubit, styled by its Pauli, errors drawn larger', () => {
    const L = buildLattice3D(3)
    const errors = errorsFromChannels([1, 0, 0, 0, 1, 0, 0, 0, 0], [0, 1, 0, 0, 1, 0, 0, 0, 0])
    const inst = dataInstances(L, errors)
    expect(inst).toHaveLength(9)
    expect(inst.map((i) => i.style)).toEqual([
      'data-X',
      'data-Z',
      'data-clean',
      'data-clean',
      'data-Y',
      'data-clean',
      'data-clean',
      'data-clean',
      'data-clean',
    ])
    expect(inst[0].scale).toBe(SIZES.dataError)
    expect(inst[2].scale).toBe(SIZES.data)
    expect(inst[4].qubit).toBe(4)
    expect(inst[4].position).toEqual([0, 0, 0])
  })

  it('no errors given means every qubit is clean', () => {
    const L = buildLattice3D(5)
    expect(dataInstances(L).every((i) => i.style === 'data-clean')).toBe(true)
  })
})

describe('stabiliser instances', () => {
  it('flat mode: one per stabiliser, lit from the syndrome, at y = 0', () => {
    const L = buildLattice3D(3)
    const syndrome = L.stabilisers.map((s) => s.id === 2 || s.id === 5)
    const inst = stabiliserInstances(L, { syndrome, roundSpacing: 0.8 })
    expect(inst).toHaveLength(8)
    expect(inst.every((i) => i.position[1] === 0 && i.round === 0)).toBe(true)
    const litIds = inst.filter((i) => i.style.endsWith('-lit')).map((i) => i.stabiliser)
    expect(litIds).toEqual([2, 5])
    for (const i of inst) {
      const type = L.stabilisers[i.stabiliser!].type
      expect(i.style.startsWith(`stab-${type}`)).toBe(true)
      expect(i.scale).toBe(i.style.endsWith('-lit') ? SIZES.stabLit : SIZES.stab)
    }
  })

  it('flat mode with no syndrome derives one from the errors', () => {
    const L = buildLattice3D(5)
    const errors = errorsFromChannels(
      Array.from({ length: 25 }, (_, q) => (q === 12 ? 1 : 0)),
      new Array(25).fill(0)
    )
    const inst = stabiliserInstances(L, { errors, roundSpacing: 0.8 })
    const lit = inst.filter((i) => i.style === 'stab-Z-lit')
    expect(lit).toHaveLength(2)
    expect(inst.filter((i) => i.style === 'stab-X-lit')).toHaveLength(0)
  })

  it('stacked mode: rounds × stabilisers instances, each round at its own height', () => {
    const L = buildLattice3D(3)
    const off = new Array(8).fill(false)
    const rounds = [off, off, off, off]
    const inst = stabiliserInstances(L, { rounds, roundSpacing: 0.8 })
    expect(layerCount(rounds)).toBe(4)
    expect(inst).toHaveLength(32)
    for (const i of inst) {
      expect(i.position[1]).toBeCloseTo(i.round! * 0.8, 9)
      // Unlit above the base is a ghost; unlit on the base is the normal marker.
      expect(i.style.endsWith('-ghost')).toBe(i.round !== 0)
      expect(i.scale).toBe(i.round === 0 ? SIZES.stab : SIZES.stabGhost)
    }
  })

  it('stacked mode lights detection events by default: a persistent flip is lit once', () => {
    const L = buildLattice3D(3)
    const off = new Array(8).fill(false)
    const on3 = off.map((_, s) => s === 3)
    const rounds = [off, on3, on3, on3]
    const inst = stabiliserInstances(L, { rounds, roundSpacing: 1 })
    const lit = inst.filter((i) => i.style.endsWith('-lit'))
    expect(lit).toHaveLength(1)
    expect(lit[0]).toMatchObject({ stabiliser: 3, round: 1 })
    expect(lit[0].position[1]).toBe(1)
  })

  it('stacked mode with detection off lights the raw outcomes in every round', () => {
    const L = buildLattice3D(3)
    const off = new Array(8).fill(false)
    const on3 = off.map((_, s) => s === 3)
    const inst = stabiliserInstances(L, { rounds: [off, on3, on3, on3], detection: false, roundSpacing: 1 })
    const lit = inst.filter((i) => i.style.endsWith('-lit')).map((i) => i.round)
    expect(lit).toEqual([1, 2, 3])
  })

  it('an empty rounds array is a flat picture', () => {
    const L = buildLattice3D(3)
    expect(layerCount([])).toBe(1)
    expect(layerCount(undefined)).toBe(1)
    expect(stabiliserInstances(L, { rounds: [], roundSpacing: 1 })).toHaveLength(8)
  })
})

describe('edge instances', () => {
  it('centre, length and unit direction of each matching segment', () => {
    const L = buildLattice3D(5)
    const a = L.stabilisers.find((s) => s.type === 'Z' && s.row === 1.5 && s.col === 2.5)!
    const b = L.stabilisers.find((s) => s.type === 'Z' && s.row === 2.5 && s.col === 1.5)!
    const segs = matchingSegments(L, [{ from: { stabiliser: a.id }, to: { stabiliser: b.id, round: 2 } }], 1)
    const [e] = edgeInstances(segs)
    // From (0.5, 0, −0.5) to (−0.5, 2, 0.5): Δ = (−1, 2, 1), |Δ| = √6.
    expect(e.mid).toEqual([0, 1, 0])
    expect(e.length).toBeCloseTo(Math.sqrt(6), 9)
    expect(e.dir[0]).toBeCloseTo(-1 / Math.sqrt(6), 9)
    expect(e.dir[1]).toBeCloseTo(2 / Math.sqrt(6), 9)
    expect(e.dir[2]).toBeCloseTo(1 / Math.sqrt(6), 9)
    expect(e.type).toBe('Z')
  })

  it('drops zero-length segments rather than producing NaN directions', () => {
    expect(
      edgeInstances([{ a: [1, 1, 1], b: [1, 1, 1], type: 'X', toBoundary: false }])
    ).toEqual([])
  })
})

describe('slice outline', () => {
  it('is a square of side 2·halfExtent at the round height', () => {
    const L = buildLattice3D(3)
    const o = sliceOutline(L, 2, 0.5)
    expect(o).toHaveLength(4)
    expect(o.every((p) => p[1] === 1)).toBe(true)
    expect(o[0][0]).toBe(-L.halfExtent)
    expect(o[2][0]).toBe(L.halfExtent)
    expect(L.halfExtent).toBe(1.75)
  })
})
