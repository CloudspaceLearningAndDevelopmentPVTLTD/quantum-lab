import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'

import { gotoClean } from './helpers'

/**
 * Automated WCAG 2.1 A/AA checks, via axe-core.
 *
 * WHY THIS EXISTS ALONGSIDE a11y.spec.ts
 * --------------------------------------
 * a11y.spec.ts is hand-written and deliberately so: each of its assertions is
 * a barrier a human can read and argue with. It is NOT replaced by this file
 * and must not be deleted. What it cannot do is arithmetic — it has no way to
 * compute a contrast ratio for every rendered node on a page, which is exactly
 * the class of defect that kept slipping through. Its own header records the
 * reason it skipped axe ("no new dependency was allowed"); that constraint was
 * lifted, so the two now run side by side: hand-written checks for intent,
 * axe for the mechanical sweep.
 *
 * WHAT IT CAUGHT ON ITS FIRST RUN (all fixed in the same change)
 * --------------------------------------------------------------
 *   · /simulator, 14 nodes — the locked qubit buttons were `opacity-50`, which
 *     multiplied --ink-muted down to an effective 2.26:1. They are enabled,
 *     clickable buttons, so 1.4.3's exemption for inactive components did not
 *     apply to them.
 *   · /simulator, 7 nodes — the gate palette's unselected tiles were
 *     `opacity-70`, fading the gate LABEL to 3.95:1 on the rose, amber and sky
 *     tiles. Bold 13px is not WCAG "large text" (that starts at 14pt bold), so
 *     4.5:1 was required.
 *   · /simulator, 1 node — the circuit <svg> carried role="img", which makes
 *     the entire subtree presentational. That silently hid the role="grid"
 *     inside it and all of its focusable role="gridcell" rects, so the circuit
 *     editor was navigable by keyboard but announced nothing.
 *
 * Note the shape of the first two: BOTH were opacity applied to an enabled
 * control, and neither is visible to a human reading the class list, because
 * the failing colour is a product of three values in different files. That is
 * the argument for this file.
 *
 * SCOPE: WCAG 2.1 A and AA only. axe's `best-practice` rules are opinions, not
 * conformance, and failing a build on them trains people to relax assertions.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * One of each KIND of surface, not all 56 routes — the same principle
 * a11y.spec.ts's route list uses. A marketing page, a card index, the densest
 * interactive editor in the app, a canvas visualization, a chat UI, a pricing
 * table and a long-form lesson body between them exercise every component
 * family that renders text on a coloured ground.
 */
const ROUTES = [
  '/',
  '/visualizations',
  '/simulator',
  '/workbench',
  '/challenges',
  '/tutor',
  '/pricing',
  '/learn',
]

/**
 * BOTH THEMES, and this is the point of the parameterisation rather than
 * incidental thoroughness: the two palettes are independent sets of values
 * (lib/theme/tokens.ts), so a contrast pass in dark says nothing at all about
 * light. Several tokens differ by more than 4:1 between them.
 *
 * The theme is written to localStorage BEFORE the page loads, so ThemeScript
 * picks it up on its first parser-blocking run and the page renders in the
 * target theme from the very first paint. Toggling the <html> class after load
 * instead would measure mid-transition colours — the nav links carry
 * `transition-colors`, and axe would sample them part-way between palettes and
 * report ratios that belong to neither theme.
 */
async function pinTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('quantum-lab.theme', t)
    } catch {
      /* Safari private mode; ThemeScript tolerates this too. */
    }
  }, theme)
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`axe · ${theme}`, () => {
    for (const route of ROUTES) {
      test(`${route} has no WCAG A/AA violations (${theme})`, async ({ page }) => {
        await pinTheme(page, theme)
        await gotoClean(page, route)

        // gotoClean waits for hydration; the canvas-backed routes then need
        // their first frame before their text is on its final background.
        await page.waitForTimeout(600)

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

        /**
         * The failure message carries the ratio and the two colours, because
         * "1 violation" in a CI log is not actionable and the next person
         * should not have to re-run the browser to learn what broke.
         */
        const detail = results.violations
          .map((v) => {
            const nodes = v.nodes
              .slice(0, 6)
              .map((n) => `      ${n.target.join(' ')}\n        ${n.failureSummary?.replace(/\n/g, '\n        ')}`)
              .join('\n')
            const more = v.nodes.length > 6 ? `\n      …and ${v.nodes.length - 6} more` : ''
            return `  ${v.id} (${v.impact}, ${v.nodes.length} node(s)) — ${v.help}\n${nodes}${more}`
          })
          .join('\n\n')

        expect(results.violations, `${route} [${theme}]\n${detail}`).toEqual([])
      })
    }
  })
}
