# Responsive — the product on a phone and a tablet

Quantum Lab was built, reviewed and tested exclusively at desktop width. Nothing
in the Playwright suite set a mobile viewport until `tests/e2e/mobile.spec.ts`
existed. This document records what that turned out to hide, what was fixed,
what is still open, and the rules a future change has to keep.

Every measurement below was taken with Playwright against a production build at
`390x844` (iPhone 12/13/14 logical viewport) and `820x1180` (iPad Air). Numbers
in this file are measured, not estimated. Re-measure before quoting them.

---

## 1. The breakpoints this app actually uses

Tailwind defaults, unchanged:

| Prefix | Min width | What it means here |
| --- | --- | --- |
| (none) | 0 | Phone. One column. |
| `sm` | 640px | Large phone landscape. Gutters relax to 24px. |
| `md` | 768px | Small tablet. The ⌘K hint appears in the search trigger. |
| `lg` | 1024px | Two-column page layouts (`lg:grid-cols-[1fr_300px]`) turn on. |
| `xl` | 1280px | **The nav switches from drawer + bottom tab bar to the inline bar.** Measured: the bar needs ~1,130px, so at 1024px (iPad landscape, common laptops) it overflowed the page by 106px and clipped the CTA. |

`xl` is the load-bearing one for navigation and `lg` for page layout. A 820px
tablet is on the *phone* side of both: it gets the drawer, the tab bar and the
single-column layout. That is deliberate — at 820px the
six primary links plus "More" measured 603px of the 820px bar, which left the
header with no room for the logo and the search trigger.

---

## 2. What was broken at 390x844, per route

Measured on the pre-change build. "Overflow" means an element whose right edge
was past `window.innerWidth`.

### Every route — the navigation

Five of the six primary links and the whole "More" menu sat between **x=308 and
x=911** on a 390px screen, inside a `overflow-x-auto` container with no
scrollbar and no other affordance. Only `/learn` was visible. So on a phone,
`/visualizations`, `/simulator`, `/challenges`, `/tutor`, `/pricing` and all
nine "More" destinations were reachable only by discovering that an
unmarked strip scrolled sideways.

At 820x1180 the same five links were still off the right edge.

**Fixed** — `components/ui/SiteNav.tsx`. The inline bar is now `hidden lg:flex`.
Below `lg` there is a 44x44 toggle on the right-hand edge (thumb side) opening a
full-width drawer that lists all fifteen destinations as ≥44px rows, PRIMARY
first then MORE under a heading. Dismissible by the toggle, by Escape, by a
press outside the header, and automatically on route change.

There is deliberately **no** "tap outside to dismiss" at 390px: the drawer's
`max-height` is `calc(100dvh - 3.5rem)`, so at that size there is no outside.
The outside-press handler still matters at 820px, where fifteen rows leave the
lower half of the screen free.

### Every visualization route — the sliders

`components/ui/Controls.tsx` `Slider` was `h-1.5 w-full`: a **6px-tall hit box**.
That is the control behind the physics on all eight visualizations, the noise
control on `/simulator`, and several `components/viz/**` panels. Six pixels is
not grabbable with a finger.

**Fixed** — the `.slider` class in `app/globals.css` separates the hit box from
the painted track: the `<input>` is 44px tall (WCAG 2.5.5), pulled back into the
old visual rhythm with `margin-block: -12px`, while `::-webkit-slider-runnable-track`
/ `::-moz-range-track` keep the 6px hairline and the thumb goes to 22px.
Verified: the hit box measures 324x44 and a `touchscreen.tap()` at 80% of the
track moves θ from 0 to 2.58.

`touch-action: pan-y` on that 44px band is not decoration. Without it the band
swallows vertical swipes and a page with three stacked sliders cannot be
scrolled past.

### `/tutor` — the composer

`ChatPanel`'s form is `flex items-end gap-2` with a `flex-1` textarea. A flex
item's default `min-width: auto` resolves to its min-content width, and a
`<textarea>`'s min-content width is its `cols` default (~180px), so `flex-1`
could not shrink it. The composer measured wider than its card and the **Send
button was clipped by the card's edge** — the tutor could be typed into but not
submitted by tap.

