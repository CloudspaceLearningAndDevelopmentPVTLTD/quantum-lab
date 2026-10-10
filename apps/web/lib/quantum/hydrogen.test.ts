import { describe, expect, it } from 'vitest'
import {
  BOHR_RADIUS_NM,
  IONIZATION_ENERGY_EV,
  angularNodeCount,
  associatedLaguerre,
  associatedLegendre,
  energyEv,
  expectedRadius,
  isVisible,
  lineName,
  makeRadialSampler,
  mulberry32,
  orbitalName,
  psi,
  radialNodeCount,
  radialProbabilityDensity,
  radialWavefunction,
  realSphericalHarmonic,
  regionOf,
  sampleOrbitalCloud,
  seriesLimitNm,
  seriesLines,
  totalNodeCount,
  transitionEnergyEv,
  transitionWavelengthNm,
} from './hydrogen'

/**
 * Every assertion in this file is against something computed OUTSIDE
 * hydrogen.ts: a closed form copied from Griffiths, a textbook expectation
 * value, a node-count rule, or a laboratory wavelength measured at NIST. None
 * of it asserts the module's output back at itself.
 */

// ── numerical integration helpers (deliberately independent of the module) ───

/** Composite Simpson's rule on [a, b] with an even number of intervals. */
function simpson(f: (x: number) => number, a: number, b: number, n: number): number {
  const steps = n % 2 === 0 ? n : n + 1
  const h = (b - a) / steps
  let sum = f(a) + f(b)
  for (let i = 1; i < steps; i++) {
    sum += f(a + i * h) * (i % 2 === 0 ? 2 : 4)
  }
  return (sum * h) / 3
}

/**
 * ∫ f(θ, φ) dΩ over the whole sphere. Substituting u = cos θ removes the sin θ
 * Jacobian; the φ integral is a plain periodic trapezoid, which converges
 * spectrally for the trigonometric integrands here.
 */
function sphereIntegral(f: (theta: number, phi: number) => number, nu = 2000, nphi = 128): number {
  const dphi = (2 * Math.PI) / nphi
  let total = 0
  for (let j = 0; j < nphi; j++) {
    const phi = j * dphi
    total += simpson((u) => f(Math.acos(Math.min(1, Math.max(-1, u))), phi), -1, 1, nu)
  }
  return total * dphi
}

/** Sign changes of `f` sampled across (a, b]. */
function countSignChanges(f: (x: number) => number, a: number, b: number, steps: number): number {
  const h = (b - a) / steps
  let changes = 0
  let prev = f(a + h)
  for (let i = 2; i <= steps; i++) {
    const cur = f(a + i * h)
    if (prev !== 0 && cur !== 0 && Math.sign(cur) !== Math.sign(prev)) changes++
    if (cur !== 0) prev = cur
  }
  return changes
}

const ALL_STATES: [number, number][] = []
for (let n = 1; n <= 6; n++) for (let l = 0; l < n; l++) ALL_STATES.push([n, l])

// ─────────────────────────────────────────────────────────────────────────────

describe('associated Laguerre polynomials', () => {
  it('matches the closed forms for the first three degrees', () => {
    for (const x of [0, 0.3, 1, 2.5, 7]) {
      expect(associatedLaguerre(0, 3, x)).toBeCloseTo(1, 12)
      // L_1^α(x) = 1 + α − x
      expect(associatedLaguerre(1, 3, x)).toBeCloseTo(4 - x, 12)
      // L_2^α(x) = x²/2 − (α+2)x + (α+1)(α+2)/2
      const alpha = 3
      const expected = (x * x) / 2 - (alpha + 2) * x + ((alpha + 1) * (alpha + 2)) / 2
      expect(associatedLaguerre(2, alpha, x)).toBeCloseTo(expected, 12)
    }
  })

  it('L_2^1(x) = (x² − 6x + 6)/2, the polynomial inside R_30', () => {
    for (const x of [0, 1, 3, 6]) {
      expect(associatedLaguerre(2, 1, x)).toBeCloseTo((x * x - 6 * x + 6) / 2, 12)
    }
  })
})

