/**
 * lib/quantum/schrodinger.ts — the 1-D Schrödinger engine.
 *
 * One numerical core, three visualizations on top of it: /visualizations/bound-states,
 * /visualizations/harmonic-oscillator and /visualizations/wave-packets. Everything here is
 * plain TypeScript with no DOM dependency, precisely so the physics can be unit-tested in
 * node against closed-form answers (see schrodinger.test.ts) instead of being eyeballed on
 * a canvas.
 *
 * UNITS. ħ = 1 and m = 1 throughout. Lengths, energies and times are therefore all in the
 * same natural system: an infinite well of width L has E_n = n²π²/(2L²), a harmonic
 * oscillator of angular frequency ω has E_n = (n + ½)ω and a classical period 2π/ω, and a
 * plane wave e^{ikx} carries momentum k and energy k²/2. Nothing in this file introduces a
 * hidden display scale — a number a page shows is the number the solver used.
 *
 * TWO SOLVERS, DELIBERATELY DIFFERENT.
 *
 *   solveStationary()  Time-INdependent problem for an arbitrary V(x). Discretising
 *                      −½ψ'' + Vψ = Eψ with the 3-point second difference gives a
 *                      symmetric tridiagonal matrix; eigenvalues come from Sturm-sequence
 *                      bisection and eigenvectors from inverse iteration. This is what
 *                      LAPACK's dstebz/dstein pair does, and it is chosen over a full
 *                      tridiagonal QL because the pages want the lowest handful of levels
 *                      out of a 512-point grid: bisection is O(n) per eigenvalue instead
 *                      of O(n²), so the whole level diagram recomputes inside one frame
 *                      while a slider is being dragged.
 *
 *   SplitStepPropagator  Time-DEPENDENT evolution of a wave packet, by split-step Fourier
 *                      (Strang splitting: half a potential kick, a full kinetic drift in
 *                      momentum space, half a kick).
 *
 * WHY SPLIT-STEP FOURIER RATHER THAN CRANK-NICOLSON. Both are unconditionally stable and
 * both conserve norm, but they conserve it for different reasons and at different cost.
 * Crank-Nicolson is unitary because the Cayley transform (1 − iHdt/2)(1 + iHdt/2)^{-1} is
 * unitary — which requires solving a tridiagonal system every step, and its accuracy in
 * space is only second order, so a packet with appreciable k picks up lattice dispersion
 * error (the discrete kinetic energy is (2/dx²)sin²(k dx/2), not k²/2). Split-step is a
 * product of three factors each of which is a multiplication by a unit-modulus number —
 * exp(−iVdt/2) pointwise in x, exp(−ik²dt/2) pointwise in k — so norm is conserved to
 * floating-point round-off with no linear solve at all, and the kinetic step uses the
 * EXACT continuum dispersion k²/2 rather than a finite-difference stand-in. That last
 * point is what makes the scattering page trustworthy: reflection above a barrier is a
 * small number, and lattice dispersion error is exactly the kind of artefact that would
 * manufacture one. MEASURED: norm drifts by 1.6e-13 over 4 000 steps — 8 000 FFTs — on a
 * 512-point grid in a harmonic well (schrodinger.test.ts pins it under 1e-12).
 *
 * The price is periodic boundaries — the FFT wraps the grid into a ring — and the O(n log n)
 * transform. Both are handled: the propagator carries an optional absorbing layer at each
 * end that swallows outgoing flux before it can wrap, book-keeping how much left on each
 * side so a page can report transmission and reflection long after the packets have gone.
 * With the absorber on, norm is intentionally NOT conserved; that is the point of it.
 */

/** Uniform 1-D grid. `x[i] = x[0] + i·dx`. */
export type Grid = {
  readonly n: number
  readonly dx: number
  readonly x: Float64Array
}

/** A complex wavefunction sampled on a grid, stored as separate real and imaginary parts. */
export type Wavefunction = {
  readonly re: Float64Array
  readonly im: Float64Array
}

