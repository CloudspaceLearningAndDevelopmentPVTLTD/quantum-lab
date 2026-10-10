import { describe, it, expect } from 'vitest'
import {
  addBarrenSample,
  ansatzState,
  ansatzStateReference,
  applyCZ,
  applyRX,
  applyRY,
  BARREN_PARAMS_PER_LAYER,
  barrenGradientSample,
  barrenLayers,
  barrenVariance,
  energyAt,
  energyOf,
  gradientAt,
  groundStateEnergy,
  landscapeAngle,
  newBarrenAccumulator,
  newLandscapeJob,
  optimiserStep,
  startOptimiser,
  stepLandscape,
  zeroState,
  type Ising,
  type Wave,
} from './landscape'
import { StateVector, mulberry32 } from '@/lib/quantum'

function toWave(sv: StateVector): Wave {
  const re = new Float64Array(sv.dim)
  const im = new Float64Array(sv.dim)
  for (let i = 0; i < sv.dim; i++) {
    re[i] = sv.amplitude(i).re
    im[i] = sv.amplitude(i).im
  }
  return { re, im }
}

describe('statevector kernels agree with lib/quantum', () => {
  it('RY, RX and CZ match StateVector gate for gate', () => {
    const n = 3
    const rand = mulberry32(21)
    for (let trial = 0; trial < 12; trial++) {
      const w = zeroState(n)
      const sv = new StateVector(n)
      for (let step = 0; step < 10; step++) {
        const q = Math.floor(rand() * n)
        const theta = rand() * 4 * Math.PI - 2 * Math.PI
        const pick = Math.floor(rand() * 3)
        if (pick === 0) {
          applyRY(w, q, theta)
          sv.applySingle('RY', q, theta)
        } else if (pick === 1) {
          applyRX(w, q, theta)
          sv.applySingle('RX', q, theta)
        } else {
          const q2 = (q + 1) % n
          applyCZ(w, q, q2)
          sv.apply({ name: 'CZ', qubits: [q, q2] })
        }
      }
      for (let i = 0; i < w.re.length; i++) {
        expect(w.re[i]).toBeCloseTo(sv.amplitude(i).re, 12)
        expect(w.im[i]).toBeCloseTo(sv.amplitude(i).im, 12)
      }
    }
  })

  it('the whole ansatz matches the StateVector-built reference', () => {
    for (const n of [2, 3, 5]) {
      const model: Ising = { n, J: 1, h: 0.7 }
      const w = ansatzState(model, 3, 0.83, -1.21)
      const ref = toWave(ansatzStateReference(model, 3, 0.83, -1.21))
      for (let i = 0; i < w.re.length; i++) {
        expect(w.re[i]).toBeCloseTo(ref.re[i], 12)
        expect(w.im[i]).toBeCloseTo(ref.im[i], 12)
      }
    }
  })

  it('the ansatz state stays normalised', () => {
    const w = ansatzState({ n: 6, J: 1.4, h: 0.6 }, 4, 2.2, 1.1)
    let norm = 0
    for (let i = 0; i < w.re.length; i++) norm += w.re[i] ** 2 + w.im[i] ** 2
    expect(norm).toBeCloseTo(1, 12)
  })
})

describe('the Hamiltonian', () => {
  it('gives the exact energy of basis and product states', () => {
    // |0000⟩: every ZZ term is +1, every X term is 0. E = -J*(n-1).
    const w = zeroState(4)
    expect(energyOf(w, { n: 4, J: 1, h: 1 })).toBeCloseTo(-3, 12)
    expect(energyOf(w, { n: 4, J: 2, h: 5 })).toBeCloseTo(-6, 12)

    // |++++⟩ via RY(π/2) on each qubit: ⟨X⟩ = 1 each, ⟨ZZ⟩ = 0.
    const plus = zeroState(4)
    for (let q = 0; q < 4; q++) applyRY(plus, q, Math.PI / 2)
    expect(energyOf(plus, { n: 4, J: 1, h: 1 })).toBeCloseTo(-4, 10)
    expect(energyOf(plus, { n: 4, J: 3, h: 1 })).toBeCloseTo(-4, 10)
  })

  it('is bounded below by the trivial bound -(J(n-1) + hn)', () => {
    for (const n of [2, 4, 6]) {
      const model: Ising = { n, J: 1.3, h: 0.8 }
      const bound = -(model.J * (n - 1) + model.h * n)
      const e0 = groundStateEnergy(model)
      expect(e0).toBeGreaterThanOrEqual(bound - 1e-9)
      // And it is strictly better than either product state, i.e. non-trivial.
      expect(e0).toBeLessThan(-model.J * (n - 1))
      expect(e0).toBeLessThan(-model.h * n)
    }
  })
})

