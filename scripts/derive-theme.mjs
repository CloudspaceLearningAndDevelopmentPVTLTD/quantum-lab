/**
 * derive-theme.mjs — derive Qubit16's five accent hues from real hardware.
 *
 *     node scripts/derive-theme.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The five categorical accents used to be generic UI colours — violet, teal,
 * amber, rose, sky — chosen because they look distinct. They are named for
 * their hue, which is exactly the problem: nothing about them pointed at the
 * subject, and a quantum computing platform whose palette could belong to a
 * project-management tool is leaving something on the table.
 *
 * Four of the five are now the wavelengths of laser lines that real trapped-ion
 * machines actually run, and the fifth is the colour of the metal a
 * superconducting processor is bolted to. Every value below is COMPUTED from
 * that physical input rather than picked, and this script is how — so the
 * derivation can be re-run, argued with, and corrected, instead of being a
 * paragraph of marketing attached to hexes somebody eyeballed.
 *
 * THE PHYSICAL INPUTS
 * -------------------
 *   397 nm  Ca+   S(1/2) -> P(1/2) Doppler cooling. Violet, at the edge of
 *                 vision. Every calcium ion trap in the world runs this line.
 *   422 nm  Sr+   Doppler cooling. Blue-violet.
 *   493 nm  Ba+   Doppler cooling. Cyan. Barium is the species IonQ moved
 *                 toward, and 493 nm is why a barium trap glows blue-green.
 *   674 nm  Sr+   The QUBIT transition itself — the narrow quadrupole line the
 *                 state is actually stored in, not a cooling beam. Red.
 *   copper        Not a wavelength. The gold-plated copper of a dilution
 *                 refrigerator's plates and the coax running down them: the
 *                 single most recognisable image of a superconducting quantum
 *                 computer, and the other half of the hardware this platform
 *                 reaches.
 *
 * WHAT IS DERIVED AND WHAT IS NOT, because the distinction is the honest part:
 *
 *   THE HUE IS PHYSICS.      Wavelength -> sRGB through the CIE 1931 2-degree
 *                            observer, then the hue angle is taken in OKLCH
 *                            and kept exactly.
 *   THE LIGHTNESS IS         A 397 nm violet at its true luminance is nearly
 *   ACCESSIBILITY.           black: unreadable on a dark ground and failing
 *                            every contrast target. So lightness — and only
 *                            lightness — is solved for, per theme and per
 *                            role, against the ratios docs/THEMING.md already
 *                            committed to. Chroma is clamped to what sRGB can
 *                            actually show at that lightness.
 *
 * So these are not "the colour of a 397 nm photon". They are the hue of one,
 * at a lightness a person can read. Claiming otherwise would be the same class
 * of dishonesty this codebase avoids everywhere else.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Surfaces the ratios are computed against. From lib/theme/tokens.ts. */
const SURFACE = { dark: '#0d1120', light: '#ffffff' }

/**
 * Contrast targets, from docs/THEMING.md.
 *
 * A RANGE, not a number, and that is the whole of the second lesson this
 * script learned. Solving every accent to exactly 5:1 against the same surface
 * gives all five the SAME luminance by construction — the separation check at
 * the bottom reported 1.00:1 between rose and amber, meaning identical in
 * greyscale, identical to a monochrome printer, and very nearly identical to a
 * reader with red-green colour blindness looking at two adjacent hues. Five
 * accents that a chart cannot tell apart are one accent.
 *
 * So each accent gets its own target, spread across the range, and WHICH one
 * it gets is itself physical: the five are ranked by the true OKLab lightness
 * of their source colour and the spread is applied in that order. 493 nm
 * really is a brighter thing to look at than 674 nm, and after the rescale it
 * still is.
 */
const TARGET = {
  fill: { dark: [5.0, 11.0], light: [5.0, 9.5] },
  text: { dark: [8.0, 13.0], light: [7.5, 11.0] },
}

