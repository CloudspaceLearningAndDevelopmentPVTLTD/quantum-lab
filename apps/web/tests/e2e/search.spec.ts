/**
 * search.spec.ts — the ⌘K command palette.
 *
 * Ranking is unit-tested; what is not, and what breaks in practice, is the
 * wiring: the global shortcut, the arrow-key + Enter navigation, focus
 * restoration on Escape, and the "/" shortcut knowing not to fire while the
 * user is typing into a field. That last one is a real regression risk — the
 * simulator has a QASM textarea full of slashes.
 */

import { test, expect, type Page } from '@playwright/test'

import { expectNoConsoleErrors, gotoClean } from './helpers'

const palette = (page: Page) => page.getByRole('dialog', { name: /search qubit16/i })
const searchInput = (page: Page) => page.getByRole('combobox', { name: /search qubit16/i })
const options = (page: Page) => palette(page).getByRole('option')
// The trigger's accessible name picks up its keyboard hint after mount, so it
// reads "Search Ctrl K" (or "Search ⌘K") rather than plain "Search".
const trigger = (page: Page) => page.getByRole('button', { name: /^Search\b/ }).first()

async function openWithShortcut(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(palette(page)).toBeVisible()
  await expect(searchInput(page)).toBeFocused()
}

/**
 * Title of the nth result row. Each row renders an icon, the title, a subtitle
 * and (sometimes) a level pill on separate lines; the first line carrying
 * letters is the title.
 */
async function optionTitle(page: Page, index = 0): Promise<string> {
  const lines = (await options(page).nth(index).innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\p{L}/u.test(line))
  return lines[0] ?? ''
}

test.describe('command palette', () => {
  test('Control+K opens it and Escape returns focus to the trigger', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    await gotoClean(page, '/')

    await expect(palette(page)).toBeHidden()

    // Focus the trigger first so there is a defined element to return focus to.
    await trigger(page).click()
    await expect(palette(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()
    await expect(trigger(page)).toBeFocused()

    console_.assertClean('/')
  })

  test('"barrier" ranks the tunneling material first', async ({ page }) => {
    await gotoClean(page, '/')
    await openWithShortcut(page)

    await searchInput(page).fill('barrier')
    await expect(options(page).first()).toBeVisible()

    const top = await optionTitle(page)
    expect(top, `top result for "barrier" was "${top}"`).toMatch(/tunnel/i)
  })

  test('"bs" ranks the Bloch Sphere first', async ({ page }) => {
    await gotoClean(page, '/')
    await openWithShortcut(page)

    await searchInput(page).fill('bs')
    await expect(options(page).first()).toBeVisible()

    const top = await optionTitle(page)
    expect(top, `top result for "bs" was "${top}"`).toMatch(/bloch sphere/i)
  })

  test('ArrowDown then Enter opens the second result', async ({ page }) => {
    await gotoClean(page, '/')
    await openWithShortcut(page)

    await searchInput(page).fill('entanglement')
    await expect(options(page).nth(1)).toBeVisible()

    const second = await optionTitle(page, 1)

    await page.keyboard.press('ArrowDown')
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'false')

    await page.keyboard.press('Enter')

    await expect(palette(page)).toBeHidden()
    await expect(page).not.toHaveURL(/localhost:\d+\/$/)

    // Whatever it navigated to, it must be the row that was highlighted: the
    // destination's h1 or <title> has to carry that row's title.
    const rowTitle = second
    const heading = await page.getByRole('heading', { level: 1 }).first().innerText()
    const landed = `${heading} ${await page.title()}`.toLowerCase()
    expect(landed, `Enter on "${rowTitle}" landed on "${heading}"`).toContain(
      rowTitle.toLowerCase(),
    )
  })

  test('"/" opens the palette, but not while typing in a textarea', async ({ page }) => {
    await gotoClean(page, '/simulator')

    // Positive control: "/" is a shortcut when focus is not in a field.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('/')
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()

    // The regression: typing "/" into the QASM import box must stay in the box.
    const textarea = page.getByLabel(/openqasm source to import/i)
    await textarea.click()
    await textarea.fill('// a comment')
    await textarea.press('/')

    await expect(palette(page)).toBeHidden()
    await expect(textarea).toHaveValue('// a comment/')
    await expect(textarea).toBeFocused()
  })

  test('"/" does not fire while typing in a text input either', async ({ page }) => {
    await gotoClean(page, '/simulator')

    const nameField = page.getByLabel(/circuit name/i)
    await nameField.click()
    await nameField.press('/')

    await expect(palette(page)).toBeHidden()
    await expect(nameField).toHaveValue('/')
  })
})
