/**
 * Runtime colour resolution for canvas visualizations.
 *
 * A 2D canvas has no access to CSS custom properties: `ctx.fillStyle` needs a real
 * colour string. Every lab therefore reads the tokens off a mounted element with
 * getComputedStyle and repaints when the theme class on <html> changes.
 *
 * DO NOT define these tokens with `light-dark()`. `getPropertyValue('--q-violet')`
 * returns the property's *computed value*, which for a custom property is an
 * unresolved token stream — the canvas would be handed the literal string
 * "light-dark(#6d5cf0, #a99dff)" and paint nothing. The tokens must resolve to a
 * plain colour in each theme's rule block. app/globals.css does this today.
 *
 * The three labs added in this batch (Shor, surface code, VQE) share this module.
 * The eight older labs each carry their own copy of these four functions; they were
 * not refactored onto this one, because eleven agents are editing this repo
 * concurrently and rewriting eight working files to remove duplication is not worth
 * the merge risk. If you are consolidating later, this is the target.
 */

/** `#a99dff` -> `124, 106, 249`. Returns null for non-hex input. */
export function hexToRgbTriple(hex: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/**
 * Build an `rgba()` string from a resolved colour token.
 *
 * Tokens that are already `rgba(...)` (e.g. `--line-strong`) are returned unchanged
 * rather than mangled — the caller gets a valid colour either way, just without the
 * requested alpha. That is deliberate: a wrong-alpha line is a cosmetic miss, an
 * invalid fillStyle silently keeps the *previous* fillStyle and paints the wrong
 * thing entirely.
 */
export function withAlpha(hex: string, alpha: number): string {
  const triple = hexToRgbTriple(hex)
  return triple ? `rgba(${triple}, ${alpha})` : hex
}

/** The token set the three new labs draw from, with dark-theme fallbacks. */
export const VIZ_TOKENS = {
  ink: ['--ink', '#eef2ff'],
  inkSecondary: ['--ink-secondary', '#8fa3c8'],
  inkMuted: ['--ink-muted', '#7d8cb0'],
  line: ['--line', 'rgba(255, 255, 255, 0.08)'],
  lineStrong: ['--line-strong', 'rgba(255, 255, 255, 0.13)'],
  surface2: ['--surface-2', '#141a2c'],
  violet: ['--q-violet', '#a99dff'],
  teal: ['--q-teal', '#4edbca'],
  amber: ['--q-amber', '#f2a96a'],
  rose: ['--q-rose', '#ef4a6b'],
  sky: ['--q-sky', '#6283c8'],
  violetText: ['--q-violet-text', '#c1bbfe'],
  tealText: ['--q-teal-text', '#8ae8da'],
  amberText: ['--q-amber-text', '#fac294'],
  roseText: ['--q-rose-text', '#f5a193'],
  skyText: ['--q-sky-text', '#8faae0'],
} as const satisfies Record<string, readonly [string, string]>

export type VizColors = { [K in keyof typeof VIZ_TOKENS]: string }

/**
 * Resolve every token in VIZ_TOKENS against `el`'s computed style.
 *
 * The fallbacks matter in exactly one case that actually happens: the very first
 * paint in a test environment (jsdom / node) where getComputedStyle returns empty
 * strings for custom properties. In a browser with globals.css loaded they are dead
 * code — which is the point. They are the dark-theme values, so a failure to resolve
 * degrades to the default theme rather than to black-on-black.
 */
export function readVizColors(el: HTMLElement): VizColors {
  const css = window.getComputedStyle(el)
  const out = {} as Record<string, string>
  for (const [key, [prop, fallback]] of Object.entries(VIZ_TOKENS)) {
    out[key] = css.getPropertyValue(prop).trim() || fallback
  }
  return out as VizColors
}

/** The five categorical accents, in the fixed order the design system uses. */
export const ACCENT_ORDER = ['violet', 'teal', 'sky', 'amber', 'rose'] as const
export type VizAccentKey = (typeof ACCENT_ORDER)[number]

/** Parsed `[r, g, b]` from a `#rrggbb` token, or null. */
function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Linear blend of two resolved colour tokens, for heat maps.
 *
 * Blending happens in sRGB, which is not perceptually uniform — a midpoint reads
 * slightly darker than it "should". That is accepted here: the alternative is an
 * OKLab conversion per pixel per frame on a 48 × 48 grid, and the map is read against
 * a labelled scale bar and an exact numeric readout, not by eye alone.
 * Returns `a` unchanged if either token is not a plain hex colour.
 */
export function mixColors(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  const k = Math.max(0, Math.min(1, t))
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k)
  return `rgb(${r}, ${g}, ${bl})`
}
