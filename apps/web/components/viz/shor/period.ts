/**
 * Shor's algorithm: the period-finding core, computed for real.
 *
 * ── What is quantum here and what is not ────────────────────────────────────────
 *
 * Shor's algorithm is mostly classical number theory with one quantum subroutine
 * bolted into the middle. This module keeps the two apart deliberately, because the
 * single most common misunderstanding of Shor is that "a quantum computer factors
 * numbers". It does not. It finds the period of a periodic function; everything
 * before and after that is arithmetic you could do on paper.
 *
 *   CLASSICAL   pick N, pick a coprime to a, check gcd(a, N) — `gcd`, `randomBase`
 *   QUANTUM     prepare Σ_x |x⟩|a^x mod N⟩, measure the work register,
 *               QFT the counting register, measure it — `buildPeriodFinding`,
 *               `applyQFT`, `sampleCounting`
 *   CLASSICAL   continued fractions on c/2^n to get r, then gcd(a^(r/2) ± 1, N)
 *               — `periodFromMeasurement`, `attemptFactor`
 *
 * ── What is simulated exactly, and what is not ──────────────────────────────────
 *
 * The counting register is a genuine statevector of 2^n complex amplitudes, and the
 * QFT applied to it is the actual gate sequence (Hadamards and controlled phase
 * rotations, then the bit-reversal swaps) — not a library FFT dressed up as one.
 * `qft.test.ts` checks it against the defining sum Σ_x e^{2πixy/2^n}|y⟩ to 1e-12.
 *
 * The oracle is NOT decomposed into gates. The joint state
 *
 *     |ψ⟩ = 2^(-n/2) Σ_x |x⟩ ⊗ |a^x mod N⟩
 *
 * is written down exactly — it is fully determined by the classical table
 * f(x) = a^x mod N — and the work-register measurement is applied to it with the
 * Born rule. This is exact physics, not an approximation: the post-measurement
 * counting state really is uniform over {x : f(x) = y}. What is skipped is the
 * *compilation* of modular exponentiation into adders and multipliers, which is an
 * engineering detail of how you build the oracle, not part of what it computes.
 *
 * ── Why N is small, with the actual numbers ─────────────────────────────────────
 *
 * `registerSizes(N)` returns them. For the largest N offered here, N = 55: the
 * counting register needs n = 2·ceil(log2 55) = 12 qubits and the work register
 * ceil(log2 55) = 6, so the joint register is 18 qubits — 262,144 complex
 * amplitudes, 4.2 MB as float64 pairs, and that is *before* you decompose the
 * oracle into gates that would need ancillas on top. RSA-2048 would need roughly
 * 4096 counting qubits and a comparable work register: 2^6000-odd amplitudes, which
 * is not a hardware problem or a funding problem, it is more numbers than there are
 * atoms. That gap is the whole reason quantum hardware is interesting, and it is why
 * this page stops at two-digit N.
 */

/** Composite, odd, not a prime power — the cases where Shor's reduction applies. */
export const SUPPORTED_N: readonly number[] = [15, 21, 33, 35, 39, 51, 55]

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a))
  let y = Math.abs(Math.trunc(b))
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/**
 * base^exp mod m by repeated squaring.
 *
 * Plain `number` arithmetic is safe here only because m ≤ 55: the widest product is
 * (m-1)² < 2^12, far inside the 2^53 exact-integer range. Raise SUPPORTED_N past
 * 94906265 and this must become BigInt — the failure would be silent, giving wrong
 * residues rather than an error.
 */
export function modPow(base: number, exp: number, m: number): number {
  if (m === 1) return 0
  let result = 1
  let b = base % m
  let e = exp
  while (e > 0) {
    if (e & 1) result = (result * b) % m
    b = (b * b) % m
    e >>= 1
  }
  return result
}

/**
 * The true multiplicative order of a mod N, found by brute force.
 *
 * This is the answer the quantum subroutine is supposed to discover, computed the
 * expensive way so the page can mark a run right or wrong. It is NOT used to produce
 * the quantum result — that would make the whole visualization a lie. It is only ever
 * compared against it.
 */
export function multiplicativeOrder(a: number, N: number): number | null {
  if (gcd(a, N) !== 1) return null
  let x = a % N
  for (let r = 1; r <= N; r++) {
    if (x === 1) return r
    x = (x * a) % N
  }
  return null
}

/** Every a in [2, N) with gcd(a, N) = 1 — the bases the quantum step can be run on. */
export function coprimeBases(N: number): number[] {
  const out: number[] = []
  for (let a = 2; a < N; a++) if (gcd(a, N) === 1) out.push(a)
  return out
}

export type RegisterSizes = {
  /** Counting register width, n = 2·ceil(log2 N). */
  counting: number
  /** Work register width, ceil(log2 N). */
  work: number
  /** 2^counting — the size of the statevector this module actually allocates. */
  M: number
  /** Amplitudes a gate-level simulation of the whole thing would need. */
  jointAmplitudes: number
}

/**
 * n = 2·ceil(log2 N) is the standard choice: it makes 2^n ≥ N², which guarantees the
 * continued-fraction step can separate r from any other denominator below N. Halve it
 * and the convergent is no longer unique, and the algorithm quietly stops working for
 * reasons that look like bad luck.
 */