/**
 * The five accents.
 *
 * WHICH WAVELENGTH GOT WHICH TOKEN NAME WAS DECIDED BY THE DERIVATION, not by
 * intuition, and the first attempt had two of them backwards. 397 nm "feels"
 * more violet than 422 nm because it is nearer the UV edge — but run it
 * through the colour-matching functions and 397 nm lands at hue 264 degrees (a
 * deep blue; the eye has almost no violet response left there) while 422 nm
 * lands at 288 degrees, which is the actual violet. Naming them the other way
 * round would have produced a token called `--q-violet` that renders blue, in
 * a file whose entire job is that its names mean something.
 *
 * Hue angles as derived, for anyone checking:
 *   397 nm -> 264deg   422 nm -> 288deg   493 nm -> 184deg   674 nm -> 29deg
 *   copper -> ~55deg
 */
const ACCENTS = [
  { token: 'violet', nm: 422, source: 'Sr+ Doppler cooling (hue 288deg)' },
  { token: 'sky', nm: 397, source: 'Ca+ S(1/2)->P(1/2) Doppler cooling (hue 264deg)' },
  { token: 'teal', nm: 493, source: 'Ba+ Doppler cooling (hue 184deg)' },
  { token: 'rose', nm: 674, source: 'Sr+ qubit transition, quadrupole (hue 29deg)' },
  {
    token: 'amber',
    hex: '#b87333',
    source: 'copper — dilution-refrigerator plates and RF coax',
  },
]

// ── Wavelength -> sRGB (CIE 1931 2-degree observer) ─────────────────────────

/**
 * CIE 1931 colour-matching functions, multi-lobe Gaussian fit.
 *
 * Wyman, Sloan & Shirley (JCGT 2013), "Simple Analytic Approximations to the
 * CIE XYZ Color Matching Functions". Chosen over the piecewise-linear
 * approximations that circulate for this purpose because those are fitted to
 * look right in the middle of the band and go visibly wrong at the violet edge
 * — which is precisely where two of these five sit.
 *
 * @param {number} nm Wavelength in nanometres.
 * @returns {[number, number, number]} CIE XYZ.
 */
function cieXYZ(nm) {
  const g = (x, mu, s1, s2) => {
    const t = (x - mu) * (x < mu ? 1 / s1 : 1 / s2)
    return Math.exp(-0.5 * t * t)
  }
  const x = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7)
    - 0.065 * g(nm, 501.1, 20.4, 26.2)
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1)
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8)
  return [x, y, z]
}

/**
 * Linear sRGB from CIE XYZ (sRGB primaries, D65).
 *
 * @param {[number, number, number]} xyz
 * @returns {[number, number, number]} Linear RGB, possibly out of gamut.
 */
function xyzToLinearRgb([X, Y, Z]) {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ]
}

// ── OKLab / OKLCH ───────────────────────────────────────────────────────────
//
// Björn Ottosson's OKLab. Used rather than HSL because the whole point here is
// to change LIGHTNESS WITHOUT CHANGING HUE, and HSL's "lightness" is not
// perceptual — sliding it on a blue and on a yellow moves them by visibly
// different amounts and shifts the hue as it goes.

/** @param {[number,number,number]} rgb Linear RGB. @returns {[number,number,number]} OKLab. */
function linearRgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** @param {[number,number,number]} lab OKLab. @returns {[number,number,number]} Linear RGB. */
function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** @param {[number,number,number]} lab @returns {{L:number,C:number,h:number}} */
function oklabToOklch([L, a, b]) {
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) }
}

/** @param {{L:number,C:number,h:number}} lch @returns {[number,number,number]} OKLab. */
function oklchToOklab({ L, C, h }) {
  return [L, C * Math.cos(h), C * Math.sin(h)]
}

// ── sRGB encoding, gamut, contrast ──────────────────────────────────────────

const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const decode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

/** True when every channel of a linear RGB triple is representable. */
const inGamut = ([r, g, b]) => [r, g, b].every((c) => c >= -1e-4 && c <= 1 + 1e-4)

