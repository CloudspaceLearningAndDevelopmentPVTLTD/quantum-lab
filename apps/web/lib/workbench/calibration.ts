/**
 * calibration.ts — a drifting single qubit, the pulse that is supposed to be
 * its X gate, and two ways of keeping that pulse calibrated without ever being
 * told what the qubit is actually doing.
 *
 * This is the numerics behind /workbench/calibration, a small-scale replica of
 * the July 2026 result in which an RL agent kept gate fidelity on Willow by
 * reading measurement outcomes alone. Here it is one qubit and three pulse
 * parameters; the machinery is the same shape.
 *
 * ── THE PHYSICS ────────────────────────────────────────────────────────────────
 * The qubit has two HIDDEN numbers: its transition frequency (as an offset, in
 * MHz, from the nominal reference the controllers start from) and its Rabi
 * rate — how many MHz of Rabi frequency one unit of drive amplitude buys.
 * Both drift.
 *
 * A pulse is (duration ns, amplitude 0–1, drive frequency MHz). In the frame
 * rotating with the drive, and under the rotating-wave approximation, the pulse
 * is a rotation of the Bloch vector about the axis (ω₁, 0, Δ)/Ω by angle Ω·T:
 *
 *     ω₁ = 2π · rabiRate · amplitude        (rad/ns)
 *     Δ  = 2π · (f_qubit − f_drive)         (rad/ns)
 *     Ω  = √(ω₁² + Δ²)
 *
 * This is exactly the picture lib/viz/spinPrecession.ts uses for magnetic
 * resonance (its `generalizedRabiFrequency` and `rotateAbout` are reused
 * here), and the gate fidelity that falls out of it is checked in the tests
 * against that module's closed-form Rabi solution, which knows nothing about
 * gates.
 *
 * Units: nanoseconds and megahertz throughout. 2π·1e-3 converts MHz to rad/ns.
 *
 * ── WHAT A CONTROLLER IS ALLOWED TO SEE ───────────────────────────────────────
 * Only counts. `Instrument.run(experiment, shots)` returns how many of `shots`
 * measurements came out |1⟩, sampled from the Born rule with a readout error
 * folded in. The hidden truth never crosses that interface; the page draws it
 * for the READER, faintly, so you can see the agent tracking something it
 * cannot look at.
 *
 * ── NOT MODELLED ──────────────────────────────────────────────────────────────
 * No decoherence (T₁, T₂), no leakage to |2⟩, no pulse shaping or DRAG, no
 * crosstalk, no readout drift. The pulse is a rectangular rotation. Those are
 * the things that make real calibration hard; this file is about the control
 * loop, not the device.
 */

import { generalizedRabiFrequency, rotateAbout, type Vec3 } from '@/lib/viz/spinPrecession'
import { gaussian, mulberry32 } from '@/lib/quantum'

// ─────────────────────────────────────────────────────────────────────────────
// Units and nominal values
// ─────────────────────────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI
/** rad/ns per MHz. */
export const RAD_PER_NS_PER_MHZ = TWO_PI * 1e-3

export type Pulse = {
  /** Pulse length in nanoseconds. */
  duration: number
  /** Drive amplitude in instrument units, 0 to 1. */
  amplitude: number
  /** Drive frequency as an offset from the nominal reference, in MHz. */
  frequency: number
}

export type QubitTruth = {
  /** The qubit's transition frequency as an offset from the reference, MHz. Hidden. */
  frequency: number
  /** MHz of Rabi frequency per unit of drive amplitude. Hidden. */
  rabiRate: number
}

/** Where the qubit sits before any drift, and what every controller starts from. */
export const NOMINAL_TRUTH: QubitTruth = { frequency: 0, rabiRate: 25 }

/**
 * The pulse that is a perfect X on the nominal qubit: 2π · 25 MHz · 0.5 · 40 ns
 * · 1e-3 = π. A 40 ns π pulse is a realistic transmon X gate.
 */
export const NOMINAL_PULSE: Pulse = { duration: 40, amplitude: 0.5, frequency: 0 }

/** Hard limits on what a controller may ask the instrument to play. */
export const PULSE_LIMITS = {
  duration: [10, 200] as const,
  amplitude: [0.02, 1] as const,
  frequency: [-25, 25] as const,
}

