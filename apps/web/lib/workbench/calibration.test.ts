import { describe, expect, it } from 'vitest'
import { rabiTransitionProbability } from '@/lib/viz/spinPrecession'
import { mulberry32 } from '@/lib/quantum'
import {
  DEFAULT_AGENT,
  DEFAULT_CONFIG,
  DEFAULT_SCHEDULED,
  NOMINAL_PULSE,
  NOMINAL_TRUTH,
  RAD_PER_NS_PER_MHZ,
  agentStepCost,
  createCalibrationRun,
  createNoiselessInstrument,
  createScheduledController,
  driftTruth,
  experimentProbability,
  fitCosineFrequency,
  initialDrift,
  observedProbability,
  runCalibration,
  sampleCounts,
  scheduledAmortisedCost,
  scheduledSweepCost,
  stepDrift,
  summarise,
  xGateFidelity,
  type Pulse,
  type QubitTruth,
} from './calibration'

/**
 * Sources outside this module:
 *
 *  · the average-gate-fidelity formula F = (|Tr(V†U)|² + d)/(d(d+1)) evaluated
 *    by hand for rotations with known angles (Nielsen 2002),
 *  · the closed-form Rabi transition probability in lib/viz/spinPrecession.ts,
 *    which was itself checked there against an RK4 integration of the
 *    lab-frame Bloch equation and knows nothing about gates,
 *  · the Ramsey fringe P(1) = (1 + cos Δτ)/2 for ideal π/2 pulses,
 *  · binomial statistics: sampled counts must sit inside a 4σ band of the
 *    analytic curve, and the band is computed here from the analytic p, not
 *    from the code.
 */

const NOMINAL: QubitTruth = { ...NOMINAL_TRUTH }

/** ω₁ and Δ in rad/ns, computed here independently of pulseRotation. */
const rabiRadPerNs = (truth: QubitTruth, pulse: Pulse) =>
  2 * Math.PI * 1e-3 * truth.rabiRate * pulse.amplitude
const detuningRadPerNs = (truth: QubitTruth, pulse: Pulse) =>
  2 * Math.PI * 1e-3 * (truth.frequency - pulse.frequency)

describe('X-gate fidelity against the average-gate-fidelity formula', () => {
  it('the nominal 40 ns, amplitude-0.5 pulse on the nominal qubit is a perfect X', () => {
    expect(xGateFidelity(NOMINAL_PULSE, NOMINAL)).toBeCloseTo(1, 12)
  })

  it('a resonant π/2 pulse scores 2/3 and a zero-length pulse scores 1/3', () => {
    // U = RX(π/2): |Tr(X·U)|² = 4 sin²(π/4) = 2 → F = (2 + 2)/6 = 2/3.
    expect(xGateFidelity({ ...NOMINAL_PULSE, duration: 20 }, NOMINAL)).toBeCloseTo(2 / 3, 12)
    // U = I: Tr(X) = 0 → F = 2/6.
    expect(xGateFidelity({ ...NOMINAL_PULSE, duration: 0 }, NOMINAL)).toBeCloseTo(1 / 3, 12)
  })

  it('a 2% over-rotation costs (1 − cos²(0.01π))·2/3 of fidelity', () => {
    // θ = 1.02π → |Tr|² = 4 sin²(0.51π) = 4 cos²(0.01π).
    const F = xGateFidelity({ ...NOMINAL_PULSE, amplitude: 0.51 }, NOMINAL)
    expect(F).toBeCloseTo((4 * Math.cos(0.01 * Math.PI) ** 2 + 2) / 6, 12)
    expect(F).toBeLessThan(1)
    expect(F).toBeGreaterThan(0.999)
  })

  it('for any pulse F = (1 + 2·P_flip)/3, with P_flip from spinPrecession', () => {
    // A rotation about an axis in the x–z plane has Tr(X·U) = −2i·sin(θ/2)·n_x,
    // and |⟨1|U|0⟩|² = sin²(θ/2)·n_x², so the two are locked together. The
    // right-hand side is the Rabi formula from a module written for NMR.
    const cases: Pulse[] = [
      { duration: 40, amplitude: 0.5, frequency: 2.5 },
      { duration: 33, amplitude: 0.62, frequency: -4 },
      { duration: 80, amplitude: 0.2, frequency: 1 },
    ]
    for (const pulse of cases) {
      const truth = { frequency: 0.7, rabiRate: 24 }
      const p = rabiTransitionProbability(
        rabiRadPerNs(truth, pulse),
        detuningRadPerNs(truth, pulse),
        pulse.duration
      )
      expect(xGateFidelity(pulse, truth)).toBeCloseTo((1 + 2 * p) / 3, 12)
    }
  })

  it('detuning by one Rabi frequency caps fidelity at 2/3 even at the best duration', () => {
    // ω₁²/(ω₁² + Δ²) = 1/2 → P_flip ≤ 1/2 → F ≤ (1 + 1)/3.
    const truth = { frequency: 0, rabiRate: 25 }
    const pulse: Pulse = { duration: 40, amplitude: 0.5, frequency: 12.5 }
    let best = 0
    for (let T = 1; T <= 200; T += 0.5) best = Math.max(best, xGateFidelity({ ...pulse, duration: T }, truth))
    expect(best).toBeLessThanOrEqual(2 / 3 + 1e-9)
    expect(best).toBeGreaterThan(2 / 3 - 0.002)
  })
})

