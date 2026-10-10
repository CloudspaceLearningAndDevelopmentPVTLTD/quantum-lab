import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { paramsForMedium, mediumById } from '@/lib/quantum/laser'
import { describePhotons, describePopulations, sampleCurves, PUMP_MAX } from './LaserCharts'
import { describeCavity } from './LaserLab'

/**
 * Render smoke test for /visualizations/lasers plus the two canvas components,
 * in the same spirit as opticsPages.test.ts: a bad import, a control given the
 * wrong prop shape or a conditional hook shows up here, where the physics
 * tests (lib/quantum/laser.test.ts, lib/viz/laserCartoon.test.ts) would not
 * notice. `renderToStaticMarkup` runs no effects, so nothing on canvas is
 * exercised — the curve sampler and the accessible descriptions are called
 * directly instead, because they are what a screen reader gets.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/visualizations/lasers' }))

describe('the lasers page renders', () => {
  it('mounts with its controls, both canvases and the honesty section', async () => {
    const Page = (await import('@/app/visualizations/lasers/page')).default
    const html = renderToStaticMarkup(createElement(Page))
    expect(html).toContain('How a Laser Works')
    expect(html).toContain('Gain medium')
    expect(html).toContain('Level scheme')
    expect(html).toContain('Pump rate')
    expect(html).toContain('Cavity photon lifetime')
    expect((html.match(/<canvas/g) ?? []).length).toBe(3)
    expect(html).toContain('This cavity, in numbers')
    expect(html).toContain('Why two levels cannot lase')
    expect(html).toContain('isn&#x27;t real here')
    // The derivation chain is printed, not just asserted.
    expect(html).toContain('8πhν³')
  })

  it('mounts each lab component on its own', async () => {
    const LaserLab = (await import('./LaserLab')).default
    const LaserCharts = (await import('./LaserCharts')).default
    expect(
      renderToStaticMarkup(
        createElement(LaserLab, { scheme: 'three', pumpRatio: 1.5, running: true, resetKey: 0 })
      )
    ).toContain('<canvas')
    expect(
      renderToStaticMarkup(
        createElement(LaserCharts, {
          params: paramsForMedium(mediumById('ruby'), 10e-9),
          scheme: 'three',
          pumpRatio: 1.5,
        })
      )
    ).toContain('<canvas')
  })
})

describe('chart sampling and descriptions', () => {
  const ruby = paramsForMedium(mediumById('ruby'), 10e-9)

  it('samples monotone, bounded curves with the take-off past threshold', () => {
    const cv = sampleCurves(ruby, 'three')
    expect(cv.x[0]).toBe(0)
    expect(cv.x[cv.x.length - 1]).toBe(PUMP_MAX)
    for (let i = 0; i < cv.x.length; i++) {
      expect(cv.N1[i] + cv.N2[i] + cv.N3[i]).toBeCloseTo(1, 9)
      if (i > 0) expect(cv.n[i]).toBeGreaterThanOrEqual(cv.n[i - 1])
    }
    expect(cv.Wi).toBeCloseTo(1, 3)
    expect(cv.Wth).toBeGreaterThan(cv.Wi)
    expect(cv.Wth).toBeLessThan(1.1)
    expect(cv.nFloor).toBeLessThan(1e4)
    expect(cv.nMax).toBeGreaterThan(1e13)
  })

  it('two-level curves never cross and hold only a spontaneous floor', () => {
    const cv = sampleCurves(ruby, 'two')
    for (let i = 0; i < cv.x.length; i++) expect(cv.N2[i]).toBeLessThanOrEqual(cv.N1[i])
    expect(cv.nMax).toBeLessThan(1e4)
    expect(cv.Wth).toBe(Infinity)
  })

  it('describes each figure with the current numbers in it', () => {
    const cv = sampleCurves(ruby, 'three')
    expect(describePopulations(cv, 2, 'three')).toMatch(/Inversion begins at 1\.00/)
    expect(describePopulations(cv, 2, 'three')).toMatch(/pump band/)
    expect(describePhotons(cv, 2, 'three')).toMatch(/threshold at 1\.0/)
    expect(describePhotons(sampleCurves(ruby, 'two'), 3, 'two')).toMatch(/flat line/)
    expect(describePhotons(sampleCurves({ ...ruby, tauC: 1e-11 }, 'three'), 3, 'three')).toMatch(/too lossy/)
    expect(describeCavity('two', 1.25)).toMatch(/knocking excited ones back down/)
    expect(describeCavity('three', 1.25)).toMatch(/1\.25 times/)
  })
})
