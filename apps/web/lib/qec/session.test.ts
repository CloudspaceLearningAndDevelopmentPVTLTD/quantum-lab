import { describe, it, expect } from 'vitest'
import { defaultSweep, rateWithInterval, runSweep, thresholdGuide, trainDecoders, type TrainProgress } from './session'

const noYield = async (): Promise<void> => {}

describe('training under a budget', () => {
  it('stops each decoder at the sample budget and reports why', async () => {
    const progress: TrainProgress[] = []
    let clock = 0
    const trained = await trainDecoders(
      { d: 3, p: 0.08, q: 0 },
      ['lookup', 'mlp', 'transformer'],
      { samples: 640, seconds: 1000, batch: 32 },
      7,
      { onProgress: (p) => progress.push(p), shouldStop: () => false, yieldNow: noYield, now: () => (clock += 1) },
      { mlp: { hidden: 8, lr: 1e-3 }, transformer: { width: 8, heads: 2, ff: 8, layers: 1, lr: 1e-3 } }
    )
    expect(trained.samples).toEqual({ lookup: 640, mlp: 640, transformer: 640 })
    expect(trained.stoppedBy).toEqual({ lookup: 'samples', mlp: 'samples', transformer: 'samples' })
    expect(trained.mlp!.samplesSeen).toBe(640)
    expect(trained.transformer!.steps).toBe(20)
    const done = progress.filter((p) => p.done)
    expect(done.map((p) => p.decoder)).toEqual(['lookup', 'mlp', 'transformer'])
    expect(trained.paramCounts.mlp).toBeGreaterThan(0)
  })

  it('stops on the wall-clock budget', async () => {
    let clock = 0
    const trained = await trainDecoders(
      { d: 3, p: 0.08, q: 0 },
      ['mlp'],
      { samples: 1_000_000, seconds: 2, batch: 32 },
      7,
      { onProgress: () => {}, shouldStop: () => false, yieldNow: noYield, now: () => (clock += 100) },
      { mlp: { hidden: 8, lr: 1e-3 } }
    )
    expect(trained.stoppedBy.mlp).toBe('seconds')
    expect(trained.samples.mlp!).toBeLessThan(2000)
  })

  it('a stop request ends training and skips the remaining decoders', async () => {
    let calls = 0
    const trained = await trainDecoders(
      { d: 3, p: 0.08, q: 0 },
      ['mlp', 'transformer'],
      { samples: 100_000, seconds: 1000, batch: 32 },
      7,
      { onProgress: () => {}, shouldStop: () => ++calls > 5, yieldNow: noYield, now: () => 0 },
      { mlp: { hidden: 8, lr: 1e-3 } }
    )
    expect(trained.stoppedBy.mlp).toBe('user')
    expect(trained.transformer).toBeUndefined()
  })

  it('skips the lookup table above d = 3', async () => {
    const trained = await trainDecoders(
      { d: 5, p: 0.08, q: 0 },
      ['lookup'],
      { samples: 10, seconds: 10, batch: 10 },
      1,
      { onProgress: () => {}, shouldStop: () => false, yieldNow: noYield, now: () => 0 }
    )
    expect(trained.lookup).toBeUndefined()
  })
})

describe('the sweep', () => {
  it('produces one point per p with MWPM at every distance and the learned curves at the trained one', async () => {
    const trained = await trainDecoders(
      { d: 3, p: 0.08, q: 0 },
      ['lookup', 'mlp'],
      { samples: 320, seconds: 10, batch: 32 },
      3,
      { onProgress: () => {}, shouldStop: () => false, yieldNow: noYield, now: () => 0 },
      { mlp: { hidden: 8, lr: 1e-3 } }
    )
    const seen: number[] = []
    const points = await runSweep(
      trained,
      { ps: [0.02, 0.1], shots: 200, seed: 5 },
      { onPoint: (_, i) => seen.push(i), shouldStop: () => false, yieldNow: noYield }
    )
    expect(seen).toEqual([0, 1])
    expect(points.map((pt) => Object.keys(pt.curves).sort())).toEqual([
      ['lookup', 'mlp', 'mwpm-3', 'mwpm-5', 'mwpm-7'],
      ['lookup', 'mlp', 'mwpm-3', 'mwpm-5', 'mwpm-7'],
    ])
    for (const pt of points) for (const c of Object.values(pt.curves)) expect(c.shots).toBe(200)
    // Same seed, same numbers: the sweep is reproducible.
    const again = await runSweep(
      trained,
      { ps: [0.02, 0.1], shots: 200, seed: 5 },
      { onPoint: () => {}, shouldStop: () => false, yieldNow: noYield }
    )
    expect(again).toEqual(points)
  })

  it('Wilson intervals bracket the point estimate and stay inside [0, 1]', () => {
    const r = rateWithInterval({ failures: 3, shots: 100 })
    expect(r.rate).toBeCloseTo(0.03, 9)
    expect(r.lo).toBeGreaterThanOrEqual(0)
    expect(r.lo).toBeLessThan(0.03)
    expect(r.hi).toBeGreaterThan(0.03)
    expect(rateWithInterval({ failures: 0, shots: 50 }).lo).toBe(0)
    expect(rateWithInterval({ failures: 0, shots: 0 })).toEqual({ rate: 0, lo: 0, hi: 0 })
  })

  it('the default grids straddle the guide threshold', () => {
    for (const q of [0, 0.01]) {
      const ps = defaultSweep(q)
      const guide = thresholdGuide(q)
      expect(ps[0]).toBeLessThan(guide)
      expect(ps[ps.length - 1]).toBeGreaterThan(guide)
    }
    expect(thresholdGuide(0)).toBeCloseTo(0.1545, 3)
  })
})