describe('Rabi experiment against the analytic sin² curve', () => {
  it('exact P(1) at resonance is sin²(π·k·A·T·1e-3)', () => {
    for (let A = 0; A <= 1; A += 0.05) {
      const p = experimentProbability({ kind: 'rabi', pulse: { ...NOMINAL_PULSE, amplitude: A } }, NOMINAL)
      const analytic = Math.sin(Math.PI * NOMINAL.rabiRate * A * NOMINAL_PULSE.duration * 1e-3) ** 2
      expect(p).toBeCloseTo(analytic, 12)
    }
  })

  it('detuned P(1) is the generalised Rabi formula, and three repeats triple the angle', () => {
    const truth = { frequency: 1.8, rabiRate: 25 }
    const pulse: Pulse = { duration: 40, amplitude: 0.5, frequency: 0 }
    const w1 = rabiRadPerNs(truth, pulse)
    const d = detuningRadPerNs(truth, pulse)
    const omega = Math.hypot(w1, d)
    const single = ((w1 * w1) / (omega * omega)) * Math.sin((omega * 40) / 2) ** 2
    const triple = ((w1 * w1) / (omega * omega)) * Math.sin((omega * 120) / 2) ** 2
    expect(experimentProbability({ kind: 'rabi', pulse }, truth)).toBeCloseTo(single, 12)
    expect(experimentProbability({ kind: 'rabi', pulse, repeats: 3 }, truth)).toBeCloseTo(triple, 12)
  })

  it('sampled counts at 4,000 shots sit inside 4σ of the analytic curve at every amplitude', () => {
    const rng = mulberry32(2024)
    const shots = 4000
    const readout = 0.02
    let maxZ = 0
    for (let i = 0; i <= 20; i++) {
      const A = i / 20
      const pTrue = Math.sin(Math.PI * 25 * A * 40 * 1e-3) ** 2
      const pObs = pTrue * (1 - readout) + (1 - pTrue) * readout
      const counts = sampleCounts(
        observedProbability(experimentProbability({ kind: 'rabi', pulse: { ...NOMINAL_PULSE, amplitude: A } }, NOMINAL), readout),
        shots,
        rng
      )
      const sigma = Math.sqrt((pObs * (1 - pObs)) / shots)
      const z = Math.abs(counts.ones / shots - pObs) / sigma
      maxZ = Math.max(maxZ, z)
      expect(z).toBeLessThan(4)
    }
    // A sampler that returned the expectation would score z ≈ 0 everywhere; a
    // real one does not. Guards against an accidentally noiseless instrument.
    expect(maxZ).toBeGreaterThan(0.5)
  })

  it('readout error folds in symmetrically: p → p(1−e) + (1−p)e', () => {
    expect(observedProbability(1, 0.03)).toBeCloseTo(0.97, 12)
    expect(observedProbability(0, 0.03)).toBeCloseTo(0.03, 12)
    expect(observedProbability(0.5, 0.03)).toBeCloseTo(0.5, 12)
  })
})

describe('Ramsey experiment', () => {
  it('with near-ideal π/2 pulses the fringe is (1 + cos Δτ)/2 at the true detuning', () => {
    // Make the pulses fast enough that their own detuning is negligible: a 5 GHz
    // Rabi rate at amplitude 1 against a 1 MHz detuning. 0.05 ns is then a π/2.
    const truth = { frequency: 1, rabiRate: 5000 }
    const pulse: Pulse = { duration: 0.05, amplitude: 1, frequency: 0 }
    for (const delay of [0, 100, 250, 500, 750, 1000]) {
      const p = experimentProbability({ kind: 'ramsey', pulse, delay }, truth)
      const analytic = (1 + Math.cos(RAD_PER_NS_PER_MHZ * 1 * delay)) / 2
      expect(p).toBeCloseTo(analytic, 3)
    }
  })

  it('on resonance a Ramsey pair with correct π/2 pulses always reads 1', () => {
    const half: Pulse = { ...NOMINAL_PULSE, amplitude: 0.25 }
    for (const delay of [0, 50, 500]) {
      expect(experimentProbability({ kind: 'ramsey', pulse: half, delay }, NOMINAL)).toBeCloseTo(1, 12)
    }
  })
})