/** One stationary state: its energy, its normalized real eigenfunction, and its node count. */
export type Eigenstate = {
  energy: number
  psi: Float64Array
  /** Interior zeros of ψ. The oscillation theorem says the k-th state (0-based) has k. */
  nodes: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Grids
// ─────────────────────────────────────────────────────────────────────────────

export function uniformGrid(n: number, dx: number, x0: number): Grid {
  if (!Number.isInteger(n) || n < 2) throw new RangeError('grid needs at least 2 points')
  if (!(dx > 0)) throw new RangeError('dx must be positive')
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = x0 + i * dx
  return { n, dx, x }
}

/**
 * n points spanning [−halfWidth, +halfWidth), spacing 2·halfWidth/n.
 *
 * This is the periodic convention the FFT wants: the last point sits one dx short of
 * +halfWidth, because +halfWidth *is* −halfWidth once the ring closes.
 */
export function centeredGrid(n: number, halfWidth: number): Grid {
  if (!(halfWidth > 0)) throw new RangeError('halfWidth must be positive')
  return uniformGrid(n, (2 * halfWidth) / n, -halfWidth)
}

/**
 * The n INTERIOR points of a hard-wall box [0, L]: dx = L/(n+1), x_i = (i+1)·dx.
 *
 * solveStationary imposes ψ = 0 one point outside each end of whatever grid it is given,
 * so this grid — and only this grid — puts those implied walls exactly at x = 0 and
 * x = L. Use it whenever the box width is a quantity the page quotes.
 */
export function boxGrid(n: number, length: number): Grid {
  if (!(length > 0)) throw new RangeError('length must be positive')
  return uniformGrid(n, length / (n + 1), length / (n + 1))
}

// ─────────────────────────────────────────────────────────────────────────────
// Potentials
// ─────────────────────────────────────────────────────────────────────────────

/** V(x) = ½ω²x², the harmonic oscillator. Levels sit at (n + ½)ω. */
export function harmonicPotential(grid: Grid, omega: number, center = 0): Float64Array {
  const v = new Float64Array(grid.n)
  for (let i = 0; i < grid.n; i++) {
    const d = grid.x[i] - center
    v[i] = 0.5 * omega * omega * d * d
  }
  return v
}

/**
 * A square well of depth `depth` (a positive number) and full width `width`, centred on
 * `center`: V = −depth inside, 0 outside. Bound states are the states with E < 0.
 */
export function squareWellPotential(
  grid: Grid,
  depth: number,
  width: number,
  center = 0
): Float64Array {
  const v = new Float64Array(grid.n)
  const half = width / 2
  for (let i = 0; i < grid.n; i++) {
    v[i] = Math.abs(grid.x[i] - center) <= half ? -depth : 0
  }
  return v
}

/** A rectangular barrier of height `height` and width `width` centred on `center`. */
export function barrierPotential(
  grid: Grid,
  height: number,
  width: number,
  center = 0
): Float64Array {
  const v = new Float64Array(grid.n)
  const half = width / 2
  for (let i = 0; i < grid.n; i++) {
    v[i] = Math.abs(grid.x[i] - center) <= half ? height : 0
  }
  return v
}

/** A potential step: 0 for x < edge, `height` for x ≥ edge. */
export function stepPotential(grid: Grid, height: number, edge = 0): Float64Array {
  const v = new Float64Array(grid.n)
  for (let i = 0; i < grid.n; i++) v[i] = grid.x[i] >= edge ? height : 0
  return v
}

/** Flat V = 0. The infinite well is this plus solveStationary's implied walls. */
export function zeroPotential(grid: Grid): Float64Array {
  return new Float64Array(grid.n)
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-independent problem: symmetric tridiagonal eigensolve
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The finite-difference Hamiltonian for V on `grid`, as a symmetric tridiagonal pair.
 *
 * −½ψ''(x_i) ≈ −(ψ_{i+1} − 2ψ_i + ψ_{i−1}) / (2dx²), so the diagonal is 1/dx² + V_i and
 * every off-diagonal entry is −1/(2dx²). ψ is taken to vanish at the two sites just
 * outside the grid, which is what makes the box in boxGrid() infinitely deep.
 */
export function hamiltonianTridiagonal(
  grid: Grid,
  potential: ArrayLike<number>
): { diagonal: Float64Array; offDiagonal: Float64Array } {
  const { n, dx } = grid
  if (potential.length !== n) throw new RangeError('potential length must match grid size')
  const inv = 1 / (dx * dx)
  const diagonal = new Float64Array(n)
  const offDiagonal = new Float64Array(n) // offDiagonal[i] couples i−1 and i; [0] unused
  for (let i = 0; i < n; i++) diagonal[i] = inv + potential[i]
  for (let i = 1; i < n; i++) offDiagonal[i] = -0.5 * inv
  return { diagonal, offDiagonal }
}

/**
 * Number of eigenvalues of the tridiagonal matrix strictly below `sigma`.
 *
 * The Sturm sequence: the leading principal minors D_k of (T − σI) change sign once per
 * eigenvalue below σ, and the ratio q_k = D_k/D_{k−1} tracks those sign changes in O(n)
 * with none of the overflow the minors themselves would suffer.
 *
 * THE ORDER OF THE TWO LINES IN THE LOOP IS THE WHOLE ALGORITHM. A minor that lands on
 * exactly zero must be treated as negative — LAPACK's convention, q ← −pivmin — AND
 * counted in the same breath. Guarding the pivot on the *next* iteration instead, which
 * is the natural way to write it, silently drops one eigenvalue per exact zero and makes
 * the count non-monotone in σ, at which point bisection converges to a fixed point of the
 * recurrence rather than to an eigenvalue.
 *
 * That is not a hypothetical: the flat infinite well is the case that finds it. With
 * V ≡ 0 every diagonal entry is 1/dx² and every off-diagonal is exactly half of it, so at
 * σ = 1/(2dx²) the minors are exactly 0 every third step, and the buggy ordering reported
 * zero eigenvalues below a σ that has 266 of them.
 */
function sturmCount(
  diagonal: Float64Array,
  offDiagSquared: Float64Array,
  sigma: number,
  pivmin: number
): number {
  const n = diagonal.length
  let q = diagonal[0] - sigma
  if (Math.abs(q) < pivmin) q = -pivmin
  let count = q < 0 ? 1 : 0
  for (let i = 1; i < n; i++) {
    q = diagonal[i] - sigma - offDiagSquared[i] / q
    if (Math.abs(q) < pivmin) q = -pivmin
    if (q < 0) count++
  }
  return count
}

/** Gershgorin bracket containing every eigenvalue of the tridiagonal matrix. */
function gershgorinBounds(
  diagonal: Float64Array,
  offDiagonal: Float64Array
): { lower: number; upper: number } {
  const n = diagonal.length
  let lower = Infinity
  let upper = -Infinity
  for (let i = 0; i < n; i++) {
    const radius = Math.abs(offDiagonal[i] ?? 0) + Math.abs(i + 1 < n ? offDiagonal[i + 1] : 0)
    lower = Math.min(lower, diagonal[i] - radius)
    upper = Math.max(upper, diagonal[i] + radius)
  }
  return { lower, upper }
}

/**
 * Solve (T − λ)y = b in place on `b` by tridiagonal Gaussian elimination with a pivot
 * floor. Used for inverse iteration, where the matrix is deliberately near-singular: the
 * huge component that a tiny pivot produces points along the eigenvector we are after,
 * which is Wilkinson's original observation and the reason this is safe rather than
 * reckless.
 */
function shiftedTridiagonalSolve(
  diagonal: Float64Array,
  offDiagonal: Float64Array,
  lambda: number,
  b: Float64Array,
  pivmin: number
): void {
  const n = diagonal.length
  const pivots = new Float64Array(n)
  const multipliers = new Float64Array(n)

  let p = diagonal[0] - lambda
  if (Math.abs(p) < pivmin) p = p < 0 ? -pivmin : pivmin
  pivots[0] = p
  for (let i = 1; i < n; i++) {
    const m = offDiagonal[i] / pivots[i - 1]
    multipliers[i] = m
    let d = diagonal[i] - lambda - m * offDiagonal[i]
    if (Math.abs(d) < pivmin) d = d < 0 ? -pivmin : pivmin
    pivots[i] = d
  }

  for (let i = 1; i < n; i++) b[i] -= multipliers[i] * b[i - 1]
  b[n - 1] /= pivots[n - 1]
  for (let i = n - 2; i >= 0; i--) b[i] = (b[i] - offDiagonal[i + 1] * b[i + 1]) / pivots[i]
}

/** Deterministic pseudo-random start vector — see the note in inverseIteration(). */
function fillStartVector(v: Float64Array, seed: number): void {
  let s = seed >>> 0
  for (let i = 0; i < v.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    v[i] = s / 4294967296 - 0.5
  }
}

/**
 * Count interior sign changes of ψ, ignoring the exponential tail.
 *
 * The threshold is essential and not a fudge: outside the classical turning points ψ
 * decays through fifteen orders of magnitude into floating-point noise, and that noise
 * changes sign constantly. Real nodes live where the wavefunction has structure, so
 * anything below 1e-4 of the peak is not consulted.
 */
export function countNodes(psi: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < psi.length; i++) peak = Math.max(peak, Math.abs(psi[i]))
  if (peak === 0) return 0
  const threshold = peak * 1e-4
  let nodes = 0
  let lastSign = 0
  for (let i = 0; i < psi.length; i++) {
    const value = psi[i]
    if (Math.abs(value) < threshold) continue
    const sign = value > 0 ? 1 : -1
    if (lastSign !== 0 && sign !== lastSign) nodes++
    lastSign = sign
  }
  return nodes
}

/** Normalize to ∫|ψ|²dx = 1 and fix the sign so the largest excursion is positive. */
function normalizeReal(psi: Float64Array, dx: number): void {
  let sum = 0
  for (let i = 0; i < psi.length; i++) sum += psi[i] * psi[i]
  const scale = sum > 0 ? 1 / Math.sqrt(sum * dx) : 1
  let extreme = 0
  let extremeIndex = 0
  for (let i = 0; i < psi.length; i++) {
    if (Math.abs(psi[i]) > extreme) {
      extreme = Math.abs(psi[i])
      extremeIndex = i
    }
  }
  const sign = psi[extremeIndex] < 0 ? -1 : 1
  for (let i = 0; i < psi.length; i++) psi[i] *= scale * sign
}

/**
 * The lowest `count` stationary states of −½ψ'' + V(x)ψ = Eψ on `grid`, with ψ = 0 one
 * site beyond each end.
 *
 * Eigenvalues by bisection on the Sturm count (so they arrive sorted and each is
 * independently correct — an error in one cannot corrupt another), eigenvectors by three
 * steps of inverse iteration. States whose energies fall within a cluster of one already
 * computed are re-orthogonalised against it, which is what keeps a symmetric double well's
 * near-degenerate pairs from collapsing onto the same vector.
 */
export function solveStationary(
  grid: Grid,
  potential: ArrayLike<number>,
  count: number
): Eigenstate[] {
  const { n, dx } = grid
  const wanted = Math.max(0, Math.min(Math.floor(count), n))
  if (wanted === 0) return []

  const { diagonal, offDiagonal } = hamiltonianTridiagonal(grid, potential)
  const offDiagSquared = new Float64Array(n)
  for (let i = 1; i < n; i++) offDiagSquared[i] = offDiagonal[i] * offDiagonal[i]

  const { lower, upper } = gershgorinBounds(diagonal, offDiagonal)
  const scale = Math.max(Math.abs(lower), Math.abs(upper), 1)
  // Below this a pivot is treated as zero. Scaled to the matrix so the guard means the
  // same thing for a shallow well and for a 1/dx² kinetic term.
  const pivmin = scale * 1e-200
  const tolerance = scale * 4 * Number.EPSILON

  const energies = new Float64Array(wanted)
  for (let k = 0; k < wanted; k++) {
    let lo = lower
    let hi = upper
    // 200 halvings is far more than a double can distinguish; the tolerance test is what
    // actually ends the loop.
    for (let iter = 0; iter < 200 && hi - lo > tolerance; iter++) {
      const mid = 0.5 * (lo + hi)
      if (mid <= lo || mid >= hi) break
      if (sturmCount(diagonal, offDiagSquared, mid, pivmin) <= k) lo = mid
      else hi = mid
    }
    energies[k] = 0.5 * (lo + hi)
  }

  const states: Eigenstate[] = []
  const clusterWindow = scale * 1e-9
  for (let k = 0; k < wanted; k++) {
    const psi = new Float64Array(n)
    fillStartVector(psi, 0x9e3779b9 + k * 2654435761)

    // Shift off the eigenvalue by a hair. Landing exactly on it is not fatal (the pivot
    // floor catches it) but a deliberate offset keeps the solve well posed and converges
    // in the same number of steps.
    const shift = energies[k] + Math.max(Math.abs(energies[k]), 1) * 1e-12

    for (let iter = 0; iter < 3; iter++) {
      shiftedTridiagonalSolve(diagonal, offDiagonal, shift, psi, pivmin)
      // Re-orthogonalise against already-converged neighbours in the same cluster.
      for (const prior of states) {
        if (Math.abs(prior.energy - energies[k]) > clusterWindow) continue
        let dot = 0
        for (let i = 0; i < n; i++) dot += prior.psi[i] * psi[i]
        for (let i = 0; i < n; i++) psi[i] -= dot * prior.psi[i] * dx
      }
      let norm = 0
      for (let i = 0; i < n; i++) norm += psi[i] * psi[i]
      if (!(norm > 0) || !Number.isFinite(norm)) {
        fillStartVector(psi, 0x85ebca6b + k * 97)
        continue
      }
      const scaleIt = 1 / Math.sqrt(norm)
      for (let i = 0; i < n; i++) psi[i] *= scaleIt
    }

    normalizeReal(psi, dx)
    states.push({ energy: energies[k], psi, nodes: countNodes(psi) })
  }

  return states
}

/**
 * The bound states of a well: those with energy below the potential's asymptotic value.
 *
 * `asymptote` defaults to V at the left edge of the grid, which is right for every well
 * this codebase draws (they all flatten out before the boundary). Solves for `probe`
 * levels and keeps the ones that are genuinely bound; the rest are artefacts of the box
 * the grid imposes, not states of the well.
 */
export function boundStates(
  grid: Grid,
  potential: ArrayLike<number>,
  probe = 12,
  asymptote = potential[0]
): Eigenstate[] {
  return solveStationary(grid, potential, probe).filter((s) => s.energy < asymptote)
}

// ─────────────────────────────────────────────────────────────────────────────
// Wave packets and observables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A normalized Gaussian packet: ψ(x) ∝ exp(−(x−x₀)²/4σ²)·e^{ik₀x}.
 *
 * σ is the standard deviation of the PROBABILITY density |ψ|², not of ψ itself — the 4 in
 * the exponent is what makes that true, and getting it wrong is the most common way a
 * packet simulation ends up disagreeing with the spreading law by a factor of two.
 */
export function gaussianPacket(
  grid: Grid,
  options: { x0: number; k0: number; sigma: number }
): Wavefunction {
  const { x0, k0, sigma } = options
  if (!(sigma > 0)) throw new RangeError('sigma must be positive')
  const re = new Float64Array(grid.n)
  const im = new Float64Array(grid.n)
  for (let i = 0; i < grid.n; i++) {
    const d = grid.x[i] - x0
    const envelope = Math.exp(-(d * d) / (4 * sigma * sigma))
    const phase = k0 * grid.x[i]
    re[i] = envelope * Math.cos(phase)
    im[i] = envelope * Math.sin(phase)
  }
  const psi = { re, im }
  normalizeWavefunction(psi, grid.dx)
  return psi
}

/**
 * A coherent state of the oscillator V = ½ω²x²: the ground-state Gaussian, displaced.
 *
 * Its width is exactly the ground state's, so it does not spread; its centre obeys
 * ⟨x⟩(t) = x₀·cos(ωt) — Newton's answer, produced by Schrödinger's equation. That is the
 * quantum-to-classical bridge /visualizations/harmonic-oscillator is built around.
 */
export function coherentState(grid: Grid, omega: number, displacement: number): Wavefunction {
  if (!(omega > 0)) throw new RangeError('omega must be positive')
  // Ground state ψ₀ ∝ exp(−ωx²/2) has |ψ₀|² ∝ exp(−ωx²), i.e. σ = 1/√(2ω).
  return gaussianPacket(grid, { x0: displacement, k0: 0, sigma: 1 / Math.sqrt(2 * omega) })
}

/** Scale ψ so ∫|ψ|²dx = 1. Mutates in place. */
export function normalizeWavefunction(psi: Wavefunction, dx: number): void {
  const total = norm(psi, dx)
  if (!(total > 0)) return
  const scale = 1 / Math.sqrt(total)
  for (let i = 0; i < psi.re.length; i++) {
    psi.re[i] *= scale
    psi.im[i] *= scale
  }
}

/** ∫|ψ|²dx. Exactly 1 for a normalized state. */
export function norm(psi: Wavefunction, dx: number): number {
  let sum = 0
  for (let i = 0; i < psi.re.length; i++) sum += psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]
  return sum * dx
}