describe('associated Legendre functions', () => {
  it('matches the closed forms (Condon–Shortley phase removed)', () => {
    for (const x of [-0.9, -0.3, 0, 0.4, 0.85]) {
      const s = Math.sqrt(1 - x * x)
      expect(associatedLegendre(0, 0, x)).toBeCloseTo(1, 12)
      expect(associatedLegendre(1, 0, x)).toBeCloseTo(x, 12)
      expect(associatedLegendre(1, 1, x)).toBeCloseTo(s, 12)
      expect(associatedLegendre(2, 0, x)).toBeCloseTo((3 * x * x - 1) / 2, 12)
      expect(associatedLegendre(2, 1, x)).toBeCloseTo(3 * x * s, 12)
      expect(associatedLegendre(2, 2, x)).toBeCloseTo(3 * (1 - x * x), 12)
      expect(associatedLegendre(3, 0, x)).toBeCloseTo((5 * x * x * x - 3 * x) / 2, 12)
    }
  })
})

describe('real spherical harmonics', () => {
  it('matches the textbook closed forms for l ≤ 2', () => {
    const cases: [number, number, (t: number, p: number) => number][] = [
      [0, 0, () => 1 / (2 * Math.sqrt(Math.PI))],
      [1, 0, (t) => Math.sqrt(3 / (4 * Math.PI)) * Math.cos(t)],
      [1, 1, (t, p) => Math.sqrt(3 / (4 * Math.PI)) * Math.sin(t) * Math.cos(p)],
      [1, -1, (t, p) => Math.sqrt(3 / (4 * Math.PI)) * Math.sin(t) * Math.sin(p)],
      [
        2,
        0,
        (t) => Math.sqrt(5 / (16 * Math.PI)) * (3 * Math.cos(t) * Math.cos(t) - 1),
      ],
      [
        2,
        -2,
        (t, p) =>
          Math.sqrt(15 / (16 * Math.PI)) * Math.sin(t) * Math.sin(t) * Math.sin(2 * p),
      ],
    ]
    for (const [l, m, closed] of cases) {
      for (const t of [0.2, 1.0, 1.9, 2.7]) {
        for (const p of [0.0, 1.3, 4.4]) {
          expect(realSphericalHarmonic(l, m, t, p)).toBeCloseTo(closed(t, p), 10)
        }
      }
    }
  })

  it('is orthonormal on the sphere', () => {
    const states: [number, number][] = [
      [0, 0],
      [1, -1],
      [1, 0],
      [1, 1],
      [2, -2],
      [2, 0],
      [2, 2],
      [3, 1],
    ]
    for (const [l, m] of states) {
      const norm = sphereIntegral((t, p) => realSphericalHarmonic(l, m, t, p) ** 2)
      expect(norm).toBeCloseTo(1, 4)
    }
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const [l1, m1] = states[i]
        const [l2, m2] = states[j]
        const overlap = sphereIntegral(
          (t, p) => realSphericalHarmonic(l1, m1, t, p) * realSphericalHarmonic(l2, m2, t, p)
        )
        expect(Math.abs(overlap)).toBeLessThan(1e-4)
      }
    }
  })
})

describe('radial wavefunctions', () => {
  it('matches the closed forms for n ≤ 3 (Griffiths table 4.7)', () => {
    const closed: Record<string, (r: number) => number> = {
      '1,0': (r) => 2 * Math.exp(-r),
      '2,0': (r) => (1 / (2 * Math.SQRT2)) * (2 - r) * Math.exp(-r / 2),
      '2,1': (r) => (1 / (2 * Math.sqrt(6))) * r * Math.exp(-r / 2),
      '3,0': (r) => (2 / (81 * Math.sqrt(3))) * (27 - 18 * r + 2 * r * r) * Math.exp(-r / 3),
      '3,1': (r) => (4 / (81 * Math.sqrt(6))) * (6 * r - r * r) * Math.exp(-r / 3),
      '3,2': (r) => (4 / (81 * Math.sqrt(30))) * r * r * Math.exp(-r / 3),
    }
    for (const [key, f] of Object.entries(closed)) {
      const [n, l] = key.split(',').map(Number)
      for (const r of [0, 0.5, 1, 2.5, 6, 12]) {
        expect(radialWavefunction(n, l, r)).toBeCloseTo(f(r), 10)
      }
    }
  })

  it('is normalised: ∫ R² r² dr = 1 for every state up to n = 6', () => {
    for (const [n, l] of ALL_STATES) {
      // Integrate well past the sampler's own grid: the e^{−2r/n} tail is real
      // probability, and cutting it short shows up here before it shows up as a
      // biased ⟨r⟩ below.
      const rMax = n * (n + 30)
      const norm = simpson((r) => radialProbabilityDensity(n, l, r), 0, rMax, 60000)
      expect(norm).toBeCloseTo(1, 8)
    }
  })

  it('has exactly n − l − 1 radial nodes', () => {
    for (const [n, l] of ALL_STATES) {
      const rMax = n * (n + 15)
      const nodes = countSignChanges((r) => radialWavefunction(n, l, r), 0, rMax, 200000)
      expect(nodes).toBe(radialNodeCount(n, l))
      expect(nodes).toBe(n - l - 1)
    }
  })

  it('reproduces ⟨r⟩ = ½(3n² − l(l+1)) a₀', () => {
    for (const [n, l] of ALL_STATES) {
      const rMax = n * (n + 30)
      const mean = simpson((r) => r * radialProbabilityDensity(n, l, r), 0, rMax, 60000)
      expect(mean).toBeCloseTo(expectedRadius(n, l), 6)
      expect(mean).toBeCloseTo(0.5 * (3 * n * n - l * (l + 1)), 6)
    }
  })

  it('reproduces ⟨1/r⟩ = 1/n² — which is why the energy depends only on n', () => {
    for (const [n, l] of ALL_STATES) {
      const rMax = n * (n + 30)
      const mean = simpson((r) => radialProbabilityDensity(n, l, r) / r, 1e-9, rMax, 60000)
      expect(mean).toBeCloseTo(1 / (n * n), 6)
    }
  })

  it('peaks at exactly n²a₀ for a circular orbit (l = n−1) — the Bohr radius', () => {
    for (let n = 1; n <= 6; n++) {
      const l = n - 1
      let best = 0
      let bestR = 0
      for (let r = 0.001; r < n * n * 4; r += 0.001) {
        const p = radialProbabilityDensity(n, l, r)
        if (p > best) {
          best = p
          bestR = r
        }
      }
      expect(bestR).toBeCloseTo(n * n, 2)
    }
  })
})

