import { describe, expect, it } from 'vitest'
import {
  METALS,
  collectedFraction,
  electronSpeedMs,
  emits,
  fitStoppingLine,
  frequencyHzFromWavelengthNm,
  maxKineticEnergyEv,
  metalById,
  photocurrentFraction,
  photonEnergyEv,
  readout,
  stoppingVoltageV,
  thresholdFrequencyHz,
  thresholdWavelengthNm,
} from './photoelectric'
import { PLANCK_EV_S, PLANCK_SLOPE_V_PER_HZ } from './physicalConstants'

const SODIUM = metalById('sodium').workFunctionEv
const COPPER = metalById('copper').workFunctionEv
const PLATINUM = metalById('platinum').workFunctionEv

describe('threshold', () => {
  /**
   * λ₀ = hc/φ = 1239.84 / φ nanometres. The right-hand side is arithmetic anyone can
   * do on paper, and the numbers below are the ones a textbook prints beside these
   * metals — sodium responds to green light, copper and platinum need ultraviolet.
   */
  it('gives the textbook threshold wavelengths', () => {
    expect(thresholdWavelengthNm(SODIUM)).toBeCloseTo(543.8, 1)
    expect(thresholdWavelengthNm(metalById('zinc').workFunctionEv)).toBeCloseTo(288.3, 1)
    expect(thresholdWavelengthNm(COPPER)).toBeCloseTo(263.8, 1)
    expect(thresholdWavelengthNm(PLATINUM)).toBeCloseTo(195.3, 1)
  })

  it('threshold frequency is φ/h, and a photon there carries exactly φ', () => {
    for (const metal of METALS) {
      const f0 = thresholdFrequencyHz(metal.workFunctionEv)
      expect(f0).toBeCloseTo(metal.workFunctionEv / PLANCK_EV_S, 6)
      expect(photonEnergyEv(f0)).toBeCloseTo(metal.workFunctionEv, 10)
      expect(maxKineticEnergyEv(f0, metal.workFunctionEv)).toBeCloseTo(0, 12)
    }
  })

  it('below threshold nothing is emitted, at any intensity whatsoever', () => {
    const f0 = thresholdFrequencyHz(SODIUM)
    for (const fraction of [0.5, 0.9, 0.99, 0.999]) {
      const f = f0 * fraction
      expect(emits(f, SODIUM)).toBe(false)
      expect(maxKineticEnergyEv(f, SODIUM)).toBe(0)
      expect(stoppingVoltageV(f, SODIUM)).toBe(0)
      for (const intensity of [0.01, 0.5, 1, 1000]) {
        expect(
          photocurrentFraction({
            frequencyHz: f,
            workFunctionEv: SODIUM,
            intensity,
            retardingVoltageV: 0,
          })
        ).toBe(0)
      }
    }
  })
})

describe("Einstein's equation, checked against hand arithmetic", () => {
  /**
   * 300 nm ultraviolet on sodium: E = 1239.84/300 = 4.1328 eV, minus φ = 2.28 eV,
   * leaves 1.8528 eV — so the electrons are stopped by 1.853 volts. None of the
   * right-hand sides here come from the module under test.
   */
  it('300 nm on sodium gives KE_max = 1.853 eV', () => {
    const f = frequencyHzFromWavelengthNm(300)
    expect(photonEnergyEv(f)).toBeCloseTo(4.1328, 3)
    expect(maxKineticEnergyEv(f, SODIUM)).toBeCloseTo(1.8528, 3)
    expect(stoppingVoltageV(f, SODIUM)).toBeCloseTo(1.8528, 3)
  })

  it('the same 300 nm light does nothing at all to platinum', () => {
    const f = frequencyHzFromWavelengthNm(300)
    expect(emits(f, PLATINUM)).toBe(false)
    expect(stoppingVoltageV(f, PLATINUM)).toBe(0)
  })

  it('a stopping voltage in volts equals KE_max in electron-volts', () => {
    for (const nm of [200, 250, 400, 500]) {
      const f = frequencyHzFromWavelengthNm(nm)
      expect(stoppingVoltageV(f, SODIUM)).toBeCloseTo(maxKineticEnergyEv(f, SODIUM), 12)
    }
  })

  it('an electron with 1 eV of kinetic energy moves at 5.93 × 10⁵ m/s', () => {
    // The standard textbook figure, from v = √(2E/m) with no reference to this module.
    expect(electronSpeedMs(1) / 1e5).toBeCloseTo(5.931, 2)
    // Energy scales as v², so four times the energy is twice the speed.
    expect(electronSpeedMs(4)).toBeCloseTo(2 * electronSpeedMs(1), 6)
    expect(electronSpeedMs(0)).toBe(0)
  })
})

