import { describe, expect, it } from 'vitest'
import {
  BAR_MAX_HEIGHT,
  barGrid,
  barHeight,
  columnCount,
  describeMatrix,
  formatEntry,
  fraction,
  hintonLayout,
  hintonSide,
  isRealMatrix,
  labelStride,
  matrixEntries,
  oklchToRgb,
  phaseHex,
  phaseHue,
  phaseRingStops,
  resolveScale,
  rgbToHex,
} from './matrixLayout'
import { bellPairDensityMatrix, maximallyMixed, type Complex } from '@/lib/quantum/densityMatrixView'

const z = (re: number, im = 0): Complex => ({ re, im })

describe('phase colour ring', () => {
  it('is cyclic: 0 and 2π map to the same hue and hex; π is different', () => {
    expect(phaseHue(0)).toBeCloseTo(phaseHue(2 * Math.PI), 9)
    expect(phaseHex(0)).toBe(phaseHex(2 * Math.PI))
    expect(phaseHex(0)).not.toBe(phaseHex(Math.PI))
    expect(phaseHex(-Math.PI)).toBe(phaseHex(Math.PI))
  })

  it('uses the q-sphere key: phase 0 → hue 250°, π → 70°, and stays in [0, 360)', () => {
    expect(phaseHue(0)).toBeCloseTo(250, 9)
    expect(phaseHue(Math.PI)).toBeCloseTo(70, 9)
    for (let k = -20; k <= 20; k++) {
      const h = phaseHue((k / 7) * Math.PI)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })

  it('OKLCH → sRGB reproduces white, black and the CSS Color 4 reference for oklch(0.7 0.15 250)', () => {
    expect(rgbToHex(oklchToRgb(1, 0, 0))).toBe('#ffffff')
    expect(rgbToHex(oklchToRgb(0, 0, 0))).toBe('#000000')
    // Achromatic mid-grey: all channels equal.
    const [r, g, b] = oklchToRgb(0.6, 0, 123)
    expect(r).toBeCloseTo(g, 6)
    expect(g).toBeCloseTo(b, 6)
    // Independent references: Ottosson's published OKLab coordinates of the sRGB
    // primaries. Red (1,0,0) = Lab(0.628, 0.2249, 0.1258); blue (0,0,1) =
    // Lab(0.452, −0.0325, −0.3115). Converted to LCh by hand: C = √(a²+b²),
    // h = atan2(b, a). Rounding in the table is ±0.0005, hence ±3 per channel.
    const near = (got: [number, number, number], want: [number, number, number]) => {
      got.forEach((v, k) => expect(Math.abs(Math.round(v * 255) - want[k])).toBeLessThanOrEqual(3))
    }
    const redC = Math.hypot(0.2249, 0.1258)
    const redH = (Math.atan2(0.1258, 0.2249) * 180) / Math.PI
    near(oklchToRgb(0.628, redC, redH), [255, 0, 0])
    const blueC = Math.hypot(-0.0325, -0.3115)
    const blueH = ((Math.atan2(-0.3115, -0.0325) * 180) / Math.PI + 360) % 360
    near(oklchToRgb(0.452, blueC, blueH), [0, 0, 255])
  })

  it('every phase on the ring lands inside sRGB (no channel clamped hard) and hue 0 is redder than hue 250', () => {
    for (let k = 0; k < 36; k++) {
      const [r, g, b] = oklchToRgb(0.7, 0.15, k * 10)
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
    const red = oklchToRgb(0.7, 0.15, 20)
    const blue = oklchToRgb(0.7, 0.15, 250)
    expect(red[0]).toBeGreaterThan(red[2])
    expect(blue[2]).toBeGreaterThan(blue[0])
  })

  it('ring stops start and end on the same colour', () => {
    const stops = phaseRingStops(12)
    expect(stops).toHaveLength(13)
    expect(stops[0].hex).toBe(stops[12].hex)
    expect(new Set(stops.slice(0, 12).map((s) => s.hex)).size).toBe(12)
  })
})

describe('entries and scale', () => {
  it('flattens row-major with magnitude and phase; zero entries get phase 0', () => {
    const e = matrixEntries([
      [z(1), z(0, -1)],
      [z(0), z(-0.5)],
    ])
    expect(e.map((x) => [x.row, x.col])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]])
    expect(e[1].magnitude).toBeCloseTo(1, 12)
    expect(e[1].phase).toBeCloseTo(-Math.PI / 2, 12)
    expect(e[2].phase).toBe(0)
    expect(e[3].phase).toBeCloseTo(Math.PI, 12)
  })

  it('tolerates ragged rows and non-finite values without NaN', () => {
    const e = matrixEntries([[z(NaN), z(Infinity, 1)], [z(1)]])
    expect(e).toHaveLength(3)
    for (const x of e) {
      expect(Number.isFinite(x.magnitude)).toBe(true)
      expect(Number.isFinite(x.phase)).toBe(true)
    }
    expect(columnCount([[z(1)], [z(1), z(1), z(1)]])).toBe(3)
    expect(columnCount([])).toBe(0)
  })

  it('resolveScale honours a pinned scale and otherwise uses the largest magnitude, never 0', () => {
    expect(resolveScale(bellPairDensityMatrix(), 1)).toBe(1)
    expect(resolveScale(bellPairDensityMatrix())).toBeCloseTo(0.5, 12)
    expect(resolveScale([[z(0)]])).toBe(1)
    expect(resolveScale([[z(3, 4)]], 0)).toBe(5)
    expect(resolveScale([[z(3, 4)]], NaN)).toBe(5)
  })

  it('fraction clamps to [0, 1] and never returns NaN', () => {
    expect(fraction(0.5, 1)).toBeCloseTo(0.5, 12)
    expect(fraction(2, 1)).toBe(1)
    expect(fraction(-1, 1)).toBe(0)
    expect(fraction(1, 0)).toBe(0)
    expect(fraction(NaN, 1)).toBe(0)
    expect(fraction(1, NaN)).toBe(0)
  })

  it('isRealMatrix', () => {
    expect(isRealMatrix(bellPairDensityMatrix())).toBe(true)
    expect(isRealMatrix([[z(0, 0.1)]])).toBe(false)
  })
})

