/**
 * tokens.ts — the single source of truth for Qubit16's colour system.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Eight canvas / WebGL visualizations read colours at runtime with
 *   getComputedStyle(document.documentElement).getPropertyValue('--q-violet')
 * so the CSS custom property NAMES in this file are a public API. Renaming or
 * removing one silently breaks a visualization — nothing type-checks that read.
 * Everything (globals.css, tailwind.config.ts, docs/THEMING.md) is derived from
 * the table below so the three cannot drift apart.
 *
 * DELIBERATELY NOT USING `light-dark()`
 * -------------------------------------
 * The modern-web-guidance `dark-mode` guide recommends `light-dark()` for token
 * definitions. We cannot use it for THESE tokens: `light-dark()` is resolved at
 * used-value time for real CSS properties, but a custom property's computed
 * value is an un-resolved token stream. So
 *   --q-violet: light-dark(#5a45ad, #a99dff)
 * makes getPropertyValue('--q-violet') return the literal string
 * "light-dark(#5a45ad, #a99dff)", which `ctx.fillStyle` cannot parse — every
 * canvas would silently fall back to black. Values are therefore emitted as
 * plain, already-resolved colours in per-theme blocks. `color-scheme` (the part
 * of the guide that drives native UI) IS applied, per theme.
 */

/** What a user can choose. `system` follows `prefers-color-scheme`. */
export type ThemeName = 'dark' | 'light' | 'system'

/** What `system` actually resolves to once media state is known. */
export type ResolvedTheme = 'dark' | 'light'

/** localStorage key. Duplicated as a literal inside ThemeScript's IIFE — keep in sync. */
export const THEME_STORAGE_KEY = 'quantum-lab.theme'

/** The class applied to <html> for the light theme. Dark is the bare default. */
export const LIGHT_CLASS = 'light'
export const DARK_CLASS = 'dark'

export interface TokenSpec {
  /** Value under the dark theme — unchanged from the original dark-only app. */
  readonly dark: string
  /** Value under the light theme. */
  readonly light: string
  /** What the token is for, and anything a future editor must not break. */
  readonly note: string
}

/**
 * Every semantic token, dark and light.
 *
 * Contrast ratios (WCAG 2.1, computed in docs/THEMING.md) were the input to the
 * light values: all five categorical hues sit at >= 5:1 against the light
 * surface, versus the dark values which were chosen against #0d1120 and drop to
 * roughly 1.1:1 there — i.e. invisible.
 */
