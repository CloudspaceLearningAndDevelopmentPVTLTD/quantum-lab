import { describe, expect, it } from 'vitest'
import { StateVector, c, mulberry32, type Complex } from '@/lib/quantum'
import {
  BELL_PHI_PLUS,
  PAULI,
  PAULI_LABELS,
  basisProbabilities,
  blochFromDensity,
  blochStateAmplitudes,
  depolarize,
  eigSymmetric,
  eigenvaluesHermitian,
  exactExpectations,
  expectationsFromCounts,
  fidelityWithPure,
  hsDistance,
  isPhysical,
  kron,
  linearInversion,
  matmul,
  mleEigenvalues,
  mleProject,
  plusProbability,
  productState,
  pureDensity,
  purity,
  randomPureState,
  reconstructSingleQubit,
  reducedDensity,
  sampleSingleQubit,
  sampleTwoQubit,
  singleQubitRmsError,
  spectralMap,
  traceDistance,
  type PauliTable,
} from './tomography'

/**
 * Every expected value here is computed by hand or taken from a textbook —
 * the 2×2 eigenvalues from trace and determinant, the Bell-state Pauli table
 * from ⟨XX⟩ = ⟨ZZ⟩ = 1, ⟨YY⟩ = −1, the binomial error √((1 − r²)/N), the
 * Smolin–Gambetta–Smith worked spectra — never from the module's own output.
 */

const R = Math.SQRT1_2
const ZERO: Complex[] = [c(1), c(0)]
const ONE: Complex[] = [c(0), c(1)]
const PLUS: Complex[] = [c(R), c(R)]
const PLUS_I: Complex[] = [c(R), c(0, R)]

const expectMatrixClose = (a: { data: Complex[] }, b: { data: Complex[] }, digits = 10) => {
  expect(a.data.length).toBe(b.data.length)
  a.data.forEach((x, k) => {
    expect(x.re).toBeCloseTo(b.data[k].re, digits)
    expect(x.im).toBeCloseTo(b.data[k].im, digits)
  })
}

describe('Born probabilities along a Pauli axis', () => {
  it('|+⟩ is certain on X and a coin flip on Z', () => {
    const rho = pureDensity(PLUS)
    expect(plusProbability(rho, 'X')).toBeCloseTo(1, 12)
    expect(plusProbability(rho, 'Z')).toBeCloseTo(0.5, 12)
    expect(plusProbability(rho, 'Y')).toBeCloseTo(0.5, 12)
  })

  it('|+i⟩ is certain on Y', () => {
    expect(plusProbability(pureDensity(PLUS_I), 'Y')).toBeCloseTo(1, 12)
  })

  it('a state at θ = 60° has ⟨Z⟩ = cos 60° and ⟨X⟩ = sin 60°', () => {
    const rho = pureDensity(blochStateAmplitudes(Math.PI / 3, 0))
    const [x, y, z] = blochFromDensity(rho)
    expect(z).toBeCloseTo(0.5, 12)
    expect(x).toBeCloseTo(Math.sqrt(3) / 2, 12)
    expect(y).toBeCloseTo(0, 12)
  })
})

