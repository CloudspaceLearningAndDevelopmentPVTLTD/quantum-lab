import { describe, expect, it } from 'vitest'
import { draw as drawAlpha } from './AlphaDecayLab'
import {
  draw as drawStm,
  formatCurrent,
  stmCurrentNa,
  surfaceHeight,
  STM_CORRUGATION_A,
  STM_D_REF_A,
  STM_I_REF_NA,
} from './StmLab'
import { assertFiniteCoordinates, createStubContext, STUB_COLORS } from './canvasStub'
import { NUCLIDES, buildDisplayModel, predictDecay, stmCurrentRatio } from '@/lib/quantum/alphaDecay'

/**
 * See the note in SpinPrecessionLab.test.ts on why a render path is worth testing: a canvas
 * that throws is a blank rectangle nobody is told about.
 */

describe('AlphaDecayLab render path', () => {
  it('draws the barrier, the Q line and the wavefunction for every nuclide', () => {
    for (const n of NUCLIDES) {
      const g = predictDecay(n)
      const model = buildDisplayModel(g.R / g.b, g.G)
      const stub = createStubContext()
      drawAlpha(
        stub.ctx,
        { Zd: g.Zd, R: g.R, b: g.b, q: n.q, wellDepth: 35, model },
        760,
        400,
        STUB_COLORS
      )
      assertFiniteCoordinates(stub.ops)
      expect(stub.count('clearRect')).toBe(1)
      // Barrier fill, interior fill; barrier stroke, Q line, turning point, ψ.
      expect(stub.count('fill')).toBeGreaterThanOrEqual(2)
      expect(stub.count('stroke')).toBeGreaterThanOrEqual(4)
      // The wavefunction has one lineTo per grid point.
      expect(stub.count('lineTo')).toBeGreaterThan(model.grid.n)
      expect(stub.count('fillText')).toBeGreaterThan(6)
    }
  })

  it('draws without a model (the frame before the first build lands)', () => {
    const g = predictDecay(NUCLIDES[0])
    const stub = createStubContext()
    expect(() =>
      drawAlpha(stub.ctx, { Zd: g.Zd, R: g.R, b: g.b, q: 4.27, wellDepth: 35, model: null }, 400, 300, STUB_COLORS)
    ).not.toThrow()
    assertFiniteCoordinates(stub.ops)
  })

  it('copes with a what-if Q near the barrier top and a tiny radius', () => {
    const g = predictDecay({ Z: 84, A: 212, q: 12, r0: 1 })
    const model = buildDisplayModel(g.R / g.b, g.G)
    const stub = createStubContext()
    expect(() =>
      drawAlpha(stub.ctx, { Zd: g.Zd, R: g.R, b: g.b, q: 12, wellDepth: 35, model }, 320, 400, STUB_COLORS)
    ).not.toThrow()
    assertFiniteCoordinates(stub.ops)
  })
})

describe('StmLab', () => {
  it('the surface is corrugated by exactly the stated amount, atoms on top', () => {
    expect(surfaceHeight(0) - surfaceHeight(1.25)).toBeCloseTo(STM_CORRUGATION_A, 12)
    expect(surfaceHeight(2.5)).toBeCloseTo(surfaceHeight(0), 12)
  })

  it('reads the set-point current at the reference gap and a decade less per ~1.06 Å', () => {
    expect(stmCurrentNa(1.25, STM_D_REF_A + surfaceHeight(1.25), 4.5)).toBeCloseTo(STM_I_REF_NA, 9)
    const here = stmCurrentNa(0, 5, 4.5)
    const up = stmCurrentNa(0, 6, 4.5)
    expect(here / up).toBeCloseTo(stmCurrentRatio(1, 4.5), 9)
    // 0.3 Å of corrugation is a factor of e^{2κ·0.3} ≈ 1.9 in current at constant height.
    expect(stmCurrentNa(0, 5, 4.5) / stmCurrentNa(1.25, 5, 4.5)).toBeCloseTo(Math.exp(2 * 1.0866 * 0.3), 2)
  })

  it('formats currents in the unit an experimentalist would use', () => {
    expect(formatCurrent(1)).toBe('1.00 nA')
    expect(formatCurrent(0.0123)).toBe('12.3 pA')
    expect(formatCurrent(2500)).toBe('2.50 μA')
    expect(formatCurrent(3e-6)).toBe('3.00 fA')
  })

  it('draws the surface, tip, meter and scan strip across the whole tip range', () => {
    for (const z of [0.5, 2, 5, 10]) {
      for (const x of [0, 6.25, 20]) {
        for (const phi of [2, 4.5, 6]) {
          const stub = createStubContext()
          expect(() => drawStm(stub.ctx, { x, z, workFunctionEv: phi }, 720, 320, STUB_COLORS)).not.toThrow()
          assertFiniteCoordinates(stub.ops)
          expect(stub.count('clearRect')).toBe(1)
          expect(stub.count('arc')).toBeGreaterThan(8) // atoms + apex + trace marker
          expect(stub.count('fillRect')).toBeGreaterThanOrEqual(3) // cloud, meter track, meter fill
          expect(stub.count('fillText')).toBeGreaterThan(8)
        }
      }
    }
  })
})
