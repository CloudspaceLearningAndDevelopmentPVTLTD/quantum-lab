/**
 * lib/quantum/laser.ts — Einstein coefficients and laser rate equations.
 *
 * Everything /visualizations/lasers displays comes from here:
 *
 *   1. Einstein's three coefficients for one transition, and the two relations
 *      between them that he derived in 1917 from detailed balance against a
 *      Planck field:  g₁B₁₂ = g₂B₂₁  and  A₂₁/B₂₁ = 8πhν³/c³.
 *      They are computed, not pasted, and laser.test.ts checks them against
 *      Planck's law and against the textbook cross-section formula.
 *
 *   2. The three-level rate equations (ground 1, pump band 3, metastable
 *      upper laser level 2) coupled to the photon number n in one cavity mode,
 *      with the stimulated rate per photon K derived from B, so that the
 *      lasing threshold on the page really is the Einstein-coefficient
 *      threshold and not a fitted constant.
 *
 *   3. The two-level system pumped on its own transition, whose steady state
 *      can never invert — the reason a laser needs at least three levels.
 *
 * Units are SI throughout: rates in s⁻¹, populations in atoms, photon numbers
 * in photons, energies in joules. The page converts to eV, ns and watts at the
 * edge.
 *
 * Simplifications, stated so the page can repeat them honestly:
 *   - one cavity mode, at line centre, with a top-hat lineshape of width Δν
 *     (so the peak of g(ν) is 1/Δν) and no refractive index;
 *   - the pump band decays to level 2 with a single rate γ₃₂ and level 2
 *     decays only radiatively, at A₂₁;
 *   - spontaneous emission into the lasing mode is the +1 in K(n+1)N₂, the
 *     same K that clones a photon — nothing extra is added by hand.
 */

import { PLANCK_J_S, SPEED_OF_LIGHT_M_S, BOLTZMANN_J_K } from '@/lib/viz/physicalConstants'

// ────────────────────────────────────────────────────────────
// Einstein coefficients
// ────────────────────────────────────────────────────────────

/**
 * 8πh/c³ in J·s⁴·m⁻³ — the constant in A₂₁/B₂₁ = 8πhν³/c³, which is also the
 * number of modes per unit volume per unit frequency times the photon energy.
 * Multiply by ν³ to get A/B in J·s·m⁻³ (an energy density per unit frequency).
 */
export const EINSTEIN_A_OVER_B_PER_NU3 = (8 * Math.PI * PLANCK_J_S) / SPEED_OF_LIGHT_M_S ** 3

/** A₂₁ (s⁻¹) from B₂₁ (m³·J⁻¹·s⁻²) at frequency ν (Hz). */
export function einsteinAFromB(B21: number, nuHz: number): number {
  return B21 * EINSTEIN_A_OVER_B_PER_NU3 * nuHz ** 3
}

/** B₂₁ (m³·J⁻¹·s⁻²) from A₂₁ (s⁻¹) at frequency ν (Hz). */
export function einsteinBFromA(A21: number, nuHz: number): number {
  return A21 / (EINSTEIN_A_OVER_B_PER_NU3 * nuHz ** 3)
}

/**
 * B₁₂ from B₂₁ and the level degeneracies: g₁B₁₂ = g₂B₂₁. For non-degenerate
 * levels (the default) absorption and stimulated emission have the same
 * coefficient — a photon is exactly as good at knocking an atom down as at
 * lifting it up, which is why the net gain is proportional to N₂ − N₁.
 */
export function einsteinB12FromB21(B21: number, g1 = 1, g2 = 1): number {
  if (!(g1 > 0) || !(g2 > 0)) throw new RangeError('degeneracies must be positive')
  return (g2 / g1) * B21
}

/** Frequency in Hz for a vacuum wavelength in metres. */
export function frequencyHz(wavelengthM: number): number {
  return SPEED_OF_LIGHT_M_S / wavelengthM
}

/** Photon energy hν in joules for a frequency in Hz. */
export function photonEnergyJ(nuHz: number): number {
  return PLANCK_J_S * nuHz
}