export function clampPulse(p: Pulse): Pulse {
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))
  return {
    duration: clamp(p.duration, PULSE_LIMITS.duration),
    amplitude: clamp(p.amplitude, PULSE_LIMITS.amplitude),
    frequency: clamp(p.frequency, PULSE_LIMITS.frequency),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The pulse as a rotation
// ─────────────────────────────────────────────────────────────────────────────

export type PulseRotation = {
  /** Unit rotation axis in the rotating frame; lies in the x–z plane. */
  axis: Vec3
  /** Rotation angle Ω·T in radians. */
  angle: number
  /** On-resonance Rabi angular frequency ω₁, rad/ns. */
  omega1: number
  /** Detuning Δ = ω_qubit − ω_drive, rad/ns. */
  detuning: number
}

export function pulseRotation(pulse: Pulse, truth: QubitTruth): PulseRotation {
  const omega1 = RAD_PER_NS_PER_MHZ * truth.rabiRate * pulse.amplitude
  const detuning = RAD_PER_NS_PER_MHZ * (truth.frequency - pulse.frequency)
  const omega = generalizedRabiFrequency(omega1, detuning)
  const axis: Vec3 = omega === 0 ? [1, 0, 0] : [omega1 / omega, 0, detuning / omega]
  return { axis, angle: omega * pulse.duration, omega1, detuning }
}

type Complex2x2 = {
  a: [number, number]
  b: [number, number]
  c: [number, number]
  d: [number, number]
}

/**
 * The pulse unitary U = cos(θ/2)·I − i·sin(θ/2)·(n·σ) as an explicit matrix,
 * for n = (nx, 0, nz):
 *
 *     ⎡ cos(θ/2) − i·nz·sin(θ/2)      −i·nx·sin(θ/2)       ⎤
 *     ⎣     −i·nx·sin(θ/2)        cos(θ/2) + i·nz·sin(θ/2) ⎦
 */
export function pulseUnitary(pulse: Pulse, truth: QubitTruth): Complex2x2 {
  const { axis, angle } = pulseRotation(pulse, truth)
  const cs = Math.cos(angle / 2)
  const sn = Math.sin(angle / 2)
  return {
    a: [cs, -axis[2] * sn],
    b: [0, -axis[0] * sn],
    c: [0, -axis[0] * sn],
    d: [cs, axis[2] * sn],
  }
}

/**
 * Average gate fidelity between what the pulse does and the X gate it is
 * meant to be:
 *
 *     F = (|Tr(X†U)|² + d) / (d(d + 1)),   d = 2.
 *
 * X†U just swaps U's rows, so Tr(X†U) = U₁₀ + U₀₁. Nothing about Rabi physics
 * is assumed here; the tests are what connect this to the closed-form
 * transition probability.
 */
export function xGateFidelity(pulse: Pulse, truth: QubitTruth): number {
  const u = pulseUnitary(pulse, truth)
  const re = u.b[0] + u.c[0]
  const im = u.b[1] + u.c[1]
  return (re * re + im * im + 2) / 6
}

// ─────────────────────────────────────────────────────────────────────────────
// Experiments: what an instrument can be asked to do
// ─────────────────────────────────────────────────────────────────────────────

export type Experiment =
  | {
      /** Prepare |0⟩, play the pulse `repeats` times, measure. */
      kind: 'rabi'
      pulse: Pulse
      repeats?: number
    }
  | {
      /** Prepare |0⟩, play `pulse`, wait `delay` ns, play it again, measure. */
      kind: 'ramsey'
      pulse: Pulse
      delay: number
    }

const Z_AXIS: Vec3 = [0, 0, 1]

/** Probability of measuring |1⟩ at the end of the experiment, before readout error. */
export function experimentProbability(exp: Experiment, truth: QubitTruth): number {
  const rot = pulseRotation(exp.pulse, truth)
  let v: Vec3 = [0, 0, 1]
  if (exp.kind === 'rabi') {
    const repeats = exp.repeats ?? 1
    v = rotateAbout(v, rot.axis, rot.angle * repeats)
  } else {
    v = rotateAbout(v, rot.axis, rot.angle)
    v = rotateAbout(v, Z_AXIS, rot.detuning * exp.delay)
    v = rotateAbout(v, rot.axis, rot.angle)
  }
  return Math.min(1, Math.max(0, (1 - v[2]) / 2))
}

/** Symmetric readout error: each shot is misassigned with probability `error`. */
export function observedProbability(p: number, error: number): number {
  return p * (1 - error) + (1 - p) * error
}

export type Counts = { ones: number; shots: number }

/** Binomial draw, shot by shot. Shot counts here are hundreds, never millions. */
export function sampleCounts(p: number, shots: number, rng: () => number): Counts {
  let ones = 0
  for (let i = 0; i < shots; i++) if (rng() < p) ones++
  return { ones, shots }
}

/** The only door between a controller and the qubit. Counts in, nothing else out. */
export interface Instrument {
  run(exp: Experiment, shots: number): Counts
}

/** An instrument on a live qubit: honest Born-rule sampling from the current truth. */
export function createInstrument(
  truth: () => QubitTruth,
  readoutError: number,
  rng: () => number
): Instrument {
  return {
    run(exp, shots) {
      const p = observedProbability(experimentProbability(exp, truth()), readoutError)
      return sampleCounts(p, shots, rng)
    },
  }
}

/**
 * An instrument that returns the expected counts with no sampling at all.
 * Not for the page — for tests that need to separate a fitting error from
 * shot noise.
 */
export function createNoiselessInstrument(truth: () => QubitTruth, readoutError = 0): Instrument {
  return {
    run(exp, shots) {
      const p = observedProbability(experimentProbability(exp, truth()), readoutError)
      return { ones: p * shots, shots }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Drift
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drift at severity 1. The frequency wanders by a few MHz against a 12.5 MHz
 * Rabi frequency, the Rabi rate by several percent — enough for an
 * uncorrected pulse to lose a few percent of fidelity, which is a disaster for
 * error correction and invisible to the eye on a Bloch sphere.
 */
export const DRIFT = {
  /** Sinusoid amplitude in MHz and its period in steps. */
  frequencySine: 3,
  frequencyPeriod: 260,
  /** Random-walk kick per step, MHz. */
  frequencyWalk: 0.12,
  /** Sinusoid amplitude as a fraction of the nominal Rabi rate, and its period. */
  rabiSine: 0.08,
  rabiPeriod: 170,
  /** Random-walk kick per step, as a fraction of nominal. */
  rabiWalk: 0.004,
  /** Mean-reversion time of the walks, in steps, so they cannot leave the plot. */
  reversion: 300,
} as const

export type DriftState = {
  step: number
  walkFrequency: number
  walkRabi: number
}

export const initialDrift = (): DriftState => ({ step: 0, walkFrequency: 0, walkRabi: 0 })

/** The hidden truth at a drift state, scaled by severity ∈ [0, 1]. */
export function driftTruth(state: DriftState, severity: number): QubitTruth {
  const t = state.step
  const fSine = DRIFT.frequencySine * Math.sin((TWO_PI * t) / DRIFT.frequencyPeriod)
  const rSine = DRIFT.rabiSine * Math.sin((TWO_PI * t) / DRIFT.rabiPeriod + 1.1)
  return {
    frequency: severity * (fSine + state.walkFrequency),
    rabiRate: NOMINAL_TRUTH.rabiRate * (1 + severity * (rSine + state.walkRabi)),
  }
}

/** Advance the walks one step. Severity is applied at read time, not here. */
export function stepDrift(state: DriftState, rng: () => number): DriftState {
  const decay = 1 - 1 / DRIFT.reversion
  return {
    step: state.step + 1,
    walkFrequency: state.walkFrequency * decay + DRIFT.frequencyWalk * gaussian(rng),
    walkRabi: state.walkRabi * decay + DRIFT.rabiWalk * gaussian(rng),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Curve fitting for the scheduled sweep
// ─────────────────────────────────────────────────────────────────────────────

/** Solve the 3×3 system M·x = r by Gaussian elimination with partial pivoting. */
function solve3(m: number[][], r: number[]): number[] | null {
  const a = m.map((row, i) => [...row, r[i]])
  for (let col = 0; col < 3; col++) {
    let piv = col
    for (let i = col + 1; i < 3; i++) if (Math.abs(a[i][col]) > Math.abs(a[piv][col])) piv = i
    if (Math.abs(a[piv][col]) < 1e-12) return null
    ;[a[col], a[piv]] = [a[piv], a[col]]
    for (let i = 0; i < 3; i++) {
      if (i === col) continue
      const f = a[i][col] / a[col][col]
      for (let j = col; j < 4; j++) a[i][j] -= f * a[col][j]
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]]
}

/** Sum of squared residuals of the best y ≈ a + b·cos(2πfx) + c·sin(2πfx) at fixed f. */
function cosineSse(x: number[], y: number[], f: number): number {
  const cols = x.map((xi) => [1, Math.cos(TWO_PI * f * xi), Math.sin(TWO_PI * f * xi)])
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const r = [0, 0, 0]
  for (let k = 0; k < x.length; k++) {
    for (let i = 0; i < 3; i++) {
      r[i] += cols[k][i] * y[k]
      for (let j = 0; j < 3; j++) m[i][j] += cols[k][i] * cols[k][j]
    }
  }
  const coef = solve3(m, r)
  if (!coef) return Infinity
  let sse = 0
  for (let k = 0; k < x.length; k++) {
    const pred = coef[0] + coef[1] * cols[k][1] + coef[2] * cols[k][2]
    sse += (y[k] - pred) ** 2
  }
  return sse
}

/**
 * Fit y ≈ a + b·cos(2πfx + φ) for the frequency f (cycles per unit x) by a
 * grid search with a parabolic refinement of the minimum. Amplitude and phase
 * are solved linearly at every grid point, which is what makes the search
 * robust to the reduced contrast a badly calibrated π/2 pulse produces.
 */
export function fitCosineFrequency(
  x: number[],
  y: number[],
  fMin: number,
  fMax: number,
  fStep: number
): { frequency: number; sse: number } {
  const n = Math.max(2, Math.round((fMax - fMin) / fStep))
  const grid: number[] = []
  const sse: number[] = []
  for (let i = 0; i <= n; i++) {
    const f = fMin + ((fMax - fMin) * i) / n
    grid.push(f)
    sse.push(cosineSse(x, y, f))
  }
  let best = 0
  for (let i = 1; i <= n; i++) if (sse[i] < sse[best]) best = i
  let frequency = grid[best]
  if (best > 0 && best < n && Number.isFinite(sse[best - 1]) && Number.isFinite(sse[best + 1])) {
    const denom = sse[best - 1] - 2 * sse[best] + sse[best + 1]
    if (denom > 0) {
      const shift = (0.5 * (sse[best - 1] - sse[best + 1])) / denom
      frequency += shift * ((fMax - fMin) / n)
    }
  }
  return { frequency, sse: sse[best] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

export type ControllerId = 'scheduled' | 'agent' | 'fixed'

export interface Controller {
  readonly id: ControllerId
  /** The pulse the controller currently believes is X. */
  pulse(): Pulse
  /** One control step. Measures through the instrument, updates, returns shots spent. */
  step(instrument: Instrument): number
  /** What the controller itself thinks its calibration is worth, if it tracks that. */
  belief(): number | null
}

/** A pulse that is never touched. The floor every controller has to beat. */
export function createFixedController(start: Pulse): Controller {
  const p = clampPulse(start)
  return { id: 'fixed', pulse: () => p, step: () => 0, belief: () => null }
}

export type ScheduledConfig = {
  /** Steps between full sweeps. */
  interval: number
  /** Ramsey delays and Rabi amplitudes sampled per sweep. */
  ramseyPoints: number
  rabiPoints: number
  /** Shots at every sampled point. */
  shotsPerPoint: number
  /** Deliberate drive detuning during the Ramsey, MHz. Must exceed the largest frequency error expected. */
  ramseyOffset: number
  /** Longest Ramsey delay, ns. */
  maxDelay: number
}

export const DEFAULT_SCHEDULED: ScheduledConfig = {
  interval: 30,
  ramseyPoints: 16,
  rabiPoints: 16,
  shotsPerPoint: 200,
  ramseyOffset: 6,
  maxDelay: 320,
}

/** Shots one full sweep costs. */
export function scheduledSweepCost(cfg: ScheduledConfig): number {
  return (cfg.ramseyPoints + cfg.rabiPoints) * cfg.shotsPerPoint
}

/** Shots per step, averaged over the interval. */
export function scheduledAmortisedCost(cfg: ScheduledConfig): number {
  return scheduledSweepCost(cfg) / cfg.interval
}

/**
 * The textbook calibration routine, run on a timer.
 *
 * 1. Ramsey: detune the drive by a known offset δ, measure P(1) against delay,
 *    fit the fringe frequency f. Cosine is even in Δ, so on its own a Ramsey
 *    cannot tell you which side of the qubit you are on; the offset breaks the
 *    tie as long as δ exceeds the error, and the qubit is at f_drive + δ − f.
 * 2. Rabi: sweep amplitude at fixed duration on the new frequency, fit the
 *    period, and put the π pulse at half of it.
 *
 * Between sweeps it spends nothing and learns nothing.
 */
export function createScheduledController(start: Pulse, cfg: ScheduledConfig): Controller {
  let pulse = clampPulse(start)
  let t = 0

  const sweep = (inst: Instrument): number => {
    let spent = 0

    // ── Ramsey ─────────────────────────────────────────────────────────────
    const half: Pulse = { ...pulse, amplitude: pulse.amplitude / 2, frequency: pulse.frequency + cfg.ramseyOffset }
    const delays: number[] = []
    const probs: number[] = []
    for (let i = 0; i < cfg.ramseyPoints; i++) {
      const delay = (cfg.maxDelay * i) / (cfg.ramseyPoints - 1)
      const c = inst.run({ kind: 'ramsey', pulse: half, delay }, cfg.shotsPerPoint)
      spent += c.shots
      delays.push(delay)
      probs.push(c.ones / c.shots)
    }
    // Fringe frequency in cycles/ns; ×1e3 for MHz. The grid runs from well below
    // the offset to well above it, so an error of either sign is in range.
    const fringe = fitCosineFrequency(delays, probs, 0.4e-3, (cfg.ramseyOffset + 10) * 1e-3, 0.01e-3)
    const qubitEstimate = half.frequency - fringe.frequency * 1e3
    pulse = clampPulse({ ...pulse, frequency: qubitEstimate })

    // ── Rabi ───────────────────────────────────────────────────────────────
    const amps: number[] = []
    const rabi: number[] = []
    const aMax = Math.min(1, 2 * pulse.amplitude)
    for (let i = 0; i < cfg.rabiPoints; i++) {
      const amplitude = (aMax * i) / (cfg.rabiPoints - 1)
      const c = inst.run({ kind: 'rabi', pulse: { ...pulse, amplitude } }, cfg.shotsPerPoint)
      spent += c.shots
      amps.push(amplitude)
      rabi.push(c.ones / c.shots)
    }
    // Period in amplitude units; nominal is 1.0. A π pulse is half a period.
    const inv = fitCosineFrequency(amps, rabi, 1 / 2.4, 1 / 0.3, 0.002)
    const period = 1 / inv.frequency
    pulse = clampPulse({ ...pulse, amplitude: period / 2 })

    return spent
  }

  return {
    id: 'scheduled',
    pulse: () => pulse,
    belief: () => null,
    step(inst) {
      const due = t % cfg.interval === 0
      t++
      return due ? sweep(inst) : 0
    },
  }
}

export type AgentConfig = {
  /** Shots per experiment. Four experiments run per step. */
  shotsPerExperiment: number
  /** Exploration width per parameter: relative for amplitude and duration, MHz for frequency. */
  explore: { amplitude: number; frequency: number; duration: number }
  /** Step gain on the symmetric policy-gradient estimate. */
  learningRate: number
  /** Odd number of X pulses in the error-amplifying experiment. */
  repeats: number
  /** Ramsey delay in ns. Sets how far off the first fringe reaches: ±1/(2·delay). */
  ramseyDelay: number
  /** Smoothing of the agent's own reward estimate. */
  beliefDecay: number
  /**
   * The gate's slot in the circuit schedule: a duration in ns and the weight of
   * the quadratic penalty for a pulse that does not fit it. Amplitude × duration
   * is an exact degeneracy of the rotation angle, and without this the agent
   * random-walks along it into low amplitudes where detuning hurts more.
   */
  slot: { duration: number; weight: number }
}

export const DEFAULT_AGENT: AgentConfig = {
  shotsPerExperiment: 32,
  explore: { amplitude: 0.03, frequency: 0.4, duration: 0.02 },
  learningRate: 6,
  repeats: 3,
  ramseyDelay: 100,
  beliefDecay: 0.9,
  slot: { duration: 40, weight: 10 },
}

/** Shots one agent step costs: two candidate pulses, two experiments each. */
export function agentStepCost(cfg: AgentConfig): number {
  return 4 * cfg.shotsPerExperiment
}

/**
 * The RL agent. A Gaussian policy over pulse deltas, trained by policy
 * gradient with symmetric sampling (PGPE, Sehnke et al. 2010): each step it
 * draws one perturbation ε, plays the pulse at +ε and at −ε, and moves the
 * pulse along ε by the reward difference. The differencing cancels the
 * baseline, which is what lets 32-shot rewards carry a usable gradient.
 *
 * Reward for a candidate pulse is the mean of two P(1) measurements, both
 * exactly 1 for a perfect X: three back-to-back pulses (amplifies rotation
 * error threefold) and a Ramsey pair at half amplitude (steep in detuning).
 * The agent never sees a fidelity; `belief()` is a running average of its
 * own reward, the only score it has.
 */
export function createAgentController(start: Pulse, cfg: AgentConfig, rng: () => number): Controller {
  let pulse = clampPulse(start)
  let belief: number | null = null

  const reward = (inst: Instrument, candidate: Pulse): number => {
    const a = inst.run({ kind: 'rabi', pulse: candidate, repeats: cfg.repeats }, cfg.shotsPerExperiment)
    const half: Pulse = { ...candidate, amplitude: candidate.amplitude / 2 }
    const b = inst.run({ kind: 'ramsey', pulse: half, delay: cfg.ramseyDelay }, cfg.shotsPerExperiment)
    // The schedule penalty is on the agent's own action, not on anything hidden.
    const slip = (candidate.duration - cfg.slot.duration) / cfg.slot.duration
    return 0.5 * (a.ones / a.shots + b.ones / b.shots) - cfg.slot.weight * slip * slip
  }

  const perturb = (p: Pulse, eps: Pulse, sign: 1 | -1): Pulse =>
    clampPulse({
      duration: p.duration * (1 + sign * eps.duration),
      amplitude: p.amplitude * (1 + sign * eps.amplitude),
      frequency: p.frequency + sign * eps.frequency,
    })

  return {
    id: 'agent',
    pulse: () => pulse,
    belief: () => belief,
    step(inst) {
      const eps: Pulse = {
        duration: cfg.explore.duration * gaussian(rng),
        amplitude: cfg.explore.amplitude * gaussian(rng),
        frequency: cfg.explore.frequency * gaussian(rng),
      }
      const rPlus = reward(inst, perturb(pulse, eps, 1))
      const rMinus = reward(inst, perturb(pulse, eps, -1))
      // Symmetric-sampling policy gradient: the step along ε is proportional to
      // the reward difference. In expectation this is learningRate · σ² · ∂r/∂p
      // per parameter, so the exploration widths double as per-parameter gains.
      const g = (cfg.learningRate * (rPlus - rMinus)) / 2
      pulse = clampPulse({
        duration: pulse.duration * (1 + g * eps.duration),
        amplitude: pulse.amplitude * (1 + g * eps.amplitude),
        frequency: pulse.frequency + g * eps.frequency,
      })
      const r = 0.5 * (rPlus + rMinus)
      belief = belief === null ? r : cfg.beliefDecay * belief + (1 - cfg.beliefDecay) * r
      return agentStepCost(cfg)
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A run: drift, three controllers, one record per step
// ─────────────────────────────────────────────────────────────────────────────

export type CalibrationConfig = {
  seed: number
  /** Drift severity, 0 (frozen qubit) to 1. May be changed mid-run. */
  severity: number
  /** Step budget. The run stops itself here. */
  steps: number
  readoutError: number
  /** How far off every controller starts: MHz of frequency, fraction of amplitude. */
  startOffset: { frequency: number; amplitude: number }
  scheduled: ScheduledConfig
  agent: AgentConfig
}

export const DEFAULT_CONFIG: CalibrationConfig = {
  seed: 7,
  severity: 0.6,
  steps: 600,
  readoutError: 0.01,
  startOffset: { frequency: 1.5, amplitude: 0.05 },
  scheduled: DEFAULT_SCHEDULED,
  agent: DEFAULT_AGENT,
}

export type ControllerRecord = {
  fidelity: number
  pulse: Pulse
  /** Cumulative shots. */
  shots: number
  /** Shots this step. */
  spent: number
  belief: number | null
}

export type StepRecord = {
  step: number
  truth: QubitTruth
  scheduled: ControllerRecord
  agent: ControllerRecord
  fixed: ControllerRecord
}

export interface CalibrationRun {
  /** Advance one step. Returns null once the budget is spent. */
  step(): StepRecord | null
  setSeverity(s: number): void
  readonly done: boolean
  readonly config: CalibrationConfig
}

export function createCalibrationRun(config: CalibrationConfig): CalibrationRun {
  const seed = config.seed >>> 0
  const driftRng = mulberry32(seed ^ 0x9e3779b9)
  const scheduledRng = mulberry32(seed ^ 0x85ebca6b)
  const agentRng = mulberry32(seed ^ 0xc2b2ae35)
  const policyRng = mulberry32(seed ^ 0x27d4eb2f)

  let severity = config.severity
  let drift = initialDrift()
  let truth = driftTruth(drift, severity)
  const currentTruth = () => truth

  const start = clampPulse({
    ...NOMINAL_PULSE,
    frequency: NOMINAL_PULSE.frequency + config.startOffset.frequency,
    amplitude: NOMINAL_PULSE.amplitude * (1 + config.startOffset.amplitude),
  })

  const controllers = {
    scheduled: createScheduledController(start, config.scheduled),
    agent: createAgentController(start, config.agent, policyRng),
    fixed: createFixedController(start),
  }
  const instruments = {
    scheduled: createInstrument(currentTruth, config.readoutError, scheduledRng),
    agent: createInstrument(currentTruth, config.readoutError, agentRng),
    fixed: createInstrument(currentTruth, config.readoutError, () => 0),
  }
  const shots = { scheduled: 0, agent: 0, fixed: 0 }
  let n = 0

  const record = (id: ControllerId): ControllerRecord => {
    const spent = controllers[id].step(instruments[id])
    shots[id] += spent
    const pulse = controllers[id].pulse()
    return {
      fidelity: xGateFidelity(pulse, truth),
      pulse,
      shots: shots[id],
      spent,
      belief: controllers[id].belief(),
    }
  }

  return {
    config,
    get done() {
      return n >= config.steps
    },
    setSeverity(s) {
      severity = Math.min(1, Math.max(0, s))
    },
    step() {
      if (n >= config.steps) return null
      truth = driftTruth(drift, severity)
      const out: StepRecord = {
        step: n,
        truth,
        scheduled: record('scheduled'),
        agent: record('agent'),
        fixed: record('fixed'),
      }
      drift = stepDrift(drift, driftRng)
      n++
      return out
    },
  }
}

/** Run to completion. Tests and the reduced-motion path use this. */
export function runCalibration(config: CalibrationConfig): StepRecord[] {
  const run = createCalibrationRun(config)
  const out: StepRecord[] = []
  for (;;) {
    const r = run.step()
    if (!r) break
    out.push(r)
  }
  return out
}

/** Summary numbers the page prints beside the chart. */
export function summarise(records: StepRecord[], id: ControllerId, from = 0) {
  const slice = records.slice(from)
  if (slice.length === 0) return { mean: NaN, min: NaN, last: NaN, shots: 0 }
  let sum = 0
  let min = Infinity
  for (const r of slice) {
    sum += r[id].fidelity
    min = Math.min(min, r[id].fidelity)
  }
  return {
    mean: sum / slice.length,
    min,
    last: slice[slice.length - 1][id].fidelity,
    shots: records[records.length - 1][id].shots,
  }
}
