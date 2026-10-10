import { describe, expect, it } from 'vitest'
import { WP_GRID, WP_N } from './WavePacketsLab'
import {
  centeredGrid,
  gaussianPacket,
  norm,
  SplitStepPropagator,
  zeroPotential,
} from '@/lib/quantum/schrodinger'

/**
 * The split-step propagator throws on a grid whose size is not a power of two, and the
 * three pages in this batch each pin their grid as a module constant. A wrong constant
 * would be a blank canvas and a console error at run time, in a component no node test
 * can mount — so the constants themselves are checked here instead.
 *
 * The oscillator page's grid, centeredGrid(1024, 12), is restated rather than imported:
 * that page is a .tsx route module and importing a route into a unit test would drag in
 * next/navigation for nothing.
 */
const HARMONIC_GRID = centeredGrid(1024, 12)

describe('visualization grids are FFT-safe', () => {
  it('sizes the scattering grid to a power of two', () => {
    expect(WP_N & (WP_N - 1)).toBe(0)
    expect(WP_GRID.n).toBe(WP_N)
  })

  it('builds a propagator on the scattering grid and conserves norm on it', () => {
    const psi = gaussianPacket(WP_GRID, { x0: -30, k0: 1, sigma: 3 })
    const prop = new SplitStepPropagator(WP_GRID, zeroPotential(WP_GRID), { dt: 0.02 })
    prop.advance(psi, 200)
    expect(Math.abs(norm(psi, WP_GRID.dx) - 1)).toBeLessThan(1e-12)
  })

  it('builds a propagator on the oscillator grid', () => {
    expect(HARMONIC_GRID.n & (HARMONIC_GRID.n - 1)).toBe(0)
    expect(
      () => new SplitStepPropagator(HARMONIC_GRID, zeroPotential(HARMONIC_GRID), { dt: 0.004 })
    ).not.toThrow()
  })

  it('rejects a grid that is not a power of two, loudly', () => {
    const odd = centeredGrid(1000, 10)
    expect(() => new SplitStepPropagator(odd, zeroPotential(odd), { dt: 0.01 })).toThrow(
      /power-of-two/
    )
  })
})
