import { describe, expect, it } from 'vitest'
import {
  basisLabels,
  bellPairAmplitudes,
  bellPairDensityMatrix,
  densityMatrix,
  isHermitian,
  maxMagnitude,
  maximallyMixed,
  partialTrace,
  purity,
  qubitCount,
  reducedBellQubit,
  reducedState,
  trace,
  type Complex,
  type ComplexMatrix,
} from './densityMatrixView'
import { mulberry32 } from '@/lib/quantum'

/**
 * Every expected matrix here is written down from the textbook formula, by hand
 * — never read back from the functions under test. Where a state is built, the
 * amplitudes are placed with explicit bit arithmetic (qubit q ↔ bit q) so the
 * index convention is checked as well as the algebra.
 */

const z = (re: number, im = 0): Complex => ({ re, im })
const TOL = 1e-12

function expectMatrix(actual: ComplexMatrix, expected: ComplexMatrix, tol = TOL): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].length).toBe(expected[i].length)
    for (let j = 0; j < expected[i].length; j++) {
      expect(actual[i][j].re).toBeCloseTo(expected[i][j].re, 10)
      expect(actual[i][j].im).toBeCloseTo(expected[i][j].im, 10)
      // toBeCloseTo(…, 10) is 5e-11; the explicit tol below is tighter for the exact cases.
      expect(Math.abs(actual[i][j].re - expected[i][j].re)).toBeLessThan(Math.max(tol, 5e-11))
    }
  }
}

/** A seeded random normalised n-qubit statevector, built without the simulator. */
function randomState(numQubits: number, seed: number): Complex[] {
  const rand = mulberry32(seed)
  const dim = 1 << numQubits
  const amps = Array.from({ length: dim }, () => z(rand() * 2 - 1, rand() * 2 - 1))
  const norm = Math.sqrt(amps.reduce((s, a) => s + a.re * a.re + a.im * a.im, 0))
  return amps.map((a) => z(a.re / norm, a.im / norm))
}

/** Single-qubit state cos(a)|0⟩ + e^{ib} sin(a)|1⟩ as a length-2 amplitude list. */
function qubit(a: number, b: number): Complex[] {
  return [z(Math.cos(a)), z(Math.sin(a) * Math.cos(b), Math.sin(a) * Math.sin(b))]
}

/** Its density matrix, from the closed form [[cos²a, cos a sin a e^{-ib}], [cos a sin a e^{ib}, sin²a]]. */
function qubitRho(a: number, b: number): ComplexMatrix {
  const cs = Math.cos(a) * Math.sin(a)
  return [
    [z(Math.cos(a) ** 2), z(cs * Math.cos(b), -cs * Math.sin(b))],
    [z(cs * Math.cos(b), cs * Math.sin(b)), z(Math.sin(a) ** 2)],
  ]
}

/** |ψ⟩ on qubit 0 ⊗ |φ⟩ on qubit 1, placed by bit arithmetic: amp[i] = ψ[bit0(i)] · φ[bit1(i)]. */
function product(psi: Complex[], phi: Complex[]): Complex[] {
  const out: Complex[] = []
  for (let i = 0; i < 4; i++) {
    const p = psi[i & 1]
    const q = phi[(i >> 1) & 1]
    out.push(z(p.re * q.re - p.im * q.im, p.re * q.im + p.im * q.re))
  }
  return out
}

/** Apply a 2×2 unitary to qubit q of an amplitude list, by hand. */
function applyOnQubit(amps: Complex[], q: number, u: ComplexMatrix): Complex[] {
  const out = amps.map((a) => z(a.re, a.im))
  const mul = (m: Complex, v: Complex) => z(m.re * v.re - m.im * v.im, m.re * v.im + m.im * v.re)
  for (let i = 0; i < amps.length; i++) {
    if ((i >> q) & 1) continue
    const j = i | (1 << q)
    const a0 = amps[i]
    const a1 = amps[j]
    const n0 = mul(u[0][0], a0)
    const n1 = mul(u[0][1], a1)
    const m0 = mul(u[1][0], a0)
    const m1 = mul(u[1][1], a1)
    out[i] = z(n0.re + n1.re, n0.im + n1.im)
    out[j] = z(m0.re + m1.re, m0.im + m1.im)
  }
  return out
}

