import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VISUALIZATIONS } from '@/lib/visualizations'
import {
  ELEMENT_SYMBOLS,
  analyticWellEnergy,
  diagonalDensity,
  electronConfiguration,
  exchangeCoordinates,
  formatConfiguration,
  groundStateOccupation,
  madelungConfiguration,
  madelungOrder,
  meanSquareSeparation,
  orbitalMoments,
  samplePairs,
  separationDistribution,
  shellPopulation,
  tablePosition,
  twoBodyAmplitude,
  twoBodyNorm,
  wellOrbitals,
} from './identicalParticles'

/**
 * Every reference number here comes from a closed form — the infinite-well levels, the
 * infinite-well matrix elements ⟨n|x|n⟩, ⟨n|x²|n⟩ and ⟨1|x|2⟩, Griffiths' exchange-force
 * identity for ⟨(x₁ − x₂)²⟩ — or from the periodic table as printed. Nothing asserts the
 * module's output back at itself.
 *
 * ħ = m = 1, L = 1 unless stated, so E₁ = π²/2.
 */

const L = 1
const N = 128

/** ⟨x⟩ for any infinite-well level: the well is symmetric about L/2. */
const meanX = L / 2
/** ⟨x²⟩_n = L²(1/3 − 1/(2n²π²)). Standard integral. */
const meanX2 = (n: number) => L * L * (1 / 3 - 1 / (2 * n * n * Math.PI * Math.PI))
/** ⟨1|x|2⟩ = −16L/(9π²). Griffiths problem 5.6 / direct integration. */
const cross12 = (-16 * L) / (9 * Math.PI * Math.PI)

function orbitals(count = 4) {
  return wellOrbitals(N, L, count)
}

describe('single-particle orbitals from the wave-1 engine', () => {
  it('reproduce E_n = n²π²/2L² to a quarter of a percent on a 128-point grid', () => {
    const { states } = orbitals(4)
    for (let n = 1; n <= 4; n++) {
      const exact = analyticWellEnergy(n, L)
      expect(Math.abs(states[n - 1].energy - exact) / exact).toBeLessThan(2.5e-3)
    }
  })

  it('are orthonormal on the grid, which is what makes the two-body norm meaningful', () => {
    const { grid, states } = orbitals(3)
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let dot = 0
        for (let i = 0; i < grid.n; i++) dot += states[a].psi[i] * states[b].psi[i]
        expect(dot * grid.dx).toBeCloseTo(a === b ? 1 : 0, 10)
      }
    }
  })
})

describe('two-body amplitudes', () => {
  const { grid, states } = orbitals(3)
  const phi1 = states[0].psi
  const phi2 = states[1].psi

  it('the antisymmetric wavefunction vanishes exactly on x₁ = x₂', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'fermion')!
    const diag = diagonalDensity(psi, grid.n)
    for (let i = 0; i < grid.n; i++) expect(diag[i]).toBe(0)
  })

  it('the symmetric wavefunction does not vanish on the diagonal', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'boson')!
    const diag = diagonalDensity(psi, grid.n)
    let peak = 0
    for (let i = 0; i < grid.n; i++) peak = Math.max(peak, diag[i])
    // Continuum value at the peak of |√2 φ₁φ₂|² is 2·(2/L)²·max(sin·sin)² ≈ 2·4·0.5625 = 4.5.
    expect(peak).toBeGreaterThan(4)
  })

  it('both symmetrised states are normalised: Σ|ψ|² dx² = 1', () => {
    for (const stats of ['boson', 'fermion', 'distinguishable'] as const) {
      const psi = twoBodyAmplitude(phi1, phi2, stats)!
      expect(twoBodyNorm(psi, grid.dx)).toBeCloseTo(1, 9)
    }
  })

  it('exchanging coordinates gives +ψ for bosons and −ψ for fermions, bit for bit', () => {
    const boson = twoBodyAmplitude(phi1, phi2, 'boson')!
    const fermion = twoBodyAmplitude(phi1, phi2, 'fermion')!
    const bosonSwapped = exchangeCoordinates(boson, grid.n)
    const fermionSwapped = exchangeCoordinates(fermion, grid.n)
    let nonzero = 0
    for (let k = 0; k < boson.length; k++) {
      expect(bosonSwapped[k] === boson[k]).toBe(true)
      expect(fermionSwapped[k] === -fermion[k]).toBe(true)
      if (fermion[k] !== 0) nonzero++
    }
    // Guard the guard: the fermion state is not trivially zero everywhere.
    expect(nonzero).toBeGreaterThan(grid.n * grid.n / 2)
  })

  it('a distinguishable product is neither symmetric nor antisymmetric', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'distinguishable')!
    const swapped = exchangeCoordinates(psi, grid.n)
    let maxDiff = 0
    let maxSum = 0
    for (let k = 0; k < psi.length; k++) {
      maxDiff = Math.max(maxDiff, Math.abs(psi[k] - swapped[k]))
      maxSum = Math.max(maxSum, Math.abs(psi[k] + swapped[k]))
    }
    expect(maxDiff).toBeGreaterThan(1)
    expect(maxSum).toBeGreaterThan(1)
  })

  it('two fermions cannot share an orbital; two bosons in one orbital is the plain product', () => {
    expect(twoBodyAmplitude(phi1, phi1, 'fermion', true)).toBeNull()
    const boson = twoBodyAmplitude(phi1, phi1, 'boson', true)!
    expect(twoBodyNorm(boson, grid.dx)).toBeCloseTo(1, 9)
    // Product state exactly: ψ(x_i, x_j) = φ₁(x_i)φ₁(x_j).
    expect(boson[5 * grid.n + 9]).toBe(phi1[5] * phi1[9])
  })

  it('rejects orbitals on different grids', () => {
    expect(() => twoBodyAmplitude(phi1, new Float64Array(7), 'boson')).toThrow(RangeError)
    expect(() => exchangeCoordinates(new Float64Array(10), 3)).toThrow(RangeError)
  })
})