**Fixed** — `min-w-0` on the textarea, `shrink-0` on Send. The textarea also
went `text-sm` → `text-base sm:text-sm`: iOS Safari zooms the whole page in when
a focused field's font-size is below 16px and does not zoom back out.

### `/simulator` — the circuit editor

Better than expected. The grid's cells are 52x48 CSS px (COL_W 52, ROW_H 56 less
8px of padding), already above 44, and the palette tiles are `h-11`. Placing and
removing gates by tap works.

Two touch problems were real:

- The SVG is wider than the viewport from about the sixth gate onwards
  (`46 + n*52 + 12` px against 342px of usable width), so a horizontal swipe is
  the normal way to read a circuit — and that swipe was running off the end of
  the scroller into the browser's back-navigation gesture. Fixed with
  `overscroll-x-contain`.
- The gate's remove badge is a hover affordance and a touch screen has no hover,
  so it is never seen. Tapping a placed gate still removes it, which is the same
  behaviour a click has; the status line and the empty state now say "tap"
  rather than "click".

The grid geometry constants were **not** changed. `tests/e2e/helpers.ts`
hardcodes all four of them (`GRID = { labelWidth: 46, rowHeight: 56, padTop: 18,
colWidth: 52 }`) to drive `placeGate`, and that coupling is deliberate and
documented there.

### `/coach` — the concept graph

`components/coach/SkillMap.tsx` draws an SVG measuring x=33 to x=673 inside a
390px viewport, with node paths (`gates-and-circuits`, `entanglement`, and
everything downstream of them) at x=388 and beyond simply off-screen. Unlike
the other routes in this section, the SVG's wrapper *was* already
`overflow-x-auto` — measuring it confirms the container genuinely scrolls
(`scrollWidth` 664 against `clientWidth` 348 at 390px) and that scrolling it
brings every node within the viewport, so the nodes were never actually
unreachable the way this file previously said. What was missing was any
**sign** that the map keeps going: `overflow-x-auto` with no scrollbar
styling looks, and often behaves, exactly like a hard clip on a touch device,
where the native scrollbar only appears mid-drag if it appears at all.

**Fixed** — a right-edge fade (`bg-gradient-to-l from-surface`) plus a
"Scroll for more →" pill, both `pointer-events-none` and both driven by a
`ResizeObserver`/`scroll` listener comparing `scrollWidth` against
`clientWidth + scrollLeft` rather than a fixed breakpoint, so they stay
correct if the graph grows past ten concepts and stay silent on desktop
widths where nothing is clipped. Each node's `<g>` also carries
`data-node-id` now, for `mobile.spec.ts` to address individually — scrolling
every node into view and checking its bounding box is the only way to catch
a *specific* node going unreachable, as opposed to the map merely looking
uninviting to scroll.

### Tap targets found under 44px

Fixed in files this workstream owns:

| Control | Was | Now |
| --- | --- | --- |
| `.btn` (every primary/ghost button) | 36px tall | `min-height: 44px` under `@media (pointer: coarse)` |
| `Controls.Segmented` option | 30px tall, 45px wide with six options | `min-h-[38px] min-w-[4.5rem]`, wraps to a second row |
| `Controls.Toggle` checkbox | 16px box, no row target | 20px box, `min-h-[44px]` label row |
| `ThemeToggle` option | 26px tall | `min-h-[40px]` + wrapper padding = 44px |
| `SaveLoadPanel` name/description inputs | 38px tall, 14px text | `min-h-[44px]`, 16px text below `sm` |
| `SaveLoadPanel` delete button | 24x28 | `min-h-[44px] min-w-[44px]` |

`.btn` is raised only under `pointer: coarse` on purpose. Raising it
unconditionally loosens every dense desktop toolbar in the app, and `coarse` is
the query that means "the primary input is a finger" — true on phones and
tablets, false for a mouse or trackpad.

### `Histogram`

The per-bar readout (exact count and percentage) was hover-only, so on a phone
it was unreachable — the only other source is `HistogramTable`, which not every
caller renders. It now also responds to `onPointerDown`, which covers mouse, pen
and touch. The tooltip is pinned to the near edge for the first and last bar
instead of centred, because a ~150px tooltip centred on an ~85px column at 390px
hung past the figure.

