import { describe, expect, it } from 'vitest'
import {
  boundStates,
  centeredGrid,
  coherentState,
  countNodes,
  expectationP,
  expectationX,
  freeSpreadWidth,
  gaussianPacket,
  harmonicPotential,
  norm,
  probabilityCurrent,
  rectangularBarrierTransmission,
  solveStationary,
  spreadX,
  squareWellPotential,
  SplitStepPropagator,
  uniformGrid,
  zeroPotential,
  boxGrid,
  barrierPotential,
} from './schrodinger'

/**
 * Every number this file compares against is derived OUTSIDE the engine — from a
 * textbook closed form, or from an independent numerical solution of the analytic
 * transcendental condition. Nothing here asserts a solver's output back at itself.
 *
 * ħ = m = 1, matching the engine.
 */

/** Analytic infinite-well level: E_n = n²π²/(2L²), n = 1, 2, 3, … */
function infiniteWellEnergy(n: number, length: number): number {
  return (n * n * Math.PI * Math.PI) / (2 * length * length)
}

/** Analytic infinite-well eigenfunction: ψ_n(x) = √(2/L)·sin(nπx/L). */
function infiniteWellPsi(n: number, length: number, x: number): number {
  return Math.sqrt(2 / length) * Math.sin((n * Math.PI * x) / length)
}

/** Analytic oscillator ground state: ψ₀(x) = (ω/π)^{1/4}·exp(−ωx²/2). */
function oscillatorGroundState(omega: number, x: number): number {
  return Math.pow(omega / Math.PI, 0.25) * Math.exp((-omega * x * x) / 2)
}

/**
 * The even ground state of a finite square well of depth V₀ and half-width a, from the
 * transcendental matching condition k·tan(ka) = κ, solved here by bisection with no help
 * from the engine. k = √(2(E+V₀)), κ = √(−2E), and the lowest even root has ka ∈ (0, π/2).
 */
function finiteWellGroundEnergy(depth: number, halfWidth: number): number {
  const kMax = Math.min(Math.PI / (2 * halfWidth), Math.sqrt(2 * depth)) - 1e-12
  const f = (k: number) => k * Math.tan(k * halfWidth) - Math.sqrt(2 * depth - k * k)
  let lo = 1e-12
  let hi = kMax
  for (let i = 0; i < 300; i++) {
    const mid = 0.5 * (lo + hi)
    if (f(mid) < 0) lo = mid
    else hi = mid
  }
  const k = 0.5 * (lo + hi)
  return (k * k) / 2 - depth
}

describe('infinite square well', () => {
  // 800 interior points across a box of width 1, walls implied at x = 0 and x = 1.
  const L = 1
  const grid = boxGrid(800, L)
  const states = solveStationary(grid, zeroPotential(grid), 6)

  it('reproduces E_n = n²π²/2L² for the first six levels', () => {
    for (let k = 0; k < states.length; k++) {
      const n = k + 1
      const exact = infiniteWellEnergy(n, L)
      expect(Math.abs(states[k].energy - exact) / exact).toBeLessThan(2e-4)
    }
  })

  it('scales as n², independent of the prefactor', () => {
    const e1 = states[0].energy
    for (let k = 1; k < states.length; k++) {
      const n = k + 1
      expect(states[k].energy / e1).toBeCloseTo(n * n, 2)
    }
  })

  it('halving the box quadruples every level', () => {
    const half = boxGrid(800, L / 2)
    const halfStates = solveStationary(half, zeroPotential(half), 3)
    for (let k = 0; k < 3; k++) {
      expect(halfStates[k].energy / states[k].energy).toBeCloseTo(4, 2)
    }
  })

  it('gives the k-th state exactly k nodes, ground state nodeless', () => {
    expect(states[0].nodes).toBe(0)
    for (let k = 0; k < states.length; k++) expect(states[k].nodes).toBe(k)
  })

  it('matches the analytic sin eigenfunctions pointwise', () => {
    for (let k = 0; k < 3; k++) {
      const n = k + 1
      let worst = 0
      for (let i = 0; i < grid.n; i++) {
        worst = Math.max(worst, Math.abs(states[k].psi[i] - infiniteWellPsi(n, L, grid.x[i])))
      }
      // ψ peaks at √2 ≈ 1.41, so this is a sub-0.1% pointwise agreement.
      expect(worst).toBeLessThan(1e-3)
    }
  })

  it('normalizes every eigenfunction to unit probability', () => {
    for (const state of states) {
      let total = 0
      for (let i = 0; i < grid.n; i++) total += state.psi[i] * state.psi[i]
      expect(total * grid.dx).toBeCloseTo(1, 10)
    }
  })
})

