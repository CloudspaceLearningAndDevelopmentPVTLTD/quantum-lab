# Accessibility audit — Quantum Lab

**Date:** 2026-08-17
**Scope:** `apps/web` — 56 routes, 8 canvas/WebGL visualizations, the circuit editor,
the command palette, the timed exam, the tutor chat.
**Method:** manual code review of every interactive component, keyboard walkthrough of
the primary task flows in Chromium, numeric contrast computation against the real design
tokens, and a hand-written Playwright suite (`apps/web/tests/e2e/a11y.spec.ts` — every
assertion is explicit). Since this audit, `tests/e2e/axe.spec.ts` also runs axe-core
(WCAG 2.1 A/AA tags) on every route in CI.
**Standard:** WCAG 2.2 Level AA.
**Note (2026-10-09):** route and finding counts below are as of the audit date; the app now
has 100 pages and the two suites run on every push.

> This is not an accessibility *statement*. It is an audit with open failures. Several
> Level A criteria still fail, listed below with the reason each was not fixed. An
> accessibility statement that overclaims is worse than none, so nothing here is
> described as conformant unless it was verified.

---

## 1. Findings

Severity: **Blocker** = the feature cannot be used at all by the affected group.
**Serious** = usable only with significant guesswork. **Moderate** = degraded.
**Minor** = friction.

| # | Sev | Location | WCAG | Who it affects | Finding | Status |
|---|-----|----------|------|----------------|---------|--------|
| 1 | **Blocker** | `components/circuit/CircuitGrid.tsx` | 2.1.1 A | Keyboard-only, switch, voice-control, screen-reader users | Gates were placed by clicking an SVG `<rect>` with no `tabindex`, no role and no key handler. Placed gates were removable by mouse only. A keyboard user could not build a circuit — the flagship feature of the product. | **Fixed** |
| 2 | **Blocker** | `components/tutor/ChatPanel.tsx` | 4.1.3 AA | Screen-reader users | The tutor's reply was appended to a plain `<div>`. Nothing announced it. A blind user pressed Send and heard silence, permanently. | **Fixed** |
| 3 | **Serious** | `components/circuit/CircuitGrid.tsx` | 1.1.1 A / 4.1.3 AA | Screen-reader users | Placing/removing a gate changed only SVG geometry; each placed glyph (control dot, ⊕ target, dashed barrier) had no text equivalent. | **Fixed** — every gate is now a named button, every mutation is announced. |
| 4 | **Serious** | `lib/theme/tokens.ts` token `--ink-muted` | 1.4.3 AA | Low-vision users, anyone on a dim/glare-affected screen | Was `#3d5070` dark / `#6b7a99` light — **2.31:1** on `--surface` (dark) and **4.31:1** on `--surface` / **3.52:1** on `--surface-3` (light), all short of 4.5:1. Used for real body copy (hints, axis labels, footnotes, plan copy, timestamps). | **Fixed** — now `#7d8cb0` dark / `#5a6883` light, **5.59:1 dark / 5.61:1 light** on `--surface` (4.65:1 / 4.58:1 on `--surface-3`). Computed directly from the values in `lib/theme/tokens.ts`. See §3. |
| 5 | **Serious** | `.btn-primary` (`bg-q-violet` + `text-white`) | 1.4.3 AA | Low-vision users | White on `--q-violet` was **3.97:1** in the dark theme and **8.36:1** in the light theme (which passed only because light `--q-violet` is `#4a30c4`). Every primary CTA in the product. The dark *hover* colour `#8d7dfa` was worse still: **3.26:1**. | **Fixed** — `.btn-primary` now takes its fill from a new button-only token `--q-violet-strong` (`#5b47d6` dark = **6.33:1** with white, `#4a30c4` light = 8.36:1) and `--q-violet-hover` dark becomes `#6a58e2` (**5.11:1**). `--q-violet` itself is untouched, because it is read at runtime by two canvases and is chart series 1. See §3 and §5d. |
| 6 | **Serious** | `app/layout.tsx` (no skip link) | 2.4.1 A | Keyboard and screen-reader users | ~10 header stops before main content, on all 56 routes. | **Fixed** — `<SkipLink />` is now the first child of `<body>` and `<main id="main" tabIndex={-1}>` wraps `{children}`; see §5a. |
| 7 | **Serious** | `components/exam/ExamRunner.tsx` (timer) | 4.1.3 AA / 2.2.1 A | Screen-reader users | The countdown was `role="timer" aria-live="off"` with nothing else speaking. A sighted candidate watches the clock turn amber at 5 min and rose at 1 min; a screen-reader user got nothing, then the paper submitted itself. | **Fixed** — the digits are `aria-hidden` and the clock still never announces itself; thresholds (30, 15, 10, 5, 2, 1 minutes) are announced instead, at most once each, and auto-submission is announced assertively. See §5b. |
| 8 | **Serious** | `components/exam/QuestionCard.tsx` | 1.3.1 A | Screen-reader users | The `radiogroup` / `group` wrapping the options had no accessible name — options announced as "radio, not checked, 1 of 4" with the question text unassociated. | **Fixed** |
| 9 | **Moderate** | 19 page components | 1.3.1 A | Screen-reader users | 19 pages render their own `<main>` inside the layout's `<main>` → nested `main` landmarks; "jump to main" is ambiguous. | **Fixed** — every page component that rendered its own `<main>` now renders a plain `<div>`. The one deliberate exception is `app/global-error.tsx`, which keeps its own `<main>` because it renders its own `<html>`/`<body>` (the root layout does not apply when it is shown) and is not one of the 19. |
| 10 | **Moderate** | `components/ui/Controls.tsx` `Segmented` | 1.3.1 A | Screen-reader users | The visual group label was an unassociated `<span>`; `role="group"` had no name, so "Shots" was invisible and buttons read as bare "256 / 1024 / 4096". | **Fixed** |
| 11 | **Moderate** | `components/ui/Controls.tsx` `Slider` | 1.3.1 A | Screen-reader users | The hint sat inside the `<label>`, so it was concatenated into the slider's *name* and re-read on every arrow key press. | **Fixed** (moved to `aria-describedby`, added `aria-valuetext`). |
| 12 | **Moderate** | `components/ui/Histogram.tsx` | 1.1.1 A | Screen-reader users | `role="img"` whose `aria-label` was just the title — "Measurement outcomes". Conveyed that a chart existed and nothing it said. | **Fixed** — label now summarises the distribution. |
| 13 | **Moderate** | `components/circuit/GatePalette.tsx` | 1.3.1 A / 4.1.3 AA | Screen-reader users | Gate groups unnamed; the gate description paragraph swapped silently on selection. | **Fixed** |
| 14 | **Moderate** | `app/visualizations/page.tsx`, `app/pricing/page.tsx` | 1.3.1 A | Screen-reader users navigating by heading | `h1 → h3` skip (card titles are `h3` with no intervening `h2`). | **Fixed** — `/visualizations` passes `headingLevel={2}` to `FeatureCard` (its grid hangs directly off the `h1`); `/pricing` wraps its plan cards in a visually-hidden `<h2 id="plans-heading">`. |
| 15 | **Moderate** | `components/ui/VizFrame.tsx` | 1.3.1 A / 2.4.1 A | Screen-reader users | The canvas — the entire point of the page — lived in an unnamed `<div>`, unreachable from the landmark/region list. The `<aside>` was likewise unnamed. | **Fixed** |
| 16 | **Minor** | `components/exam/QuestionCard.tsx` review mode | 1.4.1 A | Colour-blind users | Correct/incorrect on the numeric answer was carried by border colour alone. | **Fixed** (visually hidden verdict text). |
| 17 | **Minor** | `components/tutor/ChatPanel.tsx` | 4.1.3 AA | Screen-reader users | Request failures were rose-coloured text with no `role="alert"`. | **Fixed** |
| 18 | **Minor** | `components/exam/QuestionCard.tsx` review mode | 2.1.1 A / 1.4.1 A | Keyboard users, colour-blind users | Options were `disabled` in review mode, so a keyboard user could not Tab through their own answers, and the chosen/correct/incorrect verdict on each option was carried by hue plus an `aria-hidden` ✓/✗ glyph. | **Fixed** — `aria-disabled` replaces `disabled` (the options stay focusable; `toggleOption` already no-ops in review mode, so nothing can be regraded), and every reviewed option carries a visually-hidden verdict: "Your answer. Correct." / "You did not choose this. This was a correct answer." The numeric answer input is `readOnly` rather than `disabled` for the same reason. |
| 19 | **Minor** | `components/ui/Controls.tsx` `Slider` | 2.5.8 AA | Motor-impaired users | Range track is **224 × 6 CSS px**. Passes 2.5.8 only via the *spacing* exception (nothing else within a 24 px circle). | **Not fixed** — enlarging the track is a visual change. |
| 20 | **Minor** | `components/search/CommandPalette.tsx` | — | — | Option ids embed a route (`qlab-search-option-viz-/visualizations/grover`). Legal HTML, but `/` is not a valid CSS id token, so `#id` selectors break. No user impact; noted for maintainers. | **Not fixed** (not a defect). |

