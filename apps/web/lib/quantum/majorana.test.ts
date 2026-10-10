import { describe, expect, it } from 'vitest'
import {
  angleBetween,
  binomial,
  constellationSpread,
  cx,
  dickeState,
  evalPoly,
  expMinusIH,
  ghzState,
  majoranaStars,
  meanSpin,
  normalize,
  oneAxisTwist,
  polyFromRoots,
  polynomialRoots,
  rotateState,
  rotationMatrix,
  spinBasisState,
  spinCoherentState,
  spinX,
  spinY,
  spinZ,
  starFromAngles,
  stereographicToStar,
  symmetricProjection,
  twistAbout,
  twistPeriod,
  wState,
  type Complex,
  type Star,
} from './majorana'

/**
 * Every expected value here is derived by hand or from a textbook formula,
 * never from the code under test: Bloch vectors from Pauli expectations,
 * rotation matrices from the Wigner d-matrix, root positions from factoring
 * by hand, star counts from the degree of the Majorana polynomial.
 */

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

/** Deterministic pseudo-random numbers so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randomState(twoJ: number, rand: () => number): Complex[] {
  return normalize(Array.from({ length: twoJ + 1 }, () => cx(rand() * 2 - 1, rand() * 2 - 1)))
}

/** Sorted multiset of pairwise angles — the rotation-invariant shape of a constellation. */
function pairwiseAngles(stars: readonly Star[]): number[] {
  const out: number[] = []
  for (let i = 0; i < stars.length; i++)
    for (let k = i + 1; k < stars.length; k++) out.push(angleBetween(stars[i], stars[k]))
  return out.sort((a, b) => a - b)
}

/** Match each root of `found` to its nearest in `expected`, returning the worst distance. */
function worstMatch(found: readonly Complex[], expected: readonly Complex[]): number {
  const left = expected.slice()
  let worst = 0
  for (const f of found) {
    let best = Infinity
    let bestIdx = -1
    left.forEach((e, i) => {
      const d = Math.hypot(f.re - e.re, f.im - e.im)
      if (d < best) {
        best = d
        bestIdx = i
      }
    })
    worst = Math.max(worst, best)
    if (bestIdx >= 0) left.splice(bestIdx, 1)
  }
  return left.length === 0 ? worst : Infinity
}

describe('binomial', () => {
  it('matches Pascal’s triangle', () => {
    expect(binomial(6, 3)).toBe(20)
    expect(binomial(5, 0)).toBe(1)
    expect(binomial(5, 5)).toBe(1)
    expect(binomial(4, 5)).toBe(0)
  })
})

