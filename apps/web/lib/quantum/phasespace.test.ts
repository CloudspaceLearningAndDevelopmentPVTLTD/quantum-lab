import { describe, expect, it } from 'vitest'
import {
  catState,
  coherentState,
  densityMatrixFor,
  fieldStats,
  fockState,
  husimiFunction,
  husimiOfState,
  laguerre,
  meanParity,
  meanPhotonNumber,
  meanPhotonNumberOf,
  phaseSpaceGrid,
  pureDensityMatrix,
  sampleField,
  squeezedVacuum,
  suggestedDim,
  suggestedExtent,
  thermalState,
  truncatedNorm,
  wignerFunction,
  wignerOfState,
  type PhaseSpaceField,
  type PhaseSpaceStateSpec,
} from './phasespace'

/**
 * Every value asserted here is computed OUTSIDE phasespace.ts: a closed-form
 * Gaussian, a textbook parity argument, a Laguerre polynomial written out by
 * hand, or an expectation value with a known formula. None of it feeds the
 * module's output back to itself.
 */

const DIM = 64
const PI = Math.PI

/** Evaluate a closed form on every grid point and compare. */
function expectFieldMatches(
  field: PhaseSpaceField,
  closedForm: (x: number, p: number) => number,
  tol: number
): void {
  let worst = 0
  for (let ip = 0; ip < field.n; ip++) {
    for (let ix = 0; ix < field.n; ix++) {
      const got = field.values[ip * field.n + ix]
      const want = closedForm(field.xs[ix], field.ps[ip])
      worst = Math.max(worst, Math.abs(got - want))
    }
  }
  expect(worst).toBeLessThan(tol)
}

describe('generalised Laguerre polynomials', () => {
  it('matches the polynomials written out by hand', () => {
    // L_0 = 1, L_1 = 1 − z, L_2 = (z² − 4z + 2)/2, L_3 = (−z³ + 9z² − 18z + 6)/6
    for (const z of [0, 0.5, 1.7, 3.2]) {
      expect(laguerre(0, 0, z)).toBeCloseTo(1, 12)
      expect(laguerre(1, 0, z)).toBeCloseTo(1 - z, 12)
      expect(laguerre(2, 0, z)).toBeCloseTo((z * z - 4 * z + 2) / 2, 12)
      expect(laguerre(3, 0, z)).toBeCloseTo((-(z ** 3) + 9 * z * z - 18 * z + 6) / 6, 12)
      // L_1^{(k)} = 1 + k − z;  L_2^{(1)} = (z² − 6z + 6)/2;  L_2^{(2)} = (z² − 8z + 12)/2
      expect(laguerre(1, 3, z)).toBeCloseTo(4 - z, 12)
      expect(laguerre(2, 1, z)).toBeCloseTo((z * z - 6 * z + 6) / 2, 12)
      expect(laguerre(2, 2, z)).toBeCloseTo((z * z - 8 * z + 12) / 2, 12)
    }
  })
})