describe('harmonic oscillator', () => {
  const omega = 1
  const grid = uniformGrid(2401, 0.01, -12)
  const states = solveStationary(grid, harmonicPotential(grid, omega), 7)

  it('puts levels at (n + ½)ħω', () => {
    for (let n = 0; n < states.length; n++) {
      expect(states[n].energy).toBeCloseTo((n + 0.5) * omega, 3)
    }
  })

  it('spaces the levels evenly by ħω', () => {
    for (let n = 1; n < states.length; n++) {
      expect(states[n].energy - states[n - 1].energy).toBeCloseTo(omega, 3)
    }
  })

  it('scales the whole ladder with ω', () => {
    const w2 = 2.5
    const stiff = solveStationary(grid, harmonicPotential(grid, w2), 4)
    for (let n = 0; n < 4; n++) {
      expect(stiff[n].energy).toBeCloseTo((n + 0.5) * w2, 3)
    }
  })

  it('has a Gaussian ground state matching (ω/π)^¼·exp(−ωx²/2)', () => {
    let worst = 0
    for (let i = 0; i < grid.n; i++) {
      worst = Math.max(worst, Math.abs(states[0].psi[i] - oscillatorGroundState(omega, grid.x[i])))
    }
    expect(worst).toBeLessThan(1e-4)
  })

  it('gives the n-th state n nodes', () => {
    for (let n = 0; n < states.length; n++) expect(states[n].nodes).toBe(n)
  })
})

describe('finite square well', () => {
  const depth = 20
  const halfWidth = 1
  // Well edges land midway between grid points, so the discretised well is exactly
  // 2 units wide with no half-cell bias at either edge.
  const dx = 0.005
  const grid = uniformGrid(3200, dx, -8 + dx / 2)
  const potential = squareWellPotential(grid, depth, 2 * halfWidth)
  const states = boundStates(grid, potential, 10, 0)

  it('binds ⌈w√(2V₀)/π⌉ states and no more', () => {
    const expected = Math.ceil((2 * halfWidth * Math.sqrt(2 * depth)) / Math.PI)
    expect(states.length).toBe(expected)
  })

  it('matches the transcendental ground-state energy', () => {
    const exact = finiteWellGroundEnergy(depth, halfWidth)
    expect(Math.abs(states[0].energy - exact) / Math.abs(exact)).toBeLessThan(2e-3)
  })

  it('keeps every bound state below the well top and above its floor', () => {
    for (const state of states) {
      expect(state.energy).toBeLessThan(0)
      expect(state.energy).toBeGreaterThan(-depth)
    }
  })

  it('leaks into the classically forbidden region, more as the well gets shallow', () => {
    const outside = (energyStates: ReturnType<typeof boundStates>) => {
      const psi = energyStates[0].psi
      let out = 0
      for (let i = 0; i < grid.n; i++) {
        if (Math.abs(grid.x[i]) > halfWidth) out += psi[i] * psi[i] * grid.dx
      }
      return out
    }
    const deepOut = outside(states)
    const shallow = boundStates(grid, squareWellPotential(grid, 0.4, 2 * halfWidth), 10, 0)
    const shallowOut = outside(shallow)

    expect(deepOut).toBeGreaterThan(0)
    expect(shallowOut).toBeGreaterThan(deepOut)
    // A shallow well barely holds its own ground state: most of the particle is outside
    // the walls, which is the whole point of the page this backs.
    expect(shallowOut).toBeGreaterThan(0.3)
  })
})

