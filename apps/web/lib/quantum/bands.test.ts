import { describe, expect, it } from 'vitest'
import {
  ENERGY_UNIT_EV,
  blochDiscriminant,
  cellFromGrid,
  cellTransferMatrix,
  fillBands,
  findBands,
  freeElectronFolded,
  kronigPenneyCell,
  kronigPenneyFourierComponent,
} from './bands'
import { centeredGrid, solveStationary, uniformGrid } from './schrodinger'

/**
 * Every reference number here comes from outside lib/quantum/bands.ts: the free-electron
 * parabola, the Kronig–Penney condition as printed in Kittel, first-order perturbation
 * theory, the Mathieu characteristic values tabulated in Abramowitz & Stegun, and the
 * wave-1 finite-difference solver run on a hard-wall supercell that knows nothing about
 * transfer matrices. Nothing asserts the module's output back at itself.
 *
 * ħ = m = 1 throughout.
 */

/**
 * The textbook Kronig–Penney condition (Kittel, Introduction to Solid State Physics,
 * ch. 7, eq. 21b with ħ = m = 1), written out independently of the transfer matrix:
 *
 *   E < V₀:  cos(ka) = cos(qw)·cosh(κb) + ((κ² − q²)/(2qκ))·sin(qw)·sinh(κb)
 *   E > V₀:  cos(ka) = cos(qw)·cos(pb)  − ((q² + p²)/(2qp))·sin(qw)·sin(pb)
 *
 * with w = a − b, q = √(2E), κ = √(2(V₀ − E)), p = √(2(E − V₀)).
 */
function kittelDiscriminant(E: number, a: number, V0: number, b: number): number {
  const w = a - b
  const q = Math.sqrt(2 * E)
  // At E = V₀ exactly the formula is 0/0; its limit is cos(qw) − (qb/2)·sin(qw).
  if (E === V0) return Math.cos(q * w) - ((q * b) / 2) * Math.sin(q * w)
  if (E < V0) {
    const kappa = Math.sqrt(2 * (V0 - E))
    return (
      Math.cos(q * w) * Math.cosh(kappa * b) +
      ((kappa * kappa - q * q) / (2 * q * kappa)) * Math.sin(q * w) * Math.sinh(kappa * b)
    )
  }
  const p = Math.sqrt(2 * (E - V0))
  return (
    Math.cos(q * w) * Math.cos(p * b) -
    ((q * q + p * p) / (2 * q * p)) * Math.sin(q * w) * Math.sin(p * b)
  )
}

/**
 * A hand count of the allowed bands below E_max, done the way one does it on paper: walk
 * the Kittel discriminant up in energy on a fine mesh and count the runs where |Δ| ≤ 1.
 */
function countBandsByHand(a: number, V0: number, b: number, eMax: number): number {
  let count = 0
  let inside = false
  const steps = 200_000
  for (let i = 1; i <= steps; i++) {
    const E = (eMax * i) / steps
    const allowed = Math.abs(kittelDiscriminant(E, a, V0, b)) <= 1
    if (allowed && !inside) count++
    inside = allowed
  }
  return count
}

describe('transfer matrix', () => {
  it('has unit determinant at every energy, in and out of the bands', () => {
    const cell = kronigPenneyCell(2, 8, 0.6)
    for (const E of [0.1, 1, 3.9, 8, 8.1, 15, 40]) {
      const [m11, m12, m21, m22] = cellTransferMatrix(cell, E)
      expect(m11 * m22 - m12 * m21).toBeCloseTo(1, 9)
    }
  })

  it('reproduces the Kronig–Penney condition as printed in Kittel', () => {
    const a = 1.5
    const V0 = 6
    const b = 0.4
    const cell = kronigPenneyCell(a, V0, b)
    for (const E of [0.3, 1.2, 2.5, 4, 5.9, 6.1, 9, 20, 55]) {
      expect(blochDiscriminant(cell, E)).toBeCloseTo(kittelDiscriminant(E, a, V0, b), 8)
    }
  })

  it('is invariant under a cyclic shift of the cell (where the period starts is arbitrary)', () => {
    const a = 2
    const V0 = 5
    const b = 0.5
    const shifted = { ...kronigPenneyCell(a, V0, b) }
    const swapped = {
      ...shifted,
      slabs: [shifted.slabs[1], shifted.slabs[0]],
    }
    for (const E of [0.5, 2, 4.9, 7, 12]) {
      expect(blochDiscriminant(swapped, E)).toBeCloseTo(blochDiscriminant(shifted, E), 10)
    }
  })
})

