import { describe, expect, it } from 'vitest'
import {
  axisNodeCounts,
  boxDegeneratePartners,
  boxEigenfunction1d,
  boxEnergy,
  boxVolume,
  complexSphericalHarmonic,
  countSignChanges,
  hermite,
  hydrogenVolume,
  isotropicOscillatorDegeneracy,
  lineThrough,
  oscillatorDegeneratePartners,
  oscillatorEigenfunction1d,
  oscillatorEnergy,
  oscillatorVolume,
  rotorEnergy,
  rotorVolume,
  sliceVolume,
  voxelIndex,
} from './schrodinger3d'

/**
 * Every number compared against here is derived OUTSIDE the engine: textbook
 * closed forms (Griffiths §2.2, §2.3, §4.1), combinatorial degeneracy counts,
 * and quadrature of analytic expressions written out independently below.
 * ħ = m = 1 throughout, matching the engine.
 */

const PI2 = Math.PI * Math.PI

/** Trapezoid quadrature of f on [a, b] with `steps` panels. */
function integrate(f: (x: number) => number, a: number, b: number, steps = 20000): number {
  const h = (b - a) / steps
  let s = 0.5 * (f(a) + f(b))
  for (let i = 1; i < steps; i++) s += f(a + i * h)
  return s * h
}

/** Riemann sum of a volume's density over its grid. Independent of `norm`. */
function gridIntegral(v: { density: Float32Array; spacing: readonly number[] }): number {
  let s = 0
  for (let i = 0; i < v.density.length; i++) s += v.density[i]
  return s * v.spacing[0] * v.spacing[1] * v.spacing[2]
}

describe('one-dimensional building blocks', () => {
  it('Hermite polynomials match their closed forms', () => {
    // H_0 = 1, H_1 = 2x, H_2 = 4x² − 2, H_3 = 8x³ − 12x, H_4 = 16x⁴ − 48x² + 12
    for (const x of [-1.7, -0.3, 0, 0.5, 2.2]) {
      expect(hermite(0, x)).toBeCloseTo(1, 12)
      expect(hermite(1, x)).toBeCloseTo(2 * x, 12)
      expect(hermite(2, x)).toBeCloseTo(4 * x * x - 2, 12)
      expect(hermite(3, x)).toBeCloseTo(8 * x ** 3 - 12 * x, 12)
      expect(hermite(4, x)).toBeCloseTo(16 * x ** 4 - 48 * x * x + 12, 10)
    }
  })

  it('oscillator eigenfunctions are normalised and match the n = 0, 1, 2 closed forms', () => {
    const omega = 1.7
    // ψ₀ = (ω/π)^{1/4} e^{−ωx²/2};  ψ₁ = ψ₀ · √(2ω) x;  ψ₂ = ψ₀ · (2ωx² − 1)/√2
    const psi0 = (x: number) => Math.pow(omega / Math.PI, 0.25) * Math.exp((-omega * x * x) / 2)
    for (const x of [-2, -0.4, 0.1, 1.3]) {
      expect(oscillatorEigenfunction1d(0, omega, x)).toBeCloseTo(psi0(x), 10)
      expect(oscillatorEigenfunction1d(1, omega, x)).toBeCloseTo(psi0(x) * Math.sqrt(2 * omega) * x, 10)
      expect(oscillatorEigenfunction1d(2, omega, x)).toBeCloseTo(
        (psi0(x) * (2 * omega * x * x - 1)) / Math.SQRT2,
        10
      )
    }
    for (let n = 0; n <= 6; n++) {
      const norm = integrate((x) => oscillatorEigenfunction1d(n, omega, x) ** 2, -12, 12)
      expect(norm).toBeCloseTo(1, 6)
      // Orthogonal to the ground state for n > 0.
      if (n > 0) {
        const overlap = integrate(
          (x) => oscillatorEigenfunction1d(n, omega, x) * oscillatorEigenfunction1d(0, omega, x),
          -12,
          12
        )
        expect(Math.abs(overlap)).toBeLessThan(1e-8)
      }
    }
  })

  it('box eigenfunctions are normalised on [0, L] and vanish outside', () => {
    const L = 2.5
    for (let n = 1; n <= 5; n++) {
      expect(integrate((x) => boxEigenfunction1d(n, L, x) ** 2, 0, L)).toBeCloseTo(1, 6)
    }
    expect(boxEigenfunction1d(2, L, -0.1)).toBe(0)
    expect(boxEigenfunction1d(2, L, L + 0.1)).toBe(0)
  })

  it('counts sign changes', () => {
    expect(countSignChanges([1, 2, 3])).toBe(0)
    expect(countSignChanges([1, -1, 1, -1])).toBe(3)
    expect(countSignChanges([0, 1, 0, -1, 0])).toBe(1)
    expect(countSignChanges([1e-9, 1, -1], 1e-6)).toBe(1)
  })
})

