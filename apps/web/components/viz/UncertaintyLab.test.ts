import { describe, expect, it } from 'vitest'
import { draw } from './UncertaintyLab'
import { assertFiniteCoordinates, createStubContext, STUB_COLORS } from './canvasStub'
import {
  analyze,
  freeEvolve,
  makeGrid,
  makePacket,
  type PacketShape,
} from '@/lib/viz/uncertainty'

/** See the note in SpinPrecessionLab.test.ts on why a render path is worth testing. */

const GRID = makeGrid(512, 40)

function sceneFor(shape: PacketShape, width: number, k0 = 0, chirp = 0) {
  return analyze(GRID, makePacket(GRID, { shape, width, k0, chirp }))
}

describe('UncertaintyLab render path', () => {
  it('draws both panels and the bound meter without throwing', () => {
    const stub = createStubContext()
    draw(stub.ctx, 780, 440, STUB_COLORS, sceneFor('gaussian', 1.2), 0, false)
    assertFiniteCoordinates(stub.ops)
    expect(stub.count('clearRect')).toBe(1)
    // Two filled densities, two σ bands, the meter track and its fill.
    expect(stub.count('fill') + stub.count('fillRect')).toBeGreaterThan(4)
    expect(stub.count('fillText')).toBeGreaterThan(6)
  })

  it('handles every shape, including the ones with hard zeros', () => {
    const shapes: PacketShape[] = [
      'gaussian',
      'tophat',
      'triangle',
      'twoBumps',
      'hermite1',
      'hermite2',
    ]
    for (const shape of shapes) {
      for (const width of [0.3, 1, 3.5]) {
        const stub = createStubContext()
        expect(() => draw(stub.ctx, 700, 440, STUB_COLORS, sceneFor(shape, width), 0, false)).not.toThrow()
        assertFiniteCoordinates(stub.ops)
      }
    }
  })

  it('handles a boosted, chirped, and freely evolved packet', () => {
    const psi = freeEvolve(GRID, makePacket(GRID, { shape: 'gaussian', width: 1, k0: 4, chirp: 0.8 }), 2.5)
    const stub = createStubContext()
    expect(() => draw(stub.ctx, 700, 440, STUB_COLORS, analyze(GRID, psi), 2.5, false)).not.toThrow()
    assertFiniteCoordinates(stub.ops)
  })

  it('draws the same picture under reduced motion, minus the phase trace', () => {
    const full = createStubContext()
    draw(full.ctx, 700, 440, STUB_COLORS, sceneFor('gaussian', 1.2), 0, false)
    const reduced = createStubContext()
    draw(reduced.ctx, 700, 440, STUB_COLORS, sceneFor('gaussian', 1.2), 0, true)
    assertFiniteCoordinates(reduced.ops)
    expect(reduced.ops.length).toBeLessThan(full.ops.length)
    expect(reduced.count('fillText')).toBe(full.count('fillText'))
  })

  it('survives degenerate canvas sizes', () => {
    for (const [w, h] of [
      [1, 1],
      [60, 40],
      [1800, 1000],
    ]) {
      const stub = createStubContext()
      expect(() => draw(stub.ctx, w, h, STUB_COLORS, sceneFor('gaussian', 1), 0, false)).not.toThrow()
      assertFiniteCoordinates(stub.ops)
    }
  })

  it('the meter never renders a fill wider than its track, however far above the floor', () => {
    // A top hat is several times the floor; the meter saturates rather than
    // painting off the end of the canvas.
    const stub = createStubContext()
    draw(stub.ctx, 700, 440, STUB_COLORS, sceneFor('tophat', 0.3), 0, false)
    assertFiniteCoordinates(stub.ops)
    for (const op of stub.ops) {
      if (op.name !== 'fillRect') continue
      const [x, , w] = op.args as number[]
      expect(x + w).toBeLessThanOrEqual(700 + 1)
    }
  })
})