describe('polynomialRoots', () => {
  it('recovers the roots of a known factored polynomial to 1e-9', () => {
    const roots = [cx(1), cx(-2), cx(0, 3), cx(0.5, -0.5), cx(2, 1), cx(-0.25, 0.75)]
    const coef = polyFromRoots(roots)
    const { roots: found, atInfinity } = polynomialRoots(coef)
    expect(atInfinity).toBe(0)
    expect(found).toHaveLength(6)
    expect(worstMatch(found, roots)).toBeLessThan(1e-9)
  })

  it('solves quadratics without cancellation', () => {
    // z² − 3z + 2 = (z − 1)(z − 2)
    let r = polynomialRoots([cx(2), cx(-3), cx(1)])
    expect(worstMatch(r.roots, [cx(1), cx(2)])).toBeLessThan(1e-14)
    // z² + 1 = (z − i)(z + i)
    r = polynomialRoots([cx(1), cx(0), cx(1)])
    expect(worstMatch(r.roots, [cx(0, 1), cx(0, -1)])).toBeLessThan(1e-14)
    // Wide dynamic range: z² − (1e8 + 1e-8) z + 1 has roots 1e8 and 1e-8.
    r = polynomialRoots([cx(1), cx(-(1e8 + 1e-8)), cx(1)])
    expect(worstMatch(r.roots, [cx(1e8), cx(1e-8)])).toBeLessThan(1e-6)
  })

  it('counts vanishing leading coefficients as roots at infinity and trailing zeros as roots at 0', () => {
    // Nominal degree 5, actual polynomial z²(z − 3): two roots at 0, one at 3, two at ∞.
    const coef = [cx(0), cx(0), cx(-3), cx(1), cx(0), cx(0)]
    const { roots, atInfinity } = polynomialRoots(coef, { degree: 5 })
    expect(atInfinity).toBe(2)
    expect(roots).toHaveLength(3)
    expect(worstMatch(roots, [cx(0), cx(0), cx(3)])).toBeLessThan(1e-12)
  })

  it('handles a constant polynomial (every root at infinity) and the zero polynomial', () => {
    expect(polynomialRoots([cx(2), cx(0), cx(0)], { degree: 2 })).toEqual({ roots: [], atInfinity: 2 })
    expect(polynomialRoots([cx(0), cx(0), cx(0)], { degree: 2 })).toEqual({ roots: [], atInfinity: 2 })
  })

  it('locates a double root to the precision floating point allows (√ε)', () => {
    // (z − 1)²(z + 2)
    const coef = polyFromRoots([cx(1), cx(1), cx(-2)])
    const { roots } = polynomialRoots(coef)
    expect(worstMatch(roots, [cx(1), cx(1), cx(-2)])).toBeLessThan(1e-6)
  })

  it('finds every root of a degree-6 polynomial with a cluster and an outlier', () => {
    const roots = [cx(0.3, 0.1), cx(0.31, 0.12), cx(-5), cx(0, -2), cx(1.5, 1.5), cx(-0.7, 0.4)]
    const { roots: found } = polynomialRoots(polyFromRoots(roots))
    // The residual is the honest measure: every root must actually be a root.
    for (const z of found) expect(Math.hypot(...Object.values(evalPoly(polyFromRoots(roots), z)))).toBeLessThan(1e-8)
    expect(worstMatch(found, roots)).toBeLessThan(1e-6)
  })
})

describe('stereographic projection', () => {
  it('sends 0 to the north pole, ∞ to the south, |ζ| = 1 to the equator', () => {
    expect(stereographicToStar(cx(0)).z).toBe(1)
    expect(stereographicToStar(cx(Infinity)).z).toBe(-1)
    const eq = stereographicToStar(cx(0, 1))
    expect(near(eq.z, 0)).toBe(true)
    expect(near(eq.y, 1)).toBe(true)
    expect(near(eq.phi, Math.PI / 2)).toBe(true)
  })

  it('inverts tan(θ/2) e^{iφ}', () => {
    const theta = 1.1
    const phi = -2.3
    const r = Math.tan(theta / 2)
    const s = stereographicToStar(cx(r * Math.cos(phi), r * Math.sin(phi)))
    expect(near(s.theta, theta)).toBe(true)
    expect(near(s.phi, phi)).toBe(true)
    const v = starFromAngles(theta, phi)
    expect(near(s.x, v.x) && near(s.y, v.y) && near(s.z, v.z)).toBe(true)
  })
})