**Count (first pass): 20 findings — 2 blockers, 5 serious, 7 moderate, 6 minor. 18 fixed, 1 open**
(finding 19, the slider's small 224 × 6 px track, which passes 2.5.8 only via the spacing
exception and whose fix is a visual change). Findings 5, 7 and 18 — the dark-theme
`.btn-primary`, the silent exam timer and the unreachable review-mode options — were
fixed in that pass, together with the roving-tabindex grid specified in §5c. Finding 20 is
not a defect and is excluded from both counts.

### Second pass — /hardware, /insights, /account, /circuits, /coach, the paywall

**Date:** 2026-08-17. **Scope:** the surfaces the first audit explicitly listed as
untested. Same method: code review of every interactive component, keyboard walkthrough
in Chromium against a running build, numeric contrast computation from `lib/theme/tokens.ts`
in **both** themes, and one Playwright test per fix, each **run against the pre-fix build
first and confirmed failing there**.

| # | Sev | Location | WCAG | Who it affects | Finding | Status |
|---|-----|----------|------|----------------|---------|--------|
| 21 | **Blocker** | `components/billing/UpgradeGate.tsx` (overlay mode) | 4.1.2 A / 2.4.3 A | Keyboard-only and screen-reader users | The paywalled content was drawn behind `aria-hidden="true"` + `pointer-events-none`. `pointer-events` only stops the mouse. **Measured on /hardware: 9 focusable elements inside the aria-hidden subtree** (more once the device catalogue loads) — the shots control and the Submit button among them. Tab landed on controls that were, by construction, absent from the accessibility tree and unclickable. | **Fixed** — a real `inert` subtree, set as an IDL property from a ref because React 18 drops the attribute. |
| 22 | **Serious** | `components/hardware/JobMonitor.tsx` | 4.1.3 AA | Screen-reader users | The whole job of this component is to report a change that happens minutes to hours after the user spent real money, and it did it by swapping a coloured pill. `queued → running → done`, `error`, `cancelled` and every poll failure were silent. | **Fixed** — transitions only, throttled by a ref so a re-render with an unchanged status stays quiet; `error` is assertive. **Not covered by a running test** — see the `test.fixme` in `a11y.spec.ts` and §5f. |
| 23 | **Serious** | `components/hardware/CostEstimate.tsx` | 4.1.3 AA | Screen-reader users | The one number on the site denominated in the user's own money is repriced asynchronously by two controls elsewhere on the page. Rendering `$0.60 USD` left the polite live region **empty** — verified by reading `[data-a11y-live="polite"]` on the shipped build. | **Fixed** — announced when it settles, keyed on the sentence so an identical reprice is silent. |
| 24 | **Serious** | `components/hardware/DevicePicker.tsx` | 2.1.1 A | Keyboard-only, screen-reader users | Unavailable devices were `disabled`, i.e. out of the tab order entirely — so `device.reason` ("Needs AWS credentials on the service"), the most actionable sentence on the page, was unreachable. Exactly audit finding 18 again, in a different file. | **Fixed** — `aria-disabled`; `onClick` already refused unavailable devices, and now explains the refusal out loud. |
| 25 | **Serious** | `components/billing/PlanBadge.tsx`, `app/account/page.tsx`, `app/coach/page.tsx` | 1.4.3 AA | Everyone using the light theme | Six text pairs carried the literal **dark-theme** hexes (`#c4baff`, `#7ee8d8`, `#fac96a`) over hue-tinted card backgrounds. Computed against the light card surface: **1.47 / 1.28 / 1.38 / 1.44 / 1.34 / 1.78 : 1** — the plan badge, the "your subscription is ending" warning, the "checkout complete" confirmation and the coach's "Start here" pill were all effectively invisible in light. | **Fixed** — moved to `--q-*-text`, which is byte-identical in dark (8.84–11.11:1) and darkens in light to **6.78–10.92:1**. See §3b. |
| 26 | **Serious** | `app/circuits/page.tsx` | 3.3.4 A / 4.1.3 AA | Screen-reader users | A two-press confirm on an irreversible delete, where the only signal that the first press had armed it was the visible text going `✕` → `Sure?` — and a *static* `aria-label="Delete <name>"` masked even that, since aria-label wins over content. Press, hear nothing, press again to check, circuit gone. The arming also expires after 3 s, unannounced. | **Fixed** — the label is derived from the state, and both arming (with the 3 s window) and completion are announced. |
| 27 | **Moderate** | `components/billing/UpgradeGate.tsx` | 4.1.3 AA / 1.3.1 A | Screen-reader users | Rule 1 of the gate renders the real content while the entitlement loads, then swaps it for the lock. Sighted users watch that; a screen-reader user found the content gone mid-page with no cause given, and the lock itself was an anonymous `<div>` absent from the region list. | **Fixed** — announced once when the gate closes; the card is a `role="region"` named by its own heading. |
| 28 | **Moderate** | `app/insights/page.tsx` | 2.5.3 A | Voice-control users | The analytics switch carried `aria-label="Record analytics in this browser"`, which **replaces** the name. Visible text is "Analytics on" / "Analytics off", so the visible label appeared nowhere in the accessible name — "click Analytics on" hit nothing. | **Fixed** — the context moved to `aria-describedby`; the name is the visible text again. |
| 29 | **Moderate** | `components/coach/SkillMap.tsx` | 2.4.7 AA | Sighted keyboard users | The SVG is `role="img"`, so a text-equivalent list of the ten concepts is exposed as real links — wrapped in `sr-only`, which clips them to a 1 px box while leaving them focusable. Tabbing down /coach lost the focus ring for ten consecutive stops with nothing moving on screen. The existing 25-tab-stop check does **not** catch this: it accepts a UA `outline: auto`, which a clipped element still reports. | **Fixed** — `sr-only focus-within:not-sr-only` per item, the skip-link treatment. |
| 30 | **Moderate** | `components/search/CommandPalette.tsx` | 4.1.3 AA | Screen-reader users | Typing filters the listbox silently. `aria-expanded` flips once and never again, so "bel" (matches), "bell" (matches), "bellx" (matches nothing) were indistinguishable without arrowing into the list to find out. | **Fixed** — a coarse `role="status"` result count, outside the listbox, silent on an empty query. |
| 31 | **Moderate** | `components/billing/PricingTable.tsx`, `app/account/page.tsx`, `components/auth/AuthPanel.tsx` | 4.1.3 AA | Screen-reader users | Four async outcomes rendered as plain paragraphs with focus still on the button that triggered them: the checkout notice/error, the Stripe portal notice/error, and the magic-link "check your inbox" / failure. Press the CTA, page appears inert, explanation unread. | **Fixed** — `role="status"` for outcomes, `role="alert"` for failures. |
| 32 | **Moderate** | `components/analytics/StatTile.tsx` | 1.4.1 A | Colour-blind users | Two things were colour-only. The `▲`/`▼` glyph is read as "black up-pointing triangle" or skipped depending on the screen reader, and the *meaning* — whether the movement is good, which is the entire purpose of the `invertDelta` prop — had no non-colour equivalent at all. "Hints used ▼ 12" green and "Lessons completed ▼ 12" rose were identical. | **Fixed** — glyph `aria-hidden`, direction and verdict in text. |
| 33 | **Moderate** | `app/account/page.tsx` (usage bar) | 1.4.11 AA / 1.4.1 A | Low-vision, colour-blind users | The progress fill is the only graphical carrier of "how much is left" and needs 3:1 against its own `--surface-3` track. Literal hexes measured **1.65:1 (amber) and 2.86:1 (rose)** on the light track. The three states were also colour-only. | **Fixed** — tokens (light **6.82 / 4.98 / 4.33 : 1**, dark unchanged) plus `aria-valuetext` naming the state. |
| 34 | **Moderate** | `app/insights/page.tsx`, `app/coach/page.tsx` | 4.1.3 AA | Screen-reader users | "Generate sample data" replaces an empty state with six stat tiles, two line charts and a histogram; a coach goal chip re-ranks three recommendation cards; the analytics switch empties the dashboard. None was in a live region and none was announced. | **Fixed** — each announces its consequence, not just its own state. |
| 35 | **Minor** | `components/hardware/DevicePicker.tsx` | 4.1.2 A | Screen-reader users | `role="radiogroup"` with every radio tabbable is not a radiogroup; and selecting a device silently repriced the whole submission. | **Fixed** — roving tabindex + arrow keys (wrapping, per the radio pattern), and the selection announces the consequence. |
| 36 | **Minor** | `components/coach/NextUpCard.tsx` | 2.4.4 A | Screen-reader users | Three recommendation cards side by side, CTAs drawn from a four-entry table: the link list read "Start the lesson, Start the lesson, Open the visualization". | **Fixed** — `aria-label` names the destination; the visible text is still a prefix of the name, so 2.5.3 holds. |
| 37 | **Minor** | `components/hardware/JobMonitor.tsx` | 1.3.1 A | Screen-reader users | The elapsed counter was a bare `<span aria-label="Elapsed time">`. A generic element with no role has no accessible name, so the label was never exposed at all. | **Fixed** — `role="timer"`, digits `aria-hidden`, `aria-live="off"` explicit, same shape as the exam clock. |
| 38 | **Minor** | `components/hardware/JobMonitor.tsx`, `app/circuits/page.tsx` | 4.1.3 AA | Screen-reader users | "Copy id" / "Copy link" flip their own label to "Copied" while still holding focus, which assistive tech does not reliably re-read. | **Fixed** — announced. |

