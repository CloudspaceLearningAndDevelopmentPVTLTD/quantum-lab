/**
 * onboarding.spec.ts — the first-run flow at /welcome, and the banner that is
 * the only thing pointing at it.
 *
 * Three things are worth an e2e test here and cannot be unit-tested:
 *   1. the guided circuit really does drive the real editor — place two gates,
 *      get a Bell pair — and it is the FIRST thing a visitor touches, before
 *      any question is asked;
 *   2. `/welcome` is reachable without typing the URL. It is linked from
 *      nowhere else in the product, so if the banner stops rendering the whole
 *      flow becomes dead code again;
 *   3. the banner's rules: it never appears on top of the flow it advertises,
 *      it reports real progress, and a dismissal is permanent.
 *
 * The arithmetic behind the progress counter is in lib/analytics/journey.test.ts.
 */

import { test, expect, type Page } from '@playwright/test'

import { PATHS } from '../../lib/onboarding/steps'
import { expectNoConsoleErrors, gotoClean, placeGate } from './helpers'

const DEVELOPER = PATHS.developer

const histogram = (page: Page) =>
  page.getByRole('img', { name: /measurement outcomes/i }).first()

const resumeBanner = (page: Page) => page.getByText(/pick up where you left off/i)
const inviteBanner = (page: Page) => page.getByText(/new here\?/i)

/** Outcome labels, read off the histogram's accessible description. */
async function outcomeLabels(page: Page): Promise<string[]> {
  const description = (await histogram(page).getAttribute('aria-label')) ?? ''
  const labels = [...description.matchAll(/(?:^|[:;] )([01]+) [\d,]+ shots/g)].map((m) => m[1])
  return [...new Set(labels)].sort()
}

/** Step 1: build and run the guided Bell pair. */
async function buildFirstCircuit(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /build something in sixty seconds/i })).toBeVisible()

  const run = page.getByRole('button', { name: /run 1,?024 shots/i })
  await expect(run, 'Run should be locked until both gates are placed').toBeDisabled()

  await placeGate(page, 'H', 0)
  await placeGate(page, 'CX', [0, 1])

  await expect(run).toBeEnabled()
  await run.click()
}

/** Step 2: choose the developer path, which also finishes the flow. */
async function chooseDeveloperPath(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /what brings you here\?/i })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(DEVELOPER.label, 'i') }).click()
}

/** The whole flow, start to "You're set". */
async function completeFlow(page: Page): Promise<void> {
  await buildFirstCircuit(page)
  await page.getByRole('button', { name: /^Continue$/ }).click()
  await chooseDeveloperPath(page)
  await expect(page.getByRole('heading', { name: /you.{1,3}re set/i })).toBeVisible()
}

test.describe('onboarding', () => {
  test('the circuit is the first screen, and it measures only 00 and 11', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    await gotoClean(page, '/welcome')

    // No question is asked before the payoff: landing here puts a visitor
    // straight into the editor. If a picker ever moves back in front of this,
    // this assertion is the thing that says so.
    await buildFirstCircuit(page)

    await expect(histogram(page)).toBeVisible()
    expect(await outcomeLabels(page)).toEqual(['00', '11'])

    // The axis agrees with the description, and the impossible outcomes are
    // genuinely absent rather than merely small.
    await expect(page.getByText('|00⟩')).toBeVisible()
    await expect(page.getByText('|11⟩')).toBeVisible()
    await expect(page.getByText('|01⟩')).toHaveCount(0)
    await expect(page.getByText('|10⟩')).toHaveCount(0)

    await expect(page.getByText(/that is a bell pair/i)).toBeVisible()

    console_.assertClean('/welcome')
  })

  test('completing the flow persists across a reload', async ({ page }) => {
    await gotoClean(page, '/welcome')
    await completeFlow(page)

    // The chosen path drives what is offered next.
    await expect(page.getByText(DEVELOPER.label, { exact: false }).first()).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /you.{1,3}ve already done this/i })).toBeVisible()
    await expect(page.getByText(/you built a bell pair here once already/i)).toBeVisible()

    // And "Start over" really does put the flow back at step 1 — the circuit.
    await page.getByRole('button', { name: /start over/i }).click()
    await expect(
      page.getByRole('heading', { name: /build something in sixty seconds/i })
    ).toBeVisible()
  })

  test('a first-time visitor is offered the flow from any page', async ({ page }) => {
    // /welcome is linked from nowhere else — not the nav, not the home page,
    // not the footer. This banner is the entire discovery path for it.
    await gotoClean(page, '/learn')
    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(inviteBanner(page)).toBeVisible()
    await page.getByRole('link', { name: /start here/i }).click()
    await expect(page).toHaveURL(/\/welcome$/)

    // And it does not advertise the flow on top of the flow.
    await expect(inviteBanner(page)).toHaveCount(0)
  })

  test('after the flow the banner reports real path progress', async ({ page }) => {
    await gotoClean(page, '/welcome')
    await completeFlow(page)

    await page.goto('/learn', { waitUntil: 'domcontentloaded' })

    // Finishing the three-screen welcome flow is not finishing the path: the
    // banner switches from "new here?" to the next step of the chosen path.
    await expect(resumeBanner(page)).toBeVisible()
    await expect(page.getByText(new RegExp(`of ${DEVELOPER.steps.length} done`))).toBeVisible()
    await expect(page.getByRole('link', { name: /continue/i }).first()).toBeVisible()
  })

  test('a dismissal is permanent', async ({ page }) => {
    await gotoClean(page, '/welcome')
    await completeFlow(page)

    await page.goto('/learn', { waitUntil: 'domcontentloaded' })
    await expect(resumeBanner(page)).toBeVisible()

    await page.getByRole('button', { name: /dismiss onboarding reminder permanently/i }).click()
    await expect(resumeBanner(page)).toHaveCount(0)

    // Permanent: a reload, and a different page, must both stay quiet.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(resumeBanner(page)).toHaveCount(0)
    await page.goto('/simulator', { waitUntil: 'domcontentloaded' })
    await expect(resumeBanner(page)).toHaveCount(0)
    await expect(inviteBanner(page)).toHaveCount(0)
  })
})
