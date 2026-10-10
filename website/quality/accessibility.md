# Accessibility & responsive

A control that a keyboard cannot reach or a page that scrolls sideways on a phone is a bug with the same priority as a wrong amplitude. Both are audited, both have regression tests, and both audits are kept as documents that list what was found, what was fixed, and what has not yet been checked.

## Accessibility: WCAG 2.2 AA

`docs/ACCESSIBILITY.md` records two audit passes with 38 numbered findings (3 blockers, 10 serious, 16 moderate, 9 minor), all but one fixed; the open one is a slider track that passes the target-size criterion only through the spacing exception. The method was manual code review, a Chromium keyboard walkthrough, contrast computed from the real design tokens, and a hand-written Playwright suite. Ten of the second-pass fixes have tests that were run against the pre-fix build and failed there.

The headline work:

- **The circuit editor is an ARIA grid.** The SVG carries `role="grid"` with `role="row"` per wire and `role="gridcell"` per position, each cell named ("Qubit 0, column 2, empty. Press Enter to place H as step 1."). One tab stop with a roving `tabindex`; arrows move, Home/End and Ctrl+Home/End jump, Enter or Space places or removes, Delete removes, Escape cancels a multi-qubit placement. Every mutation is spoken through a live region. Before this work the editor was a keyboard blocker.
- **Live announcements.** `lib/a11y/announce.ts` creates one polite and one assertive region on first use and re-sets text on the next frame to force re-announcement. The tutor's reply, undo and redo, the exam timer at 30, 15, 10, 5, 2 and 1 minutes, and the step inspector's before/after readout (debounced, because key repeat at 30 Hz would otherwise flood a screen reader) all go through it.
- **Contrast against real tokens.** `--ink-muted` was 2.31:1 and is now 5.59:1 dark and 5.61:1 light; the primary button fill is 6.33:1 in dark; the focus ring is 5.01:1 on the background. Locked qubit buttons used to be `opacity-50`, which multiplied muted text down to 2.26:1; they are now recessed by surface colour instead so the digit stays readable.
- **Structure.** A skip link is the first child of `body`, `<main id="main" tabIndex={-1}>` wraps every page, 19 nested `<main>` elements were removed, and the upgrade overlay uses a real `inert` subtree so a blurred page cannot be tabbed into.
- **Motion.** A `prefers-reduced-motion` block disables decorative animation, and the Q-sphere offers an SVG view before three.js is loaded.

What the audit says it has **not** done is as important as what it has: no NVDA, JAWS or VoiceOver session, no 400 % zoom and reflow check, no text-spacing check, and 40 of the routes were not walked by hand. The automated suite covers 16 routes structurally and every route through axe.

## Responsive: phones and tablets

`docs/RESPONSIVE.md` records the measurements behind the layout. The primary navigation bar needed 603 px of an 820 px tablet and 1,130 px of a 1,024 px laptop, so the inline bar appears only from `xl` (1,280 px); below that a drawer and a bottom tab bar take over. A six-width Playwright audit (320 to 1,024 px) found 41 routes wider than the viewport, which were fixed and turned into rules:

- A grid that declares columns only at a breakpoint needs a `grid-cols-1` base (70 containers fixed).
- `1fr` tracks become `minmax(0, 1fr)` so one long token cannot push the page sideways (24 fixed).
- Form text is `text-base sm:text-sm`: 16 px on phones so iOS does not zoom on focus.
- Tap targets are 44 px where the input is a finger (`pointer: coarse`), without loosening dense desktop layouts.
- Safe-area insets pad the header and the tab bar on notched devices.

The `responsive-matrix` spec now asserts no horizontal overflow and nothing hidden under the tab bar, at every width, on every route. The `mobile` project runs with touch emulation at 390×844 and covers the journeys that were broken on a phone: reaching the navigation, the slider hit box, placing a gate.

## Why these are regression suites

Both audits recorded fixes that had regressed once already: a hardcoded lesson count went stale, a nested `<main>` came back, a grid lost its single-column base. The tests exist so that the next change that breaks keyboard navigation or phone layout fails CI rather than waiting for a user to report it.