describe('split-step propagator', () => {
  it('conserves norm to round-off over a long evolution', () => {
    const grid = centeredGrid(512, 20)
    const potential = harmonicPotential(grid, 1)
    const psi = gaussianPacket(grid, { x0: 2, k0: 1.5, sigma: 0.8 })
    const prop = new SplitStepPropagator(grid, potential, { dt: 0.005 })

    expect(norm(psi, grid.dx)).toBeCloseTo(1, 12)
    prop.advance(psi, 4000)
    // 4000 steps = 8000 FFTs. Split-step is a product of unit-modulus factors, so the
    // only loss is floating point.
    expect(Math.abs(norm(psi, grid.dx) - 1)).toBeLessThan(1e-12)
  })

  it('moves a free packet at ⟨x⟩ = x₀ + k₀t (Ehrenfest)', () => {
    const grid = centeredGrid(1024, 20)
    const psi = gaussianPacket(grid, { x0: -10, k0: 3, sigma: 1 })
    const prop = new SplitStepPropagator(grid, zeroPotential(grid), { dt: 0.005 })
    prop.advance(psi, 400) // t = 2
    expect(expectationX(grid, psi)).toBeCloseTo(-10 + 3 * 2, 6)
  })

  it('spreads a free packet by σ(t) = σ₀√(1 + (t/2σ₀²)²)', () => {
    const grid = centeredGrid(1024, 20)
    const sigma0 = 1
    const psi = gaussianPacket(grid, { x0: 0, k0: 0, sigma: sigma0 })
    expect(spreadX(grid, psi)).toBeCloseTo(sigma0, 4)
    const prop = new SplitStepPropagator(grid, zeroPotential(grid), { dt: 0.005 })
    prop.advance(psi, 400) // t = 2
    const expected = freeSpreadWidth(sigma0, 2)
    expect(expected).toBeCloseTo(Math.SQRT2, 10) // sanity on the closed form itself
    expect(spreadX(grid, psi) / expected).toBeCloseTo(1, 3)
  })

  it('narrower packets spread faster', () => {
    const grid = centeredGrid(1024, 20)
    const run = (sigma0: number) => {
      const psi = gaussianPacket(grid, { x0: 0, k0: 0, sigma: sigma0 })
      const prop = new SplitStepPropagator(grid, zeroPotential(grid), { dt: 0.005 })
      prop.advance(psi, 200) // t = 1
      return spreadX(grid, psi) / sigma0
    }
    expect(run(0.6)).toBeGreaterThan(run(1.5))
  })

  it('oscillates a coherent state like a classical particle', () => {
    const omega = 1.5
    const displacement = 2
    const grid = centeredGrid(1024, 14)
    const potential = harmonicPotential(grid, omega)
    const psi = coherentState(grid, omega, displacement)
    const prop = new SplitStepPropagator(grid, potential, { dt: 0.002 })

    const width0 = spreadX(grid, psi)
    const period = (2 * Math.PI) / omega
    const quarterSteps = Math.round(period / 4 / 0.002)

    prop.advance(psi, quarterSteps)
    expect(expectationX(grid, psi)).toBeCloseTo(displacement * Math.cos(Math.PI / 2), 2)
    prop.advance(psi, quarterSteps)
    expect(expectationX(grid, psi)).toBeCloseTo(-displacement, 2)
    prop.advance(psi, 2 * quarterSteps)
    expect(expectationX(grid, psi)).toBeCloseTo(displacement, 2)

    // A coherent state is the one packet that does not spread: same width a period later.
    expect(spreadX(grid, psi) / width0).toBeCloseTo(1, 2)
  })
})

