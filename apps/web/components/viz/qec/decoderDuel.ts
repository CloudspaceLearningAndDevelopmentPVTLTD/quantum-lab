/**
 * The decoder duel: a repetition code, IID bit-flip noise, and two decoders that
 * see nothing but the syndrome — a majority-vote lookup and a small neural network
 * trained in the browser.
 *
 * ── The code ────────────────────────────────────────────────────────────────────
 *
 * The distance-d repetition code: d data bits, logical 0̄ = 00…0, logical 1̄ = 11…1.
 * The d−1 stabilisers are adjacent-pair parities, s_i = e_i ⊕ e_{i+1}. Exactly two
 * error patterns are consistent with any syndrome — a candidate chain and its
 * bitwise complement — and decoding is nothing more than choosing between them.
 * The residual e ⊕ ĉ always has a trivial syndrome, so it is either the identity
 * or the logical operator (all ones): a decoder here can only be right or
 * logically wrong, never sloppy.
 *
 * ── The honest part, stated up front ────────────────────────────────────────────
 *
 * For a repetition code under IID bit-flip noise at p < ½, majority vote IS the
 * maximum-likelihood decoder, and it coincides with minimum-weight perfect
 * matching on the 1-D syndrome graph: the two consistent patterns differ only in
 * weight, and the lighter one is strictly more probable. So the neural decoder in
 * this duel CANNOT win — at best it converges to the same decisions. That is the
 * pedagogical point, not a flaw: learned decoders earn their keep on real codes
 * (surface codes, correlated noise, measurement errors), where the lookup table
 * has 2^(d²−1) rows and matching stops being provably optimal. Here, where the
 * optimum is computable in a line of code, you can watch a genuinely trained
 * network climb to it and verify the ceiling exists. The page's copy repeats this;
 * a version of this duel that let the network "win" would be rigged.
 *
 * ── The network ─────────────────────────────────────────────────────────────────
 *
 * A real 2-layer perceptron — (d−1) syndrome bits → tanh hidden layer → sigmoid —
 * trained by streaming SGD on freshly sampled noise, seeded, in well under the
 * page's 1–2 s budget. It predicts one bit: whether the true error is the
 * canonical candidate (first bit 0) or its complement. No pretrained weights, no
 * table lookup in disguise; `decoderDuel.test.ts` checks the trained accuracy
 * against majority's on a held-out seeded set, and that training is deterministic
 * given its seed.
 */

import { mulberry32 } from '@/lib/quantum'

/** The distances the page offers. The engine accepts any odd d ≥ 3. */
export const DUEL_DISTANCES = [3, 5, 7] as const

function assertDistance(d: number): void {
  if (!Number.isInteger(d) || d < 3 || d % 2 === 0) {
    // Even d has majority ties, which would force an arbitrary tie-break and
    // make "majority is optimal" false as stated. Refusing beats hedging.
    throw new Error(`repetition code distance must be an odd integer >= 3, got ${d}`)
  }
}

/** IID bit-flip errors at rate p on d data bits. */
export function sampleErrors(d: number, p: number, rand: () => number): Uint8Array {
  const e = new Uint8Array(d)
  for (let i = 0; i < d; i++) if (rand() < p) e[i] = 1
  return e
}

/** Adjacent-pair parities: the only thing either decoder is ever shown. */
export function syndromeOf(errors: Uint8Array): Uint8Array {
  const s = new Uint8Array(errors.length - 1)
  for (let i = 0; i < s.length; i++) s[i] = errors[i] ^ errors[i + 1]
  return s
}

/**
 * The consistent error pattern whose first bit is 0, by prefix-XOR of the
 * syndrome. The only other consistent pattern is its complement.
 */
export function canonicalError(syndrome: Uint8Array): Uint8Array {
  const e = new Uint8Array(syndrome.length + 1)
  for (let i = 0; i < syndrome.length; i++) e[i + 1] = e[i] ^ syndrome[i]
  return e
}