describe('majoranaStars', () => {
  it('spin-1/2: the single star is the Bloch vector from Pauli expectations', () => {
    const rand = lcg(7)
    for (let trial = 0; trial < 20; trial++) {
      const [a, b] = randomState(1, rand)
      // ⟨X⟩ = 2 Re(a* b), ⟨Y⟩ = 2 Im(a* b), ⟨Z⟩ = |a|² − |b|² — independent of any polynomial.
      const ab = { re: a.re * b.re + a.im * b.im, im: a.re * b.im - a.im * b.re }
      const bloch = { x: 2 * ab.re, y: 2 * ab.im, z: a.re ** 2 + a.im ** 2 - b.re ** 2 - b.im ** 2 }
      const [star] = majoranaStars([a, b])
      expect(near(star.x, bloch.x, 1e-10)).toBe(true)
      expect(near(star.y, bloch.y, 1e-10)).toBe(true)
      expect(near(star.z, bloch.z, 1e-10)).toBe(true)
    }
  })

  it('|j, +j⟩ puts every star at the north pole, |j, −j⟩ at the south', () => {
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const north = majoranaStars(spinBasisState(twoJ, twoJ / 2))
      expect(north).toHaveLength(twoJ)
      for (const s of north) expect(near(s.z, 1, 1e-12)).toBe(true)
      const south = majoranaStars(spinBasisState(twoJ, -twoJ / 2))
      expect(south).toHaveLength(twoJ)
      for (const s of south) expect(near(s.z, -1, 1e-12)).toBe(true)
    }
  })

  it('|j, m⟩ has j+m stars at the north pole and j−m at the south', () => {
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const j = twoJ / 2
      for (let m = -j; m <= j; m += 1) {
        const stars = majoranaStars(spinBasisState(twoJ, m))
        const north = stars.filter((s) => near(s.z, 1, 1e-12)).length
        const south = stars.filter((s) => near(s.z, -1, 1e-12)).length
        expect(north).toBe(j + m)
        expect(south).toBe(j - m)
      }
    }
  })

  it('a spin coherent state has all 2j stars coincident at (θ, φ)', () => {
    const rand = lcg(11)
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      for (let trial = 0; trial < 4; trial++) {
        const theta = 0.2 + rand() * 2.7
        const phi = rand() * 2 * Math.PI - Math.PI
        const stars = majoranaStars(spinCoherentState(twoJ, theta, phi))
        expect(stars).toHaveLength(twoJ)
        const target = starFromAngles(theta, phi)
        // A 2j-fold root is only locatable to ε^{1/2j} ≈ 2e-3 at 2j = 6; see the
        // module header. The bound here is loose enough for that and tight enough
        // to catch a star on the wrong hemisphere.
        for (const s of stars) expect(angleBetween(s, target)).toBeLessThan(0.02)
      }
    }
  })

  it('GHZ_n is a regular n-gon on the equator', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const stars = majoranaStars(ghzState(n))
      expect(stars).toHaveLength(n)
      for (const s of stars) expect(near(s.z, 0, 1e-9)).toBe(true)
      const phis = stars.map((s) => s.phi).sort((a, b) => a - b)
      for (let i = 1; i < n; i++) expect(near(phis[i] - phis[i - 1], (2 * Math.PI) / n, 1e-9)).toBe(true)
    }
    // GHZ_3's polynomial is (z³ − 1)/√2, so one star is exactly at φ = 0 (the +x axis).
    const ghz3 = majoranaStars(ghzState(3))
    expect(ghz3.some((s) => near(s.x, 1, 1e-9))).toBe(true)
  })

  it('W_3 is two stars at the north pole and one at the south (it is |3/2, +1/2⟩)', () => {
    const stars = majoranaStars(wState(3))
    expect(stars.filter((s) => near(s.z, 1, 1e-12))).toHaveLength(2)
    expect(stars.filter((s) => near(s.z, -1, 1e-12))).toHaveLength(1)
    // Dicke(4, 2) is |2, 0⟩: two up, two down.
    const d42 = majoranaStars(dickeState(4, 2))
    expect(d42.filter((s) => near(s.z, 1, 1e-12))).toHaveLength(2)
    expect(d42.filter((s) => near(s.z, -1, 1e-12))).toHaveLength(2)
  })

  it('returns 2j south-pole stars for the zero state rather than throwing', () => {
    const stars = majoranaStars([cx(0), cx(0), cx(0)])
    expect(stars).toHaveLength(2)
    for (const s of stars) expect(s.z).toBe(-1)
  })
})