const RY = (t: number): ComplexMatrix => [
  [z(Math.cos(t / 2)), z(-Math.sin(t / 2))],
  [z(Math.sin(t / 2)), z(Math.cos(t / 2))],
]
const RZ = (t: number): ComplexMatrix => [
  [z(Math.cos(t / 2), -Math.sin(t / 2)), z(0)],
  [z(0), z(Math.cos(t / 2), Math.sin(t / 2))],
]
const HAD: ComplexMatrix = [
  [z(Math.SQRT1_2), z(Math.SQRT1_2)],
  [z(Math.SQRT1_2), z(-Math.SQRT1_2)],
]

const I2 = maximallyMixed(2)

describe('densityMatrix', () => {
  it('has unit trace and is Hermitian for random pure states of 1–4 qubits', () => {
    for (let n = 1; n <= 4; n++) {
      for (let seed = 1; seed <= 3; seed++) {
        const rho = densityMatrix(randomState(n, seed * 7919 + n))
        const t = trace(rho)
        expect(t.re).toBeCloseTo(1, 12)
        expect(t.im).toBeCloseTo(0, 12)
        expect(isHermitian(rho)).toBe(true)
        expect(rho.length).toBe(1 << n)
      }
    }
  })

  it('reproduces the closed-form single-qubit ρ, including the phase in the coherences', () => {
    const a = 0.7
    const b = 2.1
    expectMatrix(densityMatrix(qubit(a, b)), qubitRho(a, b))
  })

  it('Bell state Φ⁺: 1/2 at the four corners and zero everywhere else', () => {
    const h = z(0.5)
    const o = z(0)
    expectMatrix(bellPairDensityMatrix(), [
      [h, o, o, h],
      [o, o, o, o],
      [o, o, o, o],
      [h, o, o, h],
    ])
  })
})

describe('purity', () => {
  it('is 1 for every pure state', () => {
    for (let n = 1; n <= 4; n++) {
      expect(purity(densityMatrix(randomState(n, 31 + n)))).toBeCloseTo(1, 12)
    }
    expect(purity(bellPairDensityMatrix())).toBeCloseTo(1, 12)
  })

  it('is 1/d for the maximally mixed state', () => {
    for (const d of [2, 4, 8]) expect(purity(maximallyMixed(d))).toBeCloseTo(1 / d, 12)
  })

  it('of the reduced RY(θ)·CX state is cos⁴(θ/2) + sin⁴(θ/2)', () => {
    // RY(θ) on qubit 0 then CX(0→1) gives cos(θ/2)|00⟩ + sin(θ/2)|11⟩; the reduced
    // state of either qubit is diag(cos², sin²), whose purity is the sum of squares.
    for (const theta of [0, 0.4, Math.PI / 3, Math.PI / 2, 2.5, Math.PI]) {
      const c2 = Math.cos(theta / 2)
      const s2 = Math.sin(theta / 2)
      const amps = [z(c2), z(0), z(0), z(s2)]
      const rho = densityMatrix(amps)
      const expected = c2 ** 4 + s2 ** 4
      expect(purity(reducedState(rho, 2, [0]))).toBeCloseTo(expected, 12)
      expect(purity(reducedState(rho, 2, [1]))).toBeCloseTo(expected, 12)
    }
  })
})

