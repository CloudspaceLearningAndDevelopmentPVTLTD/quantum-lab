/**
 * uncertainty.ts — the Fourier numerics behind /visualizations/uncertainty.
 *
 * The uncertainty principle is usually taught as a rule: σx·σp ≥ ħ/2, memorise
 * it. It is not a rule. It is a theorem about Fourier transforms — a function
 * and its transform cannot both be narrow, and the bound is saturated by
 * exactly one shape, the Gaussian. This module builds a wavefunction on a
 * grid, takes its actual Fourier transform, and measures both widths, so the
 * page can display a number the reader watched being computed rather than a
 * number asserted at them.
 *
 * NOTHING here special-cases the Gaussian. σx and σp are computed the same way
 * for every shape — second moments of |ψ(x)|² and of |φ(p)|². That the Gaussian
 * comes out at exactly ħ/2 and everything else comes out above is a result, not
 * a branch.
 *
 * UNITS: ħ = 1 and m = 1. The page says so. Working in natural units keeps the
 * arithmetic honest — with ħ = 1.055e−34 floating around, the reader could not
 * tell a correct product from a unit slip, and neither could the tests.
 *
 * GRID: N must be a power of two (radix-2 FFT). The box has length L with
 * periodic wrap; x runs over N points spaced dx = L/N, and the conjugate grid
 * is k_j = 2π j / L for j ∈ [−N/2, N/2). The largest representable momentum is
 * k_max = π/dx, so a packet narrower than a couple of grid spacings will alias
 * — `gridAdvice` below reports when the sampled shape is close to that edge,
 * and the page uses it to warn rather than silently drawing nonsense.
 */

/** ħ, in the natural units this whole module uses. */
export const HBAR = 1
/** Particle mass, for the free-evolution spreading law. */
export const MASS = 1

export type Complex = { re: Float64Array; im: Float64Array }

export type Grid = {
  n: number
  /** Box length. */
  L: number
  dx: number
  /** Position samples, centred on zero. */
  x: Float64Array
  /** Wavenumber samples in ascending order, k_j = 2πj/L for j ∈ [−N/2, N/2). */
  k: Float64Array
  dk: number
}

export function makeGrid(n: number, L: number): Grid {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`grid size must be a power of two, got ${n}`)
  const dx = L / n
  const dk = (2 * Math.PI) / L
  const x = new Float64Array(n)
  const k = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = (i - n / 2) * dx
    k[i] = (i - n / 2) * dk
  }
  return { n, L, dx, x, k, dk }
}

export function zeros(n: number): Complex {
  return { re: new Float64Array(n), im: new Float64Array(n) }
}

// ─────────────────────────────────────────────────────────────────────────────
// FFT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 *
 * `sign = -1` is the forward transform Σ ψ_n e^{−2πikn/N}; `sign = +1` is the
 * inverse (unscaled — the caller divides by N if it wants a true inverse). No
 * library: this is forty lines, runs a 1024-point transform in microseconds,
 * and `uncertainty.test.ts` pins it against a naive O(N²) DFT on random input.
 */
