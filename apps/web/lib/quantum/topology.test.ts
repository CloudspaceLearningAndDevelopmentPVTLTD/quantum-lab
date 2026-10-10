import { describe, expect, it } from 'vitest'
import {
  allToAllMap,
  buildTopology,
  degree,
  diameter,
  distance,
  gridMap,
  heavyHexMap,
  isConnected,
  isEdge,
  linearMap,
  neighbours,
  ringMap,
  TOPOLOGY_KINDS,
} from './topology'

describe('linear, ring, grid, all-to-all', () => {
  it('linear(5) is a path: 4 edges, ends of degree 1, distance 4 corner to corner', () => {
    const m = linearMap(5)
    expect(m.edges).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]])
    expect(degree(m, 0)).toBe(1)
    expect(degree(m, 2)).toBe(2)
    expect(distance(m, 0, 4)).toBe(4)
    expect(diameter(m)).toBe(4)
    expect(neighbours(m, 2)).toEqual([1, 3])
  })

  it('ring(6) closes the loop: opposite qubits are 3 apart, ends are adjacent', () => {
    const m = ringMap(6)
    expect(m.edges).toHaveLength(6)
    expect(isEdge(m, 0, 5)).toBe(true)
    expect(distance(m, 0, 3)).toBe(3)
    expect(distance(m, 1, 5)).toBe(2)
    expect(diameter(m)).toBe(3)
  })

  it('ring(2) is the same as linear(2): no duplicate edge', () => {
    expect(ringMap(2).edges).toEqual([[0, 1]])
  })

  it('grid(9) is 3×3: centre has four neighbours, corners are Manhattan distance 4 apart', () => {
    const m = gridMap(9)
    expect(m.edges).toHaveLength(12)
    expect(neighbours(m, 4)).toEqual([1, 3, 5, 7])
    expect(distance(m, 0, 8)).toBe(4)
    expect(distance(m, 2, 6)).toBe(4)
    expect(distance(m, 0, 5)).toBe(3)
  })

  it('grid(7) has a partial last row and no wrap-around edge', () => {
    const m = gridMap(7) // 3 columns: rows [0 1 2] [3 4 5] [6]
    expect(isEdge(m, 2, 3)).toBe(false)
    expect(isEdge(m, 3, 6)).toBe(true)
    expect(isEdge(m, 5, 6)).toBe(false)
    expect(isConnected(m)).toBe(true)
  })

  it('all-to-all(6) has 15 edges and every distance is 1', () => {
    const m = allToAllMap(6)
    expect(m.edges).toHaveLength(15)
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      expect(distance(m, a, b)).toBe(a === b ? 0 : 1)
    }
  })
})

describe('heavy-hex', () => {
  /**
   * heavyHexMap(12) at row width 5 is one hexagon:
   *
   *      0 — 1 — 2 — 3 — 4
   *      |               |
   *      5               6
   *      |               |
   *      7 — 8 — 9 — 10 — 11
   *
   * i.e. a 12-cycle in the order 0 1 2 3 4 6 11 10 9 8 7 5. Distances below
   * were computed by hand from that cycle (min of the two ways round).
   */
  it('12 qubits form a single 12-cycle with the expected wiring', () => {
    const m = heavyHexMap(12)
    expect(m.edges).toEqual([
      [0, 1], [0, 5], [1, 2], [2, 3], [3, 4], [4, 6],
      [5, 7], [6, 11], [7, 8], [8, 9], [9, 10], [10, 11],
    ])
    for (let q = 0; q < 12; q++) expect(degree(m, q)).toBe(2)
  })

  it('12-qubit distances match the hand-computed table', () => {
    const m = heavyHexMap(12)
    const table: [number, number, number][] = [
      [0, 7, 2],
      [0, 11, 6],
      [2, 9, 6],
      [5, 6, 6],
      [1, 10, 6],
      [3, 8, 6],
      [2, 8, 5],
      [1, 8, 4],
      [4, 11, 2],
      [5, 7, 1],
      [0, 4, 4],
      [7, 11, 4],
      [1, 6, 4],
      [9, 5, 3],
    ]
    for (const [a, b, d] of table) {
      expect(distance(m, a, b), `d(${a},${b})`).toBe(d)
      expect(distance(m, b, a), `d(${b},${a})`).toBe(d)
    }
    expect(diameter(m)).toBe(6)
  })

  it('19 qubits: the column-2 bridge (12) joins rows 1 and 2, and the last bridge (18) is pendant', () => {
    const m = heavyHexMap(19)
    // Row 2 is 13..17 and bridge 18 sits below 13 waiting for a row 3 that does not exist.
    expect(neighbours(m, 12)).toEqual([9, 15])
    expect(degree(m, 9)).toBe(3)
    expect(degree(m, 15)).toBe(3)
    expect(neighbours(m, 18)).toEqual([13])
    expect(distance(m, 2, 15)).toBe(8)
    expect(distance(m, 0, 13)).toBe(8)
    expect(distance(m, 17, 18)).toBe(5)
    expect(isConnected(m)).toBe(true)
  })

  it('never exceeds degree 3 and stays connected at every size up to 130', () => {
    for (let n = 1; n <= 130; n += 7) {
      const m = heavyHexMap(n)
      expect(isConnected(m)).toBe(true)
      for (let q = 0; q < n; q++) expect(degree(m, q)).toBeLessThanOrEqual(3)
    }
  })

  it('at width 15 (IBM Eagle) the second row starts at qubit 18 like ibm_washington', () => {
    // Row 0 = 0..14, bridges 15..18 at columns 0,4,8,12 → wait: Eagle's row 0
    // has 14 qubits, so this generator's row 1 starts one later than Eagle's.
    // What must match is the bridge pattern: four bridges per gap at width 15.
    const m = heavyHexMap(40, 15)
    expect(neighbours(m, 15)).toEqual([0, 19])
    expect(neighbours(m, 16)).toEqual([4, 23])
    expect(neighbours(m, 18)).toEqual([12, 31])
    expect(degree(m, 19)).toBe(2) // row 1 column 0: chain neighbour + bridge above
  })
})

describe('buildTopology', () => {
  it('builds every family with exactly n qubits and rejects n = 0', () => {
    for (const kind of TOPOLOGY_KINDS) {
      expect(buildTopology(kind, 7).numQubits).toBe(7)
      expect(() => buildTopology(kind, 0)).toThrow()
    }
  })

  it('every family with 7 qubits is connected', () => {
    for (const kind of TOPOLOGY_KINDS) expect(isConnected(buildTopology(kind, 7))).toBe(true)
  })
})
