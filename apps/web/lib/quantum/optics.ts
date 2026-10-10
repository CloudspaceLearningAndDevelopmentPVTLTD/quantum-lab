/**
 * optics.ts — a small optical table you can assemble in code.
 *
 * WHAT THIS MODELS
 * A single photon travelling through a set of spatial modes ("beams"), carrying a
 * polarisation, and optionally entangled with a partner photon whose polarisation is
 * measured somewhere else. Components — beam splitters, mirrors, phase shifters,
 * wave plates, polarisers, blockers — are values, not code paths: an optical table is
 * an array of them, and `runTable` folds the array over a state.
 *
 * THE STATE SPACE
 * path (M modes) ⊗ signal polarisation (2) ⊗ idler polarisation (2, optional).
 * Amplitudes live in two Float64Arrays indexed by
 *
 *     ((mode * 2) + polarisation) * idlerDim + idlerIndex
 *
 * with polarisation 0 = horizontal, 1 = vertical. The idler register exists so the
 * quantum eraser can be modelled honestly: the which-path information is carried by a
 * *second particle*, and "erasing" it is a choice of measurement basis on that second
 * particle, made after the first one is long gone. Components never touch the idler —
 * only `projectIdler` does — which is exactly the locality statement that makes the
 * eraser non-mysterious.
 *
 * NOT UNITARY, ON PURPOSE
 * Polarisers, blockers and attenuators throw amplitude away. The state is therefore
 * kept unnormalised and `totalProbability` is the probability that the photon survived
 * at all. Detection probabilities are absolute (they sum to ≤ 1), and any conditional
 * rate — "given the photon was not blocked", "in coincidence with an idler click" —
 * is a ratio the caller forms explicitly. Silently renormalising is how a simulation
 * ends up claiming a blocked interferometer still delivers one photon per shot.
 *
 * CONVENTIONS THAT MATTER
 * The beam splitter is the symmetric one,
 *
 *     [ t   i r ]        t = √(1−R),  r = √R
 *     [ i r   t ]
 *
 * where the i on the reflected term is what makes a lossless splitter unitary. Get
 * that phase wrong and a balanced Mach–Zehnder at zero phase difference splits 50/50
 * instead of sending every photon to one port — which is precisely the check
 * optics.test.ts opens with.
 *
 * Jones matrices act in the (H, V) basis with angles measured from H, anticlockwise.
 * A half-wave plate with its fast axis at α reflects linear polarisation about that
 * axis, so it rotates a linear state by 2α; at 45° it swaps H and V.
 */

export type Complex = { re: number; im: number }

/** Polarisation index for horizontal. */
export const POL_H = 0
/** Polarisation index for vertical. */
export const POL_V = 1

/** A polarisation state as a Jones vector [H component, V component]. */
export type Jones = readonly [Complex, Complex]

/** Linear polarisation at `angle` radians from horizontal. */
export function linearJones(angle: number): Jones {
  return [
    { re: Math.cos(angle), im: 0 },
    { re: Math.sin(angle), im: 0 },
  ]
}

/** Horizontal. */
export const JONES_H: Jones = linearJones(0)
/** Vertical. */
export const JONES_V: Jones = linearJones(Math.PI / 2)
/** Diagonal, (H + V)/√2. */
export const JONES_D: Jones = linearJones(Math.PI / 4)

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export interface OpticalState {
  /** Number of spatial modes. */
  readonly modes: number
  /** Whether a partner photon's polarisation is tracked alongside the signal's. */
  readonly hasIdler: boolean
  /** Real parts, in the index layout described at the top of this file. */
  readonly re: Float64Array
  /** Imaginary parts. */
  readonly im: Float64Array
}

/** Size of the idler register: 2 when a partner photon is tracked, else 1. */
export function idlerDim(state: { hasIdler: boolean }): number {
  return state.hasIdler ? 2 : 1
}

/** Flat index of one amplitude. */
export function stateIndex(
  state: { hasIdler: boolean },
  mode: number,
  pol: number,
  idler = 0,
): number {
  return (mode * 2 + pol) * idlerDim(state) + idler
}

/** An all-zero state with room for `modes` beams. */
export function emptyState(modes: number, options: { hasIdler?: boolean } = {}): OpticalState {
  const hasIdler = options.hasIdler ?? false
  const size = modes * 2 * (hasIdler ? 2 : 1)
  return { modes, hasIdler, re: new Float64Array(size), im: new Float64Array(size) }
}