describe('zero potential', () => {
  const a = 1.7
  const cell = kronigPenneyCell(a, 0, 0.5)
  const { bands, kSamples } = findBands(cell, { maxBands: 5, kSamples: 33 })

  it('finds five bands', () => {
    expect(bands).toHaveLength(5)
  })

  it('has every band on the free-electron parabola, folded into the first zone', () => {
    for (const band of bands) {
      for (let j = 0; j < kSamples.length; j++) {
        const k = kSamples[j]
        const q = band.index % 2 === 0 ? (band.index * Math.PI) / a + k : ((band.index + 1) * Math.PI) / a - k
        expect(band.energies[j]).toBeCloseTo((q * q) / 2, 6)
      }
    }
  })

  it('has no gaps: consecutive bands share an edge at (nπ/a)²/2', () => {
    for (let n = 1; n < bands.length; n++) {
      const edge = ((n * Math.PI) / a) ** 2 / 2
      expect(bands[n - 1].top).toBeCloseTo(edge, 5)
      expect(bands[n].bottom).toBeCloseTo(edge, 5)
      expect(bands[n].bottom - bands[n - 1].top).toBeLessThan(1e-6)
    }
    expect(bands[0].bottom).toBeCloseTo(0, 9)
  })

  it('agrees with freeElectronFolded, which the page overlays', () => {
    for (const band of bands) {
      for (let j = 0; j < kSamples.length; j++) {
        expect(freeElectronFolded(a, band.index, kSamples[j])).toBeCloseTo(band.energies[j], 6)
      }
    }
  })
})

describe('gaps open at the zone boundary, proportional to the Fourier component', () => {
  const a = 1
  const b = 0.3
  /** 2|V_n| with V_n = (V₀/nπ)·sin(nπb/a): first-order perturbation theory for the gap. */
  const firstOrderGap = (n: number, V0: number) =>
    2 * Math.abs((V0 / (n * Math.PI)) * Math.sin((n * Math.PI * b) / a))

  it('opens the first gap at k = π/a and the second at k = 0', () => {
    const { bands, kSamples } = findBands(kronigPenneyCell(a, 3, b), { maxBands: 3 })
    const last = kSamples.length - 1
    // Band 0 rises to its top at the zone edge, band 1 starts there and falls to k = 0.
    expect(bands[0].energies[last]).toBeCloseTo(bands[0].top, 9)
    expect(bands[1].energies[last]).toBeCloseTo(bands[1].bottom, 9)
    expect(bands[1].energies[0]).toBeCloseTo(bands[1].top, 9)
    expect(bands[2].energies[0]).toBeCloseTo(bands[2].bottom, 9)
    expect(bands[1].bottom - bands[0].top).toBeGreaterThan(0.1)
    expect(bands[2].bottom - bands[1].top).toBeGreaterThan(0.05)
  })

  it('matches 2|V_n| for a weak potential, for the first three gaps', () => {
    const V0 = 0.15 // ≪ π²/2 ≈ 4.9, the first band's free width
    const { bands } = findBands(kronigPenneyCell(a, V0, b), { maxBands: 4 })
    for (let n = 1; n <= 3; n++) {
      const gap = bands[n].bottom - bands[n - 1].top
      const predicted = firstOrderGap(n, V0)
      expect(Math.abs(gap - predicted) / predicted).toBeLessThan(0.03)
    }
  })

  it('scales linearly with V₀ while V₀ is small', () => {
    const gapAt = (V0: number) => {
      const { bands } = findBands(kronigPenneyCell(a, V0, b), { maxBands: 2 })
      return bands[1].bottom - bands[0].top
    }
    const g1 = gapAt(0.05)
    const g2 = gapAt(0.1)
    const g4 = gapAt(0.2)
    expect(g2 / g1).toBeCloseTo(2, 1)
    expect(g4 / g1).toBeCloseTo(4, 1)
  })

  it('closes the second gap when b = a/2, because sin(2π·b/a) = 0', () => {
    const V0 = 0.2
    const { bands } = findBands(kronigPenneyCell(a, V0, a / 2), { maxBands: 3 })
    const gap1 = bands[1].bottom - bands[0].top
    const gap2 = bands[2].bottom - bands[1].top
    expect(gap1).toBeGreaterThan(0.1) // ≈ 2V₀/π = 0.127
    // Second order in V₀ only: well under a tenth of the first gap.
    expect(gap2).toBeLessThan(gap1 / 10)
  })

  it('exposes the same Fourier component the page quotes', () => {
    expect(kronigPenneyFourierComponent(1, 0.15, b, a)).toBeCloseTo(firstOrderGap(1, 0.15) / 2, 12)
    expect(kronigPenneyFourierComponent(2, 1, 0.5, 1)).toBeCloseTo(0, 12)
  })
})

