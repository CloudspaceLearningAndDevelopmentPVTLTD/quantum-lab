import { describe, expect, it } from 'vitest'
import {
  HC_EV_NM,
  PLANCK_EV_S,
  STEFAN_BOLTZMANN_W_M2_K4,
  WIEN_B_M_K,
  WIEN_X,
  frequencyHzFromWavelengthNm,
  photonEnergyEvFromWavelengthNm,
  solveWienX,
  wavelengthNmFromFrequencyHz,
} from './physicalConstants'

/**
 * σ and b are computed from h, c, k and a Newton solve — never pasted in. Every
 * assertion below compares them with the independently published CODATA value, so
 * these tests fail if the derivation is wrong and cannot pass by tautology.
 */
describe('derived physical constants', () => {
  it('reproduces the CODATA Stefan–Boltzmann constant from σ = 2π⁵k⁴/15c²h³', () => {
    // CODATA 2018: 5.670374419e-8 W·m⁻²·K⁻⁴ (exact, since h, c and k are exact).
    expect(STEFAN_BOLTZMANN_W_M2_K4 / 5.670374419e-8).toBeCloseTo(1, 9)
  })

  it("reproduces the CODATA Wien displacement constant from hc/kx", () => {
    // CODATA 2018: 2.897771955e-3 m·K.
    expect(WIEN_B_M_K / 2.897771955e-3).toBeCloseTo(1, 9)
  })

  it('the Wien root actually satisfies x = 5(1 − e^−x)', () => {
    expect(WIEN_X).toBeCloseTo(4.965114231744276, 12)
    expect(WIEN_X).toBeCloseTo(5 * (1 - Math.exp(-WIEN_X)), 12)
    // Newton is started at 5; a converged root does not depend on where it started.
    expect(solveWienX()).toBeCloseTo(WIEN_X, 14)
  })

  it('hc = 1239.84 eV·nm, the number the rest of the subject is built on', () => {
    expect(HC_EV_NM).toBeCloseTo(1239.8419843320026, 8)
    // Green light at 550 nm carries about 2.25 eV.
    expect(photonEnergyEvFromWavelengthNm(550)).toBeCloseTo(2.2542581533309137, 10)
  })

  it('h in eV·s matches the published 4.135667696e-15', () => {
    expect(PLANCK_EV_S / 4.135667696e-15).toBeCloseTo(1, 9)
  })

  it('frequency and wavelength are exact inverses of each other', () => {
    // Sodium's yellow D line, 589.3 nm, is 5.0873e14 Hz.
    expect(frequencyHzFromWavelengthNm(589.3) / 1e14).toBeCloseTo(5.0873, 3)
    for (const nm of [10, 380, 550, 1000, 1e6]) {
      expect(wavelengthNmFromFrequencyHz(frequencyHzFromWavelengthNm(nm))).toBeCloseTo(nm, 6)
    }
  })
})
