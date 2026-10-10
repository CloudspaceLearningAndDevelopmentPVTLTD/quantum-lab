/**
 * challenges.spec.ts — building a solution in the circuit editor and having it
 * graded.
 *
 * "bell-pair" is the right challenge to pin down: it is two gates, one of them
 * multi-qubit (so the control-then-target placement flow is exercised), and its
 * grading is a plain distribution comparison, so a pass and a fail are both
 * unambiguous.
 */

import { test, expect, type Page } from '@playwright/test'

import { getChallenge } from '../../lib/challenges/catalogue'
import { expectNoConsoleErrors, gateGlyphCount, gotoClean, placeGate } from './helpers'

const BELL = getChallenge('bell-pair')!

const result = (page: Page) => page.locator('section[aria-live="polite"]').first()
const hintItems = (page: Page) =>
  page.getByRole('listitem').filter({ hasText: /^Hint \d+ of \d+/ })

/** H on q0, then CX with q0 as control and q1 as target — the Bell pair. */
async function buildBellPair(page: Page): Promise<void> {
  await placeGate(page, 'H', 0)
  expect(await gateGlyphCount(page), 'the H did not land on the wire').toBe(1)
  await placeGate(page, 'CX', [0, 1])
  expect(await gateGlyphCount(page), 'the CX did not land on the wires').toBe(2)
}

test.describe('challenges', () => {
  test('the index lists the catalogue and links into a challenge', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    await gotoClean(page, '/challenges')

    const link = page.getByRole('link', { name: new RegExp(BELL.title, 'i') }).first()
    await expect(link).toBeVisible()
    await link.click()

    await expect(page).toHaveURL(/\/challenges\/bell-pair$/)
    await expect(page.getByRole('heading', { level: 1, name: BELL.title })).toBeVisible()
    console_.assertClean('/challenges/bell-pair')
  })

  test('the correct circuit passes', async ({ page }) => {
    await gotoClean(page, '/challenges/bell-pair')
    await expect(page.getByRole('heading', { level: 1, name: BELL.title })).toBeVisible()

    await buildBellPair(page)
    await page.getByRole('button', { name: /check solution/i }).click()

    await expect(result(page)).toBeVisible()
    await expect(result(page).getByText('Solved', { exact: true })).toBeVisible()
    await expect(result(page).getByText(/Solved in 2 gates\./)).toBeVisible()
    await expect(result(page).getByText(BELL.successNote, { exact: false })).toBeVisible()

    // The header pill flips too — that is the bit that has to persist.
    await expect(page.getByText('solved', { exact: true })).toBeVisible()
  })

  test('a wrong circuit fails with an explanation of what is off', async ({ page }) => {
    await gotoClean(page, '/challenges/bell-pair')

    // X on q0 puts every shot on |01⟩ — right register, entirely wrong state.
    await placeGate(page, 'X', 0)
    await page.getByRole('button', { name: /check solution/i }).click()

    const verdict = result(page)
    await expect(verdict).toBeVisible()
    await expect(verdict.getByText(/Not there yet/)).toBeVisible()

    // Useful, not just "wrong": it must name the failing check and quantify it.
    const text = await verdict.innerText()
    expect(text).toContain('Output distribution')
    expect(text, 'the failure gives no numbers to act on').toMatch(/\d+(\.\d+)?%/)
    expect(text).not.toContain('Solved in')
  })

  test('hints reveal one at a time', async ({ page }) => {
    await gotoClean(page, '/challenges/bell-pair')

    const total = BELL.hints.length
    expect(total).toBeGreaterThan(1)

    await expect(hintItems(page)).toHaveCount(0)

    for (let shown = 1; shown <= total; shown += 1) {
      await page.getByRole('button', { name: `Hint ${shown} of ${total}` }).click()
      await expect(hintItems(page)).toHaveCount(shown)
      await expect(page.getByText(BELL.hints[shown - 1], { exact: false })).toBeVisible()
      // The hint after this one must still be hidden.
      if (shown < total) {
        await expect(page.getByText(BELL.hints[shown], { exact: false })).toHaveCount(0)
      }
    }

    await expect(page.getByRole('button', { name: `All ${total} hints shown` })).toBeDisabled()
  })

  test('a solved challenge stays solved across a reload', async ({ page }) => {
    await gotoClean(page, '/challenges/bell-pair')

    await buildBellPair(page)
    await page.getByRole('button', { name: /check solution/i }).click()
    await expect(result(page).getByText(/Solved in 2 gates\./)).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.getByText('solved', { exact: true })).toBeVisible()

    // And the index knows about it too.
    await page.goto('/challenges', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/^Solved 1 of \d+$/)).toBeVisible()
  })
})