export function fft(a: Complex, sign: -1 | 1): void {
  const n = a.re.length
  if ((n & (n - 1)) !== 0) throw new Error('fft length must be a power of two')

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = a.re[i]
      a.re[i] = a.re[j]
      a.re[j] = t
      t = a.im[i]
      a.im[i] = a.im[j]
      a.im[j] = t
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const uRe = a.re[i + j]
        const uIm = a.im[i + j]
        const pRe = a.re[i + j + len / 2]
        const pIm = a.im[i + j + len / 2]
        const vRe = pRe * curRe - pIm * curIm
        const vIm = pRe * curIm + pIm * curRe
        a.re[i + j] = uRe + vRe
        a.im[i + j] = uIm + vIm
        a.re[i + j + len / 2] = uRe - vRe
        a.im[i + j + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/**
 * Flip the sign of every odd-indexed sample, in place.
 *
 * Doing this on BOTH sides of the transform is what centres the two grids on
 * zero: our x runs over (i − N/2)dx and our k over (j − N/2)dk, whereas a bare
 * DFT assumes both start at index 0. Writing out
 * k_j·x_n = 2π(j − N/2)(n − N/2)/N and expanding gives exactly
 * e^{−2πijn/N}·(−1)^j·(−1)^n, up to a constant global phase — so a pre-flip and
 * a post-flip replace the usual fftshift, and no reindexing is needed at all:
 * array slot i already means grid.k[i].
 *
 * Getting this wrong is the classic silent Fourier bug — the picture still
 * looks like a sensible momentum distribution, just half a Brillouin zone away
 * from where it belongs, and every width computed from it is nonsense. The
 * round-trip and centring tests exist to catch precisely that.
 */
export function alternateSigns(a: Complex): void {
  for (let i = 1; i < a.re.length; i += 2) {
    a.re[i] = -a.re[i]
    a.im[i] = -a.im[i]
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wavefunctions
// ─────────────────────────────────────────────────────────────────────────────

export type PacketShape = 'gaussian' | 'tophat' | 'triangle' | 'twoBumps' | 'hermite1' | 'hermite2'

export type PacketSpec = {
  shape: PacketShape
  /** Characteristic half-width in position. */
  width: number
  /** Central wavenumber: multiplies the packet by e^{i k₀ x}. */
  k0: number
  /**
   * Quadratic phase e^{i c x²/2} — an optical "chirp", and exactly what free
   * evolution builds up. It leaves |ψ(x)|² untouched and therefore leaves σx
   * untouched, while broadening the momentum distribution. It is the cleanest
   * possible demonstration that the trade-off is about PHASE structure, not
   * just about how wide the bump looks.
   */
  chirp: number
}

/** The unnormalised real envelope of each shape, before phase factors. */
function envelope(shape: PacketShape, x: number, w: number): number {
  switch (shape) {
    case 'gaussian':
      // |ψ|² ∝ exp(−x²/2w²), so σx = w exactly.
      return Math.exp(-(x * x) / (4 * w * w))
    case 'tophat':
      return Math.abs(x) <= w ? 1 : 0
    case 'triangle':
      return Math.max(0, 1 - Math.abs(x) / w)
    case 'twoBumps': {
      const s = w / 2
      const a = Math.exp(-((x - w) * (x - w)) / (4 * s * s))
      const b = Math.exp(-((x + w) * (x + w)) / (4 * s * s))
      return a + b
    }
    case 'hermite1':
      // First excited harmonic-oscillator state, H₁(u)·e^{−u²/2} with u = x/w√2.
      return (x / w) * Math.exp(-(x * x) / (4 * w * w))
    case 'hermite2': {
      const u = x / (w * Math.SQRT2)
      return (4 * u * u - 2) * Math.exp(-(u * u) / 2)
    }
  }
}

/** Build ψ(x) on the grid, normalised so Σ|ψ|²dx = 1. */
export function makePacket(grid: Grid, spec: PacketSpec): Complex {
  const psi = zeros(grid.n)
  for (let i = 0; i < grid.n; i++) {
    const x = grid.x[i]
    const amp = envelope(spec.shape, x, spec.width)
    const phase = spec.k0 * x + (spec.chirp * x * x) / 2
    psi.re[i] = amp * Math.cos(phase)
    psi.im[i] = amp * Math.sin(phase)
  }
  normalizeInPlace(psi, grid.dx)
  return psi
}

export function normalizeInPlace(psi: Complex, dx: number): void {
  let sum = 0
  for (let i = 0; i < psi.re.length; i++) sum += psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]
  const total = sum * dx
  const s = total > 0 ? 1 / Math.sqrt(total) : 0
  for (let i = 0; i < psi.re.length; i++) {
    psi.re[i] *= s
    psi.im[i] *= s
  }
}

/**
 * φ(k), the momentum-space amplitude, on the shifted k grid.
 *
 * The discrete transform is scaled so that Σ|φ|²dk = 1 whenever Σ|ψ|²dx = 1 —
 * that is Parseval's theorem, and `uncertainty.test.ts` checks it holds rather
 * than assuming the scale factor was typed correctly. The e^{iπj} pre-twiddle
 * accounts for the position grid starting at −L/2 instead of 0; without it the
 * momentum distribution comes out with the right shape and the wrong phase,
 * which the widths would not notice but free evolution certainly would.
 */
export function momentumAmplitudes(grid: Grid, psi: Complex): Complex {
  const n = grid.n
  const a: Complex = { re: Float64Array.from(psi.re), im: Float64Array.from(psi.im) }
  alternateSigns(a)
  fft(a, -1)
  alternateSigns(a)
  // Σ|φ|²dk = 1 requires |φ| = |Σψ e^{−ikx}| · dx/√(2π), with ħ = 1.
  const scale = grid.dx / Math.sqrt(2 * Math.PI)
  for (let i = 0; i < n; i++) {
    a.re[i] *= scale
    a.im[i] *= scale
  }
  return a
}

/** |ψ|² on a grid, as a probability density (integrates to 1 against `step`). */
export function density(psi: Complex): Float64Array {
  const out = new Float64Array(psi.re.length)
  for (let i = 0; i < out.length; i++) out[i] = psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Moments
// ─────────────────────────────────────────────────────────────────────────────

export type Moments = { mean: number; sigma: number; total: number }

/** Mean and standard deviation of a density sampled on `coords` with spacing `step`. */
export function moments(coords: Float64Array, prob: Float64Array, step: number): Moments {
  let total = 0
  let m1 = 0
  let m2 = 0
  for (let i = 0; i < prob.length; i++) {
    const p = prob[i]
    total += p
    m1 += coords[i] * p
    m2 += coords[i] * coords[i] * p
  }
  if (total <= 0) return { mean: 0, sigma: 0, total: 0 }
  const mean = m1 / total
  const variance = Math.max(0, m2 / total - mean * mean)
  return { mean, sigma: Math.sqrt(variance), total: total * step }
}

export type Analysis = {
  grid: Grid
  psi: Complex
  phi: Complex
  positionDensity: Float64Array
  momentumDensity: Float64Array
  x: Moments
  /** In these units p = ħk = k, so this is both the momentum and the wavenumber spread. */
  p: Moments
  product: number
  /** σx·σp expressed in units of the ħ/2 floor. 1.000 means saturated. */
  ratio: number
}

/** Measure everything the page displays, from one wavefunction. */
export function analyze(grid: Grid, psi: Complex): Analysis {
  const phi = momentumAmplitudes(grid, psi)
  const positionDensity = density(psi)
  const momentumDensity = density(phi)
  const x = moments(grid.x, positionDensity, grid.dx)
  // p = ħk with ħ = 1, so the k grid is already the momentum grid.
  const p = moments(grid.k, momentumDensity, grid.dk)
  const product = x.sigma * p.sigma
  return {
    grid,
    psi,
    phi,
    positionDensity,
    momentumDensity,
    x,
    p,
    product,
    ratio: product / (HBAR / 2),
  }
}

/** The floor: σx·σp can never go below this. */
export const UNCERTAINTY_FLOOR = HBAR / 2

/**
 * The exact σx·σp for a chirped Gaussian, ħ√(¼ + c²w⁴).
 *
 * Derivation, because it is short and it is what makes this a real test rather
 * than a regression snapshot: for ψ ∝ e^{−x²/4w²}e^{icx²/2}, σx = w and
 * ψ′ = (−x/2w² + icx)ψ, so ⟨p²⟩ = ħ²⟨x²⟩(1/4w⁴ + c²) = ħ²(1/4w² + c²w²).
 * Multiply by σx² = w² and take the root. Equality with ħ/2 iff c = 0 — the
 * only minimum-uncertainty states are Gaussians with no quadratic phase.
 */
export function chirpedGaussianProduct(width: number, chirp: number): number {
  return HBAR * Math.sqrt(0.25 + chirp * chirp * Math.pow(width, 4))
}

/**
 * Free-particle evolution for time t, exactly: multiply each momentum component
 * by e^{−iħk²t/2m} and transform back.
 *
 * This is not an approximation and not a time-stepper — momentum is conserved
 * for a free particle, so each plane wave just accumulates its own phase. It is
 * also the payoff of the page: σp is untouched (the momentum distribution never
 * changes) while σx grows, so a released Gaussian leaves the ħ/2 floor
 * immediately and never comes back.
 */
export function freeEvolve(grid: Grid, psi: Complex, t: number): Complex {
  const n = grid.n
  const a: Complex = { re: Float64Array.from(psi.re), im: Float64Array.from(psi.im) }
  alternateSigns(a)
  fft(a, -1)
  alternateSigns(a)

  for (let i = 0; i < n; i++) {
    const k = grid.k[i]
    const ang = (-HBAR * k * k * t) / (2 * MASS)
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const re = a.re[i] * c - a.im[i] * s
    const im = a.re[i] * s + a.im[i] * c
    a.re[i] = re
    a.im[i] = im
  }

  alternateSigns(a)
  fft(a, 1)
  alternateSigns(a)
  for (let i = 0; i < n; i++) {
    a.re[i] /= n
    a.im[i] /= n
  }
  return a
}

/**
 * The textbook spreading law for a released minimum-uncertainty Gaussian:
 * σx(t) = σ₀√(1 + (ħt/2mσ₀²)²). Used by the test as an independent check on
 * `freeEvolve`, and by the page to label the curve.
 */
export function gaussianSpread(width: number, t: number): number {
  const r = (HBAR * t) / (2 * MASS * width * width)
  return width * Math.sqrt(1 + r * r)
}

/**
 * Whether the sampled packet actually fits the grid, in both directions.
 *
 * A shape that is narrower than a couple of grid points is aliased, and a shape
 * whose tails reach the edge of the box is wrapped — either one produces a
 * plausible-looking picture with a wrong number under it. The page shows this
 * as a warning instead of pretending.
 */
export function gridAdvice(
  grid: Grid,
  analysis: Analysis
): { ok: boolean; message: string | null } {
  const pointsAcross = analysis.x.sigma / grid.dx
  // How far the packet reaches toward the wall of the periodic box, counting
  // both its spread AND where it has drifted to — a released packet with a
  // push will hit the edge long before it is wide enough to.
  const reach = (Math.abs(analysis.x.mean) + 3 * analysis.x.sigma) / (grid.L / 2)
  const kFraction = (4 * analysis.p.sigma) / (Math.PI / grid.dx)
  if (pointsAcross < 2.5) {
    return { ok: false, message: 'Too narrow for this grid — the momentum tail is being aliased.' }
  }
  if (reach > 0.85) {
    return {
      ok: false,
      message: 'The packet has reached the edge of the box — evolution paused before it wraps.',
    }
  }
  if (kFraction > 0.9) {
    return { ok: false, message: 'The momentum distribution is running off the edge of the grid.' }
  }
  return { ok: true, message: null }
}
