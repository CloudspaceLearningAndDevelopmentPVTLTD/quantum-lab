import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_N,
  applyQFT,
  attemptFactor,
  buildPeriodFinding,
  convergents,
  coprimeBases,
  expectedPeaks,
  gcd,
  modExpTable,
  modPow,
  multiplicativeOrder,
  periodFromMeasurement,
  registerSizes,
  sampleCounting,
} from './period'
import { mulberry32, StateVector } from '@/lib/quantum'

/** Reference DFT with the same convention applyQFT claims: Σ_x e^{2πixy/M}|y⟩ / √M. */
function referenceQFT(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const M = re.length
  const outRe = new Float64Array(M)
  const outIm = new Float64Array(M)
  const norm = 1 / Math.sqrt(M)
  for (let y = 0; y < M; y++) {
    let sr = 0
    let si = 0
    for (let x = 0; x < M; x++) {
      const angle = (2 * Math.PI * x * y) / M
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      sr += re[x] * c - im[x] * s
      si += re[x] * s + im[x] * c
    }
    outRe[y] = sr * norm
    outIm[y] = si * norm
  }
  return { re: outRe, im: outIm }
}

describe('applyQFT', () => {
  it('matches the defining transform on every basis state, for n = 1..5', () => {
    for (let n = 1; n <= 5; n++) {
      const M = 1 << n
      for (let x = 0; x < M; x++) {
        const re = new Float64Array(M)
        const im = new Float64Array(M)
        re[x] = 1
        const want = referenceQFT(re.slice(), im.slice())
        applyQFT(re, im, n)
        for (let y = 0; y < M; y++) {
          expect(re[y]).toBeCloseTo(want.re[y], 12)
          expect(im[y]).toBeCloseTo(want.im[y], 12)
        }
      }
    }
  })

  it('matches the defining transform on a random superposition', () => {
    const n = 6
    const M = 1 << n
    const rand = mulberry32(7)
    const re = new Float64Array(M)
    const im = new Float64Array(M)
    let norm = 0
    for (let i = 0; i < M; i++) {
      re[i] = rand() * 2 - 1
      im[i] = rand() * 2 - 1
      norm += re[i] * re[i] + im[i] * im[i]
    }
    const s = 1 / Math.sqrt(norm)
    for (let i = 0; i < M; i++) {
      re[i] *= s
      im[i] *= s
    }
    const want = referenceQFT(re.slice(), im.slice())
    applyQFT(re, im, n)
    for (let y = 0; y < M; y++) {
      expect(re[y]).toBeCloseTo(want.re[y], 12)
      expect(im[y]).toBeCloseTo(want.im[y], 12)
    }
  })

  it('agrees with the same circuit built on lib/quantum StateVector', () => {
    // Cross-check against the product's own simulator. If applyQFT's tight
    // Float64Array kernels ever drift from the gate semantics everything else on
    // this site uses, this is what catches it.
    const n = 4
    const M = 1 << n
    const x = 11
    const sv = StateVector.fromAmplitudes(
      Array.from({ length: M }, (_, i) => ({ re: i === x ? 1 : 0, im: 0 }))
    )
    for (let k = n - 1; k >= 0; k--) {
      sv.applySingle('H', k)
      for (let m = k - 1; m >= 0; m--) {
        sv.applyControlled('P', [m], k, Math.PI / 2 ** (k - m))
      }
    }
    for (let k = 0; k < n >> 1; k++) sv.apply({ name: 'SWAP', qubits: [k, n - 1 - k] })

    const re = new Float64Array(M)
    const im = new Float64Array(M)
    re[x] = 1
    applyQFT(re, im, n)

    for (let y = 0; y < M; y++) {
      expect(re[y]).toBeCloseTo(sv.amplitude(y).re, 12)
      expect(im[y]).toBeCloseTo(sv.amplitude(y).im, 12)
    }
  })

  it('rejects a length that does not match n', () => {
    expect(() => applyQFT(new Float64Array(8), new Float64Array(8), 4)).toThrow(/expected 16/)
  })
})