describe('state construction', () => {
  it('coherent state has Poisson photon statistics with mean |α|²', () => {
    const s = coherentState(1.3, -0.7, DIM)
    const mean = 1.3 ** 2 + 0.7 ** 2
    expect(truncatedNorm(s)).toBeCloseTo(1, 10)
    expect(meanPhotonNumber(s)).toBeCloseTo(mean, 9)
    // P(n) = e^{−|α|²} |α|^{2n} / n!
    let fact = 1
    for (let n = 0; n < 8; n++) {
      if (n > 0) fact *= n
      const pn = s.re[n] ** 2 + s.im[n] ** 2
      expect(pn).toBeCloseTo((Math.exp(-mean) * mean ** n) / fact, 10)
    }
  })

  it('cat states have the closed-form mean photon number', () => {
    // Even cat: ⟨n⟩ = α² tanh α²;  odd cat: ⟨n⟩ = α² coth α²  (real α).
    for (const a of [0.8, 1.5, 2.2]) {
      const even = catState(a, 0, 'even', DIM)
      const odd = catState(a, 0, 'odd', DIM)
      expect(truncatedNorm(even)).toBeCloseTo(1, 9)
      expect(truncatedNorm(odd)).toBeCloseTo(1, 9)
      expect(meanPhotonNumber(even)).toBeCloseTo(a * a * Math.tanh(a * a), 8)
      expect(meanPhotonNumber(odd)).toBeCloseTo((a * a) / Math.tanh(a * a), 8)
      // Parity is exact: even cats have no odd components and vice versa.
      for (let n = 0; n < DIM; n++) {
        if (n % 2 === 1) expect(Math.abs(even.re[n]) + Math.abs(even.im[n])).toBeLessThan(1e-15)
        else expect(Math.abs(odd.re[n]) + Math.abs(odd.im[n])).toBeLessThan(1e-15)
      }
    }
  })

  it('squeezed vacuum has ⟨n⟩ = sinh² r and fits the truncation', () => {
    for (const r of [0.3, 0.8, 1.2]) {
      const s = squeezedVacuum(r, 0, DIM)
      expect(1 - truncatedNorm(s)).toBeLessThan(2e-6)
      expect(meanPhotonNumber(s)).toBeCloseTo(Math.sinh(r) ** 2, 3)
    }
  })

  it('thermal state has Tr ρ = 1 and ⟨n⟩ = n̄', () => {
    const nbar = 1.4
    const rho = thermalState(nbar, DIM)
    let tr = 0
    let mean = 0
    for (let n = 0; n < DIM; n++) {
      tr += rho.re[n * DIM + n]
      mean += n * rho.re[n * DIM + n]
    }
    expect(tr).toBeCloseTo(1, 9)
    expect(mean).toBeCloseTo(nbar, 7)
  })
})