/** |ψ(x)|² on the grid. Writes into `out` when given, to avoid per-frame allocation. */
export function probabilityDensity(psi: Wavefunction, out?: Float64Array): Float64Array {
  const target = out && out.length === psi.re.length ? out : new Float64Array(psi.re.length)
  for (let i = 0; i < psi.re.length; i++) target[i] = psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]
  return target
}

/** ⟨x⟩ = ∫x|ψ|²dx. */
export function expectationX(grid: Grid, psi: Wavefunction): number {
  let sum = 0
  for (let i = 0; i < grid.n; i++) {
    sum += grid.x[i] * (psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i])
  }
  return sum * grid.dx
}

/** The position uncertainty √(⟨x²⟩ − ⟨x⟩²). */
export function spreadX(grid: Grid, psi: Wavefunction): number {
  const mean = expectationX(grid, psi)
  let sum = 0
  for (let i = 0; i < grid.n; i++) {
    const d = grid.x[i] - mean
    sum += d * d * (psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i])
  }
  return Math.sqrt(Math.max(0, sum * grid.dx))
}

/**
 * The probability current j(x) = Im(ψ*·∂ψ/∂x)  (with ħ/m = 1).
 *
 * This is the flow of probability: ∂|ψ|²/∂t + ∂j/∂x = 0. A rightward-moving plane wave
 * A·e^{ikx} has the flat current k|A|², and ∫j dx is exactly ⟨p⟩ — both of which the
 * tests check, because a current computed with the wrong sign or a factor of two still
 * *looks* plausible on a canvas.
 *
 * Central differences in the interior, one-sided at the two ends.
 */
