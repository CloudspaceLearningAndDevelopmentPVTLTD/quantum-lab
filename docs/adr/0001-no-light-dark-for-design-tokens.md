# ADR-0001 — No `light-dark()` in the design tokens

**Status:** accepted · **Applies to:** `apps/web/app/globals.css`, `apps/web/components/viz/**`

## Context

Quantum Lab has a dark and a light theme. Every colour is a CSS custom property on `:root` and on
the theme's rule block: `--q-violet`, `--q-teal`, `--ink-muted`, `--surface-2`, and so on.

CSS's `light-dark()` function is the modern, obvious way to write that:

```css
:root { --q-violet: light-dark(#4a30c4, #7c6af9); }   /* DO NOT DO THIS */
```

One declaration instead of two blocks, no duplication, no chance of the two themes drifting. It is
exactly the kind of tidy-up a new contributor reaches for on day two.

## The failure

Eleven visualizations paint to a `<canvas>` or a three.js scene. A 2D canvas has no access to CSS:
`ctx.fillStyle` needs a real colour string. So every lab reads its tokens off a mounted element:

```ts
const css = window.getComputedStyle(el)
const violet = css.getPropertyValue('--q-violet').trim() || FALLBACK_VIOLET
```

`getPropertyValue` returns a property's **computed value**. For a *custom* property, the computed
value is an unresolved token stream — the substitution that turns `light-dark(a, b)` into a colour
happens when the value is *used* in a real property, not when it is computed as a custom one. So
with `light-dark()` in the token definition, that line hands the canvas the literal 26-character
string `"light-dark(#4a30c4, #7c6af9)"`.

Canvas does not throw on an invalid `fillStyle`. It **keeps the previous one**. The observed result
is not an error and not a blank canvas: it is a chart drawn entirely in whatever colour was set
last, which on a fresh context is black. On the dark theme that is black on near-black — invisible,
with nothing in the console.

The `|| FALLBACK` guard does not help either, because the string is non-empty and truthy.

## Decision

**Tokens resolve to a plain colour in each theme's rule block.** `app/globals.css` declares the
full set twice — once under the dark defaults and once under the light theme — and no token
anywhere uses `light-dark()`, `color-mix()` on an unresolved token, or any other function that
survives into the computed value of a custom property.

The rule is stated at the top of `apps/web/components/viz/theme.ts`, next to the code that would
break.

## Consequences

- Every colour is declared twice. That duplication is the cost, and it is deliberate.
- A new token has to be added to both blocks or the light theme silently keeps the dark value.
  `docs/THEMING.md` covers how that is checked.
- Tailwind utilities *could* use `light-dark()` safely, because they resolve it at use time. They
  do not, because a token that is safe in CSS and unsafe in `theme.ts` is a trap with two answers.
- `apps/web/tests/manual/light-shots.mjs` screenshots twelve canvas-bearing routes in the light
  theme so a human can catch anything structural checks cannot — a symptom of this class of bug is
  visual and nothing else.

## What must not be undone

Do not collapse the two theme blocks into `light-dark()` declarations. If you want the
de-duplication, the correct move is to generate both blocks from one source at build time — the
constraint is on what `getPropertyValue` returns at runtime, not on how the CSS is authored.
