# Theming — light and dark

Quantum Lab shipped dark-only. It now has a three-state theme control (System /
Light / Dark). **Dark remains the default**: a visitor who never touches the
toggle and whose OS is dark sees exactly the app that existed before.

- Source of truth: `apps/web/lib/theme/tokens.ts`
- Emitted CSS: `apps/web/app/globals.css`
- Anti-flash script: `apps/web/components/ui/ThemeScript.tsx`
- Client controller: `apps/web/lib/theme/useTheme.ts`
- Control: `apps/web/components/ui/ThemeToggle.tsx` (mounted in the footer)
- Storage key: `quantum-lab.theme` — `'light' | 'dark'`, absent means "system"

---

## 1. How a theme is chosen

| Situation | Result |
| --- | --- |
| Stored `'light'` or `'dark'` | That theme. Always wins over the OS. |
| No stored value, OS prefers light | Light. |
| No stored value, OS prefers dark or unknown | **Dark** (the CSS default). |
| JavaScript disabled | `@media (prefers-color-scheme: light)` on `:root:not(.dark):not(.light)` still gives an OS-appropriate theme; falls back to dark. |

`<html>` always ends up with an explicit `dark` or `light` class plus a matching
`style.colorScheme`, and the `<meta name="color-scheme">` in `<head>` is narrowed
from `light dark` to the pinned value when the user has pinned one.

## 2. The token table

Contrast ratios are WCAG 2.1 relative-luminance ratios, computed against the
*surface* the token normally appears on (`--surface`, i.e. `#0d1120` dark /
`#ffffff` light). Both columns are verified numbers, not estimates.

### Surfaces and ink

| Token | Dark | Light | Dark CR | Light CR |
| --- | --- | --- | --- | --- |
| `--bg` | `#07090f` | `#f7f8fc` | page canvas | page canvas |
| `--surface` | `#0d1120` | `#ffffff` | — | — |
| `--surface-2` | `#141a2c` | `#f1f3f9` | — | — |
| `--surface-3` | `#1b2338` | `#e4e8f2` | — | — |
| `--line` | `rgba(255,255,255,0.07)` | `rgba(15,23,42,0.10)` | hairline | hairline |
| `--line-strong` | `rgba(255,255,255,0.13)` | `rgba(15,23,42,0.18)` | hairline | hairline |
| `--ink` | `#eef2ff` | `#101527` | 16.80:1 | 18.13:1 |
| `--ink-secondary` | `#8fa3c8` | `#48587a` | 7.37:1 | 7.11:1 |
| `--ink-muted` | `#7d8cb0` | `#5a6883` | 5.59:1 | 5.61:1 |

`--ink-muted` carries real body copy — slider hints, axis labels, timestamps — not just
decoration, in both themes. It was `#3d5070` dark / `#6b7a99` light: 2.31:1 dark and
4.31:1 light on `--surface`, both short of 4.5:1 (the light value fell further, to
3.52:1, against `--surface-3`). Both values were raised in the same pass that added the
light theme; `lib/theme/tokens.ts` carries a comment not to darken it again.

### The five categorical hues

Fixed order, never cycled: violet → teal → amber → rose → sky.

Dark values chosen against `#0d1120` collapse when dropped unchanged onto
`#ffffff` — the old `#f5a623` amber was **2.03:1** on white, unusable as text or
as a line. So each theme gets its own value at the same hue, and both clear
5:1 on their own surface.

### Where the five hues come from

They are not chosen. Four are the wavelengths of laser lines that real
trapped-ion machines run, and the fifth is the colour of the metal a
superconducting processor is bolted to. `scripts/derive-theme.mjs` computes
every value below from those inputs; run it to re-derive or to argue with it.

| Token | Physical source | Hue |
| --- | --- | --- |
| `--q-violet` | **422 nm** — Sr⁺ Doppler cooling | 288° |
| `--q-sky` | **397 nm** — Ca⁺ S½→P½ Doppler cooling | 264° |
| `--q-teal` | **493 nm** — Ba⁺ Doppler cooling | 184° |
| `--q-rose` | **674 nm** — Sr⁺ *qubit* transition (quadrupole) | 29° |
| `--q-amber` | **copper** — dilution-refrigerator plates and RF coax | ~55° |

