import { describe, it, expect } from 'vitest'
import {
  EXACT_MATCHING_LIMIT,
  anticommutes,
  buildSurfaceCode,
  decodeChannel,
  evaluateErrors,
  minWeightMatching,
  pathQubits,
  qubitCost,
  runShot,
  syndromeOf,
  type SurfaceCode,
} from './code'
import { mulberry32 } from '@/lib/quantum'

const DISTANCES = [3, 5, 7] as const

/** |A ∩ B| — X and Z Paulis on the same qubit anticommute, elsewhere they commute. */
function overlap(a: number[], b: number[]): number {
  const set = new Set(a)
  return b.filter((q) => set.has(q)).length
}

describe('the lattice really is a code', () => {
  it('has d^2 - 1 stabilisers, half of each type', () => {
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      expect(code.stabilisers.length).toBe(d * d - 1)
      expect(code.byType.X.length).toBe((d * d - 1) / 2)
      expect(code.byType.Z.length).toBe((d * d - 1) / 2)
    }
  })

  it('every pair of stabilisers commutes', () => {
    // X and Z stabilisers anticommute on each shared qubit, so a valid code needs an
    // EVEN overlap for every mixed pair. Same-type pairs always commute. Get one
    // boundary type wrong and this fails while the picture still looks like a code.
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      for (const s of code.stabilisers) {
        for (const t of code.stabilisers) {
          if (s.id >= t.id || s.type === t.type) continue
          expect(overlap(s.qubits, t.qubits) % 2, `${s.id} vs ${t.id} at d=${d}`).toBe(0)
        }
      }
    }
  })

  it('both logical operators commute with every stabiliser and anticommute with each other', () => {
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      for (const s of code.byType.Z) {
        expect(overlap(code.logicalX, s.qubits) % 2, `X̄ vs Z stabiliser ${s.id}`).toBe(0)
      }
      for (const s of code.byType.X) {
        expect(overlap(code.logicalZ, s.qubits) % 2, `Z̄ vs X stabiliser ${s.id}`).toBe(0)
      }
      expect(overlap(code.logicalX, code.logicalZ) % 2).toBe(1)
      expect(code.logicalX.length).toBe(d)
      expect(code.logicalZ.length).toBe(d)
    }
  })

  it('every stabiliser has weight 4 in the bulk and 2 on a boundary', () => {
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      const weights = code.stabilisers.map((s) => s.qubits.length)
      expect(weights.every((w) => w === 2 || w === 4)).toBe(true)
      expect(weights.filter((w) => w === 2).length).toBe(2 * (d - 1))
      expect(weights.filter((w) => w === 4).length).toBe((d - 1) ** 2)
    }
  })

  it('rejects even and too-small distances rather than drawing a non-code', () => {
    expect(() => buildSurfaceCode(4)).toThrow(/odd integer/)
    expect(() => buildSurfaceCode(2)).toThrow(/odd integer/)
    expect(() => buildSurfaceCode(3.5)).toThrow(/odd integer/)
  })

  it('quotes the physical-qubit cost the page quotes', () => {
    expect(qubitCost(3)).toEqual({ data: 9, ancilla: 8, total: 17 })
    expect(qubitCost(5)).toEqual({ data: 25, ancilla: 24, total: 49 })
    expect(qubitCost(7)).toEqual({ data: 49, ancilla: 48, total: 97 })
  })
})

