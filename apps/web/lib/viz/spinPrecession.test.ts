import { describe, expect, it } from 'vitest'
import { rotate as blochRotate } from './blochGates'
import {
  RF_PHASE_RX,
  RF_PHASE_RY,
  SPIN_SPECIES,
  coneAngle,
  gammaRadPerSecPerTesla,
  gateAxisForPhase,
  generalizedRabiFrequency,
  integrate,
  labField,
  larmorFrequencyHz,
  maxTransitionProbability,
  norm,
  precess,
  probabilityOfOne,
  pulseDuration,
  rabiAngularFrequency,
  rabiTransitionProbability,
  rotateAbout,
  speciesById,
  staticField,
  type FieldConfig,
  type Vec3,
} from './spinPrecession'

/**
 * These tests check the page's physics against sources OUTSIDE this file:
 *
 *  · published Larmor frequencies for real instruments (a 1.5 T MRI scanner, a
 *    500 MHz NMR spectrometer, an X-band EPR cavity),
 *  · the closed-form Rabi solution, checked against a straight RK4 integration
 *    of the full time-dependent LAB-frame field — two completely different
 *    routes to the same number,
 *  · the Bloch-sphere rotation in ./blochGates, which the home page animates
 *    and which knows nothing about magnetic fields.
 *
 * Nothing here asserts a function's output back at itself.
 */

const close = (a: Vec3, b: Vec3, digits = 8) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], digits)
}

describe('Larmor frequency against real instruments', () => {
  it('a 1.5 T MRI scanner resonates protons at 63.87 MHz', () => {
    const gamma = gammaRadPerSecPerTesla(speciesById('proton'))
    expect(larmorFrequencyHz(gamma, 1.5) / 1e6).toBeCloseTo(63.87, 2)
  })

  it('a 3 T scanner is exactly twice that — the frequency is linear in B', () => {
    const gamma = gammaRadPerSecPerTesla(speciesById('proton'))
    const f15 = larmorFrequencyHz(gamma, 1.5)
    const f30 = larmorFrequencyHz(gamma, 3.0)
    expect(f30 / f15).toBeCloseTo(2, 12)
    expect(f30 / 1e6).toBeCloseTo(127.73, 2)
  })

  it('an 11.7433 T magnet is a "500 MHz" NMR spectrometer, and puts ¹³C at 125.7 MHz', () => {
    // This is why spectrometers are named by their proton frequency: the field is
    // the awkward number, the proton frequency is the round one.
    const field = 11.7433
    const proton = larmorFrequencyHz(gammaRadPerSecPerTesla(speciesById('proton')), field)
    const carbon = larmorFrequencyHz(gammaRadPerSecPerTesla(speciesById('carbon13')), field)
    expect(proton / 1e6).toBeCloseTo(500.0, 1)
    expect(carbon / 1e6).toBeCloseTo(125.76, 1)
    // Which is why a "500 MHz" instrument is a "125 MHz carbon" instrument.
    expect(proton / carbon).toBeCloseTo(3.976, 2)
  })

  it('an X-band EPR cavity at 9.8 GHz needs about 0.35 T for a free electron', () => {
    const gamma = gammaRadPerSecPerTesla(speciesById('electron'))
    expect(larmorFrequencyHz(gamma, 0.35) / 1e9).toBeCloseTo(9.81, 2)
  })

  it('the electron precesses 658 times faster than a proton in the same field', () => {
    const ratio = speciesById('electron').gammaMHzPerT / speciesById('proton').gammaMHzPerT
    expect(ratio).toBeCloseTo(658.2, 1)
  })

  it('zero field means no precession at all', () => {
    expect(larmorFrequencyHz(gammaRadPerSecPerTesla(SPIN_SPECIES[0]), 0)).toBe(0)
  })
})

