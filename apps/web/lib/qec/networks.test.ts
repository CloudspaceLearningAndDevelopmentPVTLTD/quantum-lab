import { describe, it, expect } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import { buildLayout, failed, sampleShot, type Shot } from './model'
import { MlpDecoder } from './mlp'
import { TransformerDecoder } from './transformer'
import { MwpmDecoder } from './matching'
import { bceFromLogit, zeroGrads, type Param } from '@/lib/numerics/nn'

type Net = {
  params: Param[]
  logits(detX: Uint8Array, detZ: Uint8Array): [number, number]
  accumulate(detX: Uint8Array, detZ: Uint8Array, yX: number, yZ: number, scale: number): number
}

function lossOf(net: Net, shot: Shot): number {
  const [zx, zz] = net.logits(shot.detX, shot.detZ)
  return bceFromLogit(zx, shot.flipX) + bceFromLogit(zz, shot.flipZ)
}

/**
 * Central finite differences on every parameter of every tensor, against the
 * hand-written backward pass. Float64 throughout, so 1e-5 steps give ~1e-8
 * agreement on smooth parts; ReLU kinks are avoided by checking relative error
 * with a small absolute floor.
 */
function gradientCheck(net: Net, shots: Shot[], stride: number): { maxRel: number; checked: number } {
  zeroGrads(net.params)
  for (const s of shots) net.accumulate(s.detX, s.detZ, s.flipX, s.flipZ, 1)
  const analytic = net.params.map((p) => p.grad.slice())
  const total = (): number => shots.reduce((acc, s) => acc + lossOf(net, s), 0)
  let maxRel = 0
  let checked = 0
  const h = 1e-5
  net.params.forEach((p, pi) => {
    for (let i = 0; i < p.value.length; i += stride) {
      const orig = p.value[i]
      p.value[i] = orig + h
      const plus = total()
      p.value[i] = orig - h
      const minus = total()
      p.value[i] = orig
      const numeric = (plus - minus) / (2 * h)
      const a = analytic[pi][i]
      const rel = Math.abs(numeric - a) / Math.max(1e-6, Math.abs(numeric) + Math.abs(a))
      if (rel > maxRel) maxRel = rel
      checked++
    }
  })
  return { maxRel, checked }
}

function shotsFor(d: 3 | 5, q: number, p: number, n: number, seed: number): Shot[] {
  const layout = buildLayout(d, q)
  const rand = mulberry32(seed)
  return Array.from({ length: n }, () => sampleShot(layout, p, q, rand))
}

describe('the MLP decoder', () => {
  it('backprop matches finite differences on every tensor', () => {
    const layout = buildLayout(3, 0.02)
    const net = new MlpDecoder(layout, { hidden: 8, lr: 1e-3 }, mulberry32(3))
    const shots = shotsFor(3, 0.02, 0.1, 3, 4)
    const { maxRel, checked } = gradientCheck(net, shots, 3)
    expect(checked).toBeGreaterThan(100)
    expect(maxRel).toBeLessThan(1e-5)
  })

  it('learns the d = 3 code: after 30k samples it is within 15% of MWPM at the training p', () => {
    const layout = buildLayout(3, 0)
    const p = 0.1
    const rand = mulberry32(21)
    const net = new MlpDecoder(layout, { hidden: 32, lr: 3e-3 }, rand)
    for (let step = 0; step < 30_000 / 32; step++) {
      const batch = Array.from({ length: 32 }, () => sampleShot(layout, p, 0, rand))
      net.trainBatch(batch)
    }
    const mwpm = new MwpmDecoder(layout, p, 0)
    const evalRand = mulberry32(22)
    let netFail = 0
    let mwpmFail = 0
    const N = 6000
    for (let i = 0; i < N; i++) {
      const s = sampleShot(layout, p, 0, evalRand)
      if (failed(net.predict(s.detX, s.detZ), s)) netFail++
      if (failed(mwpm.predict(s.detX, s.detZ), s)) mwpmFail++
    }
    expect(netFail / N).toBeLessThan((mwpmFail / N) * 1.15)
  })
})

describe('the transformer decoder', () => {
  it('backprop matches finite differences on every tensor, two blocks, two heads', () => {
    const layout = buildLayout(3, 0.02)
    const net = new TransformerDecoder(layout, { width: 8, heads: 2, ff: 12, layers: 2, lr: 1e-3 }, mulberry32(5))
    const shots = shotsFor(3, 0.02, 0.1, 2, 6)
    const { maxRel, checked } = gradientCheck(net, shots, 2)
    expect(checked).toBeGreaterThan(300)
    expect(maxRel).toBeLessThan(1e-5)
  })

  it('backprop is also right with zero blocks and with perfect extraction', () => {
    const layout = buildLayout(5, 0)
    const net = new TransformerDecoder(layout, { width: 4, heads: 1, ff: 6, layers: 0, lr: 1e-3 }, mulberry32(9))
    const shots = shotsFor(5, 0, 0.1, 2, 10)
    const { maxRel } = gradientCheck(net, shots, 1)
    expect(maxRel).toBeLessThan(1e-5)
  })

  it('is permutation-aware: swapping two tokens’ detectors changes the logits', () => {
    // Without position embeddings a mean-pooled transformer would be blind to
    // WHICH stabiliser fired. It must not be.
    const layout = buildLayout(3, 0)
    const net = new TransformerDecoder(layout, { width: 8, heads: 2, ff: 12, layers: 1, lr: 1e-3 }, mulberry32(12))
    const detX = new Uint8Array(layout.sizeX)
    const detZ = new Uint8Array(layout.sizeZ)
    detX[0] = 1
    const a = net.logits(detX, detZ)
    detX[0] = 0
    detX[1] = 1
    const b = net.logits(detX, detZ)
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeGreaterThan(1e-6)
  })

  it('learns the d = 3 code well enough to sit within 20% of MWPM after 20k samples', () => {
    const layout = buildLayout(3, 0)
    const p = 0.1
    const rand = mulberry32(31)
    const net = new TransformerDecoder(layout, { width: 16, heads: 2, ff: 32, layers: 2, lr: 3e-3 }, rand)
    for (let step = 0; step < 20_000 / 32; step++) {
      const batch = Array.from({ length: 32 }, () => sampleShot(layout, p, 0, rand))
      net.trainBatch(batch)
    }
    const mwpm = new MwpmDecoder(layout, p, 0)
    const evalRand = mulberry32(32)
    let netFail = 0
    let mwpmFail = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      const s = sampleShot(layout, p, 0, evalRand)
      if (failed(net.predict(s.detX, s.detZ), s)) netFail++
      if (failed(mwpm.predict(s.detX, s.detZ), s)) mwpmFail++
    }
    expect(netFail / N).toBeLessThan((mwpmFail / N) * 1.2)
  })
})