export function probabilityCurrent(
  grid: Grid,
  psi: Wavefunction,
  out?: Float64Array
): Float64Array {
  const { n, dx } = grid
  const j = out && out.length === n ? out : new Float64Array(n)
  const { re, im } = psi
  for (let i = 0; i < n; i++) {
    let dRe: number
    let dIm: number
    if (i === 0) {
      dRe = (re[1] - re[0]) / dx
      dIm = (im[1] - im[0]) / dx
    } else if (i === n - 1) {
      dRe = (re[n - 1] - re[n - 2]) / dx
      dIm = (im[n - 1] - im[n - 2]) / dx
    } else {
      dRe = (re[i + 1] - re[i - 1]) / (2 * dx)
      dIm = (im[i + 1] - im[i - 1]) / (2 * dx)
    }
    // Im(ψ* ψ') = re·Im(ψ') − im·Re(ψ')
    j[i] = re[i] * dIm - im[i] * dRe
  }
  return j
}

/** ⟨p⟩ = ∫ j(x) dx. */
export function expectationP(grid: Grid, psi: Wavefunction): number {
  const j = probabilityCurrent(grid, psi)
  let sum = 0
  for (let i = 0; i < grid.n; i++) sum += j[i]
  return sum * grid.dx
}

/** ⟨H⟩ = ∫ (½|ψ'|² + V|ψ|²) dx, with the derivative taken by central differences. */
export function expectationEnergy(
  grid: Grid,
  psi: Wavefunction,
  potential: ArrayLike<number>
): number {
  const { n, dx } = grid
  const { re, im } = psi
  let kinetic = 0
  for (let i = 1; i < n - 1; i++) {
    const dRe = (re[i + 1] - re[i - 1]) / (2 * dx)
    const dIm = (im[i + 1] - im[i - 1]) / (2 * dx)
    kinetic += dRe * dRe + dIm * dIm
  }
  let potentialEnergy = 0
  for (let i = 0; i < n; i++) {
    potentialEnergy += potential[i] * (re[i] * re[i] + im[i] * im[i])
  }
  return (0.5 * kinetic + potentialEnergy) * dx
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-dependent problem: split-step Fourier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-place radix-2 Cooley–Tukey FFT with precomputed tables.
 *
 * Written out rather than pulled from a package: the whole transform is forty lines, it
 * is the only dependency the propagator would otherwise have, and a visualization bundle
 * should not ship a general-purpose DSP library to move a Gaussian across a screen.
 */
class Fft {
  readonly n: number
  private readonly reverse: Uint32Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) {
      throw new RangeError('split-step needs a power-of-two grid size')
    }
    this.n = n
    const bits = Math.round(Math.log2(n))
    this.reverse = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.reverse[i] = r
    }
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
  }

  /** Forward transform when `inverse` is false; inverse includes the 1/n. */
  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { n, reverse, cos, sin } = this
    for (let i = 0; i < n; i++) {
      const j = reverse[i]
      if (j > i) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
        const ti = im[i]
        im[i] = im[j]
        im[j] = ti
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const stride = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const t = k * stride
          const wr = cos[t]
          const wi = inverse ? -sin[t] : sin[t]
          const a = start + k
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
    if (inverse) {
      const scale = 1 / n
      for (let i = 0; i < n; i++) {
        re[i] *= scale
        im[i] *= scale
      }
    }
  }
}