describe('the decoder', () => {
  it('always leaves a residual with a trivial syndrome', () => {
    // This is the defining property of any correct decoder: whatever it proposes,
    // error ⊕ correction must commute with every stabiliser. A decoder that failed
    // this would be producing corrections that create new defects.
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      const rand = mulberry32(d * 101)
      for (let shot = 0; shot < 60; shot++) {
        const res = runShot(code, 0.08, rand)
        expect(syndromeOf(code.byType.Z, res.residualX)).toEqual([])
        expect(syndromeOf(code.byType.X, res.residualZ)).toEqual([])
      }
    }
  })

  it('corrects every single-qubit error at every distance', () => {
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      for (let q = 0; q < code.numData; q++) {
        const ex = new Uint8Array(code.numData)
        ex[q] = 1
        const res = evaluateErrors(code, ex, new Uint8Array(code.numData))
        expect(res.logicalXError, `d=${d} single X error on qubit ${q}`).toBe(false)
        const ez = new Uint8Array(code.numData)
        ez[q] = 1
        const res2 = evaluateErrors(code, new Uint8Array(code.numData), ez)
        expect(res2.logicalZError, `d=${d} single Z error on qubit ${q}`).toBe(false)
      }
    }
  })

  it('corrects every pattern of up to floor((d-1)/2) errors — the code distance guarantee', () => {
    // d = 3 corrects 1, d = 5 corrects 2. This is the promise the code makes, and it
    // is the reason a logical qubit costs so many physical ones.
    for (const d of [3, 5] as const) {
      const code = buildSurfaceCode(d)
      const t = (d - 1) / 2
      const combos = combinations(code.numData, t)
      for (const combo of combos) {
        const ex = new Uint8Array(code.numData)
        for (const q of combo) ex[q] = 1
        const res = evaluateErrors(code, ex, new Uint8Array(code.numData))
        expect(res.logicalXError, `d=${d} errors ${combo.join(',')}`).toBe(false)
      }
    }
  })

  it('does fail on a weight-((d+1)/2) chain across the lattice', () => {
    // The complement of the guarantee: a decoder that never failed would not be a
    // decoder, it would be a bug. A vertical X chain of length (d+1)/2 starting at
    // the top boundary is matched the short way, and the residual is a logical X̄.
    const d = 3
    const code = buildSurfaceCode(d)
    const ex = new Uint8Array(code.numData)
    ex[0] = 1
    ex[3] = 1 // (0,0) and (1,0) — two of the three qubits of the logical column
    const res = evaluateErrors(code, ex, new Uint8Array(code.numData))
    expect(res.logicalXError).toBe(true)
    expect(syndromeOf(code.byType.Z, res.residualX)).toEqual([])
  })

  it('reports whether the matching was exact', () => {
    const code = buildSurfaceCode(7)
    const rand = mulberry32(9)
    let sawExact = false
    for (let i = 0; i < 200; i++) {
      const res = runShot(code, 0.05, rand)
      if (res.decX.matching.exact) sawExact = true
      // The flag must agree with the rule it documents.
      expect(res.decX.matching.exact).toBe(res.decX.defects.length <= EXACT_MATCHING_LIMIT)
    }
    expect(sawExact).toBe(true)
  })

  it('correction chains only touch data qubits that exist', () => {
    const code = buildSurfaceCode(5)
    const rand = mulberry32(4)
    for (let i = 0; i < 40; i++) {
      const res = runShot(code, 0.1, rand)
      for (const chain of [...res.decX.chains, ...res.decZ.chains]) {
        for (const q of chain.qubits) {
          expect(q).toBeGreaterThanOrEqual(0)
          expect(q).toBeLessThan(code.numData)
        }
      }
    }
  })
})

describe('minWeightMatching', () => {
  it('finds the genuine optimum, not a greedy one', () => {
    // Classic greedy trap: taking the cheapest single edge (0,1) = 1 first strands
    // 2 and 3, which can then only go to the boundary at 50 each — 101 in total.
    // Pairing (0,2) and (1,3) costs 3 + 3 = 6. Greedy returns 101; MWPM returns 6.
    const w = [
      [0, 1, 3, 100],
      [1, 0, 100, 3],
      [3, 100, 0, 100],
      [100, 3, 100, 0],
    ]
    const m = minWeightMatching([10, 11, 12, 13], (i, j) => w[i][j], () => 50)
    expect(m.exact).toBe(true)
    expect(m.weight).toBe(6)
  })

  it('matches an odd number of defects by sending one to the boundary', () => {
    const m = minWeightMatching([0, 1, 2], () => 10, () => 1)
    expect(m.weight).toBe(3)
    expect(m.pairs.every((p) => p.to === -1)).toBe(true)
  })

  it('is empty for an empty syndrome', () => {
    expect(minWeightMatching([], () => 1, () => 1)).toEqual({ pairs: [], weight: 0, exact: true })
  })
})