describe('cosine fitter', () => {
  it('recovers a 6.3 MHz fringe from 16 noiseless points to within 0.02 MHz', () => {
    const x: number[] = []
    const y: number[] = []
    for (let i = 0; i < 16; i++) {
      const tau = (320 * i) / 15
      x.push(tau)
      y.push(0.45 + 0.4 * Math.cos(2 * Math.PI * 6.3e-3 * tau + 0.3))
    }
    const fit = fitCosineFrequency(x, y, 0.4e-3, 16e-3, 0.01e-3)
    expect(fit.frequency * 1e3).toBeCloseTo(6.3, 1)
    expect(Math.abs(fit.frequency * 1e3 - 6.3)).toBeLessThan(0.02)
  })
})

describe('drift', () => {
  it('severity 0 freezes the qubit at nominal for every step', () => {
    const rng = mulberry32(3)
    let state = initialDrift()
    for (let i = 0; i < 500; i++) {
      const t = driftTruth(state, 0)
      expect(Math.abs(t.frequency)).toBe(0)
      expect(t.rabiRate).toBe(NOMINAL_TRUTH.rabiRate)
      state = stepDrift(state, rng)
    }
  })

  it('severity 1 moves both parameters, stays bounded, and is seed-deterministic', () => {
    const run = (seed: number) => {
      const rng = mulberry32(seed)
      let state = initialDrift()
      const f: number[] = []
      const k: number[] = []
      for (let i = 0; i < 800; i++) {
        const t = driftTruth(state, 1)
        f.push(t.frequency)
        k.push(t.rabiRate)
        state = stepDrift(state, rng)
      }
      return { f, k }
    }
    const a = run(11)
    const b = run(11)
    expect(a.f).toEqual(b.f)
    expect(Math.max(...a.f.map(Math.abs))).toBeGreaterThan(1)
    expect(Math.max(...a.f.map(Math.abs))).toBeLessThan(12)
    const kDev = a.k.map((v) => Math.abs(v / NOMINAL_TRUTH.rabiRate - 1))
    expect(Math.max(...kDev)).toBeGreaterThan(0.03)
    expect(Math.max(...kDev)).toBeLessThan(0.3)
  })
})

describe('scheduled recalibration', () => {
  it('one noiseless sweep lands within 0.1 MHz and 1% amplitude of a hidden offset', () => {
    const truth: QubitTruth = { frequency: 1.7, rabiRate: 26.5 }
    const ctrl = createScheduledController({ duration: 40, amplitude: 0.5, frequency: 0 }, DEFAULT_SCHEDULED)
    const spent = ctrl.step(createNoiselessInstrument(() => truth))
    expect(spent).toBe(scheduledSweepCost(DEFAULT_SCHEDULED))
    const p = ctrl.pulse()
    expect(Math.abs(p.frequency - 1.7)).toBeLessThan(0.1)
    // π amplitude on the true qubit: 2π·26.5·A·40·1e-3 = π → A = 500/(26.5·40).
    const aPi = 500 / (26.5 * 40)
    expect(Math.abs(p.amplitude / aPi - 1)).toBeLessThan(0.01)
    expect(xGateFidelity(p, truth)).toBeGreaterThan(0.9995)
  })

  it('resolves the sign of the frequency error — a qubit BELOW the drive is found too', () => {
    const truth: QubitTruth = { frequency: -2.2, rabiRate: 25 }
    const ctrl = createScheduledController({ duration: 40, amplitude: 0.5, frequency: 0 }, DEFAULT_SCHEDULED)
    ctrl.step(createNoiselessInstrument(() => truth))
    expect(Math.abs(ctrl.pulse().frequency + 2.2)).toBeLessThan(0.1)
  })

  it('spends nothing between sweeps', () => {
    const ctrl = createScheduledController(NOMINAL_PULSE, { ...DEFAULT_SCHEDULED, interval: 5 })
    const inst = createNoiselessInstrument(() => NOMINAL)
    const spent = Array.from({ length: 10 }, () => ctrl.step(inst))
    expect(spent[0]).toBeGreaterThan(0)
    expect(spent.slice(1, 5).every((s) => s === 0)).toBe(true)
    expect(spent[5]).toBeGreaterThan(0)
  })
})