describe('number theory helpers', () => {
  it('modPow agrees with naive repeated multiplication', () => {
    for (const N of SUPPORTED_N) {
      for (const a of coprimeBases(N).slice(0, 6)) {
        let naive = 1 % N
        for (let e = 0; e < 40; e++) {
          expect(modPow(a, e, N)).toBe(naive)
          naive = (naive * a) % N
        }
      }
    }
  })

  it('multiplicativeOrder returns the least r with a^r = 1', () => {
    for (const N of SUPPORTED_N) {
      for (const a of coprimeBases(N)) {
        const r = multiplicativeOrder(a, N)
        expect(r).not.toBeNull()
        expect(modPow(a, r as number, N)).toBe(1)
        for (let k = 1; k < (r as number); k++) expect(modPow(a, k, N)).not.toBe(1)
      }
    }
  })

  it('every supported N is odd, composite and not a prime power', () => {
    for (const N of SUPPORTED_N) {
      expect(N % 2).toBe(1)
      const factors = new Set<number>()
      let m = N
      for (let p = 2; p <= m; p++) {
        while (m % p === 0) {
          factors.add(p)
          m /= p
        }
      }
      // Two distinct primes: Shor's reduction to order finding needs both, and the
      // page offers no N where it would silently not apply.
      expect(factors.size).toBeGreaterThanOrEqual(2)
    }
  })

  it('convergents of 5/8 are the textbook expansion', () => {
    // 5/8 = [0; 1, 1, 1, 2] -> 0/1, 1/1, 1/2, 2/3, 5/8.
    expect(convergents(5, 8)).toEqual([
      { p: 0, q: 1 },
      { p: 1, q: 1 },
      { p: 1, q: 2 },
      { p: 2, q: 3 },
      { p: 5, q: 8 },
    ])
  })
})

describe('buildPeriodFinding', () => {
  it('collapses the counting register onto an arithmetic progression of step r', () => {
    const pf = buildPeriodFinding(15, 7, mulberry32(3))
    expect(pf.trueOrder).toBe(4)
    expect(pf.survivors.length).toBeGreaterThan(1)
    for (let i = 1; i < pf.survivors.length; i++) {
      expect(pf.survivors[i] - pf.survivors[i - 1]).toBe(pf.trueOrder)
    }
    // Every survivor really does share the measured f value.
    for (const x of pf.survivors) expect(pf.f[x]).toBe(pf.measuredWork)
  })

  it('produces a normalised spectrum whose mass sits on multiples of M/r', () => {
    for (const [N, a] of [
      [15, 7],
      [21, 2],
      [33, 5],
      [35, 3],
    ] as const) {
      const pf = buildPeriodFinding(N, a, mulberry32(N))
      let total = 0
      for (const p of pf.spectrum) total += p
      expect(total).toBeCloseTo(1, 10)

      const r = pf.trueOrder as number
      const peaks = new Set(expectedPeaks(pf.sizes.counting, r))
      // Mass within one bin of a peak. The period rarely divides 2^n exactly, so the
      // comb is not perfectly sharp — this is why the number below is not 1.0.
      let onPeak = 0
      for (let y = 0; y < pf.spectrum.length; y++) {
        if (peaks.has(y) || peaks.has(y - 1) || peaks.has(y + 1)) onPeak += pf.spectrum[y]
      }
      expect(onPeak).toBeGreaterThan(0.75)
    }
  })

  it('is exactly the QFT of the collapsed state, not a fitted comb', () => {
    // Rebuild the post-measurement state from the reported survivors and transform it
    // with the independent reference DFT. This is the test that would fail if
    // buildPeriodFinding ever short-circuited to "draw spikes at M/r".
    const pf = buildPeriodFinding(21, 2, mulberry32(11))
    const M = pf.sizes.M
    const re = new Float64Array(M)
    const im = new Float64Array(M)
    const amp = 1 / Math.sqrt(pf.survivors.length)
    for (const x of pf.survivors) re[x] = amp
    const want = referenceQFT(re, im)
    for (let y = 0; y < M; y++) {
      expect(pf.spectrum[y]).toBeCloseTo(want.re[y] ** 2 + want.im[y] ** 2, 10)
    }
  })

  it('refuses a base that is not coprime to N', () => {
    expect(() => buildPeriodFinding(15, 5)).toThrow(/coprime/)
  })
})