describe('groundStateEnergy', () => {
  it('matches an independent dense diagonalisation for small chains', () => {
    for (const n of [2, 3, 4]) {
      for (const [J, h] of [
        [1, 1],
        [1, 0.3],
        [0.4, 1.7],
      ] as const) {
        const model: Ising = { n, J, h }
        const dense = denseSmallestEigenvalue(buildDenseIsing(model))
        expect(groundStateEnergy(model)).toBeCloseTo(dense, 8)
      }
    }
  })

  it('is exact for n = 1, where H = -h X and the answer is -h', () => {
    expect(groundStateEnergy({ n: 1, J: 1, h: 2.5 })).toBeCloseTo(-2.5, 10)
  })

  it('is never above any variational energy the ansatz can produce', () => {
    // The defining property of a ground state, and the thing the page's whole
    // "gap to exact" readout depends on.
    const model: Ising = { n: 5, J: 1, h: 1 }
    const e0 = groundStateEnergy(model)
    const rand = mulberry32(88)
    for (let i = 0; i < 60; i++) {
      const e = energyAt(model, 3, rand() * 2 * Math.PI, rand() * 2 * Math.PI)
      expect(e).toBeGreaterThanOrEqual(e0 - 1e-9)
    }
  })
})

describe('the optimiser', () => {
  it('never increases the energy, and stops rather than oscillating', () => {
    const model: Ising = { n: 4, J: 1, h: 1 }
    let state = startOptimiser(model, 3, 1.9, 2.4)
    const first = state.energy
    for (let i = 0; i < 300; i++) {
      const next = optimiserStep(state, model, 3)
      expect(next.energy).toBeLessThanOrEqual(state.energy + 1e-12)
      state = next
      if (state.converged) break
    }
    expect(state.converged).toBe(true)
    expect(state.energy).toBeLessThan(first)
    expect(state.energy).toBeGreaterThanOrEqual(groundStateEnergy(model) - 1e-9)
  })

  it('finds a worse minimum from some starts than others — the landscape is not convex', () => {
    // If this ever stops being true the page's "try a different start" control is a
    // lie. It is the reason VQE is hard, not a defect in the optimiser.
    const model: Ising = { n: 4, J: 1, h: 1 }
    const finals: number[] = []
    for (const [t, p] of [
      [0.2, 0.2],
      [2.6, 4.4],
      [4.9, 1.3],
      [3.3, 3.3],
    ] as const) {
      let s = startOptimiser(model, 3, t, p)
      for (let i = 0; i < 400 && !s.converged; i++) s = optimiserStep(s, model, 3)
      finals.push(s.energy)
    }
    const spread = Math.max(...finals) - Math.min(...finals)
    expect(spread).toBeGreaterThan(0.05)
  })

  it('the finite-difference gradient matches a much finer difference', () => {
    const model: Ising = { n: 3, J: 1, h: 1 }
    const g = gradientAt(model, 2, 1.1, 0.4)
    const fine = 1e-6
    const dTheta =
      (energyAt(model, 2, 1.1 + fine, 0.4) - energyAt(model, 2, 1.1 - fine, 0.4)) / (2 * fine)
    expect(g.dTheta).toBeCloseTo(dTheta, 6)
  })
})

