import { describe, it, expect } from 'vitest'
import {
  WORKGROUP_SIZE,
  MAX_WORKGROUPS_PER_DIM,
  controlMask,
  dimension,
  dispatchFor,
  insertBit,
  linearIndex,
  pairLower,
  passesMask,
  swapLower,
  workItems,
} from './indexing'

/**
 * Independent oracle for the pair enumeration: the set of lower indices a
 * single-qubit gate touches is every i in [0, dim) with bit t clear. This is
 * exactly the loop StateVector.applySingle runs (`if (i & bit) continue`).
 */
function expectedLowerIndices(numQubits: number, target: number): number[] {
  const dim = 1 << numQubits
  const out: number[] = []
  for (let i = 0; i < dim; i++) if (((i >> target) & 1) === 0) out.push(i)
  return out
}

describe('insertBit', () => {
  it('matches hand-computed examples', () => {
    expect(insertBit(0b101, 1, 0)).toBe(0b1001)
    expect(insertBit(0b101, 1, 1)).toBe(0b1011)
    expect(insertBit(0b11, 0, 0)).toBe(0b110)
    expect(insertBit(0b11, 2, 1)).toBe(0b111)
    expect(insertBit(0, 5, 1)).toBe(32)
  })

  it('is a bijection from [0, dim/2) onto the indices with the target bit clear', () => {
    for (let n = 1; n <= 8; n++) {
      for (let t = 0; t < n; t++) {
        const got = Array.from({ length: 1 << (n - 1) }, (_, k) => pairLower(k, t))
        expect(got).toEqual(expectedLowerIndices(n, t))
      }
    }
  })

  it('keeps bit 31 unsigned', () => {
    expect(insertBit((1 << 30) >>> 0, 0, 1)).toBe(2 ** 31 + 1)
  })
})

describe('controlMask / passesMask', () => {
  it('sets one bit per control', () => {
    expect(controlMask([0, 2], 1, 3)).toBe(0b101)
    expect(controlMask([], 0, 1)).toBe(0)
  })

  it('rejects a control equal to the target, a duplicate, and an out-of-range qubit', () => {
    expect(() => controlMask([1], 1, 2)).toThrow(/cannot also be the target/)
    expect(() => controlMask([0, 0], 1, 2)).toThrow(/listed twice/)
    expect(() => controlMask([5], 0, 2)).toThrow(/out of range/)
  })

  it('passesMask agrees with the engine\'s (i & cmask) === cmask test', () => {
    const mask = 0b1010
    for (let i = 0; i < 32; i++) expect(passesMask(i, mask)).toBe((i & mask) === mask)
    expect(passesMask(7, 0)).toBe(true)
  })

  it('a CCX on 8 qubits touches exactly 2^(8-3) pairs', () => {
    const mask = controlMask([1, 5], 3, 8)
    let hits = 0
    for (let k = 0; k < workItems.gate(256); k++) if (passesMask(pairLower(k, 3), mask)) hits++
    expect(hits).toBe(32)
  })
})

describe('swapLower', () => {
  it('enumerates every index with a=0, b=1 exactly once, for either argument order', () => {
    for (let n = 2; n <= 7; n++) {
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          if (a === b) continue
          const dim = 1 << n
          const expected: number[] = []
          for (let i = 0; i < dim; i++) {
            if (((i >> a) & 1) === 0 && ((i >> b) & 1) === 1) expected.push(i)
          }
          const got = Array.from({ length: workItems.swap(dim) }, (_, k) => swapLower(k, a, b)).sort((x, y) => x - y)
          expect(got).toEqual(expected)
        }
      }
    }
  })

  it('partners differ in exactly bits a and b', () => {
    const i = swapLower(5, 1, 4)
    const j = i ^ (1 << 1) ^ (1 << 4)
    expect((i >> 1) & 1).toBe(0)
    expect((i >> 4) & 1).toBe(1)
    expect((j >> 1) & 1).toBe(1)
    expect((j >> 4) & 1).toBe(0)
  })
})

describe('dimension', () => {
  it('is 2^n and rejects nonsense', () => {
    expect(dimension(1)).toBe(2)
    expect(dimension(20)).toBe(1048576)
    expect(() => dimension(0)).toThrow()
    expect(() => dimension(31)).toThrow()
    expect(() => dimension(2.5)).toThrow()
  })
})

describe('dispatchFor', () => {
  it('rounds up to whole workgroups and never dispatches zero', () => {
    expect(dispatchFor(0)).toEqual({ x: 1, y: 1, groups: 1 })
    expect(dispatchFor(1)).toEqual({ x: 1, y: 1, groups: 1 })
    expect(dispatchFor(256)).toEqual({ x: 1, y: 1, groups: 1 })
    expect(dispatchFor(257)).toEqual({ x: 2, y: 1, groups: 2 })
  })

  it('folds into 2-D past 65535 workgroups (a 25-qubit gate)', () => {
    const items = 2 ** 25 // pairs of a 26-qubit gate
    const d = dispatchFor(items)
    expect(d.groups).toBe(2 ** 25 / WORKGROUP_SIZE)
    expect(d.x).toBe(MAX_WORKGROUPS_PER_DIM)
    expect(d.y).toBe(Math.ceil(d.groups / MAX_WORKGROUPS_PER_DIM))
    expect(d.x * d.y).toBeGreaterThanOrEqual(d.groups)
  })

  it('a 2-D dispatch covers every item and linearIndex is injective over it', () => {
    const items = 1000
    const d = dispatchFor(items, 8, 16) // tiny limits: 125 groups of 8, folded at 16 per row
    expect(d).toEqual({ x: 16, y: 8, groups: 125 })
    expect(() => dispatchFor(items, 8, 4)).toThrow(/2-D dispatch/)
    const seen = new Set<number>()
    for (let wy = 0; wy < d.y; wy++) {
      for (let wx = 0; wx < d.x; wx++) {
        for (let lid = 0; lid < 8; lid++) {
          const k = linearIndex(wx * 8 + lid, wy, d.x, 8)
          expect(seen.has(k)).toBe(false)
          seen.add(k)
        }
      }
    }
    for (let k = 0; k < items; k++) expect(seen.has(k)).toBe(true)
  })

  it('rejects a negative item count', () => {
    expect(() => dispatchFor(-1)).toThrow()
  })
})