describe('the exchange force, quantitatively (Griffiths eq. 5.21)', () => {
  // ⟨(x₁−x₂)²⟩ = ⟨x²⟩_a + ⟨x²⟩_b − 2⟨x⟩_a⟨x⟩_b ∓ 2|⟨a|x|b⟩|²  (− bosons, + fermions)
  const distinguishable = meanX2(1) + meanX2(2) - 2 * meanX * meanX
  const pairing = 2 * cross12 * cross12
  const { grid, states } = orbitals(2)
  const phi1 = states[0].psi
  const phi2 = states[1].psi

  it('the grid orbitals reproduce the closed-form matrix elements', () => {
    const m = orbitalMoments(grid, phi1, phi2)
    expect(m.meanA).toBeCloseTo(meanX, 6)
    expect(m.meanB).toBeCloseTo(meanX, 6)
    expect(m.meanSqA).toBeCloseTo(meanX2(1), 4)
    expect(m.meanSqB).toBeCloseTo(meanX2(2), 4)
    expect(Math.abs(m.crossAB)).toBeCloseTo(Math.abs(cross12), 4)
  })

  it('distinguishable particles: ⟨(x₁−x₂)²⟩ = 0.10334 L²', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'distinguishable')!
    expect(distinguishable).toBeCloseTo(0.10334, 4)
    expect(meanSquareSeparation(psi, grid)).toBeCloseTo(distinguishable, 3)
  })

  it('bosons sit closer: ⟨(x₁−x₂)²⟩ = 0.03845 L²', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'boson')!
    expect(distinguishable - pairing).toBeCloseTo(0.03845, 4)
    expect(meanSquareSeparation(psi, grid)).toBeCloseTo(distinguishable - pairing, 3)
  })

  it('fermions sit further apart: ⟨(x₁−x₂)²⟩ = 0.16823 L²', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'fermion')!
    expect(distinguishable + pairing).toBeCloseTo(0.16823, 4)
    expect(meanSquareSeparation(psi, grid)).toBeCloseTo(distinguishable + pairing, 3)
  })

  it('orbitals 1 and 3 have ⟨1|x|3⟩ = 0 by parity, so the exchange shift vanishes', () => {
    // Both orbitals are even about L/2; (x − L/2) is odd, and the L/2 piece is killed by
    // orthogonality. So the three statistics share one ⟨(x₁−x₂)²⟩ even though the fermion
    // density still has its hole.
    const { grid: g3, states: s3 } = orbitals(3)
    const a = s3[0].psi
    const c = s3[2].psi
    expect(Math.abs(orbitalMoments(g3, a, c).crossAB)).toBeLessThan(1e-9)
    const expected = meanX2(1) + meanX2(3) - 2 * meanX * meanX
    for (const stats of ['boson', 'fermion', 'distinguishable'] as const) {
      const psi = twoBodyAmplitude(a, c, stats)!
      expect(meanSquareSeparation(psi, g3)).toBeCloseTo(expected, 3)
    }
    expect(diagonalDensity(twoBodyAmplitude(a, c, 'fermion')!, g3.n).every((v) => v === 0)).toBe(true)
  })
})

