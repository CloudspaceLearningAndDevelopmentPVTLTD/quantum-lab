import { describe, expect, it } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import { CLASSICAL_BOUND, TSIRELSON_BOUND } from '@/lib/viz/chsh'
import {
  E91_ALICE_ANGLES,
  E91_BOB_ANGLES,
  E91_DETECTION_FRACTION,
  QBER_ABORT,
  advanceE91,
  binaryEntropy,
  createE91Run,
  e91Role,
  e91Stats,
  expectedBb84Qber,
  expectedE91S,
  prepareSinglet,
  runBb84,
  runE91,
  secretKeyRate,
  sendBb84Qubit,
  sendE91Pair,
  type SettingIndex,
} from './qkd'

/**
 * Every expectation here is derived by hand, not read off the implementation:
 * the 50% sifting yield, the ¼ = ½ × ½ intercept-resend error rate, the 2p/3
 * flip rate of a depolarising channel, the 1 − 2h(Q) key rate and its 11.0%
 * root, the singlet's −cos(a − b), and the √2 that intercept-resend leaves of
 * Tsirelson's 2√2. Sampled quantities are checked within a stated number of
 * binomial standard errors on a fixed seed.
 */

const sigma = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n)

describe('key rate and the abort threshold', () => {
  it('binary entropy: h(0) = h(1) = 0, h(½) = 1, symmetric', () => {
    expect(binaryEntropy(0)).toBe(0)
    expect(binaryEntropy(1)).toBe(0)
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 12)
    expect(binaryEntropy(0.2)).toBeCloseTo(binaryEntropy(0.8), 12)
    // h(0.11) by hand: 0.11·log2(1/0.11) + 0.89·log2(1/0.89) = 0.3503 + 0.1496.
    expect(binaryEntropy(0.11)).toBeCloseTo(0.4999, 3)
  })

  it('1 − 2h(Q) is 1 on a clean channel and hits zero at Q ≈ 11.0%', () => {
    expect(secretKeyRate(0)).toBe(1)
    expect(secretKeyRate(0.105)).toBeGreaterThan(0.02)
    expect(secretKeyRate(0.115)).toBe(0)
    // Bisect for the root independently and check it is where the constant says.
    let lo = 0
    let hi = 0.5
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (1 - 2 * binaryEntropy(mid) > 0) lo = mid
      else hi = mid
    }
    expect(lo).toBeCloseTo(QBER_ABORT, 3)
    // Full intercept-resend is far past the threshold.
    expect(secretKeyRate(0.25)).toBe(0)
  })
})

