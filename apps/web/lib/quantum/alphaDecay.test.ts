import { describe, expect, it } from 'vitest'
import { rectangularBarrierTransmission } from './schrodinger'
import {
  ALPHA_MASS_MEV,
  AMU_MEV,
  DEFAULT_R0,
  FINE_STRUCTURE,
  NUCLIDES,
  amplitudeRatio,
  assaultFrequency,
  buildDisplayModel,
  fitLine,
  formatHalfLife,
  gamowBracket,
  gamowFactor,
  gamowFactorNumeric,
  geigerNuttallX,
  nuclearRadius,
  nuclideById,
  predictDecay,
  reducedMass,
  stmCurrent,
  stmCurrentRatio,
  stmKappa,
  turningPoint,
  wkbTransmission,
} from './alphaDecay'

/**
 * Every number these tests compare against comes from somewhere OTHER than the code under
 * test: the exact rectangular-barrier formula in schrodinger.ts (checked there against
 * closed forms), the Sommerfeld limit of the Coulomb integral, quadrature done a different
 * way, published half-lives, and an STM decay constant worked out by hand from SI values.
 */

// ─────────────────────────────────────────────────────────────────────────────
// WKB against the exact rectangular barrier
// ─────────────────────────────────────────────────────────────────────────────

describe('WKB transmission through a rectangular barrier', () => {
  const height = 4
  const energy = 2
  const kappa = Math.sqrt(2 * (height - energy))
  const barrier = (width: number) => (x: number) => (x >= 0 && x <= width ? height : 0)

  it('has exactly the exponent e^{−2κL} for a flat barrier', () => {
    const width = 3
    const t = wkbTransmission(barrier(width), energy, -1, width + 1, 8000)
    expect(t).toBeCloseTo(Math.exp(-2 * kappa * width), 12)
  })

  it('matches the exact result in the thick-barrier limit, up to the known prefactor', () => {
    // Exact: T → 16E(V₀−E)/V₀² · e^{−2κL} as κL → ∞. At E = V₀/2 the prefactor is 4.
    const prefactor = (16 * energy * (height - energy)) / (height * height)
    expect(prefactor).toBe(4)
    for (const width of [4, 8, 12]) {
      const exact = rectangularBarrierTransmission(energy, height, width)
      const wkb = wkbTransmission(barrier(width), energy, 0, width, 8000)
      // The ratio settles onto 1/prefactor with a correction of order e^{−2κL}.
      expect(Math.abs(wkb / exact - 1 / prefactor)).toBeLessThan(2 * Math.exp(-2 * kappa * width) + 1e-9)
      // And the exponents themselves converge: ln T agrees to under 1% by κL = 24.
      // ln T_exact = −2κL + ln(prefactor) + O(e^{−2κL}), so the relative gap in the exponent is
      // exactly ln(prefactor)/(2κL − ln(prefactor)) and shrinks as the barrier thickens.
      const gap = Math.log(prefactor) / (2 * kappa * width - Math.log(prefactor))
      expect(Math.abs(Math.log(wkb) / Math.log(exact) - 1)).toBeLessThan(gap + 1e-6)
      expect(Math.abs(Math.log(wkb) / Math.log(exact) - 1)).toBeGreaterThan(gap - 1e-6)
    }
    const thick = 12
    expect(
      Math.abs(
        Math.log(wkbTransmission(barrier(thick), energy, -1, thick + 1, 8000)) /
          Math.log(rectangularBarrierTransmission(energy, height, thick)) -
          1
      )
    ).toBeLessThan(0.03)
  })

  it('is 1 when the energy clears the barrier and 0 in the limit of a wall', () => {
    expect(wkbTransmission(barrier(3), 5, -1, 4)).toBe(1)
    expect(wkbTransmission(barrier(400), 2, -1, 401, 20000)).toBeLessThan(1e-300)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The Coulomb integral
// ─────────────────────────────────────────────────────────────────────────────

describe('the Gamow factor', () => {
  it('has the Sommerfeld limit G → 2π·Z₁Z₂·α·c/v when R → 0', () => {
    // Independent analytic value: with Z₁ = 2 and v = √(2Q/μ), G(R→0) = 2π·2Z_d·α/β.
    const input = { Z: 92, A: 238, q: 4.27, r0: 1e-6 }
    const mu = reducedMass(238)
    const beta = Math.sqrt((2 * input.q) / mu)
    const sommerfeld = (2 * Math.PI * 2 * 90 * FINE_STRUCTURE) / beta
    expect(gamowFactor(input) / sommerfeld).toBeCloseTo(1, 3)
  })

  it('agrees with brute-force quadrature of (2/ħ)∫√(2μ(V−Q)) dr', () => {
    for (const n of NUCLIDES) {
      const closed = gamowFactor(n)
      const numeric = gamowFactorNumeric(n, 40000)
      expect(Math.abs(closed / numeric - 1), n.id).toBeLessThan(1e-6)
    }
  })

  it('bracket is π/2 with no nuclear radius and 0 with no barrier', () => {
    expect(gamowBracket(0)).toBeCloseTo(Math.PI / 2, 12)
    expect(gamowBracket(1)).toBeCloseTo(0, 12)
    // Spot value by hand: x = 0.25 → arccos(0.5) − √(0.25·0.75) = π/3 − √3/4.
    expect(gamowBracket(0.25)).toBeCloseTo(Math.PI / 3 - Math.sqrt(3) / 4, 12)
  })

  it('vanishes once Q is above the barrier top', () => {
    expect(gamowFactor({ Z: 92, A: 238, q: 40 })).toBe(0)
  })

  it('uses the geometry a textbook quotes', () => {
    // U-238 → Th-234: b = 2·90·1.44/4.27 ≈ 60.7 fm; R ≈ 1.1·(6.15 + 1.59) ≈ 8.5 fm.
    expect(turningPoint(90, 4.27)).toBeCloseTo(60.7, 0)
    expect(nuclearRadius(238, DEFAULT_R0)).toBeCloseTo(8.51, 1)
    // Reduced mass sits just under the alpha mass, as it must.
    expect(reducedMass(238)).toBeLessThan(ALPHA_MASS_MEV)
    expect(reducedMass(238)).toBeGreaterThan(0.98 * ALPHA_MASS_MEV)
    expect(234 * AMU_MEV).toBeGreaterThan(50 * ALPHA_MASS_MEV)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Half-lives against the measured values
// ─────────────────────────────────────────────────────────────────────────────

describe('predicted half-lives', () => {
  const featured = ['U-238', 'Ra-226', 'Po-210', 'Po-212']

  it('fall within an order of magnitude of the measured ones for the four featured nuclides', () => {
    for (const id of featured) {
      const n = nuclideById(id)!
      const ratio = predictDecay(n).halfLifeS / n.halfLifeS
      expect(ratio, `${id}: predicted/measured = ${ratio.toFixed(3)}`).toBeGreaterThan(0.1)
      expect(ratio, `${id}: predicted/measured = ${ratio.toFixed(3)}`).toBeLessThan(10)
    }
  })

  it('and for the extra nuclides on the plot too', () => {
    for (const n of NUCLIDES) {
      const ratio = predictDecay(n).halfLifeS / n.halfLifeS
      expect(ratio, n.id).toBeGreaterThan(0.1)
      expect(ratio, n.id).toBeLessThan(10)
    }
  })

  it('preserve the order across 24 orders of magnitude', () => {
    const predicted = featured.map((id) => predictDecay(nuclideById(id)!).halfLifeS)
    const measured = featured.map((id) => nuclideById(id)!.halfLifeS)
    for (let i = 1; i < featured.length; i++) {
      expect(measured[i - 1]).toBeGreaterThan(measured[i])
      expect(predicted[i - 1], `${featured[i - 1]} before ${featured[i]}`).toBeGreaterThan(predicted[i])
    }
    expect(measured[0] / measured[3]).toBeGreaterThan(1e23)
  })

  it('assault the wall about 10²¹ times a second — the prefactor is never the story', () => {
    for (const n of NUCLIDES) {
      const f = assaultFrequency(n)
      expect(f, n.id).toBeGreaterThan(1e21)
      expect(f, n.id).toBeLessThan(1e22)
    }
    // U-238's T is ~10⁻³⁹: the frequency contributes 21 orders, the exponent ~39.
    const u = predictDecay(nuclideById('U-238')!)
    expect(Math.log10(u.transmission)).toBeLessThan(-38)
    expect(Math.log10(u.transmission)).toBeGreaterThan(-41)
  })

  it('is extraordinarily sensitive to Q: doubling it wipes out ~18 orders of magnitude', () => {
    const slow = predictDecay({ Z: 84, A: 212, q: 4.5 }).halfLifeS
    const fast = predictDecay({ Z: 84, A: 212, q: 9 }).halfLifeS
    expect(Math.log10(slow / fast)).toBeGreaterThan(17)
    expect(Math.log10(slow / fast)).toBeLessThan(20)
  })

  it('the Geiger–Nuttall points fall on a line with the textbook slope', () => {
    // log₁₀ t½ = a·Z_d/√Q + b, with a ≈ 1.6–1.7 across the alpha emitters. Measured values.
    const pts = NUCLIDES.map((n) => ({
      x: geigerNuttallX(n.Z - 2, n.q),
      y: Math.log10(n.halfLifeS),
    }))
    const fit = fitLine(pts)!
    expect(fit.slope).toBeGreaterThan(1.4)
    expect(fit.slope).toBeLessThan(1.9)
    // Residuals of the measured points about that line are under 2 decades — Po-210's
    // shell-closure hindrance is the largest.
    let worst = 0
    let worstId = ''
    for (let i = 0; i < pts.length; i++) {
      const r = Math.abs(pts[i].y - (fit.intercept + fit.slope * pts[i].x))
      if (r > worst) {
        worst = r
        worstId = NUCLIDES[i].id
      }
    }
    expect(worst).toBeLessThan(2)
    expect(worstId).toBe('Po-210')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// STM
// ─────────────────────────────────────────────────────────────────────────────

describe('scanning tunnelling microscope', () => {
  it('κ for a 4.5 eV work function is 1.087 Å⁻¹ (by hand from √(2mₑφ)/ħ in SI)', () => {
    // √(2 · 9.10938e−31 kg · 4.5 · 1.602177e−19 J) / 1.054572e−34 J·s = 1.0866e10 m⁻¹.
    expect(stmKappa(4.5)).toBeCloseTo(1.0866, 3)
  })

  it('changes the current by 5–15× per ångström for any metal work function', () => {
    for (const phi of [4, 4.25, 4.5, 4.75, 5]) {
      const ratio = stmCurrentRatio(1, phi)
      expect(ratio, `φ = ${phi} eV`).toBeGreaterThan(5)
      expect(ratio, `φ = ${phi} eV`).toBeLessThan(15)
    }
    // And the specific value: e^{2·1.0866} ≈ 8.79.
    expect(stmCurrentRatio(1, 4.5)).toBeCloseTo(8.79, 1)
  })

  it('current is e^{−2κd} and never grows with distance', () => {
    expect(stmCurrent(0, 4.5)).toBe(1)
    expect(stmCurrent(2, 4.5)).toBeCloseTo(Math.exp(-2 * 1.0866 * 2), 3)
    expect(stmCurrent(5, 4.5)).toBeLessThan(stmCurrent(4, 4.5))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The drawn wavefunction
// ─────────────────────────────────────────────────────────────────────────────

describe('the scaled Schrödinger picture', () => {
  it('is a solution with u(0) = 0 whose amplitude falls by ~e^{−G/2} across the barrier', () => {
    for (const n of NUCLIDES) {
      const p = predictDecay(n)
      const m = buildDisplayModel(p.R / p.b, p.G)
      expect(m.originResidual, n.id).toBeLessThan(1e-8)
      expect(m.x).toBeCloseTo(p.R / p.b, 10)
      // WKB prefactors (√k ratios) shift the amplitude ratio by an O(1) factor; the exponent
      // is what the picture has to get right.
      const expected = Math.exp(m.G / 2)
      expect(m.amplitudeRatio, n.id).toBeGreaterThan(0.3 * expected)
      expect(m.amplitudeRatio, n.id).toBeLessThan(1.5 * expected)
      // The drawn barrier drops to exactly E at the turning point.
      const ib = m.grid.x.findIndex((r) => r >= m.b)
      expect(m.potential[ib] / m.energy).toBeCloseTo(1, 1)
      expect(m.barrierTop).toBeGreaterThan(m.energy)
    }
  })

  it('decays monotonically through the forbidden region — no oscillation under the barrier', () => {
    const p = predictDecay(nuclideById('Ra-226')!)
    const m = buildDisplayModel(p.R / p.b, p.G)
    let prev = Infinity
    for (let i = 0; i < m.grid.n; i++) {
      const r = m.grid.x[i]
      if (r < m.R * 1.02 || r > 0.9 * m.b) continue
      const a = Math.abs(m.psi[i])
      expect(a, `r = ${r.toFixed(2)}`).toBeLessThanOrEqual(prev * (1 + 1e-9))
      prev = a
    }
  })

  it('a heavier barrier draws a smaller leak', () => {
    const u = predictDecay(nuclideById('U-238')!)
    const po = predictDecay(nuclideById('Po-212')!)
    const mu = buildDisplayModel(u.R / u.b, u.G)
    const mpo = buildDisplayModel(po.R / po.b, po.G)
    expect(mu.amplitudeRatio).toBeGreaterThan(2 * mpo.amplitudeRatio)
    expect(amplitudeRatio(mu.grid, mu.psi, mu.R, mu.b)).toBe(mu.amplitudeRatio)
  })
})

describe('formatting', () => {
  it('says half-lives the way people do', () => {
    expect(formatHalfLife(4.468e9 * 365.25 * 86400)).toBe('4.47 billion years')
    expect(formatHalfLife(138.376 * 86400)).toBe('138 days')
    expect(formatHalfLife(0.299e-6)).toBe('299 ns')
    expect(formatHalfLife(164.3e-6)).toBe('164 μs')
    expect(formatHalfLife(0)).toBe('—')
  })
})
