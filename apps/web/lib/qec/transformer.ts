/**
 * lib/qec/transformer.ts — a compact attention decoder in the shape of AlphaQubit,
 * shrunk until it trains in a browser tab.
 *
 * ── Tokens ──────────────────────────────────────────────────────────────────────
 *
 * One token per stabiliser, of both types. A token's features are that
 * stabiliser's detection events across every layer (as ±1), projected to the
 * model width and added to a learned position embedding — so the network is told
 * WHERE a stabiliser sits only through a vector it learns, and must discover the
 * lattice adjacency from data. That is the AlphaQubit design choice; the recurrent
 * per-round state of the real thing is replaced here by feeding all rounds at
 * once, which is fine for the handful of rounds this lab runs.
 *
 * ── Blocks ──────────────────────────────────────────────────────────────────────
 *
 * Pre-LayerNorm transformer blocks: multi-head self-attention with a residual,
 * then a ReLU feed-forward with a residual. Mean-pool over tokens, LayerNorm, and
 * a linear head to two logits (X̄ flipped, Z̄ flipped). Defaults: width 16, two
 * heads, feed-forward 32, two blocks — a few thousand parameters.
 *
 * Every backward pass is written out by hand and checked in transformer.test.ts
 * against central finite differences on every parameter.
 */

import type { Decoder, Layout, Prediction } from './model'
import { adamStep, bceFromLogit, glorot, param, sigmoid, zeroGrads, type Param } from '@/lib/numerics/nn'

export type TransformerConfig = {
  width: number
  heads: number
  ff: number
  layers: number
  lr: number
}

export const DEFAULT_TRANSFORMER: TransformerConfig = { width: 16, heads: 2, ff: 32, layers: 2, lr: 2e-3 }

type Block = {
  g1: Param
  be1: Param
  Wq: Param
  Wk: Param
  Wv: Param
  Wo: Param
  bo: Param
  g2: Param
  be2: Param
  W1: Param
  b1: Param
  W2: Param
  b2: Param
  // Scratch activations (one sample).
  xin: Float64Array
  rstd1: Float64Array
  xhat1: Float64Array
  u1: Float64Array
  q: Float64Array
  k: Float64Array
  v: Float64Array
  attn: Float64Array // heads × N × N
  ctx: Float64Array
  x1: Float64Array
  rstd2: Float64Array
  xhat2: Float64Array
  u2: Float64Array
  f: Float64Array
  // Scratch gradients.
  dx: Float64Array
  du: Float64Array
  dq: Float64Array
  dk: Float64Array
  dv: Float64Array
  dctx: Float64Array
  df: Float64Array
  dA: Float64Array
}

/** LayerNorm forward over one row of width D. Returns rstd. */
function layerNormRow(
  x: Float64Array,
  off: number,
  D: number,
  g: Float64Array,
  b: Float64Array,
  xhat: Float64Array,
  u: Float64Array
): number {
  let mean = 0
  for (let a = 0; a < D; a++) mean += x[off + a]
  mean /= D
  let varSum = 0
  for (let a = 0; a < D; a++) {
    const c = x[off + a] - mean
    varSum += c * c
  }
  const rstd = 1 / Math.sqrt(varSum / D + 1e-5)
  for (let a = 0; a < D; a++) {
    const h = (x[off + a] - mean) * rstd
    xhat[off + a] = h
    u[off + a] = h * g[a] + b[a]
  }
  return rstd
}

/** LayerNorm backward for one row: adds dx into `dx`, accumulates dg/db. */
function layerNormBackRow(
  du: Float64Array,
  off: number,
  D: number,
  g: Float64Array,
  xhat: Float64Array,
  rstd: number,
  dg: Float64Array,
  db: Float64Array,
  dx: Float64Array
): void {
  let mDxhat = 0
  let mDxhatX = 0
  for (let a = 0; a < D; a++) {
    const d = du[off + a]
    dg[a] += d * xhat[off + a]
    db[a] += d
    const dxhat = d * g[a]
    mDxhat += dxhat
    mDxhatX += dxhat * xhat[off + a]
  }
  mDxhat /= D
  mDxhatX /= D
  for (let a = 0; a < D; a++) {
    const dxhat = du[off + a] * g[a]
    dx[off + a] += rstd * (dxhat - mDxhat - xhat[off + a] * mDxhatX)
  }
}