describe('partialTrace', () => {
  it('of a Bell pair is I/2 whichever qubit is kept', () => {
    const rho = bellPairDensityMatrix()
    expectMatrix(partialTrace(rho, 2, [1]), I2)
    expectMatrix(partialTrace(rho, 2, [0]), I2)
    expectMatrix(reducedBellQubit(0), I2)
    expectMatrix(reducedBellQubit(1), I2)
  })

  it('of a product state returns each factor’s own ρ, respecting qubit ↔ bit position', () => {
    const psi = qubit(0.4, 1.1) // on qubit 0
    const phi = qubit(1.2, -0.6) // on qubit 1
    const rho = densityMatrix(product(psi, phi))
    expect(trace(rho).re).toBeCloseTo(1, 12)
    // Keep qubit 0 (trace out 1) → ψ's ρ; keep qubit 1 → φ's ρ. Swapping these
    // would silently pass with identical factors, so the two are deliberately different.
    expectMatrix(partialTrace(rho, 2, [1]), qubitRho(0.4, 1.1))
    expectMatrix(partialTrace(rho, 2, [0]), qubitRho(1.2, -0.6))
    // Product state ⇒ both parts are still pure.
    expect(purity(partialTrace(rho, 2, [1]))).toBeCloseTo(1, 12)
  })

  it('preserves the trace and Hermiticity, and reduces the dimension by 2 per traced qubit', () => {
    const rho = densityMatrix(randomState(4, 99))
    const r = partialTrace(rho, 4, [0, 2])
    expect(r.length).toBe(4)
    expect(trace(r).re).toBeCloseTo(1, 12)
    expect(trace(r).im).toBeCloseTo(0, 12)
    expect(isHermitian(r)).toBe(true)
    expect(partialTrace(rho, 4, []).length).toBe(16)
    expect(partialTrace(rho, 4, [0, 1, 2, 3])).toEqual([[expect.objectContaining({ re: expect.closeTo(1, 12) })]])
  })

  it('GHZ: tracing one qubit leaves (|00⟩⟨00| + |11⟩⟨11|)/2, tracing two leaves I/2', () => {
    const s = Math.SQRT1_2
    const amps: Complex[] = Array.from({ length: 8 }, () => z(0))
    amps[0] = z(s) // |000⟩
    amps[7] = z(s) // |111⟩
    const rho = densityMatrix(amps)
    const h = z(0.5)
    const o = z(0)
    const separable = [
      [h, o, o, o],
      [o, o, o, o],
      [o, o, o, o],
      [o, o, o, h],
    ]
    for (const q of [0, 1, 2]) {
      expectMatrix(partialTrace(rho, 3, [q]), separable)
    }
    expectMatrix(partialTrace(rho, 3, [1, 2]), I2)
    expectMatrix(partialTrace(rho, 3, [0, 1]), I2)
    // The two-qubit remainder is itself mixed: purity 1/2.
    expect(purity(partialTrace(rho, 3, [2]))).toBeCloseTo(0.5, 12)
  })

  it('W state: each qubit alone is diag(2/3, 1/3)', () => {
    const w = 1 / Math.sqrt(3)
    const amps: Complex[] = Array.from({ length: 8 }, () => z(0))
    amps[1] = z(w) // |001⟩
    amps[2] = z(w) // |010⟩
    amps[4] = z(w) // |100⟩
    const rho = densityMatrix(amps)
    for (const q of [0, 1, 2]) {
      expectMatrix(reducedState(rho, 3, [q]), [
        [z(2 / 3), z(0)],
        [z(0), z(1 / 3)],
      ])
    }
  })

  it('rejects a matrix whose size disagrees with numQubits and out-of-range qubits', () => {
    expect(() => partialTrace(I2, 2, [0])).toThrow()
    expect(() => partialTrace(bellPairDensityMatrix(), 2, [2])).toThrow()
    expect(() => partialTrace(bellPairDensityMatrix(), 2, [-1])).toThrow()
  })
})

describe('no-signalling on a Bell pair', () => {
  it('any unitary on qubit 0 leaves qubit 1’s reduced state exactly I/2', () => {
    const bell = bellPairAmplitudes()
    const gates: [string, ComplexMatrix][] = [
      ['RY(0.9)', RY(0.9)],
      ['RZ(2.3)', RZ(2.3)],
      ['H', HAD],
      ['RY(π/3)', RY(Math.PI / 3)],
    ]
    for (const [, u] of gates) {
      const rotated = applyOnQubit(bell, 0, u)
      const rho = densityMatrix(rotated)
      // The whole state has changed…
      expect(purity(rho)).toBeCloseTo(1, 12)
      // …but the other qubit cannot tell.
      expectMatrix(reducedState(rho, 2, [1]), I2)
    }
    // And the same holds with the roles swapped.
    const rho = densityMatrix(applyOnQubit(bell, 1, RY(1.7)))
    expectMatrix(reducedState(rho, 2, [0]), I2)
  })

  it('the rotated qubit’s OWN reduced state is also unchanged (I/2 is invariant under U·U†)', () => {
    const rho = densityMatrix(applyOnQubit(bellPairAmplitudes(), 0, RY(1.1)))
    expectMatrix(reducedState(rho, 2, [0]), I2)
  })
})

describe('helpers', () => {
  it('qubitCount and basisLabels agree with the MSB-first convention', () => {
    expect(qubitCount(1)).toBe(0)
    expect(qubitCount(4)).toBe(2)
    expect(qubitCount(8)).toBe(3)
    expect(() => qubitCount(6)).toThrow()
    expect(basisLabels(2)).toEqual(['|00⟩', '|01⟩', '|10⟩', '|11⟩'])
    expect(basisLabels(1)).toEqual(['|0⟩', '|1⟩'])
  })

  it('maxMagnitude reads |z| not |re|', () => {
    expect(maxMagnitude([[z(0, 0.75)], [z(0.5)]])).toBeCloseTo(0.75, 12)
    expect(maxMagnitude([[z(3, 4)]])).toBeCloseTo(5, 12)
    expect(maxMagnitude([])).toBe(0)
  })
})
