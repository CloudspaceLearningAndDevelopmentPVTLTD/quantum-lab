import { describe, expect, it } from 'vitest'
import { fockState, phaseSpaceGrid, wignerOfState, type PhaseSpaceField } from '@/lib/quantum/phasespace'
import { assertFiniteCoordinates, createStubContext } from './canvasStub'
import {
  buildSurfaceMesh,
  contourSet,
  contoursToWorld,
  divergingColor,
  drawHeatmap,
  fillSurfaceMesh,
  floorTextureData,
  gridToWorld,
  heatmapLayout,
  marchingSquares,
  parseHex,
  rgbCss,
  surfaceGridLines,
  type DivergingPalette,
  type HeatmapColors,
} from './wignerSurfaceLayout'

const PALETTE: DivergingPalette = {
  negative: [0, 0, 1],
  zero: [0.5, 0.5, 0.5],
  positive: [1, 0, 0],
}

/** A synthetic field from a closed form — nothing here depends on phasespace.ts. */
function fieldFrom(n: number, extent: number, f: (x: number, p: number) => number): PhaseSpaceField {
  const g = phaseSpaceGrid(n, extent)
  const values = new Float64Array(n * n)
  for (let ip = 0; ip < n; ip++) for (let ix = 0; ix < n; ix++) values[ip * n + ix] = f(g.xs[ix], g.ps[ip])
  return { ...g, values }
}

describe('colour', () => {
  it('parses hex and formats rgb', () => {
    expect(parseHex('#ff0080')).toEqual([1, 0, 128 / 255])
    expect(parseHex('rgba(1,2,3,0.5)')).toBeNull()
    expect(rgbCss([1, 0, 0.5])).toBe('rgb(255, 0, 128)')
    expect(rgbCss([2, -1, 0.5])).toBe('rgb(255, 0, 128)')
  })

  it('diverging map: zero is neutral, ±1 are the endpoints, sign picks the branch', () => {
    expect(divergingColor(0, PALETTE)).toEqual(PALETTE.zero)
    expect(divergingColor(1, PALETTE)).toEqual(PALETTE.positive)
    expect(divergingColor(-1, PALETTE)).toEqual(PALETTE.negative)
    expect(divergingColor(4, PALETTE)).toEqual(PALETTE.positive) // clamped
    // Square-root ramp: t = 0.25 → halfway.
    expect(divergingColor(0.25, PALETTE)).toEqual([0.75, 0.25, 0.25])
    expect(divergingColor(-0.25, PALETTE)).toEqual([0.25, 0.25, 0.75])
    expect(divergingColor(NaN, PALETTE)).toEqual(PALETTE.zero)
    // A small negative is never coloured like a small positive.
    const neg = divergingColor(-0.05, PALETTE)
    const pos = divergingColor(0.05, PALETTE)
    expect(neg[2]).toBeGreaterThan(neg[0])
    expect(pos[0]).toBeGreaterThan(pos[2])
  })
})

