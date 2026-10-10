import { describe, expect, it } from 'vitest'
import { drawMajoranaFallback, type FallbackFrame } from './majoranaFallback'
import { assertFiniteCoordinates, createStubContext, STUB_COLORS } from './canvasStub'
import { ghzState, majoranaStars, oneAxisTwist, spinCoherentState } from '@/lib/quantum/majorana'
import { appendTrails, convexHull, type Trail } from '@/lib/viz/majoranaGeometry'

/**
 * The no-WebGL path, exercised in node. It checks the two silent canvas
 * failures (invalid colour strings, NaN coordinates) and the wave-1 lesson:
 * a 0 × 0 first paint must draw nothing, not throw.
 */

function frame(over: Partial<FallbackFrame> = {}): FallbackFrame {
  const stars = majoranaStars(ghzState(4))
  let trails: Trail[] = []
  const eq = spinCoherentState(4, Math.PI / 2, 0)
  for (let i = 0; i <= 12; i++) trails = appendTrails(trails, majoranaStars(oneAxisTwist(eq, i * 0.05)))
  return {
    stars,
    trails,
    hull: convexHull(stars),
    meanSpin: { x: 0.3, y: 0.1, z: 0.6 },
    yaw: 0.7,
    pitch: 0.4,
    ...over,
  }
}

describe('drawMajoranaFallback', () => {
  it('draws the sphere, the stars, the hull and the trails with valid colours and finite geometry', () => {
    const stub = createStubContext()
    drawMajoranaFallback(stub.ctx, 800, 440, STUB_COLORS, frame())
    assertFiniteCoordinates(stub.ops)
    expect(stub.count('clearRect')).toBe(1)
    // Silhouette + 4 stars + ⟨J⟩ tip = at least 6 arcs.
    expect(stub.count('arc')).toBeGreaterThanOrEqual(6)
    expect(stub.count('fillText')).toBe(3)
    // Hull edges (4 for a square) + trails + rings all stroke.
    expect(stub.count('stroke')).toBeGreaterThan(10)
  })

  it('draws nothing on a 0-width or 0-height canvas, and does not throw', () => {
    for (const [w, h] of [
      [0, 0],
      [0, 400],
      [400, 0],
      [NaN, 400],
    ]) {
      const stub = createStubContext()
      expect(() => drawMajoranaFallback(stub.ctx, w, h, STUB_COLORS, frame())).not.toThrow()
      expect(stub.count('arc')).toBe(0)
    }
  })

  it('survives degenerate frames: one star, coincident stars, no trails, no arrow', () => {
    const one = majoranaStars([{ re: 1, im: 0 }, { re: 0, im: 0 }])
    const coherent = majoranaStars(spinCoherentState(6, 1, 1))
    for (const f of [
      frame({ stars: one, hull: convexHull(one), trails: [], meanSpin: null }),
      frame({ stars: coherent, hull: convexHull(coherent), trails: coherent.map((s) => [s]) }),
      frame({ stars: [], hull: convexHull([]), trails: [] }),
      frame({ pitch: Math.PI / 2 - 1e-9, yaw: 123.4 }),
    ]) {
      const stub = createStubContext()
      expect(() => drawMajoranaFallback(stub.ctx, 320, 320, STUB_COLORS, f)).not.toThrow()
      assertFiniteCoordinates(stub.ops)
    }
  })

  it('draws tiny and huge canvases without NaN geometry', () => {
    for (const [w, h] of [
      [24, 24],
      [1, 900],
      [4000, 3000],
    ]) {
      const stub = createStubContext()
      drawMajoranaFallback(stub.ctx, w, h, STUB_COLORS, frame())
      assertFiniteCoordinates(stub.ops)
    }
  })
})
