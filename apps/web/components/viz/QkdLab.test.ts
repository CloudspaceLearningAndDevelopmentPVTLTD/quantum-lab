import { describe, expect, it } from 'vitest'
import { renderBb84, renderE91, type Flyer } from './QkdLab'
import { STUB_COLORS, assertFiniteCoordinates, createStubContext } from './canvasStub'
import { advanceBb84, advanceE91, createBb84Run, createE91Run } from '@/lib/viz/qkd'
import { mulberry32 } from '@/lib/quantum'

/**
 * The QKD lab's render paths, driven through the recording stub: a render that
 * throws or hands the canvas a NaN produces a blank picture with no error, so
 * the physics being right in lib/viz/qkd.ts is not enough on its own. Each case
 * is checked at the empty, mid-run and finished states, and at a narrow width.
 */

const COLORS = { ...STUB_COLORS }

const flyers: Flyer[] = [
  { t: 0.2, basis: 0, intercepted: false, noisy: false, pair: false },
  { t: 0.7, basis: 1, intercepted: true, noisy: true, pair: false },
  { t: 0.9, basis: 0, intercepted: true, noisy: false, pair: true },
]

describe('QkdLab BB84 render', () => {
  it('draws an empty run, a partial run and a finished run without a bad colour or coordinate', () => {
    for (const sent of [0, 37, 1024]) {
      for (const w of [320, 760]) {
        const run = createBb84Run({ interceptFraction: 0.6, channelNoise: 0.05 }, 8)
        advanceBb84(run, mulberry32(sent + w), sent)
        const rec = createStubContext()
        renderBb84(rec.ctx, run, 1024, flyers, w, 480, COLORS)
        assertFiniteCoordinates(rec.ops)
        expect(rec.count('clearRect')).toBe(1)
        expect(rec.count('fillText')).toBeGreaterThan(8)
        if (sent > 0) expect(rec.count('fillRect') + rec.count('strokeRect')).toBeGreaterThan(0)
      }
    }
  })

  it('labels the abort line and, under attack, the expected QBER', () => {
    const run = createBb84Run({ interceptFraction: 1, channelNoise: 0 }, 8)
    advanceBb84(run, mulberry32(9), 400)
    const rec = createStubContext()
    renderBb84(rec.ctx, run, 400, [], 700, 480, COLORS)
    const texts = rec.ops.filter((o) => o.name === 'fillText').map((o) => String(o.args[0]))
    expect(texts).toContain('11% abort')
    expect(texts.some((t) => t.startsWith('expected 25.0%'))).toBe(true)
  })
})

describe('QkdLab E91 render', () => {
  it('draws an empty run, a partial run and a finished run without a bad colour or coordinate', () => {
    for (const sent of [0, 51, 1024]) {
      for (const w of [320, 760]) {
        const run = createE91Run({ interceptFraction: 0.5 }, 8)
        advanceE91(run, mulberry32(sent + w), sent)
        const rec = createStubContext()
        renderE91(rec.ctx, run, 1024, flyers, w, 480, COLORS)
        assertFiniteCoordinates(rec.ops)
        expect(rec.count('clearRect')).toBe(1)
        expect(rec.count('fillText')).toBeGreaterThan(8)
      }
    }
  })

  it('draws both bounds and the expected |S| for the current attack', () => {
    const run = createE91Run({ interceptFraction: 1 }, 8)
    advanceE91(run, mulberry32(4), 600)
    const rec = createStubContext()
    renderE91(rec.ctx, run, 600, [], 700, 480, COLORS)
    const texts = rec.ops.filter((o) => o.name === 'fillText').map((o) => String(o.args[0]))
    expect(texts).toContain('Bell bound 2')
    expect(texts).toContain('2√2 = 2.828')
    expect(texts).toContain('expected 1.41')
  })
})