describe('Wigner function against closed forms', () => {
  const grid = phaseSpaceGrid(65, 4)

  it('vacuum is (1/π) exp(−x² − p²), with W(0,0) = 1/π', () => {
    const W = wignerOfState(fockState(0, DIM), grid)
    expectFieldMatches(W, (x, p) => Math.exp(-x * x - p * p) / PI, 1e-12)
    expect(fieldStats(W).origin).toBeCloseTo(1 / PI, 12)
  })

  it('Fock |n⟩ is (−1)ⁿ/π at the origin — the parity of the state', () => {
    for (let n = 0; n <= 6; n++) {
      const W = wignerOfState(fockState(n, DIM), grid)
      expect(fieldStats(W).origin).toBeCloseTo((n % 2 === 0 ? 1 : -1) / PI, 10)
    }
  })

  it('Fock |1⟩ is (1/π)(2r² − 1) e^{−r²} everywhere, and negative inside r < 1/√2', () => {
    const W = wignerOfState(fockState(1, DIM), grid)
    expectFieldMatches(W, (x, p) => ((2 * (x * x + p * p) - 1) * Math.exp(-x * x - p * p)) / PI, 1e-12)
    expect(sampleField(W, 0, 0)).toBeCloseTo(-1 / PI, 8)
    expect(sampleField(W, 0.5, 0)).toBeLessThan(0)
    expect(sampleField(W, 1.5, 0)).toBeGreaterThan(0)
  })

  it('Fock |2⟩ is (1/π)(2r⁴ − 4r² + 1) e^{−r²}', () => {
    // L_2(2r²) = ((2r²)² − 4(2r²) + 2)/2 = 2r⁴ − 4r² + 1
    const W = wignerOfState(fockState(2, DIM), grid)
    expectFieldMatches(
      W,
      (x, p) => {
        const r2 = x * x + p * p
        return ((2 * r2 * r2 - 4 * r2 + 1) * Math.exp(-r2)) / PI
      },
      1e-12
    )
  })

  it('a coherent state is the vacuum Gaussian displaced to (√2 Re α, √2 Im α)', () => {
    for (const [re, im] of [
      [1.2, 0],
      [0, -0.9],
      [0.8, 1.1],
    ]) {
      const W = wignerOfState(coherentState(re, im, DIM), grid)
      const x0 = Math.SQRT2 * re
      const p0 = Math.SQRT2 * im
      expectFieldMatches(W, (x, p) => Math.exp(-((x - x0) ** 2) - (p - p0) ** 2) / PI, 1e-9)
      // Peak on the grid sits at the displaced point.
      let best = -Infinity
      let bx = 0
      let bp = 0
      for (let ip = 0; ip < W.n; ip++) {
        for (let ix = 0; ix < W.n; ix++) {
          const v = W.values[ip * W.n + ix]
          if (v > best) {
            best = v
            bx = W.xs[ix]
            bp = W.ps[ip]
          }
        }
      }
      expect(Math.abs(bx - x0)).toBeLessThanOrEqual(grid.step / 2 + 1e-12)
      expect(Math.abs(bp - p0)).toBeLessThanOrEqual(grid.step / 2 + 1e-12)
      // Mean parity of |α⟩ is e^{−2|α|²}, so W(0,0) = e^{−2|α|²}/π.
      expect(sampleField(W, 0, 0)).toBeCloseTo(Math.exp(-2 * (re * re + im * im)) / PI, 6)
    }
  })

  it('an even cat state carries interference fringes that go negative between the lobes', () => {
    // Real α: W = N²/π [ e^{−(x−√2α)²−p²} + e^{−(x+√2α)²−p²} + 2 e^{−x²−p²} cos(2√2 α p) ],
    // N² = 1 / (2 (1 + e^{−2α²})).
    const a = 2
    const wide = phaseSpaceGrid(97, 5)
    const W = wignerOfState(catState(a, 0, 'even', DIM), wide)
    const N2 = 1 / (2 * (1 + Math.exp(-2 * a * a)))
    const closed = (x: number, p: number) =>
      (N2 / PI) *
      (Math.exp(-((x - Math.SQRT2 * a) ** 2) - p * p) +
        Math.exp(-((x + Math.SQRT2 * a) ** 2) - p * p) +
        2 * Math.exp(-x * x - p * p) * Math.cos(2 * Math.SQRT2 * a * p))
    expectFieldMatches(W, closed, 1e-8)
    // Origin: even parity → +1/π, the fringe crest.
    expect(sampleField(W, 0, 0)).toBeCloseTo(1 / PI, 6)
    // Half a fringe along p: cos = −1, so the midpoint between the lobes is negative.
    const pTrough = PI / (2 * Math.SQRT2 * a)
    expect(sampleField(W, 0, pTrough)).toBeLessThan(-0.2 / PI)
    expect(fieldStats(W).min).toBeLessThan(-0.2 / PI)
    // The lobes themselves are positive at their centres.
    expect(sampleField(W, Math.SQRT2 * a, 0)).toBeGreaterThan(0.4 / PI)
  })

  it('an odd cat state is −1/π at the origin', () => {
    const W = wignerOfState(catState(1.5, 0, 'odd', DIM), phaseSpaceGrid(65, 5))
    expect(sampleField(W, 0, 0)).toBeCloseTo(-1 / PI, 6)
  })

  it('squeezed vacuum is the Gaussian (1/π) exp(−e^{2r} x² − e^{−2r} p²)', () => {
    for (const r of [0.4, 0.9]) {
      const W = wignerOfState(squeezedVacuum(r, 0, DIM), phaseSpaceGrid(65, 5))
      expectFieldMatches(
        W,
        (x, p) => Math.exp(-Math.exp(2 * r) * x * x - Math.exp(-2 * r) * p * p) / PI,
        1e-5
      )
    }
  })

  it('rotating the squeezing phase by π swaps the squeezed quadrature', () => {
    const r = 0.7
    const W = wignerOfState(squeezedVacuum(r, PI, DIM), phaseSpaceGrid(65, 5))
    expectFieldMatches(
      W,
      (x, p) => Math.exp(-Math.exp(-2 * r) * x * x - Math.exp(2 * r) * p * p) / PI,
      1e-5
    )
  })

  it('thermal state is the broadened Gaussian, never negative', () => {
    const nbar = 0.9
    const W = wignerFunction(thermalState(nbar, DIM), phaseSpaceGrid(65, 5))
    const s = 2 * nbar + 1
    expectFieldMatches(W, (x, p) => Math.exp(-(x * x + p * p) / s) / (PI * s), 1e-9)
    expect(fieldStats(W).min).toBeGreaterThanOrEqual(0)
  })

  it('W(0,0) is the mean parity over π for a mixed state', () => {
    const rho = thermalState(0.6, DIM)
    const W = wignerFunction(rho, grid)
    // ⟨Π⟩ for a thermal state is 1/(2n̄ + 1).
    expect(meanParity(rho)).toBeCloseTo(1 / 2.2, 9)
    expect(fieldStats(W).origin * PI).toBeCloseTo(meanParity(rho), 9)
  })
})