describe('free precession is a rigid rotation about the field', () => {
  const gamma = 2.3
  const b: Vec3 = [0, 0, 1.7]
  const omega0 = gamma * 1.7

  it('the closed form and an RK4 integration of dv/dt = γ(v × B) agree', () => {
    const v0: Vec3 = [0.6, 0.0, 0.8]
    const t = 1.234
    const steps = 20000
    const numeric = integrate(v0, 0, t / steps, steps, gamma, () => b)
    close(numeric, precess(v0, b, gamma, t), 8)
  })

  it('the cone angle never changes, so a static field can never flip a spin', () => {
    const v0: Vec3 = [0.6, 0.0, 0.8]
    const start = coneAngle(v0, b)
    for (const t of [0.1, 0.5, 1.0, 3.3, 10]) {
      expect(coneAngle(precess(v0, b, gamma, t), b)).toBeCloseTo(start, 12)
    }
  })

  it('one Larmor period brings the spin exactly back', () => {
    const v0: Vec3 = [0.6, 0.0, 0.8]
    close(precess(v0, b, gamma, (2 * Math.PI) / omega0), v0, 12)
  })

  it('precession is clockwise about +z for a positive gyromagnetic ratio', () => {
    // dvx/dt = +γB vy and dvy/dt = −γB vx, so a spin on +x heads toward −y.
    const quarter = precess([1, 0, 0], b, gamma, (Math.PI / 2) / omega0)
    close(quarter, [0, -1, 0], 10)
  })

  it('the spin stays on the unit sphere', () => {
    let v: Vec3 = [0.6, 0.0, 0.8]
    for (let i = 0; i < 500; i++) v = precess(v, b, gamma, 0.017)
    expect(norm(v)).toBeCloseTo(1, 12)
  })

  it('a tilted field tilts the precession axis with it', () => {
    const tilted = staticField({ b0: 2, tilt: Math.PI / 3 })
    close(tilted, [2 * Math.sin(Math.PI / 3), 0, 2 * Math.cos(Math.PI / 3)], 12)
    // A spin already aligned with the tilted field does not move at all.
    const along: Vec3 = [Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)]
    close(precess(along, tilted, 1.5, 0.9), along, 10)
  })
})

describe('the Rabi formula', () => {
  it('a resonant π pulse flips the spin completely', () => {
    const omega1 = 3.5
    expect(rabiTransitionProbability(omega1, 0, pulseDuration(omega1, Math.PI))).toBeCloseTo(1, 12)
  })

  it('a π/2 pulse leaves the spin exactly on the equator', () => {
    const omega1 = 3.5
    expect(rabiTransitionProbability(omega1, 0, pulseDuration(omega1, Math.PI / 2))).toBeCloseTo(
      0.5,
      12
    )
  })

  it('a 2π pulse returns the population to where it started', () => {
    const omega1 = 3.5
    expect(rabiTransitionProbability(omega1, 0, pulseDuration(omega1, 2 * Math.PI))).toBeCloseTo(
      0,
      12
    )
  })

  it('detuning by exactly ω₁ caps the flip at one half, however long you drive', () => {
    const omega1 = 2
    expect(maxTransitionProbability(omega1, omega1)).toBeCloseTo(0.5, 12)
    for (let i = 0; i <= 400; i++) {
      expect(rabiTransitionProbability(omega1, omega1, i * 0.05)).toBeLessThanOrEqual(0.5 + 1e-12)
    }
  })

  it('detuning by √3·ω₁ caps it at one quarter', () => {
    const omega1 = 2
    expect(maxTransitionProbability(omega1, Math.sqrt(3) * omega1)).toBeCloseTo(0.25, 12)
  })

  it('the generalised Rabi frequency is the length of the effective field', () => {
    expect(generalizedRabiFrequency(3, 4)).toBeCloseTo(5, 12)
    expect(generalizedRabiFrequency(2, 0)).toBeCloseTo(2, 12)
    // Off resonance the oscillation is FASTER but shallower — both at once.
    const omega1 = 1
    const onRes = generalizedRabiFrequency(omega1, 0)
    const offRes = generalizedRabiFrequency(omega1, omega1)
    expect(offRes).toBeGreaterThan(onRes)
    expect(maxTransitionProbability(omega1, omega1)).toBeLessThan(
      maxTransitionProbability(omega1, 0)
    )
  })

  it('a resonant drive with no amplitude does nothing', () => {
    expect(rabiTransitionProbability(0, 0, 12)).toBe(0)
    expect(pulseDuration(0, Math.PI)).toBe(Infinity)
  })
})

/**
 * The load-bearing cross-check. The Rabi formula above is the rotating-frame
 * answer; below, the spin is pushed through the FULL time-dependent lab-frame
 * field by RK4, with no frame change and no rotating-wave approximation, and
 * the two are compared.
 */
