/**
 * spectralColor.ts — approximate sRGB for a single wavelength of light.
 *
 * Dan Bruton's piecewise-linear approximation, the one every physics demo uses. It is
 * NOT colorimetry: a real conversion integrates the CIE 1931 colour-matching functions
 * and then maps XYZ into the display's gamut, and it disagrees with this by a visible
 * amount in the blue-greens. What this gets right is the ordering and the rough hue at
 * every wavelength, which is all that a shaded band under a spectrum needs to do.
 *
 * Outside 380–750 nm it returns black, because that light genuinely has no colour —
 * the eye has no response there. `invisibleLightCss` exists for the one place that
 * needs to draw a beam of ultraviolet anyway, and is labelled "UV" on screen so the
 * stand-in colour is never mistaken for a claim about what the light looks like.
 *
 * THIS IS THE ONLY COPY. lib/quantum/hydrogen.ts carried a second one for a while;
 * the two drifted (its red band ran to 780 nm, and its channels were 0–255 behind
 * an identical signature), so a deep-red line came out red on the hydrogen spectrum
 * strip and black on the blackbody curve. 750 nm is the edge, matching
 * `VISIBLE_MAX_NM` in lib/quantum/hydrogen.ts — spectralColor.test.ts pins the two
 * together. If a 0–255 form is ever wanted, give it a different name: a scale
 * mismatch between two functions with the same signature typechecks perfectly and
 * renders near-black.
 */

/** Channels in 0…1, never 0…255. See the note above. */
export type Rgb = [number, number, number]

const GAMMA = 0.8

/** Approximate linear-ish sRGB components in 0…1 for a wavelength in nanometres. */
export function wavelengthToRgb(nm: number): Rgb {
  let r = 0
  let g = 0
  let b = 0
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380)
    b = 1
  } else if (nm >= 440 && nm < 490) {
    g = (nm - 440) / (490 - 440)
    b = 1
  } else if (nm >= 490 && nm < 510) {
    g = 1
    b = -(nm - 510) / (510 - 490)
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510)
    g = 1
  } else if (nm >= 580 && nm < 645) {
    r = 1
    g = -(nm - 645) / (645 - 580)
  } else if (nm >= 645 && nm <= 750) {
    r = 1
  } else {
    return [0, 0, 0]
  }

  // The eye's response falls away at both ends of the band, so the extremes are dim
  // rather than fully saturated.
  let factor = 1
  if (nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / 40
  else if (nm > 700) factor = 0.3 + (0.7 * (750 - nm)) / 50

  const adjust = (c: number) => (c <= 0 ? 0 : Math.pow(c * factor, GAMMA))
  return [adjust(r), adjust(g), adjust(b)]
}

/** `rgb(…)` for a wavelength in nanometres, with an optional overall brightness 0…1. */
export function wavelengthToCss(nm: number, brightness = 1): string {
  const [r, g, b] = wavelengthToRgb(nm)
  const k = Math.max(0, Math.min(1, brightness)) * 255
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`
}

/**
 * A stand-in colour for light the eye cannot see, so an ultraviolet or infrared beam
 * is still visible on screen. Ultraviolet gets a deep violet, infrared a deep red —
 * the conventional artistic shorthand, and always drawn with a "UV" or "IR" label.
 */
export function invisibleLightCss(nm: number, brightness = 1): string {
  const k = Math.max(0, Math.min(1, brightness))
  if (nm < 380) return `rgba(150, 110, 245, ${0.35 + 0.55 * k})`
  return `rgba(190, 70, 60, ${0.35 + 0.55 * k})`
}

/** Any wavelength, visible or not, as something drawable. */
export function beamCss(nm: number, brightness = 1): string {
  if (nm < 380 || nm > 750) return invisibleLightCss(nm, brightness)
  return wavelengthToCss(nm, 0.35 + 0.65 * Math.max(0, Math.min(1, brightness)))
}

/** 'ultraviolet' | 'visible' | 'infrared', for the label beside a beam. */
export function bandOf(nm: number): 'ultraviolet' | 'visible' | 'infrared' {
  if (nm < 380) return 'ultraviolet'
  if (nm > 750) return 'infrared'
  return 'visible'
}
