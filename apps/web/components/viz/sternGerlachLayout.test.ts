import { describe, expect, it } from 'vitest'
import {
  APPARATUS_HEIGHT,
  buildLayout,
  buildRoute,
  pointAt,
  portY,
  stopX,
  describeBench,
} from './SternGerlachLab'
import {
  DEG,
  X_AXIS,
  Z_AXIS,
  runChain,
  type Analyser,
  type ChainShot,
  type Outcome,
} from '@/lib/viz/sternGerlach'
import { mulberry32 } from '@/lib/quantum'

/**
 * The bench drawing is generated geometry, not a hand-placed diagram, so the
 * failure mode is a beam or a counter sliding off the canvas at some
 * combination of width, chain length and port choices. These checks walk every
 * combination the UI can produce.
 */

const chainsToCheck = (): Analyser[][] => {
  const out: Analyser[][] = []
  const angles = [0, 45, 90, 135, 180]
  for (const n of [2, 3]) {
    for (const p0 of [1, -1] as Outcome[]) {
      for (const p1 of [1, -1] as Outcome[]) {
        for (const a of angles) {
          out.push(
            Array.from({ length: n }, (_, i) => ({
              axis: { theta: (i === 1 ? a : i === 0 ? 0 : 0) * DEG, phi: 0 },
              port: (i === 0 ? p0 : p1) as Outcome,
            }))
          )
        }
      }
    }
  }
  return out
}

const WIDTHS = [320, 390, 520, 760, 1024]

describe('bench geometry stays on the canvas', () => {
  it('every analyser, port and detector sits inside the frame', () => {
    for (const w of WIDTHS) {
      for (const chain of chainsToCheck()) {
        const L = buildLayout(w, APPARATUS_HEIGHT, chain, null)
        expect(L.n).toBe(chain.length)
        for (let i = 0; i < L.n; i++) {
          // Boxes are inside horizontally and their full height fits.
          expect(L.boxX[i]).toBeGreaterThan(0)
          expect(L.boxX[i] + L.boxW).toBeLessThan(w)
          expect(L.boxY[i] - L.boxH / 2).toBeGreaterThanOrEqual(0)
          expect(L.boxY[i] + L.boxH / 2).toBeLessThanOrEqual(APPARATUS_HEIGHT)
          // Both output ports are inside vertically, with room for a label.
          for (const o of [1, -1] as Outcome[]) {
            const y = portY(L, i, o)
            expect(y).toBeGreaterThan(14)
            expect(y).toBeLessThan(APPARATUS_HEIGHT - 14)
          }
          // Stages march left to right and never overlap.
          expect(L.portX[i]).toBeGreaterThan(L.boxX[i] + L.boxW)
          if (i + 1 < L.n) expect(L.boxX[i + 1]).toBeGreaterThan(stopX(L, i))
        }
        // The detector boxes fit in whatever is left.
        expect(L.detX).toBeGreaterThan(L.portX[L.n - 1])
        expect(L.detX + 40).toBeLessThanOrEqual(w)
      }
    }
  })

  it('the beam that continues lines up with the next analyser', () => {
    for (const chain of chainsToCheck()) {
      const L = buildLayout(760, APPARATUS_HEIGHT, chain, null)
      for (let i = 0; i + 1 < L.n; i++) {
        expect(portY(L, i, chain[i].port)).toBeCloseTo(L.boxY[i + 1], 10)
      }
    }
  })

  it('exact intensities are a probability tree, not decoration', () => {
    const chain: Analyser[] = [
      { axis: Z_AXIS, port: 1 },
      { axis: X_AXIS, port: 1 },
      { axis: Z_AXIS, port: 1 },
    ]
    const L = buildLayout(760, APPARATUS_HEIGHT, chain, null)
    for (const p of L.pPlus) expect(p).toBeCloseTo(0.5, 12)
    expect(L.pPlus).toHaveLength(3)
    // Flux entering each analyser: everything, then a half, then a quarter.
    expect(L.flux[0]).toBeCloseTo(1, 12)
    expect(L.flux[1]).toBeCloseTo(0.5, 12)
    expect(L.flux[2]).toBeCloseTo(0.25, 12)
  })
})

describe('atom routes', () => {
  const chain: Analyser[] = [
    { axis: Z_AXIS, port: 1 },
    { axis: X_AXIS, port: 1 },
    { axis: Z_AXIS, port: 1 },
  ]
  const L = buildLayout(760, APPARATUS_HEIGHT, chain, null)

  const route = (shot: ChainShot) => buildRoute(L, shot)

  it('a blocked atom stops at its beam stop and goes no further', () => {
    const r = route({ outcomes: [-1], blockedAt: 0 })
    expect(r.blocked).toBe(true)
    const end = r.pts[r.pts.length - 1]
    expect(end.x).toBeCloseTo(stopX(L, 0), 10)
    expect(end.y).toBeCloseTo(portY(L, 0, -1), 10)
    expect(end.x).toBeLessThan(L.boxX[1])
  })

  it('an atom that survives the chain ends at a detector face', () => {
    for (const o of [1, -1] as Outcome[]) {
      const r = route({ outcomes: [1, 1, o], blockedAt: -1 })
      expect(r.blocked).toBe(false)
      const end = r.pts[r.pts.length - 1]
      expect(end.x).toBeCloseTo(L.detX, 10)
      expect(end.y).toBeCloseTo(portY(L, 2, o), 10)
    }
  })

  it('routes only ever move right, and pointAt walks them end to end', () => {
    const rand = mulberry32(4242)
    for (let i = 0; i < 200; i++) {
      const r = route(runChain(rand, null, chain))
      for (let k = 1; k < r.pts.length; k++) {
        expect(r.pts[k].x).toBeGreaterThanOrEqual(r.pts[k - 1].x)
      }
      expect(r.total).toBeGreaterThan(0)
      expect(pointAt(r, -5)).toEqual(r.pts[0])
      expect(pointAt(r, r.total + 5)).toEqual(r.pts[r.pts.length - 1])
      const mid = pointAt(r, r.total / 2)
      expect(mid.x).toBeGreaterThanOrEqual(r.pts[0].x)
      expect(mid.x).toBeLessThanOrEqual(r.pts[r.pts.length - 1].x)
      // Never leaves the frame.
      expect(mid.y).toBeGreaterThan(0)
      expect(mid.y).toBeLessThan(APPARATUS_HEIGHT)
    }
  })
})

describe('the canvas describes itself', () => {
  it('names the axes, the ports and the exact split', () => {
    const text = describeBench(null, [
      { axis: Z_AXIS, port: 1 },
      { axis: X_AXIS, port: 1 },
      { axis: Z_AXIS, port: 1 },
    ])
    expect(text).toContain('unpolarised')
    expect(text).toContain('analyser 1 along z')
    expect(text).toContain('analyser 2 along x')
    expect(text).toContain('up port continues')
    // The payoff has to be in the accessible description too, not only drawn.
    expect(text).toContain('analyser 3: 50.0% up')
  })
})