---

## 3. What is still broken and belongs to someone else

This section originally listed eight defects found at 390px, outside this
workstream's files. As of 2026-08-25 all eight have been fixed and verified —
kept below, marked fixed, rather than deleted, so nobody rediscovers one of
these as new.

- **`/pricing` — the comparison table.** ~~`min-w-[560px]` inside an
  `overflow-x-auto` wrapper with no affordance saying it scrolls.~~ **Fixed.**
  `components/billing/PricingTable.tsx` now measures real overflow
  (`scrollLeft`/`scrollWidth`/`clientWidth`, live via `ResizeObserver`) and
  shows an edge fade plus a "Scroll for more plans →" hint exactly while
  there is more to scroll to — same pattern as `/coach` below. Verified:
  `mobile.spec.ts`'s `/pricing does not scroll sideways` passes.
- **`/instructor` — the task tab row overflows the document.** ~~Measured
  `scrollWidth` 420 against a 390px viewport.~~ **Already fixed as a side
  effect of an unrelated change, confirmed 2026-08-25.** The "task tab row" is
  `Controls.Segmented`, rendered by `CoPilotPanel.tsx`; `Segmented`'s option
  row went `flex flex-wrap` with `min-w-[4.5rem] flex-1` per button in Phase
  10 to fix the same overflow on the Bloch-sphere preset row, and
  `CoPilotPanel` inherited the fix automatically. Re-measured directly against
  a production build at both the Cohort and Co-pilot tabs: `scrollWidth 390`,
  zero overflow, in every state tried (published assignment, expanded learner
  list, all five tasks selected). `/instructor` is now in `OVERFLOW_ROUTES` in
  `mobile.spec.ts` so this can't quietly regress unnoticed again.
- **The search trigger is a 34x30 tap target** below `sm`. ~~Below the WCAG
  2.5.5 minimum.~~ **Fixed.** `components/search/SearchTrigger.tsx` is now
  `min-h-11 min-w-11` (44×44px) below `sm`, reset once the "Search" label
  reappears.
- **`components/viz/BlochSphere.tsx` said "Drag to rotate the view. Scroll to
  zoom."** on a touch screen, where neither verb exists. **Fixed.** Copy now
  reads "Drag to rotate the view. On a mouse or trackpad, scroll to zoom." —
  real pinch-to-zoom would mean adding multi-pointer distance tracking to the
  hand-rolled pointer handlers (there is no `OrbitControls` here to hook), so
  the fix was the honest copy rather than a larger three.js change. The
  identical copy and camera code were found in `components/viz/DecoherenceLab.tsx`
  too and fixed the same way; no other `components/viz/**` file matched the
  pointer-only wording.
- **`components/viz/BlochSphere.tsx` clipped its axis labels at 390px** — the
  `|+⟩` label was half off the canvas's left edge. **Fixed.** `placeCamera()`
  positioned the camera using a fixed radius independent of aspect ratio, so
  below aspect 1 the horizontal FOV was tighter than vertical even with
  everything fitting top-to-bottom; it now scales the effective camera
  distance by `1/aspect` when `aspect < 1`, and is now actually called from
  `resize()` (it previously wasn't, so an aspect-ratio change never
  re-positioned the camera at all). Same fix applied to `DecoherenceLab.tsx`.
- **`app/tutor/page.tsx` pinned the chat panel to `h-[600px]`** at every
  width, eating most of an 844px-tall phone screen for a panel that's usually
  empty. **Fixed.** Now `h-[min(50vh,600px)] min-h-[320px] sm:h-[600px]` —
  scales with viewport height below `sm`, floored at 320px, reverts to the
  fixed 600px once there's room for it.