describe('barren plateaus', () => {
  it('the gradient variance falls by orders of magnitude as qubits are added', () => {
    // The claim the page makes, measured. Not "it gets smaller" — an implementation
    // that returned a constant would pass that. This asserts a large ratio.
    const variances = [2, 4, 6, 8].map((n) => {
      const model: Ising = { n, J: 1, h: 1 }
      const rand = mulberry32(n * 3121 + 7)
      const acc = newBarrenAccumulator(n)
      for (let i = 0; i < 300; i++) addBarrenSample(acc, barrenGradientSample(model, rand))
      return barrenVariance(acc)
    })
    for (let i = 1; i < variances.length; i++) {
      expect(variances[i]).toBeLessThan(variances[i - 1])
    }
    expect(variances[0] / variances[variances.length - 1]).toBeGreaterThan(20)
  })

  it('the decay survives undoing the per-site normalisation', () => {
    // barrenGradientSample divides by n, so Var carries a deterministic 1/n². The
    // test above is satisfied by that factor alone: (8/2)² = 16 of its required 20×
    // is arithmetic, not physics. This one multiplies it back out and asserts the
    // EXTENSIVE variance still collapses. Before the RX sublayer was restored to the
    // ansatz, the raw variance fell only 3.2× from n = 2 to n = 8 (a power law, not a
    // plateau) and this assertion failed while the one above passed.
    // Widths start at 4: at n = 2 and 3 the ring is degenerate (a single CZ / a
    // 3-cycle) and the raw variance is not yet monotone in either version, so an
    // assertion anchored there would be measuring finite-size noise.
    const raw = [4, 6, 8].map((n) => {
      const model: Ising = { n, J: 1, h: 1 }
      const rand = mulberry32(n * 7717 + 3)
      const acc = newBarrenAccumulator(n)
      for (let i = 0; i < 400; i++) addBarrenSample(acc, barrenGradientSample(model, rand))
      return barrenVariance(acc) * n * n
    })
    for (let i = 1; i < raw.length; i++) expect(raw[i]).toBeLessThan(raw[i - 1])
    // Measured over n = 4 → 8: 7.2× with the RX sublayer, 2.8× without it. 5 is
    // comfortably between, and a power law cannot reach it.
    expect(raw[0] / raw[raw.length - 1]).toBeGreaterThan(5)
  })

  it('the barren ansatz can reach complex amplitudes', () => {
    // RY + CZ from |0…0⟩ is real-valued at every step, so the sampled ensemble lives
    // in SO(2ⁿ) and cannot approach a unitary 2-design — the hypothesis the plateau
    // result rests on. The RX sublayer is what makes it complex. This is the
    // structural version of the statistical test above.
    expect(BARREN_PARAMS_PER_LAYER(5)).toBe(10)
    const n = 4
    const w = zeroState(n)
    for (let q = 0; q < n; q++) applyRY(w, q, 0.7)
    for (let q = 0; q < n; q++) applyCZ(w, q, (q + 1) % n)
    for (let q = 0; q < n; q++) applyRX(w, q, 0.9)
    expect(Math.max(...Array.from(w.im, Math.abs))).toBeGreaterThan(1e-3)
  })

  it('the gradient mean is consistent with zero', () => {
    const model: Ising = { n: 4, J: 1, h: 1 }
    const rand = mulberry32(5)
    const acc = newBarrenAccumulator(4)
    for (let i = 0; i < 500; i++) addBarrenSample(acc, barrenGradientSample(model, rand))
    const mean = acc.sum / acc.samples
    const stderr = Math.sqrt(barrenVariance(acc) / acc.samples)
    expect(Math.abs(mean)).toBeLessThan(4 * stderr + 1e-9)
  })

  it('the parameter-shift gradient equals a finite-difference gradient of the same circuit', () => {
    // Proves the shift rule is being applied to a gate it is actually valid for.
    // A wrong shift (say π/4) would still produce a plausible decaying variance.
    const model: Ising = { n: 3, J: 1, h: 1 }
    const seed = 99
    const shifted = barrenGradientSample(model, mulberry32(seed))
    const fd = finiteDifferenceBarrenGradient(model, mulberry32(seed), 1e-5)
    expect(shifted).toBeCloseTo(fd, 6)
  })

  it('barrenLayers scales depth with width', () => {
    expect(barrenLayers(4)).toBe(8)
    expect(barrenLayers(8)).toBe(16)
  })

  it('variance is zero until there are two samples', () => {
    const acc = newBarrenAccumulator(3)
    expect(barrenVariance(acc)).toBe(0)
    addBarrenSample(acc, 1.5)
    expect(barrenVariance(acc)).toBe(0)
    addBarrenSample(acc, -1.5)
    expect(barrenVariance(acc)).toBeCloseTo(2.25, 12)
  })
})