describe('lab-frame integration reproduces the Rabi formula', () => {
  const gamma = 1
  const b0 = 1
  const omega0 = gamma * b0

  function driveTo(t: number, cfg: FieldConfig, stepsPerLarmor = 240): Vec3 {
    const dt = (2 * Math.PI) / omega0 / stepsPerLarmor
    const steps = Math.max(1, Math.round(t / dt))
    return integrate([0, 0, 1], 0, t / steps, steps, gamma, (tt) => labField(tt, cfg))
  }

  it('on resonance, a π pulse driven in the lab frame lands on |1⟩', () => {
    const b1 = 0.05
    const omega1 = rabiAngularFrequency(gamma, b1)
    const cfg: FieldConfig = {
      b0,
      tilt: 0,
      b1,
      driveOmega: omega0,
      drivePhase: RF_PHASE_RX,
    }
    const t = pulseDuration(omega1, Math.PI)
    const v = driveTo(t, cfg)
    expect(probabilityOfOne(v)).toBeCloseTo(1, 6)
    close(v, [0, 0, -1], 5)
  })

  it('the whole population curve matches P(t) = (ω₁²/Ω²)·sin²(Ωt/2), on and off resonance', () => {
    const b1 = 0.05
    const omega1 = rabiAngularFrequency(gamma, b1)
    for (const detuning of [0, omega1, -omega1, 2 * omega1]) {
      const cfg: FieldConfig = {
        b0,
        tilt: 0,
        b1,
        // The rotating-frame z-field left over is Δ = ω₀ − ω_d.
        driveOmega: omega0 - detuning,
        drivePhase: RF_PHASE_RX,
      }
      const period = (2 * Math.PI) / generalizedRabiFrequency(omega1, detuning)
      for (const frac of [0.13, 0.37, 0.5, 0.71, 0.94]) {
        const t = period * frac
        const measured = probabilityOfOne(driveTo(t, cfg))
        expect(measured).toBeCloseTo(rabiTransitionProbability(omega1, detuning, t), 5)
      }
    }
  })

  it('an off-resonant drive never reaches the ceiling the formula predicts', () => {
    const b1 = 0.05
    const omega1 = rabiAngularFrequency(gamma, b1)
    const detuning = omega1
    const cfg: FieldConfig = {
      b0,
      tilt: 0,
      b1,
      driveOmega: omega0 - detuning,
      drivePhase: RF_PHASE_RX,
    }
    const period = (2 * Math.PI) / generalizedRabiFrequency(omega1, detuning)
    let peak = 0
    for (let i = 0; i <= 24; i++) peak = Math.max(peak, probabilityOfOne(driveTo((period * i) / 24, cfg)))
    expect(peak).toBeGreaterThan(0.49)
    expect(peak).toBeLessThan(0.51)
  })
})

/**
 * The claim the page makes to the reader: this is the same physics as the
 * RX/RY gates in the circuit simulator. Checked against ./blochGates, which is
 * an independent implementation written for the home-page animation.
 */
describe('a resonant pulse is an RX/RY gate', () => {
  const gamma = 1
  const b0 = 1
  const omega0 = gamma * b0
  const b1 = 0.05
  const omega1 = rabiAngularFrequency(gamma, b1)

  /** Integrate in the lab frame, then step into the frame rotating with the drive. */
  function rotatingFrameAfter(theta: number, phase: number): Vec3 {
    const cfg: FieldConfig = { b0, tilt: 0, b1, driveOmega: omega0, drivePhase: phase }
    const t = pulseDuration(omega1, theta)
    const dt = (2 * Math.PI) / omega0 / 240
    const steps = Math.max(1, Math.round(t / dt))
    const lab = integrate([0, 0, 1], 0, t / steps, steps, gamma, (tt) => labField(tt, cfg))
    return rotateAbout(lab, [0, 0, 1], omega0 * t)
  }

  it('RF phase π gives exactly RX(θ) for a whole sweep of angles', () => {
    for (const theta of [0.4, Math.PI / 2, Math.PI, 2.2, 4.5]) {
      const measured = rotatingFrameAfter(theta, RF_PHASE_RX)
      close(measured, blochRotate([0, 0, 1], [1, 0, 0], theta), 5)
    }
  })

  it('shifting the RF phase by 90° turns that same pulse into RY(θ)', () => {
    for (const theta of [0.4, Math.PI / 2, Math.PI, 2.2]) {
      const measured = rotatingFrameAfter(theta, RF_PHASE_RY)
      close(measured, blochRotate([0, 0, 1], [0, 1, 0], theta), 5)
    }
  })

  it('a π pulse is the X gate: |0⟩ → |1⟩', () => {
    close(rotatingFrameAfter(Math.PI, RF_PHASE_RX), [0, 0, -1], 5)
  })

  it('gateAxisForPhase names the axis the pulse actually turns about', () => {
    close(gateAxisForPhase(RF_PHASE_RX), [1, 0, 0], 12)
    close(gateAxisForPhase(RF_PHASE_RY), [0, 1, 0], 12)
    // A pulse at RF phase 0 is the inverse of the one at phase π — same axis,
    // opposite sense. This is the handedness note in the module header.
    close(gateAxisForPhase(0), [-1, 0, 0], 12)
    for (const phase of [0, 0.7, 1.9, 3.5, 5.6]) {
      expect(norm(gateAxisForPhase(phase))).toBeCloseTo(1, 12)
    }
  })

  it('free precession for t = θ/ω₀ is the RZ(θ) gate', () => {
    // Same mechanism, different field: with no drive, the static B₀ turns the
    // spin about z. Clockwise, so it realises RZ(−θ) in the e^{−iθZ/2} sense.
    const v0: Vec3 = [1, 0, 0]
    for (const theta of [0.3, Math.PI / 2, Math.PI]) {
      const t = theta / omega0
      close(precess(v0, [0, 0, b0], gamma, t), blochRotate(v0, [0, 0, 1], -theta), 10)
    }
  })
})