describe('single-qubit tomography', () => {
  const theta = 1.1
  const phi = 0.7
  const truth: [number, number, number] = [
    Math.sin(theta) * Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
    Math.cos(theta),
  ]
  const rho = pureDensity(blochStateAmplitudes(theta, phi))

  it('recovers a known pure state to within 0.01 at N = 200,000 per axis', () => {
    const est = reconstructSingleQubit(sampleSingleQubit(rho, 200_000, mulberry32(7)))
    for (let i = 0; i < 3; i++) expect(Math.abs(est.vector[i] - truth[i])).toBeLessThan(0.01)
    expect(Math.abs(est.length - 1)).toBeLessThan(0.02)
  })

  it('reconstruction error scales as 1/√N, at the analytic √(2/N) rate for a pure state', () => {
    // RMS of the 3-vector error: Σ_i (1 − r_i²)/N = (3 − |r|²)/N = 2/N.
    const rng = mulberry32(11)
    const shots = [100, 400, 1600, 6400]
    const rms = shots.map((n) => singleQubitRmsError(rho, n, 60, rng))
    shots.forEach((n, k) => {
      const analytic = Math.sqrt(2 / n)
      expect(rms[k] / analytic).toBeGreaterThan(0.75)
      expect(rms[k] / analytic).toBeLessThan(1.25)
    })
    // Quadrupling N halves the error.
    for (let k = 1; k < rms.length; k++) {
      const ratio = rms[k - 1] / rms[k]
      expect(ratio).toBeGreaterThan(1.6)
      expect(ratio).toBeLessThan(2.5)
    }
  })

  it('reports the binomial standard error √((1 − r²)/N), matching the spread across experiments', () => {
    const rho60 = pureDensity(blochStateAmplitudes(Math.PI / 3, 0))
    const rng = mulberry32(3)
    const n = 400
    const zs: number[] = []
    let reportedSe = 0
    for (let t = 0; t < 300; t++) {
      const est = reconstructSingleQubit(sampleSingleQubit(rho60, n, rng))
      zs.push(est.vector[2])
      reportedSe += est.stderr[2] / 300
    }
    const mean = zs.reduce((s, x) => s + x, 0) / zs.length
    const sd = Math.sqrt(zs.reduce((s, x) => s + (x - mean) ** 2, 0) / (zs.length - 1))
    const analytic = Math.sqrt((1 - 0.25) / n) // r_z = cos 60° = 0.5
    expect(analytic).toBeCloseTo(0.0433, 3)
    expect(sd / analytic).toBeGreaterThan(0.85)
    expect(sd / analytic).toBeLessThan(1.15)
    expect(reportedSe / analytic).toBeGreaterThan(0.95)
    expect(reportedSe / analytic).toBeLessThan(1.05)
  })

  it('projects an unphysical estimate radially back onto the sphere', () => {
    const est = reconstructSingleQubit([
      { axis: 'X', plus: 90, minus: 10 }, // 0.8
      { axis: 'Y', plus: 90, minus: 10 }, // 0.8
      { axis: 'Z', plus: 50, minus: 50 }, // 0
    ])
    expect(est.length).toBeCloseTo(Math.sqrt(1.28), 12)
    expect(est.length).toBeGreaterThan(1)
    expect(est.physical[0]).toBeCloseTo(0.8 / Math.sqrt(1.28), 12)
    expect(Math.hypot(...est.physical)).toBeCloseTo(1, 12)
  })
})

describe('Hermitian eigenvalues through the real embedding', () => {
  it('Jacobi diagonalises a real symmetric matrix with known spectrum', () => {
    // [[2, 1], [1, 2]] has eigenvalues 3 and 1.
    const { values } = eigSymmetric([
      [2, 1],
      [1, 2],
    ])
    expect(values.slice().sort((a, b) => b - a)).toEqual([expect.closeTo(3, 12), expect.closeTo(1, 12)])
  })

  it('[[2, 1−i], [1+i, 3]] has eigenvalues 4 and 1 (trace 5, determinant 4)', () => {
    const h = { dim: 2, data: [c(2), c(1, -1), c(1, 1), c(3)] }
    const ev = eigenvaluesHermitian(h)
    expect(ev[0]).toBeCloseTo(4, 10)
    expect(ev[1]).toBeCloseTo(1, 10)
  })

  it('σ_y has eigenvalues ±1 and a Bell state has spectrum (1, 0, 0, 0)', () => {
    expect(eigenvaluesHermitian(PAULI.Y)).toEqual([expect.closeTo(1, 12), expect.closeTo(-1, 12)])
    const ev = eigenvaluesHermitian(pureDensity(BELL_PHI_PLUS))
    expect(ev[0]).toBeCloseTo(1, 10)
    for (let k = 1; k < 4; k++) expect(ev[k]).toBeCloseTo(0, 10)
  })

  it('a classical mixture of |00⟩ and |11⟩ has spectrum (½, ½, 0, 0)', () => {
    const rho = depolarize(pureDensity(BELL_PHI_PLUS), 0) // start from Bell
    const mix = {
      dim: 4,
      data: rho.data.map((x, k) => (k === 0 || k === 15 ? x : c(0))),
    }
    const ev = eigenvaluesHermitian(mix)
    expect(ev[0]).toBeCloseTo(0.5, 10)
    expect(ev[1]).toBeCloseTo(0.5, 10)
    expect(ev[2]).toBeCloseTo(0, 10)
    expect(ev[3]).toBeCloseTo(0, 10)
  })

  it('spectralMap with the identity returns the matrix, and with λ ↦ λ² returns ρ²', () => {
    // A mixed state with complex off-diagonals: 0.7·|+i⟩⟨+i| ⊗ |0⟩⟨0| + 0.3·|Φ+⟩⟨Φ+|.
    const rho = {
      dim: 4,
      data: pureDensity(productState(PLUS_I, ZERO)).data.map((x, k) =>
        c(0.7 * x.re + 0.3 * pureDensity(BELL_PHI_PLUS).data[k].re, 0.7 * x.im + 0.3 * pureDensity(BELL_PHI_PLUS).data[k].im)
      ),
    }
    expectMatrixClose(spectralMap(rho, (ev) => ev), rho, 9)
    expectMatrixClose(
      spectralMap(rho, (ev) => ev.map((x) => x * x)),
      matmul(rho, rho),
      9
    )
  })

  it('trace distance between pure states is √(1 − |⟨ψ|φ⟩|²)', () => {
    expect(traceDistance(pureDensity(ZERO), pureDensity(ONE))).toBeCloseTo(1, 10)
    expect(traceDistance(pureDensity(ZERO), pureDensity(PLUS))).toBeCloseTo(Math.SQRT1_2, 10)
    expect(traceDistance(pureDensity(PLUS), pureDensity(PLUS))).toBeCloseTo(0, 10)
  })
})