describe('height-map mesh', () => {
  const field = fieldFrom(5, 2, (x, p) => x + 10 * p) // xs = −2..2 step 1
  const opts = { halfWidth: 3, heightScale: 1.5, scale: 20 }

  it('maps grid indices to a centred plate of the requested half-width', () => {
    expect(gridToWorld(0, 5, 3)).toBe(-3)
    expect(gridToWorld(4, 5, 3)).toBe(3)
    expect(gridToWorld(2, 5, 3)).toBe(0)
    expect(gridToWorld(0, 1, 3)).toBe(0) // degenerate grid: no throw, no NaN
  })

  it('lifts each vertex by value / scale × heightScale, x along X and p along Z', () => {
    const mesh = buildSurfaceMesh(field, opts, PALETTE)
    expect(mesh.positions.length).toBe(25 * 3)
    expect(mesh.indices.length).toBe(16 * 6)
    // Vertex (ix = 3, ip = 1): x = 1, p = −1, value = −9 → y = −9/20 × 1.5.
    const i = 1 * 5 + 3
    expect(mesh.positions[i * 3]).toBeCloseTo(gridToWorld(3, 5, 3), 6)
    expect(mesh.positions[i * 3 + 1]).toBeCloseTo((-9 / 20) * 1.5, 6)
    expect(mesh.positions[i * 3 + 2]).toBeCloseTo(gridToWorld(1, 5, 3), 6)
    // Colour follows the sign.
    expect(mesh.colors[i * 3 + 2]).toBeGreaterThan(mesh.colors[i * 3])
  })

  it('every triangle winds counter-clockwise seen from above', () => {
    const flat = fieldFrom(4, 1, () => 0)
    const mesh = buildSurfaceMesh(flat, opts, PALETTE)
    const P = mesh.positions
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
      const ux = P[b * 3] - P[a * 3]
      const uz = P[b * 3 + 2] - P[a * 3 + 2]
      const vx = P[c * 3] - P[a * 3]
      const vz = P[c * 3 + 2] - P[a * 3 + 2]
      // y component of (b − a) × (c − a) for vectors in the xz plane: uz·vx − ux·vz
      expect(uz * vx - ux * vz).toBeGreaterThan(0)
    }
  })

  it('guards: zero scale flattens, NaN values read as zero, tall spikes are capped', () => {
    const spiky = fieldFrom(3, 1, (x) => (x === 0 ? 1000 : NaN))
    const positions = new Float32Array(27)
    const colors = new Float32Array(27)
    fillSurfaceMesh(spiky, { halfWidth: 1, heightScale: 1, scale: 0 }, PALETTE, positions, colors)
    for (let i = 0; i < 9; i++) expect(positions[i * 3 + 1]).toBe(0)
    fillSurfaceMesh(spiky, { halfWidth: 1, heightScale: 1, scale: 1 }, PALETTE, positions, colors)
    for (let i = 0; i < 9; i++) expect(Number.isFinite(positions[i * 3 + 1])).toBe(true)
    expect(positions[4 * 3 + 1]).toBe(1.5) // centre, capped at 1.5 × heightScale
    expect(positions[0 * 3 + 1]).toBe(0) // NaN → 0
  })

  it('drapes sparse grid lines including both edges', () => {
    const mesh = buildSurfaceMesh(fieldFrom(9, 1, () => 0.2), { halfWidth: 1, heightScale: 1, scale: 1 }, PALETTE)
    const lines = surfaceGridLines(mesh.positions, 9, 4, 0.01)
    // rows 0, 4, 8 → 3 rows × (8 row segments + 8 column segments) × 2 points × 3 floats
    expect(lines.length).toBe(3 * 16 * 6)
    for (let i = 1; i < lines.length; i += 3) expect(lines[i]).toBeCloseTo(0.21, 5)
    expect(surfaceGridLines(new Float32Array(0), 1, 4, 0).length).toBe(0)
  })
})