/**
 * The tests above use a fine step. This one uses the step the ANIMATION uses —
 * SpinPrecessionLab targets 120 RK4 steps per Larmor turn — so that what the
 * reader watches is pinned, not just what the module can do at leisure. If the
 * lab's substep budget is ever lowered, this fails before the picture starts
 * quietly lying.
 */
describe('the on-screen integrator is accurate at its actual step size', () => {
  const gamma = 1
  const b0 = 1
  const omega0 = gamma * b0
  const STEPS_PER_LARMOR = 120

  function driveAtScreenResolution(t: number, cfg: FieldConfig): Vec3 {
    const dt = (2 * Math.PI) / omega0 / STEPS_PER_LARMOR
    const steps = Math.max(1, Math.round(t / dt))
    return integrate([0, 0, 1], 0, t / steps, steps, gamma, (tt) => labField(tt, cfg))
  }

  it('a π pulse still lands on |1⟩ to four decimal places', () => {
    for (const b1 of [0.02, 0.12, 0.25]) {
      const omega1 = rabiAngularFrequency(gamma, b1)
      const cfg: FieldConfig = { b0, tilt: 0, b1, driveOmega: omega0, drivePhase: RF_PHASE_RX }
      const v = driveAtScreenResolution(pulseDuration(omega1, Math.PI), cfg)
      expect(probabilityOfOne(v)).toBeCloseTo(1, 4)
    }
  })

  it('the population curve the reader sees tracks the closed form', () => {
    const b1 = 0.12
    const omega1 = rabiAngularFrequency(gamma, b1)
    for (const detuningRatio of [0, 1, -2]) {
      const detuning = detuningRatio * omega1
      const cfg: FieldConfig = {
        b0,
        tilt: 0,
        b1,
        driveOmega: omega0 - detuning,
        drivePhase: RF_PHASE_RX,
      }
      const period = (2 * Math.PI) / generalizedRabiFrequency(omega1, detuning)
      for (const frac of [0.2, 0.5, 0.8]) {
        const t = period * frac
        expect(probabilityOfOne(driveAtScreenResolution(t, cfg))).toBeCloseTo(
          rabiTransitionProbability(omega1, detuning, t),
          4
        )
      }
    }
  })

  it('free precession stays on the sphere over hundreds of turns', () => {
    const dt = (2 * Math.PI) / omega0 / STEPS_PER_LARMOR
    const v = integrate([0.6, 0, 0.8], 0, dt, STEPS_PER_LARMOR * 300, gamma, () => [0, 0, b0])
    expect(norm(v)).toBeCloseTo(1, 10)
    // 300 whole turns should return it to where it began. The residual drift is
    // a few parts in 10⁶ after 36,000 RK4 steps, which is a hundred times finer
    // than a pixel on the sphere.
    expect(v[0]).toBeCloseTo(0.6, 5)
    expect(v[2]).toBeCloseTo(0.8, 5)
  })
})

describe('sanity of the exported helpers', () => {
  it('probabilityOfOne puts |0⟩ at the north pole and |1⟩ at the south', () => {
    expect(probabilityOfOne([0, 0, 1])).toBeCloseTo(0, 12)
    expect(probabilityOfOne([0, 0, -1])).toBeCloseTo(1, 12)
    expect(probabilityOfOne([1, 0, 0])).toBeCloseTo(0.5, 12)
  })

  it('every tabulated species has a positive gyromagnetic ratio and a note', () => {
    for (const s of SPIN_SPECIES) {
      expect(s.gammaMHzPerT).toBeGreaterThan(0)
      expect(s.note.length).toBeGreaterThan(10)
      expect(speciesById(s.id)).toBe(s)
    }
  })

  it('rotateAbout agrees with the independent Bloch rotation in blochGates', () => {
    const v: Vec3 = [0.36, 0.48, 0.8]
    const k: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2]
    close(rotateAbout(v, k, 1.234), blochRotate(v, k, 1.234), 12)
  })
})