/**
 * Mean thermal photon occupation of one mode, n̄ = 1/(e^{hν/kT} − 1).
 *
 * In a thermal field the stimulated-to-spontaneous emission ratio is exactly
 * n̄ — at 600 THz and 300 K it is ~10⁻⁴², which is why lasers were not
 * discovered by accident: nothing in nature has enough photons in one mode
 * for stimulated emission to matter. A cavity is how you build n up by hand.
 */
export function thermalOccupation(nuHz: number, temperatureK: number): number {
  const x = (PLANCK_J_S * nuHz) / (BOLTZMANN_J_K * temperatureK)
  return 1 / Math.expm1(x)
}

/**
 * Stimulated-emission cross-section at line centre, m².
 *
 * Derived from B rather than quoted: an atom in a beam of intensity I sees a
 * spectral energy density ρ_ν = I g(ν)/c, so its stimulated rate is
 * W = B ρ_ν = B I g(ν)/c. Writing the same rate as W = σI/(hν) gives
 * σ = B hν g(ν)/c. With g(ν₀) = 1/Δν (top-hat) and B from A this reduces to
 * the textbook σ = λ²A/(8πΔν) — laser.test.ts checks that it does.
 */
export function emissionCrossSectionM2(A21: number, wavelengthM: number, linewidthHz: number): number {
  const nu = frequencyHz(wavelengthM)
  const B = einsteinBFromA(A21, nu)
  return (B * photonEnergyJ(nu)) / (SPEED_OF_LIGHT_M_S * linewidthHz)
}

/**
 * K: the stimulated rate per atom per photon in a mode of volume V, s⁻¹.
 * One photon spread over the mode volume and the linewidth has energy density
 * hν/(VΔν), so K = B·hν/(VΔν) = σc/V.
 */
export function stimulatedRatePerPhoton(
  A21: number,
  wavelengthM: number,
  linewidthHz: number,
  modeVolumeM3: number
): number {
  return (emissionCrossSectionM2(A21, wavelengthM, linewidthHz) * SPEED_OF_LIGHT_M_S) / modeVolumeM3
}

// ────────────────────────────────────────────────────────────
// Gain media
// ────────────────────────────────────────────────────────────

export type GainMedium = {
  id: string
  name: string
  /** Lasing wavelength, m. */
  wavelengthM: number
  /** Pump wavelength, m — used only to convert pump rate into absorbed power. */
  pumpWavelengthM: number
  /** Upper-level lifetime τ₂ = 1/A₂₁, s. */
  upperLifetimeS: number
  /** Pump-band decay rate γ₃₂ into the upper laser level, s⁻¹. */
  pumpBandDecayRate: number
  /** Transition linewidth Δν, Hz. */
  linewidthHz: number
  /** Active ions in the mode volume. */
  atoms: number
  /** Mode volume, m³. */
  modeVolumeM3: number
  note: string
}

/**
 * Two genuine three-level media. Ruby is the original (Maiman, 1960); erbium
 * in glass is the amplifier inside every long-haul fibre link and is treated
 * here as a pure three-level system (its lower level is the ground manifold).
 */
export const GAIN_MEDIA: readonly GainMedium[] = [
  {
    id: 'ruby',
    name: 'Ruby (Cr³⁺:Al₂O₃)',
    wavelengthM: 694.3e-9,
    pumpWavelengthM: 550e-9,
    upperLifetimeS: 3.0e-3,
    pumpBandDecayRate: 1e8,
    linewidthHz: 3.3e11,
    atoms: 1.6e19,
    modeVolumeM3: 1e-6,
    note: '1 cm³ of 0.05% ruby: 1.6 × 10¹⁹ chromium ions, R₁ line at 694.3 nm, 3 ms upper-level lifetime.',
  },
  {
    id: 'erbium',
    name: 'Erbium in glass fibre',
    wavelengthM: 1535e-9,
    pumpWavelengthM: 980e-9,
    upperLifetimeS: 10e-3,
    pumpBandDecayRate: 1e6,
    linewidthHz: 5e12,
    atoms: 5e14,
    modeVolumeM3: 5e-11,
    note: '1 m of Er-doped fibre with an 8 µm core: 5 × 10¹⁴ ions, 1535 nm, 10 ms lifetime.',
  },
]