**Count (second pass): 18 findings — 1 blocker, 5 serious, 9 moderate, 3 minor. All 18
fixed.** Ten of them have a Playwright test that was **run against the pre-fix build and
failed there**; finding 22 (the job monitor) is fixed in code but its test is `test.fixme`,
because reaching `JobMonitor` needs a signed-in Pro session and a live `services/api`,
neither of which exists in CI. §5f says exactly what would re-enable it.

---

## 2. Can a keyboard-only user build and run a circuit?

**Before this audit: no.** `CircuitGrid` is an `<svg>`; gates were placed by clicking a
full-row transparent `<rect>` that had no `tabindex`, no `role`, and no keyboard handler.
There was no alternative path — no list view, no text entry of gate placement. QASM
*import* existed, so a keyboard user could paste a circuit in, but could not compose one.
That is a Level A 2.1.1 failure on the product's headline feature.

**After: yes, verified end to end.** The fix was contained enough not to need a
restructure:

* Each wire strip is now `tabIndex={0} role="button"` with an `aria-label` that states
  what Enter will do (`"Wire for qubit 0. Press Enter to place Hadamard."`, and during a
  multi-qubit placement `"…to use this qubit as the control qubit for CX"`).
* Enter and Space call the same `placeOn(q)` a click calls. Space is `preventDefault`ed
  so it does not scroll.
* Each placed gate `<g>` is a named button (`"CX gate, control qubit 0, target qubit 1,
  step 2. Press Enter to remove."`) — so gates can be removed by keyboard too.
