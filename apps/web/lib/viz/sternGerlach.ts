/**
 * lib/viz/sternGerlach.ts — the spin-1/2 measurement algebra behind
 * /visualizations/stern-gerlach.
 *
 * Everything the page draws comes out of this module, and nothing here knows
 * about canvases, React or colours — the point is that the numbers on the
 * screen can be checked against the analytic results a physicist would write
 * down by hand (see sternGerlach.test.ts).
 *
 * The model is a single spin-1/2 particle as a two-component spinor in the
 * z basis:
 *
 *     |psi> = a |+z> + b |-z>,        a, b complex, |a|^2 + |b|^2 = 1
 *
 * An analyser is a direction on the Bloch sphere (polar angle `theta` from
 * +z, azimuth `phi` about z). Its two eigenstates are
 *
 *     |n,+> = ( cos(theta/2),  e^{i phi} sin(theta/2) )
 *     |n,-> = (-sin(theta/2),  e^{i phi} cos(theta/2) )
 *
 * and the Born rule gives the probability of each output port. Two facts fall
 * straight out of that, and they are the entire teaching payload of the page:
 *
 *   1. P(+ | state aligned with an axis at angle D away) = cos^2(D/2).
 *   2. Passing a beam through an analyser REPLACES the state with that
 *      analyser's eigenstate. Nothing of the previous axis survives.
 *
 * Fact 2 is why a z-up beam sent through an x analyser and then back into a z
 * analyser comes out 50/50 rather than 100% up. It is not noise, it is not the
 * apparatus being clumsy; it is that `eigenstate` is the whole post-measurement
 * state and it has no memory of what came before.
 */

export type Complex = { readonly re: number; readonly im: number }

/** Amplitudes in the z basis: [a, b] for a|+z> + b|-z>. */
export type Spinor = readonly [Complex, Complex]

export type Vec3 = readonly [number, number, number]

/** +1 is the "up" (spin-along-the-axis) port, -1 the "down" port. */
export type Outcome = 1 | -1

/** A measurement axis as a Bloch-sphere direction. Angles in radians. */
export type Axis = { readonly theta: number; readonly phi: number }

export const DEG = Math.PI / 180

export const Z_AXIS: Axis = { theta: 0, phi: 0 }
export const X_AXIS: Axis = { theta: Math.PI / 2, phi: 0 }
export const Y_AXIS: Axis = { theta: Math.PI / 2, phi: Math.PI / 2 }

/** The unit vector an axis points along, in (x, y, z). */
export function axisVector({ theta, phi }: Axis): Vec3 {
  const s = Math.sin(theta)
  return [s * Math.cos(phi), s * Math.sin(phi), Math.cos(theta)]
}

/**
 * The eigenstate of the spin component along `axis` with the given outcome.
 *
 * These two are orthogonal for every axis, which is the formal statement that
 * an analyser has exactly two output ports and every atom leaves through one
 * of them.
 */
export function eigenstate(axis: Axis, outcome: Outcome): Spinor {
  const c = Math.cos(axis.theta / 2)
  const s = Math.sin(axis.theta / 2)
  const cosPhi = Math.cos(axis.phi)
  const sinPhi = Math.sin(axis.phi)
  if (outcome === 1) {
    return [
      { re: c, im: 0 },
      { re: s * cosPhi, im: s * sinPhi },
    ]
  }
  return [
    { re: -s, im: 0 },
    { re: c * cosPhi, im: c * sinPhi },
  ]
}

/** <a|b>, the Hermitian inner product (conjugate-linear in the first slot). */
export function innerProduct(a: Spinor, b: Spinor): Complex {
  let re = 0
  let im = 0
  for (let i = 0; i < 2; i++) {
    // conj(a_i) * b_i
    re += a[i].re * b[i].re + a[i].im * b[i].im
    im += a[i].re * b[i].im - a[i].im * b[i].re
  }
  return { re, im }
}

/** <psi|psi>. Every state this module produces should return 1. */
export function norm2(state: Spinor): number {
  const ip = innerProduct(state, state)
  return ip.re
}

/**
 * The Born rule: |<n,outcome|psi>|^2.
 *
 * For `state` aligned with some axis and `axis` a direction D away from it,
 * this is exactly cos^2(D/2) for outcome +1 — the law the page's live readout
 * shows, derived here rather than hard-coded.
 */
export function outcomeProbability(state: Spinor, axis: Axis, outcome: Outcome): number {
  const amp = innerProduct(eigenstate(axis, outcome), state)
  return amp.re * amp.re + amp.im * amp.im
}

/** The Bloch vector (<sx>, <sy>, <sz>) of a normalised spinor. */
export function blochVector(state: Spinor): Vec3 {
  const [a, b] = state
  return [
    2 * (a.re * b.re + a.im * b.im),
    2 * (a.re * b.im - a.im * b.re),
    a.re * a.re + a.im * a.im - (b.re * b.re + b.im * b.im),
  ]
}

/** Angle between two directions, in radians, clamped against rounding drift. */
export function angleBetween(u: Vec3, v: Vec3): number {
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const lu = Math.hypot(u[0], u[1], u[2])
  const lv = Math.hypot(v[0], v[1], v[2])
  if (lu === 0 || lv === 0) return 0
  return Math.acos(Math.min(1, Math.max(-1, dot / (lu * lv))))
}

/**
 * A uniformly random pure spin state (Haar measure on the Bloch sphere), from
 * two uniform deviates. Used to justify the `null` source below: averaged over
 * this ensemble, every axis reads 50/50, which is what "unpolarised oven"
 * means.
 */
export function randomSpinState(u1: number, u2: number): Spinor {
  const z = 2 * u1 - 1
  return eigenstate({ theta: Math.acos(Math.min(1, Math.max(-1, z))), phi: 2 * Math.PI * u2 }, 1)
}

