/**
 * spinPrecession.ts — the magnetic-resonance numerics behind
 * /visualizations/spin-precession.
 *
 * Everything here is the classical Bloch-vector picture of a spin-1/2, which is
 * exact for a single isolated spin: the expectation value ⟨σ⟩ of a pure state
 * obeys the same equation of motion as a classical magnetic moment,
 *
 *     dv/dt = γ (v × B)
 *
 * with γ the gyromagnetic ratio. That is the ONLY dynamical law in this file.
 * The Larmor frequency, the Rabi formula and the RX/RY/RZ gate equivalences are
 * all consequences of it, and spinPrecession.test.ts checks each of them against
 * an independent source: published resonance frequencies for real nuclei, the
 * closed-form Rabi solution, and a straight RK4 integration of the *lab-frame*
 * field with no rotating-wave approximation anywhere.
 *
 * SIGN CONVENTION, since it is the thing that is easy to get backwards.
 * With B = B₀ẑ and γ > 0, dv/dt = γ(v × ẑ)B₀ gives dvx/dt = +γB₀ vy and
 * dvy/dt = −γB₀ vx. That is a CLOCKWISE rotation about +z seen from above, i.e.
 * rotation by angle −ω₀t in the right-handed (counter-clockwise-positive) sense
 * that `rotate()` in ./blochGates uses. Every function below is consistent with
 * that, and the tests pin it.
 *
 * Units are SI throughout: γ in rad·s⁻¹·T⁻¹, B in tesla, ω in rad/s, t in
 * seconds. The page converts to screen time separately and shows the reader the
 * compression factor, rather than quietly animating fictitious numbers.
 */

export type Vec3 = [number, number, number]

/**
 * Gyromagnetic ratios, as γ/2π in MHz/T — the form every NMR/EPR table is
 * published in, so these can be checked against a reference without unit
 * gymnastics. CODATA / IUPAC values.
 *
 * The electron's γ is negative (its magnetic moment is antiparallel to its
 * spin); we carry the magnitude here and note the consequence in the page copy,
 * because flipping the sign only reverses the sense of precession and would
 * make the electron's arrow spin the other way for reasons the reader has no
 * way to see on screen.
 */
export type SpinSpecies = {
  id: 'proton' | 'carbon13' | 'electron'
  label: string
  /** γ/2π in MHz per tesla. */
  gammaMHzPerT: number
  /** What this species is actually used for, one clause. */
  note: string
}

export const SPIN_SPECIES: readonly SpinSpecies[] = [
  {
    id: 'proton',
    label: '¹H proton',
    gammaMHzPerT: 42.577478518,
    note: 'the hydrogen in water and fat — what an MRI scanner images',
  },
  {
    id: 'carbon13',
    label: '¹³C',
    gammaMHzPerT: 10.7083974,
    note: 'the workhorse of organic NMR, four times slower than a proton',
  },
  {
    id: 'electron',
    label: 'electron',
    gammaMHzPerT: 28024.9514242,
    note: 'EPR and most solid-state spin qubits — 658× faster than a proton',
  },
] as const

export function speciesById(id: SpinSpecies['id']): SpinSpecies {
  return SPIN_SPECIES.find((s) => s.id === id) ?? SPIN_SPECIES[0]
}

/** γ in rad·s⁻¹·T⁻¹ from the tabulated γ/2π in MHz/T. */
export function gammaRadPerSecPerTesla(species: SpinSpecies): number {
  return species.gammaMHzPerT * 1e6 * 2 * Math.PI
}

/**
 * The Larmor angular frequency ω₀ = γB, in rad/s.
 *
 * This is the whole of magnetic resonance in one line: a spin in a field
 * precesses at a rate proportional to the field and to nothing else — not to
 * how far it is tipped over, not to how long it has been going.
 */
export function larmorAngularFrequency(gamma: number, field: number): number {
  return gamma * field
}