**What is derived and what is not.** The HUE is physics: wavelength → CIE 1931
2° observer → sRGB, hue angle taken in OKLCH and kept exactly. The LIGHTNESS is
accessibility: a 397 nm blue at its true luminance is nearly black and fails
every target below, so lightness alone is solved for against those ratios.
These are the *hue* of a 397 nm photon at a lightness a person can read — not
the colour of one, and the script says so.

Two things the derivation got wrong on the first pass, both caught by the
script's own checks rather than by eye:

* **397 nm and 422 nm were named backwards.** 397 nm *feels* more violet
  because it is nearer the UV edge, but the eye has almost no violet response
  left there: it lands at hue 264° (blue), while 422 nm lands at 288° (actual
  violet). Naming them the other way would have produced a `--q-violet` that
  renders blue.
* **Solving every hue to exactly 5:1 gave all five identical luminance.** The
  separation check reported 1.00:1 between rose and amber — identical in
  greyscale, on a monochrome printer, and very nearly so to a red-green
  colour-blind reader looking at two adjacent hues. Each accent now gets its
  own target across a range, and *which* target is itself physical: the five
  are ranked by the true OKLab lightness of their source, so 493 nm is still a
  brighter thing to look at than 674 nm after the rescale.

| Token | Dark | CR on `#0d1120` | Light | CR on `#ffffff` | CR on `--surface-2` |
| --- | --- | --- | --- | --- | --- |
| `--q-violet` | `#a99dff` | 8.01:1 | `#5a45ad` | **7.27:1** | 6.55:1 |
| `--q-teal` | `#4edbca` | 11.01:1 | `#007d72` | **5.03:1** | 4.53:1 |
| `--q-amber` | `#f2a96a` | 9.53:1 | `#935102` | **6.14:1** | 5.54:1 |
| `--q-rose` | `#e57969` | 6.50:1 | `#8e2a20` | **8.39:1** | 7.56:1 |
| `--q-sky` | `#6283c8` | 5.01:1 | `#264382` | **9.51:1** | 8.57:1 |

Every fill clears 5:1 on its surface in both themes; every text variant clears
4.5:1. The closest luminance pair is now 1.15:1 (dark, teal/amber) and 1.13:1
(light, sky/rose) — both pairs far apart in hue, so colour separates them where
luminance does not. rose/amber, the one genuinely adjacent pair, went from
1.00:1 to 1.47:1.

Separation *between* hues (the number that decides whether two series in one
chart are distinguishable). Categorical colour is carried mostly by hue, not
luminance, so these are ratios near 1 in both themes — the light set is in fact
slightly better spread than the dark one:

| Pair | Dark | Light |
| --- | --- | --- |
| violet ↔ teal | 1.74 | 1.29 |
| violet ↔ amber | 1.96 | 1.37 |
| violet ↔ rose | 1.13 | 1.58 |
| violet ↔ sky | 1.59 | 1.21 |
| teal ↔ amber | 1.12 | 1.06 |
| teal ↔ rose | 1.54 | 1.22 |
| teal ↔ sky | 1.10 | 1.06 |
| amber ↔ rose | 1.73 | 1.15 |
| amber ↔ sky | 1.23 | 1.13 |
| rose ↔ sky | 1.41 | 1.30 |

Because neither theme separates every pair by luminance alone, charts must keep
doing what `UsageChart` already does: direct end-labels and a legend, never
colour alone.

### Text-on-surface variants

Pale tints that read as *text* on a dark surface (`#c4baff` violet, etc.) are
1.8–2.3:1 on white. These tokens hold the readable value for each theme.

| Token | Dark | CR on `#0d1120` | Light | CR on `#ffffff` |
| --- | --- | --- | --- | --- |
| `--q-violet-text` | `#c4baff` | 10.57:1 | `#3b2699` | 10.92:1 |
| `--q-teal-text` | `#7ee8d8` | 12.90:1 | `#095349` | 8.95:1 |
| `--q-amber-text` | `#fac96a` | 12.19:1 | `#6f4200` | 8.55:1 |
| `--q-rose-text` | `#f0899f` | 7.86:1 | `#9e1740` | 7.92:1 |
| `--q-sky-text` | `#92ccf4` | 10.88:1 | `#0a4675` | 9.79:1 |

### The primary-button fill