describe('BB84 on the statevector simulator', () => {
  it('with no Eve and no noise the sifted key matches exactly and ~50% survives sifting', () => {
    const n = 6000
    const s = runBb84({ interceptFraction: 0, channelNoise: 0 }, n, 11)
    expect(s.sent).toBe(n)
    expect(s.errors).toBe(0)
    expect(s.qber).toBe(0)
    expect(Math.abs(s.siftedFraction - 0.5)).toBeLessThan(4 * sigma(0.5, n))
    expect(s.keyRate).toBe(1)
    expect(s.finalKeyBits).toBe(s.sifted)
    expect(s.verdict).toBe('secure')
  })

  it('a matched basis reads the bit with certainty, qubit by qubit', () => {
    // Structural check on individual qubits: on a clean, un-attacked channel an
    // error is impossible when the bases match, whatever the bits were.
    const rand = mulberry32(3)
    for (let i = 0; i < 2000; i++) {
      const q = sendBb84Qubit({ interceptFraction: 0, channelNoise: 0 }, rand)
      if (q.sifted) expect(q.bobBit).toBe(q.aliceBit)
      expect(q.eve).toBeNull()
      expect(q.noise).toBeNull()
    }
  })

  it('full intercept-resend gives QBER = 25% within statistical error', () => {
    const n = 8000
    const s = runBb84({ interceptFraction: 1, channelNoise: 0 }, n, 7)
    // ~4000 sifted bits; σ on a 25% rate is ≈ 0.7 percentage points.
    expect(Math.abs(s.qber - 0.25)).toBeLessThan(4 * sigma(0.25, s.sifted))
    expect(s.verdict).toBe('abort')
    expect(s.keyRate).toBe(0)
    expect(s.finalKeyBits).toBe(0)
  })

  it('every error Eve causes is on a qubit where she guessed the wrong basis', () => {
    const rand = mulberry32(19)
    let wrongBasis = 0
    let wrongBasisErrors = 0
    for (let i = 0; i < 4000; i++) {
      const q = sendBb84Qubit({ interceptFraction: 1, channelNoise: 0 }, rand)
      expect(q.eve).not.toBeNull()
      if (!q.sifted) continue
      if (q.eve!.basis === q.aliceBasis) {
        // Right guess: she is invisible, and she has the bit.
        expect(q.error).toBe(false)
        expect(q.eve!.bit).toBe(q.aliceBit)
      } else {
        wrongBasis++
        if (q.error) wrongBasisErrors++
      }
    }
    // Wrong guess: Bob's bit is a fair coin — half of these are errors.
    expect(Math.abs(wrongBasisErrors / wrongBasis - 0.5)).toBeLessThan(4 * sigma(0.5, wrongBasis))
  })

  it('Eve holds 75% of the sifted key she intercepted (½ certain + ½ × ½ lucky)', () => {
    const s = runBb84({ interceptFraction: 1, channelNoise: 0 }, 8000, 23)
    expect(Math.abs(s.eveKnowledge - 0.75)).toBeLessThan(4 * sigma(0.75, s.sifted))
  })

  it('QBER scales as f/4 with the intercepted fraction, crossing 11% near f = 44%', () => {
    for (const f of [0.2, 0.44, 0.8]) {
      const s = runBb84({ interceptFraction: f, channelNoise: 0 }, 8000, 31)
      expect(Math.abs(s.qber - f / 4)).toBeLessThan(4 * sigma(f / 4, s.sifted))
    }
    expect(runBb84({ interceptFraction: 0.2, channelNoise: 0 }, 8000, 32).verdict).toBe('secure')
    expect(runBb84({ interceptFraction: 0.8, channelNoise: 0 }, 8000, 33).verdict).toBe('abort')
    expect(expectedBb84Qber({ interceptFraction: 0.44, channelNoise: 0 })).toBeCloseTo(0.11, 12)
  })

  it('a depolarising channel alone flips 2p/3 of the sifted bits', () => {
    const p = 0.09
    const s = runBb84({ interceptFraction: 0, channelNoise: p }, 8000, 41)
    const expected = (2 * p) / 3
    expect(Math.abs(s.qber - expected)).toBeLessThan(4 * sigma(expected, s.sifted))
    // And the Pauli that flips is the one that does not commute with the basis.
    const rand = mulberry32(42)
    for (let i = 0; i < 3000; i++) {
      const q = sendBb84Qubit({ interceptFraction: 0, channelNoise: 0.5 }, rand)
      if (!q.sifted) continue
      const flips = q.aliceBasis === 0 ? q.noise === 'X' || q.noise === 'Y' : q.noise === 'Y' || q.noise === 'Z'
      expect(q.error).toBe(flips)
    }
  })

  it('Eve and noise combine as f/4 + (1 − f/2)(2p/3)', () => {
    const params = { interceptFraction: 0.5, channelNoise: 0.09 }
    const expected = 0.5 / 4 + (1 - 0.25) * ((2 * 0.09) / 3) // 0.125 + 0.045
    expect(expectedBb84Qber(params)).toBeCloseTo(0.17, 12)
    const s = runBb84(params, 8000, 51)
    expect(Math.abs(s.qber - expected)).toBeLessThan(4 * sigma(expected, s.sifted))
  })

  it('withholds a verdict until enough bits have been sifted', () => {
    expect(runBb84({ interceptFraction: 1, channelNoise: 0 }, 20, 1).verdict).toBe('pending')
  })
})