describe('angular nodes', () => {
  it('splits l into (l − |m|) cones and |m| planes, always summing to l', () => {
    for (let l = 0; l <= 4; l++) {
      for (let m = -l; m <= l; m++) {
        const am = Math.abs(m)
        const polar = countSignChanges(
          (t) => associatedLegendre(l, am, Math.cos(t)),
          0,
          Math.PI,
          20000
        )
        const azimuthalZeroCrossings =
          m === 0
            ? 0
            : countSignChanges(
                (p) => (m > 0 ? Math.cos(am * p) : Math.sin(am * p)),
                1e-6,
                2 * Math.PI + 1e-6,
                40000
              )
        // Each nodal PLANE crosses the azimuth twice.
        const planes = azimuthalZeroCrossings / 2
        expect(polar).toBe(l - am)
        expect(planes).toBe(am)
        expect(polar + planes).toBe(angularNodeCount(l))
      }
    }
  })

  it('total nodal surfaces are n − 1 however l splits them', () => {
    for (const [n, l] of ALL_STATES) {
      expect(radialNodeCount(n, l) + angularNodeCount(l)).toBe(totalNodeCount(n))
    }
  })
})

describe('the full wavefunction', () => {
  it('is normalised over all space: ∫ |ψ|² r² dr dΩ = 1', () => {
    // 2p_x, chosen because it has genuine θ *and* φ structure, so a mistake in
    // either factor (or in how psi composes them) shows up here.
    const [n, l, m] = [2, 1, 1]
    const nr = 400
    const nu = 120
    const nphi = 48
    const rMax = n * (n + 15)
    const dphi = (2 * Math.PI) / nphi
    let total = 0
    for (let j = 0; j < nphi; j++) {
      const phi = j * dphi
      const overU = simpson(
        (u) => {
          const theta = Math.acos(Math.min(1, Math.max(-1, u)))
          return simpson((r) => psi(n, l, m, r, theta, phi) ** 2 * r * r, 0, rMax, nr)
        },
        -1,
        1,
        nu
      )
      total += overU
    }
    expect(total * dphi).toBeCloseTo(1, 3)
  })

  it('is exactly the radial part times the angular part', () => {
    for (const [n, l, m, r, t, p] of [
      [3, 2, -1, 4.2, 0.9, 2.2],
      [4, 0, 0, 1.1, 2.6, 5.0],
    ] as const) {
      expect(psi(n, l, m, r, t, p)).toBeCloseTo(
        radialWavefunction(n, l, r) * realSphericalHarmonic(l, m, t, p),
        14
      )
    }
  })
})