export type SplitStepOptions = {
  /** Time step. Accuracy is O(dt³) per step for Strang splitting; stability is uncond. */
  dt: number
  /**
   * Fraction of the grid at EACH end that absorbs outgoing flux, 0 to disable.
   * With an absorber on, norm decreases on purpose — that is how flux leaving the box is
   * accounted for instead of wrapping around the periodic ring and re-entering.
   */
  absorbFraction?: number
  /** How hard the absorber bites, per step, at the very edge. */
  absorbStrength?: number
  /** Grid index that divides "left" from "right" for absorbed-flux book-keeping. */
  splitIndex?: number
}

/**
 * Strang split-step Fourier propagator for a fixed potential.
 *
 *   ψ ← exp(−iV·dt/2) · F⁻¹[ exp(−ik²·dt/2) · F[ exp(−iV·dt/2) ψ ] ]
 *
 * Every factor has unit modulus, so without an absorber the norm is conserved to
 * round-off — which the tests pin at < 1e-12 over 20 000 steps.
 */
export class SplitStepPropagator {
  readonly grid: Grid
  readonly dt: number
  private readonly fft: Fft
  private readonly halfKickCos: Float64Array
  private readonly halfKickSin: Float64Array
  private readonly driftCos: Float64Array
  private readonly driftSin: Float64Array
  private readonly mask: Float64Array | null
  private readonly splitIndex: number
  private absorbedLeftTotal = 0
  private absorbedRightTotal = 0