describe('3-D box', () => {
  it('has energies E = (π²/2)·Σ nᵢ²/Lᵢ²', () => {
    // Cube of side 1: ground state 3π²/2, (1,1,2) is 3π².
    expect(boxEnergy([1, 1, 1], [1, 1, 1])).toBeCloseTo((3 * PI2) / 2, 12)
    expect(boxEnergy([1, 1, 2], [1, 1, 1])).toBeCloseTo(3 * PI2, 12)
    // Anisotropic: L = (2, 1, 1), n = (2, 1, 1) → (π²/2)(4/4 + 1 + 1) = 3π²/2
    expect(boxEnergy([2, 1, 1], [2, 1, 1])).toBeCloseTo((3 * PI2) / 2, 12)
    // A volume reports the same number.
    expect(boxVolume({ n: [1, 1, 2], L: [1, 1, 1], resolution: 8 }).energy).toBeCloseTo(3 * PI2, 12)
  })

  it('(1,1,2), (1,2,1) and (2,1,1) are degenerate in a cube but not in a brick', () => {
    const cube = boxDegeneratePartners([1, 1, 2], [1, 1, 1])
    expect(cube.map((t) => t.join(','))).toEqual(['1,1,2', '1,2,1', '2,1,1'])

    const a = boxVolume({ n: [1, 1, 2], L: [1, 1, 1], resolution: 12 })
    const b = boxVolume({ n: [1, 2, 1], L: [1, 1, 1], resolution: 12 })
    const c = boxVolume({ n: [2, 1, 1], L: [1, 1, 1], resolution: 12 })
    expect(a.energy).toBeCloseTo(b.energy, 12)
    expect(b.energy).toBeCloseTo(c.energy, 12)
    // Same energy, different shapes: the densities are not the same array.
    let differ = 0
    for (let i = 0; i < a.density.length; i++) {
      if (Math.abs(a.density[i] - b.density[i]) > 1e-6) differ++
    }
    expect(differ).toBeGreaterThan(a.density.length / 4)
    // ...but they are the same shape up to a permutation of axes.
    for (let iz = 0; iz < 12; iz++)
      for (let iy = 0; iy < 12; iy++)
        for (let ix = 0; ix < 12; ix++) {
          expect(a.density[voxelIndex(a, ix, iy, iz)]).toBeCloseTo(
            b.density[voxelIndex(b, ix, iz, iy)],
            10
          )
        }

    // Stretch z by 1.5 and the three split into three distinct energies.
    const brick = boxDegeneratePartners([1, 1, 2], [1, 1, 1.5])
    expect(brick.map((t) => t.join(','))).toEqual(['1,1,2'])
  })

  it('finds the accidental (3,3,3) ↔ (5,1,1) degeneracy: Σn² = 27 both ways', () => {
    const partners = boxDegeneratePartners([3, 3, 3], [1, 1, 1], 6)
    expect(partners.map((t) => t.join(',')).sort()).toEqual(['1,1,5', '1,5,1', '3,3,3', '5,1,1'])
  })

  it('is normalised on the grid to within 1%', () => {
    const v = boxVolume({ n: [2, 1, 3], L: [1, 1.3, 0.8], resolution: 48 })
    expect(gridIntegral(v)).toBeCloseTo(1, 2)
    expect(v.norm).toBeCloseTo(gridIntegral(v), 6)
  })

  it('has nᵢ − 1 nodes along each axis', () => {
    const v = boxVolume({ n: [2, 1, 3], L: [1, 1, 1], resolution: 48 })
    expect(axisNodeCounts(v)).toEqual([1, 0, 2])
    const w = boxVolume({ n: [4, 3, 1], L: [2, 1, 1], resolution: 48 })
    expect(axisNodeCounts(w)).toEqual([3, 2, 0])
  })

  it('rejects non-physical quantum numbers', () => {
    expect(() => boxVolume({ n: [0, 1, 1], L: [1, 1, 1], resolution: 4 })).toThrow()
    expect(() => boxVolume({ n: [1, 1, 1], L: [1, 0, 1], resolution: 4 })).toThrow()
  })
})

