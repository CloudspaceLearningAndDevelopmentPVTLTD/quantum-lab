import { describe, expect, it } from 'vitest'
import {
  boundaryPoint,
  buildLattice3D,
  detectionEvents,
  edgesFromTypedMatching,
  errorsFromChannels,
  fallbackScale,
  matchingSegments,
  positionAtRound,
  projectOblique,
  sceneRadius,
  stackCentreY,
  syndromeFromErrors,
  type Vec3,
} from './layout'
import { buildSurfaceCode, decodeChannel } from '@/components/viz/surface/code'

/**
 * Every number asserted here was worked out on paper from the definition of the
 * rotated surface code, not read off the module's output:
 *
 *   d² data qubits, d² − 1 stabilisers = (d−1)² bulk of weight 4 + 2(d−1) boundary
 *   of weight 2, half of each type. A corner data qubit sits in 2 stabilisers, an
 *   edge qubit in 3, a bulk qubit in 4, and never in more than 2 of one type.
 *   Total incidences 4d(d−1) either way you count them.
 */

const DISTANCES = [3, 5, 7] as const

const close = (a: Vec3, b: Vec3) => {
  expect(a[0]).toBeCloseTo(b[0], 9)
  expect(a[1]).toBeCloseTo(b[1], 9)
  expect(a[2]).toBeCloseTo(b[2], 9)
}

describe('buildLattice3D counts', () => {
  for (const d of DISTANCES) {
    it(`d = ${d}: d² data qubits and d² − 1 stabilisers, half of each type`, () => {
      const L = buildLattice3D(d)
      expect(L.data).toHaveLength(d * d)
      expect(L.stabilisers).toHaveLength(d * d - 1)
      expect(L.byType.X).toHaveLength((d * d - 1) / 2)
      expect(L.byType.Z).toHaveLength((d * d - 1) / 2)
    })

    it(`d = ${d}: (d−1)² bulk stabilisers of weight 4 and 2(d−1) boundary ones of weight 2`, () => {
      const L = buildLattice3D(d)
      const bulk = L.stabilisers.filter((s) => s.qubits.length === 4)
      const edge = L.stabilisers.filter((s) => s.qubits.length === 2)
      expect(bulk).toHaveLength((d - 1) * (d - 1))
      expect(edge).toHaveLength(2 * (d - 1))
      expect(bulk.length + edge.length).toBe(L.stabilisers.length)
      // Boundary type rule: top/bottom carry X, left/right carry Z.
      for (const s of edge) {
        const topOrBottom = s.row < 0 || s.row > d - 1
        expect(s.type).toBe(topOrBottom ? 'X' : 'Z')
      }
    })

    it(`d = ${d}: corner qubits touch 2 stabilisers, edge qubits 3, bulk 4; at most 2 per type`, () => {
      const L = buildLattice3D(d)
      let incidences = 0
      for (const q of L.data) {
        const onRowEdge = q.row === 0 || q.row === d - 1
        const onColEdge = q.col === 0 || q.col === d - 1
        const expected = onRowEdge && onColEdge ? 2 : onRowEdge || onColEdge ? 3 : 4
        expect(q.stabilisers).toHaveLength(expected)
        expect(q.stabilisers.length).toBeLessThanOrEqual(4)
        const perType = { X: 0, Z: 0 }
        for (const id of q.stabilisers) {
          perType[L.stabilisers[id].type] += 1
          expect(L.stabilisers[id].qubits).toContain(q.index)
        }
        expect(perType.X).toBeLessThanOrEqual(2)
        expect(perType.Z).toBeLessThanOrEqual(2)
        incidences += q.stabilisers.length
      }
      expect(incidences).toBe(4 * d * (d - 1))
    })

    it(`d = ${d}: every position is distinct, and each stabiliser sits pitch/√2 from its qubits`, () => {
      const L = buildLattice3D(d, 1.5)
      const seen = new Set<string>()
      for (const p of [...L.data, ...L.stabilisers].map((n) => n.position)) {
        const key = p.map((v) => v.toFixed(6)).join(',')
        expect(seen.has(key)).toBe(false)
        seen.add(key)
        expect(p[1]).toBe(0)
      }
      for (const s of L.stabilisers) {
        for (const q of s.qubits) {
          const p = L.data[q].position
          const dist = Math.hypot(p[0] - s.position[0], p[2] - s.position[2])
          expect(dist).toBeCloseTo(1.5 / Math.SQRT2, 9)
        }
      }
    })

    it(`d = ${d}: ids, types, typeIndex and supports agree with the 2-D lab's code model`, () => {
      const L = buildLattice3D(d)
      const code = buildSurfaceCode(d)
      expect(L.stabilisers.length).toBe(code.stabilisers.length)
      for (let i = 0; i < code.stabilisers.length; i++) {
        const a = L.stabilisers[i]
        const b = code.stabilisers[i]
        expect(a.id).toBe(b.id)
        expect(a.type).toBe(b.type)
        expect(a.typeIndex).toBe(b.typeIndex)
        expect(a.row).toBe(b.row)
        expect(a.col).toBe(b.col)
        expect(a.qubits).toEqual(b.qubits)
      }
    })
  }

  it('is centred on the origin with row 0 at negative z and column 0 at negative x', () => {
    const L = buildLattice3D(5)
    close(L.data[0].position, [-2, 0, -2])
    close(L.data[24].position, [2, 0, 2])
    close(L.data[12].position, [0, 0, 0])
    const sum = L.data.reduce((acc, q) => [acc[0] + q.position[0], 0, acc[2] + q.position[2]] as Vec3, [
      0, 0, 0,
    ] as Vec3)
    close(sum, [0, 0, 0])
  })

  it('refuses even and too-small distances', () => {
    expect(() => buildLattice3D(2)).toThrow()
    expect(() => buildLattice3D(4)).toThrow()
    expect(() => buildLattice3D(1)).toThrow()
  })
})

