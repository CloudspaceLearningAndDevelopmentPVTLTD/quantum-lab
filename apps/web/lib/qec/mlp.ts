/**
 * lib/qec/mlp.ts — a two-hidden-layer perceptron that reads every detector of both
 * channels at once and emits two logits: P(X̄ flipped), P(Z̄ flipped).
 *
 * Because it sees both channels it can, in principle, learn the X–Z correlation
 * that depolarising noise introduces (a Y error fires both) — something matching,
 * which decodes the channels separately, cannot. Whether it does in the samples
 * the page budget allows is the experiment.
 *
 * Hand-written forward and backward passes; mlp.test.ts checks every gradient
 * against central finite differences, which is the only way to know a backprop is
 * right rather than merely converging somewhere.
 */

import type { Decoder, Layout, Prediction } from './model'
import { adamStep, bceFromLogit, glorot, param, sigmoid, toSigned, zeroGrads, type Param } from '@/lib/numerics/nn'

export type MlpConfig = { hidden: number; lr: number }
export const DEFAULT_MLP: MlpConfig = { hidden: 64, lr: 2e-3 }

export class MlpDecoder implements Decoder {
  readonly name = 'mlp' as const
  readonly nIn: number
  readonly hidden: number
  readonly params: Param[]
  private W1: Param
  private b1: Param
  private W2: Param
  private b2: Param
  private W3: Param
  private b3: Param
  /** Scratch. */
  private x: Float64Array
  private h1: Float64Array
  private h2: Float64Array
  private dh1: Float64Array
  private dh2: Float64Array
  steps = 0
  samplesSeen = 0

  constructor(
    readonly layout: Layout,
    readonly config: MlpConfig,
    rand: () => number
  ) {
    this.nIn = layout.sizeX + layout.sizeZ
    this.hidden = config.hidden
    const H = this.hidden
    this.W1 = param('W1', H * this.nIn)
    this.b1 = param('b1', H)
    this.W2 = param('W2', H * H)
    this.b2 = param('b2', H)
    this.W3 = param('W3', 2 * H)
    this.b3 = param('b3', 2)
    glorot(this.W1, this.nIn, H, rand)
    glorot(this.W2, H, H, rand)
    glorot(this.W3, H, 2, rand)
    this.params = [this.W1, this.b1, this.W2, this.b2, this.W3, this.b3]
    this.x = new Float64Array(this.nIn)
    this.h1 = new Float64Array(H)
    this.h2 = new Float64Array(H)
    this.dh1 = new Float64Array(H)
    this.dh2 = new Float64Array(H)
  }

  private load(detX: Uint8Array, detZ: Uint8Array): void {
    toSigned(detX, this.x, 0)
    toSigned(detZ, this.x, this.layout.sizeX)
  }

  /** Forward pass from the scratch input; returns the two logits. */
  private forward(): [number, number] {
    const { nIn, hidden: H, x, h1, h2 } = this
    const W1 = this.W1.value
    const b1 = this.b1.value
    const W2 = this.W2.value
    const b2 = this.b2.value
    const W3 = this.W3.value
    const b3 = this.b3.value
    for (let j = 0; j < H; j++) {
      let a = b1[j]
      const row = j * nIn
      for (let i = 0; i < nIn; i++) a += W1[row + i] * x[i]
      h1[j] = a > 0 ? a : 0
    }
    for (let j = 0; j < H; j++) {
      let a = b2[j]
      const row = j * H
      for (let i = 0; i < H; i++) a += W2[row + i] * h1[i]
      h2[j] = a > 0 ? a : 0
    }
    const out: [number, number] = [b3[0], b3[1]]
    for (let o = 0; o < 2; o++) {
      let a = out[o]
      const row = o * H
      for (let i = 0; i < H; i++) a += W3[row + i] * h2[i]
      out[o] = a
    }
    return out
  }

  /** Logits for one shot. */
  logits(detX: Uint8Array, detZ: Uint8Array): [number, number] {
    this.load(detX, detZ)
    return this.forward()
  }

  predict(detX: Uint8Array, detZ: Uint8Array): Prediction {
    const [zx, zz] = this.logits(detX, detZ)
    return { flipX: zx > 0 ? 1 : 0, flipZ: zz > 0 ? 1 : 0 }
  }

  /** Accumulate one sample's gradient (scaled by `scale`) into the params. Returns its loss. */
  accumulate(detX: Uint8Array, detZ: Uint8Array, yX: number, yZ: number, scale: number): number {
    this.load(detX, detZ)
    const [zx, zz] = this.forward()
    const loss = bceFromLogit(zx, yX) + bceFromLogit(zz, yZ)
    const dz: [number, number] = [(sigmoid(zx) - yX) * scale, (sigmoid(zz) - yZ) * scale]

    const { nIn, hidden: H, x, h1, h2, dh1, dh2 } = this
    const gW3 = this.W3.grad
    const gb3 = this.b3.grad
    dh2.fill(0)
    for (let o = 0; o < 2; o++) {
      gb3[o] += dz[o]
      const row = o * H
      const W3 = this.W3.value
      for (let i = 0; i < H; i++) {
        gW3[row + i] += dz[o] * h2[i]
        dh2[i] += dz[o] * W3[row + i]
      }
    }
    // ReLU gate.
    for (let i = 0; i < H; i++) if (h2[i] <= 0) dh2[i] = 0
    const gW2 = this.W2.grad
    const gb2 = this.b2.grad
    const W2 = this.W2.value
    dh1.fill(0)
    for (let j = 0; j < H; j++) {
      const g = dh2[j]
      if (g === 0) continue
      gb2[j] += g
      const row = j * H
      for (let i = 0; i < H; i++) {
        gW2[row + i] += g * h1[i]
        dh1[i] += g * W2[row + i]
      }
    }
    for (let i = 0; i < H; i++) if (h1[i] <= 0) dh1[i] = 0
    const gW1 = this.W1.grad
    const gb1 = this.b1.grad
    for (let j = 0; j < H; j++) {
      const g = dh1[j]
      if (g === 0) continue
      gb1[j] += g
      const row = j * nIn
      for (let i = 0; i < nIn; i++) gW1[row + i] += g * x[i]
    }
    return loss
  }

  /** One Adam step on a minibatch. Returns mean loss. */
  trainBatch(batch: { detX: Uint8Array; detZ: Uint8Array; flipX: number; flipZ: number }[]): number {
    zeroGrads(this.params)
    const scale = 1 / batch.length
    let total = 0
    for (const s of batch) total += this.accumulate(s.detX, s.detZ, s.flipX, s.flipZ, scale)
    this.steps++
    this.samplesSeen += batch.length
    adamStep(this.params, this.steps, { lr: this.config.lr })
    return total / batch.length
  }
}