describe('3-D bar grid', () => {
  it('is centred on the origin with unit pitch, and row 0 is nearest the viewer (+z)', () => {
    const g = barGrid(4, 4)
    expect(g.x).toHaveLength(4)
    expect(g.z).toHaveLength(4)
    expect(g.x.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 12)
    expect(g.z.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 12)
    expect(g.x[1] - g.x[0]).toBeCloseTo(1, 12)
    expect(g.z[0]).toBeGreaterThan(g.z[3])
    expect(g.barWidth).toBeGreaterThan(0)
    expect(g.barWidth).toBeLessThan(1)
    // Every bar's footprint lies inside the ground plane.
    for (const x of g.x) expect(Math.abs(x) + g.barWidth / 2).toBeLessThanOrEqual(g.extentX)
    for (const zz of g.z) expect(Math.abs(zz) + g.barWidth / 2).toBeLessThanOrEqual(g.extentZ)
    expect(g.focus).toBeGreaterThan(g.extentX)
  })

  it('handles the degenerate sizes: 0×0 draws nothing, 1×1 sits at the origin, non-square works', () => {
    const empty = barGrid(0, 0)
    expect(empty.x).toEqual([])
    expect(empty.z).toEqual([])
    expect(Number.isFinite(empty.focus)).toBe(true)
    expect(empty.focus).toBeGreaterThan(0)
    const one = barGrid(1, 1)
    expect(one.x[0]).toBeCloseTo(0, 12)
    expect(one.z[0]).toBeCloseTo(0, 12)
    const rect = barGrid(2, 8)
    expect(rect.rows).toBe(2)
    expect(rect.cols).toBe(8)
    expect(rect.extentX).toBeGreaterThan(rect.extentZ)
  })

  it('bar height is linear in magnitude/scale, 0 for a zero entry, capped at the maximum', () => {
    expect(barHeight(0, 1)).toBe(0)
    expect(barHeight(0.5, 1)).toBeCloseTo(BAR_MAX_HEIGHT / 2, 12)
    expect(barHeight(1, 1)).toBeCloseTo(BAR_MAX_HEIGHT, 12)
    expect(barHeight(7, 1)).toBeCloseTo(BAR_MAX_HEIGHT, 12)
    expect(barHeight(NaN, 1)).toBe(0)
    expect(barHeight(1, 0)).toBe(0)
    // Bell corners at scale 1 are exactly half the height of a pure basis state.
    const bell = barHeight(0.5, 1)
    const basis = barHeight(1, 1)
    expect(bell * 2).toBeCloseTo(basis, 12)
  })

  it('label stride thins long axes only', () => {
    expect(labelStride(2)).toBe(1)
    expect(labelStride(8)).toBe(1)
    expect(labelStride(16)).toBe(2)
    expect(labelStride(64)).toBe(8)
  })
})

