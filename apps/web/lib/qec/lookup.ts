/**
 * lib/qec/lookup.ts — the lookup-table decoder, distance 3 only.
 *
 * Every distinct detector pattern is a key; the value is a count of how often each
 * of the four logical outcomes (no flip, X̄, Z̄, both) followed it in the training
 * samples. Decoding is a majority vote per key. With enough samples this converges
 * to the exact maximum-likelihood decoder for the noise it was trained on — it is,
 * in a real sense, the best decoder that exists for d = 3 with perfect syndrome
 * extraction, and lookup.test.ts checks its exact failure rate against an
 * independent enumeration of all 4⁹ error patterns.
 *
 * Why d = 3 only: with perfect extraction the key space is 2⁸ = 256 patterns, and
 * a few thousand samples fill it. At d = 5 it is 2²⁴ ≈ 17 million; at d = 7,
 * 2⁴⁸. With measurement noise the exponent multiplies by the number of rounds.
 * The table does not scale — which is the whole reason the other three decoders
 * exist. An unseen key falls back to "no flip", and the decoder reports how often
 * that happened.
 */

import type { Decoder, Prediction, Shot } from './model'

export class LookupDecoder implements Decoder {
  readonly name = 'lookup' as const
  private table = new Map<string, Uint32Array>()
  samples = 0
  /** Predictions that hit a key the table never saw. */
  misses = 0
  lookups = 0

  private key(detX: Uint8Array, detZ: Uint8Array): string {
    // Detector arrays are short at d = 3 (8 bits, or 32 with four rounds).
    let s = ''
    for (let i = 0; i < detX.length; i++) s += detX[i]
    s += '|'
    for (let i = 0; i < detZ.length; i++) s += detZ[i]
    return s
  }

  /** Record one labelled sample. */
  observe(shot: Shot): void {
    const k = this.key(shot.detX, shot.detZ)
    let counts = this.table.get(k)
    if (!counts) {
      counts = new Uint32Array(4)
      this.table.set(k, counts)
    }
    counts[shot.flipX | (shot.flipZ << 1)]++
    this.samples++
  }

  predict(detX: Uint8Array, detZ: Uint8Array): Prediction {
    this.lookups++
    const counts = this.table.get(this.key(detX, detZ))
    if (!counts) {
      this.misses++
      return { flipX: 0, flipZ: 0 }
    }
    let best = 0
    for (let c = 1; c < 4; c++) if (counts[c] > counts[best]) best = c
    return { flipX: (best & 1) as 0 | 1, flipZ: ((best >> 1) & 1) as 0 | 1 }
  }

  get keys(): number {
    return this.table.size
  }
}
