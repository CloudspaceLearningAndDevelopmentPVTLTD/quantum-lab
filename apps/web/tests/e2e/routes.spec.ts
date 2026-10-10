/**
 * routes.spec.ts — the whole-surface smoke pass.
 *
 * Every route the app serves is checked for: a 200, exactly one <h1>, a
 * non-trivial amount of rendered text, and no unexpected console errors. Then,
 * separately, every route's <title> is collected and the set is checked for
 * duplicates — now that each route carries its own metadata, two routes sharing
 * a title means one of them silently lost its `generateMetadata`/`layout`.
 *
 * The route list is derived (see helpers.ALL_ROUTES), so a page added by anyone
 * is covered here the moment it lands.
 */

import { test, expect } from '@playwright/test'

import { ALL_ROUTES, expectNoConsoleErrors, gotoClean } from './helpers'

/** A page with less text than this is a shell, not a page. */
const MIN_TEXT_LENGTH = 200

test.describe('every route', () => {
  test('the derived route list is not empty and covers the known sections', () => {
    expect(ALL_ROUTES.length).toBeGreaterThan(40)
    for (const expected of ['/', '/learn', '/simulator', '/challenges', '/certify', '/pricing']) {
      expect(ALL_ROUTES, `${expected} missing from the derived route list`).toContain(expected)
    }
  })

  for (const route of ALL_ROUTES) {
    test(`${route} renders`, async ({ page }) => {
      const console_ = expectNoConsoleErrors(page)

      const response = await gotoClean(page, route)
      expect(response, `no response for ${route}`).not.toBeNull()
      expect(response!.status(), `${route} returned ${response!.status()}`).toBe(200)

      // Client-rendered shells (the exam runner, the account page) paint their
      // heading a tick after hydration, so wait for it rather than counting
      // immediately.
      const h1 = page.getByRole('heading', { level: 1 })
      await expect(h1.first()).toBeVisible()
      await expect(h1, `${route} should have exactly one h1`).toHaveCount(1)
      await expect(h1).not.toBeEmpty()

      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()
      expect(
        text.length,
        `${route} rendered only ${text.length} characters of text`,
      ).toBeGreaterThan(MIN_TEXT_LENGTH)

      console_.assertClean(route)
    })
  }
})

test.describe('metadata', () => {
  // One test, many navigations: the assertion is about the SET of titles, so it
  // cannot be split per route without sharing state between tests.
  test('every route has a distinct, non-empty <title>', async ({ page }) => {
    const byTitle = new Map<string, string[]>()

    for (const route of ALL_ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      const title = (await page.title()).trim()

      expect(title, `${route} has no <title>`).not.toBe('')

      const seen = byTitle.get(title) ?? []
      seen.push(route)
      byTitle.set(title, seen)
    }

    const duplicates = [...byTitle.entries()].filter(([, routes]) => routes.length > 1)
    const report = duplicates
      .map(([title, routes]) => `  "${title}" ← ${routes.join(', ')}`)
      .join('\n')

    expect(duplicates, `routes sharing a <title>:\n${report}`).toEqual([])
  })
})