describe('reduced density matrices from a StateVector', () => {
  it('a Bell pair reduces to I/2 on either qubit', () => {
    const sv = new StateVector(2)
    sv.applySingle('H', 0).applyControlled('X', [0], 1)
    for (const q of [0, 1]) {
      const r = reducedDensity(sv, [q])
      expect(r.data[0].re).toBeCloseTo(0.5, 12)
      expect(r.data[3].re).toBeCloseTo(0.5, 12)
      expect(Math.hypot(r.data[1].re, r.data[1].im)).toBeCloseTo(0, 12)
      expect(purity(r)).toBeCloseTo(0.5, 12)
    }
  })

  it('keeps the requested qubit order: keep [1, 0] on H⊗q0 gives |0⟩ ⊗ |+⟩', () => {
    const sv = new StateVector(2)
    sv.applySingle('H', 0)
    expectMatrixClose(reducedDensity(sv, [1, 0]), pureDensity(productState(ZERO, PLUS)), 12)
    expectMatrixClose(reducedDensity(sv, [0, 1]), pureDensity(productState(PLUS, ZERO)), 12)
  })

  it('fidelity of a pure state with itself is 1 and with an orthogonal state is 0', () => {
    expect(fidelityWithPure(pureDensity(PLUS), PLUS)).toBeCloseTo(1, 12)
    expect(fidelityWithPure(pureDensity(PLUS), [c(R), c(-R)])).toBeCloseTo(0, 12)
  })
})

describe('two-qubit tomography', () => {
  const bell = pureDensity(BELL_PHI_PLUS)

  /** The Bell table by hand: only II, XX, ZZ = +1 and YY = −1 are non-zero. */
  const bellTable: PauliTable = PAULI_LABELS.map((a) =>
    PAULI_LABELS.map((b) => {
      if (a === 'I' && b === 'I') return 1
      if (a === b && a === 'Y') return -1
      if (a === b && (a === 'X' || a === 'Z')) return 1
      return 0
    })
  )

  it('outcome probabilities in the nine bases follow the correlations of |Φ+⟩', () => {
    expect(basisProbabilities(bell, 'Z', 'Z')).toEqual([
      expect.closeTo(0.5, 12),
      expect.closeTo(0, 12),
      expect.closeTo(0, 12),
      expect.closeTo(0.5, 12),
    ])
    expect(basisProbabilities(bell, 'X', 'X')).toEqual([
      expect.closeTo(0.5, 12),
      expect.closeTo(0, 12),
      expect.closeTo(0, 12),
      expect.closeTo(0.5, 12),
    ])
    // ⟨YY⟩ = −1: anticorrelated.
    expect(basisProbabilities(bell, 'Y', 'Y')).toEqual([
      expect.closeTo(0, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0, 12),
    ])
    // Mixed bases carry no correlation at all.
    for (const p of basisProbabilities(bell, 'X', 'Z')) expect(p).toBeCloseTo(0.25, 12)
  })

  it('exact expectations of |Φ+⟩ reproduce the hand-written Pauli table', () => {
    const E = exactExpectations(bell)
    E.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(bellTable[i][j], 12)))
  })

  it('linear inversion of the hand-written table is exactly |Φ+⟩⟨Φ+|', () => {
    expectMatrixClose(linearInversion(bellTable), bell, 12)
  })

  it('a depolarised Bell state has ⟨XX⟩ = 1 − p', () => {
    const E = exactExpectations(depolarize(bell, 0.3))
    expect(E[1][1]).toBeCloseTo(0.7, 12)
    expect(E[0][0]).toBeCloseTo(1, 12)
  })

  it('recovers |Φ+⟩ within trace distance 0.03 at 50,000 shots per basis', () => {
    const counts = sampleTwoQubit(bell, 50_000, mulberry32(21))
    const rho = linearInversion(expectationsFromCounts(counts))
    expect(traceDistance(rho, bell)).toBeLessThan(0.03)
    expect(fidelityWithPure(rho, BELL_PHI_PLUS)).toBeGreaterThan(0.97)
  })

  it('recovers a random pure state at large N', () => {
    const psi = randomPureState(4, mulberry32(5))
    const truth = pureDensity(psi)
    const counts = sampleTwoQubit(truth, 50_000, mulberry32(6))
    const rho = linearInversion(expectationsFromCounts(counts))
    expect(traceDistance(rho, truth)).toBeLessThan(0.03)
  })

  it('at 25 shots per basis linear inversion of a pure state is usually unphysical', () => {
    let negative = 0
    for (let seed = 0; seed < 30; seed++) {
      const rho = linearInversion(expectationsFromCounts(sampleTwoQubit(bell, 25, mulberry32(100 + seed))))
      if (eigenvaluesHermitian(rho)[3] < -0.01) negative++
    }
    expect(negative).toBeGreaterThanOrEqual(20)
  })

  it('the maximum-likelihood fix is physical, trace one, and never further from the truth in HS norm', () => {
    for (let seed = 0; seed < 30; seed++) {
      const lin = linearInversion(expectationsFromCounts(sampleTwoQubit(bell, 25, mulberry32(200 + seed))))
      const mle = mleProject(lin)
      expect(isPhysical(mle)).toBe(true)
      const ev = eigenvaluesHermitian(mle)
      expect(ev.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9)
      // Projection onto a convex set containing the truth cannot move away from it.
      expect(hsDistance(mle, bell)).toBeLessThanOrEqual(hsDistance(lin, bell) + 1e-9)
      // And a physical estimate is left alone.
      if (isPhysical(lin)) expectMatrixClose(mle, lin, 9)
    }
  })
})