describe('errors and syndromes', () => {
  it('merges the two channel arrays into Pauli labels', () => {
    expect(errorsFromChannels([0, 1, 0, 1], [0, 0, 1, 1])).toEqual(['I', 'X', 'Z', 'Y'])
  })

  it('a single X error in the middle of d = 5 lights exactly the two Z stabilisers around it', () => {
    const L = buildLattice3D(5)
    const errors = errorsFromChannels(
      Array.from({ length: 25 }, (_, q) => (q === 12 ? 1 : 0)),
      new Array(25).fill(0)
    )
    const syn = syndromeFromErrors(L, errors)
    const lit = L.stabilisers.filter((s) => syn[s.id])
    expect(lit).toHaveLength(2)
    // Plaquettes with top-left corner (1,2) and (2,1) are the Z ones touching (2,2).
    expect(lit.map((s) => [s.type, s.row, s.col])).toEqual([
      ['Z', 1.5, 2.5],
      ['Z', 2.5, 1.5],
    ])
  })

  it('a single X error on the corner qubit lights one stabiliser: a chain to the boundary', () => {
    const L = buildLattice3D(5)
    const errors = errorsFromChannels([1, ...new Array(24).fill(0)], new Array(25).fill(0))
    const syn = syndromeFromErrors(L, errors)
    const lit = L.stabilisers.filter((s) => syn[s.id])
    expect(lit).toHaveLength(1)
    expect(lit[0].type).toBe('Z')
    expect(lit[0].col).toBe(-0.5)
  })

  it('a Y error is seen by both channels', () => {
    const L = buildLattice3D(3)
    const errors = errorsFromChannels([0, 0, 0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 0])
    const syn = syndromeFromErrors(L, errors)
    const lit = L.stabilisers.filter((s) => syn[s.id])
    expect(lit.filter((s) => s.type === 'X')).toHaveLength(2)
    expect(lit.filter((s) => s.type === 'Z')).toHaveLength(2)
  })
})