describe('Hinton layout', () => {
  const sizes: [number, number][] = [
    [0, 0],
    [1, 1],
    [30, 30],
    [320, 320],
    [390, 260],
    [1024, 400],
    [NaN, 300],
    [-50, 300],
  ]

  it('fits the grid inside the box at every size and never produces NaN or a negative cell', () => {
    for (const [w, h] of sizes) {
      for (const dim of [1, 2, 4, 8, 16]) {
        const L = hintonLayout(dim, dim, w, h)
        expect(Number.isFinite(L.cell)).toBe(true)
        expect(L.cell).toBeGreaterThanOrEqual(0)
        if (L.cell > 0) {
          expect(L.originX + L.cell * dim).toBeLessThanOrEqual(w + 1e-9)
          expect(L.originY + L.cell * dim).toBeLessThanOrEqual(h + 1e-9)
          expect(L.width).toBeLessThanOrEqual(w + 1e-9)
          expect(L.height).toBeLessThanOrEqual(h + 1e-9)
        } else {
          expect(L.width).toBe(0)
          expect(L.height).toBe(0)
        }
      }
    }
  })

  it('a 0-width box yields cell 0 (draw nothing) rather than throwing', () => {
    expect(() => hintonLayout(4, 4, 0, 0)).not.toThrow()
    expect(hintonLayout(4, 4, 0, 0).cell).toBe(0)
    expect(hintonLayout(0, 0, 500, 500).cell).toBe(0)
  })

  it('cells are square and use the limiting dimension', () => {
    const wide = hintonLayout(4, 4, 1000, 222, { gutterLeft: 40, gutterTop: 22, pad: 0 })
    expect(wide.cell).toBeCloseTo(50, 9) // (222 − 22) / 4
    const tall = hintonLayout(4, 4, 240, 1000, { gutterLeft: 40, gutterTop: 22, pad: 0 })
    expect(tall.cell).toBeCloseTo(50, 9) // (240 − 40) / 4
  })

  it('square side is linear in magnitude, zero for zero, and leaves a gap at full scale', () => {
    expect(hintonSide(0, 1, 40)).toBe(0)
    expect(hintonSide(0.5, 1, 40)).toBeCloseTo(18, 9)
    expect(hintonSide(1, 1, 40)).toBeCloseTo(36, 9)
    expect(hintonSide(1, 1, 40)).toBeLessThan(40)
    expect(hintonSide(1e-3, 1, 40)).toBeGreaterThanOrEqual(1)
  })
})

describe('accessible text', () => {
  it('formats real, negative and complex entries', () => {
    expect(formatEntry(0.5, 0)).toBe('0.50')
    expect(formatEntry(-0.5, 0)).toBe('−0.50')
    expect(formatEntry(0, 0)).toBe('0')
    expect(formatEntry(0, 0.5)).toBe('0.50 e^(i0.50π)')
    expect(formatEntry(0, -0.5)).toBe('0.50 e^(−i0.50π)')
  })

  it('describes the Bell ρ by its four corners and I/2 by its two diagonal entries', () => {
    const labels = ['|00⟩', '|01⟩', '|10⟩', '|11⟩']
    const bell = describeMatrix(bellPairDensityMatrix(), labels)
    expect(bell).toContain('4 by 4 matrix with 4 non-zero entries')
    expect(bell).toContain('|00⟩⟨00| 0.50')
    expect(bell).toContain('|11⟩⟨00| 0.50')
    const mixed = describeMatrix(maximallyMixed(2), ['|0⟩', '|1⟩'])
    expect(mixed).toContain('2 by 2 matrix with 2 non-zero entries')
    expect(mixed).toContain('|0⟩⟨0| 0.50')
    expect(mixed).toContain('|1⟩⟨1| 0.50')
    expect(mixed).not.toContain('|0⟩⟨1|')
    expect(describeMatrix([])).toBe('Empty matrix.')
    expect(describeMatrix([[z(0)]])).toContain('all entries zero')
  })
})