describe('spin operators', () => {
  it('satisfy [J_x, J_y] = i J_z and J² = j(j+1)', () => {
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const jx = spinX(twoJ)
      const jy = spinY(twoJ)
      const jz = spinZ(twoJ)
      const d = twoJ + 1
      const mm = (a: Complex[][], b: Complex[][]) =>
        a.map((row, r) =>
          row.map((_, c) =>
            a[r].reduce(
              (acc, e, k) => ({ re: acc.re + e.re * b[k][c].re - e.im * b[k][c].im, im: acc.im + e.re * b[k][c].im + e.im * b[k][c].re }),
              cx(0)
            )
          )
        )
      const xy = mm(jx, jy)
      const yx = mm(jy, jx)
      const j2 = [mm(jx, jx), mm(jy, jy), mm(jz, jz)]
      for (let r = 0; r < d; r++) {
        for (let c = 0; c < d; c++) {
          const comm = { re: xy[r][c].re - yx[r][c].re, im: xy[r][c].im - yx[r][c].im }
          // i J_z
          expect(near(comm.re, -jz[r][c].im, 1e-12)).toBe(true)
          expect(near(comm.im, jz[r][c].re, 1e-12)).toBe(true)
          const casimir = j2.reduce((s, m) => s + m[r][c].re, 0)
          expect(near(casimir, r === c ? (twoJ / 2) * (twoJ / 2 + 1) : 0, 1e-12)).toBe(true)
        }
      }
    }
  })

  it('exp(−iα J_z) is diag(e^{−imα}) exactly', () => {
    const u = rotationMatrix(4, 'z', 0.7)
    for (let r = 0; r < 5; r++) {
      const m = 2 - r
      expect(near(u[r][r].re, Math.cos(-m * 0.7), 1e-12)).toBe(true)
      expect(near(u[r][r].im, Math.sin(-m * 0.7), 1e-12)).toBe(true)
      for (let c = 0; c < 5; c++) if (c !== r) expect(Math.hypot(u[r][c].re, u[r][c].im)).toBeLessThan(1e-12)
    }
  })

  it('a 2π rotation is +1 on integer spin and −1 on half-integer spin', () => {
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const u = rotationMatrix(twoJ, [0.3, -0.5, 0.8], 2 * Math.PI)
      const sign = twoJ % 2 === 0 ? 1 : -1
      for (let r = 0; r <= twoJ; r++)
        for (let c = 0; c <= twoJ; c++) {
          expect(near(u[r][c].re, r === c ? sign : 0, 1e-10)).toBe(true)
          expect(near(u[r][c].im, 0, 1e-10)).toBe(true)
        }
    }
  })

  it('rotating |j, j⟩ about y by β gives the Wigner d-matrix column d^j_{m j}(β)', () => {
    // d^j_{m j}(β) = √C(2j, j−m) cos^{j+m}(β/2) sin^{j−m}(β/2)  (Wikipedia, Wigner D-matrix).
    const beta = 1.3
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const j = twoJ / 2
      const rotated = rotateState(spinBasisState(twoJ, j), 'y', beta)
      rotated.forEach((amp, k) => {
        const m = j - k
        const expected = Math.sqrt(binomial(twoJ, j - m)) * Math.cos(beta / 2) ** (j + m) * Math.sin(beta / 2) ** (j - m)
        expect(near(amp.re, expected, 1e-10)).toBe(true)
        expect(near(amp.im, 0, 1e-10)).toBe(true)
      })
    }
  })

  it('expMinusIH is unitary and agrees with the closed form on a Pauli', () => {
    // exp(−i t σ_x/2) = cos(t/2) − i sin(t/2) σ_x
    const t = 2.1
    const u = expMinusIH(spinX(1), t)
    expect(near(u[0][0].re, Math.cos(t / 2), 1e-12)).toBe(true)
    expect(near(u[0][1].im, -Math.sin(t / 2), 1e-12)).toBe(true)
    // Large t exercises scaling-and-squaring.
    const big = expMinusIH(spinY(6), 40)
    for (let r = 0; r < 7; r++) {
      let rowNorm = 0
      for (let c = 0; c < 7; c++) rowNorm += big[r][c].re ** 2 + big[r][c].im ** 2
      expect(near(rowNorm, 1, 1e-10)).toBe(true)
    }
  })
})