export const TOKENS = {
  '--bg': {
    dark: '#07090f',
    light: '#f7f8fc',
    note: 'Page canvas. Read by nothing at runtime, but every full-bleed surface.',
  },
  '--surface': {
    dark: '#0d1120',
    light: '#ffffff',
    note: 'Card background. Visualization canvases are transparent and sit on this.',
  },
  '--surface-2': {
    dark: '#141a2c',
    light: '#f1f3f9',
    note: 'Recessed / secondary surface — ghost buttons, table stripes.',
  },
  '--surface-3': {
    dark: '#1b2338',
    light: '#e4e8f2',
    note: 'Deepest inset — code blocks, scrollbar thumb.',
  },
  '--line': {
    dark: 'rgba(255, 255, 255, 0.07)',
    light: 'rgba(15, 23, 42, 0.10)',
    note: 'Hairline borders. Inverted from white-alpha to slate-alpha in light.',
  },
  '--line-strong': {
    dark: 'rgba(255, 255, 255, 0.13)',
    light: 'rgba(15, 23, 42, 0.18)',
    note: 'Hover / emphasised borders.',
  },
  '--ink': {
    dark: '#eef2ff',
    light: '#101527',
    note: 'Primary text. 16.8:1 on dark surface, 18.1:1 on light surface.',
  },
  '--ink-secondary': {
    dark: '#8fa3c8',
    light: '#48587a',
    note: 'Body / supporting text. 7.4:1 dark, 7.1:1 light.',
  },
  '--ink-muted': {
    dark: '#7d8cb0',
    light: '#5a6883',
    note:
      'Axis labels, hints, timestamps. Was #3d5070 dark / #6b7a99 light, which ' +
      'measured 2.31:1 and 3.52:1 — both failed WCAG AA for the small text it is ' +
      'actually used on. Now 5.6:1 dark on --surface (4.65:1 on --surface-3) and ' +
      '5.6:1 light on --surface (4.58:1 on --surface-3). Do not darken it again.',
  },

  /* ── Categorical hues — FIXED ORDER, never cycled ──────────────────────── */

  '--q-violet': {
    dark: '#a99dff',
    light: '#5a45ad',
    note: 'Series 1 / brand. READ AT RUNTIME by SuperpositionLab and GroverLab. Hue derived from 422 nm, the Sr+ Doppler-cooling line (hue 288deg) — scripts/derive-theme.mjs.',
  },
  '--q-teal': {
    dark: '#4edbca',
    light: '#007d72',
    note: 'Series 2. READ AT RUNTIME by SuperpositionLab and GroverLab. Hue derived from 493 nm, the Ba+ Doppler-cooling line (hue 184deg) — scripts/derive-theme.mjs.',
  },
  '--q-amber': {
    dark: '#f2a96a',
    light: '#935102',
    note: 'Series 3. READ AT RUNTIME by GroverLab. Hue derived from copper, the metal of a dilution refrigerator’s plates and RF coax — scripts/derive-theme.mjs.',
  },
  '--q-rose': {
    dark: '#e57969',
    light: '#8e2a20',
    note: 'Series 4. Hue derived from 674 nm, the Sr+ QUBIT transition itself (hue 29deg) — scripts/derive-theme.mjs.',
  },
  '--q-sky': {
    dark: '#6283c8',
    light: '#264382',
    note: 'Series 5. Hue derived from 397 nm, the Ca+ Doppler-cooling line (hue 264deg) — scripts/derive-theme.mjs.',
  },

  /* ── Text-on-surface variants of each hue ─────────────────────────────────
   * In dark these are the pale tints already hardcoded around the app
   * (#c1bbfe etc.); in light they are darkened so they stay legible as TEXT.
   * NEW names — nothing reads them at runtime yet. See docs/THEMING.md for the
   * list of files that still hardcode the dark values inline.
   */

  '--q-violet-text': {
    dark: '#c1bbfe',
    light: '#4b3793',
    note: 'Violet used as text/label. Currently hardcoded as #c1bbfe in 4 files. Hue derived from 422 nm — scripts/derive-theme.mjs.',
  },
  '--q-teal-text': {
    dark: '#8ae8da',
    light: '#065f57',
    note: 'Teal used as text/label. Currently hardcoded as #8ae8da in 4 files. Hue derived from 493 nm — scripts/derive-theme.mjs.',
  },
  '--q-amber-text': {
    dark: '#fac294',
    light: '#764002',
    note: 'Amber used as text/label. Currently hardcoded as #fac294 in 4 files. Hue derived from copper — scripts/derive-theme.mjs.',
  },
  '--q-rose-text': {
    dark: '#f5a193',
    light: '#7a221a',
    note: 'Rose used as text/label. Currently hardcoded as #f5a193 in 2 files. Hue derived from 674 nm — scripts/derive-theme.mjs.',
  },
  '--q-sky-text': {
    dark: '#8faae0',
    light: '#213a71',
    note: 'Sky used as text/label. Currently hardcoded as #8faae0 in 3 files. Hue derived from 397 nm — scripts/derive-theme.mjs.',
  },

  /* ── Interaction states that used to be hardcoded in globals.css ──────── */

  /**
   * A11Y (WCAG 1.4.3, audit finding 5): the primary button is white text on a
   * violet fill. `--q-violet` itself CANNOT be used for that in the dark theme —
   * white on #a99dff is 3.97:1, short of 4.5:1 for normal-size text — and it
   * cannot simply be darkened, because it is read at runtime by SuperpositionLab
   * and GroverLab and is series 1 of every chart; darkening it would drop the
   * hue to 3.14:1 on --bg where it is used as a *mark* colour (needs 3:1) and
   * change five visualizations. So the button gets its own token instead.
   *
   * Dark #5b47d6: 6.33:1 with white, and still 3.14:1 against --bg so the
   * button's own boundary clears 1.4.11. Light keeps #5a45ad (8.36:1 with
   * white) — the light theme already passed, and this makes that deliberate
   * rather than a side effect of --q-violet's light value.
   */
  '--q-violet-strong': {
    dark: '#5b47d6',
    light: '#5a45ad',
    note:
      'Solid violet FILL behind white text (.btn-primary). 6.33:1 dark / ' +
      '8.36:1 light against #ffffff. Not a series colour — do not read this at ' +
      'runtime for charts, and do not point .btn-primary back at --q-violet ' +
      '(that is 3.97:1 in dark and fails WCAG AA).',
  },
  '--q-violet-hover': {
    dark: '#6a58e2',
    light: '#4b3793',
    note:
      'Primary button hover, sitting on --q-violet-strong. Dark theme lightens, ' +
      'light theme darkens. Was #8d7dfa dark — 3.26:1 with white, i.e. the hover ' +
      'state failed 1.4.3 even harder than the resting state. Now 5.11:1 dark / ' +
      '10.92:1 light.',
  },
  '--scrollbar-thumb-hover': {
    dark: '#2a3550',
    light: '#ccd3e4',
    note: 'Legacy ::-webkit-scrollbar thumb hover only.',
  },
} as const satisfies Record<string, TokenSpec>