* Focus is drawn explicitly inside the SVG (a violet outline on the wire, a dashed
  outline on a glyph), because UA focus rings on SVG children are inconsistent. Focusing
  a glyph also triggers the existing hover treatment, so the remove badge appears.
* Every placement/removal is announced through `lib/a11y/announce.ts`.

Verified in Chromium against a production build: select **H** → Enter, Tab to wire q0 →
Enter, select **CX** → Enter, wire q0 → Enter, wire q1 → Enter, Tab to **Run** → Enter.
Result: two gates placed, a Bell distribution sampled, and the live region read

> `CX gate, control qubit 0, target qubit 1, step 2 added. 2 gates in the circuit.`

and the histogram announced

> `Measurement outcomes, 1,024 shots total. 2 outcomes: 11 521 shots, 50.9 percent; 00 503 shots, 49.1 percent.`

**That caveat is now closed.** The tab order used to be linear — *n* wires plus one stop
per placed gate, so a 30-gate circuit was 30 extra tab stops. `CircuitGrid` is now a
roving-tabindex grid: **one** tab stop for the whole editor, arrow keys to move a cursor
over wire × column, `Enter`/`Space` to place or remove, `Delete` to remove, `Home`/`End`
(and `Ctrl+Home`/`Ctrl+End`) to jump. Every keystroke that worked before still works. Full
keyboard model in §5c. The sequence verified above still holds; the wire-by-wire Tab
presses in it are now arrow presses inside the grid.

---

## 3. Colour contrast — computed, not eyeballed

Formula (WCAG 2.x, [relative luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance)):

```
for each 8-bit channel:  cs = c / 255
                          c = cs / 12.92                     if cs ≤ 0.03928
                          c = ((cs + 0.055) / 1.055) ^ 2.4   otherwise
L      = 0.2126·R + 0.7152·G + 0.0722·B
ratio  = (L_lighter + 0.05) / (L_darker + 0.05)
```

Thresholds: **4.5:1** normal text (1.4.3 AA), **3:1** large text (≥18.66 px bold or
≥24 px) and non-text/UI (1.4.11 AA).

### Body text tokens

| Foreground | on `bg` `#07090f` | on `surface` `#0d1120` | on `surface-2` `#141a2c` | on `surface-3` `#1b2338` |
|---|---|---|---|---|
| `ink` `#eef2ff` | 17.80 ✅ | 16.80 ✅ | 15.47 ✅ | 13.97 ✅ |
| `ink-secondary` `#8fa3c8` | 7.81 ✅ | 7.37 ✅ | 6.79 ✅ | 6.13 ✅ |
| **`ink-muted` (dark), was `#3d5070`, now `#7d8cb0`** | 5.92 ✅ | **5.59 ✅** (was 2.31 ❌) | 5.15 ✅ | 4.65 ✅ |

Values above are all against the **dark** surfaces (`#07090f` / `#0d1120` / `#141a2c` /
`#1b2338`), as this table was originally built before the app had a light theme.

**Fixed.** `text-ink-muted` on `bg-surface` was **2.31:1** dark and **4.31:1** light (on
`--surface`, dropping to 3.52:1 on `--surface-3`) — both short of 4.5:1. It is not a
decorative token: it carries slider hints, chart axis labels, the "Showing the N most
frequent outcomes" footnote, the exam question-kind pills, the site footer, plan copy and
every placeholder — the single highest-volume contrast defect in the product, which is why
it was fixed first. `lib/theme/tokens.ts` now sets `--ink-muted` to `#7d8cb0` dark /
`#5a6883` light: **5.59:1 dark / 5.61:1 light on `--surface`**, and 4.65:1 / 4.58:1 on
`--surface-3` — clear of 4.5:1 everywhere the token is actually used, in both themes.
`lib/theme/tokens.ts`'s own note on the token says "do not darken it again."

### The five categorical hues used as text

Base tokens (used for `.section-label`, chart fills, gate strokes):

| Hue | on `bg` | on `surface` | on `surface-2` | on `surface-3` |
|---|---|---|---|---|
| `q-violet` `#7c6af9` | 5.01 ✅ | 4.73 ✅ | **4.36 ❌** | **3.93 ❌** |
| `q-teal` `#3bbfaa` | 8.74 ✅ | 8.24 ✅ | 7.59 ✅ | 6.86 ✅ |
| `q-amber` `#f5a623` | 9.82 ✅ | 9.27 ✅ | 8.54 ✅ | 7.71 ✅ |
| `q-rose` `#e8547a` | 5.67 ✅ | 5.35 ✅ | 4.93 ✅ | **4.45 ❌** |
| `q-sky` `#5baaec` | 7.97 ✅ | 7.52 ✅ | 6.92 ✅ | 6.25 ✅ |

`.section-label` is `text-q-violet` at 11 px bold — normal text for WCAG purposes, so
4.5:1 applies. It passes on `bg` and `surface` (5.01 / 4.73) and **fails inside
`surface-2` and `surface-3` cards (4.36 / 3.93)**, which is where several of them sit.

The `*-light` variants the components actually use for most coloured text are all
comfortably clear:

| Light variant | on `surface` | on `surface-3` |
|---|---|---|
| `#c4baff` violet | 10.57 ✅ | 8.79 ✅ |
| `#7ee8d8` teal | 12.90 ✅ | 10.73 ✅ |
| `#fac96a` amber | 12.19 ✅ | 10.14 ✅ |
| `#f0899f` rose | 7.86 ✅ | 6.54 ✅ |
| `#92ccf4` sky | 10.88 ✅ | 9.05 ✅ |

### 3b. Hardcoded dark-theme hexes in the light theme (second pass, findings 25 and 33)

The first pass fixed the *tokens*. It did not sweep the places that had copied the token
values as literals — and a literal hex cannot know which theme it is in. Six text pairs
and three graphic fills were computing at roughly 1.3–2.9:1 for every light-theme user.

All values below are computed with the same formula as §3, compositing the tinted
background over the light card surface `#ffffff` (or the `--surface-3` track for the bar).

| Pair | Dark (before = after) | Light **before** | Light **after** |
|---|---|---|---|
| `PlanBadge` pro — violet text on violet 16% | 8.84 ✅ | **1.47 ❌** | **8.32 ✅** |
| `PlanBadge` team — teal text on teal 16% | 9.90 ✅ | **1.28 ❌** | **7.04 ✅** |
| `PlanBadge` edu — amber text on amber 16% | 9.25 ✅ | **1.38 ❌** | **6.78 ✅** |
| `/account` "access ends" box — amber on amber 10% | 10.46 ✅ | **1.44 ❌** | **7.41 ✅** |
| `/account` "checkout complete" box — teal on teal 10% | 11.11 ✅ | **1.34 ❌** | **7.72 ✅** |
| `/coach` "Start here" pill — violet on surface | 10.57 ✅ | **1.78 ❌** | **10.92 ✅** |
| `/account` usage bar fill, violet (needs 3:1, 1.4.11) | 3.93 ✅ | 3.24 ✅ | **6.82 ✅** |
| `/account` usage bar fill, amber (needs 3:1) | 7.71 ✅ | **1.65 ❌** | **4.98 ✅** |
| `/account` usage bar fill, rose (needs 3:1) | 4.45 ✅ | **2.86 ❌** | **4.33 ✅** |