describe('Husimi Q function', () => {
  it('vacuum Q is (1/2π) exp(−r²/2), half as tall and √2 wider than W', () => {
    const grid = phaseSpaceGrid(65, 4)
    const Q = husimiOfState(fockState(0, DIM), grid)
    expectFieldMatches(Q, (x, p) => Math.exp(-(x * x + p * p) / 2) / (2 * PI), 1e-12)
  })

  it('Fock |n⟩ has Q = (1/2π) e^{−r²/2} (r²/2)ⁿ / n!', () => {
    const grid = phaseSpaceGrid(65, 5)
    let fact = 1
    for (let n = 0; n <= 4; n++) {
      if (n > 0) fact *= n
      const Q = husimiOfState(fockState(n, DIM), grid)
      expectFieldMatches(
        Q,
        (x, p) => {
          const a2 = (x * x + p * p) / 2
          return (Math.exp(-a2) * a2 ** n) / fact / (2 * PI)
        },
        1e-12
      )
    }
  })

  it('coherent Q is a unit-variance Gaussian at the displaced point', () => {
    const grid = phaseSpaceGrid(65, 5)
    const Q = husimiOfState(coherentState(0.9, 0.6, DIM), grid)
    const x0 = Math.SQRT2 * 0.9
    const p0 = Math.SQRT2 * 0.6
    expectFieldMatches(Q, (x, p) => Math.exp(-((x - x0) ** 2 + (p - p0) ** 2) / 2) / (2 * PI), 1e-9)
  })
})