function weightOf(a: Uint8Array): number {
  let w = 0
  for (const v of a) w += v
  return w
}

export type Decision = {
  /** The decoder's guess for the true error's first bit — the whole decision. */
  firstBit: 0 | 1
  /** The proposed correction; residual e ⊕ correction is 0̄ or 1̄. */
  correction: Uint8Array
}

/**
 * Majority vote, phrased as syndrome decoding: take the lighter of the two
 * consistent patterns. Equivalent to majority vote on the raw bits, and — for
 * this code, at p < ½ — equal to both maximum likelihood and MWPM. d odd means
 * no ties.
 */
export function majorityDecode(d: number, syndrome: Uint8Array): Decision {
  assertDistance(d)
  const cand = canonicalError(syndrome)
  if (2 * weightOf(cand) > d) {
    const comp = new Uint8Array(d)
    for (let i = 0; i < d; i++) comp[i] = cand[i] ^ 1
    return { firstBit: 1, correction: comp }
  }
  return { firstBit: 0, correction: cand }
}

/**
 * The exact logical error rate of the optimal (majority) decoder:
 * P(more than half the bits flip) = Σ_{k>(d−1)/2} C(d,k) p^k (1−p)^{d−k}.
 * Drawn on the chart as the ceiling both contestants are chasing.
 */
export function analyticLogicalRate(d: number, p: number): number {
  assertDistance(d)
  let total = 0
  for (let k = (d + 1) / 2; k <= d; k++) {
    total += binomial(d, k) * Math.pow(p, k) * Math.pow(1 - p, d - k)
  }
  return total
}