describe('3-D harmonic oscillator', () => {
  it('has energies Σ (nᵢ + ½)ωᵢ', () => {
    expect(oscillatorEnergy([0, 0, 0], [1, 1, 1])).toBeCloseTo(1.5, 12)
    expect(oscillatorEnergy([1, 0, 2], [1, 1, 1])).toBeCloseTo(4.5, 12)
    expect(oscillatorEnergy([1, 0, 2], [1, 2, 3])).toBeCloseTo(1.5 + 1 + 7.5, 12)
  })

  it('isotropic level N holds (N+1)(N+2)/2 degenerate states', () => {
    for (let N = 0; N <= 5; N++) {
      expect(isotropicOscillatorDegeneracy(N)).toBe([1, 3, 6, 10, 15, 21][N])
      const partners = oscillatorDegeneratePartners([N, 0, 0], [1, 1, 1], 8)
      expect(partners.length).toBe(isotropicOscillatorDegeneracy(N))
      for (const p of partners) {
        expect(p[0] + p[1] + p[2]).toBe(N)
        expect(oscillatorEnergy(p, [1, 1, 1])).toBeCloseTo(N + 1.5, 12)
      }
    }
  })

  it('an anisotropic oscillator breaks the degeneracy', () => {
    // ω = (1, 1, 2): (1,0,0) and (0,1,0) still share E = 2.5 + 0.5·... but (0,0,1) does not.
    const partners = oscillatorDegeneratePartners([1, 0, 0], [1, 1, 2], 6)
    expect(partners.map((t) => t.join(',')).sort()).toEqual(['0,1,0', '1,0,0'])
    // With ω = (1, 1, 2), (0,0,1) at E = 4 coincides with (2,0,0), (1,1,0), (0,2,0).
    const z1 = oscillatorDegeneratePartners([0, 0, 1], [1, 1, 2], 6)
    expect(z1.map((t) => t.join(',')).sort()).toEqual(['0,0,1', '0,2,0', '1,1,0', '2,0,0'])
  })

  it('is normalised on the grid to within 1% and has nᵢ nodes along each axis', () => {
    const v = oscillatorVolume({ n: [1, 0, 2], omega: [1, 1, 1], resolution: 48 })
    expect(gridIntegral(v)).toBeCloseTo(1, 2)
    expect(axisNodeCounts(v)).toEqual([1, 0, 2])

    const w = oscillatorVolume({ n: [3, 2, 0], omega: [1, 2, 0.5], resolution: 48 })
    expect(gridIntegral(w)).toBeCloseTo(1, 2)
    expect(axisNodeCounts(w)).toEqual([3, 2, 0])
  })

  it('keeps a shared frame when halfWidth is fixed', () => {
    const v = oscillatorVolume({ n: [2, 0, 0], omega: [1, 1, 1], resolution: 8, halfWidth: [5, 5, 5] })
    expect(v.min).toEqual([-5, -5, -5])
    expect(v.max).toEqual([5, 5, 5])
  })
})