describe('marching squares', () => {
  it('traces a circle of the right radius on a Gaussian', () => {
    const field = fieldFrom(129, 4, (x, p) => Math.exp(-(x * x + p * p)))
    const level = 0.3
    const r = Math.sqrt(-Math.log(level))
    const segs = marchingSquares(field, level)
    expect(segs.length).toBeGreaterThan(100)
    for (let i = 0; i < segs.length; i += 2) {
      expect(Math.hypot(segs[i], segs[i + 1])).toBeCloseTo(r, 1)
    }
    // Total length ≈ circumference.
    let len = 0
    for (let i = 0; i < segs.length; i += 4) len += Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1])
    expect(len).toBeCloseTo(2 * Math.PI * r, 1)
  })

  it('returns nothing when the level is never crossed, and handles a saddle', () => {
    const field = fieldFrom(33, 2, (x, p) => Math.exp(-(x * x + p * p)))
    expect(marchingSquares(field, 2).length).toBe(0)
    expect(marchingSquares(field, NaN).length).toBe(0)
    // xp has a saddle at the origin: the zero contour is the two axes.
    const saddle = fieldFrom(9, 1, (x, p) => x * p)
    const segs = marchingSquares(saddle, 0)
    expect(segs.length).toBeGreaterThan(0)
    for (let i = 0; i < segs.length; i += 2) {
      expect(Math.min(Math.abs(segs[i]), Math.abs(segs[i + 1]))).toBeLessThan(1e-6)
    }
  })

  it('splits a real Wigner function into positive and negative contour sets', () => {
    const W = wignerOfState(fockState(1, 16), phaseSpaceGrid(65, 4))
    const set = contourSet(W, 1 / Math.PI)
    expect(set.positive.length).toBeGreaterThan(0)
    expect(set.negative.length).toBeGreaterThan(0)
    // Negative contours all lie inside r = 1/√2, where W_1 < 0.
    for (let i = 0; i < set.negative.length; i += 2) {
      expect(Math.hypot(set.negative[i], set.negative[i + 1])).toBeLessThan(Math.SQRT1_2 + 1e-6)
    }
    expect(contourSet(W, 0).positive.length).toBe(0)
  })

  it('lifts contours onto the floor plane with the surface squeeze', () => {
    const field = fieldFrom(5, 2, () => 0)
    const world = contoursToWorld(Float32Array.from([2, -1, 0, 0.5]), field, 3, -0.7)
    const want = [3, -0.7, -1.5, 0, -0.7, 0.75]
    want.forEach((v, i) => expect(world[i]).toBeCloseTo(v, 5))
  })
})

describe('floor texture and 2-D fallback', () => {
  const colors: HeatmapColors = {
    palette: PALETTE,
    ink: '#eef2ff',
    inkMuted: '#7d8cb0',
    positiveLine: '#f5a193',
    negativeLine: '#8faae0',
  }

  it('encodes the field as opaque RGBA', () => {
    const field = fieldFrom(3, 1, (x) => x)
    const data = floorTextureData(field, 1, PALETTE)
    expect(data.length).toBe(36)
    for (let i = 3; i < 36; i += 4) expect(data[i]).toBe(255)
    expect(data[0 * 4]).toBe(0) // x = −1 → negative → blue
    expect(data[2 * 4]).toBe(255) // x = +1 → positive → red
  })

  it('refuses to lay out a plot in a zero-size canvas, and draws nothing', () => {
    expect(heatmapLayout(0, 0).ok).toBe(false)
    expect(heatmapLayout(40, 300).ok).toBe(false)
    expect(heatmapLayout(NaN, 300).ok).toBe(false)
    const field = fieldFrom(9, 2, (x, p) => Math.exp(-(x * x + p * p)))
    const stub = createStubContext()
    expect(() => drawHeatmap(stub.ctx, field, 0, 0, 1 / Math.PI, colors, 'W')).not.toThrow()
    expect(stub.count('fillRect')).toBe(0)
    expect(() => drawHeatmap(stub.ctx, field, 300, 0, 1 / Math.PI, colors, 'W')).not.toThrow()
    expect(stub.count('fillRect')).toBe(0)
  })

  it('paints one cell per grid node, contours, and finite coordinates only', () => {
    const W = wignerOfState(fockState(1, 16), phaseSpaceGrid(33, 4))
    const stub = createStubContext()
    drawHeatmap(stub.ctx, W, 480, 360, 1 / Math.PI, colors, 'W')
    expect(stub.count('fillRect')).toBe(33 * 33)
    expect(stub.count('stroke')).toBeGreaterThanOrEqual(3) // two contour sets + frame axes
    expect(stub.count('fillText')).toBe(3)
    assertFiniteCoordinates(stub.ops)
    expect(stub.styles).toContain(colors.negativeLine)
  })
})