describe('E91 on the statevector simulator', () => {
  it('prepares the singlet (|01⟩ − |10⟩)/√2 up to a global phase', () => {
    const sv = prepareSinglet()
    const amps = sv.amplitudes()
    expect(amps[0].re).toBeCloseTo(0, 12)
    expect(amps[0].im).toBeCloseTo(0, 12)
    expect(amps[3].re).toBeCloseTo(0, 12)
    expect(amps[3].im).toBeCloseTo(0, 12)
    expect(sv.probability(1)).toBeCloseTo(0.5, 12)
    expect(sv.probability(2)).toBeCloseTo(0.5, 12)
    // Opposite sign on the two terms — that is what makes it the singlet rather than Ψ⁺.
    expect(amps[1].re * amps[2].re + amps[1].im * amps[2].im).toBeCloseTo(-0.5, 12)
    expect(sv.entanglementEntropy(0)).toBeCloseTo(1, 12)
  })

  it('sorts the nine setting combinations into 2 key, 4 CHSH, 3 discarded', () => {
    const tally = { key: 0, chsh: 0, discard: 0 }
    const chshIndices = new Set<number>()
    for (let ai = 0; ai < 3; ai++) {
      for (let bi = 0; bi < 3; bi++) {
        const r = e91Role(ai as SettingIndex, bi as SettingIndex)
        tally[r.role]++
        if (r.chshIndex !== null) chshIndices.add(r.chshIndex)
        if (r.role === 'key') expect(E91_ALICE_ANGLES[ai]).toBe(E91_BOB_ANGLES[bi])
      }
    }
    expect(tally).toEqual({ key: 2, chsh: 4, discard: 3 })
    expect(chshIndices.size).toBe(4)
  })

  it('each setting pair reproduces −cos(a − b) without Eve, and matched axes never agree', () => {
    const rand = mulberry32(61)
    const sums = new Array(9).fill(0)
    const counts = new Array(9).fill(0)
    for (let i = 0; i < 18000; i++) {
      const pair = sendE91Pair({ interceptFraction: 0 }, rand)
      const k = pair.ai * 3 + pair.bi
      sums[k] += pair.a * pair.b
      counts[k]++
      if (pair.role === 'key') expect(pair.a).toBe(-pair.b)
      expect(pair.eveAxis).toBeNull()
    }
    for (let ai = 0; ai < 3; ai++) {
      for (let bi = 0; bi < 3; bi++) {
        const k = ai * 3 + bi
        const e = sums[k] / counts[k]
        const ideal = -Math.cos(E91_ALICE_ANGLES[ai] - E91_BOB_ANGLES[bi])
        // Var of a ±1 mean is (1 − E²)/n.
        const se = Math.sqrt(Math.max(1e-9, 1 - ideal * ideal) / counts[k])
        expect(Math.abs(e - ideal), `E(${ai},${bi})`).toBeLessThan(4 * se + 1e-9)
      }
    }
  })

  it('with no Eve, |S| reaches 2√2 and the key is error-free', () => {
    const s = runE91({ interceptFraction: 0 }, 12000, 71)
    expect(Math.abs(s.chsh.sAbs - TSIRELSON_BOUND)).toBeLessThan(4 * s.chsh.se)
    expect(s.chsh.sAbs).toBeGreaterThan(CLASSICAL_BOUND)
    expect(s.keyErrors).toBe(0)
    expect(s.keyQber).toBe(0)
    expect(s.verdict).toBe('secure')
    // Key pairs are 2 of 9 combinations.
    expect(Math.abs(s.keyBits / s.sent - 2 / 9)).toBeLessThan(4 * sigma(2 / 9, s.sent))
  })

  it('full intercept-resend on Bob’s arm drops |S| from 2√2 to √2, below Bell’s bound', () => {
    // Derivation: after Eve measures along ε and forwards, the pair is a product
    // state with E(a,b) = −cos(a − ε)cos(b − ε). On Ekert's four CHSH pairs that
    // sums to −√2 for ε = 45°, 90° and 135° alike, so |S| = √2 whatever she picks.
    const s = runE91({ interceptFraction: 1 }, 12000, 81)
    expect(Math.abs(s.chsh.sAbs - Math.SQRT2)).toBeLessThan(4 * s.chsh.se)
    expect(s.chsh.sAbs).toBeLessThan(CLASSICAL_BOUND)
    expect(s.verdict).toBe('abort')
    expect(s.finalKeyBits).toBe(0)
    // She also corrupts the key: matched axes disagree whenever her axis differs.
    expect(s.keyErrors).toBeGreaterThan(0)
  })

  it('|S| falls linearly, √2(2 − f), and crosses 2 at f = 2 − √2', () => {
    expect(expectedE91S(0)).toBeCloseTo(TSIRELSON_BOUND, 12)
    expect(expectedE91S(1)).toBeCloseTo(Math.SQRT2, 12)
    expect(expectedE91S(E91_DETECTION_FRACTION)).toBeCloseTo(CLASSICAL_BOUND, 12)
    expect(E91_DETECTION_FRACTION).toBeCloseTo(0.5858, 4)
    for (const f of [0.3, 0.7]) {
      const s = runE91({ interceptFraction: f }, 12000, 90 + Math.round(f * 10))
      expect(Math.abs(s.chsh.sAbs - expectedE91S(f)), `f=${f}`).toBeLessThan(4 * s.chsh.se)
    }
    expect(runE91({ interceptFraction: 0.3 }, 12000, 93).verdict).toBe('secure')
    expect(runE91({ interceptFraction: 0.9 }, 12000, 94).verdict).toBe('abort')
  })

  it('a Bell violation alone is not a pass: a key QBER above 11% aborts even while |S| > 2', () => {
    // Every entangled pure pair violates CHSH, so |S| > 2 does not pin the
    // source to a singlet; the key must still survive 1 − 2h(Q). Build a run
    // with an untouched singlet (|S| ≈ 2√2) and a key with 15% errors on it —
    // "secure" with no distillable key would be a contradiction.
    const run = createE91Run({ interceptFraction: 0 }, 100)
    advanceE91(run, mulberry32(95), 6000)
    run.keyErrors = Math.round(0.15 * run.keyBits)
    const s = e91Stats(run)
    expect(s.chsh.sAbs).toBeGreaterThan(CLASSICAL_BOUND)
    expect(s.keyQber).toBeGreaterThan(QBER_ABORT)
    expect(s.keyRate).toBe(0)
    expect(s.verdict).toBe('abort')
    expect(s.finalKeyBits).toBe(0)
  })

  it('an intercepted key pair is error-free only when Eve happened to pick the matched axis', () => {
    const rand = mulberry32(101)
    let sameAxis = 0
    let sameAxisErrors = 0
    for (let i = 0; i < 6000; i++) {
      const pair = sendE91Pair({ interceptFraction: 1 }, rand)
      if (pair.role !== 'key') continue
      expect(pair.eveAxis).not.toBeNull()
      if (E91_BOB_ANGLES[pair.eveAxis!] === E91_BOB_ANGLES[pair.bi]) {
        sameAxis++
        if (pair.a === pair.b) sameAxisErrors++
      }
    }
    expect(sameAxis).toBeGreaterThan(100)
    expect(sameAxisErrors).toBe(0)
  })

  it('advanceE91 keeps a 3×3 count grid that sums to the pairs sent', () => {
    const run = createE91Run({ interceptFraction: 0.5 }, 50)
    advanceE91(run, mulberry32(5), 900)
    expect(run.grid.reduce((a, b) => a + b, 0)).toBe(900)
    expect(run.samples.length).toBe(18)
    for (const c of run.grid) expect(Math.abs(c - 100)).toBeLessThan(4 * Math.sqrt(100))
  })
})
