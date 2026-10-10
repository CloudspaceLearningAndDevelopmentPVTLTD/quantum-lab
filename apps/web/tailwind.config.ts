import type { Config } from 'tailwindcss'

/**
 * Design tokens for Qubit16.
 *
 * The five categorical hues are assigned in FIXED ORDER and never cycled:
 *   q-violet → q-teal → q-amber → q-rose → q-sky
 * Every chart, gate colour, and series colour draws from this order so the
 * whole app reads as one system. Do not add a 6th generated hue — fold extra
 * series into "Other" or facet the chart instead.
 */
const config: Config = {
  // The light theme is a `.light` class on <html>, written before first paint by
  // components/ui/ThemeScript.tsx. We do NOT use Tailwind's `darkMode: 'class'`
  // variant: every colour below resolves through a CSS custom property, so a
  // single utility already means the right thing in both themes and no
  // `dark:` prefixes are needed anywhere in the app.
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Values come from lib/theme/tokens.ts via app/globals.css.
        // Tokens used with an opacity modifier (`bg-q-violet/15`) must be
        // expressed as channel triples — Tailwind cannot decompose an opaque
        // `var()`. Tokens never used with a modifier stay as plain var().
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          secondary: 'var(--ink-secondary)',
          muted: 'var(--ink-muted)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        q: {
          violet: 'rgb(var(--q-violet-rgb) / <alpha-value>)',
          teal: 'rgb(var(--q-teal-rgb) / <alpha-value>)',
          amber: 'rgb(var(--q-amber-rgb) / <alpha-value>)',
          rose: 'rgb(var(--q-rose-rgb) / <alpha-value>)',
          sky: 'rgb(var(--q-sky-rgb) / <alpha-value>)',
          'violet-text': 'var(--q-violet-text)',
          'teal-text': 'var(--q-teal-text)',
          'amber-text': 'var(--q-amber-text)',
          'rose-text': 'var(--q-rose-text)',
          'sky-text': 'var(--q-sky-text)',
        },
        // Status colours are semantic, not surface-relative, and are not part of
        // the theme system yet — see docs/THEMING.md.
        status: {
          good: '#4ade80',
          warning: '#f5a623',
          serious: '#fb923c',
          critical: '#ef4444',
        },
        // shadcn/ui's expected semantic set. Aliased in app/globals.css onto
        // the token variables above, not a second palette — see the comment
        // there. Every components/ui/* primitive (button, card, dialog, ...)
        // is written against these names.
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
      },
      fontFamily: {
        // next/font (app/layout.tsx) exposes the loaded typeface as
        // --font-sans; ui-sans-serif/system-ui stay in the stack as the
        // pre-hydration / font-load-failure fallback, not the primary.
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: '12px',
        // shadcn's radius scale, driven off the single --radius variable
        // (app/globals.css) so every primitive's corner rounding stays in
        // sync with one number.
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