export function mediumById(id: string): GainMedium {
  const m = GAIN_MEDIA.find((x) => x.id === id)
  if (!m) throw new Error(`unknown gain medium ${id}`)
  return m
}

// ────────────────────────────────────────────────────────────
// Three-level laser
// ────────────────────────────────────────────────────────────

export type ThreeLevelParams = {
  /** Spontaneous rate of the lasing transition, s⁻¹. */
  A21: number
  /** Pump-band decay rate into level 2, s⁻¹. */
  gamma32: number
  /** Stimulated rate per atom per cavity photon, s⁻¹. */
  K: number
  /** Cavity photon lifetime, s. */
  tauC: number
  /** Total atoms. */
  N: number
}

export type ThreeLevelState = {
  N1: number
  N2: number
  N3: number
  /** Photons in the cavity mode. */
  n: number
}

/** Build rate-equation parameters from a medium and a cavity photon lifetime. */
export function paramsForMedium(medium: GainMedium, tauC: number): ThreeLevelParams {
  const A21 = 1 / medium.upperLifetimeS
  return {
    A21,
    gamma32: medium.pumpBandDecayRate,
    K: stimulatedRatePerPhoton(A21, medium.wavelengthM, medium.linewidthHz, medium.modeVolumeM3),
    tauC,
    N: medium.atoms,
  }
}

/**
 * Right-hand side of the three-level rate equations for pump rate W (s⁻¹).
 *
 *   dN₃/dt = W(N₁ − N₃) − γ₃₂N₃
 *   dN₂/dt = γ₃₂N₃ − A₂₁N₂ − Kn(N₂ − N₁)
 *   dN₁/dt = −W(N₁ − N₃) + A₂₁N₂ + Kn(N₂ − N₁)
 *   dn/dt  = K(n + 1)N₂ − KnN₁ − n/τ_c
 *
 * The pump is written as a stimulated process, W(N₁ − N₃), because it is one:
 * pump light is just as capable of driving 3 → 1. The fast γ₃₂ is what keeps
 * N₃ empty and turns the pump into a one-way street.
 */
export function threeLevelDerivatives(
  s: ThreeLevelState,
  p: ThreeLevelParams,
  W: number
): ThreeLevelState {
  const pump = W * (s.N1 - s.N3)
  const stim = p.K * s.n * (s.N2 - s.N1)
  const spont = p.A21 * s.N2
  return {
    N3: pump - p.gamma32 * s.N3,
    N2: p.gamma32 * s.N3 - spont - stim,
    N1: -pump + spont + stim,
    n: stim + p.K * s.N2 - s.n / p.tauC,
  }
}

/**
 * The rate at which atoms actually arrive in level 2 per ground-state atom,
 * once the pump band has settled: R = Wγ₃₂/(γ₃₂ + W). For a fast pump band
 * R ≈ W; when W approaches γ₃₂ the pump saturates the band.
 */
export function effectivePumpRate(W: number, gamma32: number): number {
  return (W * gamma32) / (gamma32 + W)
}

/** Invert effectivePumpRate. Returns Infinity when R ≥ γ₃₂ cannot be reached. */
export function pumpRateForEffective(R: number, gamma32: number): number {
  if (R >= gamma32) return Infinity
  return (R * gamma32) / (gamma32 - R)
}

/** Population inversion needed for gain to equal loss: ΔN_th = 1/(Kτ_c). */
export function thresholdInversion(p: ThreeLevelParams): number {
  return 1 / (p.K * p.tauC)
}

/**
 * Populations with the cavity mode empty (n = 0), in closed form. This is
 * what the populations do below threshold, and it is the curve whose
 * crossing of ΔN = 0 and ΔN = ΔN_th the page marks.
 */