describe('time axis', () => {
  it('lifts a position by round × spacing', () => {
    close(positionAtRound([1, 0, -1], 3, 0.8), [1, 2.4, -1])
    close(positionAtRound([1, 0.5, -1], 0, 0.8), [1, 0.5, -1])
  })

  it('a stabiliser that flips once and stays flipped is one detection event, not one per round', () => {
    const rounds = [
      [false, false, false],
      [false, true, false],
      [false, true, false],
      [false, true, false],
    ]
    expect(detectionEvents(rounds)).toEqual([{ stabiliser: 1, round: 1 }])
  })

  it('a one-round blip — a measurement error — is two events on the same stabiliser', () => {
    const rounds = [
      [false, false],
      [true, false],
      [false, false],
    ]
    expect(detectionEvents(rounds)).toEqual([
      { stabiliser: 0, round: 1 },
      { stabiliser: 0, round: 2 },
    ])
  })

  it('round 0 is compared against the all-even reference', () => {
    expect(detectionEvents([[true, false, true]])).toEqual([
      { stabiliser: 0, round: 0 },
      { stabiliser: 2, round: 0 },
    ])
    expect(detectionEvents([])).toEqual([])
  })

  it('frames a flat slice by its bounding circle and a stack by its diagonal', () => {
    const L = buildLattice3D(5)
    expect(sceneRadius(L, 1, 0.8)).toBeCloseTo(L.halfExtent * Math.SQRT2, 9)
    expect(sceneRadius(L, 0, 0.8)).toBeCloseTo(L.halfExtent * Math.SQRT2, 9)
    // 6 layers at 0.8: height 4, half-height 2.
    expect(sceneRadius(L, 6, 0.8)).toBeCloseTo(Math.hypot(L.halfExtent * Math.SQRT2, 2), 9)
    expect(stackCentreY(6, 0.8)).toBeCloseTo(2, 9)
    expect(stackCentreY(1, 0.8)).toBe(0)
  })
})

describe('matching edges', () => {
  it('boundary points leave through the correct side, nearer edge first', () => {
    const L = buildLattice3D(5)
    // Plaquette with top-left corner (0, 0): r + c even, so X-type.
    const xTop = L.stabilisers.find((s) => s.type === 'X' && s.row === 0.5 && s.col === 0.5)!
    close(boundaryPoint(L, xTop), [-1.5, 0, -3]) // row −1 → z = −1 − 2 = −3
    // Row 1.5 is 2.5 from row −1 and 3.5 from row 5; row 2.5 is the other way round.
    const xHigh = L.stabilisers.find((s) => s.type === 'X' && s.row === 1.5)!
    expect(boundaryPoint(L, xHigh)[2]).toBeCloseTo(-3, 9)
    const xMid = L.stabilisers.find((s) => s.type === 'X' && s.row === 2.5)!
    expect(boundaryPoint(L, xMid)[2]).toBeCloseTo(3, 9)
    const xLow = L.stabilisers.find((s) => s.type === 'X' && s.row === 3.5)!
    expect(boundaryPoint(L, xLow)[2]).toBeCloseTo(3, 9) // row d = 5 → z = 3
    const zLeft = L.stabilisers.find((s) => s.type === 'Z' && s.col === 0.5)!
    expect(boundaryPoint(L, zLeft)[0]).toBeCloseTo(-3, 9)
    expect(boundaryPoint(L, zLeft)[2]).toBeCloseTo(zLeft.position[2], 9)
    const zRight = L.stabilisers.find((s) => s.type === 'Z' && s.col === 3.5)!
    expect(boundaryPoint(L, zRight)[0]).toBeCloseTo(3, 9)
  })

  it('a pair edge connects the two stabiliser positions at their rounds', () => {
    const L = buildLattice3D(5)
    const a = L.stabilisers.find((s) => s.type === 'Z' && s.row === 1.5 && s.col === 2.5)!
    const b = L.stabilisers.find((s) => s.type === 'Z' && s.row === 2.5 && s.col === 1.5)!
    const segs = matchingSegments(
      L,
      [{ from: { stabiliser: a.id, round: 2 }, to: { stabiliser: b.id, round: 3 } }],
      0.8
    )
    expect(segs).toHaveLength(1)
    close(segs[0].a, [0.5, 1.6, -0.5])
    close(segs[0].b, [-0.5, 2.4, 0.5])
    expect(segs[0].type).toBe('Z')
    expect(segs[0].toBoundary).toBe(false)
  })

  it('drops edges that name a missing stabiliser or cross channels', () => {
    const L = buildLattice3D(3)
    const x = L.byType.X[0]
    const z = L.byType.Z[0]
    expect(
      matchingSegments(L, [
        { from: { stabiliser: x.id }, to: { stabiliser: z.id } },
        { from: { stabiliser: 99 }, to: 'boundary' },
      ])
    ).toEqual([])
  })

  it("converts the 2-D lab's decoder output: a middle X error matches its two defects together", () => {
    const d = 5
    const L = buildLattice3D(d)
    const code = buildSurfaceCode(d)
    const errorsX = new Uint8Array(25)
    errorsX[12] = 1
    const dec = decodeChannel(code, 'Z', errorsX)
    expect(dec.defects).toHaveLength(2)
    const edges = edgesFromTypedMatching(L, 'Z', dec.defects, dec.matching.pairs)
    expect(edges).toHaveLength(1)
    const segs = matchingSegments(L, edges)
    expect(segs).toHaveLength(1)
    const ends = [segs[0].a, segs[0].b].map((p) => `${p[0]},${p[2]}`).sort()
    expect(ends).toEqual(['-0.5,0.5', '0.5,-0.5'])
  })

  it("converts the 2-D lab's decoder output: a corner X error matches to the boundary", () => {
    const L = buildLattice3D(5)
    const code = buildSurfaceCode(5)
    const errorsX = new Uint8Array(25)
    errorsX[0] = 1
    const dec = decodeChannel(code, 'Z', errorsX)
    const edges = edgesFromTypedMatching(L, 'Z', dec.defects, dec.matching.pairs, 4)
    expect(edges).toEqual([{ from: { stabiliser: expect.any(Number), round: 4 }, to: 'boundary' }])
    const segs = matchingSegments(L, edges, 0.5)
    expect(segs[0].toBoundary).toBe(true)
    expect(segs[0].a[1]).toBeCloseTo(2, 9)
    expect(segs[0].b[1]).toBeCloseTo(2, 9)
    expect(segs[0].b[0]).toBeCloseTo(-3, 9) // col −1 of d = 5
  })
})

