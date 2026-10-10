import { describe, expect, it } from 'vitest'
import {
  CU_K_ALPHA_NM,
  DEFAULT_ELECTRON_MODEL,
  DE_BROGLIE_NM_ROOT_V,
  FCC_REFLECTIONS,
  NI_111_ROW_SPACING_NM,
  NI_LATTICE_CONSTANT_NM,
  argmax,
  braggTwoThetaDeg,
  cubicPlaneSpacingNm,
  deBroglieWavelengthNm,
  electronIntensity,
  equivalentBragg,
  fccAllowed,
  gratingFactor,
  gratingPeakAngleDeg,
  nickelFormFactor,
  peakAngleDegAtVoltage,
  peakVoltageV,
  polarProfile,
  sampleAngleDeg,
  scatteringCdf,
  voltageForWavelengthNm,
  voltageScan,
  xrayPattern,
  xrayPowderPeaks,
} from './electronDiffraction'
import { mulberry32 } from '@/lib/quantum'

/**
 * Every number on the right-hand side below comes from outside this module: the
 * de Broglie value every textbook prints for 54 V, Davisson and Germer's own
 * 1927 figures (50°, 54 V, 2.15 Å, and the Bragg reading 0.91 Å / 65°), and the
 * JCPDS 04-0850 powder card for nickel under Cu Kα radiation.
 */