describe('rigid rotor', () => {
  it('has energies l(l+1)/2I', () => {
    expect(rotorEnergy(0)).toBe(0)
    expect(rotorEnergy(1)).toBe(1)
    expect(rotorEnergy(2)).toBe(3)
    expect(rotorEnergy(3, 2)).toBe(3)
  })

  it('complex Y_l^m match closed forms and are orthonormal on the sphere', () => {
    // Y_0^0 = 1/√(4π); Y_1^0 = √(3/4π) cos θ; Y_1^{±1} = ∓√(3/8π) sin θ e^{±iφ};
    // Y_2^0 = √(5/16π)(3cos²θ − 1).
    const th = 0.7
    const ph = 2.1
    expect(complexSphericalHarmonic(0, 0, th, ph)[0]).toBeCloseTo(1 / Math.sqrt(4 * Math.PI), 12)
    expect(complexSphericalHarmonic(1, 0, th, ph)[0]).toBeCloseTo(
      Math.sqrt(3 / (4 * Math.PI)) * Math.cos(th),
      12
    )
    const [re1, im1] = complexSphericalHarmonic(1, 1, th, ph)
    const a1 = -Math.sqrt(3 / (8 * Math.PI)) * Math.sin(th)
    expect(re1).toBeCloseTo(a1 * Math.cos(ph), 12)
    expect(im1).toBeCloseTo(a1 * Math.sin(ph), 12)
    const [reM, imM] = complexSphericalHarmonic(1, -1, th, ph)
    expect(reM).toBeCloseTo(-a1 * Math.cos(-ph), 12)
    expect(imM).toBeCloseTo(-a1 * Math.sin(-ph), 12)
    expect(complexSphericalHarmonic(2, 0, th, ph)[0]).toBeCloseTo(
      Math.sqrt(5 / (16 * Math.PI)) * (3 * Math.cos(th) ** 2 - 1),
      12
    )

    // ∫|Y|² dΩ = 1 by a product Gauss–Legendre-free grid (midpoint in cos θ and φ).
    const nT = 400
    const nP = 400
    for (const [l, m] of [
      [2, 1],
      [3, -2],
      [4, 4],
    ] as const) {
      let s = 0
      for (let i = 0; i < nT; i++) {
        const c = -1 + ((i + 0.5) / nT) * 2
        const theta = Math.acos(c)
        for (let j = 0; j < nP; j++) {
          const phi = ((j + 0.5) / nP) * 2 * Math.PI
          const [re, im] = complexSphericalHarmonic(l, m, theta, phi)
          s += re * re + im * im
        }
      }
      s *= (2 / nT) * ((2 * Math.PI) / nP)
      // Midpoint rule at 400 × 400: the quadrature itself is good to ~1e-5.
      expect(s).toBeCloseTo(1, 4)
    }
  })

  it('complex states have a φ-independent density and a phase that winds m times', () => {
    const v = rotorVolume({ l: 2, m: 1, resolution: 48 })
    expect(v.complex).toBe(true)
    expect(gridIntegral(v)).toBeCloseTo(1, 2)
    // Walk a ring in the equatorial plane at the shell radius: density constant, phase = φ.
    const mid = 24
    const h = v.spacing[0]
    const iOf = (x: number) => Math.round((x - v.min[0]) / h)
    const samples: { d: number; ph: number; phi: number }[] = []
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * 2 * Math.PI + 0.1
      const ix = iOf(Math.cos(phi) * 0.8)
      const iy = iOf(Math.sin(phi) * 0.8)
      const idx = voxelIndex(v, ix, iy, mid)
      samples.push({ d: v.density[idx], ph: v.phase[idx], phi: Math.atan2(v.min[1] + iy * h, v.min[0] + ix * h) })
    }
    // Voxel-centre snapping moves the point slightly off the exact ring; allow 15%.
    // Y_2^1 vanishes on the equator, so use the z = 0.6 plane instead below.
    const w = rotorVolume({ l: 1, m: 1, resolution: 48 })
    const plane = iOf(0.55)
    const ring: { d: number; ph: number; phi: number }[] = []
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * 2 * Math.PI + 0.1
      const rho = Math.sqrt(1 - 0.55 * 0.55)
      const ix = iOf(Math.cos(phi) * rho)
      const iy = iOf(Math.sin(phi) * rho)
      const idx = voxelIndex(w, ix, iy, plane)
      ring.push({ d: w.density[idx], ph: w.phase[idx], phi: Math.atan2(w.min[1] + iy * h, w.min[0] + ix * h) })
    }
    const mean = ring.reduce((s, r) => s + r.d, 0) / ring.length
    for (const r of ring) {
      expect(r.d / mean).toBeGreaterThan(0.7)
      expect(r.d / mean).toBeLessThan(1.3)
      // Y_1^1 ∝ −sin θ e^{iφ}: phase is φ + π (mod 2π).
      const expected = Math.atan2(Math.sin(r.phi + Math.PI), Math.cos(r.phi + Math.PI))
      const diff = Math.atan2(Math.sin(r.ph - expected), Math.cos(r.ph - expected))
      expect(Math.abs(diff)).toBeLessThan(1e-6)
    }
    expect(samples.length).toBe(8)
  })

  it('real states have lobes of alternating sign and the same normalisation', () => {
    const v = rotorVolume({ l: 1, m: 1, basis: 'real', resolution: 48 })
    expect(v.complex).toBe(false)
    expect(gridIntegral(v)).toBeCloseTo(1, 2)
    // p_x: positive for x > 0, negative for x < 0, along a line through the shell.
    const line = lineThrough(v, 0, [0, 24, 24])
    expect(countSignChanges(line, 1e-6)).toBe(1)
    expect(line[6]).toBeLessThan(0)
    expect(line[41]).toBeGreaterThan(0)
  })
})