- **`/coach` — the concept graph.** The SVG measures roughly x=33 to x=673
  inside a 390px viewport. This bullet originally said the wrapper was *not*
  a scroll container and the off-screen nodes were unreachable — re-measured
  directly in a real Chromium browser and that half was stale: the wrapper
  has been `overflow-x-auto` since the component's first commit
  (`scrollWidth` 664 vs `clientWidth` 348 at 390px), and every node is fully
  reachable by scrolling to it. What was real: nothing on screen signalled
  that the map kept going, which reads exactly like a hard clip on a touch
  device where the native scrollbar barely shows. **Fixed** — a right-edge
  fade plus a "Scroll for more →" pill, both driven by comparing
  `scrollWidth` against `clientWidth + scrollLeft` rather than a fixed
  breakpoint, so it stays correct if the graph grows and stays silent on
  desktop. Each node's `<g>` now carries `data-node-id` so `mobile.spec.ts`
  can scroll every node into view individually and assert it lands inside the
  viewport, rather than merely asserting the map "looks scrollable."
- **`/certify/[examId]` never left "Preparing your paper…"** — previously observed in an earlier
  environment, at desktop width as well as phone width, with three e2e test failures. Not a
  responsive defect; noted so nobody attributes it to this workstream.
  **Re-verified 2026-08-25: fixed.** `tests/e2e/exam.spec.ts` (`chromium` project, desktop
  viewport) — all 6 tests pass: starts a paper with a running clock, answers persist across a
  mid-exam reload, submitting produces a score and per-question review, a graded attempt isn't
  handed back as unfinished, an anonymous pass is graded but not certified, and a fabricated
  certificate number doesn't verify. No hang on "Preparing your paper…" occurred. The server-side
  move (`lib/exams/service.ts`, `lib/exams/store.ts`, `supabase/schema-exams.sql`) and the store's
  in-process `Map` fallback when `SUPABASE_SERVICE_ROLE_KEY` is unset did resolve the original
  cause. **Phone-width coverage added 2026-08-25**: `/certify/[examId]` now has a dedicated case
  in `mobile.spec.ts`'s `mobile` project (see §4) — the gap noted here on the first re-verify pass
  is closed.

Nothing is currently tracked as open in this section. A new defect found at
390px goes here as a fresh bullet, not folded into one of the fixed ones above.

---

## 4. The regression net

`apps/web/tests/e2e/mobile.spec.ts`, run by the **`mobile`** project in
`playwright.config.ts` at 390x844 with `hasTouch: true`. The `chromium` project
carries `testIgnore: '**/mobile.spec.ts'` so the file runs once, at the width it
asserts about.

`hasTouch` is the point of the project, not the width: it makes `.tap()`
dispatch real touch events, which is how a control that responds to hover and
nothing else gets caught. The engine stays Chromium — CI installs no other
browser, and `devices['iPhone 13']` would swap only the user-agent string, not
the rendering engine, so it would be a WebKit claim the suite cannot back.

21 tests: nav reachability and dismissal, the ⌘K palette's dismissal at phone
width, twelve routes asserted not to scroll sideways, the slider's hit box and
its response to a real tap, gate placement and removal by tap, the tutor
composer's geometry and font-size, and four assertions that the existing
accessibility work (skip link, landmarks, seeded-progress rendering) survives
the reflow.

**These tests were checked against a reverted build.** Putting the nav bar back
to `flex overflow-x-auto`, the slider back to `h-1.5`, and the textarea back to
`flex-1` without `min-w-0` fails exactly three of them and no others. A test
that would still pass with its feature deleted is worse than no test, so this
check is part of maintaining the file: if you add a test here, revert the fix and
watch it go red before you commit.

### One caveat about `gotoClean`

`mobile.spec.ts` does not use `gotoClean` from `tests/e2e/helpers.ts`, and that
is deliberate. `waitForHydration` there waits on the search trigger's ⌘K hint,
which is `md:block` — below 768px it is `display: none`, so it is absent from the
accessibility tree, the locator never matches, and every navigation burns the
full 15s timeout and then continues **without** the guarantee it exists to give.

Measured on this build: `gotoClean('/')` takes **340ms at 1280px and 15,266ms at
390px**.

`SiteNav` now sets `data-nav-ready="true"` from a `useEffect`. That attribute is
width-independent, so it is a correct hydration signal at any viewport, and
`mobile.spec.ts` waits on it. `helpers.ts` belongs to another workstream; when it
adopts the same attribute, `gotoMobile` should collapse back into `gotoClean`.

---

## 5. Rules for a future change