describe('logical error rate falls with distance below threshold', () => {
  it('d=5 beats d=3 at p=2%, and the ordering reverses well above threshold', () => {
    // The whole point of the visualization, asserted. Below threshold, spending more
    // physical qubits buys a better logical qubit; above it, spending more makes
    // things worse. A test that only checked "d=5 is better" would pass for a
    // decoder that ignored p entirely.
    const low = [3, 5].map((d) => failureRate(buildSurfaceCode(d), 0.02, 4000, d))
    expect(low[1]).toBeLessThan(low[0])

    const high = [3, 5].map((d) => failureRate(buildSurfaceCode(d), 0.28, 3000, d))
    expect(high[1]).toBeGreaterThan(high[0])
  })

  it('reports zero failures at p = 0', () => {
    for (const d of DISTANCES) {
      expect(failureRate(buildSurfaceCode(d), 0, 200, d)).toBe(0)
    }
  })
})

function failureRate(code: SurfaceCode, p: number, shots: number, seed: number): number {
  const rand = mulberry32(seed * 7919 + 13)
  let failures = 0
  for (let i = 0; i < shots; i++) if (runShot(code, p, rand).failed) failures++
  return failures / shots
}

/** All size-k subsets of [0, n). Only used with tiny k. */
function combinations(n: number, k: number): number[][] {
  if (k === 0) return [[]]
  const out: number[][] = []
  const pick = (start: number, acc: number[]): void => {
    if (acc.length === k) {
      out.push(acc.slice())
      return
    }
    for (let i = start; i < n; i++) {
      acc.push(i)
      pick(i + 1, acc)
      acc.pop()
    }
  }
  pick(0, [])
  return out
}

describe('anticommutes', () => {
  it('is the parity of the overlap', () => {
    const e = new Uint8Array([1, 0, 1, 1])
    expect(anticommutes(e, [0])).toBe(true)
    expect(anticommutes(e, [0, 2])).toBe(false)
    expect(anticommutes(e, [0, 2, 3])).toBe(true)
    expect(anticommutes(e, [1])).toBe(false)
  })
})

describe('decodeChannel', () => {
  it('produces no correction for a clean lattice', () => {
    const code = buildSurfaceCode(5)
    const dec = decodeChannel(code, 'Z', new Uint8Array(code.numData))
    expect(dec.defects).toEqual([])
    expect(Array.from(dec.correction).every((v) => v === 0)).toBe(true)
  })
})

describe('the syndrome graph', () => {
  it('leaves no data qubit invisible to either stabiliser type', () => {
    // A data qubit in no stabiliser of a type would carry an error of that type that
    // nothing can ever detect — the code would silently have a lower distance than it
    // claims. `invisibleQubits` exists to make that checkable rather than assumed.
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      expect(code.graphs.X.invisibleQubits).toEqual([])
      expect(code.graphs.Z.invisibleQubits).toEqual([])
    }
  })

  it('gives every stabiliser a finite distance to the boundary', () => {
    // Otherwise an odd syndrome could not be matched at all and the decoder would
    // silently drop a defect.
    for (const d of DISTANCES) {
      const code = buildSurfaceCode(d)
      for (const type of ['X', 'Z'] as const) {
        const g = code.graphs[type]
        for (let s = 0; s < g.n; s++) {
          expect(g.dist[s][g.n]).toBeLessThan(0x7fffffff)
          expect(g.dist[s][g.n]).toBeGreaterThan(0)
          expect(pathQubits(g, s, g.n).length).toBe(g.dist[s][g.n])
        }
      }
    }
  })
})