describe('separation distribution and sampling', () => {
  const { grid, states } = orbitals(2)
  const phi1 = states[0].psi
  const phi2 = states[1].psi

  it('integrates to one for every statistics and is symmetric in r', () => {
    for (const stats of ['boson', 'fermion', 'distinguishable'] as const) {
      const psi = twoBodyAmplitude(phi1, phi2, stats)!
      const { r, density } = separationDistribution(psi, grid)
      let total = 0
      for (let k = 0; k < density.length; k++) total += density[k]
      expect(total * grid.dx).toBeCloseTo(1, 9)
      expect(r[0]).toBeCloseTo(-(grid.n - 1) * grid.dx, 12)
      expect(r[density.length - 1]).toBeCloseTo((grid.n - 1) * grid.dx, 12)
      // |ψ(x₁,x₂)|² = |ψ(x₂,x₁)|² for all three, so P(r) = P(−r).
      for (let k = 0; k < density.length; k++) {
        expect(density[k]).toBeCloseTo(density[density.length - 1 - k], 10)
      }
    }
  })

  it('P(r = 0) is zero for fermions and larger for bosons than for distinguishable pairs', () => {
    const at0 = (stats: 'boson' | 'fermion' | 'distinguishable') => {
      const { density } = separationDistribution(twoBodyAmplitude(phi1, phi2, stats)!, grid)
      return density[grid.n - 1]
    }
    expect(at0('fermion')).toBe(0)
    expect(at0('boson')).toBeGreaterThan(at0('distinguishable') * 1.5)
  })

  it('a scripted random source lands in the cell it points at, jittered inside it', () => {
    const psi = twoBodyAmplitude(phi1, phi2, 'boson')!
    // u just under the total mass → the last cell with any mass; then jitter 0.5, 0.5 → exact centre.
    const values = [1 - 1e-12, 0.5, 0.5]
    let call = 0
    const pairs = samplePairs(psi, grid, 1, () => values[call++])
    expect(pairs).toHaveLength(1)
    // Find the last cell with non-zero mass by hand.
    let last = psi.length - 1
    while (psi[last] === 0) last--
    const i = Math.floor(last / grid.n)
    const j = last - i * grid.n
    expect(pairs[0][0]).toBeCloseTo(grid.x[i], 12)
    expect(pairs[0][1]).toBeCloseTo(grid.x[j], 12)
  })

  it('sampled fermion pairs avoid the diagonal; sampled boson pairs crowd it', () => {
    // A deterministic LCG so the test cannot flake.
    let s = 12345
    const lcg = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
    const near = (stats: 'boson' | 'fermion') => {
      const psi = twoBodyAmplitude(phi1, phi2, stats)!
      const pairs = samplePairs(psi, grid, 3000, lcg)
      return pairs.filter(([a, b]) => Math.abs(a - b) < 0.05 * L).length / pairs.length
    }
    // Boson: closed-form P(|r| < 0.05) is a few percent; the fermion density is ∝ r² near
    // r = 0, so its share is at least an order of magnitude smaller.
    const f = near('fermion')
    const b = near('boson')
    expect(b).toBeGreaterThan(0.1)
    expect(f).toBeLessThan(b / 10)
  })
})

describe('filling the levels', () => {
  const ladder = [1, 4, 9, 16, 25].map((k) => (k * Math.PI * Math.PI) / 2) // E_n, L = 1

  it('two spin-polarised fermions cost E₁ + E₂, two bosons cost 2E₁ — from the solver', () => {
    const { states } = orbitals(2)
    const solverLadder = states.map((s) => s.energy)
    const fermion = groundStateOccupation('fermion', 2, solverLadder, 1)
    const boson = groundStateOccupation('boson', 2, solverLadder, 1)
    const e1 = analyticWellEnergy(1, L)
    const e2 = analyticWellEnergy(2, L)
    expect(fermion.occupation).toEqual([1, 1])
    expect(Math.abs(fermion.energy - (e1 + e2)) / (e1 + e2)).toBeLessThan(2.5e-3)
    expect(boson.occupation).toEqual([2, 0])
    expect(Math.abs(boson.energy - 2 * e1) / (2 * e1)).toBeLessThan(2.5e-3)
    // And the ratio is 5/2 whatever the units.
    expect(fermion.energy / boson.energy).toBeCloseTo(2.5, 2)
  })

  it('spin-½ fermions pair up: N = 3 is 2E₁ + E₂, N = 5 is 2E₁ + 2E₂ + E₃', () => {
    const three = groundStateOccupation('fermion', 3, ladder, 2)
    expect(three.occupation).toEqual([2, 1, 0, 0, 0])
    expect(three.energy).toBeCloseTo(2 * ladder[0] + ladder[1], 10)
    const five = groundStateOccupation('fermion', 5, ladder, 2)
    expect(five.occupation).toEqual([2, 2, 1, 0, 0])
    expect(five.energy).toBeCloseTo(2 * ladder[0] + 2 * ladder[1] + ladder[2], 10)
  })

  it('N bosons all sit in the ground state at N·E₁; the Fermi energy climbs as N²', () => {
    const bosons = groundStateOccupation('boson', 5, ladder)
    expect(bosons.occupation).toEqual([5, 0, 0, 0, 0])
    expect(bosons.energy).toBeCloseTo(5 * ladder[0], 10)
    const fermions = groundStateOccupation('fermion', 5, ladder, 1)
    expect(fermions.energy / ladder[0]).toBeCloseTo(1 + 4 + 9 + 16 + 25, 10)
  })

  it('refuses to lose fermions off the top of a short ladder', () => {
    expect(() => groundStateOccupation('fermion', 3, [1, 2], 1)).toThrow(RangeError)
    expect(() => groundStateOccupation('fermion', 5, [1, 2], 2)).toThrow(RangeError)
    expect(groundStateOccupation('fermion', 4, [1, 2], 2).occupation).toEqual([2, 2])
    expect(groundStateOccupation('boson', 0, [1, 2]).energy).toBe(0)
  })
})