describe('hydrogen on a grid', () => {
  it('1s is normalised to within 1% on a grid that contains the tail', () => {
    // The 98% radius framing deliberately crops ~1% of the density; give the grid the room.
    const v = hydrogenVolume({ n: 1, l: 0, m: 0, resolution: 64, extent: 9 })
    expect(gridIntegral(v)).toBeCloseTo(1, 2)
    // The default frame is the 98% radius, so it is a little short of 1 — but not by much.
    const framed = hydrogenVolume({ n: 1, l: 0, m: 0, resolution: 48 })
    expect(framed.norm).toBeGreaterThan(0.96)
    expect(framed.norm).toBeLessThanOrEqual(1.01)
  })

  it('reports the Bohr energy in eV and the ground-state density at the origin', () => {
    const v = hydrogenVolume({ n: 2, l: 1, m: 0, resolution: 16 })
    expect(v.energy).toBeCloseTo(-13.6 / 4, 1)
    expect(v.energyUnit).toBe('eV')
    // |ψ_1s(0)|² = 1/π in Bohr units; the nearest voxel to the origin at res 64, extent 3
    // sits at r = 3/63·√3 ≈ 0.082, where e^{−2r}/π = 0.270.
    const g = hydrogenVolume({ n: 1, l: 0, m: 0, resolution: 64, extent: 3 })
    const r = (3 / 63) * Math.sqrt(3)
    expect(g.density[voxelIndex(g, 31, 31, 31)]).toBeCloseTo(Math.exp(-2 * r) / Math.PI, 3)
  })

  it('2p_z has one angular node along z and 3s crosses two radial nodes twice along x', () => {
    const p = hydrogenVolume({ n: 2, l: 1, m: 0, resolution: 48 })
    // A line parallel to z, off-axis: ψ ∝ z e^{−r/2} changes sign once.
    expect(countSignChanges(lineThrough(p, 2, [17, 17, 0]), 1e-9)).toBe(1)
    const s = hydrogenVolume({ n: 3, l: 0, m: 0, resolution: 64, extent: 20 })
    // Through the centre along x: R_30 has nodes at r ≈ 1.90 and 7.10 a₀, crossed on both sides.
    expect(countSignChanges(lineThrough(s, 0, [0, 32, 32]), 1e-9)).toBe(4)
  })

  it('rejects impossible quantum numbers', () => {
    expect(() => hydrogenVolume({ n: 2, l: 2, m: 0, resolution: 4 })).toThrow()
  })
})

describe('slicing', () => {
  it('extracts the plane a fallback viewer would draw', () => {
    const v = boxVolume({ n: [1, 2, 3], L: [1, 1, 1], resolution: 10 })
    const sz = sliceVolume(v, 2, 4)
    expect(sz.width).toBe(10)
    expect(sz.height).toBe(10)
    for (let iy = 0; iy < 10; iy++)
      for (let ix = 0; ix < 10; ix++) {
        expect(sz.density[iy * 10 + ix]).toBe(v.density[voxelIndex(v, ix, iy, 4)])
      }
    const sx = sliceVolume(v, 0, 3)
    for (let iz = 0; iz < 10; iz++)
      for (let iy = 0; iy < 10; iy++) {
        expect(sx.density[iz * 10 + iy]).toBe(v.density[voxelIndex(v, 3, iy, iz)])
      }
    // Out-of-range indices clamp instead of reading garbage.
    expect(sliceVolume(v, 1, 99).density).toEqual(sliceVolume(v, 1, 9).density)
  })
})