describe('energies', () => {
  it('E_n = −13.6 eV / n²', () => {
    expect(energyEv(1)).toBeCloseTo(-13.6, 2)
    expect(IONIZATION_ENERGY_EV).toBeCloseTo(13.598, 3)
    // The measured ionization energy is 13.598434 eV. hcR_H gives 13.598287 —
    // the 1.5e-4 eV gap is fine structure and the Lamb shift, neither of which
    // a non-relativistic Schrödinger atom contains. Anything larger than that
    // would be an arithmetic mistake, not physics.
    for (let n = 1; n <= 8; n++) {
      expect(Math.abs(energyEv(n) - -13.598434 / (n * n))).toBeLessThan(2e-4)
    }
  })

  it('scales as 1/n²: E_2/E_1 = 1/4, E_3/E_1 = 1/9', () => {
    expect(energyEv(2) / energyEv(1)).toBeCloseTo(0.25, 12)
    expect(energyEv(3) / energyEv(1)).toBeCloseTo(1 / 9, 12)
    expect(energyEv(10) / energyEv(1)).toBeCloseTo(0.01, 12)
  })

  it('the Bohr radius is 0.0529 nm', () => {
    expect(BOHR_RADIUS_NM).toBeCloseTo(0.05292, 5)
  })
})

describe('emission lines against laboratory measurements', () => {
  /**
   * NIST Atomic Spectra Database, hydrogen, VACUUM wavelengths in nm. These are
   * measured values, not values this module produced, and the Rydberg formula
   * is expected to reproduce them to about four significant figures — the
   * residual is fine structure, which a non-relativistic Schrödinger atom does
   * not contain.
   */
  const LAB: [number, number, number, number][] = [
    // [n_initial, n_final, measured λ (nm, vacuum), tolerance]
    [2, 1, 121.567, 0.01], // Lyman α
    [3, 1, 102.572, 0.01], // Lyman β
    [3, 2, 656.4614, 0.05], // Balmer α — the red line in a discharge tube
    [4, 2, 486.2721, 0.05], // Balmer β — cyan
    [5, 2, 434.1684, 0.05], // Balmer γ — blue-violet
    [6, 2, 410.2892, 0.05], // Balmer δ — violet
    [4, 3, 1875.6, 1.0], // Paschen α — infrared
  ]

  it('predicts every measured line', () => {
    for (const [ni, nf, measured, tol] of LAB) {
      const predicted = transitionWavelengthNm(ni, nf)
      expect(Math.abs(predicted - measured)).toBeLessThan(tol)
    }
  })

  it('agrees with the photon energy: λ = hc/ΔE', () => {
    for (const [ni, nf] of LAB) {
      const lambda = transitionWavelengthNm(ni, nf)
      const ev = transitionEnergyEv(ni, nf)
      expect(1239.8419843320026 / ev).toBeCloseTo(lambda, 6)
    }
  })

  it('puts the Balmer series in the visible and the others outside it', () => {
    for (const ni of [3, 4, 5, 6]) {
      expect(isVisible(transitionWavelengthNm(ni, 2))).toBe(true)
      expect(regionOf(transitionWavelengthNm(ni, 2))).toBe('visible')
    }
    expect(regionOf(transitionWavelengthNm(2, 1))).toBe('ultraviolet')
    expect(regionOf(transitionWavelengthNm(4, 3))).toBe('infrared')
  })

  it('converges on the series limit as n_i grows (Balmer limit 364.6 nm)', () => {
    // 364.7 nm in vacuum; the 364.6 nm quoted in most textbooks is the air value.
    expect(seriesLimitNm(2)).toBeCloseTo(364.7, 1)
    expect(seriesLimitNm(1)).toBeCloseTo(91.18, 2)
    const far = seriesLines(2, 200)
    const last = far[far.length - 1]
    expect(last.wavelengthNm).toBeGreaterThan(seriesLimitNm(2))
    expect(last.wavelengthNm - seriesLimitNm(2)).toBeLessThan(0.05)
  })

  it('names the lines the way a spectroscopy course does', () => {
    expect(lineName(3, 2)).toBe('Balmer α')
    expect(lineName(6, 2)).toBe('Balmer δ')
    expect(lineName(2, 1)).toBe('Lyman α')
    expect(lineName(4, 3)).toBe('Paschen α')
  })
})

/*
 * The wavelength → colour assertions that used to sit here moved with the
 * implementation to lib/viz/spectralColor.test.ts, which now owns the single
 * copy of Bruton's fit. The Balmer-line hue checks went with them.
 */

