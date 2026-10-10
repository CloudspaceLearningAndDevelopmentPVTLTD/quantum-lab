/**
 * lib/qec/model.ts — the noise model and the detector layout the Decoder Lab decodes.
 *
 * ── The code ────────────────────────────────────────────────────────────────────
 *
 * The rotated surface code from components/viz/surface/code.ts, at distance 3, 5 or
 * 7. That module's tests prove the lattice is a code (every stabiliser pair commutes,
 * the logicals commute with the stabilisers and anticommute with each other), so
 * nothing here re-derives the layout — it is imported, and the two pages share it.
 *
 * ── The noise ───────────────────────────────────────────────────────────────────
 *
 * Depolarising noise on every data qubit: with probability p the qubit suffers an X,
 * a Y or a Z, each with probability p/3. A Y is an X and a Z on the same qubit, which
 * is exactly the correlation that decoding the two channels independently throws
 * away — and one of the things a learned decoder, shown both channels' detectors,
 * is free to pick up.
 *
 * Optionally, a measurement error q: every stabiliser measurement outcome is
 * flipped independently with probability q. Once measurements can lie, one round
 * is not decodable — a single flipped bit looks exactly like a real defect — so
 * with q > 0 the experiment is the standard phenomenological memory: d rounds of
 * (data noise, noisy measurement), then one final round of perfect measurement.
 * Decoders are shown DETECTION EVENTS, the XOR of consecutive rounds' outcomes,
 * because a persistent data error fires a stabiliser in every round after it and
 * the difference is what localises it in time.
 *
 * ── The task ────────────────────────────────────────────────────────────────────
 *
 * The Z-basis memory experiment on one logical qubit, decoded for both Pauli types:
 * a decoder wins the shot when it correctly predicts whether the accumulated X
 * error flips Z̄ AND whether the accumulated Z error flips X̄. This is the framing
 * of AlphaQubit (Bausch et al., Nature 2024): predict the logical observable from
 * the detection-event history, not "find the error".
 */

import { buildSurfaceCode, type SurfaceCode, type Stabiliser } from '@/components/viz/surface/code'

export type Distance = 3 | 5 | 7
export const DISTANCES: readonly Distance[] = [3, 5, 7]

export type NoiseConfig = {
  d: Distance
  /** Depolarising probability per data qubit per round. */
  p: number
  /** Measurement-flip probability per stabiliser per round. 0 = perfect extraction. */
  q: number
}

/**
 * Which stabilisers detect which errors, and where the detectors sit in the flat
 * arrays every decoder consumes. Channel 'X' means "X errors" (detected by Z-type
 * stabilisers, threatening Z̄); channel 'Z' means "Z errors" (detected by X-type
 * stabilisers, threatening X̄).
 */
export type Layout = {
  d: Distance
  /** Noisy measurement rounds. 1 with perfect extraction, d otherwise. */
  rounds: number
  /** Detector layers per channel: rounds, plus the final perfect round when q > 0. */
  layers: number
  /** Stabilisers of the detecting type, per channel. */
  stabsX: Stabiliser[]
  stabsZ: Stabiliser[]
  /** Detector count per channel = layers × stabilisers of that type. */
  sizeX: number
  sizeZ: number
  /** Detector index for (layer, stabiliser typeIndex): t * nStabs + s. */
  code: SurfaceCode
}

const codeCache = new Map<number, SurfaceCode>()

/** The lattice for a distance, built once per process. */
export function codeFor(d: Distance): SurfaceCode {
  let code = codeCache.get(d)
  if (!code) {
    code = buildSurfaceCode(d)
    codeCache.set(d, code)
  }
  return code
}

export function roundsFor(d: Distance, q: number): number {
  return q > 0 ? d : 1
}

export function buildLayout(d: Distance, q: number): Layout {
  const code = codeFor(d)
  const rounds = roundsFor(d, q)
  const layers = q > 0 ? rounds + 1 : rounds
  const stabsX = code.byType.Z
  const stabsZ = code.byType.X
  return {
    d,
    rounds,
    layers,
    stabsX,
    stabsZ,
    sizeX: layers * stabsX.length,
    sizeZ: layers * stabsZ.length,
    code,
  }
}

