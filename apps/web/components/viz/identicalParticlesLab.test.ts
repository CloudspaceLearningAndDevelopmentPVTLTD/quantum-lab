import { describe, expect, it } from 'vitest'
import { layoutFor, render, type HeatTarget, type LabProps } from './IdenticalParticlesLab'
import { assertFiniteCoordinates, createStubContext, STUB_COLORS } from './canvasStub'
import { twoBodyAmplitude, wellOrbitals } from '@/lib/quantum/identicalParticles'

/**
 * The heat map is painted through an ImageData at native resolution and blitted, so the
 * two ways it can be wrong are silent: a transposed image (x₁ up instead of across) or a
 * colour table that maps zero to something other than the background. Both are checked
 * here by reading the fake ImageData back.
 */

type Pixels = { data: Uint8ClampedArray; width: number; height: number }

function fakeHeat(): { target: HeatTarget; last: () => Pixels | null } {
  let last: Pixels | null = null
  const target: HeatTarget = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => {
        const img = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }
        return img as unknown as ImageData
      },
      putImageData: (image: ImageData) => {
        last = image as unknown as Pixels
      },
    }),
  }
  return { target, last: () => last }
}

function stubWithDrawImage() {
  const stub = createStubContext()
  const ctx = stub.ctx as unknown as Record<string, unknown>
  ctx.drawImage = (...args: unknown[]) => stub.ops.push({ name: 'drawImage', args })
  return stub
}

const { grid, states } = wellOrbitals(64, 1, 3)

/** Strict local maxima after collapsing runs of equal values (the colour table quantises). */
function countPeaks(profile: number[]): number {
  const runs = profile.filter((v, i) => i === 0 || v !== profile[i - 1])
  let peaks = 0
  for (let i = 1; i < runs.length - 1; i++) if (runs[i] > runs[i - 1] && runs[i] > runs[i + 1]) peaks++
  return peaks
}

function propsFor(statistics: LabProps['statistics'], a = 1, b = 2, samples: Array<[number, number]> = []): LabProps {
  return {
    grid,
    psi: twoBodyAmplitude(states[a - 1].psi, states[b - 1].psi, statistics, a === b),
    reference: twoBodyAmplitude(states[a - 1].psi, states[b - 1].psi, 'distinguishable', a === b),
    statistics,
    orbitalA: a,
    orbitalB: b,
    samples,
    showReference: true,
  }
}

describe('layoutFor', () => {
  it('puts the panels side by side on wide canvases and stacks them on narrow ones', () => {
    const wide = layoutFor(900)
    expect(wide.sep.x).toBeGreaterThan(wide.heat.x + wide.heat.side)
    expect(wide.sep.x + wide.sep.w).toBeLessThanOrEqual(wide.w)
    const narrow = layoutFor(360)
    expect(narrow.sep.y).toBeGreaterThan(narrow.heat.y + narrow.heat.side)
    expect(narrow.sep.y + narrow.sep.h).toBeLessThanOrEqual(narrow.h)
    expect(narrow.heat.x + narrow.heat.side).toBeLessThanOrEqual(narrow.w)
  })
})