export class TransformerDecoder implements Decoder {
  readonly name = 'transformer' as const
  readonly N: number
  readonly F: number
  readonly D: number
  readonly H: number
  readonly dh: number
  readonly Dff: number
  readonly params: Param[] = []
  private We: Param
  private be: Param
  private pos: Param
  private blocks: Block[] = []
  private gf: Param
  private bf: Param
  private Wout: Param
  private bout: Param
  private feats: Float64Array
  private x0: Float64Array
  private pooled: Float64Array
  private xhatf: Float64Array
  private uf: Float64Array
  private rstdf = 1
  private dpooled: Float64Array
  private duf: Float64Array
  steps = 0
  samplesSeen = 0

  constructor(
    readonly layout: Layout,
    readonly config: TransformerConfig,
    rand: () => number
  ) {
    const nX = layout.stabsX.length
    const nZ = layout.stabsZ.length
    this.N = nX + nZ
    this.F = layout.layers
    this.D = config.width
    this.H = config.heads
    if (this.D % this.H !== 0) throw new Error('width must be divisible by heads')
    this.dh = this.D / this.H
    this.Dff = config.ff
    const { N, F, D, Dff } = this

    this.We = param('We', F * D)
    this.be = param('be', D)
    this.pos = param('pos', N * D)
    glorot(this.We, F, D, rand)
    for (let i = 0; i < this.pos.value.length; i++) this.pos.value[i] = (rand() * 2 - 1) * 0.5
    this.params.push(this.We, this.be, this.pos)

    for (let l = 0; l < config.layers; l++) {
      const b: Block = {
        g1: param(`g1.${l}`, D),
        be1: param(`be1.${l}`, D),
        Wq: param(`Wq.${l}`, D * D),
        Wk: param(`Wk.${l}`, D * D),
        Wv: param(`Wv.${l}`, D * D),
        Wo: param(`Wo.${l}`, D * D),
        bo: param(`bo.${l}`, D),
        g2: param(`g2.${l}`, D),
        be2: param(`be2.${l}`, D),
        W1: param(`W1.${l}`, D * Dff),
        b1: param(`b1.${l}`, Dff),
        W2: param(`W2.${l}`, Dff * D),
        b2: param(`b2.${l}`, D),
        xin: new Float64Array(N * D),
        rstd1: new Float64Array(N),
        xhat1: new Float64Array(N * D),
        u1: new Float64Array(N * D),
        q: new Float64Array(N * D),
        k: new Float64Array(N * D),
        v: new Float64Array(N * D),
        attn: new Float64Array(this.H * N * N),
        ctx: new Float64Array(N * D),
        x1: new Float64Array(N * D),
        rstd2: new Float64Array(N),
        xhat2: new Float64Array(N * D),
        u2: new Float64Array(N * D),
        f: new Float64Array(N * Dff),
        dx: new Float64Array(N * D),
        du: new Float64Array(N * D),
        dq: new Float64Array(N * D),
        dk: new Float64Array(N * D),
        dv: new Float64Array(N * D),
        dctx: new Float64Array(N * D),
        df: new Float64Array(N * Dff),
        dA: new Float64Array(N),
      }
      b.g1.value.fill(1)
      b.g2.value.fill(1)
      glorot(b.Wq, D, D, rand)
      glorot(b.Wk, D, D, rand)
      glorot(b.Wv, D, D, rand)
      glorot(b.Wo, D, D, rand)
      glorot(b.W1, D, Dff, rand)
      glorot(b.W2, Dff, D, rand)
      this.blocks.push(b)
      this.params.push(b.g1, b.be1, b.Wq, b.Wk, b.Wv, b.Wo, b.bo, b.g2, b.be2, b.W1, b.b1, b.W2, b.b2)
    }

    this.gf = param('gf', D)
    this.bf = param('bf', D)
    this.gf.value.fill(1)
    this.Wout = param('Wout', D * 2)
    this.bout = param('bout', 2)
    glorot(this.Wout, D, 2, rand)
    this.params.push(this.gf, this.bf, this.Wout, this.bout)

    this.feats = new Float64Array(N * F)
    this.x0 = new Float64Array(N * D)
    this.pooled = new Float64Array(D)
    this.xhatf = new Float64Array(D)
    this.uf = new Float64Array(D)
    this.dpooled = new Float64Array(D)
    this.duf = new Float64Array(D)
  }

