import { describe, it, expect } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import { buildLayout, failed, sampleShot } from './model'
import { MwpmDecoder } from './matching'

function logicalRate(d: 3 | 5 | 7, p: number, q: number, shots: number, seed: number): number {
  const layout = buildLayout(d, q)
  const dec = new MwpmDecoder(layout, p, q)
  const rand = mulberry32(seed)
  let failures = 0
  for (let i = 0; i < shots; i++) {
    const shot = sampleShot(layout, p, q, rand)
    if (failed(dec.predict(shot.detX, shot.detZ), shot)) failures++
  }
  return failures / shots
}

describe('the noise model', () => {
  it('leaves every qubit untouched with probability (1 − p)^n', () => {
    const layout = buildLayout(3, 0)
    const p = 0.1
    const rand = mulberry32(5)
    const N = 20_000
    let clean = 0
    for (let i = 0; i < N; i++) {
      const s = sampleShot(layout, p, 0, rand)
      if (s.errX.every((v) => v === 0) && s.errZ.every((v) => v === 0)) clean++
    }
    const expected = Math.pow(1 - p, 9)
    const sigma = Math.sqrt((expected * (1 - expected)) / N)
    expect(Math.abs(clean / N - expected)).toBeLessThan(4 * sigma)
  })

  it('splits errors evenly between X, Y and Z, so each channel sees 2p/3', () => {
    const layout = buildLayout(5, 0)
    const p = 0.12
    const rand = mulberry32(6)
    const N = 4_000
    let xCount = 0
    let yCount = 0
    for (let i = 0; i < N; i++) {
      const s = sampleShot(layout, p, 0, rand)
      for (let qb = 0; qb < 25; qb++) {
        if (s.errX[qb]) xCount++
        if (s.errX[qb] && s.errZ[qb]) yCount++
      }
    }
    const perQubit = N * 25
    expect(xCount / perQubit).toBeCloseTo((2 * p) / 3, 2)
    expect(yCount / perQubit).toBeCloseTo(p / 3, 2)
  })

  it('with perfect extraction the detectors are exactly the final syndrome', () => {
    const layout = buildLayout(5, 0)
    expect(layout.layers).toBe(1)
    const rand = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const s = sampleShot(layout, 0.1, 0, rand)
      layout.stabsX.forEach((st, idx) => {
        let par = 0
        for (const qb of st.qubits) par ^= s.errX[qb]
        expect(s.detX[idx]).toBe(par)
      })
    }
  })

  it('with measurement noise the per-stabiliser XOR of every layer is the final perfect syndrome', () => {
    const layout = buildLayout(5, 0.03)
    expect(layout.rounds).toBe(5)
    expect(layout.layers).toBe(6)
    const rand = mulberry32(8)
    const n = layout.stabsX.length
    for (let i = 0; i < 100; i++) {
      const s = sampleShot(layout, 0.03, 0.03, rand)
      for (let st = 0; st < n; st++) {
        let acc = 0
        for (let t = 0; t < layout.layers; t++) acc ^= s.detX[t * n + st]
        let par = 0
        for (const qb of layout.stabsX[st].qubits) par ^= s.errX[qb]
        expect(acc).toBe(par)
      }
    }
  })
})

describe('the threshold, measured', () => {
  it('below threshold, d = 5 beats d = 3 under MWPM at small p', () => {
    const p = 0.04
    const r3 = logicalRate(3, p, 0, 4000, 11)
    const r5 = logicalRate(5, p, 0, 4000, 12)
    // At p = 4% depolarising (2.7% per channel) the d = 3 rate is a few percent
    // and d = 5 is roughly a third of it; 4 000 shots separate them by many sigma.
    expect(r3).toBeGreaterThan(0.01)
    expect(r5).toBeLessThan(r3 * 0.6)
  })

  it('above threshold, the ordering inverts: more distance means more logical errors', () => {
    const p = 0.25
    const r3 = logicalRate(3, p, 0, 2000, 13)
    const r7 = logicalRate(7, p, 0, 2000, 14)
    expect(r7).toBeGreaterThan(r3)
  })

  it('with measurement noise the same ordering holds below the (lower) threshold', () => {
    const p = 0.01
    const r3 = logicalRate(3, p, p, 3000, 15)
    const r5 = logicalRate(5, p, p, 3000, 16)
    expect(r3).toBeGreaterThan(0.005)
    expect(r5).toBeLessThan(r3)
  })
})