`.btn-primary` is white text on a solid violet. It used to take that fill from
`--q-violet`, and in the dark theme that measured **3.97:1** — below the 4.5:1
WCAG AA needs for normal-size text (audit finding 5). It passed in light only
because the light `--q-violet` (`#4a30c4`) happens to be much darker: 8.36:1.

`--q-violet` could not simply be darkened. It is read at runtime by
`SuperpositionLab` and `GroverLab`, it is chart series 1, and it is the focus
ring; a value dark enough for white text (≈`#5b47d6`) drops to **3.14:1 on
`--bg`**, where the same token is used as a *mark* colour and only just clears
the 3:1 of 1.4.11. So the button got its own token and the hue kept its job:

| Token | Dark | CR with `#ffffff` | Light | CR with `#ffffff` |
| --- | --- | --- | --- | --- |
| `--q-violet-strong` (button fill) | `#5b47d6` | **6.33:1** ✅ | `#4a30c4` | **8.36:1** ✅ |
| `--q-violet-hover` (button hover) | `#6a58e2` | **5.11:1** ✅ | `#3b2699` | **10.92:1** ✅ |
| ~~`--q-violet` as a button fill~~ | `#7c6af9` | 3.97:1 ❌ | `#4a30c4` | 8.36:1 |
| ~~old `--q-violet-hover`~~ | `#8d7dfa` | 3.26:1 ❌ | `#3b2699` | 10.92:1 |

The dark hover was worse than the resting state — a button that failed 1.4.3
harder the moment you pointed at it — and is fixed by the same change. Both dark
values also keep the button's own edge visible against the page: `#5b47d6` is
3.14:1 and `#6a58e2` is 3.89:1 on `--bg` `#07090f`, clearing 1.4.11's 3:1.

Do **not** point `.btn-primary` back at `--q-violet`, and do not read
`--q-violet-strong` at runtime for a chart — it is a surface colour, not a
series colour. Other white-on-violet surfaces that are not `.btn-primary` (the
active `Segmented` option in `components/ui/Controls.tsx`, the active plan
button in `components/billing/PricingTable.tsx`) still use `bg-q-violet` and
still measure 3.97:1 in dark; they are outstanding, and recorded as such in
`docs/ACCESSIBILITY.md`.

Plus `--scrollbar-thumb-hover` (`#2a3550` / `#ccd3e4`).

---

## 3. The anti-flash script

`components/ui/ThemeScript.tsx` renders a **parser-blocking inline `<script>` in
`<head>`**. That is not a stylistic choice; it is the only construct that runs
after `<html>` exists and before the first paint:

- a React effect runs after hydration — hundreds of milliseconds too late;
- `next/script` at anything other than `beforeInteractive` is too late;
- `<script src>` costs a network round trip even without `defer`;
- `type="module"` is deferred by definition;
- pure CSS cannot express "a stored choice beats `prefers-color-scheme`",
  because CSS cannot read `localStorage`.

The script reads `localStorage['quantum-lab.theme']`, falls back to
`matchMedia('(prefers-color-scheme: light)')`, then sets the class,
`style.colorScheme` and the `<meta name="color-scheme">` content. It is wrapped
in `try/catch` because `localStorage` throws in Safari private mode and in
cookie-blocked third-party frames, and a throw there would abort head parsing.

**On `dangerouslySetInnerHTML`.** This is the one justified use of it in the
app: React escapes children, so there is no other way to emit raw script text.
The content is a **static string literal defined in that file** — no props, no
request data, no user input reaches it, so there is no injection surface. Any
future edit must preserve that.

Verified in Chromium: with the OS set to dark and `light` pinned, the class is
already `light` and `document.body`'s background is already `rgb(247,248,252)`
at both `DOMContentLoaded` and the first `requestAnimationFrame`.

**Why not `light-dark()`.** The platform guidance recommends `light-dark()` for
token definitions. It cannot be used for these tokens. A custom property's
*computed value* is an unresolved token stream, so
`--q-violet: light-dark(#4a30c4, #7c6af9)` makes
`getComputedStyle(el).getPropertyValue('--q-violet')` return the literal string
`"light-dark(#4a30c4, #7c6af9)"`. `ctx.fillStyle` cannot parse that, and every
canvas that reads a hue would silently fall back to black. Values are therefore
emitted as already-resolved colours in per-theme blocks. The rest of the
guidance is followed: `<meta name="color-scheme">`, `color-scheme` on `:root`
per theme, `accent-color`, the standard `scrollbar-color` property with the
legacy `::-webkit-scrollbar` rules confined to `@supports not (scrollbar-color: auto)`,
and a CSS-level `prefers-color-scheme` fallback for the no-JS case.