describe('Smolin–Gambetta–Smith eigenvalue correction', () => {
  it('zeroes one negative eigenvalue and shares it among the other three', () => {
    // μ = (0.6, 0.3, 0.2, −0.1): −0.1 goes to zero, each survivor loses 0.1/3.
    const out = mleEigenvalues([0.6, 0.3, 0.2, -0.1])
    expect(out[0]).toBeCloseTo(0.6 - 0.1 / 3, 12)
    expect(out[1]).toBeCloseTo(0.3 - 0.1 / 3, 12)
    expect(out[2]).toBeCloseTo(0.2 - 0.1 / 3, 12)
    expect(out[3]).toBe(0)
  })

  it('keeps zeroing while the running deficit would push the next one negative', () => {
    // μ = (0.9, 0.2, −0.05, −0.05): two zeros, 0.1 shared by two survivors.
    const out = mleEigenvalues([0.9, 0.2, -0.05, -0.05])
    expect(out).toEqual([expect.closeTo(0.85, 12), expect.closeTo(0.15, 12), 0, 0])
  })

  it('leaves a physical spectrum untouched', () => {
    expect(mleEigenvalues([0.5, 0.3, 0.2, 0])).toEqual([
      expect.closeTo(0.5, 12),
      expect.closeTo(0.3, 12),
      expect.closeTo(0.2, 12),
      expect.closeTo(0, 12),
    ])
  })
})

describe('Pauli algebra sanity', () => {
  it('kron(Z, Z) has the diagonal (1, −1, −1, 1)', () => {
    const zz = kron(PAULI.Z, PAULI.Z)
    expect([0, 5, 10, 15].map((k) => zz.data[k].re)).toEqual([1, -1, -1, 1])
  })

  it('XY = iZ', () => {
    const xy = matmul(PAULI.X, PAULI.Y)
    expect(xy.data[0].im).toBeCloseTo(1, 12)
    expect(xy.data[3].im).toBeCloseTo(-1, 12)
  })
})

describe('the page is registered', () => {
  // Registering in VISUALIZATIONS is what puts the route in the sitemap, the
  // index, the home page and the social card; the directory is what serves it.
  const HREF = '/visualizations/state-tomography'

  it('appears in the catalogue with the right shape', async () => {
    const { VISUALIZATIONS } = await import('@/lib/visualizations')
    const entry = VISUALIZATIONS.find((v) => v.href === HREF)
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('Advanced')
    // The hue is assigned by position when the catalogue is re-ordered, so pin
    // the palette, not the colour.
    expect(['violet', 'teal', 'sky', 'amber', 'rose']).toContain(entry?.accent)
    expect(entry?.icon).toBe('🔬')
    expect(entry?.title).toBe('Tomography and No-Cloning')
    expect(entry?.hook.length).toBeGreaterThan(30)
  })

  it('has the three files a visualization route needs', async () => {
    const { existsSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    for (const file of ['page.tsx', 'layout.tsx', 'opengraph-image.tsx']) {
      expect(existsSync(resolve(__dirname, '../../app', HREF.slice(1), file)), file).toBe(true)
    }
  })
})