export function registerSizes(N: number): RegisterSizes {
  const work = Math.ceil(Math.log2(N))
  const counting = 2 * work
  return { counting, work, M: 2 ** counting, jointAmplitudes: 2 ** (counting + work) }
}

/** f(x) = a^x mod N for x = 0 … 2^n − 1, built iteratively (one multiply per step). */
export function modExpTable(a: number, N: number, n: number): Uint32Array {
  const M = 2 ** n
  const table = new Uint32Array(M)
  let v = 1 % N
  for (let x = 0; x < M; x++) {
    table[x] = v
    v = (v * a) % N
  }
  return table
}

/**
 * The quantum Fourier transform, in place, as the gate sequence.
 *
 * Convention: QFT|x⟩ = 2^(-n/2) Σ_y exp(2πi·xy/2^n)|y⟩, with basis index bit k
 * carrying weight 2^k.
 *
 * The circuit is H on qubit k followed by controlled-phase π/2^(k−m) from every
 * lower qubit m, for k from n−1 down to 0. That leaves qubit k holding the factor
 * (|0⟩ + e^{2πi x/2^(k+1)}|1⟩) — which is the factor output bit n−1−k needs — so the
 * bit-reversal swaps at the end are part of the transform, not a tidying step.
 * Delete them and you get the QFT of the bit-reversed input, which still shows peaks
 * and still looks plausible on screen while being wrong.
 */
export function applyQFT(re: Float64Array, im: Float64Array, n: number): void {
  const dim = 1 << n
  if (re.length !== dim || im.length !== dim) {
    throw new Error(`applyQFT: expected ${dim} amplitudes, got ${re.length}/${im.length}`)
  }
  const invSqrt2 = Math.SQRT1_2

  for (let k = n - 1; k >= 0; k--) {
    // Hadamard on qubit k.
    const bit = 1 << k
    for (let i = 0; i < dim; i++) {
      if (i & bit) continue
      const j = i | bit
      const ar = re[i]
      const ai = im[i]
      const br = re[j]
      const bi = im[j]
      re[i] = (ar + br) * invSqrt2
      im[i] = (ai + bi) * invSqrt2
      re[j] = (ar - br) * invSqrt2
      im[j] = (ai - bi) * invSqrt2
    }
    // Controlled phase from each lower qubit m onto qubit k.
    for (let m = k - 1; m >= 0; m--) {
      const angle = Math.PI / 2 ** (k - m)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const mask = bit | (1 << m)
      for (let i = 0; i < dim; i++) {
        if ((i & mask) !== mask) continue
        const ar = re[i]
        const ai = im[i]
        re[i] = ar * cos - ai * sin
        im[i] = ar * sin + ai * cos
      }
    }
  }

  // Bit reversal.
  for (let k = 0; k < n >> 1; k++) {
    const hi = 1 << (n - 1 - k)
    const lo = 1 << k
    for (let i = 0; i < dim; i++) {
      // Swap amplitudes whose bits k and n−1−k differ; visit each pair once by
      // only acting when bit k is set and bit n−1−k is clear.
      if ((i & lo) === 0 || (i & hi) !== 0) continue
      const j = (i & ~lo) | hi
      const tr = re[i]
      const ti = im[i]
      re[i] = re[j]
      im[i] = im[j]
      re[j] = tr
      im[j] = ti
    }
  }
}

export type PeriodFinding = {
  N: number
  a: number
  sizes: RegisterSizes
  /** f(x) = a^x mod N, the classical table that defines the oracle. */
  f: Uint32Array
  /** The work-register value the simulated measurement returned. */
  measuredWork: number
  /** Probability of that outcome — count(y)/2^n, the Born rule on the joint state. */
  measuredWorkProbability: number
  /** The x values that survived the work measurement: an arithmetic progression. */
  survivors: number[]
  /** |amplitude|² over the counting register AFTER the QFT. Sums to 1. */
  spectrum: Float64Array
  /** The order of a mod N, computed classically. What the spectrum should reveal. */
  trueOrder: number | null
}

/**
 * Run the quantum subroutine once: build the joint state, measure the work register,
 * QFT the counting register, and return its measurement distribution.
 *
 * `rand` is injected so a run is reproducible — the page seeds it from a counter, and
 * the tests seed it to fix the branch.
 */