describe('sampling |ψ|²', () => {
  it('inverts the radial CDF monotonically and reproduces ⟨r⟩', () => {
    for (const [n, l] of ALL_STATES) {
      const sampler = makeRadialSampler(n, l)
      expect(sampler.meanRadius()).toBeCloseTo(expectedRadius(n, l), 1)
      let last = -1
      for (let u = 0; u <= 1.0001; u += 0.05) {
        const r = sampler.quantile(Math.min(1, u))
        expect(r).toBeGreaterThanOrEqual(last)
        last = r
      }
    }
  })

  it('draws radii whose sample mean matches the analytic ⟨r⟩', () => {
    const rng = mulberry32(20240915)
    for (const [n, l] of [
      [1, 0],
      [3, 1],
      [4, 3],
    ] as const) {
      const sampler = makeRadialSampler(n, l)
      let sum = 0
      const draws = 40000
      for (let i = 0; i < draws; i++) sum += sampler.quantile(rng())
      const analytic = 0.5 * (3 * n * n - l * (l + 1))
      expect(Math.abs(sum / draws - analytic) / analytic).toBeLessThan(0.02)
    }
  })

  it('reproduces ⟨cos²θ⟩ = 1/3 for an s orbital and 3/5 for p_z', () => {
    const s = sampleOrbitalCloud(2, 0, 0, 30000, 7)
    const p = sampleOrbitalCloud(2, 1, 0, 30000, 7)
    const meanCos2 = (cloud: { positions: Float32Array; count: number }) => {
      let total = 0
      for (let i = 0; i < cloud.count; i++) {
        const x = cloud.positions[i * 3]
        const y = cloud.positions[i * 3 + 1]
        const z = cloud.positions[i * 3 + 2]
        const r2 = x * x + y * y + z * z
        if (r2 > 0) total += (z * z) / r2
      }
      return total / cloud.count
    }
    expect(meanCos2(s)).toBeCloseTo(1 / 3, 1)
    expect(meanCos2(p)).toBeCloseTo(3 / 5, 1)
  })

  it('puts p_x density along ±x and none in the yz plane', () => {
    const cloud = sampleOrbitalCloud(2, 1, 1, 20000, 11)
    let sumX2 = 0
    let sumY2 = 0
    for (let i = 0; i < cloud.count; i++) {
      const x = cloud.positions[i * 3]
      const y = cloud.positions[i * 3 + 1]
      sumX2 += x * x
      sumY2 += y * y
    }
    // ⟨x²⟩ = 3⟨y²⟩ for p_x: the lobes lie on the x axis.
    expect(sumX2 / sumY2).toBeCloseTo(3, 0)
  })

  it('labels each point with the sign of ψ there', () => {
    const cloud = sampleOrbitalCloud(3, 1, 0, 4000, 3)
    for (let i = 0; i < cloud.count; i += 37) {
      const x = cloud.positions[i * 3]
      const y = cloud.positions[i * 3 + 1]
      const z = cloud.positions[i * 3 + 2]
      const r = Math.hypot(x, y, z)
      if (r < 1e-6) continue
      const theta = Math.acos(z / r)
      const phi = Math.atan2(y, x)
      const value = psi(3, 1, 0, r, theta, phi)
      if (Math.abs(value) < 1e-9) continue
      expect(cloud.signs[i]).toBe(value >= 0 ? 1 : -1)
    }
  })

  it('carries both signs wherever the orbital actually has a node', () => {
    // 2p_z has one angular node (the xy plane), so both lobes must be present.
    const p = sampleOrbitalCloud(2, 1, 0, 5000, 5)
    expect(Array.from(p.signs).some((s) => s > 0)).toBe(true)
    expect(Array.from(p.signs).some((s) => s < 0)).toBe(true)
    // 1s has none, so every sample sits in a single positive lobe.
    const s = sampleOrbitalCloud(1, 0, 0, 5000, 5)
    expect(Array.from(s.signs).every((v) => v > 0)).toBe(true)
  })

  it('frames a bigger box for a bigger orbital', () => {
    const small = sampleOrbitalCloud(1, 0, 0, 1000, 1)
    const large = sampleOrbitalCloud(5, 0, 0, 1000, 1)
    expect(large.extent).toBeGreaterThan(small.extent * 10)
  })
})

describe('orbital names', () => {
  it('uses the chemistry labels for the real orbitals', () => {
    expect(orbitalName(1, 0, 0)).toEqual({ shell: '1s', sub: '' })
    expect(orbitalName(2, 1, 0)).toEqual({ shell: '2p', sub: 'z' })
    expect(orbitalName(3, 2, -2)).toEqual({ shell: '3d', sub: 'xy' })
    expect(orbitalName(4, 3, 0)).toEqual({ shell: '4f', sub: 'z³' })
  })
})