export type Shot = {
  /** Detection events for X errors (Z-type stabilisers), layer-major. */
  detX: Uint8Array
  /** Detection events for Z errors (X-type stabilisers), layer-major. */
  detZ: Uint8Array
  /** Whether the accumulated X error anticommutes with Z̄ — the Z-memory failure bit. */
  flipX: 0 | 1
  /** Whether the accumulated Z error anticommutes with X̄. */
  flipZ: 0 | 1
  /** Final accumulated errors, for drawing. */
  errX: Uint8Array
  errZ: Uint8Array
}

function parityOn(errors: Uint8Array, support: number[]): 0 | 1 {
  let s = 0
  for (const q of support) s ^= errors[q]
  return s as 0 | 1
}

function measure(stabs: Stabiliser[], errors: Uint8Array, q: number, rand: () => number, out: Uint8Array): void {
  for (let i = 0; i < stabs.length; i++) {
    let parity = 0
    for (const qb of stabs[i].qubits) parity ^= errors[qb]
    if (q > 0 && rand() < q) parity ^= 1
    out[i] = parity
  }
}

/**
 * One shot of the memory experiment. `rand` is the only source of randomness, so
 * a seeded stream makes the whole experiment reproducible.
 */
export function sampleShot(layout: Layout, p: number, q: number, rand: () => number): Shot {
  const { code, stabsX, stabsZ, rounds, layers } = layout
  const n = code.numData
  const errX = new Uint8Array(n)
  const errZ = new Uint8Array(n)
  const nX = stabsX.length
  const nZ = stabsZ.length
  const detX = new Uint8Array(layers * nX)
  const detZ = new Uint8Array(layers * nZ)
  const prevX = new Uint8Array(nX)
  const prevZ = new Uint8Array(nZ)
  const curX = new Uint8Array(nX)
  const curZ = new Uint8Array(nZ)
  const third = p / 3

  const record = (t: number): void => {
    for (let s = 0; s < nX; s++) {
      detX[t * nX + s] = curX[s] ^ prevX[s]
      prevX[s] = curX[s]
    }
    for (let s = 0; s < nZ; s++) {
      detZ[t * nZ + s] = curZ[s] ^ prevZ[s]
      prevZ[s] = curZ[s]
    }
  }

  for (let t = 0; t < rounds; t++) {
    for (let qb = 0; qb < n; qb++) {
      const r = rand()
      if (r < p) {
        // Uniform over X, Y, Z. Y is both.
        if (r < third) errX[qb] ^= 1
        else if (r < 2 * third) {
          errX[qb] ^= 1
          errZ[qb] ^= 1
        } else errZ[qb] ^= 1
      }
    }
    measure(stabsX, errX, q, rand, curX)
    measure(stabsZ, errZ, q, rand, curZ)
    record(t)
  }
  if (layers > rounds) {
    // Final perfect round: no data noise, no measurement error.
    measure(stabsX, errX, 0, rand, curX)
    measure(stabsZ, errZ, 0, rand, curZ)
    record(rounds)
  }

  return {
    detX,
    detZ,
    // An X chain flips Z̄ when it overlaps Z̄'s support an odd number of times.
    flipX: parityOn(errX, code.logicalZ),
    flipZ: parityOn(errZ, code.logicalX),
    errX,
    errZ,
  }
}

/** What every decoder returns: its guess for the two logical-flip bits. */
export type Prediction = { flipX: 0 | 1; flipZ: 0 | 1 }

export type DecoderName = 'lookup' | 'mwpm' | 'mlp' | 'transformer'

export interface Decoder {
  readonly name: DecoderName
  predict(detX: Uint8Array, detZ: Uint8Array): Prediction
}

/** A shot is a failure when either logical bit is guessed wrong. */
export function failed(pred: Prediction, shot: Shot): boolean {
  return pred.flipX !== shot.flipX || pred.flipZ !== shot.flipZ
}

/** Per-channel error probability under depolarising p: X-or-Y is 2p/3. */
export function channelRate(p: number): number {
  return (2 * p) / 3
}
