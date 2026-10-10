# ADR-0002 — A button-only violet fill token

**Status:** accepted · **Applies to:** `apps/web/app/globals.css` (`--q-violet-strong`, `--q-violet-hover`, `.btn-primary`)

## Context

`--q-violet` is the brand colour and the first of five categorical accents. It is used for:

1. the fill of every primary button (`.btn-primary`);
2. **chart series 1** across the histograms and plots;
3. a colour two visualizations read at runtime — `SuperpositionLab` and `GroverLab` call
   `getComputedStyle(el).getPropertyValue('--q-violet')` and hand the result straight to
   `ctx.fillStyle`.

## The failure

A WCAG 1.4.3 audit measured `.btn-primary` at **3.97:1** — white text on the dark theme's
`#7c6af9`. Normal-size text needs 4.5:1. Its hover state measured **3.26:1**, which is worse than
the resting state, because the hover was a hardcoded `hover:bg-[#8d7dfa]`: a dark-theme tint that
made the button *lighter* on hover and was flatly wrong on a light surface.

The obvious fix is to darken `--q-violet` until white clears 4.5:1. That fix is not available:

- Darkening it moves **chart series 1** in every histogram and plot, which is a design-system
  change made for a button.
- It changes what `SuperpositionLab` and `GroverLab` paint, silently, because those read the token
  at runtime. Nothing in the type system or the tests connects a button's contrast ratio to a
  physics visualization's palette, so the regression would land in a screenshot nobody took.

## Decision

Add **button-only fill tokens** and leave `--q-violet` alone.

```css
--q-violet-strong: #5b47d6;  /* dark theme  — 6.33:1 with white */
--q-violet-hover:  #6a58e2;
```

```css
.btn-primary        { @apply btn text-white; background-color: var(--q-violet-strong); }
.btn-primary:hover:not(:disabled) { background-color: var(--q-violet-hover); }
```

Measured, not estimated:

| Token | Theme | Contrast with white | Contrast with `--bg` |
| --- | --- | --- | --- |
| `--q-violet` (was the fill) | dark | 3.97:1 — **fails** | — |
| `--q-violet-strong` `#5b47d6` | dark | **6.33:1** | 3.14:1, so the button's own edge clears WCAG 1.4.11 |
| `--q-violet-strong` `#4a30c4` | light | **8.36:1** | — |

Both hover values are derived per theme, so the button darkens on hover in light and dark alike
instead of getting lighter in one of them.

## Consequences

- There are now two violets, and a reader of `globals.css` has to know which is which. That is
  what this record is for: `--q-violet` is the *identity and data* colour, `--q-violet-strong` is
  the *interactive fill*.
- A future component that wants a solid violet surface behind text should reach for
  `--q-violet-strong`, not `--q-violet`.
- The visualizations' palette is unchanged, which is the point — a colour that encodes a data
  series should not move because of a button.

## What must not be undone

Do not "simplify" by pointing `.btn-primary` back at `--q-violet`, and do not darken `--q-violet`
to make the button pass. The comment in `globals.css` above `.btn-primary` says this in four lines;
this record is the long version.