/**
 * A source: either a definite prepared spinor, or `null` for an unpolarised
 * beam. `null` is not a state — it is the maximally mixed density matrix,
 * which every axis reads 50/50 and which collapses to a definite eigenstate on
 * the first measurement. Modelling it as a special case keeps the rest of the
 * module working with pure states only.
 */
export type Source = Spinor | null

/**
 * One analyser in the chain: the axis it measures, and which of its two output
 * ports is allowed to continue (the other beam runs into a beam stop).
 *
 * The LAST analyser's `port` selects nothing physical — nothing is downstream
 * of it — so callers may set it to whatever they want to highlight.
 */
export type Analyser = { readonly axis: Axis; readonly port: Outcome }

/**
 * Measure `state` along `axis`, using the uniform deviate `u` in [0, 1).
 * A `null` state (unpolarised) gives 50/50 on any axis.
 */
export function measure(
  state: Source,
  axis: Axis,
  u: number
): { outcome: Outcome; state: Spinor } {
  const pPlus = state === null ? 0.5 : outcomeProbability(state, axis, 1)
  const outcome: Outcome = u < pPlus ? 1 : -1
  return { outcome, state: eigenstate(axis, outcome) }
}

/**
 * The state of the beam ENTERING analyser `index`, given every earlier
 * analyser passed its selected port. Returns `null` when that beam is still
 * unpolarised (only possible for index 0 with an unpolarised source).
 */
export function beamStateBefore(
  source: Source,
  chain: readonly Analyser[],
  index: number
): Source {
  let state: Source = source
  for (let i = 0; i < index && i < chain.length; i++) {
    state = eigenstate(chain[i].axis, chain[i].port)
  }
  return state
}

/**
 * Exact P(+ port) at every analyser in the chain, each one CONDITIONED on all
 * the earlier analysers having passed their selected port.
 *
 * The signature result: `chainPlusProbabilities(null, [z+, x+, z])` is
 * [0.5, 0.5, 0.5]. The third number is 0.5 and not 1 even though the beam was
 * verified z-up two analysers ago — that is the whole experiment.
 */
export function chainPlusProbabilities(source: Source, chain: readonly Analyser[]): number[] {
  const out: number[] = []
  for (let i = 0; i < chain.length; i++) {
    const state = beamStateBefore(source, chain, i)
    out.push(state === null ? 0.5 : outcomeProbability(state, chain[i].axis, 1))
  }
  return out
}

export type ChainShot = {
  /** Outcome at each analyser this atom actually reached, in order. */
  readonly outcomes: readonly Outcome[]
  /**
   * Index of the analyser whose beam stop absorbed the atom, or -1 if it made
   * it all the way to the detector at the end of the chain.
   */
  readonly blockedAt: number
}

/**
 * Send one atom through the chain. `rand` supplies uniform deviates in [0, 1);
 * pass a seeded generator (lib/quantum's mulberry32) to make a run
 * reproducible.
 */
export function runChain(
  rand: () => number,
  source: Source,
  chain: readonly Analyser[]
): ChainShot {
  const outcomes: Outcome[] = []
  let state: Source = source
  for (let i = 0; i < chain.length; i++) {
    const step = measure(state, chain[i].axis, rand())
    outcomes.push(step.outcome)
    state = step.state
    // The final analyser is the detector: both its ports are counted, so
    // nothing is blocked there.
    if (i < chain.length - 1 && step.outcome !== chain[i].port) {
      return { outcomes, blockedAt: i }
    }
  }
  return { outcomes, blockedAt: -1 }
}

/** Running tallies: how many atoms left through each port of each analyser. */
export type ChainCounts = {
  /** `plus[i]` / `minus[i]` for analyser i. */
  readonly plus: readonly number[]
  readonly minus: readonly number[]
  /** Atoms emitted by the source so far. */
  readonly emitted: number
}

export function emptyCounts(length: number): ChainCounts {
  return { plus: new Array(length).fill(0), minus: new Array(length).fill(0), emitted: 0 }
}

/** Fold one shot's outcomes into a tally. Returns a new object. */
export function addShot(counts: ChainCounts, shot: ChainShot): ChainCounts {
  const plus = counts.plus.slice()
  const minus = counts.minus.slice()
  for (let i = 0; i < shot.outcomes.length; i++) {
    if (shot.outcomes[i] === 1) plus[i] += 1
    else minus[i] += 1
  }
  return { plus, minus, emitted: counts.emitted + 1 }
}

/**
 * The angle, in radians, between the spin direction arriving at analyser
 * `index` and that analyser's own axis — the D in cos^2(D/2). Returns null for
 * an unpolarised incoming beam, where no such angle exists.
 */
export function incidentAngle(
  source: Source,
  chain: readonly Analyser[],
  index: number
): number | null {
  const state = beamStateBefore(source, chain, index)
  if (state === null) return null
  return angleBetween(blochVector(state), axisVector(chain[index].axis))
}

/** cos^2(D/2), stated once so the page and the tests refer to the same thing. */
export function malus(deltaRadians: number): number {
  const c = Math.cos(deltaRadians / 2)
  return c * c
}

/**
 * Name an in-plane axis for display: 0 deg is +z, 90 deg is +x, 180 deg is -z.
 * Anything else gets its angle.
 */
export function axisLabel(thetaDegrees: number): string {
  const t = ((thetaDegrees % 360) + 360) % 360
  if (Math.abs(t - 0) < 0.5) return 'z'
  if (Math.abs(t - 90) < 0.5) return 'x'
  if (Math.abs(t - 180) < 0.5) return '−z'
  if (Math.abs(t - 270) < 0.5) return '−x'
  return `${t.toFixed(0)}°`
}