export function populationsDark(p: ThreeLevelParams, W: number): { N1: number; N2: number; N3: number } {
  const a = W / (p.gamma32 + W)
  const R = p.gamma32 * a
  const N1 = p.N / (1 + a + R / p.A21)
  return { N1, N2: (R / p.A21) * N1, N3: a * N1 }
}

/**
 * Pump rate at which N₂ = N₁ with the mode empty. Inversion needs R > A₂₁:
 * atoms must be pumped up at least as fast as they fall — half the medium has
 * to be lifted before there is any gain at all. That is the three-level tax.
 */
export function inversionPumpRate(p: ThreeLevelParams): number {
  return pumpRateForEffective(p.A21, p.gamma32)
}

/**
 * Lasing threshold pump rate: where the dark inversion reaches ΔN_th.
 *
 *   N(R − A)/(A + R + RA/γ) = D,  D = 1/(Kτ_c)
 *   ⇒ R_th = A(N + D) / (N − D(1 + A/γ))
 *
 * Returns Infinity when the cavity is so lossy (D(1 + A/γ) ≥ N) that no pump
 * can reach it. The exact steady state below rounds this corner slightly
 * because of the +1 spontaneous seed, but the kink in n(W) sits here.
 */
export function lasingThresholdPumpRate(p: ThreeLevelParams): number {
  const D = thresholdInversion(p)
  const denom = p.N - D * (1 + p.A21 / p.gamma32)
  if (denom <= 0) return Infinity
  const R = (p.A21 * (p.N + D)) / denom
  return pumpRateForEffective(R, p.gamma32)
}

/**
 * The unique positive root of a·n² + b·n + c = 0 with a > 0 and c ≤ 0.
 * Written to avoid the −b + √(b² − 4ac) cancellation when b is large and
 * positive (below threshold, where n is small and b is not).
 */
function positiveRoot(a: number, b: number, c: number): number {
  if (c === 0) return 0
  const s = Math.sqrt(b * b - 4 * a * c)
  return b >= 0 ? (-2 * c) / (b + s) : (s - b) / (2 * a)
}

/**
 * Exact steady state of the three-level equations, spontaneous seed included.
 *
 * With n fixed the populations are linear (N₂/N₁ = (R + Kn)/(A + Kn)), and
 * substituting them into dn/dt = 0 gives a quadratic in n with exactly one
 * positive root, so this is closed-form rather than iterative. Above threshold
 * the inversion clamps at ΔN_th and n grows linearly with the pump; below it,
 * n is the handful of spontaneous photons that happen to be in the mode.
 */
export function threeLevelSteadyState(p: ThreeLevelParams, W: number): ThreeLevelState {
  if (W <= 0) return { N1: p.N, N2: 0, N3: 0, n: 0 }
  const a = W / (p.gamma32 + W)
  const R = p.gamma32 * a
  const { A21: A, K, tauC, N } = p
  // (2 + a)K n² + [(1 + a)A + R − τ_cKN(K + R − A)] n − τ_cKNR = 0
  const qa = (2 + a) * K
  const qb = (1 + a) * A + R - tauC * K * N * (K + R - A)
  const qc = -tauC * K * N * R
  const n = positiveRoot(qa, qb, qc)
  const denom = (2 + a) * K * n + (1 + a) * A + R
  const N1 = (N * (A + K * n)) / denom
  const N2 = (N * (R + K * n)) / denom
  return { N1, N2, N3: a * N1, n }
}

/**
 * Classical RK4 with a step that resolves the fastest rate present. The
 * equations are stiff for a real cavity (τ_c ~ ns against τ₂ ~ ms), so this
 * is for tests and short transients, not for animating a ruby rod in real
 * time — the page uses the closed-form steady state.
 */
