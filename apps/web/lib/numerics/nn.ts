/**
 * lib/numerics/nn.ts — the small pieces every hand-written network in this
 * repo shares: a parameter tensor with its gradient and Adam moments, one
 * Adam update, seeded Glorot initialisation, sigmoid, and the binary
 * cross-entropy head. Consumers: the surface-code decoders (lib/qec/mlp.ts,
 * lib/qec/transformer.ts), the learned ZNE extrapolator
 * (lib/workbench/mitigation.ts) and the QML reality check's MLP and VQC
 * trainers (lib/workbench/qml.ts). One Adam, so the optimiser the pages
 * compare against each other is literally the same code.
 *
 * Everything is plain Float64Array arithmetic. No library — the point of the
 * labs is that a reader can see every multiply.
 */

export type Param = {
  name: string
  value: Float64Array
  grad: Float64Array
  /** Adam moments. */
  m: Float64Array
  v: Float64Array
}

export function param(name: string, size: number): Param {
  return {
    name,
    value: new Float64Array(size),
    grad: new Float64Array(size),
    m: new Float64Array(size),
    v: new Float64Array(size),
  }
}

/** Uniform(−a, a) with a = sqrt(6 / (fanIn + fanOut)) — Glorot, from the seeded stream. */
export function glorot(p: Param, fanIn: number, fanOut: number, rand: () => number): void {
  const a = Math.sqrt(6 / (fanIn + fanOut))
  for (let i = 0; i < p.value.length; i++) p.value[i] = (rand() * 2 - 1) * a
}

export function zeroGrads(params: Param[]): void {
  for (const p of params) p.grad.fill(0)
}

export type AdamOptions = { lr: number; beta1?: number; beta2?: number; eps?: number }

/** One Adam update over every parameter, `grad` assumed already averaged over the batch. */
export function adamStep(params: Param[], step: number, opts: AdamOptions): void {
  const b1 = opts.beta1 ?? 0.9
  const b2 = opts.beta2 ?? 0.999
  const eps = opts.eps ?? 1e-8
  const c1 = 1 - Math.pow(b1, step)
  const c2 = 1 - Math.pow(b2, step)
  for (const p of params) {
    const { value, grad, m, v } = p
    for (let i = 0; i < value.length; i++) {
      const g = grad[i]
      m[i] = b1 * m[i] + (1 - b1) * g
      v[i] = b2 * v[i] + (1 - b2) * g * g
      value[i] -= (opts.lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + eps)
    }
  }
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

/** Binary cross-entropy from a logit, numerically stable. */
export function bceFromLogit(z: number, y: number): number {
  return Math.max(z, 0) - z * y + Math.log(1 + Math.exp(-Math.abs(z)))
}

/** Detector bits as the ±1 inputs the networks see. */
export function toSigned(det: Uint8Array, out: Float64Array, offset: number): void {
  for (let i = 0; i < det.length; i++) out[offset + i] = det[i] ? 1 : -1
}

/** Parameter count, for the page's "this is how small it is" line. */
export function paramCount(params: Param[]): number {
  let n = 0
  for (const p of params) n += p.value.length
  return n
}