function binomial(n: number, k: number): number {
  let out = 1
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// The perceptron
// ─────────────────────────────────────────────────────────────────────────────

export type Perceptron = {
  d: number
  hidden: number
  /** Row-major hidden × (d−1). */
  w1: Float64Array
  b1: Float64Array
  w2: Float64Array
  b2: number
  /** SGD steps actually taken — each one a freshly sampled noisy shot. */
  steps: number
  /** Noise rate the training stream was sampled at. */
  trainedAt: number
}

export type TrainOptions = {
  hidden?: number
  steps?: number
  learningRate?: number
}

/**
 * Streaming SGD: every step samples a fresh error pattern at rate p, shows the
 * network the syndrome (as ±1), and nudges it toward the true first bit with the
 * binary-cross-entropy gradient. Deterministic given `seed` — initial weights,
 * every sample and the step order all come from one mulberry32 stream.
 *
 * The defaults (16 hidden units, 60 000 steps) train in roughly a quarter of a
 * second and are deliberately not tuned to the bone: the point is a network that
 * visibly learns, not a fourth decimal place.
 */
export function trainPerceptron(
  d: number,
  p: number,
  seed: number,
  opts: TrainOptions = {}
): Perceptron {
  assertDistance(d)
  const nIn = d - 1
  const hidden = opts.hidden ?? 16
  const steps = opts.steps ?? 60_000
  const lr0 = opts.learningRate ?? 0.15
  const rand = mulberry32(seed)

  const w1 = new Float64Array(hidden * nIn)
  const b1 = new Float64Array(hidden)
  const w2 = new Float64Array(hidden)
  // Small symmetric init from the same seeded stream as the data.
  for (let i = 0; i < w1.length; i++) w1[i] = (rand() - 0.5) * 0.8
  for (let i = 0; i < hidden; i++) w2[i] = (rand() - 0.5) * 0.8
  let b2 = 0

  const x = new Float64Array(nIn)
  const h = new Float64Array(hidden)

  for (let step = 0; step < steps; step++) {
    const errors = sampleErrors(d, p, rand)
    const syndrome = syndromeOf(errors)
    for (let i = 0; i < nIn; i++) x[i] = syndrome[i] ? 1 : -1
    const y = errors[0]

    // Forward.
    for (let j = 0; j < hidden; j++) {
      let acc = b1[j]
      for (let i = 0; i < nIn; i++) acc += w1[j * nIn + i] * x[i]
      h[j] = Math.tanh(acc)
    }
    let z = b2
    for (let j = 0; j < hidden; j++) z += w2[j] * h[j]
    const yHat = 1 / (1 + Math.exp(-z))

    // Backward: d(BCE)/dz = yHat − y; tanh' = 1 − h². Learning rate decays
    // linearly to a tenth so late rare-syndrome samples refine, not thrash.
    const lr = lr0 * (1 - (0.9 * step) / steps)
    const dz = yHat - y
    for (let j = 0; j < hidden; j++) {
      const dh = dz * w2[j] * (1 - h[j] * h[j])
      w2[j] -= lr * dz * h[j]
      b1[j] -= lr * dh
      for (let i = 0; i < nIn; i++) w1[j * nIn + i] -= lr * dh * x[i]
    }
    b2 -= lr * dz
  }

  return { d, hidden, w1, b1, w2, b2, steps, trainedAt: p }
}

/** P(true error's first bit is 1 | syndrome), as the network sees it. */
export function netPredict(net: Perceptron, syndrome: Uint8Array): number {
  const nIn = net.d - 1
  let z = net.b2
  for (let j = 0; j < net.hidden; j++) {
    let acc = net.b1[j]
    for (let i = 0; i < nIn; i++) acc += net.w1[j * nIn + i] * (syndrome[i] ? 1 : -1)
    z += net.w2[j] * Math.tanh(acc)
  }
  return 1 / (1 + Math.exp(-z))
}

/** The network's decision, in the same shape as majority's. */
export function netDecode(net: Perceptron, syndrome: Uint8Array): Decision {
  const cand = canonicalError(syndrome)
  if (netPredict(net, syndrome) > 0.5) {
    const comp = new Uint8Array(net.d)
    for (let i = 0; i < net.d; i++) comp[i] = cand[i] ^ 1
    return { firstBit: 1, correction: comp }
  }
  return { firstBit: 0, correction: cand }
}

// ─────────────────────────────────────────────────────────────────────────────
// The duel
// ─────────────────────────────────────────────────────────────────────────────

export type DuelShot = {
  errors: Uint8Array
  syndrome: Uint8Array
  /** What each contestant guessed for the first bit, and the truth. */
  majorityBit: 0 | 1
  netBit: 0 | 1
  actualBit: 0 | 1
  /** A wrong first-bit guess IS a logical error — see the header. */
  majorityFail: boolean
  netFail: boolean
}

/** One noisy shot, decoded by both contestants from the same syndrome. */
export function runDuelShot(
  d: number,
  p: number,
  net: Perceptron,
  rand: () => number
): DuelShot {
  const errors = sampleErrors(d, p, rand)
  const syndrome = syndromeOf(errors)
  const actualBit = errors[0] as 0 | 1
  const majorityBit = majorityDecode(d, syndrome).firstBit
  const netBit = netDecode(net, syndrome).firstBit
  return {
    errors,
    syndrome,
    majorityBit,
    netBit,
    actualBit,
    majorityFail: majorityBit !== actualBit,
    netFail: netBit !== actualBit,
  }
}

export type DuelStats = {
  shots: number
  majorityFailures: number
  netFailures: number
}

/**
 * A seeded batch evaluation — the whole duel, without the animation. The lab
 * runs the same `runDuelShot` incrementally; the tests run this.
 */
export function evaluateDuel(
  d: number,
  p: number,
  net: Perceptron,
  shots: number,
  seed: number
): DuelStats {
  const rand = mulberry32(seed)
  const stats: DuelStats = { shots: 0, majorityFailures: 0, netFailures: 0 }
  for (let i = 0; i < shots; i++) {
    const shot = runDuelShot(d, p, net, rand)
    stats.shots++
    if (shot.majorityFail) stats.majorityFailures++
    if (shot.netFail) stats.netFailures++
  }
  return stats
}