The guidance also argues for a **two-state** toggle (System / the opposite)
rather than three. This app ships three by product requirement; the cost is
that "Auto" and one of the other two usually render identically, mitigated by
naming the resolved value in the group's accessible name.

---

## 4. The light theme is now materially complete — a few components still hardcode colour

This section originally described the canvas/WebGL visualizations as entirely
hardcoded and out of scope ("other workstreams own those files"). **That workstream has
since landed.** Below is the current state, verified by reading each file rather than by
trusting the paragraph above.

**Backgrounds were always fine, and still are.** No visualization paints an opaque
background. They all use `ctx.clearRect(...)` or `renderer.setClearColor(0x000000, 0)`, so
the canvas is transparent and shows `.card`'s `--surface` through it. There is no
`#07090f` fill inside any viz canvas.

### Fixed: 7 of the 8 canvas/WebGL visualizations

`BlochSphere.tsx`, `DecoherenceLab.tsx`, `DoubleSlit.tsx`, `EntanglementLab.tsx`,
`GroverLab.tsx`, `QFTLab.tsx` and `SuperpositionLab.tsx` now all call
`getComputedStyle(document.documentElement).getPropertyValue('--token-name')` (or an
equivalent `readColors`/`readVar` helper) inside their effect, re-reading the current
theme's values rather than using a literal hex. The literal hex values that remain in
these files are named `FALLBACK_*` constants, used only if a custom property is somehow
unset — not the values actually painted once CSS has loaded. Each also re-reads on theme
change, so switching Light ↔ Dark repaints the canvas without a reload. Verified by
grepping for `getComputedStyle` in every file under `components/viz/`: all seven appear
exactly once (inside the color-reading helper); the eighth (below) appears zero times.

### Still hardcoded: `components/viz/TunnelingLab.tsx`

The one visualization with a `requestAnimationFrame` loop that was **not** converted.
Colours are still module-level `const` literals with no runtime read at all:

```ts
const INK_SECONDARY = '#8fa3c8'
const INK_MUTED = '#3d5070'   // the pre-fix ink-muted value — doubly stale, see §2
const VIOLET = '#7c6af9'
const TEAL = '#3bbfaa'
const AMBER = '#f5a623'
const SKY = '#5baaec'
```

plus four more literal `ctx.fillStyle` assignments for the `V₀`, `E`, "reflected N%" and
"transmitted N%" labels (`#fac96a`, `#92ccf4`, `#f0899f`, `#7ee8d8`). Note that
`INK_MUTED` here is still the *old* `--ink-muted` value from before the contrast fix in
§2 — even a dark-theme user sees the low-contrast axis colour on this one canvas. The
packet, barrier box and curve are readable in light mode because the fills that matter
most (violet, the packet density) happen to still read acceptably; the four annotation
labels do not. This is the one concrete remaining piece of the theming work.

### Fixed: SVG and DOM-based visuals

`components/circuit/CircuitGrid.tsx`, `components/circuit/GatePalette.tsx`,
`components/analytics/UsageChart.tsx`, `components/analytics/Sparkline.tsx`,
`components/ui/Histogram.tsx` and `components/coach/SkillMap.tsx` all now reference
`var(--token-name)` (or `rgb(var(--token-rgb) / alpha)`) directly in `fill`/`stroke`/style
props. Because these are SVG/DOM, not canvas, this is sufficient — the browser re-resolves
the custom property itself whenever `<html>`'s class changes, with no JS needed. Verified:
none of these six files match `#[0-9a-f]{3,8}` outside of comments, and the circuit wires
(previously `rgba(255,255,255,0.13)`, invisible on a white card) now read
`var(--line-strong)`.

### Still hardcoded: 8 components across circuit/analytics/coach/onboarding

Grepping the same directories the task of "finish the light theme" covers
(`components/viz/`, `components/circuit/`, `components/analytics/`, `components/coach/`,
`components/onboarding/`, `components/ui/FeatureCard.tsx`) for literal hex colours turns up
one visualization (above) plus:

- **`components/circuit/StateInspector.tsx`** — the separable/entangled pill's `color` is
  `'#7ee8d8'`/`'#c4baff'` inline, and the ket column is `text-[#c4baff]`.