describe('every catalogue state', () => {
  const specs: PhaseSpaceStateSpec[] = [
    { kind: 'vacuum' },
    { kind: 'coherent', alpha: 2, phase: 0.7 },
    { kind: 'fock', n: 4 },
    { kind: 'cat', alpha: 2.2, parity: 'even' },
    { kind: 'cat', alpha: 1.4, parity: 'odd' },
    { kind: 'squeezed', r: 1.0, theta: 0.5 },
    { kind: 'thermal', nbar: 2 },
  ]

  for (const spec of specs) {
    it(`${JSON.stringify(spec)}: ∫W = 1, ∫Q = 1, Q ≥ 0`, () => {
      const rho = densityMatrixFor(spec)
      const grid = phaseSpaceGrid(97, suggestedExtent(spec))
      const W = wignerFunction(rho, grid)
      const Q = husimiFunction(rho, grid)
      const ws = fieldStats(W)
      const qs = fieldStats(Q)
      expect(ws.integral).toBeCloseTo(1, 3)
      expect(qs.integral).toBeCloseTo(1, 3)
      expect(qs.min).toBeGreaterThanOrEqual(-1e-12)
      // W is bounded by 1/π in magnitude (|W| ≤ 1/π for any state, ħ = 1).
      expect(Math.abs(ws.min)).toBeLessThanOrEqual(1 / PI + 1e-9)
      expect(ws.max).toBeLessThanOrEqual(1 / PI + 1e-9)
      // Q never exceeds W's bound either: Q ≤ 1/(2π) in these units.
      expect(qs.max).toBeLessThanOrEqual(1 / (2 * PI) + 1e-9)
    })
  }

  it('negativity: zero for the Gaussian states, positive for Fock and cat states', () => {
    const grid = phaseSpaceGrid(97, 6)
    const neg = (spec: PhaseSpaceStateSpec) => fieldStats(wignerFunction(densityMatrixFor(spec), grid)).negativeVolume
    expect(neg({ kind: 'vacuum' })).toBeLessThan(1e-9)
    expect(neg({ kind: 'coherent', alpha: 1.5, phase: 0 })).toBeLessThan(1e-9)
    expect(neg({ kind: 'squeezed', r: 0.8, theta: 0 })).toBeLessThan(1e-4)
    expect(neg({ kind: 'thermal', nbar: 1 })).toBeLessThan(1e-9)
    expect(neg({ kind: 'fock', n: 1 })).toBeGreaterThan(0.1)
    expect(neg({ kind: 'cat', alpha: 2, parity: 'even' })).toBeGreaterThan(0.1)
    // Fock |1⟩: ∫|W| − 1 = 2·(negative volume). The negative disc is r < 1/√2 and,
    // with u = r², ∫_{r<1/√2} (1 − 2r²) e^{−r²}/π dx dp = ∫₀^{1/2} (1 − 2u) e^{−u} du
    // = [(2u + 1) e^{−u}]₀^{1/2} = 2e^{−1/2} − 1 ≈ 0.2131, so the metric is 0.4261.
    expect(neg({ kind: 'fock', n: 1 })).toBeCloseTo(2 * (2 * Math.exp(-0.5) - 1), 2)
  })

  it('suggestedDim keeps every state to better than 2e-6 at the page limits', () => {
    const extremes: PhaseSpaceStateSpec[] = [
      { kind: 'coherent', alpha: 2.5, phase: 1 },
      { kind: 'cat', alpha: 2.5, parity: 'odd' },
      { kind: 'fock', n: 8 },
      { kind: 'squeezed', r: 1.2, theta: 0 },
      { kind: 'thermal', nbar: 3 },
    ]
    for (const spec of extremes) {
      const dim = suggestedDim(spec)
      const rho = densityMatrixFor(spec, dim)
      let tr = 0
      for (let n = 0; n < dim; n++) tr += rho.re[n * dim + n]
      expect(1 - tr, JSON.stringify(spec)).toBeLessThan(2e-6)
    }
    // ⟨n⟩ of the mixed-state helper agrees with the closed forms.
    expect(meanPhotonNumberOf(densityMatrixFor({ kind: 'thermal', nbar: 1.7 }))).toBeCloseTo(1.7, 6)
    expect(meanPhotonNumberOf(densityMatrixFor({ kind: 'coherent', alpha: 1.5, phase: 0.3 }))).toBeCloseTo(2.25, 8)
  })

  it('pure and mixed builders agree on the diagonal', () => {
    const rho = pureDensityMatrix(coherentState(1, 0, 8))
    let tr = 0
    for (let n = 0; n < 8; n++) tr += rho.re[n * 8 + n]
    expect(tr).toBeCloseTo(1, 4)
    // Off-diagonal imaginary part vanishes for a real-amplitude state.
    for (let i = 0; i < 64; i++) expect(Math.abs(rho.im[i])).toBeLessThan(1e-15)
  })
})

describe('sampleField', () => {
  it('interpolates linearly between grid points and returns NaN outside', () => {
    const grid = phaseSpaceGrid(5, 2) // xs = −2, −1, 0, 1, 2
    const values = new Float64Array(25)
    for (let ip = 0; ip < 5; ip++) for (let ix = 0; ix < 5; ix++) values[ip * 5 + ix] = grid.xs[ix] + 10 * grid.ps[ip]
    const field: PhaseSpaceField = { ...grid, values }
    expect(sampleField(field, 0.5, -1.25)).toBeCloseTo(0.5 - 12.5, 12)
    expect(sampleField(field, 2, 2)).toBeCloseTo(22, 12)
    expect(Number.isNaN(sampleField(field, 2.5, 0))).toBe(true)
  })
})