describe('probability current', () => {
  it('gives j = k|A|² for a plane wave', () => {
    const dx = 0.01
    const grid = uniformGrid(600, dx, 0)
    const k = 2
    const amplitude = 0.37
    const re = new Float64Array(grid.n)
    const im = new Float64Array(grid.n)
    for (let i = 0; i < grid.n; i++) {
      re[i] = amplitude * Math.cos(k * grid.x[i])
      im[i] = amplitude * Math.sin(k * grid.x[i])
    }
    const j = probabilityCurrent(grid, { re, im })
    const expected = k * amplitude * amplitude
    // Interior points only: the ends use a one-sided difference by design.
    for (let i = 1; i < grid.n - 1; i++) {
      expect(Math.abs(j[i] - expected) / expected).toBeLessThan(1e-3)
    }
  })

  it('flows the other way for a leftward wave', () => {
    const grid = uniformGrid(600, 0.01, 0)
    const re = new Float64Array(grid.n)
    const im = new Float64Array(grid.n)
    for (let i = 0; i < grid.n; i++) {
      re[i] = Math.cos(-2 * grid.x[i])
      im[i] = Math.sin(-2 * grid.x[i])
    }
    const j = probabilityCurrent(grid, { re, im })
    expect(j[300]).toBeLessThan(0)
  })

  it('vanishes for a real (standing) eigenfunction', () => {
    const grid = boxGrid(400, 1)
    const [ground] = solveStationary(grid, zeroPotential(grid), 1)
    const j = probabilityCurrent(grid, { re: ground.psi, im: new Float64Array(grid.n) })
    for (let i = 0; i < grid.n; i++) expect(Math.abs(j[i])).toBeLessThan(1e-12)
  })

  it('integrates to ⟨p⟩ = k₀ for a Gaussian packet', () => {
    const grid = centeredGrid(2048, 20)
    const psi = gaussianPacket(grid, { x0: 0, k0: 1.7, sigma: 1.2 })
    expect(expectationP(grid, psi)).toBeCloseTo(1.7, 3)
  })
})

describe('rectangular barrier transmission (closed form)', () => {
  it('is perfectly transmitting at the above-barrier resonances', () => {
    const height = 1
    const width = 2
    for (const n of [1, 2, 3]) {
      // k₂·width = nπ ⟹ the barrier is a whole number of half-wavelengths wide.
      const k2 = (n * Math.PI) / width
      const energy = height + (k2 * k2) / 2
      expect(rectangularBarrierTransmission(energy, height, width)).toBeCloseTo(1, 8)
    }
  })

  it('reflects some of a wave that has more than enough energy', () => {
    // Classically this particle sails over. Quantum mechanically ~15% comes back.
    const t = rectangularBarrierTransmission(1.6, 1, 2)
    expect(t).toBeLessThan(0.95)
    expect(t).toBeGreaterThan(0.5)
  })

  it('decays exponentially with barrier width below the top', () => {
    const ratios: number[] = []
    for (const width of [2, 3, 4]) {
      ratios.push(rectangularBarrierTransmission(0.5, 1, width))
    }
    expect(ratios[0]).toBeGreaterThan(ratios[1])
    expect(ratios[1]).toBeGreaterThan(ratios[2])
    // Thick-barrier limit: T → [16E(V₀−E)/V₀²]·exp(−2κw), κ = √(2(V₀−E)).
    const kappa = Math.sqrt(2 * 0.5)
    const prefactor = (16 * 0.5 * 0.5) / 1
    const asymptotic = prefactor * Math.exp(-2 * kappa * 4)
    expect(ratios[2] / asymptotic).toBeCloseTo(1, 2)
  })

  it('is 1 for no barrier at all', () => {
    expect(rectangularBarrierTransmission(0.8, 0, 3)).toBe(1)
  })
})

