import { describe, expect, it } from 'vitest'
import { VISIBLE_MAX_NM, VISIBLE_MIN_NM, isVisible } from '../quantum/hydrogen'
import { bandOf, beamCss, wavelengthToCss, wavelengthToRgb } from './spectralColor'

/**
 * This is an approximation to a perceptual quantity, so the assertions are about
 * ordering and dominance — the things the approximation is actually claiming — not
 * about exact channel values, which it does not get right and does not pretend to.
 */
describe('wavelength to colour', () => {
  it('names the right dominant channel across the visible band', () => {
    const dominant = (nm: number) => {
      const [r, g, b] = wavelengthToRgb(nm)
      if (r >= g && r >= b) return 'r'
      return g >= b ? 'g' : 'b'
    }
    expect(dominant(420)).toBe('b') // deep violet
    expect(dominant(470)).toBe('b') // blue
    expect(dominant(530)).toBe('g') // green
    expect(dominant(650)).toBe('r') // red
    expect(dominant(700)).toBe('r') // deep red
  })

  it('is black outside the band the eye responds to', () => {
    for (const nm of [10, 200, 379.9, 750.1, 1000, 1e6]) {
      expect(wavelengthToRgb(nm)).toEqual([0, 0, 0])
    }
  })

  it('fades towards both edges of the band rather than staying saturated', () => {
    const brightness = (nm: number) => {
      const [r, g, b] = wavelengthToRgb(nm)
      return r + g + b
    }
    expect(brightness(390)).toBeLessThan(brightness(470))
    expect(brightness(740)).toBeLessThan(brightness(650))
  })

  it('every channel stays inside 0…1, so the css never clips', () => {
    for (let nm = 350; nm <= 800; nm += 0.5) {
      for (const c of wavelengthToRgb(nm)) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
      expect(wavelengthToCss(nm)).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(beamCss(nm)).toMatch(/^(rgb|rgba)\(/)
    }
  })

  it('classifies ultraviolet, visible and infrared at the conventional edges', () => {
    expect(bandOf(250)).toBe('ultraviolet')
    expect(bandOf(379)).toBe('ultraviolet')
    expect(bandOf(380)).toBe('visible')
    expect(bandOf(750)).toBe('visible')
    expect(bandOf(751)).toBe('infrared')
    expect(bandOf(1e6)).toBe('infrared')
  })

  /*
   * Moved here from lib/quantum/hydrogen.test.ts, which used to test a second
   * copy of this fit. Real laboratory wavelengths, so the assertion is about
   * something outside the module: a hydrogen discharge tube looks red-pink to
   * the eye because Balmer α dominates, and that has to come out of the fit.
   */
  it('puts the Balmer lines in the right part of the rainbow', () => {
    const [r1, g1, b1] = wavelengthToRgb(656.46) // Balmer α, red
    expect(r1).toBeGreaterThan(g1)
    expect(r1).toBeGreaterThan(b1)
    expect(r1).toBeGreaterThan(0.75)

    const [r2, g2, b2] = wavelengthToRgb(486.27) // Balmer β, cyan
    expect(b2).toBeGreaterThan(r2)
    expect(g2).toBeGreaterThan(r2)
    expect(b2).toBeGreaterThan(0.4)

    const [r3, g3, b3] = wavelengthToRgb(410.29) // Balmer δ, violet
    expect(b3).toBeGreaterThan(g3)
    expect(r3).toBeGreaterThan(g3)
  })

  it('agrees with hydrogen.ts about where the visible band ends', () => {
    // The two used to disagree — 750 nm here, 780 nm in lib/quantum/hydrogen.ts
    // — so a 760 nm line was drawn red on one surface and black on another,
    // while `regionOf` called it infrared. One edge now, and this pins it.
    expect(VISIBLE_MIN_NM).toBe(380)
    expect(VISIBLE_MAX_NM).toBe(750)
    for (const nm of [380, 500, 750]) {
      expect(isVisible(nm)).toBe(true)
      expect(bandOf(nm)).toBe('visible')
      expect(wavelengthToRgb(nm)).not.toEqual([0, 0, 0])
    }
    for (const nm of [379, 751, 780]) {
      expect(isVisible(nm)).toBe(false)
      expect(bandOf(nm)).not.toBe('visible')
      expect(wavelengthToRgb(nm)).toEqual([0, 0, 0])
    }
  })
})