describe('the periodic table from the Pauli principle', () => {
  it('Madelung order starts 1s 2s 2p 3s 3p 4s 3d 4p 5s 4d 5p 6s 4f 5d 6p 7s', () => {
    const labels = madelungOrder().map((s) => s.label).slice(0, 16)
    expect(labels).toEqual([
      '1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '5s', '4d', '5p', '6s', '4f', '5d', '6p', '7s',
    ])
    expect(madelungOrder().find((s) => s.label === '3d')?.capacity).toBe(10)
    expect(madelungOrder().find((s) => s.label === '4f')?.capacity).toBe(14)
  })

  it('reproduces printed ground-state configurations', () => {
    const text = (z: number) => formatConfiguration(electronConfiguration(z))
    expect(text(1)).toBe('1s¹')
    expect(text(6)).toBe('1s² 2s² 2p²')
    expect(text(11)).toBe('1s² 2s² 2p⁶ 3s¹')
    expect(text(18)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶')
    // Potassium: 4s fills before 3d. This is the one that makes row 3 eight wide.
    expect(text(19)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹')
    expect(text(26)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s² 3d⁶')
    expect(text(36)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s² 3d¹⁰ 4p⁶')
  })

  it('patches chromium and copper, the two exceptions below krypton', () => {
    expect(formatConfiguration(madelungConfiguration(24))).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s² 3d⁴')
    expect(formatConfiguration(electronConfiguration(24))).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹ 3d⁵')
    expect(formatConfiguration(electronConfiguration(29))).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹ 3d¹⁰')
  })

  it('closes shells at the noble gases with populations 2 / 2,8 / 2,8,8 / 2,8,18,8', () => {
    expect(shellPopulation(electronConfiguration(2))).toEqual([2])
    expect(shellPopulation(electronConfiguration(10))).toEqual([2, 8])
    expect(shellPopulation(electronConfiguration(18))).toEqual([2, 8, 8])
    expect(shellPopulation(electronConfiguration(36))).toEqual([2, 8, 18, 8])
  })

  it('places all 36 elements in distinct cells of a 4 × 18 table', () => {
    const seen = new Set<string>()
    for (let z = 1; z <= 36; z++) {
      const { row, column } = tablePosition(z)
      expect(row).toBeGreaterThanOrEqual(1)
      expect(row).toBeLessThanOrEqual(4)
      expect(column).toBeGreaterThanOrEqual(1)
      expect(column).toBeLessThanOrEqual(18)
      seen.add(`${row}:${column}`)
    }
    expect(seen.size).toBe(36)
    expect(tablePosition(2)).toEqual({ row: 1, column: 18 })
    expect(tablePosition(10)).toEqual({ row: 2, column: 18 })
    expect(tablePosition(11)).toEqual({ row: 3, column: 1 })
    expect(tablePosition(21)).toEqual({ row: 4, column: 3 })
    expect(ELEMENT_SYMBOLS[35]).toBe('Kr')
    expect(ELEMENT_SYMBOLS).toHaveLength(36)
  })
})

describe('the page is registered', () => {
  const HREF = '/visualizations/identical-particles'

  it('appears in the catalogue with the right shape', () => {
    const entry = VISUALIZATIONS.find((v) => v.href === HREF)
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('Advanced')
    // The hue is assigned by position when the catalogue is re-ordered, so pin
    // the palette, not the colour.
    expect(['violet', 'teal', 'sky', 'amber', 'rose']).toContain(entry?.accent)
    expect(entry?.title).toBe('Fermions and Bosons')
    expect(entry?.hook.length).toBeGreaterThan(30)
  })

  it('has the three files a visualization route needs', () => {
    for (const file of ['page.tsx', 'layout.tsx', 'opengraph-image.tsx']) {
      expect(existsSync(resolve(__dirname, '../../app', HREF.slice(1), file))).toBe(true)
    }
  })
})
