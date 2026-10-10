# ADR-0007 — Canvases resolve colour from CSS custom properties at runtime

**Status:** accepted · **Applies to:** `apps/web/components/viz/**`, `components/viz/theme.ts`

## Context

Eleven visualizations paint to a 2D canvas, an SVG or a three.js scene. CSS cannot style what a
canvas draws: `ctx.fillStyle` takes a colour string, and three.js takes a `THREE.Color`. The
tempting shortcut is a module-level palette:

```ts
const VIOLET = '#7c6af9'   // DO NOT DO THIS
```

## The failure

The app has a light theme. A hardcoded dark-theme palette is invisible on it, and there is no
mechanism by which it would ever stop being invisible — a canvas does not re-render on a class
change on `<html>`, and nothing in the type system connects the two.

The symptom is not an error. It is white wires on a white background, an axis you cannot read, and
a chart that looks like it did not load. `docs/RESPONSIVE.md` and `docs/THEMING.md` both record
instances of exactly this being found by eye rather than by a test.

## Decision

Every canvas, SVG and three.js surface **resolves its colours from CSS custom properties at
runtime, and repaints when the theme changes.**

```ts
const css = window.getComputedStyle(el)
const violet = css.getPropertyValue('--q-violet').trim() || FALLBACK_VIOLET
```

Supporting rules, all in `components/viz/theme.ts`:

- **The fallbacks are the dark-theme values, and they are dead code in a browser.** They exist for
  the first paint under jsdom/node, where `getPropertyValue` returns `''` for custom properties.
  Making them the dark values means a resolution failure degrades to the default theme rather than
  to black-on-black.
- **`withAlpha()` returns an already-`rgba()` token unchanged** rather than mangling it. A
  wrong-alpha line is a cosmetic miss; an invalid `fillStyle` silently keeps the *previous*
  `fillStyle` and paints the wrong thing entirely.
- **Tokens must not use `light-dark()`** — see [ADR-0001](0001-no-light-dark-for-design-tokens.md),
  which is the same failure mode reached from the other direction.
- **The five categorical accents are assigned in a fixed order** (violet → teal → sky → amber →
  rose) and never cycled. `ACCENT_ORDER` is that list.

## Consequences

- Every lab needs a mounted element to read from and an observer on the theme class. That is
  boilerplate, and it is the cost.
- **The three newest labs (Shor, surface code, VQE) share `components/viz/theme.ts`; the eight
  older ones each carry their own copy of the same four functions.** They were not refactored onto
  the shared module because eleven agents were editing this repository concurrently and rewriting
  eight working files to remove duplication was not worth the merge risk. This is stated plainly in
  that file's header. If you are consolidating, `theme.ts` is the target.
- Two visualizations read `--q-violet` specifically, which is why the button contrast fix could not
  touch it — see [ADR-0002](0002-button-only-violet-fill-token.md).
- `apps/web/tests/manual/light-shots.mjs` pins the light theme, loads twelve canvas-bearing routes
  and writes a screenshot of each. It asserts nothing and is not part of `npx playwright test`,
  because the failure mode here is visual and a structural check cannot see it.

## What must not be undone

Do not hardcode a hex value in a `components/viz/**` file, and do not delete the fallback constants
— under jsdom they are the difference between a rendered test and a black one.