describe('the landscape job', () => {
  it('fills every cell and agrees with a direct energy evaluation', () => {
    const model: Ising = { n: 3, J: 1, h: 1 }
    const job = newLandscapeJob(model, 2, 8)
    let guard = 0
    while (stepLandscape(job, 3) && guard++ < 100) {
      /* incremental, as the frame loop does it */
    }
    expect(job.rowsDone).toBe(8)
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const want = energyAt(model, 2, landscapeAngle(col, 8), landscapeAngle(row, 8))
        expect(job.values[row * 8 + col]).toBeCloseTo(want, 12)
      }
    }
    expect(job.min).toBeLessThan(job.max)
  })

  it('reports incomplete rows as NaN so a partial landscape cannot be drawn as zero', () => {
    const job = newLandscapeJob({ n: 3, J: 1, h: 1 }, 2, 8)
    stepLandscape(job, 2)
    expect(Number.isNaN(job.values[7 * 8])).toBe(true)
    expect(Number.isNaN(job.values[0])).toBe(false)
  })
})

// ── Test-only reference implementations ──────────────────────────────────────

/** Dense H for the Ising model, built term by term from the Pauli definitions. */
function buildDenseIsing(model: Ising): number[][] {
  const { n, J, h } = model
  const dim = 1 << n
  const H = Array.from({ length: dim }, () => new Array<number>(dim).fill(0))
  for (let k = 0; k < dim; k++) {
    let zz = 0
    for (let i = 0; i < n - 1; i++) {
      const si = 1 - 2 * ((k >> i) & 1)
      const sj = 1 - 2 * ((k >> (i + 1)) & 1)
      zz += si * sj
    }
    H[k][k] += -J * zz
    for (let i = 0; i < n; i++) H[k ^ (1 << i)][k] += -h
  }
  return H
}

/** Smallest eigenvalue by cyclic Jacobi. Independent of the Lanczos code under test. */
function denseSmallestEigenvalue(A: number[][]): number {
  const n = A.length
  const M = A.map((row) => row.slice())
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += M[p][q] * M[p][q]
    if (off < 1e-24) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-18) continue
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q])
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const mkp = M[k][p]
          const mkq = M[k][q]
          M[k][p] = c * mkp - s * mkq
          M[k][q] = s * mkp + c * mkq
        }
        for (let k = 0; k < n; k++) {
          const mpk = M[p][k]
          const mqk = M[q][k]
          M[p][k] = c * mpk - s * mqk
          M[q][k] = s * mpk + c * mqk
        }
      }
    }
  }
  return Math.min(...M.map((row, i) => row[i]))
}

/**
 * The same circuit and the same random parameters as barrenGradientSample, but
 * differentiated numerically. Depends on mulberry32 consuming the parameters in the
 * identical order, which is why both are seeded the same way.
 */
function finiteDifferenceBarrenGradient(model: Ising, rand: () => number, eps: number): number {
  const { n } = model
  const layers = barrenLayers(n)
  const perLayer = BARREN_PARAMS_PER_LAYER(n)
  const params: number[] = []
  for (let i = 0; i < layers * perLayer; i++) params.push(rand() * 2 * Math.PI)
  const target = Math.floor(layers / 2) * perLayer

  const evaluate = (shift: number): number => {
    const w = zeroState(n)
    for (let l = 0; l < layers; l++) {
      for (let q = 0; q < n; q++) {
        const idx = l * perLayer + q
        applyRY(w, q, params[idx] + (idx === target ? shift : 0))
      }
      if (n === 2) applyCZ(w, 0, 1)
      else for (let q = 0; q < n; q++) applyCZ(w, q, (q + 1) % n)
      for (let q = 0; q < n; q++) applyRX(w, q, params[l * perLayer + n + q])
    }
    return energyOf(w, model)
  }
  return (evaluate(eps) - evaluate(-eps)) / (2 * eps) / n
}