1. **Do not put nav links back in the header bar below `lg`.** The
   `hidden lg:flex` on that container is the fix. If it goes, the links go
   off-screen again and `mobile.spec.ts` will say so.
2. **Do not put a `height` back on the range input.** Set the track height
   instead. The input's height *is* the hit box.
3. **Do not remove `min-w-0` from a flex child that is a form control.** A
   textarea or input in a flex row will not shrink without it.
4. **No hardcoded colours.** Everything above is layout and sizing. Read
   `docs/THEMING.md` before touching a colour; the visualizations read
   `--q-violet`, `--q-teal` and `--q-amber` at runtime.
5. **Do not regress the accessibility work while reflowing** — the skip link,
   the landmarks, the circuit grid's roving tabindex, the announced exam timer.
   `mobile.spec.ts` and `a11y.spec.ts` both cover parts of it; neither covers all
   of it.
6. **A control that needs a pointer needs a touch alternative, not a caveat.**
   The Histogram tooltip is the pattern: keep the hover behaviour, add a
   pointer-event path that works without one.
7. **Measure before you write a number in a comment.** Every figure in this file
   came out of a Playwright run against a production build.


---

## 6. Phone-app pass (2026-10-04) — what the old checks could not see

Shipping the site inside the iOS and Android apps (`IOS.md`, `ANDROID.md`) meant
re-testing every route at phone size. That found something the suite above had
been missing since it was written.

### The overflow check was blind

Every overflow test in this repo measured `scrollWidth - innerWidth`. On a
mobile-emulated page, when content is wider than the screen the browser **widens
the layout viewport to fit it**, so `innerWidth` grows with the overflow and the
difference reads `0` for a page that is in fact sliding sideways (and, on a real
phone, zoomed out). `tests/e2e/responsive-matrix.spec.ts` compares against the
**nominal** screen width instead and names the deepest offending element.

Run against the whole derived route list at
six sizes (320, 360, 390, 430, 768, 1024), it found **41 routes wider than the
screen**, including `/simulator`, `/educators`, `/welcome` and all 26
`/challenges/[id]` pages. Causes, all fixed:

| Cause | Fix |
|---|---|
| 70 `grid … lg:grid-cols-[…]` containers with no base column: the implicit track grows to its widest child | `grid-cols-1` base on every one (scripted) |
| 24 breakpoint tracks written `1fr`, which is `minmax(auto,1fr)` and will not shrink below content | `minmax(0,1fr)` |
| Tailwind `sr-only` (position:absolute) inside a table cell escapes the scroller's clipping and widens the document | `.overflow-x-auto { position: relative }` in `globals.css` |
| Unbreakable inline `code` (file paths) in prose | `:not(pre) > code { overflow-wrap: anywhere }` |
| shadcn `Button` was `whitespace-nowrap` with a fixed height | wraps below `sm`, `min-h-*` |
| Stat tiles, a `<select>`, a CTA row without `flex-wrap` | wrap / `w-full` |

### Navigation and controls

* `MobileTabBar` (Learn / Visualize / Simulate / Tutor / More) below `xl`.
  `--mobile-nav-h` reserves its height (plus the home-indicator inset) on `body`
  and offsets every bottom-fixed element: install card, offline banner, toasts.
  It hides while a text field is focused, so it never eats the keyboard's space.
* `viewport-fit=cover` + `env(safe-area-inset-*)` on the header and tab bar.
* An in-app back chevron when running inside an app shell (`lib/app-shell.ts`).
* `touch-action: manipulation` on controls; no tap flash; pinch-zoom untouched.

### Rules added

8. **Never measure overflow against `innerWidth` on a mobile-emulated page.** Use
   the nominal width. `responsive-matrix.spec.ts` is the reference.
9. **A `grid` that declares columns only at a breakpoint needs `grid-cols-1`
   below it, and its `fr` tracks must be `minmax(0,…)`.**
10. **Anything fixed to the bottom edge must offset by `var(--mobile-nav-h)`.**

### Not covered

Chromium only (plus one pass in real Android Chrome). No WebKit run: iOS Safari
specifics (`100vh`, real notch insets) need a device or the Xcode simulator.
`/simulator` on a phone still lists the full gate palette before the circuit; a
sticky gate strip would be better and is a redesign, not a fix.