/**
 * OKLCH to a hex string, reducing chroma until the colour fits in sRGB.
 *
 * Clipping channels instead would shift the hue — the exact thing this whole
 * module exists to preserve — so chroma is walked down and the hue angle is
 * never touched.
 *
 * @param {{L:number,C:number,h:number}} lch
 * @returns {string} `#rrggbb`.
 */
function oklchToHex(lch) {
  let C = lch.C
  let rgb = oklabToLinearRgb(oklchToOklab({ ...lch, C }))
  while (C > 0 && !inGamut(rgb)) {
    C -= 0.002
    rgb = oklabToLinearRgb(oklchToOklab({ ...lch, C }))
  }
  const hex = rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, encode(Math.min(1, Math.max(0, c))))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

/** @param {string} hex @returns {[number,number,number]} Linear RGB. */
function hexToLinearRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => decode(v / 255))
}

/** WCAG 2.1 relative luminance. @param {string} hex @returns {number} */
function luminance(hex) {
  const [r, g, b] = hexToLinearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio between two hex colours. @returns {number} */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// ── Solving for lightness ───────────────────────────────────────────────────

/**
 * The lightest (on dark) or darkest (on light) colour of this hue that still
 * clears the target ratio.
 *
 * Binary search on OKLCH lightness. "Just clears" rather than "maximally
 * contrasts" on purpose: pushing every accent to the extreme would wash five
 * distinct hues into five near-whites or five near-blacks, and the palette's
 * job is to keep them TELLABLE APART on a chart. Clearing the bar and stopping
 * keeps as much of the real hue as the bar allows.
 *
 * @param {number} h Hue angle in radians, from the physical colour.
 * @param {number} C0 The physical chroma, as an upper bound.
 * @param {string} surface The background to measure against.
 * @param {number} target Minimum WCAG ratio.
 * @param {'lighten'|'darken'} direction Which way to move from mid-lightness.
 * @returns {string} A hex colour of that hue meeting the target.
 */
function solveLightness(h, C0, surface, target, direction) {
  let lo = 0
  let hi = 1
  let best = direction === 'lighten' ? '#ffffff' : '#000000'
  for (let i = 0; i < 40; i += 1) {
    const L = (lo + hi) / 2
    const hex = oklchToHex({ L, C: C0, h })
    const ratio = contrast(hex, surface)
    if (ratio >= target) {
      best = hex
      // Found one; now move BACK toward the surface to keep hue saturation.
      if (direction === 'lighten') hi = L
      else lo = L
    } else if (direction === 'lighten') {
      lo = L
    } else {
      hi = L
    }
  }
  return best
}

// ── Derivation ──────────────────────────────────────────────────────────────

// First pass: the physical hue, chroma and TRUE lightness of each source.
const physical = ACCENTS.map((accent) => {
  let lch
  if (accent.hex) {
    lch = oklabToOklch(linearRgbToOklab(hexToLinearRgb(accent.hex)))
  } else {
    const linear = xyzToLinearRgb(cieXYZ(accent.nm))
    lch = oklabToOklch(linearRgbToOklab(linear.map((c) => Math.max(0, c))))
  }
  return {
    ...accent,
    hue: lch.h,
    // A monochromatic line's chroma is far outside sRGB. Cap it at something
    // the gamut can hold across the lightness range and let oklchToHex walk it
    // down per colour from there.
    chroma: Math.min(lch.C, 0.16),
    // The lightness the source ACTUALLY has, used only for ranking.
    trueL: lch.L,
  }
})

// Rank by true lightness. This is what decides which accent gets which target,
// so the rescaled palette keeps the ordering the physics had: 493 nm is a
// brighter thing to look at than 674 nm before and after.
const order = [...physical].sort((a, b) => a.trueL - b.trueL).map((p) => p.token)

/**
 * The target ratio for one accent, spread across a range by its rank.
 *
 * On DARK the brightest source gets the highest ratio (brighter against a dark
 * ground). On LIGHT the relationship inverts — more contrast against white
 * means DARKER — so the brightest source takes the LOWEST ratio and the
 * ordering survives the theme flip.
 *
 * @param {string} token Which accent.
 * @param {[number, number]} range [min, max] ratio.
 * @param {'dark'|'light'} theme Which way brightness runs.
 * @returns {number} The ratio to solve for.
 */
function targetFor(token, range, theme) {
  const rank = order.indexOf(token)
  const t = order.length > 1 ? rank / (order.length - 1) : 0
  const [lo, hi] = range
  return theme === 'dark' ? lo + t * (hi - lo) : hi - t * (hi - lo)
}

const rows = physical.map((p) => ({
  token: p.token,
  source: p.source,
  input: p.hex ?? `${p.nm} nm`,
  fillDark: solveLightness(
    p.hue, p.chroma, SURFACE.dark, targetFor(p.token, TARGET.fill.dark, 'dark'), 'lighten'
  ),
  fillLight: solveLightness(
    p.hue, p.chroma, SURFACE.light, targetFor(p.token, TARGET.fill.light, 'light'), 'darken'
  ),
  textDark: solveLightness(
    p.hue, p.chroma * 0.75, SURFACE.dark, targetFor(p.token, TARGET.text.dark, 'dark'), 'lighten'
  ),
  textLight: solveLightness(
    p.hue, p.chroma * 0.9, SURFACE.light, targetFor(p.token, TARGET.text.light, 'light'), 'darken'
  ),
}))

// ── Report ──────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n)
console.log('\nDerived accents — hue from the physical source, lightness from the contrast target\n')
console.log(
  pad('token', 9) + pad('input', 12) + pad('fill dark', 11) + pad('ratio', 8) +
    pad('fill light', 12) + pad('ratio', 8) + '  source'
)
console.log('-'.repeat(104))
for (const r of rows) {
  console.log(
    pad(r.token, 9) + pad(r.input, 12) +
      pad(r.fillDark, 11) + pad(contrast(r.fillDark, SURFACE.dark).toFixed(2) + ':1', 8) +
      pad(r.fillLight, 12) + pad(contrast(r.fillLight, SURFACE.light).toFixed(2) + ':1', 8) +
      '  ' + r.source
  )
}

console.log('\nText variants\n')
console.log(pad('token', 9) + pad('text dark', 11) + pad('ratio', 9) + pad('text light', 12) + 'ratio')
console.log('-'.repeat(52))
for (const r of rows) {
  console.log(
    pad(r.token, 9) +
      pad(r.textDark, 11) + pad(contrast(r.textDark, SURFACE.dark).toFixed(2) + ':1', 9) +
      pad(r.textLight, 12) + contrast(r.textLight, SURFACE.light).toFixed(2) + ':1'
  )
}

// Adjacent hues that land on the same lightness are indistinguishable to a
// colour-blind reader and nearly so to everyone else in a dense chart, so the
// separation is reported rather than assumed.
console.log('\nPairwise separation between fills (same theme) — 1.00 means identical luminance\n')
for (const theme of ['dark', 'light']) {
  const key = theme === 'dark' ? 'fillDark' : 'fillLight'
  let worst = { pair: '', ratio: Infinity }
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const ratio = contrast(rows[i][key], rows[j][key])
      if (ratio < worst.ratio) worst = { pair: `${rows[i].token}/${rows[j].token}`, ratio }
    }
  }
  console.log(`  ${pad(theme, 6)} closest pair: ${pad(worst.pair, 16)} ${worst.ratio.toFixed(2)}:1`)
}

console.log('\nPaste into apps/web/lib/theme/tokens.ts:\n')
for (const r of rows) {
  console.log(`  '--q-${r.token}': { dark: '${r.fillDark}', light: '${r.fillLight}' },`)
}
for (const r of rows) {
  console.log(`  '--q-${r.token}-text': { dark: '${r.textDark}', light: '${r.textLight}' },`)
}
console.log()