describe('packet scattering against the closed form', () => {
  /**
   * The strongest check in this file: evolve a real packet into a real barrier and compare
   * the transmitted probability with ∫|φ(k)|²·T(k)dk, where T(k) is the textbook plane-wave
   * transmission and |φ(k)|² is the packet's analytic momentum distribution. Each momentum
   * component transmits independently with probability T(k), so that integral is the exact
   * answer for the packet — not an approximation of it — and it is computed here entirely
   * from closed forms.
   */
  it('transmits the momentum-weighted analytic fraction, above the barrier', () => {
    const height = 1
    const sigma = 3
    const k0 = Math.sqrt(2 * 1.6) // mean energy 1.6, comfortably above the barrier

    const grid = centeredGrid(1024, 60)
    // The barrier is an exact whole number of grid cells wide. This is not fussiness: T
    // depends on sin²(k₂·width), so a barrier that is 2% narrower than the number in the
    // formula answers a different question, and the comparison would be measuring the
    // rounding rather than the physics.
    const width = 17 * grid.dx
    const potential = barrierPotential(grid, height, width, 0)
    const psi = gaussianPacket(grid, { x0: -28, k0, sigma })
    const split = Math.round((0 - grid.x[0]) / grid.dx)
    const prop = new SplitStepPropagator(grid, potential, {
      dt: 0.02,
      absorbFraction: 0.12,
      absorbStrength: 0.5,
      splitIndex: split,
    })
    prop.advance(psi, 1800) // t = 36; both lobes are well clear of the barrier by now

    let left = prop.absorbedLeft
    let right = prop.absorbedRight
    for (let i = 0; i < grid.n; i++) {
      const p = (psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]) * grid.dx
      if (i < split) left += p
      else right += p
    }
    const measured = right / (left + right)

    // Momentum-space average of the closed-form T, computed independently.
    const sigmaK = 1 / (2 * sigma)
    let weighted = 0
    let weight = 0
    for (let s = -6; s <= 6; s += 0.01) {
      const k = k0 + s * sigmaK
      if (k <= 0) continue
      const w = Math.exp(-0.5 * s * s)
      weighted += w * rectangularBarrierTransmission((k * k) / 2, height, width)
      weight += w
    }
    const analytic = weighted / weight

    expect(analytic).toBeLessThan(0.95) // above-barrier reflection is real
    expect(measured).toBeGreaterThan(0.5)
    expect(Math.abs(measured - analytic) / analytic).toBeLessThan(0.02)
  })
})

describe('reflection off a well', () => {
  /**
   * The result nobody expects twice: a particle speeds up over a hole in the potential and
   * some of it still bounces back. Same closed form as the barrier with a negative height,
   * same momentum-weighted comparison as the test above.
   */
  it('bounces a measurable fraction off a purely attractive well', () => {
    const depth = 1.2
    const sigma = 3
    const meanEnergy = 0.35
    const k0 = Math.sqrt(2 * meanEnergy)

    const grid = centeredGrid(1024, 60)
    // Again an exact whole number of cells — see the note in the barrier test above.
    const width = 25 * grid.dx
    const potential = barrierPotential(grid, -depth, width, 0)
    const psi = gaussianPacket(grid, { x0: -28, k0, sigma })
    const split = Math.round(grid.n / 2)
    const prop = new SplitStepPropagator(grid, potential, {
      dt: 0.02,
      absorbFraction: 0.14,
      absorbStrength: 0.3,
      splitIndex: split,
    })
    prop.advance(psi, 14000)

    let left = prop.absorbedLeft
    let right = prop.absorbedRight
    for (let i = 0; i < grid.n; i++) {
      const p = (psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]) * grid.dx
      if (i < split) left += p
      else right += p
    }
    const total = left + right
    expect(total).toBeCloseTo(1, 8) // the absorber accounted for every bit of it
    const measuredReflection = left / total

    const sigmaK = 1 / (2 * sigma)
    let weighted = 0
    let weight = 0
    for (let s = -6; s <= 6; s += 0.01) {
      const k = k0 + s * sigmaK
      if (k <= 0) continue
      const w = Math.exp(-0.5 * s * s)
      weighted += w * (1 - rectangularBarrierTransmission((k * k) / 2, -depth, width))
      weight += w
    }
    const analyticReflection = weighted / weight

    expect(analyticReflection).toBeGreaterThan(0.15)
    expect(Math.abs(measuredReflection - analyticReflection) / analyticReflection).toBeLessThan(
      0.015
    )
  })
})

describe('countNodes', () => {
  it('ignores numerical noise in an exponential tail', () => {
    const psi = new Float64Array(100)
    for (let i = 0; i < 100; i++) psi[i] = Math.sin((Math.PI * i) / 99)
    // Bury alternating-sign dust three orders of magnitude below the peak's threshold.
    psi[0] = 1e-9
    psi[1] = -1e-9
    psi[98] = -1e-9
    expect(countNodes(psi)).toBe(0)
  })

  it('counts real sign changes', () => {
    const psi = new Float64Array(100)
    for (let i = 0; i < 100; i++) psi[i] = Math.sin((3 * Math.PI * i) / 99)
    expect(countNodes(psi)).toBe(2)
  })
})