export function cloneState(state: OpticalState): OpticalState {
  return {
    modes: state.modes,
    hasIdler: state.hasIdler,
    re: Float64Array.from(state.re),
    im: Float64Array.from(state.im),
  }
}

/** One amplitude, as a complex number. */
export function amplitude(state: OpticalState, mode: number, pol: number, idler = 0): Complex {
  const i = stateIndex(state, mode, pol, idler)
  return { re: state.re[i], im: state.im[i] }
}

/**
 * A single photon entering `mode` with polarisation `jones` (horizontal by default).
 * No idler register: use `entangledPair` when the which-path marker has to live on a
 * second particle.
 */
export function photonIn(modes: number, mode: number, jones: Jones = JONES_H): OpticalState {
  const state = emptyState(modes)
  state.re[stateIndex(state, mode, POL_H)] = jones[0].re
  state.im[stateIndex(state, mode, POL_H)] = jones[0].im
  state.re[stateIndex(state, mode, POL_V)] = jones[1].re
  state.im[stateIndex(state, mode, POL_V)] = jones[1].im
  return state
}

/**
 * A polarisation-entangled pair: the signal photon enters `mode`, and the two photons
 * share the Bell state Φ⁺ = (|HH⟩ + |VV⟩)/√2.
 *
 * The signal photon on its own is then completely unpolarised — a maximally mixed
 * state — which is why nothing you do to it alone can produce a polarisation fringe.
 * Everything interesting shows up only in coincidence with the idler.
 */
export function entangledPair(modes: number, mode: number): OpticalState {
  const state = emptyState(modes, { hasIdler: true })
  const a = 1 / Math.SQRT2
  state.re[stateIndex(state, mode, POL_H, POL_H)] = a
  state.re[stateIndex(state, mode, POL_V, POL_V)] = a
  return state
}

/** Total probability still in play — less than 1 once anything has been absorbed. */
export function totalProbability(state: OpticalState): number {
  let sum = 0
  for (let i = 0; i < state.re.length; i++) sum += state.re[i] * state.re[i] + state.im[i] * state.im[i]
  return sum
}

/** Probability of finding the photon in each mode, summed over polarisation and idler. */
export function modeProbabilities(state: OpticalState): number[] {
  const d = idlerDim(state)
  const out: number[] = []
  for (let mode = 0; mode < state.modes; mode++) {
    let sum = 0
    for (let pol = 0; pol < 2; pol++) {
      for (let k = 0; k < d; k++) {
        const i = stateIndex(state, mode, pol, k)
        sum += state.re[i] * state.re[i] + state.im[i] * state.im[i]
      }
    }
    out.push(sum)
  }
  return out
}

