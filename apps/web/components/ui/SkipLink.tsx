/**
 * "Skip to main content" — the first thing in the tab order.
 *
 * Every page in Qubit16 starts with the same sticky header: a logo, a
 * search trigger, six primary nav links and a "More" menu. That is nine or ten
 * stops a keyboard or screen-reader user pays on EVERY page before reaching the
 * thing they came for. WCAG 2.4.1 (Bypass Blocks, Level A) asks for a way past
 * it; this is that way.
 *
 * ── MOUNTING (required — this component does nothing until it is mounted) ────
 *
 * app/layout.tsx is owned by another workstream, so this audit could not wire
 * it up. Two edits are needed there, and the accompanying e2e test
 * (tests/e2e/a11y.spec.ts, "skip link" block) fails until both land:
 *
 *   1. Render <SkipLink /> as the FIRST child of <body>, above <SiteNav />:
 *
 *        <body className="min-h-screen bg-bg text-ink">
 *          <SkipLink />
 *          <SiteNav />
 *          ...
 *
 *      First in the DOM is what makes it first in the tab order. Rendering it
 *      after the nav technically satisfies nothing.
 *
 *   2. Give the existing <main> the id and make it focusable:
 *
 *        <main id="main" tabIndex={-1}>{children}</main>
 *
 *      `tabIndex={-1}` is not optional. Without it several browsers move the
 *      *scroll* position to #main but leave focus on the link, so the next Tab
 *      goes back into the nav and the skip link achieves nothing.
 *
 * Some pages also render their own <main> inside the layout's <main> (see
 * app/simulator/page.tsx). Nested main landmarks are a separate finding, logged
 * in docs/ACCESSIBILITY.md; it does not block this link from working.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      // Off-screen until it takes focus, then a real, visible, high-contrast
      // control in the top-left. `sr-only` + `focus:not-sr-only` is the pair
      // that keeps it in the a11y tree the whole time (display:none would not).
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                 focus:rounded-lg focus:border focus:border-line-strong focus:bg-surface-3
                 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink
                 focus:outline-none focus:ring-2 focus:ring-q-violet focus:ring-offset-2
                 focus:ring-offset-bg"
    >
      Skip to main content
    </a>
  )
}

export default SkipLink