describe('rotations act rigidly on the constellation', () => {
  it('preserves every pairwise angle for random states and random axes', () => {
    const rand = lcg(23)
    for (let twoJ = 2; twoJ <= 6; twoJ++) {
      for (let trial = 0; trial < 3; trial++) {
        const psi = randomState(twoJ, rand)
        const axis: [number, number, number] = [rand() - 0.5, rand() - 0.5, rand() - 0.5]
        const angle = rand() * 2 * Math.PI
        const before = pairwiseAngles(majoranaStars(psi))
        const after = pairwiseAngles(majoranaStars(rotateState(psi, axis, angle)))
        expect(after).toHaveLength(before.length)
        before.forEach((a, i) => expect(near(a, after[i], 1e-6)).toBe(true))
      }
    }
  })

  it('a rotation about z shifts every star’s azimuth by the angle', () => {
    const rand = lcg(5)
    const psi = randomState(4, rand)
    const alpha = 0.9
    const before = majoranaStars(psi).map((s) => s.phi).sort((a, b) => a - b)
    const after = majoranaStars(rotateState(psi, 'z', alpha)).map((s) => {
      const p = s.phi - alpha
      return Math.atan2(Math.sin(p), Math.cos(p))
    })
    after.sort((a, b) => a - b)
    before.forEach((p, i) => expect(near(p, after[i], 1e-7)).toBe(true))
  })

  it('carries the coherent state at the pole to the coherent state at (β, 0)', () => {
    const stars = majoranaStars(rotateState(spinBasisState(6, 3), 'y', 0.8))
    const target = starFromAngles(0.8, 0)
    for (const s of stars) expect(angleBetween(s, target)).toBeLessThan(0.02)
  })
})

describe('meanSpin', () => {
  it('is j·n̂ for the coherent state along n̂', () => {
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const j = twoJ / 2
      const theta = 0.9
      const phi = 2.2
      const v = meanSpin(spinCoherentState(twoJ, theta, phi))
      expect(near(v.x, j * Math.sin(theta) * Math.cos(phi), 1e-10)).toBe(true)
      expect(near(v.y, j * Math.sin(theta) * Math.sin(phi), 1e-10)).toBe(true)
      expect(near(v.z, j * Math.cos(theta), 1e-10)).toBe(true)
    }
  })

  it('vanishes for every GHZ_n, n ≥ 2 (m = ±j are not connected by one J± step)', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const v = meanSpin(ghzState(n))
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1e-12)
    }
  })
})