  /** Token i's feature f is the detector at layer f of stabiliser i (X-channel tokens first). */
  private load(detX: Uint8Array, detZ: Uint8Array): void {
    const nX = this.layout.stabsX.length
    const nZ = this.layout.stabsZ.length
    const { F, feats } = this
    for (let s = 0; s < nX; s++) for (let t = 0; t < F; t++) feats[s * F + t] = detX[t * nX + s] ? 1 : -1
    for (let s = 0; s < nZ; s++) for (let t = 0; t < F; t++) feats[(nX + s) * F + t] = detZ[t * nZ + s] ? 1 : -1
  }

  private forward(): [number, number] {
    const { N, F, D, H, dh, Dff, feats, x0 } = this
    // Embedding.
    const We = this.We.value
    const be = this.be.value
    const pos = this.pos.value
    for (let i = 0; i < N; i++) {
      for (let b = 0; b < D; b++) {
        let a = be[b] + pos[i * D + b]
        for (let f = 0; f < F; f++) a += feats[i * F + f] * We[f * D + b]
        x0[i * D + b] = a
      }
    }

    let x = x0
    const scale = 1 / Math.sqrt(dh)
    for (const blk of this.blocks) {
      blk.xin.set(x)
      for (let i = 0; i < N; i++) {
        blk.rstd1[i] = layerNormRow(blk.xin, i * D, D, blk.g1.value, blk.be1.value, blk.xhat1, blk.u1)
      }
      const Wq = blk.Wq.value
      const Wk = blk.Wk.value
      const Wv = blk.Wv.value
      for (let i = 0; i < N; i++) {
        for (let b = 0; b < D; b++) {
          let sq = 0
          let sk = 0
          let sv = 0
          for (let a = 0; a < D; a++) {
            const u = blk.u1[i * D + a]
            sq += u * Wq[a * D + b]
            sk += u * Wk[a * D + b]
            sv += u * Wv[a * D + b]
          }
          blk.q[i * D + b] = sq
          blk.k[i * D + b] = sk
          blk.v[i * D + b] = sv
        }
      }
      blk.ctx.fill(0)
      for (let h = 0; h < H; h++) {
        const hoff = h * dh
        for (let i = 0; i < N; i++) {
          const row = h * N * N + i * N
          let max = -Infinity
          for (let j = 0; j < N; j++) {
            let s = 0
            for (let c = 0; c < dh; c++) s += blk.q[i * D + hoff + c] * blk.k[j * D + hoff + c]
            s *= scale
            blk.attn[row + j] = s
            if (s > max) max = s
          }
          let sum = 0
          for (let j = 0; j < N; j++) {
            const e = Math.exp(blk.attn[row + j] - max)
            blk.attn[row + j] = e
            sum += e
          }
          for (let j = 0; j < N; j++) {
            const a = blk.attn[row + j] / sum
            blk.attn[row + j] = a
            for (let c = 0; c < dh; c++) blk.ctx[i * D + hoff + c] += a * blk.v[j * D + hoff + c]
          }
        }
      }
      const Wo = blk.Wo.value
      const bo = blk.bo.value
      for (let i = 0; i < N; i++) {
        for (let b = 0; b < D; b++) {
          let a = bo[b]
          for (let c = 0; c < D; c++) a += blk.ctx[i * D + c] * Wo[c * D + b]
          blk.x1[i * D + b] = blk.xin[i * D + b] + a
        }
      }
      for (let i = 0; i < N; i++) {
        blk.rstd2[i] = layerNormRow(blk.x1, i * D, D, blk.g2.value, blk.be2.value, blk.xhat2, blk.u2)
      }
      const W1 = blk.W1.value
      const b1 = blk.b1.value
      const W2 = blk.W2.value
      const b2 = blk.b2.value
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < Dff; j++) {
          let a = b1[j]
          for (let c = 0; c < D; c++) a += blk.u2[i * D + c] * W1[c * Dff + j]
          blk.f[i * Dff + j] = a > 0 ? a : 0
        }
      }
      // Output of this block is written into the next block's xin (or x0 buffer reuse): use dx as temp? No — allocate via x1 reuse is unsafe. Write into a dedicated output: reuse `this.x0` only for first; keep it simple with a fresh view.
      const out = blk.dx // dx is free during forward; it is zeroed before backward.
      for (let i = 0; i < N; i++) {
        for (let b = 0; b < D; b++) {
          let a = b2[b]
          for (let j = 0; j < Dff; j++) a += blk.f[i * Dff + j] * W2[j * D + b]
          out[i * D + b] = blk.x1[i * D + b] + a
        }
      }
      x = out
    }

    // Pool, LN, head.
    const { pooled } = this
    pooled.fill(0)
    for (let i = 0; i < N; i++) for (let b = 0; b < D; b++) pooled[b] += x[i * D + b]
    for (let b = 0; b < D; b++) pooled[b] /= N
    this.rstdf = layerNormRow(pooled, 0, D, this.gf.value, this.bf.value, this.xhatf, this.uf)
    const Wout = this.Wout.value
    const bout = this.bout.value
    const logits: [number, number] = [bout[0], bout[1]]
    for (let o = 0; o < 2; o++) {
      let a = logits[o]
      for (let c = 0; c < D; c++) a += this.uf[c] * Wout[c * 2 + o]
      logits[o] = a
    }
    return logits
  }

  logits(detX: Uint8Array, detZ: Uint8Array): [number, number] {
    this.load(detX, detZ)
    return this.forward()
  }

  predict(detX: Uint8Array, detZ: Uint8Array): Prediction {
    const [zx, zz] = this.logits(detX, detZ)
    return { flipX: zx > 0 ? 1 : 0, flipZ: zz > 0 ? 1 : 0 }
  }

  /** Accumulate one sample's gradient (times `scale`). Returns the sample loss. */
  accumulate(detX: Uint8Array, detZ: Uint8Array, yX: number, yZ: number, scale: number): number {
    this.load(detX, detZ)
    const [zx, zz] = this.forward()
    const loss = bceFromLogit(zx, yX) + bceFromLogit(zz, yZ)
    const dlogit = [(sigmoid(zx) - yX) * scale, (sigmoid(zz) - yZ) * scale]

    const { N, F, D, H, dh, Dff } = this
    // Head.
    const Wout = this.Wout.value
    const gWout = this.Wout.grad
    const gbout = this.bout.grad
    this.duf.fill(0)
    for (let o = 0; o < 2; o++) {
      gbout[o] += dlogit[o]
      for (let c = 0; c < D; c++) {
        gWout[c * 2 + o] += dlogit[o] * this.uf[c]
        this.duf[c] += dlogit[o] * Wout[c * 2 + o]
      }
    }
    this.dpooled.fill(0)
    layerNormBackRow(this.duf, 0, D, this.gf.value, this.xhatf, this.rstdf, this.gf.grad, this.bf.grad, this.dpooled)

    // dx for the last block's output: dpooled / N broadcast. Walk blocks backward.
    let dxOut: Float64Array | null = null
    for (let l = this.blocks.length - 1; l >= 0; l--) {
      const blk = this.blocks[l]
      // Gradient w.r.t. this block's output.
      const dout = blk.du // reuse as the incoming gradient buffer
      if (dxOut === null) {
        for (let i = 0; i < N; i++) for (let b = 0; b < D; b++) dout[i * D + b] = this.dpooled[b] / N
      } else dout.set(dxOut)

      // Feed-forward backward. dx1 = dout (residual) + LN2back(du2).
      const W1 = blk.W1.value
      const W2 = blk.W2.value
      const gW1 = blk.W1.grad
      const gb1 = blk.b1.grad
      const gW2 = blk.W2.grad
      const gb2 = blk.b2.grad
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < Dff; j++) {
          const fij = blk.f[i * Dff + j]
          let g = 0
          if (fij > 0) {
            for (let b = 0; b < D; b++) g += dout[i * D + b] * W2[j * D + b]
          }
          blk.df[i * Dff + j] = g
        }
        for (let b = 0; b < D; b++) {
          const g = dout[i * D + b]
          gb2[b] += g
          for (let j = 0; j < Dff; j++) gW2[j * D + b] += blk.f[i * Dff + j] * g
        }
      }
      // du2 = df @ W1^T; dW1 += u2^T df.
      const du2 = blk.dq // temp: N×D
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < D; c++) {
          let g = 0
          for (let j = 0; j < Dff; j++) g += blk.df[i * Dff + j] * W1[c * Dff + j]
          du2[i * D + c] = g
        }
        for (let j = 0; j < Dff; j++) {
          const g = blk.df[i * Dff + j]
          if (g === 0) continue
          gb1[j] += g
          for (let c = 0; c < D; c++) gW1[c * Dff + j] += blk.u2[i * D + c] * g
        }
      }
      const dx1 = blk.dx
      dx1.set(dout)
      for (let i = 0; i < N; i++) {
        layerNormBackRow(du2, i * D, D, blk.g2.value, blk.xhat2, blk.rstd2[i], blk.g2.grad, blk.be2.grad, dx1)
      }

      // Attention backward. do = dx1.
      const Wo = blk.Wo.value
      const gWo = blk.Wo.grad
      const gbo = blk.bo.grad
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < D; c++) {
          let g = 0
          for (let b = 0; b < D; b++) g += dx1[i * D + b] * Wo[c * D + b]
          blk.dctx[i * D + c] = g
        }
        for (let b = 0; b < D; b++) {
          const g = dx1[i * D + b]
          gbo[b] += g
          for (let c = 0; c < D; c++) gWo[c * D + b] += blk.ctx[i * D + c] * g
        }
      }
      blk.dq.fill(0)
      blk.dk.fill(0)
      blk.dv.fill(0)
      const scaleA = 1 / Math.sqrt(dh)
      for (let h = 0; h < H; h++) {
        const hoff = h * dh
        for (let i = 0; i < N; i++) {
          const row = h * N * N + i * N
          // dA[j] = dctx_i^h · v_j^h ; dv_j^h += A[i,j] dctx_i^h
          let dot = 0
          for (let j = 0; j < N; j++) {
            let s = 0
            const a = blk.attn[row + j]
            for (let c = 0; c < dh; c++) {
              const dc = blk.dctx[i * D + hoff + c]
              s += dc * blk.v[j * D + hoff + c]
              blk.dv[j * D + hoff + c] += a * dc
            }
            blk.dA[j] = s
            dot += a * s
          }
          for (let j = 0; j < N; j++) {
            const dS = blk.attn[row + j] * (blk.dA[j] - dot) * scaleA
            if (dS === 0) continue
            for (let c = 0; c < dh; c++) {
              blk.dq[i * D + hoff + c] += dS * blk.k[j * D + hoff + c]
              blk.dk[j * D + hoff + c] += dS * blk.q[i * D + hoff + c]
            }
          }
        }
      }
      // du1 = dq Wq^T + dk Wk^T + dv Wv^T; dW* += u1^T d*.
      const Wq = blk.Wq.value
      const Wk = blk.Wk.value
      const Wv = blk.Wv.value
      const gWq = blk.Wq.grad
      const gWk = blk.Wk.grad
      const gWv = blk.Wv.grad
      const du1 = blk.dctx // reuse: dctx no longer needed
      for (let i = 0; i < N; i++) {
        for (let a = 0; a < D; a++) {
          let g = 0
          const u = blk.u1[i * D + a]
          for (let b = 0; b < D; b++) {
            const dqb = blk.dq[i * D + b]
            const dkb = blk.dk[i * D + b]
            const dvb = blk.dv[i * D + b]
            g += dqb * Wq[a * D + b] + dkb * Wk[a * D + b] + dvb * Wv[a * D + b]
            gWq[a * D + b] += u * dqb
            gWk[a * D + b] += u * dkb
            gWv[a * D + b] += u * dvb
          }
          du1[i * D + a] = g
        }
      }
      // dxin = dx1 (residual) + LN1back(du1). Write into blk.du (dout is consumed).
      const dxin = blk.du
      dxin.set(dx1)
      for (let i = 0; i < N; i++) {
        layerNormBackRow(du1, i * D, D, blk.g1.value, blk.xhat1, blk.rstd1[i], blk.g1.grad, blk.be1.grad, dxin)
      }
      dxOut = dxin
    }

    // Embedding backward.
    const dx0 = dxOut ?? this.dpooledBroadcast()
    const gWe = this.We.grad
    const gbe = this.be.grad
    const gpos = this.pos.grad
    for (let i = 0; i < N; i++) {
      for (let b = 0; b < D; b++) {
        const g = dx0[i * D + b]
        gbe[b] += g
        gpos[i * D + b] += g
        for (let f = 0; f < F; f++) gWe[f * D + b] += this.feats[i * F + f] * g
      }
    }
    return loss
  }

  /** Zero-block network: the pooled gradient reaches the embedding directly. */
  private dpooledBroadcast(): Float64Array {
    const { N, D } = this
    const out = new Float64Array(N * D)
    for (let i = 0; i < N; i++) for (let b = 0; b < D; b++) out[i * D + b] = this.dpooled[b] / N
    return out
  }

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