describe('2-D fallback projection', () => {
  it('maps the world axes to the page: x right, time up, depth along a half-length 30° diagonal', () => {
    const p = (v: Vec3) => projectOblique(v, 10, 100, 200)
    expect(p([0, 0, 0])).toEqual({ x: 100, y: 200 })
    expect(p([1, 0, 0])).toEqual({ x: 110, y: 200 })
    expect(p([0, 1, 0])).toEqual({ x: 100, y: 190 })
    const depth = p([0, 0, 1])
    expect(depth.x).toBeCloseTo(100 + 5 * (Math.sqrt(3) / 2), 9)
    expect(depth.y).toBeCloseTo(200 + 2.5, 9)
  })

  it('a zero-size canvas gives scale 0 — draws nothing, throws nothing', () => {
    const L = buildLattice3D(5)
    expect(fallbackScale(L, 1, 0.8, 0, 0)).toBe(0)
    expect(fallbackScale(L, 1, 0.8, 0, 300)).toBe(0)
    expect(fallbackScale(L, 3, 0.8, 40, 300)).toBe(0)
  })

  it('at any positive size the whole stack projects inside the margin', () => {
    const L = buildLattice3D(7)
    for (const [w, h] of [
      [120, 120],
      [320, 200],
      [200, 600],
      [900, 440],
    ]) {
      for (const layers of [1, 4]) {
        const s = fallbackScale(L, layers, 0.8, w, h)
        expect(s).toBeGreaterThan(0)
        // Same placement as drawLatticeFallback: the stack's mid-height at mid-canvas.
        const cy = h / 2 + stackCentreY(layers, 0.8) * s
        const corners: Vec3[] = []
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            corners.push([sx * L.halfExtent, 0, sz * L.halfExtent])
            corners.push([sx * L.halfExtent, (layers - 1) * 0.8, sz * L.halfExtent])
          }
        }
        for (const c of corners) {
          const q = projectOblique(c, s, w / 2, cy)
          expect(q.x).toBeGreaterThanOrEqual(0)
          expect(q.x).toBeLessThanOrEqual(w)
          expect(q.y).toBeGreaterThanOrEqual(0)
          expect(q.y).toBeLessThanOrEqual(h)
        }
      }
    }
  })
})
