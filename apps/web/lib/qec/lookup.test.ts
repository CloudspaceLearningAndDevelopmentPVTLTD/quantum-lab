import { describe, it, expect } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import { buildLayout, sampleShot, type Layout } from './model'
import { LookupDecoder } from './lookup'
import { MwpmDecoder } from './matching'

/**
 * Independent reference for the d = 3 lookup decoder: enumerate all 4⁹ Pauli
 * patterns on the nine data qubits under depolarising p, group them by the
 * detector pattern they produce, and read off the maximum-likelihood decoder's
 * exact failure rate — Σ over syndromes of (P(syndrome) − max over classes of
 * P(syndrome, class)). Nothing here calls the decoder; the syndrome is computed
 * from the stabiliser supports directly.
 */
function enumerate(layout: Layout, p: number) {
  const { code, stabsX, stabsZ } = layout
  const n = code.numData
  const groups = new Map<string, { total: number; byClass: number[] }>()
  const errX = new Uint8Array(n)
  const errZ = new Uint8Array(n)
  const total = Math.pow(4, n)
  for (let code4 = 0; code4 < total; code4++) {
    let prob = 1
    let c = code4
    for (let qb = 0; qb < n; qb++) {
      const pauli = c & 3
      c >>= 2
      errX[qb] = pauli === 1 || pauli === 2 ? 1 : 0
      errZ[qb] = pauli === 2 || pauli === 3 ? 1 : 0
      prob *= pauli === 0 ? 1 - p : p / 3
    }
    let key = ''
    for (const s of stabsX) {
      let par = 0
      for (const qb of s.qubits) par ^= errX[qb]
      key += par
    }
    key += '|'
    for (const s of stabsZ) {
      let par = 0
      for (const qb of s.qubits) par ^= errZ[qb]
      key += par
    }
    let fx = 0
    for (const qb of code.logicalZ) fx ^= errX[qb]
    let fz = 0
    for (const qb of code.logicalX) fz ^= errZ[qb]
    const cls = fx | (fz << 1)
    let g = groups.get(key)
    if (!g) {
      g = { total: 0, byClass: [0, 0, 0, 0] }
      groups.set(key, g)
    }
    g.total += prob
    g.byClass[cls] += prob
  }
  let mlFailure = 0
  for (const g of groups.values()) mlFailure += g.total - Math.max(...g.byClass)
  return { groups, mlFailure }
}

/** Exact failure rate of any decoder at d = 3 with perfect extraction, by the same enumeration. */
function exactFailureRate(
  layout: Layout,
  groups: ReturnType<typeof enumerate>['groups'],
  predict: (detX: Uint8Array, detZ: Uint8Array) => { flipX: number; flipZ: number }
): number {
  let failure = 0
  for (const [key, g] of groups) {
    const [x, z] = key.split('|')
    const detX = Uint8Array.from(x, (ch) => Number(ch))
    const detZ = Uint8Array.from(z, (ch) => Number(ch))
    const pred = predict(detX, detZ)
    const cls = pred.flipX | (pred.flipZ << 1)
    failure += g.total - g.byClass[cls]
  }
  return failure
}

describe('the d = 3 lookup decoder', () => {
  const layout = buildLayout(3, 0)
  const p = 0.1
  const { groups, mlFailure } = enumerate(layout, p)

  it('the enumeration covers 256 syndromes whose probabilities sum to one', () => {
    expect(groups.size).toBe(256)
    let sum = 0
    for (const g of groups.values()) sum += g.total
    expect(sum).toBeCloseTo(1, 9)
    // The optimum at p = 10%: 10.19%. Pinned so a change to the lattice or the
    // noise model that moves the reference itself is noticed, not absorbed.
    expect(mlFailure).toBeCloseTo(0.10186, 4)
  })

  it('trained on enough samples, its exact failure rate is within 2% of the maximum-likelihood optimum', () => {
    const table = new LookupDecoder()
    const rand = mulberry32(2024)
    for (let i = 0; i < 300_000; i++) table.observe(sampleShot(layout, p, 0, rand))
    expect(table.keys).toBe(256)
    const rate = exactFailureRate(layout, groups, (x, z) => table.predict(x, z))
    expect(rate).toBeGreaterThanOrEqual(mlFailure - 1e-12)
    expect(rate / mlFailure).toBeLessThan(1.02)
  })

  it('beats MWPM at d = 3, which decodes the two channels independently', () => {
    // Under depolarising noise a Y error fires both channels; the table sees the
    // joint pattern and MWPM cannot. Maximum likelihood on the joint syndrome is
    // therefore strictly better, and the exact rates say by how much.
    const mwpm = new MwpmDecoder(layout, p, 0)
    const mwpmRate = exactFailureRate(layout, groups, (x, z) => mwpm.predict(x, z))
    expect(mwpmRate).toBeGreaterThan(mlFailure)
    expect(mwpmRate / mlFailure).toBeGreaterThan(1.05)
  })

  it('falls back to no-flip on a syndrome it never saw, and counts the miss', () => {
    const table = new LookupDecoder()
    const rand = mulberry32(1)
    for (let i = 0; i < 50; i++) table.observe(sampleShot(layout, 0.01, 0, rand))
    const detX = new Uint8Array(layout.sizeX).fill(1)
    const detZ = new Uint8Array(layout.sizeZ).fill(1)
    expect(table.predict(detX, detZ)).toEqual({ flipX: 0, flipZ: 0 })
    expect(table.misses).toBe(1)
  })
})