describe('one-axis twisting', () => {
  it('is a global phase on spin-1/2: the star does not move', () => {
    const psi = normalize([cx(0.6, 0.1), cx(0.3, -0.7)])
    const before = majoranaStars(psi)[0]
    const after = majoranaStars(oneAxisTwist(psi, 1.7))[0]
    expect(angleBetween(before, after)).toBeLessThan(1e-12)
  })

  it('at χ = π/2 splits the equatorial spin-1 coherent state into antipodal stars with ⟨J⟩ = 0', () => {
    // By hand: amplitudes become (e^{−iχ}/2, 1/√2, e^{−iχ}/2); the Majorana polynomial
    // is ∝ z² − 2e^{iχ}z + 1, whose roots at χ = π/2 are i(1 ± √2) — purely imaginary,
    // one inside and one outside the unit circle, at θ = π/4 and 3π/4: antipodal.
    const psi = spinCoherentState(2, Math.PI / 2, 0)
    const twisted = oneAxisTwist(psi, Math.PI / 2)
    const stars = majoranaStars(twisted)
    expect(near(angleBetween(stars[0], stars[1]), Math.PI, 1e-9)).toBe(true)
    const thetas = stars.map((s) => s.theta).sort((a, b) => a - b)
    expect(near(thetas[0], Math.PI / 4, 1e-9)).toBe(true)
    expect(near(thetas[1], (3 * Math.PI) / 4, 1e-9)).toBe(true)
    const v = meanSpin(twisted)
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1e-12)
  })

  it('separates the stars of a coherent state monotonically at first, and never for one at the pole', () => {
    const equator = spinCoherentState(4, Math.PI / 2, 0)
    const s0 = constellationSpread(majoranaStars(equator))
    const s1 = constellationSpread(majoranaStars(oneAxisTwist(equator, 0.15)))
    const s2 = constellationSpread(majoranaStars(oneAxisTwist(equator, 0.3)))
    expect(s0).toBeLessThan(0.02)
    expect(s1).toBeGreaterThan(0.1)
    expect(s2).toBeGreaterThan(s1)
    // |j, j⟩ is an eigenstate of J_z²: twisting is a phase and nothing moves.
    const pole = spinBasisState(4, 2)
    for (const s of majoranaStars(oneAxisTwist(pole, 1.1))) expect(near(s.z, 1, 1e-12)).toBe(true)
  })

  it('returns to the start after twistPeriod(2j), and not before for integer j', () => {
    // |⟨ψ|φ⟩|² computed directly from the amplitudes — no stars involved.
    const fidelity = (a: readonly Complex[], b: readonly Complex[]) => {
      let re = 0
      let im = 0
      for (let i = 0; i < a.length; i++) {
        re += a[i].re * b[i].re + a[i].im * b[i].im
        im += a[i].re * b[i].im - a[i].im * b[i].re
      }
      return re * re + im * im
    }
    const rand = lcg(31)
    for (let twoJ = 1; twoJ <= 6; twoJ++) {
      const psi = randomState(twoJ, rand)
      const period = twistPeriod(twoJ)
      expect(period).toBe(twoJ % 2 === 0 ? 2 * Math.PI : Math.PI)
      expect(near(fidelity(psi, oneAxisTwist(psi, period)), 1, 1e-12)).toBe(true)
      if (twoJ % 2 === 0) {
        // Integer j at χ = π is R_z(π), a rotation, so the stars are a coherent state
        // again if they started as one — but the STATE is not back: check on |j,j⟩+|j,j−1⟩.
        const probe = normalize([cx(1), cx(1), ...Array.from({ length: twoJ - 1 }, () => cx(0))])
        expect(fidelity(probe, oneAxisTwist(probe, Math.PI))).toBeLessThan(1e-12)
        const coherent = spinCoherentState(twoJ, Math.PI / 2, 0.3)
        const rotated = rotateState(coherent, 'z', Math.PI)
        expect(near(fidelity(rotated, oneAxisTwist(coherent, Math.PI)), 1, 1e-10)).toBe(true)
      }
    }
  })

  it('at χ = π/2 an integer-j coherent state along +x becomes a cat: a regular 2j-gon in the plane x = 0', () => {
    // e^{−iπm²/2} = (1−i)/2 + (1+i)/2 (−1)^m for integer m, so the twisted state is
    // ((1−i)|ψ⟩ + (1+i) R_z(π)|ψ⟩)/2 — equal-weight cat of |+x⟩ and |−x⟩. In the frame
    // where +x is the pole that is a|j,j⟩ + b|j,−j⟩ with |a| = |b|: stars on the
    // equator of THAT frame, equally spaced.
    for (const twoJ of [2, 4, 6]) {
      const stars = majoranaStars(oneAxisTwist(spinCoherentState(twoJ, Math.PI / 2, 0), Math.PI / 2))
      for (const s of stars) expect(Math.abs(s.x)).toBeLessThan(1e-8)
      const angles = stars.map((s) => Math.atan2(s.z, s.y)).sort((a, b) => a - b)
      for (let i = 1; i < angles.length; i++) expect(near(angles[i] - angles[i - 1], (2 * Math.PI) / twoJ, 1e-7)).toBe(true)
    }
  })

  it('twisting about x leaves the coherent state along +x fixed, and matches a rotated z-twist', () => {
    const alongX = spinCoherentState(3, Math.PI / 2, 0)
    const target = starFromAngles(Math.PI / 2, 0)
    for (const s of majoranaStars(twistAbout(alongX, 'x', 0.8))) expect(angleBetween(s, target)).toBeLessThan(0.02)
    // Conjugation check: twist about x == R_y(π/2) · twist about z · R_y(−π/2) — same stars.
    const psi = normalize([cx(0.2, 0.5), cx(-0.4, 0.1), cx(0.7, 0), cx(0.1, -0.3)])
    const direct = pairwiseAngles(majoranaStars(twistAbout(psi, 'x', 0.6)))
    const viaZ = pairwiseAngles(
      majoranaStars(rotateState(oneAxisTwist(rotateState(psi, 'y', -Math.PI / 2), 0.6), 'y', Math.PI / 2))
    )
    direct.forEach((a, i) => expect(near(a, viaZ[i], 1e-6)).toBe(true))
  })
})

