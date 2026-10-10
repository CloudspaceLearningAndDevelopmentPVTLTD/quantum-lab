import { describe, expect, it } from 'vitest'
import { draw, type DrawState } from './SpinPrecessionLab'
import { assertFiniteCoordinates, createStubContext, STUB_COLORS } from './canvasStub'
import { labField, precess, probabilityOfOne, type FieldConfig, type Vec3 } from '@/lib/viz/spinPrecession'

/**
 * The render path, exercised in node against a recording stub. This cannot
 * check that the picture is beautiful; it checks the two things that fail
 * silently in a browser — an invalid colour string (which keeps the previous
 * fill and paints the wrong thing) and a NaN coordinate (which abandons the
 * rest of the path). Both produce a blank or half-drawn canvas with no error
 * anywhere a user or a log would see it.
 */

const CFG: FieldConfig = { b0: 1, tilt: 0, b1: 0.12, driveOmega: 1, drivePhase: Math.PI }

function scene(over: Partial<DrawState> = {}): DrawState {
  const trail: Vec3[] = []
  let v: Vec3 = [0, 0, 1]
  for (let i = 0; i < 40; i++) {
    v = precess(v, [0.3, 0, 1], 1, 0.08)
    trail.push(v)
  }
  const trace = Array.from({ length: 60 }, (_, i) => ({
    t: i * 0.1,
    p: probabilityOfOne(precess([0, 0, 1], [0.5, 0, 1], 1, i * 0.1)),
  }))
  return {
    v,
    field: labField(1.3, CFG),
    trail,
    trace,
    cfg: CFG,
    frame: 'lab',
    traceFromStart: true,
    showCone: true,
    simTime: 1.3,
    driveTime: 1.3,
    reduceMotion: false,
    ...over,
  }
}

describe('SpinPrecessionLab render path', () => {
  it('draws without throwing and puts real geometry on the canvas', () => {
    const stub = createStubContext()
    draw(stub.ctx, 820, 420, STUB_COLORS, scene())
    assertFiniteCoordinates(stub.ops)
    expect(stub.count('clearRect')).toBe(1)
    expect(stub.count('stroke')).toBeGreaterThan(5)
    expect(stub.count('fillText')).toBeGreaterThan(3)
    expect(stub.styles.length).toBeGreaterThan(5)
  })

  it('survives the degenerate cases: no field, no trail, no trace', () => {
    for (const s of [
      scene({ field: [0, 0, 0], trail: [], trace: [] }),
      scene({ trace: [{ t: 0, p: 0 }] }),
      scene({ v: [0, 0, -1], field: [0, 0, -1] }),
      scene({ showCone: false }),
      scene({ frame: 'rotating', cfg: { ...CFG, b1: 0 } }),
    ]) {
      const stub = createStubContext()
      expect(() => draw(stub.ctx, 700, 400, STUB_COLORS, s)).not.toThrow()
      assertFiniteCoordinates(stub.ops)
    }
  })

  it('drops the trace panel rather than squeezing it on a narrow canvas', () => {
    const wide = createStubContext()
    draw(wide.ctx, 900, 420, STUB_COLORS, scene())
    const narrow = createStubContext()
    draw(narrow.ctx, 380, 420, STUB_COLORS, scene())
    assertFiniteCoordinates(narrow.ops)
    expect(narrow.ops.length).toBeLessThan(wide.ops.length)
  })

  it('handles tiny and very large canvases without producing NaN geometry', () => {
    for (const [w, h] of [
      [40, 40],
      [1, 1],
      [2000, 1200],
    ]) {
      const stub = createStubContext()
      expect(() => draw(stub.ctx, w, h, STUB_COLORS, scene())).not.toThrow()
      assertFiniteCoordinates(stub.ops)
    }
  })

  it('draws the closed-form overlay only when the closed form applies', () => {
    const withOverlay = createStubContext()
    draw(withOverlay.ctx, 900, 420, STUB_COLORS, scene())
    const withoutOverlay = createStubContext()
    draw(withoutOverlay.ctx, 900, 420, STUB_COLORS, scene({ traceFromStart: false }))
    expect(withOverlay.ops.length).toBeGreaterThan(withoutOverlay.ops.length)
  })
})