describe('band count over an energy window', () => {
  it('matches a hand count on the Kittel condition for a strong barrier', () => {
    // Deep tight-binding: a = 2, V₀ = 30, b = 0.5. The well between barriers is 1.5 wide,
    // so isolated-well levels sit near 2.19·n² — four of them (2.2, 8.8, 19.7, 35) are
    // below or straddling the barrier top, then the bands widen out above it. Walking
    // the printed condition up to E = 60 gives seven allowed runs.
    const a = 2
    const V0 = 30
    const b = 0.5
    const eMax = 60
    const byHand = countBandsByHand(a, V0, b, eMax)
    expect(byHand).toBe(7)
    const { bands } = findBands(kronigPenneyCell(a, V0, b), { maxBands: 20, energyMax: eMax })
    expect(bands.filter((band) => band.bottom <= eMax)).toHaveLength(byHand)
  })

  it('matches a hand count for a weak barrier, where bands nearly touch', () => {
    const a = 1
    const V0 = 0.6
    const b = 0.25
    const eMax = 50
    const byHand = countBandsByHand(a, V0, b, eMax)
    // Free electron: bands below E have tops at (nπ)²/2 ≤ 50 → n ≤ 3, and band 4 starts
    // at (3π)²/2 = 44.4 < 50, so four bands touch the window.
    expect(byHand).toBe(4)
    const { bands } = findBands(kronigPenneyCell(a, V0, b), { maxBands: 20, energyMax: eMax })
    expect(bands.filter((band) => band.bottom <= eMax)).toHaveLength(byHand)
  })

  it('agrees with the wave-1 finite-difference solver on a hard-wall supercell', () => {
    // N cells between hard walls give ≈ N states per band. solveStationary shares no code
    // with the transfer matrix, so this is an independent count of the states in the
    // first two bands — and a check that they fall inside the bands, not in the gaps.
    const a = 2
    const V0 = 12
    const b = 0.6
    const cells = 10
    const pointsPerCell = 100
    const n = cells * pointsPerCell
    const dx = (cells * a) / (n + 1)
    const grid = uniformGrid(n, dx, dx)
    const potential = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const xInCell = ((grid.x[i] % a) + a) % a
      potential[i] = xInCell >= a - b ? V0 : 0
    }
    const { bands } = findBands(kronigPenneyCell(a, V0, b), { maxBands: 3 })
    const states = solveStationary(grid, potential, 2 * cells + 2)
    const midGap2 = bands[1].top + 0.5 * (bands[2].bottom - bands[1].top)
    const below = states.filter((s) => s.energy < midGap2)
    expect(below).toHaveLength(2 * cells)

    // Finite differences shift levels by O(dx²); a small slack absorbs that. Anything
    // still outside a band must be a surface state: the well against the left-hand hard
    // wall is confined harder than a bulk well, which pushes its level up into the gap —
    // Tamm's 1932 argument — and the solver has no way of knowing the infinite crystal
    // forbids that energy. Such a state lives in an end cell, where its probability must
    // dominate, and there is at most one per gap per wall.
    const slack = 0.02 * V0
    const outside = below.filter(
      (s) => !bands.some((band) => s.energy >= band.bottom - slack && s.energy <= band.top + slack)
    )
    expect(outside.length).toBeLessThanOrEqual(4)
    for (const s of outside) {
      let endCells = 0
      let total = 0
      for (let i = 0; i < n; i++) {
        const p = s.psi[i] * s.psi[i]
        total += p
        if (grid.x[i] < a || grid.x[i] > (cells - 1) * a) endCells += p
      }
      expect(endCells / total, `E = ${s.energy.toFixed(4)} should be wall-localised`).toBeGreaterThan(0.5)
    }
    // And the bulk states, in-band, number N − 1 per band once one has gone to the wall.
    expect(below.length - outside.length).toBeGreaterThanOrEqual(2 * cells - 2)
  })
})