describe('symmetricProjection', () => {
  it('maps the 3-qubit W statevector to |3/2, 1/2⟩ with full symmetric weight', () => {
    const sv = Array.from({ length: 8 }, () => cx(0))
    for (const idx of [1, 2, 4]) sv[idx] = cx(1 / Math.sqrt(3))
    const { amplitudes, symmetricWeight } = symmetricProjection(sv, 3)
    expect(near(symmetricWeight, 1, 1e-12)).toBe(true)
    const expected = [0, 1, 0, 0]
    amplitudes.forEach((a, k) => {
      expect(near(a.re, expected[k], 1e-12)).toBe(true)
      expect(near(a.im, 0, 1e-12)).toBe(true)
    })
  })

  it('gives the singlet zero symmetric weight', () => {
    const sv = [cx(0), cx(Math.SQRT1_2), cx(-Math.SQRT1_2), cx(0)]
    expect(symmetricProjection(sv, 2).symmetricWeight).toBeLessThan(1e-12)
  })

  it('maps a product of identical qubits to the coherent state', () => {
    const theta = 0.7
    const phi = 1.9
    const a = cx(Math.cos(theta / 2))
    const b = cx(Math.sin(theta / 2) * Math.cos(phi), Math.sin(theta / 2) * Math.sin(phi))
    const one = [a, b]
    // |q⟩ ⊗ |q⟩ ⊗ |q⟩ in big-endian index order (any order works — the state is symmetric).
    const sv: Complex[] = []
    for (let idx = 0; idx < 8; idx++) {
      let amp = cx(1)
      for (let q = 0; q < 3; q++) {
        const bit = (idx >> q) & 1
        const f = one[bit]
        amp = { re: amp.re * f.re - amp.im * f.im, im: amp.re * f.im + amp.im * f.re }
      }
      sv.push(amp)
    }
    const { amplitudes, symmetricWeight } = symmetricProjection(sv, 3)
    expect(near(symmetricWeight, 1, 1e-12)).toBe(true)
    const expected = spinCoherentState(3, theta, phi)
    amplitudes.forEach((amp, k) => {
      expect(near(amp.re, expected[k].re, 1e-10)).toBe(true)
      expect(near(amp.im, expected[k].im, 1e-10)).toBe(true)
    })
  })

  it('rejects a statevector of the wrong length', () => {
    expect(() => symmetricProjection([cx(1), cx(0)], 2)).toThrow(RangeError)
  })
})