export function integrateThreeLevel(
  p: ThreeLevelParams,
  W: number,
  s0: ThreeLevelState,
  tEnd: number,
  maxDt?: number
): ThreeLevelState {
  const fastest = Math.max(p.A21, p.gamma32, W, 1 / p.tauC)
  const dt = Math.min(maxDt ?? Infinity, 0.2 / fastest)
  const steps = Math.max(1, Math.ceil(tEnd / dt))
  const h = tEnd / steps
  let s = { ...s0 }
  const add = (x: ThreeLevelState, k: ThreeLevelState, f: number): ThreeLevelState => ({
    N1: x.N1 + f * k.N1,
    N2: x.N2 + f * k.N2,
    N3: x.N3 + f * k.N3,
    n: x.n + f * k.n,
  })
  for (let i = 0; i < steps; i++) {
    const k1 = threeLevelDerivatives(s, p, W)
    const k2 = threeLevelDerivatives(add(s, k1, h / 2), p, W)
    const k3 = threeLevelDerivatives(add(s, k2, h / 2), p, W)
    const k4 = threeLevelDerivatives(add(s, k3, h), p, W)
    s = {
      N1: s.N1 + (h / 6) * (k1.N1 + 2 * k2.N1 + 2 * k3.N1 + k4.N1),
      N2: s.N2 + (h / 6) * (k1.N2 + 2 * k2.N2 + 2 * k3.N2 + k4.N2),
      N3: s.N3 + (h / 6) * (k1.N3 + 2 * k2.N3 + 2 * k3.N3 + k4.N3),
      n: Math.max(0, s.n + (h / 6) * (k1.n + 2 * k2.n + 2 * k3.n + k4.n)),
    }
  }
  return s
}

/** Power leaving the cavity if every loss is the output mirror: n·hν/τ_c, watts. */
export function outputPowerW(n: number, nuHz: number, tauC: number): number {
  return (n * photonEnergyJ(nuHz)) / tauC
}

/** Pump power absorbed by the medium: one pump photon per 1 → 3 event, watts. */
export function absorbedPumpPowerW(W: number, N1: number, N3: number, pumpNuHz: number): number {
  return W * Math.max(0, N1 - N3) * photonEnergyJ(pumpNuHz)
}

// ────────────────────────────────────────────────────────────
// Two-level system
// ────────────────────────────────────────────────────────────

export type TwoLevelParams = {
  A21: number
  K: number
  tauC: number
  N: number
}

export type TwoLevelState = { N1: number; N2: number; n: number }

/**
 * A two-level atom pumped on its own transition. The pump lifts ground atoms
 * at W and — because B₁₂ = B₂₁ — knocks excited atoms down at the same W:
 *
 *   dN₂/dt = W(N₁ − N₂) − A₂₁N₂ − Kn(N₂ − N₁)
 *   dn/dt  = K(n + 1)N₂ − KnN₁ − n/τ_c
 */
export function twoLevelDerivatives(s: TwoLevelState, p: TwoLevelParams, W: number): TwoLevelState {
  const stim = p.K * s.n * (s.N2 - s.N1)
  const d2 = W * (s.N1 - s.N2) - p.A21 * s.N2 - stim
  return { N2: d2, N1: -d2, n: stim + p.K * s.N2 - s.n / p.tauC }
}

/**
 * Exact two-level steady state. The populations alone give
 * N₂/N = W/(2W + A₂₁), which is below ½ for every finite W: the best the pump
 * can do is equalise the levels, at which point it is emitting as many photons
 * as it absorbs. There is no inversion, so there is no gain and n stays at
 * the spontaneous floor.
 */
export function twoLevelSteadyState(p: TwoLevelParams, W: number): TwoLevelState {
  if (W <= 0) return { N1: p.N, N2: 0, n: 0 }
  const { A21: A, K, tauC, N } = p
  // 2K n² + [2W + A − τ_cKN(K − A)] n − τ_cKNW = 0
  const n = positiveRoot(2 * K, 2 * W + A - tauC * K * N * (K - A), -tauC * K * N * W)
  const denom = 2 * W + A + 2 * K * n
  return { N1: (N * (W + A + K * n)) / denom, N2: (N * (W + K * n)) / denom, n }
}

/** Two-level populations with the mode empty: the closed form the page plots. */
export function twoLevelPopulationsDark(A21: number, N: number, W: number): { N1: number; N2: number } {
  const N2 = (N * W) / (2 * W + A21)
  return { N1: N - N2, N2 }
}