describe('a smooth potential sampled on an engine grid', () => {
  /**
   * V(x) = q·cos(2x) with ħ = m = 1 is Mathieu's equation y″ + (a − 2q cos 2x)y = 0 with
   * a_Mathieu = 2E. Its band edges are the characteristic values a_r(q) (period-π and 2π
   * even solutions) and b_r(q) (odd). Abramowitz & Stegun, Table 20.1, at q = 1:
   */
  const MATHIEU_Q1 = {
    a0: -0.45513860,
    b1: -0.11024882,
    a1: 1.85910807,
    b2: 3.91702477,
    a2: 4.37130098,
  }

  it('reproduces the Mathieu characteristic values at q = 1 as band edges', () => {
    const period = Math.PI
    const grid = centeredGrid(1024, period / 2)
    const potential = new Float64Array(grid.n)
    for (let i = 0; i < grid.n; i++) potential[i] = Math.cos(2 * grid.x[i])
    const cell = cellFromGrid(grid, potential)
    expect(cell.period).toBeCloseTo(period, 12)
    const { bands } = findBands(cell, { maxBands: 3 })
    // Band 0: [a₀, b₁]; band 1: [a₁, b₂]; band 2: [a₂, …] — all halved for E = a/2.
    const tol = 2e-4
    expect(Math.abs(2 * bands[0].bottom - MATHIEU_Q1.a0)).toBeLessThan(tol)
    expect(Math.abs(2 * bands[0].top - MATHIEU_Q1.b1)).toBeLessThan(tol)
    expect(Math.abs(2 * bands[1].bottom - MATHIEU_Q1.a1)).toBeLessThan(tol)
    expect(Math.abs(2 * bands[1].top - MATHIEU_Q1.b2)).toBeLessThan(tol)
    expect(Math.abs(2 * bands[2].bottom - MATHIEU_Q1.a2)).toBeLessThan(tol)
  })

  it('matches the exact two-slab cell when the sampled potential is a rectangular barrier', () => {
    const a = 2
    const V0 = 7
    const b = 0.5
    // 400 points per period, barrier edges landing on slab boundaries.
    const grid = uniformGrid(400, a / 400, a / 800)
    const potential = new Float64Array(grid.n)
    for (let i = 0; i < grid.n; i++) potential[i] = grid.x[i] > a - b ? V0 : 0
    const sampled = findBands(cellFromGrid(grid, potential), { maxBands: 3 })
    const exact = findBands(kronigPenneyCell(a, V0, b), { maxBands: 3 })
    for (let n = 0; n < 3; n++) {
      expect(sampled.bands[n].bottom).toBeCloseTo(exact.bands[n].bottom, 6)
      expect(sampled.bands[n].top).toBeCloseTo(exact.bands[n].top, 6)
    }
  })
})

describe('filling', () => {
  const a = 2
  const { bands } = findBands(kronigPenneyCell(a, 6, 0.5), { maxBands: 5 })

  it('one electron per cell half-fills band 0 and conducts', () => {
    const f = fillBands(bands, 1)
    expect(f.regime).toBe('metal')
    expect(f.partiallyFilled).toBe(true)
    expect(f.highestOccupied).toBe(0)
    expect(f.gap).toBe(0)
    // Half filling puts E_F where Δ = 0, strictly inside the band.
    expect(f.fermiEnergy).toBeGreaterThan(bands[0].bottom)
    expect(f.fermiEnergy).toBeLessThan(bands[0].top)
    expect(blochDiscriminant(kronigPenneyCell(a, 6, 0.5), f.fermiEnergy)).toBeCloseTo(0, 8)
  })

  it('two electrons per cell fill band 0 and put E_F mid-gap', () => {
    const f = fillBands(bands, 2)
    expect(f.partiallyFilled).toBe(false)
    expect(f.filledBands).toBe(1)
    expect(f.gap).toBeCloseTo(bands[1].bottom - bands[0].top, 12)
    expect(f.gapEv).toBeCloseTo(f.gap * ENERGY_UNIT_EV, 12)
    expect(f.fermiEnergy).toBeCloseTo(0.5 * (bands[0].top + bands[1].bottom), 12)
    expect(['semiconductor', 'insulator']).toContain(f.regime)
  })

  it('calls a closed gap with even filling a metal', () => {
    const free = findBands(kronigPenneyCell(a, 0, 0.5), { maxBands: 3 }).bands
    expect(fillBands(free, 2).regime).toBe('metal')
    expect(fillBands(free, 4).regime).toBe('metal')
  })

  it('splits semiconductor from insulator at 3 eV with the stated length unit', () => {
    // 1 length unit = 2 Å → 1 energy unit = 7.62/4 = 1.905 eV.
    expect(ENERGY_UNIT_EV).toBeCloseTo(1.905, 3)
    const narrow = [
      { index: 0, bottom: 0, top: 1, centre: 0.5, energies: new Float64Array(2) },
      { index: 1, bottom: 2, top: 3, centre: 2.5, energies: new Float64Array(2) },
    ]
    expect(fillBands(narrow, 2).regime).toBe('semiconductor') // 1 unit ≈ 1.9 eV
    const wide = [
      narrow[0],
      { index: 1, bottom: 3, top: 4, centre: 3.5, energies: new Float64Array(2) },
    ]
    expect(fillBands(wide, 2).regime).toBe('insulator') // 2 units ≈ 3.8 eV
  })

  it('flags an electron count the computed bands cannot place', () => {
    // Filling every computed band still needs the next one up to name the gap.
    expect(fillBands(bands, 2 * bands.length).overflow).toBe(true)
    expect(fillBands(bands, 2 * bands.length - 1).overflow).toBe(false)
  })
})