/** Probability of a click at a detector sitting in `mode`. */
export function modeProbability(state: OpticalState, mode: number): number {
  return modeProbabilities(state)[mode] ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

export type Component =
  /** Couples two modes. `reflectivity` 0.5 is the balanced 50:50 splitter. */
  | { kind: 'beamSplitter'; a: number; b: number; reflectivity: number }
  /** A fold in the beam. Contributes a phase; nothing else. */
  | { kind: 'mirror'; mode: number; phase: number }
  /** Adds `phi` radians of optical path to one mode. */
  | { kind: 'phaseShifter'; mode: number; phi: number }
  /** Linear retarder: `retardance` radians between the axes, fast axis at `angle`. */
  | { kind: 'waveplate'; mode: number; retardance: number; angle: number }
  /** Projects onto linear polarisation at `angle`. Lossy. */
  | { kind: 'polariser'; mode: number; angle: number }
  /** Transmits H, reflects V into the other mode. Lossless, and a which-path sorter. */
  | { kind: 'polarisingBeamSplitter'; a: number; b: number }
  /** A card in the beam. Removes the mode entirely. */
  | { kind: 'blocker'; mode: number }
  /** Grey filter passing `transmission` of the intensity. */
  | { kind: 'attenuator'; mode: number; transmission: number }

export const beamSplitter = (a: number, b: number, reflectivity = 0.5): Component => ({
  kind: 'beamSplitter',
  a,
  b,
  reflectivity,
})
export const mirror = (mode: number, phase = Math.PI): Component => ({ kind: 'mirror', mode, phase })
export const phaseShifter = (mode: number, phi: number): Component => ({
  kind: 'phaseShifter',
  mode,
  phi,
})
export const waveplate = (mode: number, retardance: number, angle: number): Component => ({
  kind: 'waveplate',
  mode,
  retardance,
  angle,
})
/** Half-wave plate: rotates linear polarisation by twice the plate angle. */
export const halfWavePlate = (mode: number, angle: number): Component =>
  waveplate(mode, Math.PI, angle)
/** Quarter-wave plate: turns linear at 45° to the axis into circular. */
export const quarterWavePlate = (mode: number, angle: number): Component =>
  waveplate(mode, Math.PI / 2, angle)
export const polariser = (mode: number, angle: number): Component => ({
  kind: 'polariser',
  mode,
  angle,
})
export const polarisingBeamSplitter = (a: number, b: number): Component => ({
  kind: 'polarisingBeamSplitter',
  a,
  b,
})
export const blocker = (mode: number): Component => ({ kind: 'blocker', mode })
export const attenuator = (mode: number, transmission: number): Component => ({
  kind: 'attenuator',
  mode,
  transmission,
})

/** Multiply one mode's whole polarisation-and-idler block by a complex scalar. */
function scaleMode(state: OpticalState, mode: number, sRe: number, sIm: number): void {
  const d = idlerDim(state)
  for (let pol = 0; pol < 2; pol++) {
    for (let k = 0; k < d; k++) {
      const i = stateIndex(state, mode, pol, k)
      const re = state.re[i]
      const im = state.im[i]
      state.re[i] = re * sRe - im * sIm
      state.im[i] = re * sIm + im * sRe
    }
  }
}

/** Apply a 2×2 complex Jones matrix to one mode's polarisation, for every idler index. */
function applyJones(
  state: OpticalState,
  mode: number,
  j00: Complex,
  j01: Complex,
  j10: Complex,
  j11: Complex,
): void {
  const d = idlerDim(state)
  for (let k = 0; k < d; k++) {
    const ih = stateIndex(state, mode, POL_H, k)
    const iv = stateIndex(state, mode, POL_V, k)
    const hr = state.re[ih]
    const hi = state.im[ih]
    const vr = state.re[iv]
    const vi = state.im[iv]
    state.re[ih] = j00.re * hr - j00.im * hi + (j01.re * vr - j01.im * vi)
    state.im[ih] = j00.re * hi + j00.im * hr + (j01.re * vi + j01.im * vr)
    state.re[iv] = j10.re * hr - j10.im * hi + (j11.re * vr - j11.im * vi)
    state.im[iv] = j10.re * hi + j10.im * hr + (j11.re * vi + j11.im * vr)
  }
}

/** Apply one component. Returns a new state; the input is untouched. */
export function applyComponent(state: OpticalState, component: Component): OpticalState {
  const out = cloneState(state)
  const d = idlerDim(state)

  switch (component.kind) {
    case 'beamSplitter': {
      const r = Math.sqrt(Math.max(0, Math.min(1, component.reflectivity)))
      const t = Math.sqrt(1 - r * r)
      for (let pol = 0; pol < 2; pol++) {
        for (let k = 0; k < d; k++) {
          const ia = stateIndex(state, component.a, pol, k)
          const ib = stateIndex(state, component.b, pol, k)
          const ar = state.re[ia]
          const ai = state.im[ia]
          const br = state.re[ib]
          const bi = state.im[ib]
          // a' = t·a + i r·b, b' = i r·a + t·b. Multiplying by i sends (x, y) to (−y, x).
          out.re[ia] = t * ar - r * bi
          out.im[ia] = t * ai + r * br
          out.re[ib] = t * br - r * ai
          out.im[ib] = t * bi + r * ar
        }
      }
      return out
    }

    case 'mirror':
    case 'phaseShifter': {
      const phi = component.kind === 'mirror' ? component.phase : component.phi
      scaleMode(out, component.mode, Math.cos(phi), Math.sin(phi))
      return out
    }

    case 'waveplate': {
      // R(α)·diag(1, e^{iδ})·R(−α), the standard linear retarder.
      const c = Math.cos(component.angle)
      const s = Math.sin(component.angle)
      const er = Math.cos(component.retardance)
      const ei = Math.sin(component.retardance)
      const j00 = { re: c * c + s * s * er, im: s * s * ei }
      const off = { re: c * s * (1 - er), im: -c * s * ei }
      const j11 = { re: s * s + c * c * er, im: c * c * ei }
      applyJones(out, component.mode, j00, off, off, j11)
      return out
    }

    case 'polariser': {
      const c = Math.cos(component.angle)
      const s = Math.sin(component.angle)
      applyJones(
        out,
        component.mode,
        { re: c * c, im: 0 },
        { re: c * s, im: 0 },
        { re: c * s, im: 0 },
        { re: s * s, im: 0 },
      )
      return out
    }

    case 'polarisingBeamSplitter': {
      // H is transmitted, V is reflected into the partner mode. Lossless.
      for (let k = 0; k < d; k++) {
        const ia = stateIndex(state, component.a, POL_V, k)
        const ib = stateIndex(state, component.b, POL_V, k)
        out.re[ia] = state.re[ib]
        out.im[ia] = state.im[ib]
        out.re[ib] = state.re[ia]
        out.im[ib] = state.im[ia]
      }
      return out
    }

    case 'blocker': {
      for (let pol = 0; pol < 2; pol++) {
        for (let k = 0; k < d; k++) {
          const i = stateIndex(state, component.mode, pol, k)
          out.re[i] = 0
          out.im[i] = 0
        }
      }
      return out
    }

    case 'attenuator': {
      const a = Math.sqrt(Math.max(0, Math.min(1, component.transmission)))
      scaleMode(out, component.mode, a, 0)
      return out
    }
  }
}

/** Fold a whole table over a state. */
export function runTable(state: OpticalState, table: readonly Component[]): OpticalState {
  let current = state
  for (const component of table) current = applyComponent(current, component)
  return current
}

/**
 * Every intermediate state: `trace[0]` is the input, `trace[i + 1]` is the state after
 * `table[i]`. The visualizations draw beam brightness from these, so the picture and
 * the numbers come from the same run.
 */
export function runTableTrace(
  state: OpticalState,
  table: readonly Component[],
): OpticalState[] {
  const trace: OpticalState[] = [state]
  let current = state
  for (const component of table) {
    current = applyComponent(current, component)
    trace.push(current)
  }
  return trace
}

// ─────────────────────────────────────────────────────────────────────────────
// Measurement on the partner photon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project the idler onto linear polarisation at `angle` and drop its register.
 *
 * The result is unnormalised: its `totalProbability` is the joint probability that the
 * idler passed the analyser AND the signal is somewhere on the table — i.e. the
 * coincidence rate. Conditional fringe curves are this divided by the idler's own
 * transmission rate.
 *
 * This is deliberately the ONLY function that touches the idler. Nothing a component
 * does can depend on it, which is the whole reason the eraser cannot send a signal:
 * the signal photon's own statistics are fixed before this is ever called.
 */
export function projectIdler(state: OpticalState, angle: number): OpticalState {
  if (!state.hasIdler) return cloneState(state)
  const out = emptyState(state.modes)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  for (let mode = 0; mode < state.modes; mode++) {
    for (let pol = 0; pol < 2; pol++) {
      const src0 = stateIndex(state, mode, pol, POL_H)
      const src1 = stateIndex(state, mode, pol, POL_V)
      const dst = stateIndex(out, mode, pol)
      out.re[dst] = c * state.re[src0] + s * state.re[src1]
      out.im[dst] = c * state.im[src0] + s * state.im[src1]
    }
  }
  return out
}

/**
 * Fringe visibility of a sampled curve: (max − min) / (max + min).
 * Returns 0 for a flat or empty curve rather than dividing by zero.
 */
export function visibilityOf(samples: readonly number[]): number {
  if (samples.length === 0) return 0
  let max = -Infinity
  let min = Infinity
  for (const v of samples) {
    if (v > max) max = v
    if (v < min) min = v
  }
  const sum = max + min
  if (sum <= 1e-15) return 0
  return Math.max(0, Math.min(1, (max - min) / sum))
}

/**
 * |⟨ψa|ψb⟩| — how alike the internal states (polarisation, and the idler when there is
 * one) carried by two modes are. 1 means the two paths are indistinguishable; 0 means
 * a perfect which-path marker. Returns 0 when either mode is empty, which is the right
 * answer for a blocked arm: there is nothing left to interfere with.
 */
export function markerOverlap(state: OpticalState, a: number, b: number): number {
  const d = idlerDim(state)
  let dotRe = 0
  let dotIm = 0
  let na = 0
  let nb = 0
  for (let pol = 0; pol < 2; pol++) {
    for (let k = 0; k < d; k++) {
      const ia = stateIndex(state, a, pol, k)
      const ib = stateIndex(state, b, pol, k)
      const ar = state.re[ia]
      const ai = state.im[ia]
      const br = state.re[ib]
      const bi = state.im[ib]
      dotRe += ar * br + ai * bi
      dotIm += ar * bi - ai * br
      na += ar * ar + ai * ai
      nb += br * br + bi * bi
    }
  }
  if (na <= 1e-18 || nb <= 1e-18) return 0
  return Math.sqrt(dotRe * dotRe + dotIm * dotIm) / Math.sqrt(na * nb)
}

/**
 * The best fringe visibility these two arms could ever produce, in closed form:
 *
 *     V_max = 2 √(Pa Pb) |⟨ψa|ψb⟩| / (Pa + Pb)
 *
 * Unequal arm powers wash the fringes out through the prefactor; a which-path marker
 * washes them out through the overlap. Both terms are ≤ 1, so this is also the
 * statement that you cannot have full fringes and any which-path knowledge at once.
 *
 * "Could ever" is load-bearing: this is the visibility a BALANCED recombining splitter
 * extracts. Recombine on a 20:80 splitter and the measured fringes come out lower still,
 * because the splitter re-weights the two arms again on the way to the detector. That
 * shortfall is an instrument defect, not which-path information, which is why
 * `MachZehnderResult` reports the measured visibility and this bound separately.
 */
export function predictedVisibility(state: OpticalState, a: number, b: number): number {
  const probs = modeProbabilities(state)
  const pa = probs[a] ?? 0
  const pb = probs[b] ?? 0
  if (pa + pb <= 1e-18) return 0
  return (2 * Math.sqrt(pa * pb) * markerOverlap(state, a, b)) / (pa + pb)
}

// ─────────────────────────────────────────────────────────────────────────────
// Prebuilt tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two arms, which are also the two output ports — an interferometer reuses its
 * modes. `ARM_A` is the arm the photon is TRANSMITTED into at the first splitter and
 * `ARM_B` the one it is reflected into, so with a photon entering `ARM_A` and no phase
 * difference every photon leaves through `ARM_B`. The visualizations draw A as the
 * straight-through path and B as the folded one.
 */
export const ARM_A = 0
export const ARM_B = 1

export type MachZehnderOptions = {
  /** Optical phase added in `phaseArm`, radians. */
  phase: number
  phaseArm: number
  /** Arm to put a card in front of, or null. */
  blockedArm: number | null
  /** Half-wave plate angle in `markerArm`, radians — the which-path marker. null = none. */
  markerAngle: number | null
  markerArm: number
  /** Reflectivity of both splitters. 0.5 is balanced. */
  reflectivity: number
  /** Polariser angle in front of both detectors — the "eraser". null = none. */
  analyserAngle: number | null
  /** Remove the recombining splitter, turning the interferometer into a which-path meter. */
  secondSplitter: boolean
}

export const MACH_ZEHNDER_DEFAULTS: MachZehnderOptions = {
  phase: 0,
  phaseArm: ARM_A,
  blockedArm: null,
  markerAngle: null,
  markerArm: ARM_A,
  reflectivity: 0.5,
  analyserAngle: null,
  secondSplitter: true,
}

/**
 * The components between the two splitters, in order. Split out so a caller can build
 * the arm state (for beam brightness, marker overlap and visibility) without rerunning
 * the recombination.
 */
function armComponents(options: MachZehnderOptions): Component[] {
  const table: Component[] = [
    // One fold per arm. Both phases are equal, so this is a global factor that cancels —
    // it is here because the drawing has two mirrors and the table should match it.
    mirror(ARM_A),
    mirror(ARM_B),
  ]
  if (options.markerAngle !== null) table.push(halfWavePlate(options.markerArm, options.markerAngle))
  table.push(phaseShifter(options.phaseArm, options.phase))
  if (options.blockedArm !== null) table.push(blocker(options.blockedArm))
  return table
}

/** The full table for a Mach–Zehnder interferometer, first splitter to detectors. */
export function machZehnderTable(options: MachZehnderOptions): Component[] {
  const table: Component[] = [beamSplitter(ARM_A, ARM_B, options.reflectivity)]
  table.push(...armComponents(options))
  if (options.secondSplitter) {
    table.push(beamSplitter(ARM_A, ARM_B, options.reflectivity))
  }
  if (options.analyserAngle !== null) {
    table.push(polariser(ARM_A, options.analyserAngle))
    table.push(polariser(ARM_B, options.analyserAngle))
  }
  return table
}

export type MachZehnderResult = {
  /** Probability in each arm just before the second splitter. */
  arms: [number, number]
  /** Probability of a click at each output detector. Sums to ≤ 1. */
  ports: [number, number]
  /** Probability the photon reaches either detector at all. */
  survival: number
  /** State inside the arms — the drawing reads beam brightness from this. */
  armState: OpticalState
  /** State at the detectors. */
  outState: OpticalState
  /** |⟨ψ_A|ψ_B⟩| of the polarisation carried by the two arms. */
  overlap: number
  /** Fringe visibility of port 0, measured by sweeping the phase over 2π. */
  visibility: number
  /** The complementarity bound `predictedVisibility` puts on that measurement. */
  maxVisibility: number
  /**
   * √(1 − V_max²): how well you could guess which arm the photon took, given what the
   * arms carry. The relation V_max² + D² = 1 is an equality here rather than the usual
   * inequality, because nothing in this model is mixed — the state stays pure.
   */
  distinguishability: number
}

/** Sweep the phase and return P(port) at each of `samples` points across 0…2π. */
export function machZehnderSweep(
  options: MachZehnderOptions,
  port: number,
  samples = 96,
  input: OpticalState = photonIn(2, ARM_A),
): number[] {
  const out: number[] = []
  for (let i = 0; i < samples; i++) {
    const phase = (2 * Math.PI * i) / samples
    const state = runTable(input, machZehnderTable({ ...options, phase }))
    out.push(modeProbability(state, port))
  }
  return out
}

/** Run one Mach–Zehnder configuration and collect everything a page wants to show. */
export function machZehnder(
  options: MachZehnderOptions,
  input: OpticalState = photonIn(2, ARM_A),
): MachZehnderResult {
  const afterFirst = applyComponent(input, beamSplitter(ARM_A, ARM_B, options.reflectivity))
  const armState = runTable(afterFirst, armComponents(options))

  let outState = armState
  if (options.secondSplitter) {
    outState = applyComponent(outState, beamSplitter(ARM_A, ARM_B, options.reflectivity))
  }
  if (options.analyserAngle !== null) {
    outState = applyComponent(outState, polariser(ARM_A, options.analyserAngle))
    outState = applyComponent(outState, polariser(ARM_B, options.analyserAngle))
  }

  const arms = modeProbabilities(armState)
  const ports = modeProbabilities(outState)
  const visibility = visibilityOf(machZehnderSweep(options, ARM_A, 96, input))
  const maxVisibility = predictedVisibility(armState, ARM_A, ARM_B)

  return {
    arms: [arms[0] ?? 0, arms[1] ?? 0],
    ports: [ports[0] ?? 0, ports[1] ?? 0],
    survival: totalProbability(outState),
    armState,
    outState,
    overlap: markerOverlap(armState, ARM_A, ARM_B),
    visibility,
    maxVisibility,
    distinguishability: Math.sqrt(Math.max(0, 1 - maxVisibility * maxVisibility)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The quantum eraser
// ─────────────────────────────────────────────────────────────────────────────

export type EraserOptions = {
  /** Phase in arm A, radians. */
  phase: number
  /**
   * Half-wave plate angle in arm A, radians, or null for no marker.
   * At 45° the plate swaps H and V, which — given the Φ⁺ source — makes the two arms
   * carry orthogonal two-photon states and destroys the fringes completely.
   */
  markerAngle: number | null
  /** Idler analyser angle, radians. 0 reads the which-path basis; π/4 erases. */
  idlerAngle: number
  reflectivity: number
}

export const ERASER_DEFAULTS: EraserOptions = {
  phase: 0,
  markerAngle: Math.PI / 4,
  idlerAngle: Math.PI / 4,
  reflectivity: 0.5,
}

export type EraserResult = {
  /** P(click at each signal detector), ignoring the idler entirely. */
  singles: [number, number]
  /** P(signal click AND idler passes the analyser). */
  coincidence: [number, number]
  /** The same for the analyser's other output port, at idlerAngle + 90°. */
  coincidenceOrthogonal: [number, number]
  /** Fraction of shots in which the idler passes the analyser. Always ½ here. */
  idlerRate: number
  /** Visibility of each curve as the phase is swept. */
  visibility: { singles: number; coincidence: number; coincidenceOrthogonal: number }
  /** |⟨ψ_A|ψ_B⟩| including the idler — 0 when the marker is on. */
  overlap: number
}

function eraserTable(options: EraserOptions): Component[] {
  return machZehnderTable({
    ...MACH_ZEHNDER_DEFAULTS,
    phase: options.phase,
    phaseArm: ARM_A,
    markerAngle: options.markerAngle,
    markerArm: ARM_A,
    reflectivity: options.reflectivity,
  })
}

/** Signal-side detector probabilities in coincidence with an idler analyser at `angle`. */
function coincidenceAt(options: EraserOptions, angle: number): [number, number] {
  const out = runTable(entangledPair(2, ARM_A), eraserTable(options))
  const probs = modeProbabilities(projectIdler(out, angle))
  return [probs[0] ?? 0, probs[1] ?? 0]
}

export type EraserRates = Pick<
  EraserResult,
  'singles' | 'coincidence' | 'coincidenceOrthogonal' | 'idlerRate'
>

/**
 * The rates at one phase setting, without the phase sweeps `quantumEraser` needs for
 * its visibility figures. This is the hot path: the visualization evaluates it once per
 * phase bin to draw the theory curves and once per frame for the live readout, where
 * re-deriving three visibilities each time would be ~300 table runs of wasted work.
 */
export function eraserRates(options: EraserOptions): EraserRates {
  const out = runTable(entangledPair(2, ARM_A), eraserTable(options))
  const singlesProbs = modeProbabilities(out)
  const coincidence = coincidenceAt(options, options.idlerAngle)
  const coincidenceOrthogonal = coincidenceAt(options, options.idlerAngle + Math.PI / 2)
  return {
    singles: [singlesProbs[0] ?? 0, singlesProbs[1] ?? 0],
    coincidence,
    coincidenceOrthogonal,
    idlerRate: coincidence[0] + coincidence[1],
  }
}

function sweepEraser(
  options: EraserOptions,
  pick: (o: EraserOptions) => number,
  samples = 96,
): number[] {
  const out: number[] = []
  for (let i = 0; i < samples; i++) {
    out.push(pick({ ...options, phase: (2 * Math.PI * i) / samples }))
  }
  return out
}

/**
 * Run the delayed-choice eraser and collect the three curves that matter: the signal
 * singles, and the two coincidence subensembles the idler sorts the shots into.
 *
 * The honest reading, which the page's copy states and these numbers back: `singles`
 * never depends on `idlerAngle`, at any phase. Turning the analyser cannot change what
 * the signal detectors record. What it changes is how the *same* clicks get sorted
 * into two piles — and the two piles' fringes are exactly out of step, so they add
 * back up to the flat singles curve.
 */
export function quantumEraser(options: EraserOptions): EraserResult {
  const rates = eraserRates(options)

  const armsOnly = runTable(
    applyComponent(entangledPair(2, ARM_A), beamSplitter(ARM_A, ARM_B, options.reflectivity)),
    armComponents({
      ...MACH_ZEHNDER_DEFAULTS,
      phase: options.phase,
      markerAngle: options.markerAngle,
      markerArm: ARM_A,
    }),
  )

  return {
    ...rates,
    visibility: {
      singles: visibilityOf(
        sweepEraser(options, (o) => modeProbabilities(runTable(entangledPair(2, ARM_A), eraserTable(o)))[0] ?? 0),
      ),
      coincidence: visibilityOf(sweepEraser(options, (o) => coincidenceAt(o, o.idlerAngle)[0])),
      coincidenceOrthogonal: visibilityOf(
        sweepEraser(options, (o) => coincidenceAt(o, o.idlerAngle + Math.PI / 2)[0]),
      ),
    },
    overlap: markerOverlap(armsOnly, ARM_A, ARM_B),
  }
}