describe('de Broglie wavelength', () => {
  it('is 0.167 nm at 54 V — the number the experiment was built to test', () => {
    expect(deBroglieWavelengthNm(54)).toBeCloseTo(0.1669, 3)
  })

  it('reproduces the pocket formula λ(nm) = 1.226 / √V', () => {
    expect(DE_BROGLIE_NM_ROOT_V).toBeCloseTo(1.2264, 3)
    for (const v of [10, 54, 100, 150, 400]) {
      expect(deBroglieWavelengthNm(v)).toBeCloseTo(1.2264 / Math.sqrt(v), 3)
    }
  })

  it('at 100 V gives 0.1226 nm and at 150 V gives 0.100 nm', () => {
    // Two more values a first course quotes: 100 V is "about the size of an atom".
    expect(deBroglieWavelengthNm(100)).toBeCloseTo(0.1226, 3)
    expect(deBroglieWavelengthNm(150.4)).toBeCloseTo(0.1, 3)
  })

  it('inverts exactly', () => {
    for (const v of [5, 54, 87.3, 300]) {
      expect(voltageForWavelengthNm(deBroglieWavelengthNm(v))).toBeCloseTo(v, 9)
    }
  })

  it('is not defined for a non-positive voltage', () => {
    expect(deBroglieWavelengthNm(0)).toBe(Number.POSITIVE_INFINITY)
    expect(deBroglieWavelengthNm(-3)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('the nickel surface grating', () => {
  it('has rows 0.215 nm apart on the (111) face, the value Davisson and Germer used', () => {
    // a√3 / (2√2) from a = 3.5238 Å; their paper quotes 2.15 Å from X-ray work.
    expect(NI_111_ROW_SPACING_NM).toBeCloseTo(0.215, 2)
    expect(NI_111_ROW_SPACING_NM).toBeGreaterThan(0.214)
    expect(NI_111_ROW_SPACING_NM).toBeLessThan(0.217)
  })

  it('puts the 54 V first-order peak at about 50°', () => {
    const theta = peakAngleDegAtVoltage(54)
    expect(theta).not.toBeNull()
    // D sin θ = λ gives 50.7°; the measured maximum was 50°. The 1% gap is real —
    // it was the subject of the refraction section of the 1927 paper.
    expect(theta!).toBeGreaterThan(49)
    expect(theta!).toBeLessThan(52)
  })

  it('reads as the Bragg law with d = 0.091 nm and a 65° glancing angle', () => {
    // The bisecting planes: d = D sin(θ/2), φ = 90° − θ/2 (Serway, Eisberg & Resnick).
    const b = equivalentBragg(50)
    expect(b.spacingNm).toBeCloseTo(0.091, 3)
    expect(b.glancingAngleDeg).toBeCloseTo(65, 12)
    // And the two statements of the peak condition are the same equation.
    const lhs = 2 * b.spacingNm * Math.sin((b.glancingAngleDeg * Math.PI) / 180)
    const rhs = NI_111_ROW_SPACING_NM * Math.sin((50 * Math.PI) / 180)
    expect(lhs).toBeCloseTo(rhs, 12)
    // 2 d sin φ at 65° is 0.165 nm — the wavelength the textbooks deduce.
    expect(lhs).toBeCloseTo(0.165, 2)
  })

  it('needs about 54 V to peak at a detector fixed at 50°', () => {
    const v = peakVoltageV(50)
    expect(v).toBeGreaterThan(53)
    expect(v).toBeLessThan(56)
  })

  it('has no first-order peak anywhere below about 32 V, where λ exceeds D', () => {
    expect(peakAngleDegAtVoltage(30)).toBeNull()
    expect(peakAngleDegAtVoltage(32)).toBeNull()
    expect(peakAngleDegAtVoltage(33)).not.toBeNull()
    // and the threshold is exactly where λ = D
    expect(voltageForWavelengthNm(NI_111_ROW_SPACING_NM)).toBeCloseTo(32.3, 1)
  })

  it('second order appears at four times the voltage of first order', () => {
    // nλ = D sin θ with λ ∝ 1/√V: doubling n means quadrupling V at fixed θ.
    expect(peakVoltageV(50, 2) / peakVoltageV(50, 1)).toBeCloseTo(4, 9)
    const first = gratingPeakAngleDeg(0.1, 1)
    const second = gratingPeakAngleDeg(0.1, 2)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(Math.sin((second! * Math.PI) / 180)).toBeCloseTo(2 * Math.sin((first! * Math.PI) / 180), 12)
  })
})

describe('electron intensity model', () => {
  it('N-row factor is 1 on a peak and has its first zero at x = π/N', () => {
    for (const N of [3, 7, 12]) {
      expect(gratingFactor(0, N)).toBe(1)
      expect(gratingFactor(Math.PI, N)).toBeCloseTo(1, 9)
      expect(gratingFactor(Math.PI / N, N)).toBeCloseTo(0, 9)
      // Between the principal maxima it is small.
      expect(gratingFactor(Math.PI / 2, N)).toBeLessThan(0.15)
    }
  })

  it('at 54 V the polar plot peaks near 50° and falls away on both sides', () => {
    const prof = polarProfile(54, 0.25)
    // Ignore the specular beam near 0°, which sits under the electron gun.
    const away = prof.filter((p) => p.thetaDeg >= 15)
    const best = away[argmax(away.map((p) => p.intensity))]
    expect(best.thetaDeg).toBeGreaterThan(48)
    expect(best.thetaDeg).toBeLessThan(52)

    const atPeak = electronIntensity(best.thetaDeg, 54)
    for (const off of [5, 10, 15, 25]) {
      expect(electronIntensity(best.thetaDeg + off, 54)).toBeLessThan(atPeak)
      expect(electronIntensity(best.thetaDeg - off, 54)).toBeLessThan(atPeak)
    }
    // A detector 10° off reads less than half of what one on the peak reads.
    expect(electronIntensity(best.thetaDeg + 10, 54)).toBeLessThan(0.5 * atPeak)
    expect(electronIntensity(best.thetaDeg - 10, 54)).toBeLessThan(0.5 * atPeak)
    // Monotone decline from the peak out to 75°.
    let prev = atPeak
    for (let t = best.thetaDeg + 1; t <= 75; t += 1) {
      const y = electronIntensity(t, 54)
      expect(y).toBeLessThanOrEqual(prev + 1e-12)
      prev = y
    }
  })

  it('a detector fixed at 50° sees its maximum at about 54 V', () => {
    const scan = voltageScan(50, 20, 400, 4000)
    const best = scan[argmax(scan.map((p) => p.intensity))]
    expect(best.voltageV).toBeGreaterThan(52)
    expect(best.voltageV).toBeLessThan(57)
    // and the second order, at ~220 V, is there but weaker
    const secondOrder = scan.filter((p) => p.voltageV > 180 && p.voltageV < 260)
    const second = secondOrder[argmax(secondOrder.map((p) => p.intensity))]
    expect(second.voltageV).toBeGreaterThan(210)
    expect(second.voltageV).toBeLessThan(230)
    expect(second.intensity).toBeLessThan(best.intensity)
    expect(second.intensity).toBeGreaterThan(electronIntensity(50, 130))
  })

  it('below 32 V nothing stands out away from the specular beam', () => {
    // λ > D, so no order can form. What is left beyond the gun shadow is the
    // diffuse background and the finite-grating ripple, and none of it comes
    // within a third of the 54 V peak.
    const peak54 = Math.max(
      ...polarProfile(54, 0.5)
        .filter((p) => p.thetaDeg >= 15)
        .map((p) => p.intensity)
    )
    for (const v of [20, 24, 28, 31]) {
      const prof = polarProfile(v, 0.5).filter((p) => p.thetaDeg >= 15)
      // The profile is one broad, falling hump: its largest value beyond the
      // gun shadow is at the inner edge, not out at a peak…
      expect(prof[argmax(prof.map((p) => p.intensity))].thetaDeg).toBe(15)
      // …and out where the 54 V peak will later stand, nothing comes close to it.
      const outer = prof.filter((p) => p.thetaDeg >= 40)
      expect(Math.max(...outer.map((p) => p.intensity))).toBeLessThan(peak54 * 0.55)
    }
  })

  it('narrower peak with more coherent rows', () => {
    const width = (rows: number): number => {
      const model = { ...DEFAULT_ELECTRON_MODEL, rows, diffuse: 0 }
      const prof = polarProfile(54, 0.1, model).filter((p) => p.thetaDeg >= 15)
      const peak = prof[argmax(prof.map((p) => p.intensity))]
      const half = prof.filter((p) => p.intensity >= peak.intensity / 2 && Math.abs(p.thetaDeg - peak.thetaDeg) < 20)
      return half[half.length - 1].thetaDeg - half[0].thetaDeg
    }
    expect(width(12)).toBeLessThan(width(7))
    expect(width(7)).toBeLessThan(width(4))
    // Δ(sin θ) ≈ λ/(N D): at 54 V with 7 rows, about 0.11 in sin θ ≈ 10° of arc.
    expect(width(7)).toBeGreaterThan(6)
    expect(width(7)).toBeLessThan(14)
  })

  it('nothing is scattered below the surface plane', () => {
    expect(electronIntensity(90, 54)).toBe(0)
    expect(electronIntensity(120, 54)).toBe(0)
    expect(electronIntensity(-95, 54)).toBe(0)
  })

  it('sampled electrons land on the 50° peak far more often than 10° either side', () => {
    const rand = mulberry32(7)
    const table = scatteringCdf(54)
    const bins = new Map<number, number>()
    for (let i = 0; i < 40000; i++) {
      const t = Math.abs(sampleAngleDeg(rand(), table))
      const b = Math.round(t / 5) * 5
      bins.set(b, (bins.get(b) ?? 0) + 1)
    }
    const at50 = bins.get(50) ?? 0
    expect(at50).toBeGreaterThan(2 * (bins.get(40) ?? 0))
    expect(at50).toBeGreaterThan(2 * (bins.get(60) ?? 0))
    // The sampled histogram tracks the model's own ratio to within statistics.
    const ratio = at50 / (bins.get(65) ?? 1)
    const model = electronIntensity(50, 54) / electronIntensity(65, 54)
    expect(ratio).toBeGreaterThan(model * 0.7)
    expect(ratio).toBeLessThan(model * 1.3)
  })
})

describe('X-rays on the same crystal', () => {
  it('fcc selection rule: indices all odd or all even', () => {
    expect(fccAllowed(1, 1, 1)).toBe(true)
    expect(fccAllowed(2, 0, 0)).toBe(true)
    expect(fccAllowed(1, 0, 0)).toBe(false)
    expect(fccAllowed(1, 1, 0)).toBe(false)
    expect(fccAllowed(2, 1, 0)).toBe(false)
    expect(fccAllowed(3, 1, 1)).toBe(true)
    for (const r of FCC_REFLECTIONS) expect(fccAllowed(...r.hkl)).toBe(true)
  })

  it('d-spacings of nickel: (111) 2.034 Å, (200) 1.762 Å, (220) 1.246 Å', () => {
    // JCPDS 04-0850.
    expect(cubicPlaneSpacingNm(NI_LATTICE_CONSTANT_NM, 1, 1, 1)).toBeCloseTo(0.20345, 4)
    expect(cubicPlaneSpacingNm(NI_LATTICE_CONSTANT_NM, 2, 0, 0)).toBeCloseTo(0.17619, 4)
    expect(cubicPlaneSpacingNm(NI_LATTICE_CONSTANT_NM, 2, 2, 0)).toBeCloseTo(0.12459, 4)
  })

  it('reproduces the Cu Kα powder card of nickel: 44.5°, 51.8°, 76.4°, 92.9°, 98.4°', () => {
    // JCPDS 04-0850 line positions (2θ, Cu Kα₁).
    const peaks = xrayPowderPeaks(CU_K_ALPHA_NM)
    const by = (label: string) => peaks.find((p) => p.label === label)!
    expect(by('(111)').twoThetaDeg).toBeCloseTo(44.51, 1)
    expect(by('(200)').twoThetaDeg).toBeCloseTo(51.85, 1)
    expect(by('(220)').twoThetaDeg).toBeCloseTo(76.37, 1)
    expect(by('(311)').twoThetaDeg).toBeCloseTo(92.95, 1)
    expect(by('(222)').twoThetaDeg).toBeCloseTo(98.45, 1)
    // (111) is the strongest line on the card (100), (200) is listed at 42.
    expect(by('(111)').intensity).toBe(1)
    expect(by('(200)').intensity).toBeGreaterThan(0.3)
    expect(by('(200)').intensity).toBeLessThan(0.6)
  })

  it('nickel form factor is Z = 28 in the forward direction and falls with angle', () => {
    expect(nickelFormFactor(0)).toBeCloseTo(28, 1)
    expect(nickelFormFactor(0.3)).toBeLessThan(nickelFormFactor(0.1))
    expect(nickelFormFactor(0.6)).toBeLessThan(nickelFormFactor(0.3))
  })

  it('drops the (111) line when λ is too long for it to form', () => {
    // 2 d sin θ = λ needs λ ≤ 2d = 0.407 nm — electrons below 9 V cannot make it.
    expect(braggTwoThetaDeg(0.20345, 0.5)).toBeNull()
    expect(xrayPowderPeaks(0.5)).toHaveLength(0)
    expect(xrayPowderPeaks(deBroglieWavelengthNm(54)).map((p) => p.label)).toContain('(111)')
  })

  it('at the 54 V electron wavelength the (111) line sits at 48.4°', () => {
    // 2 · 0.20345 · sin θ = 0.16690 → θ = 24.2°, 2θ = 48.4°. Hand arithmetic.
    const p = xrayPowderPeaks(deBroglieWavelengthNm(54)).find((x) => x.label === '(111)')!
    expect(p.twoThetaDeg).toBeCloseTo(48.4, 1)
  })

  it('the pattern curve peaks on the lines and is near zero between them', () => {
    const peaks = xrayPowderPeaks(CU_K_ALPHA_NM)
    expect(xrayPattern(peaks, 44.51)).toBeGreaterThan(0.9)
    expect(xrayPattern(peaks, 48)).toBeLessThan(0.05)
    expect(xrayPattern(peaks, 60)).toBeLessThan(0.02)
  })
})