export type TokenName = keyof typeof TOKENS

/**
 * Tokens that additionally need an `R G B` channel triple emitted, because
 * Tailwind's `/<opacity>` modifier (`bg-q-violet/15`) can only apply alpha to a
 * colour it can decompose. Only hex tokens can be decomposed.
 */
export const CHANNEL_TOKENS = [
  '--bg',
  '--q-violet',
  '--q-teal',
  '--q-amber',
  '--q-rose',
  '--q-sky',
] as const satisfies readonly TokenName[]

/** `#a99dff` -> `124 106 249`. Returns null for non-hex values (rgba lines). */
export function hexToChannels(hex: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** Native `color-scheme` value per theme, so scrollbars and form controls follow. */
export const COLOR_SCHEME: Record<ResolvedTheme, string> = {
  dark: 'dark',
  light: 'light',
}

/** All resolved values for one theme, keyed by custom property name. */
export const THEMES: Record<ResolvedTheme, Record<TokenName, string>> = {
  dark: Object.fromEntries(
    Object.entries(TOKENS).map(([name, spec]) => [name, spec.dark])
  ) as Record<TokenName, string>,
  light: Object.fromEntries(
    Object.entries(TOKENS).map(([name, spec]) => [name, spec.light])
  ) as Record<TokenName, string>,
}

/**
 * Emit the CSS custom property declarations for one theme.
 *
 * This is what globals.css and docs/THEMING.md are generated from; run
 * `npx tsx lib/theme/tokens.ts`-style scripting or just paste the output. The
 * emitted block is intentionally declarations-only so the caller picks the
 * selector (`:root`, `:root.light`, inside a media query, ...).
 */
export function cssVariableBlock(theme: ResolvedTheme, indent = '  '): string {
  const lines: string[] = [`${indent}color-scheme: ${COLOR_SCHEME[theme]};`]
  for (const name of Object.keys(TOKENS) as TokenName[]) {
    lines.push(`${indent}${name}: ${THEMES[theme][name]};`)
  }
  for (const name of CHANNEL_TOKENS) {
    const channels = hexToChannels(THEMES[theme][name])
    if (channels) lines.push(`${indent}${name}-rgb: ${channels};`)
  }
  return lines.join('\n')
}

/** Full rule, e.g. `cssRule('light', ':root.light')`. */
export function cssRule(theme: ResolvedTheme, selector: string): string {
  return `${selector} {\n${cssVariableBlock(theme)}\n}`
}

/** Tailwind colour value for a token: alpha-capable when a channel triple exists. */
export function tailwindColor(name: TokenName): string {
  const hasChannels = (CHANNEL_TOKENS as readonly string[]).includes(name)
  return hasChannels ? `rgb(var(${name}-rgb) / <alpha-value>)` : `var(${name})`
}