export function buildPeriodFinding(
  N: number,
  a: number,
  rand: () => number = Math.random
): PeriodFinding {
  if (gcd(a, N) !== 1) {
    throw new Error(`buildPeriodFinding: a=${a} is not coprime to N=${N}; no period to find`)
  }
  const sizes = registerSizes(N)
  const { counting: n, M } = sizes
  const f = modExpTable(a, N, n)

  // Measure the work register. p(y) = |{x : f(x) = y}| / M, straight from the joint
  // state's amplitudes, all of which are 2^(-n/2).
  const counts = new Map<number, number>()
  for (let x = 0; x < M; x++) counts.set(f[x], (counts.get(f[x]) ?? 0) + 1)
  const u = rand() * M
  let acc = 0
  let measuredWork = f[0]
  for (const [value, count] of counts) {
    acc += count
    if (u < acc) {
      measuredWork = value
      break
    }
  }
  const survivorCount = counts.get(measuredWork) ?? 1

  // Collapse the counting register onto the survivors, uniformly.
  const re = new Float64Array(M)
  const im = new Float64Array(M)
  const amp = 1 / Math.sqrt(survivorCount)
  const survivors: number[] = []
  for (let x = 0; x < M; x++) {
    if (f[x] === measuredWork) {
      re[x] = amp
      survivors.push(x)
    }
  }

  applyQFT(re, im, n)

  const spectrum = new Float64Array(M)
  for (let y = 0; y < M; y++) spectrum[y] = re[y] * re[y] + im[y] * im[y]

  return {
    N,
    a,
    sizes,
    f,
    measuredWork,
    measuredWorkProbability: survivorCount / M,
    survivors,
    spectrum,
    trueOrder: multiplicativeOrder(a, N),
  }
}

/** Sample one counting-register measurement from the post-QFT distribution. */
export function sampleCounting(spectrum: Float64Array, rand: () => number): number {
  const u = rand()
  let acc = 0
  for (let y = 0; y < spectrum.length; y++) {
    acc += spectrum[y]
    if (u < acc) return y
  }
  // Float64 rounding can leave acc a few ulps below 1; fall back to the last state
  // with any amplitude rather than returning 0, which would be a silent bias.
  for (let y = spectrum.length - 1; y >= 0; y--) if (spectrum[y] > 0) return y
  return 0
}

/** Convergents p/q of `num/den`, from the continued-fraction expansion. */
export function convergents(num: number, den: number): { p: number; q: number }[] {
  const out: { p: number; q: number }[] = []
  let n0 = num
  let d0 = den
  // h_{-2} = 0, h_{-1} = 1, k_{-2} = 1, k_{-1} = 0 — the standard seeds for
  // h_i = a_i·h_{i-1} + h_{i-2}. Swapping these two pairs produces q/p instead of
  // p/q, which still terminates and still looks like a list of fractions.
  let pPrev = 0
  let qPrev = 1
  let p = 1
  let q = 0
  // Bounded: the Euclidean algorithm on (num, den) terminates, but guard anyway so a
  // pathological input cannot hang a render.
  for (let guard = 0; guard < 64 && d0 !== 0; guard++) {
    const term = Math.floor(n0 / d0)
    const pNext = term * p + pPrev
    const qNext = term * q + qPrev
    pPrev = p
    qPrev = q
    p = pNext
    q = qNext
    out.push({ p, q })
    const rem = n0 - term * d0
    n0 = d0
    d0 = rem
  }
  return out
}

/**
 * The classical post-processing: turn a measured c into a candidate period.
 *
 * c/2^n is close to s/r for some integer s, and the closest fraction with denominator
 * below N is unique because 2^n ≥ N². So expand c/2^n as a continued fraction and take
 * the largest convergent denominator q < N that actually satisfies a^q ≡ 1 (mod N).
 *
 * Returns null for the outcomes that genuinely fail — c = 0 carries no information at
 * all, and some c land on a convergent whose denominator is a proper divisor of r. On
 * hardware you would rerun; here the page counts how often that happens, because the
 * failure rate is part of what the algorithm is.
 */
export function periodFromMeasurement(c: number, n: number, N: number, a: number): number | null {
  const M = 2 ** n
  if (c === 0) return null
  for (const { q } of convergents(c, M).reverse()) {
    if (q > 1 && q < N && modPow(a, q, N) === 1) return q
  }
  return null
}

export type FactorAttempt =
  | { ok: true; factors: [number, number] }
  | { ok: false; reason: 'odd-period' | 'minus-one' | 'trivial-gcd' }

/**
 * The last classical step. Given an even period r with a^(r/2) ≢ −1 (mod N),
 * (a^(r/2) − 1)(a^(r/2) + 1) = a^r − 1 ≡ 0 (mod N), so N shares a factor with one of
 * them. Both excluded cases are real — at most half of all bases fail this way (the
 * standard bound; for N = 15 only one of the seven coprime bases, a = 14, does) —
 * which is why Shor is a randomised algorithm you rerun, not a formula.
 */
export function attemptFactor(a: number, r: number, N: number): FactorAttempt {
  if (r % 2 !== 0) return { ok: false, reason: 'odd-period' }
  const half = modPow(a, r / 2, N)
  if (half === N - 1) return { ok: false, reason: 'minus-one' }
  const f1 = gcd(half - 1, N)
  const f2 = gcd(half + 1, N)
  for (const f of [f1, f2]) {
    if (f > 1 && f < N) return { ok: true, factors: [f, N / f] }
  }
  return { ok: false, reason: 'trivial-gcd' }
}

/** The peaks the spectrum should show: y ≈ s·2^n/r for s = 0 … r−1. */
export function expectedPeaks(n: number, r: number): number[] {
  const M = 2 ** n
  const out: number[] = []
  for (let s = 0; s < r; s++) out.push(Math.round((s * M) / r))
  return out
}
