/**
 * pages.spec.ts — what routes.spec.ts does not cover.
 *
 * The status/h1/console smoke pass that used to live here now runs over EVERY
 * route in routes.spec.ts, so only the visualization-specific assertion is left:
 * each simulation page must actually mount its canvas, which is the one thing a
 * text-level smoke test cannot see.
 *
 * The route list is DERIVED, not written out. It used to be a hand-kept array
 * of eight paths, and it stayed at eight while the catalogue grew to twenty-
 * eight — twenty canvas-driven labs shipped with nothing checking that their
 * canvas ever appeared, because every one of them was added by someone editing
 * their own page and their own unit tests. Reading `VISUALIZATIONS` the way
 * helpers.ts reads the lesson, challenge and exam catalogues means the next
 * visualization is covered the day it lands, by nobody.
 */

import { test, expect } from '@playwright/test'

import { VISUALIZATIONS } from '../../lib/visualizations'
import { gotoClean } from './helpers'

const VIZ_ROUTES: string[] = VISUALIZATIONS.map((viz) => viz.href)

test('the catalogue is not empty', () => {
  // A derived list can fail open: an import that resolves to `[]` would make
  // every check below silently vanish rather than fail.
  expect(VIZ_ROUTES.length).toBeGreaterThanOrEqual(28)
})

for (const route of VIZ_ROUTES) {
  test(`${route} mounts a canvas`, async ({ page }) => {
    await gotoClean(page, route)
    // Some labs (the Bloch sphere, the hydrogen atom) load three.js behind a
    // skeleton after hydration, so the canvas is not in the first paint.
    await expect(page.locator('canvas').first()).toBeAttached({ timeout: 15000 })
  })
}