describe('IdenticalParticlesLab render path', () => {
  const surface = [0x14, 0x1a, 0x2c] // STUB_COLORS.surface2

  it('draws every statistics without throwing, with finite coordinates', () => {
    for (const stats of ['boson', 'fermion', 'distinguishable'] as const) {
      const stub = stubWithDrawImage()
      const heat = fakeHeat()
      render(stub.ctx, heat.target, propsFor(stats), layoutFor(820), STUB_COLORS)
      assertFiniteCoordinates(stub.ops)
      expect(stub.count('drawImage')).toBe(1)
      expect(stub.count('fillText')).toBeGreaterThan(6)
      expect(heat.last()?.width).toBe(grid.n)
    }
  })

  it('paints the fermion diagonal as pure background and the boson diagonal as the brightest row', () => {
    const n = grid.n
    const pixel = (px: Pixels, i: number, j: number) => {
      const o = ((n - 1 - j) * n + i) * 4
      return [px.data[o], px.data[o + 1], px.data[o + 2]]
    }
    const fermion = fakeHeat()
    render(stubWithDrawImage().ctx, fermion.target, propsFor('fermion'), layoutFor(820), STUB_COLORS)
    const fp = fermion.last()!
    for (let i = 0; i < n; i++) expect(pixel(fp, i, i)).toEqual(surface)

    const boson = fakeHeat()
    render(stubWithDrawImage().ctx, boson.target, propsFor('boson'), layoutFor(820), STUB_COLORS)
    const bp = boson.last()!
    // At the density peak, the pixel is the top of the ramp (amberText), not the background.
    let brightest = 0
    let where: [number, number] = [0, 0]
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const [r, g, b] = pixel(bp, i, j)
        if (r + g + b > brightest) {
          brightest = r + g + b
          where = [i, j]
        }
      }
    }
    // Boson peak lies on the diagonal: |ψ₊|² is maximal where φ₁φ₂ is, with x₁ = x₂.
    expect(Math.abs(where[0] - where[1])).toBeLessThanOrEqual(1)
  })

  it('image orientation: x₁ runs across, x₂ runs up', () => {
    // Orbitals 1 and 3, distinguishable: density ∝ sin²(πx₁)·sin²(3πx₂). Along the
    // bottom image row (x₂ smallest) the density is tiny; along the middle column
    // (x₁ = L/2) it has three bumps in x₂. Check the column profile has three maxima.
    const heat = fakeHeat()
    render(stubWithDrawImage().ctx, heat.target, propsFor('distinguishable', 1, 3), layoutFor(820), STUB_COLORS)
    const px = heat.last()!
    const n = grid.n
    const mid = Math.floor(n / 2)
    const column: number[] = []
    for (let j = 0; j < n; j++) {
      const o = ((n - 1 - j) * n + mid) * 4
      column.push(px.data[o] + px.data[o + 1] + px.data[o + 2])
    }
    expect(countPeaks(column)).toBe(3)
    const row: number[] = []
    for (let i = 0; i < n; i++) {
      const o = ((n - 1 - mid) * n + i) * 4
      row.push(px.data[o] + px.data[o + 1] + px.data[o + 2])
    }
    expect(countPeaks(row)).toBe(1)
  })

  it('draws the no-state placeholder for two fermions in one orbital and still draws the axes', () => {
    const stub = stubWithDrawImage()
    const heat = fakeHeat()
    const props = propsFor('fermion', 2, 2)
    expect(props.psi).toBeNull()
    render(stub.ctx, heat.target, props, layoutFor(500), STUB_COLORS)
    assertFiniteCoordinates(stub.ops)
    expect(stub.count('drawImage')).toBe(0)
    const texts = stub.ops.filter((o) => o.name === 'fillText').map((o) => String(o.args[0]))
    expect(texts).toContain('No such state')
    expect(texts).toContain('x₁ = x₂')
  })

  it('plots sampled pairs inside the heat-map square', () => {
    const stub = stubWithDrawImage()
    const samples: Array<[number, number]> = [
      [0.1, 0.9],
      [0.5, 0.5],
      [0.95, 0.05],
    ]
    const layout = layoutFor(820)
    render(stub.ctx, fakeHeat().target, propsFor('boson', 1, 2, samples), layout, STUB_COLORS)
    const arcs = stub.ops.filter((o) => o.name === 'arc')
    expect(arcs).toHaveLength(3)
    for (const arc of arcs) {
      const [x, y] = arc.args as number[]
      expect(x).toBeGreaterThanOrEqual(layout.heat.x)
      expect(x).toBeLessThanOrEqual(layout.heat.x + layout.heat.side)
      expect(y).toBeGreaterThanOrEqual(layout.heat.y)
      expect(y).toBeLessThanOrEqual(layout.heat.y + layout.heat.side)
    }
    // (0.1, 0.9) is top-left: small x, small canvas y.
    const [x0, y0] = arcs[0].args as number[]
    const [x2, y2] = arcs[2].args as number[]
    expect(x0).toBeLessThan(x2)
    expect(y0).toBeLessThan(y2)
  })
})