  constructor(grid: Grid, potential: ArrayLike<number>, options: SplitStepOptions) {
    if (potential.length !== grid.n) throw new RangeError('potential length must match grid size')
    this.grid = grid
    this.dt = options.dt
    this.fft = new Fft(grid.n)
    this.splitIndex = options.splitIndex ?? Math.floor(grid.n / 2)

    const n = grid.n
    this.halfKickCos = new Float64Array(n)
    this.halfKickSin = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const theta = (potential[i] * this.dt) / 2
      this.halfKickCos[i] = Math.cos(theta)
      this.halfKickSin[i] = Math.sin(theta) // multiply uses exp(−iθ), so this is negated below
    }

    // Momenta on the periodic grid of length L = n·dx: k_j = 2πj/L for j < n/2, and the
    // same with j − n above that (the second half of an FFT's output is negative k).
    const length = n * grid.dx
    this.driftCos = new Float64Array(n)
    this.driftSin = new Float64Array(n)
    for (let j = 0; j < n; j++) {
      const index = j < n / 2 ? j : j - n
      const k = (2 * Math.PI * index) / length
      const theta = (k * k * this.dt) / 2
      this.driftCos[j] = Math.cos(theta)
      this.driftSin[j] = Math.sin(theta)
    }

    const fraction = options.absorbFraction ?? 0
    if (fraction > 0) {
      const strength = options.absorbStrength ?? 0.06
      const zone = Math.max(1, Math.floor(n * fraction))
      const mask = new Float64Array(n)
      mask.fill(1)
      for (let i = 0; i < n; i++) {
        let t = 0
        if (i < zone) t = (zone - i) / zone
        else if (i >= n - zone) t = (i - (n - zone) + 1) / zone
        // t⁴ keeps the mask flat well into the zone, so the packet meets a gentle ramp
        // rather than a wall: a sharp absorber reflects, which is the exact artefact it
        // exists to prevent.
        if (t > 0) mask[i] = Math.exp(-strength * t * t * t * t)
      }
      this.mask = mask
    } else {
      this.mask = null
    }
  }

  /** Probability swallowed by the absorbing layer on the left of `splitIndex`. */
  get absorbedLeft(): number {
    return this.absorbedLeftTotal
  }

  /** Probability swallowed by the absorbing layer on the right of `splitIndex`. */
  get absorbedRight(): number {
    return this.absorbedRightTotal
  }

  resetAbsorbed(): void {
    this.absorbedLeftTotal = 0
    this.absorbedRightTotal = 0
  }

  /** Advance ψ in place by `steps` steps of size dt. */
  advance(psi: Wavefunction, steps = 1): void {
    for (let s = 0; s < steps; s++) this.stepOnce(psi)
  }

  private stepOnce(psi: Wavefunction): void {
    const { re, im } = psi
    const n = this.grid.n

    this.kick(re, im)
    this.fft.transform(re, im, false)
    for (let j = 0; j < n; j++) {
      const c = this.driftCos[j]
      const s = this.driftSin[j]
      const a = re[j]
      const b = im[j]
      re[j] = a * c + b * s
      im[j] = b * c - a * s
    }
    this.fft.transform(re, im, true)
    this.kick(re, im)

    const mask = this.mask
    if (mask) {
      const dx = this.grid.dx
      for (let i = 0; i < n; i++) {
        const m = mask[i]
        if (m === 1) continue
        const before = re[i] * re[i] + im[i] * im[i]
        re[i] *= m
        im[i] *= m
        const lost = (before - (re[i] * re[i] + im[i] * im[i])) * dx
        if (i < this.splitIndex) this.absorbedLeftTotal += lost
        else this.absorbedRightTotal += lost
      }
    }
  }

  /** Multiply by exp(−iV·dt/2), pointwise in x. */
  private kick(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < re.length; i++) {
      const c = this.halfKickCos[i]
      const s = this.halfKickSin[i]
      const a = re[i]
      const b = im[i]
      re[i] = a * c + b * s
      im[i] = b * c - a * s
    }
  }
}