describe('the two controllers, end to end', () => {
  const FLOOR = 0.99
  const WARMUP = 40

  it('with zero drift both controllers hold fidelity above 0.99 after warm-up, from a bad start', () => {
    for (const seed of [1, 7, 42]) {
      const records = runCalibration({ ...DEFAULT_CONFIG, seed, severity: 0, steps: 400 })
      expect(records).toHaveLength(400)
      // The start is deliberately miscalibrated, so the fixed pulse sits below the floor …
      expect(records[0].fixed.fidelity).toBeLessThan(FLOOR)
      // … and both controllers must climb out of it and stay out.
      const sched = summarise(records, 'scheduled', WARMUP)
      const agent = summarise(records, 'agent', WARMUP)
      expect(sched.min).toBeGreaterThan(FLOOR)
      expect(agent.min).toBeGreaterThan(FLOOR)
      expect(sched.mean).toBeGreaterThan(0.998)
      expect(agent.mean).toBeGreaterThan(0.998)
    }
  })

  it('under full drift the agent tracks a truth it never sees, and beats the untouched pulse', () => {
    for (const seed of [1, 7, 42]) {
      const records = runCalibration({ ...DEFAULT_CONFIG, seed, severity: 1, steps: 600 })
      const agent = summarise(records, 'agent', WARMUP)
      const fixed = summarise(records, 'fixed', WARMUP)
      expect(agent.mean).toBeGreaterThan(0.995)
      expect(agent.mean).toBeGreaterThan(fixed.mean + 0.02)
      // The agent's drive frequency follows the hidden qubit frequency to within a MHz
      // for the great majority of steps, without ever being told it.
      const tracked = records
        .slice(WARMUP)
        .filter((r) => Math.abs(r.agent.pulse.frequency - r.truth.frequency) < 1).length
      expect(tracked / (records.length - WARMUP)).toBeGreaterThan(0.9)
    }
  })

  it('the agent pays fewer shots per step than the scheduled sweep costs, amortised', () => {
    expect(agentStepCost(DEFAULT_AGENT)).toBeLessThan(scheduledAmortisedCost(DEFAULT_SCHEDULED))
    // And in a real run, the cumulative counters agree with the stated costs.
    const records = runCalibration({ ...DEFAULT_CONFIG, steps: 300 })
    const last = records[records.length - 1]
    const sweeps = Math.ceil(300 / DEFAULT_SCHEDULED.interval)
    expect(last.scheduled.shots).toBe(sweeps * scheduledSweepCost(DEFAULT_SCHEDULED))
    expect(last.agent.shots).toBe(300 * agentStepCost(DEFAULT_AGENT))
    expect(last.agent.shots).toBeLessThan(last.scheduled.shots)
    expect(last.fixed.shots).toBe(0)
  })

  it('the agent is only ever handed counts: its belief is a reward average, never the fidelity', () => {
    const records = runCalibration({ ...DEFAULT_CONFIG, steps: 60, severity: 0 })
    for (const r of records) {
      expect(r.agent.belief).not.toBeNull()
      expect(r.agent.belief as number).toBeLessThanOrEqual(1)
      expect(r.scheduled.belief).toBeNull()
    }
    // A belief exactly equal to the fidelity on every step would mean the truth leaked.
    const equal = records.filter((r) => Math.abs((r.agent.belief as number) - r.agent.fidelity) < 1e-9)
    expect(equal.length).toBe(0)
  })

  it('a run is seed-deterministic and honours its step budget', () => {
    const a = runCalibration({ ...DEFAULT_CONFIG, steps: 50 })
    const b = runCalibration({ ...DEFAULT_CONFIG, steps: 50 })
    expect(a).toEqual(b)
    const run = createCalibrationRun({ ...DEFAULT_CONFIG, steps: 3 })
    expect(run.step()).not.toBeNull()
    expect(run.step()).not.toBeNull()
    expect(run.done).toBe(false)
    expect(run.step()).not.toBeNull()
    expect(run.done).toBe(true)
    expect(run.step()).toBeNull()
  })

  it('severity can change mid-run and the truth responds on the next step', () => {
    const run = createCalibrationRun({ ...DEFAULT_CONFIG, steps: 100, severity: 0 })
    for (let i = 0; i < 20; i++) run.step()
    run.setSeverity(1)
    const r = run.step()
    expect(r).not.toBeNull()
    // Twenty steps into the sinusoid, severity 1 is visibly off nominal.
    expect(Math.abs((r as NonNullable<typeof r>).truth.frequency)).toBeGreaterThan(0.5)
  })
})