The fix is the same everywhere: `#c4baff` → `var(--q-violet-text)`, `#7ee8d8` →
`var(--q-teal-text)`, `#fac96a` → `var(--q-amber-text)`, and the bar fills to
`var(--q-violet|amber|rose)`. The dark column is unchanged **by construction** — those
literals were exactly the dark token values, which is why the defect was invisible to
anyone reviewing in dark.

`grep -rn '#[0-9a-fA-F]\{6\}' apps/web/components apps/web/app` is the check. It returns
nothing in this pass's edit set now; `lib/theme/tokens.ts` remains the only place a literal
colour belongs.

### Other measured pairs

| Pair | Ratio | Verdict |
|---|---|---|
| `white` on `q-violet-strong` — every `.btn-primary` (**after this pass**) | **6.33** dark (`#5b47d6`) / **8.36** light (`#4a30c4`) | ✅ both themes clear 1.4.3. The dark fill is also 3.14:1 on `--bg`, so the button's own edge still clears 1.4.11. |
| `white` on `q-violet-hover` — `.btn-primary:hover` (**after this pass**) | **5.11** dark (`#6a58e2`) / **10.92** light | ✅ was 3.26:1 dark (`#8d7dfa`) — the hover state failed 1.4.3 harder than the resting state. |
| `white` on `q-violet` — what `.btn-primary` used to be, and what the active Segmented option and the active plan button in `PricingTable` still are | **3.97** dark / **8.36** light | ❌ dark fails 1.4.3 (4.5:1), passes only as large text. Fixed for `.btn-primary` by moving it off `--q-violet` (see above); still open on those two other surfaces, which are outside this pass's edit set. |
| Focus ring `q-violet` on `bg` | 5.01 | ✅ passes 1.4.11 (3:1) — the ring is genuinely visible on the dark surfaces. |
| Focus ring `q-violet` on `surface` | 4.73 | ✅ |

**Conclusion on the focus ring:** `.focus-ring` is well designed and clears 3:1 with
room. Its problem is coverage, not contrast — see §4.

---

## 4. What was verified, and how

### Focus visibility and focus order
`.focus-ring` is applied broadly and correctly (`outline-none` + `focus-visible:ring-2`
with a ring offset against `bg`). The automated check tabs 25 times from the top of eight
representative routes and compares computed `outline`/`box-shadow`/`border`/`background`
before and after focus. **All 8 routes pass** — every one of the first 25 tab stops on
`/`, `/visualizations`, `/visualizations/superposition`, `/simulator`, `/tutor`,
`/challenges`, `/certify` and `/pricing` has a visible focus indicator. Note that this
became true for the circuit editor only because the fix draws its own SVG focus outlines;
the check is written to notice an SVG-drawn indicator as well as a CSS one.

### Canvas visualizations (8)
All eight already had `role="img"` with a genuinely descriptive, live-updating
`aria-label` — not "a chart": e.g. `GroverLab` names the marked state, its amplitude, its
probability and the mean amplitude; `EntanglementLab` reports both qubits' probabilities
and the entanglement entropy; `SuperpositionLab` describes collapse. This is the best-done
part of the codebase and needed no change. The gaps were around them: the containing
region was unnamed (fixed in `VizFrame`), and the non-canvas `Histogram` had a title-only
label (fixed).

### Reduced motion
Verified empirically, not by reading the code. With a production build, two canvases were
screenshotted 1.2 s apart under `prefers-reduced-motion: no-preference` and again under
`reduce`:

| Component | Motion allowed | `prefers-reduced-motion: reduce` |
|---|---|---|
| `TunnelingLab` (`/visualizations/tunneling`) | frames differ (animating) | **frames identical (static)** ✅ |
| `DoubleSlit` (`/visualizations/double-slit`) | frames differ (animating) | **frames identical (static)** ✅ |

Both genuinely honour the preference: the rAF loop stops after one frame and control
changes trigger a single static redraw. The remaining six read the same media query in the
same shape and were reviewed by code, not screenshot.

### Command palette
Verified against a real build, not by inspection. The input is `role="combobox"` with
`aria-expanded`, `aria-autocomplete="list"` and `aria-controls` pointing at a real element
with `role="listbox"`. After `ArrowDown`, `aria-activedescendant` resolves to an existing
element that has `role="option"` and `aria-selected="true"`, and a second `ArrowDown`
moves it. **The relationship is correct and the activedescendant genuinely tracks.** Focus
management is also right: the native `<dialog>` + `showModal()` gives a real focus trap
and inertness, and focus is explicitly returned to the opener on close.

### Target size (2.5.8 AA, 24 × 24 CSS px) — measured

| Control | Measured | 2.5.8 AA | 2.5.5 AAA (44 px) |
|---|---|---|---|
| Qubit selector button | 30.7 × 28 | ✅ | ❌ |
| Exam question navigator button | 28 × 28 | ✅ | ❌ |
| Gate palette button | 50 × 44 | ✅ | ✅ |
| Segmented (Shots) button | 49.4 × 28 | ✅ | ❌ |
| Noise slider track | 224 × 6 | ⚠️ passes only via the spacing exception | ❌ |

Both "small grids" flagged for review clear the AA minimum. The slider is the real
concern.

### Form labelling
Every `input`, `select` and `textarea` on the eight audited routes has a real label,
`aria-label` or `aria-labelledby`. The automated check deliberately does **not** accept a
`placeholder` as a name, and still passes — there is no placeholder-as-label anywhere in
the audited set. Two genuine defects existed in `Controls.tsx` (findings 10 and 11) and
are fixed.

### Heading structure
Exactly one `h1` on all eight routes ✅. Two routes skip a level (finding 14).

---

## 5. Fixed since the audit, and what is still not fixed

### 5a. The skip link is now mounted (finding 6) — **fixed**

`components/ui/SkipLink.tsx` was already correct; `app/layout.tsx` now renders it:

```tsx
<body className="min-h-screen bg-bg text-ink">
  <SkipLink />          {/* FIRST child of <body> — DOM order is tab order */}
  <SiteNav />
  ...
  <main id="main" tabIndex={-1}>{children}</main>
```