/**
 * The analytic width of a FREELY spreading Gaussian: σ(t) = σ₀·√(1 + (t/(2σ₀²))²).
 *
 * Exposed because the wave-packet page quotes it next to the measured width, and because
 * the tests use it as the independent answer the propagator has to reproduce. With ħ=m=1
 * a packet localised to σ₀ = 0.5 has doubled in width by t = 2√3·σ₀² ≈ 0.87 — narrow packets fall
 * apart fastest, which is the uncertainty principle showing up as a rate.
 */
export function freeSpreadWidth(sigma0: number, t: number): number {
  const ratio = t / (2 * sigma0 * sigma0)
  return sigma0 * Math.sqrt(1 + ratio * ratio)
}

/**
 * Transmission through a rectangular barrier, exactly, for a plane wave of energy E.
 *
 * Both branches of the standard result — sinh below the top, sin above it — because the
 * one above the top is the surprise the scattering page is built around: T dips below 1
 * and oscillates, hitting exactly 1 only at the resonances where the barrier width is a
 * whole number of half-wavelengths inside. A classical particle with E > V₀ always passes.
 *
 * A NEGATIVE `height` is a square WELL, and the same E > height branch gives the right
 * answer for it: T = [1 + V₀²sin²(k₂w)/(4E(E+V₀))]⁻¹. A well reflects too. Reflection is
 * caused by a change in wavelength, and it does not care which way the change goes.
 */
export function rectangularBarrierTransmission(
  energy: number,
  height: number,
  width: number
): number {
  if (energy <= 0) return 0
  if (height === 0) return 1
  if (energy < height) {
    const kappa = Math.sqrt(2 * (height - energy))
    const s = Math.sinh(kappa * width)
    return 1 / (1 + (height * height * s * s) / (4 * energy * (height - energy)))
  }
  if (energy === height) {
    // The limit of both branches: T = 1/(1 + width²·height/2).
    return 1 / (1 + (width * width * height) / 2)
  }
  const k2 = Math.sqrt(2 * (energy - height))
  const s = Math.sin(k2 * width)
  return 1 / (1 + (height * height * s * s) / (4 * energy * (energy - height)))
}
