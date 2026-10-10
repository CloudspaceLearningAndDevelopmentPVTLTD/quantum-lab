import { describe, expect, it } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import {
  DEFAULT_CARTOON,
  columnX,
  createCartoon,
  levelCounts,
  stepCartoon,
  type CartoonParams,
  type CartoonState,
} from './laserCartoon'

/**
 * Run the cartoon for `seconds` of simulated time at 60 Hz and return the mean
 * mode-photon count and mean level populations over the second half — the
 * first half is warm-up.
 */
function run(params: CartoonParams, seconds: number, seed: number) {
  const rand = mulberry32(seed)
  const state = createCartoon(params)
  const dt = 1 / 60
  const steps = Math.round(seconds / dt)
  let photonSum = 0
  let n1Sum = 0
  let n2Sum = 0
  let samples = 0
  for (let i = 0; i < steps; i++) {
    stepCartoon(state, params, dt, rand)
    if (i >= steps / 2) {
      const { n1, n2 } = levelCounts(state)
      photonSum += state.photons.length
      n1Sum += n1
      n2Sum += n2
      samples++
    }
  }
  return {
    state,
    photons: photonSum / samples,
    n1: n1Sum / samples,
    n2: n2Sum / samples,
  }
}

function checkBookkeeping(state: CartoonState, params: CartoonParams): void {
  const c = state.counts
  // Photons in the mode = seeded + cloned − absorbed − out the mirror − not drawn.
  expect(state.photons.length).toBe(c.seeded + c.stimulated - c.absorbed - c.output - c.overflow)
  expect(state.atoms.length).toBe(params.cols * params.rows)
  for (const a of state.atoms) expect([1, 2, 3]).toContain(a.level)
  for (const p of state.photons) {
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeLessThanOrEqual(1)
  }
}

describe('laser cartoon', () => {
  it('lays the atom columns out inside the slab', () => {
    const xs = Array.from({ length: 7 }, (_, c) => columnX(c, 7))
    expect(xs[0]).toBeGreaterThan(0.3)
    expect(xs[6]).toBeLessThan(0.7)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(xs[1] - xs[0], 12)
  })

  it('below inversion the mode never fills: photons are absorbed faster than they are cloned', () => {
    const params: CartoonParams = { ...DEFAULT_CARTOON, pumpRatio: 0.4 }
    const r = run(params, 120, 1)
    expect(r.n2).toBeLessThan(r.n1)
    expect(r.photons).toBeLessThan(3)
    expect(r.state.counts.spontaneous).toBeGreaterThan(50)
    checkBookkeeping(r.state, params)
  })

  it('pumped well past inversion the mode fills, clamps, and most light out is stimulated', () => {
    const params: CartoonParams = { ...DEFAULT_CARTOON, pumpRatio: 3 }
    const r = run(params, 120, 2)
    expect(r.photons).toBeGreaterThan(40)
    expect(r.photons).toBeLessThan(params.maxModePhotons)
    // Gain clamping: the running inversion settles near the threshold, which
    // for these numbers is a few atoms, not the 30+ the pump alone would give.
    expect(r.n2 - r.n1).toBeLessThan(12)
    expect(r.state.counts.stimulated).toBeGreaterThan(5 * r.state.counts.seeded)
    expect(r.state.counts.output).toBeGreaterThan(r.state.counts.spontaneous)
    checkBookkeeping(r.state, params)
  })

  it('the transition is sharp: a small pump change across inversion is a large photon change', () => {
    const under = run({ ...DEFAULT_CARTOON, pumpRatio: 0.7 }, 120, 3).photons
    const over = run({ ...DEFAULT_CARTOON, pumpRatio: 2.0 }, 120, 3).photons
    expect(over / Math.max(under, 0.5)).toBeGreaterThan(15)
  })

  it('a two-level medium never inverts and never lases, however hard it is pumped', () => {
    for (const pumpRatio of [1, 3, 20]) {
      const params: CartoonParams = { ...DEFAULT_CARTOON, scheme: 'two', pumpRatio }
      const r = run(params, 120, 4)
      expect(r.n2).toBeLessThanOrEqual(r.n1 + 1.5)
      expect(r.photons).toBeLessThan(3)
      expect(levelCounts(r.state).n3).toBe(0)
      if (pumpRatio >= 3) expect(r.state.counts.pumpedDown).toBeGreaterThan(0)
      checkBookkeeping(r.state, params)
    }
  })

  it('the drawing budget is honoured and reported rather than silently exceeded', () => {
    const params: CartoonParams = {
      ...DEFAULT_CARTOON,
      pumpRatio: 4,
      maxModePhotons: 30,
      mirrorTransmission: 0.02,
    }
    const r = run(params, 60, 5)
    expect(r.state.photons.length).toBeLessThanOrEqual(30)
    expect(r.state.counts.overflow).toBeGreaterThan(0)
    checkBookkeeping(r.state, params)
  })

  it('keeps a bounded history of the mode photon count', () => {
    const params = DEFAULT_CARTOON
    const r = run(params, 60, 6)
    expect(r.state.history.length).toBeLessThanOrEqual(300)
    expect(r.state.history.length).toBeGreaterThan(250)
  })
})