- **`components/circuit/SaveLoadPanel.tsx`** — `AMBER`/`TEAL` constants
  (`{ color: '#fac96a', background: 'rgba(245,166,35,0.14)' }` and the teal equivalent) for
  the storage-mode pill.
- **`components/analytics/StatTile.tsx`** — `deltaColor` is `'#4ade80'` or `'#f0899f'`
  chosen by whether the delta reads as good or bad.
- **`components/coach/GoalPicker.tsx`** — the selected-goal pill is
  `text-[#c4baff]`.
- **`components/coach/NextUpCard.tsx`** — the `KIND_STYLE` lookup hardcodes a
  `border`/`text` hex pair per recommendation kind (`revise`/`advance`/`practise`/`explore`).
- **`components/onboarding/PathPicker.tsx`** — the `HUES` lookup hardcodes a `base`/`light`
  hex pair per onboarding path, and the unselected card background falls back to the
  literal `'#141a2c'` (wrong in light mode — that is the *dark* `--surface-2` value).
- **`components/onboarding/ResumeBanner.tsx`** — the "Continue →" link is
  `text-[#c4baff]`.

`components/circuit/CircuitGrid.tsx` has one remaining literal, `#ffffff`, for the stroke
of the "×" mark drawn on top of a rose-filled remove badge — that one is not a gap: the
badge is always rose-filled regardless of theme, so a fixed white mark on it is correct in
both themes, not a hardcoded-and-forgotten value.

`components/ui/FeatureCard.tsx` is fixed: both the icon tint and the tag pill resolve
through `var(--q-*-rgb)` / the `text-q-*-text` Tailwind aliases, with a comment explaining
that the old hardcoded `text-[#c4baff]` measured ~1.6:1 on a white surface.

### Still hardcoded, and correctly out of scope for this section

These were flagged in the original version of this doc and remain accurate — none of them
fall inside the directories above, so they were never expected to move in this pass:
`components/ui/VizFrame.tsx`, `components/ui/Hero.tsx` (the headline gradient),
`components/lesson/Certificate.tsx`, `components/tutor/ChatPanel.tsx`,
`components/pwa/OfflineBanner.tsx`, `components/instructor/CoPilotPanel.tsx`.
`app/opengraph-image.tsx` and `app/global-error.tsx` intentionally stay dark: the OG image
is a fixed brand asset and the global error boundary renders before any CSS or the theme
script exists (see `docs/ACCESSIBILITY.md` §5e for why `global-error.tsx` also keeps its
own `<main>`).

**Summary of what is honestly not light-themed yet:** one canvas
(`TunnelingLab.tsx`) and eight small DOM components with a hardcoded accent colour,
listed above. Everything that goes through a CSS custom property or a Tailwind
token — every page, card, button, table, form control, scrollbar, all seven of the other
visualization canvases, and every SVG/DOM chart — is correct.

---

## 5. Adding a new token without breaking a visualization

1. Add an entry to `TOKENS` in `lib/theme/tokens.ts` with `dark`, `light` and a
   `note`. Compute the light value's contrast against `#ffffff` and record it in
   the table above; aim for ≥ 4.5:1 for anything that can be text, ≥ 3:1 for
   graphical objects.
2. If the token will ever be used with a Tailwind opacity modifier
   (`bg-thing/15`), add its name to `CHANNEL_TOKENS` so an `R G B` triple is
   emitted too, and reference it in `tailwind.config.ts` as
   `rgb(var(--thing-rgb) / <alpha-value>)`. Otherwise `var(--thing)` is enough.
3. Regenerate the four blocks in `app/globals.css` from
   `cssVariableBlock('dark')` and `cssVariableBlock('light')`. All four blocks
   (`:root`, the `prefers-color-scheme` fallback, `:root.dark`, `:root.light`)
   must stay in sync.
4. **Never rename or delete an existing `--*` name.** `SuperpositionLab` and
   `GroverLab` read `--q-violet`, `--q-teal` and `--q-amber` by string at
   runtime; nothing type-checks that read, so a rename fails silently and only
   shows up as a black or default-coloured chart.
5. **Never give a token a `light-dark()` value.** See §3.
6. Re-run `npx vitest run` and load `/`, `/simulator` and
   `/visualizations/bloch-sphere` in both themes before shipping.