`tabIndex={-1}` on `<main>` is present, which matters: without it several browsers scroll
to the target but leave focus on the link, so the next Tab returns to the nav and the skip
link accomplishes nothing. The corresponding test in `a11y.spec.ts` — previously
`test.fixme` with a comment explaining exactly this — is now a live `test(...)`.

### 5b. The exam timer speaks at thresholds (finding 7) — **fixed**

`components/exam/ExamRunner.tsx` still renders the clock with `aria-live="off"` — a
per-second live region ("24:59, 24:58, …") is intolerable and would make the paper
unsittable. What changed is everything around it:

* The digits are wrapped in `<span aria-hidden="true">`, so a screen reader walking the
  page does not read a number that is stale before it finishes the sentence. The element
  keeps `role="timer"` and gains `aria-label="Time remaining"`, so the control is still
  discoverable.
* A `useEffect` on `left` announces at `TIME_GATES_MINUTES = [30, 15, 10, 5, 2, 1]`
  whole minutes remaining, `polite` above 5 minutes and `assertive` at 5 and below.
* **Throttling:** `lastAnnouncedGateRef` holds the last gate spoken. The clock ticks once
  a second, so ~60 renders map to one gate; the ref makes the second through sixtieth a
  no-op, and it survives re-renders (state would not, a `left` comparison would not
  survive a StrictMode double-invoke). The gates are monotonically descending, so one
  remembered value is a complete record. It is reset only by `handleRetry`, i.e. per
  attempt.
* Auto-submission announces `"Time is up. Your paper has been submitted for grading."`
  assertively, from `finish(..., 'expired')` — so the expired-while-the-tab-was-closed
  path on mount announces too.

Still true, and still not fixed: 2.2.1 asks for the time limit to be extendable or
adjustable. A certification exam may claim the "Essential Exception", but that claim
should be stated on `/certify` rather than assumed.

### 5c. Roving-tabindex grid for the circuit editor (finding 1, efficiency) — **shipped**

The earlier fix made the editor *operable*; the tab order was still linear — one stop per
wire plus one per placed gate, so a 30-gate circuit was 30 extra stops. `CircuitGrid.tsx`
is now a grid widget:

* The wires, labels and highlights are a decorative `<g aria-hidden="true">`. Next to
  them, `<g role="grid" aria-label="Circuit editor grid, 2 qubits by 4 columns. Use the
  arrow keys to move, Enter to place or remove a gate.">` holds a `role="row"` per qubit
  and a `role="gridcell"` `<rect>` per (qubit, column).
* **Roving tabindex, not `aria-activedescendant`** (the audit said do one, not both):
  cursor state `{q, col}` lives in the component, the cursor cell is `tabIndex={0}` and
  every other cell is `-1`, so the whole editor is **one tab stop**. The cursor is clamped
  on read, so clearing the circuit can never leave it off-grid.