describe('end to end: the spectrum really does factor N', () => {
  it('recovers a factor of every supported N within a bounded number of shots', () => {
    for (const N of SUPPORTED_N) {
      const rand = mulberry32(N * 17 + 1)
      let factored: [number, number] | null = null
      // 40 shots is generous; the point is that it terminates, not that it is fast.
      for (let shot = 0; shot < 40 && !factored; shot++) {
        const bases = coprimeBases(N)
        const a = bases[Math.floor(rand() * bases.length)]
        const pf = buildPeriodFinding(N, a, rand)
        const c = sampleCounting(pf.spectrum, rand)
        const r = periodFromMeasurement(c, pf.sizes.counting, N, a)
        if (r === null) continue
        const attempt = attemptFactor(a, r, N)
        if (attempt.ok) factored = attempt.factors
      }
      expect(factored, `no factor found for N=${N}`).not.toBeNull()
      const [p, q] = factored as [number, number]
      expect(p * q).toBe(N)
      expect(p).toBeGreaterThan(1)
      expect(q).toBeGreaterThan(1)
    }
  })

  it('periodFromMeasurement never returns a value that is not a period', () => {
    const N = 33
    const a = 5
    const pf = buildPeriodFinding(N, a, mulberry32(5))
    for (let c = 0; c < pf.sizes.M; c++) {
      const r = periodFromMeasurement(c, pf.sizes.counting, N, a)
      if (r !== null) expect(modPow(a, r, N)).toBe(1)
    }
  })

  it('attemptFactor reports the two real failure modes rather than hiding them', () => {
    // a = 14, N = 15: order 2, and 14^1 = 14 = N − 1, so the difference of squares is
    // trivial. At most half of all bases fail like this (for N = 15 it is the only
    // one of the seven coprime bases that does) and it is not a bug.
    expect(multiplicativeOrder(14, 15)).toBe(2)
    expect(attemptFactor(14, 2, 15)).toEqual({ ok: false, reason: 'minus-one' })
    // a = 2, N = 33 has the *even* order 10 and still fails, because
    // 2^5 = 32 = N - 1. Evenness is necessary, not sufficient.
    expect(multiplicativeOrder(2, 33)).toBe(10)
    expect(modPow(2, 5, 33)).toBe(32)
    expect(attemptFactor(2, 10, 33)).toEqual({ ok: false, reason: 'minus-one' })
    // a = 5, N = 33 has the same order 10 and does work: 5^5 = 23, gcd(22, 33) = 11.
    expect(multiplicativeOrder(5, 33)).toBe(10)
    expect(attemptFactor(5, 10, 33)).toEqual({ ok: true, factors: [11, 3] })
    // An odd order can never be used.
    expect(attemptFactor(2, 5, 31)).toEqual({ ok: false, reason: 'odd-period' })
  })
})

describe('register sizes are the honest ones', () => {
  it('gives 2^n >= N^2, which is what makes the continued fraction unique', () => {
    for (const N of SUPPORTED_N) {
      const s = registerSizes(N)
      expect(s.M).toBeGreaterThanOrEqual(N * N)
      expect(s.counting).toBe(2 * s.work)
      expect(s.jointAmplitudes).toBe(2 ** (s.counting + s.work))
    }
  })

  it('N = 55 is an 18-qubit joint register — the number quoted on the page', () => {
    const s = registerSizes(55)
    expect(s.counting).toBe(12)
    expect(s.work).toBe(6)
    expect(s.jointAmplitudes).toBe(262144)
  })

  it('modExpTable is periodic with the multiplicative order', () => {
    const table = modExpTable(7, 15, 8)
    const r = multiplicativeOrder(7, 15) as number
    for (let x = 0; x + r < table.length; x++) expect(table[x + r]).toBe(table[x])
  })
})