/** The same thing in Hz — the number written on the side of an MRI scanner. */
export function larmorFrequencyHz(gamma: number, field: number): number {
  return larmorAngularFrequency(gamma, field) / (2 * Math.PI)
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector helpers
// ─────────────────────────────────────────────────────────────────────────────

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

/**
 * Rodrigues rotation of `v` by `angle` radians about the unit axis `k`,
 * counter-clockwise looking down the axis toward the origin (the standard
 * right-handed sense). Same formula as ./blochGates.rotate — duplicated rather
 * than imported so this module stays self-contained for the ODE tests, and the
 * gate-equivalence test deliberately compares the two implementations.
 */
export function rotateAbout(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const d = dot(k, v)
  const x = cross(k, v)
  return [
    v[0] * c + x[0] * s + k[0] * d * (1 - c),
    v[1] * c + x[1] * s + k[1] * d * (1 - c),
    v[2] * c + x[2] * s + k[2] * d * (1 - c),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// The field, and the equation of motion
// ─────────────────────────────────────────────────────────────────────────────

export type FieldConfig = {
  /** Static field magnitude B₀ in tesla. */
  b0: number
  /** Tilt of the static field away from +z, in radians (0 = along +z). */
  tilt: number
  /** Rotating RF amplitude B₁ in tesla. Zero switches the drive off. */
  b1: number
  /** RF angular frequency in rad/s. Resonance is ω_d = γB₀. */
  driveOmega: number
  /** RF phase at t = 0, in radians. Shifting it by π/2 turns an RX into an RY. */
  drivePhase: number
}

/** The static part of the field, B₀ tilted by `tilt` in the x–z plane. */
export function staticField(cfg: Pick<FieldConfig, 'b0' | 'tilt'>): Vec3 {
  return [cfg.b0 * Math.sin(cfg.tilt), 0, cfg.b0 * Math.cos(cfg.tilt)]
}

/**
 * The full lab-frame field at time t: a static B₀ plus a circularly polarised
 * RF field of amplitude B₁ in the plane transverse to +z, rotating in the same
 * sense the spin precesses (clockwise about +z, matching the sign convention in
 * the file header). No rotating-wave approximation is made anywhere — the
 * simulation and the tests integrate exactly this.
 */
export function labField(t: number, cfg: FieldConfig): Vec3 {
  const s = staticField(cfg)
  const phase = cfg.driveOmega * t + cfg.drivePhase
  return [s[0] + cfg.b1 * Math.cos(phase), s[1] - cfg.b1 * Math.sin(phase), s[2]]
}

/** dv/dt = γ (v × B). The only dynamical law in this module. */
export function blochDerivative(v: Vec3, b: Vec3, gamma: number): Vec3 {
  const c = cross(v, b)
  return [gamma * c[0], gamma * c[1], gamma * c[2]]
}

/**
 * One classical fourth-order Runge–Kutta step of the Bloch equation under a
 * time-dependent field.
 *
 * RK4 is not norm-preserving to machine precision, so the result is
 * renormalised: |v| = 1 is an exact property of a pure spin-1/2 state, and
 * letting an integrator shrink it would make the animation slowly fade toward
 * the centre of the sphere — which would read as decoherence, a completely
 * different piece of physics that this page does not simulate.
 */
export function rk4Step(
  v: Vec3,
  t: number,
  dt: number,
  gamma: number,
  field: (t: number) => Vec3
): Vec3 {
  const f = (tt: number, vv: Vec3): Vec3 => blochDerivative(vv, field(tt), gamma)
  const add = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]

  const k1 = f(t, v)
  const k2 = f(t + dt / 2, add(v, k1, dt / 2))
  const k3 = f(t + dt / 2, add(v, k2, dt / 2))
  const k4 = f(t + dt, add(v, k3, dt))

  const out: Vec3 = [
    v[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    v[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    v[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  ]
  return normalize(out)
}

/** Advance `steps` RK4 steps, returning the final vector. */
export function integrate(
  v0: Vec3,
  t0: number,
  dt: number,
  steps: number,
  gamma: number,
  field: (t: number) => Vec3
): Vec3 {
  let v = v0
  let t = t0
  for (let i = 0; i < steps; i++) {
    v = rk4Step(v, t, dt, gamma, field)
    t += dt
  }
  return v
}

/**
 * Free precession in closed form: the exact solution of dv/dt = γ(v × B) for a
 * constant B, used to check the integrator and to draw the precession cone
 * without accumulating drift.
 *
 * Rotation by −ω₀t about B̂, per the sign convention in the file header.
 */
export function precess(v: Vec3, b: Vec3, gamma: number, t: number): Vec3 {
  const mag = norm(b)
  if (mag === 0) return v
  return rotateAbout(v, normalize(b), -gamma * mag * t)
}

/**
 * The angle between the spin and the field — the half-angle of the precession
 * cone. Constant under free precession, which is exactly why a static field on
 * its own can never flip a spin and an RF pulse is needed.
 */
export function coneAngle(v: Vec3, b: Vec3): number {
  const mag = norm(v) * norm(b)
  if (mag === 0) return 0
  return Math.acos(Math.min(1, Math.max(-1, dot(v, b) / mag)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Rabi: what the RF drive does
// ─────────────────────────────────────────────────────────────────────────────

/** The on-resonance Rabi angular frequency ω₁ = γB₁, in rad/s. */
export function rabiAngularFrequency(gamma: number, b1: number): number {
  return gamma * b1
}

/**
 * The generalised Rabi frequency Ω = √(ω₁² + Δ²).
 *
 * In the frame rotating with the drive, the spin sees a static effective field
 * with an x-component ω₁/γ (the RF) and a z-component Δ/γ (whatever is left of
 * B₀ after the frame rotation removes ω_d/γ). The spin simply precesses about
 * that effective field, and Ω is its length. Everything else about Rabi
 * oscillation follows from this one picture.
 */
export function generalizedRabiFrequency(omega1: number, detuning: number): number {
  return Math.hypot(omega1, detuning)
}

/**
 * P(spin flipped) at time t for a spin starting along +z, driven at detuning Δ.
 *
 *     P(t) = ω₁²/(ω₁² + Δ²) · sin²(Ω t / 2)
 *
 * The prefactor is the whole story of resonance: only an exactly resonant drive
 * (Δ = 0) can ever reach P = 1. Detune by as much as ω₁ and the best you can do
 * is half a flip, no matter how long you drive.
 */
export function rabiTransitionProbability(omega1: number, detuning: number, t: number): number {
  const omega = generalizedRabiFrequency(omega1, detuning)
  if (omega === 0) return 0
  const amplitude = (omega1 * omega1) / (omega * omega)
  const s = Math.sin((omega * t) / 2)
  return amplitude * s * s
}

/** The ceiling of the Rabi oscillation, ω₁²/(ω₁² + Δ²). */
export function maxTransitionProbability(omega1: number, detuning: number): number {
  const omega = generalizedRabiFrequency(omega1, detuning)
  return omega === 0 ? 0 : (omega1 * omega1) / (omega * omega)
}

/**
 * How long a resonant pulse must last to rotate the spin by `angle` radians.
 *
 * This is the bridge to the circuit simulator: a resonant pulse of duration
 * θ/ω₁ IS the gate RX(θ). A π pulse is X. A π/2 pulse is √X, the gate that
 * takes |0⟩ onto the equator. Nothing else is going on inside "apply RX".
 */
export function pulseDuration(omega1: number, angle: number): number {
  return omega1 === 0 ? Infinity : angle / omega1
}

/** The rotation angle a resonant pulse of duration `t` produces: θ = ω₁t. */
export function pulseAngle(omega1: number, t: number): number {
  return omega1 * t
}

/**
 * THE BRIDGE TO THE CIRCUIT SIMULATOR, in one function.
 *
 * Transform the lab-frame field into the frame rotating with the drive and the
 * transverse part comes out STATIC, at angle −φ in the rotating plane (worked
 * through in the test). A spin in a static field precesses about it, so a
 * resonant pulse of duration t is a rotation by ω₁t about a fixed axis — which
 * is precisely the definition of RX/RY. This returns that axis.
 *
 * Handedness, which is the one genuinely confusing part: a nucleus with γ > 0
 * precesses CLOCKWISE about the field, while RX(θ) = e^{−iθX/2} turns the Bloch
 * vector COUNTER-CLOCKWISE about +x. The two senses are opposite, so the axis
 * below carries a minus sign — a pulse of RF phase 0 is RX(−θ), and a pulse of
 * RF phase π is RX(+θ). Nothing physical distinguishes them; "which transverse
 * direction is x" is set entirely by the RF phase reference, which is exactly
 * why shifting the RF phase by 90° turns an RX into an RY. That is not an
 * analogy — on real hardware it is how the RY gate is implemented.
 */
export function gateAxisForPhase(phase: number): Vec3 {
  return [-Math.cos(phase), Math.sin(phase), 0]
}

/** RF phase whose pulse realises RX(θ) in the e^{−iθX/2} convention. */
export const RF_PHASE_RX = Math.PI
/** RF phase whose pulse realises RY(θ). Ninety degrees away — that is the whole trick. */
export const RF_PHASE_RY = Math.PI / 2

/**
 * Which single-qubit gate a resonant pulse of duration `t` and RF phase `phase`
 * is equivalent to, as a short label for the readout beside the sphere. Angles
 * are reported modulo 2π because that is what the spin actually does.
 */
export function equivalentGateLabel(omega1: number, t: number, phase: number): string {
  const theta = ((pulseAngle(omega1, t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const axis = Math.abs(Math.sin(phase)) > Math.abs(Math.cos(phase)) ? 'RY' : 'RX'
  const sign = axis === 'RX' ? -Math.cos(phase) : Math.sin(phase)
  const g = sign >= 0 ? axis : `${axis}⁻`
  const near = (target: number) => Math.abs(theta - target) < 0.06
  if (near(0) || near(2 * Math.PI)) return 'identity'
  if (near(Math.PI)) return `${g}(π) = ${axis === 'RX' ? 'X' : 'Y'}`
  if (near(Math.PI / 2)) return `${g}(π/2)`
  if (near((3 * Math.PI) / 2)) return `${g}(3π/2)`
  return `${g}(${(theta / Math.PI).toFixed(2)}π)`
}

/** Probability of measuring |1⟩ for a Bloch vector: (1 − z)/2, with |0⟩ at +z. */
export function probabilityOfOne(v: Vec3): number {
  return Math.min(1, Math.max(0, (1 - v[2]) / 2))
}