describe("Millikan's measurement: h read off the slope", () => {
  /**
   * The experiment that made the photon respectable. Plot stopping voltage against
   * frequency and the points fall on a straight line whose slope is h/e — the same
   * slope for every metal, with only the intercept changing. Fitting our own stopping
   * voltages must recover h to the last digit, or the page's central claim is false.
   */
  it('every metal gives the same slope, h/e, and its own intercept −φ/e', () => {
    const frequencies = Array.from({ length: 40 }, (_, i) => (8 + i * 0.4) * 1e14)
    for (const metal of METALS) {
      const fit = fitStoppingLine(metal.workFunctionEv, frequencies)
      expect(fit).not.toBeNull()
      if (!fit) continue
      expect(fit.slopeVPerHz / PLANCK_SLOPE_V_PER_HZ).toBeCloseTo(1, 9)
      expect(fit.slopeVPerHz / 4.135667696e-15).toBeCloseTo(1, 8)
      expect(fit.interceptV).toBeCloseTo(-metal.workFunctionEv, 8)
      expect(fit.thresholdHz / thresholdFrequencyHz(metal.workFunctionEv)).toBeCloseTo(1, 9)
    }
  })

  it('the slope is a difference quotient, so φ cancels out of it entirely', () => {
    // Both frequencies are above platinum's threshold (6.35 eV = 1.535e15 Hz), so
    // every metal here is actually emitting and the difference quotient is meaningful.
    const f1 = 2.0e15
    const f2 = 2.4e15
    const slopes = METALS.map(
      (m) =>
        (stoppingVoltageV(f2, m.workFunctionEv) - stoppingVoltageV(f1, m.workFunctionEv)) / (f2 - f1)
    )
    for (const slope of slopes) {
      expect(slope / PLANCK_SLOPE_V_PER_HZ).toBeCloseTo(1, 12)
      expect(slope / slopes[0]).toBeCloseTo(1, 12)
    }
  })
})

describe('intensity and frequency do separate jobs', () => {
  const f = frequencyHzFromWavelengthNm(300)

  it('current is proportional to intensity, exactly', () => {
    const base = photocurrentFraction({
      frequencyHz: f,
      workFunctionEv: SODIUM,
      intensity: 0.1,
      retardingVoltageV: 0,
    })
    for (const k of [2, 5, 8]) {
      const scaled = photocurrentFraction({
        frequencyHz: f,
        workFunctionEv: SODIUM,
        intensity: 0.1 * k,
        retardingVoltageV: 0,
      })
      expect(scaled).toBeCloseTo(base * k, 12)
    }
  })

  it('the stopping voltage does not move when the lamp gets ten times brighter', () => {
    const stop = stoppingVoltageV(f, SODIUM)
    for (const intensity of [0.1, 0.3, 1]) {
      // Current at the stopping voltage is zero regardless of how much light there is.
      expect(
        photocurrentFraction({
          frequencyHz: f,
          workFunctionEv: SODIUM,
          intensity,
          retardingVoltageV: stop,
        })
      ).toBe(0)
      // And just below it, current is non-zero and still proportional to intensity.
      const just = photocurrentFraction({
        frequencyHz: f,
        workFunctionEv: SODIUM,
        intensity,
        retardingVoltageV: stop * 0.5,
      })
      expect(just).toBeCloseTo(intensity * 0.5, 12)
    }
  })

  it('raising the frequency raises the stopping voltage but not the current', () => {
    const dim = { workFunctionEv: SODIUM, intensity: 0.6, retardingVoltageV: 0 }
    const low = frequencyHzFromWavelengthNm(500)
    const high = frequencyHzFromWavelengthNm(250)
    expect(stoppingVoltageV(high, SODIUM)).toBeGreaterThan(stoppingVoltageV(low, SODIUM))
    expect(photocurrentFraction({ ...dim, frequencyHz: high })).toBeCloseTo(
      photocurrentFraction({ ...dim, frequencyHz: low }),
      12
    )
  })

  it('the retarding curve hits zero at V_stop and is flat below zero', () => {
    const stop = stoppingVoltageV(f, SODIUM)
    expect(collectedFraction(-1, stop)).toBe(1)
    expect(collectedFraction(0, stop)).toBe(1)
    expect(collectedFraction(stop, stop)).toBe(0)
    expect(collectedFraction(stop * 2, stop)).toBe(0)
    expect(collectedFraction(stop / 4, stop)).toBeCloseTo(0.75, 12)
    // No emission at all means no current at any retarding voltage, including none.
    expect(collectedFraction(0, 0)).toBe(1)
    expect(collectedFraction(0.1, 0)).toBe(0)
  })
})

describe('readout', () => {
  it('agrees with the individual functions it summarises', () => {
    const input = {
      frequencyHz: frequencyHzFromWavelengthNm(220),
      workFunctionEv: COPPER,
      intensity: 0.75,
      retardingVoltageV: 0.2,
    }
    const r = readout(input)
    expect(r.wavelengthNm).toBeCloseTo(220, 6)
    expect(r.photonEnergyEv).toBeCloseTo(1239.8419843320026 / 220, 8)
    expect(r.maxKineticEnergyEv).toBeCloseTo(r.photonEnergyEv - COPPER, 10)
    expect(r.stoppingVoltageV).toBeCloseTo(r.maxKineticEnergyEv, 12)
    expect(r.emits).toBe(true)
    expect(r.currentFraction).toBeCloseTo(photocurrentFraction(input), 12)
    expect(r.thresholdWavelengthNm).toBeCloseTo(263.8, 1)
  })
})