* Keyboard model: `ArrowUp`/`ArrowDown` move between wires, `ArrowLeft`/`ArrowRight`
  between columns, all clamped with no wrapping; `Home`/`End` jump to the first/last
  column of the wire and `Ctrl`(or `Cmd`)`+Home`/`End` to the first/last cell of the grid;
  `Enter`/`Space` place the selected gate on this wire, or remove the gate under the
  cursor (`Space` is `preventDefault`ed so it does not scroll); `Delete`/`Backspace`
  remove the gate under the cursor and say so when there is nothing to remove; `Escape`
  still cancels a pending multi-qubit placement (that window listener is unchanged).
  Multi-qubit placement is unchanged too: `Enter` on a wire contributes the next qubit,
  and the cell label says which role it will play ("…to use this qubit as the control
  qubit for CX").
* Every cell names itself: `"Qubit 1, column 2, empty. Press Enter to place H as step 1."`
  or `"Qubit 0, column 1, CX gate, control qubit 0, target qubit 1, step 1. Press Enter to
  remove."` Cursor moves are not separately announced — the focused cell is read by the
  screen reader already — while mutations still are, exactly as before.
* The coordinate model the audit said did not exist is one function, `opAt(q, col)`: op
  *i* is drawn in column *i*, and occupies row *q* if it acts on that qubit (a `BARRIER`
  occupies every row). Placement still appends to the ordered list, which is why an empty
  cell's label names the step the gate will actually land on rather than pretending the
  column is a slot.
* Placed gate glyphs are now `aria-hidden` mouse affordances: their content is already
  exposed by the gridcell underneath, and leaving them focusable would put back the
  per-gate tab stops. Clicking a glyph still removes it, and the grid cursor landing on a
  gate lights up the same remove badge a hover does. Focus is still painted by hand — a
  violet outline on the cursor cell — because UA focus rings on SVG children are
  unreliable.

Mouse behaviour is deliberately unchanged: a cell click still places (or removes), so the
coordinate-driven helpers in `tests/e2e/helpers.ts` (`placeGate`) and the click-a-wire
test in `tests/e2e/simulator.spec.ts` keep working untouched.

Two loose ends: `components/circuit/GatePalette.tsx` still tells the user to "Tab to a
wire and press Enter", which is now one arrow-key press out of date — that file was
outside this pass's edit set. And the grid renders *rows × columns* `<rect>`s where it
used to render one strip per wire; for the sizes this editor supports (≤6 qubits, ops +
4 columns) that is tens of nodes, but a much larger circuit would want cells rendered
only near the cursor.

### 5d. Contrast tokens (findings 4, 5) — **both fixed**

`lib/theme/tokens.ts` `--ink-muted` was changed to `#7d8cb0` dark / `#5a6883` light
(2.31:1 → 5.59:1 dark on `--surface`; see §3).

`.btn-primary` no longer takes its fill from `--q-violet`. **Which approach and why:** a
button-only token, not a darker `--q-violet`. `--q-violet` is read at runtime by
`SuperpositionLab` and `GroverLab` via `getComputedStyle`, is chart series 1, and is the
focus-ring colour; a value dark enough for white text (`#5b47d6`) measures 3.14:1 on
`--bg`, so as a *mark* colour it would go from comfortable (5.01:1) to barely over the
3:1 floor, and five visualizations would change hue for a reason that has nothing to do
with them. So `lib/theme/tokens.ts` and `app/globals.css` gain:

| Token | Dark | Light | White-on-fill |
| --- | --- | --- | --- |
| `--q-violet-strong` | `#5b47d6` | `#4a30c4` | **6.33:1** dark / **8.36:1** light |
| `--q-violet-hover` (retuned) | `#6a58e2` (was `#8d7dfa`) | `#3b2699` | **5.11:1** dark (was **3.26:1**) / 10.92:1 light |

`.btn-primary` is now `@apply btn text-white` plus `background-color:
var(--q-violet-strong)`. The light theme's number is unchanged — but it is now a
deliberate value on a token whose only job is to sit behind white text, rather than an
accident of `--q-violet`'s light value.

**Still open, and honestly so:** the other two white-on-`--q-violet` surfaces — the active
`Segmented` option (`components/ui/Controls.tsx`) and the active plan button
(`components/billing/PricingTable.tsx`) — remain at 3.97:1 in dark. Both are one-line
changes to `--q-violet-strong` now that the token exists; neither file was in this pass's
edit set.

### 5e. Landmarks and headings (findings 9, 14) — fixed

19 page components rendered `<main>` inside the layout's `<main>`; each now renders a
plain `<div>` instead (the layout already provides the one `<main>`). The sole intentional
exception is `app/global-error.tsx`, which renders its own `<html>`/`<body>` (the root
layout is bypassed entirely when it is shown) and correctly keeps its own `<main>`. On
`/visualizations`, the card grid hangs directly off the `<h1>` so `FeatureCard` is now
passed `headingLevel={2}`; on `/pricing`, the plan-card section is wrapped in a
visually-hidden `<h2 id="plans-heading">Plans and pricing</h2>` so the outline no longer
skips from `h1` to `h3`.

### 5f. The job monitor is fixed in code but not covered by a running test

`components/hardware/JobMonitor.tsx` was the largest 4.1.3 defect this pass found: a job
that costs real money and takes minutes to hours changed state by swapping a coloured pill
and nothing else. It now announces `queued → running → done / error / cancelled`, and
recoverable poll failures, through `lib/a11y/announce.ts` — transitions only, throttled by
a ref, so a re-render with an unchanged status is silent and the two-second poll cadence
does not become a two-second announcement cadence. `error` is assertive because the job is
over, it may have been charged for, and there is a "Try again" button to find.

**This is not covered by an executing test, and that is stated rather than papered over.**
Reaching `JobMonitor` at all requires a submitted job, which requires all three of: a
Supabase session, a Pro entitlement, and a live `services/api` — `/api/hardware/submit` is
authenticated, quota'd and forwards to the Python service. None of those exists in CI. The
test is therefore `test.fixme` in `a11y.spec.ts` with the same explanation, following the
convention the skip-link test used until `layout.tsx` mounted it.

**To re-enable:** add a signed-in Pro fixture to the suite (the certification and org work
will need the same thing), then stub `/api/hardware/submit` and `/api/hardware/job/*` the
way `stubHardwareApi()` already stubs the device catalogue — the catalogue stub is proof
that the approach works, since it is what makes the `DevicePicker` and `CostEstimate` tests
run at all.

The same limitation does **not** apply to `DevicePicker` and `CostEstimate`: those render
inside the paywall overlay, and `inert` stops focus and assistive tech without stopping
React effects, so their announcements fire and are asserted for real.


---

## 6. WCAG 2.2 AA status

Honest per-criterion state after this audit. "Untested" means exactly that — not
"probably fine".

### Passing (verified)

| Criterion | Note |
|---|---|
| 1.1.1 Non-text Content (A) | All 8 canvases, all `svg[role=img]`, and the histogram carry meaningful names; decorative graphics are `aria-hidden`. Verified across 8 routes by test. |
| 1.4.11 Non-text Contrast (AA) | Focus ring 5.01:1 on `bg`, 4.73:1 on `surface`. |
| 2.1.2 No Keyboard Trap (A) | The palette uses native `<dialog>` + `showModal()`; verified Escape closes and returns focus. |
| 2.4.3 Focus Order (A) | DOM order matches visual order on the audited routes. |
| 2.4.7 Focus Visible (AA) | 25 tab stops × 8 routes, all with a detectable indicator. |
| 2.5.8 Target Size Minimum (AA) | All measured controls ≥24×24, except the slider track which passes via the spacing exception. |
| 3.3.2 Labels or Instructions (A) | No placeholder-as-label found; every control on 8 routes is named. |
| 4.1.2 Name, Role, Value (A) | Verified for the combobox/listbox, the gate palette, the segmented controls, the circuit editor and the exam options. |
| **2.4.1 Bypass Blocks (A)** | `<SkipLink />` is the first child of `<body>`; `<main id="main" tabIndex={-1}>` receives focus. Fixed (finding 6). |
| **1.3.1 Info and Relationships (A)** | Nested `main` landmarks fixed on all 19 pages (finding 9, `global-error.tsx` correctly exempt); `h1→h3` skips fixed on both routes (finding 14). All 16 audited routes now have exactly one `h1`, no skipped heading levels and one un-nested `main`, checked by test. |
| **2.5.3 Label in Name (A)** | Was never claimed before. The one violation found — the /insights analytics switch (finding 28) — is fixed and tested. Still **untested** on the circuit wires; see Untested below. |
| **4.1.3 Status Messages (AA)** | Now verified on the surfaces this pass covered: the paywall, the hardware cost estimate, the device picker, checkout and portal outcomes, magic-link results, the destructive confirms on /circuits and /insights, the palette result count, and the coach's re-ranking. The job monitor is fixed but **not** covered by a running test — §5f. |

### Failing (open)

| Criterion | Failure |
|---|---|
| **1.4.3 Contrast Minimum (AA)** | `ink-muted` (finding 4), `.btn-primary` (finding 5) and the nine light-theme literals of findings 25 and 33 are all fixed and re-measured in both themes (§3, §3b). **Two entries the first pass left open are now stale and are corrected here:** the active `Segmented` option (`components/ui/Controls.tsx:106`) and the active plan button (`components/billing/PricingTable.tsx`) both read `--q-violet-strong` today, so neither is a white-on-`--q-violet` surface any more. Still genuinely failing: **`.section-label`** (`app/globals.css`, `@apply text-q-violet` at 11 px bold, i.e. normal text for 1.4.3) measures **4.36:1 on `--surface-2` and 3.93:1 on `--surface-3` in the dark theme** — it clears on `--bg` (5.01) and `--surface` (4.73), and the light theme is clear everywhere (7.88 / 8.36 / 7.54 / 6.82). Re-measured this pass. The fix is one line — point `.section-label` at `--q-violet-text`, which is 8.79:1 on `--surface-3` — but `app/globals.css` is owned by another workstream and was deliberately not touched. |
| *(no other AA failure is currently open)* | The exam countdown (finding 7, 4.1.3) and review-mode option buttons (finding 18, 2.1.1) were fixed in the first pass; the 18 findings of the second pass are all fixed. |

### Untested

* **Screen readers.** Nothing here was tested with NVDA, JAWS or VoiceOver. Every ARIA
  claim in this document is derived from the accessibility *tree*, which is necessary but
  not sufficient. Until a real screen-reader pass happens, treat the "fixed" statuses as
  "structurally correct", not "verified usable".
* **Zoom and reflow** (1.4.10 AA) — not tested at 400% / 320 px width. The circuit editor
  is inside `overflow-x-auto`, which is permitted, but the rest is unknown.
* **Text spacing** (1.4.12 AA) — untested.
* **Motion / vestibular safety beyond `prefers-reduced-motion`** — the double-slit and
  decoherence animations were not assessed against 2.3.3.
* **Voice control** (Dragon/Voice Access) — labels now largely match visible text, but
  the circuit wires are voice-addressable only as "Wire for qubit N", which is not visible
  text; 2.5.3 Label in Name is untested there.
* **40 of the 56 routes.** The suite now covers 16: the original 8 plus `/hardware`,
  `/insights`, `/account`, `/circuits`, `/coach`, `/welcome`, `/offline` and `/learn`.
  Still unaudited: **`/admin`, `/instructor`, `/learn/[slug]` and `/challenges/[id]`** —
  `components/admin/**`, `components/instructor/**` and `components/lesson/**` are owned by
  other workstreams and were deliberately not opened.
* **The job monitor's announcements** — fixed in code, no executing test. §5f.
* **Forms error handling** (3.3.1, 3.3.3) on the org-invite flow. The billing flows
  (checkout, portal, magic link) are now covered for 4.1.3 but **not** for 3.3.1's
  identify-the-field requirement; those forms have one field each, so the gap is narrow.
* **`aria-live` on a real screen reader.** Everything this pass added routes through
  `lib/a11y/announce.ts`, whose regions are asserted by reading their `textContent`. That
  proves the text was written to a correctly-configured region; it does not prove a screen
  reader spoke it.

---

## 7. Running the checks

```bash
cd apps/web
npm run build && npm run start &                 # or let Playwright's webServer do it
PW_CHROMIUM=/path/to/chrome npx playwright test a11y.spec.ts
```

**Result at the time of the original audit: 41 passed, 9 failed, 1 skipped.** The 9
failures were findings 9 and 14 above (7 × "has exactly one main landmark", 2 × "has no
skipped heading levels"); the 1 skip was the skip-link test, `test.fixme` until
`layout.tsx` mounted `<SkipLink />`.

**Since then, the skip link was mounted, the nested `<main>`s were fixed, and the two
heading skips were fixed** (§5a, §5e). Those 50 tests (8 routes × 5 structural checks, the
palette test, the skip-link test, and 8 landmark-count checks) were re-run in Chromium
during the pass that fixed findings 5, 7, 18 and §5c: **50 passed**.

That pass added three more, one per fix, bringing `a11y.spec.ts` to **53**:

* `the exam countdown is silent per second but announces time thresholds` — asserts the
  clock is not a live region and its digits are `aria-hidden`, rewinds the stored
  attempt's `startedAt` to 10 minutes remaining and waits for the polite region to say so,
  then asserts three further seconds of ticking do **not** change that text, then rewinds
  to 2 seconds and waits for the assertive "Time is up…".
* `review-mode exam options stay focusable and state their verdict in text` — sits a
  paper, submits it, and asserts every reviewed option can take focus, is
  `aria-disabled="true"` rather than `disabled`, and spells its verdict out in text.
* `the circuit editor is a single tab stop with an arrow-key grid cursor` — asserts
  exactly one tabbable element inside the SVG, then drives the cursor with
  Arrow/Home/Enter/Delete and checks the focused cell's label and the gate count.

SECOND PASS. `a11y.spec.ts` now holds **16 routes × 5 structural checks (80)** plus 16
landmark-count checks, the palette test, the skip-link test, the three tests above, and
**11 new ones** (10 executing, 1 `test.fixme`). Every one of the 10 was run against the
build that shipped before its fix and **failed there**, each for its own reason and not
merely on a missing selector:

| New test | Pre-fix failure, as reported by Playwright |
|---|---|
| `the hardware upgrade overlay is inert, not merely aria-hidden` | `the blurred subtree must be inert` — expected `true`, received `false`; 9 focusables inside `[aria-hidden]` |
| `the paywall announces why the content stopped` | polite region was `""` |
| `unavailable hardware devices stay reachable and the radiogroup roves` | `` `disabled` removes the explanation from the keyboard entirely `` — expected `false`, received `true` |
| `the hardware cost estimate is announced when it settles` | polite region was `""` while `$0.60` was on screen |
| `the circuit delete confirm changes its accessible name and says so` | `arming a destructive confirm must change the accessible name` — element not found |
| `the analytics switch name contains its visible label` | expected name to contain `"analytics on"`, received `"record analytics in this browser"` |
| `generating sample analytics announces that the dashboard filled in` | polite region was `""` |
| `focused links inside the skill map are not visually clipped` | 10 clipped-but-focusable links listed by name |
| `a checkout outcome is announced, not just rendered` | no `[role=status]`/`[role=alert]` matched |
| `choosing a coach goal announces the re-ranked recommendation` | polite region was `""` |

The eight newly-added routes passed all five structural checks on the pre-fix build too,
which is worth stating plainly: they are regression guards, not fixes, and they are
labelled as such in the file.

Three tests unrelated to this pass fail against the container's currently-running server —
`command palette exposes a correct combobox/listbox relationship`, `the exam countdown…`
and `review-mode exam options…`. They fail on missing preconditions (the palette dialog
does not open on Ctrl+K, `role="timer"` is absent on `/certify/foundations-cert`) in a
server that predates the fixes those tests were written for. They are in
`components/search`, `components/exam` and `app/certify`, were not modified by this pass,
and need a rebuild before the result means anything.

The first pass's three were likewise run against the *pre-fix* build first and all three
failed there — on
`aria-hidden` digits, on a `disabled` option that cannot take focus, and on two tab stops
inside the SVG — which is what makes them regression tests rather than decoration. They
need a rebuild to pass, since the dev server serves the last build.

Do not weaken these assertions to get a green run. A failing assertion that documents a
real barrier is the point.

### Regressions

`npx vitest run` currently reports **88 passed across 3 files**: `lib/quantum.test.ts` (66,
unchanged since this audit), `lib/orgs/access.test.ts` (16) and `lib/authFetch.test.ts`
(6). The latter two were added by the later security pass (see `docs/SECURITY.md`), not by
this accessibility work — recorded here only so the "66 passed" number in the original
audit is not read as still current. `npm run build` was not re-run as part of writing this
correction (out of scope for a docs-only pass); the e2e regression comparison described in
the original audit (`placeGate` locator collisions, an ambiguous "6 qubits"/"16 qubits"
name match, a `Search` trigger locator) has not been re-verified either and should be
treated as historical.

One a11y improvement was deliberately **reverted**: promoting the first cell of
`HistogramTable` rows to `<th scope="row">` is correct markup, but
`tests/e2e/simulator.spec.ts` selects `tbody tr td:first-child`. The cell is left as
`<td>` with a comment; the column `scope="col"` headers and the new `<caption>` remain.
