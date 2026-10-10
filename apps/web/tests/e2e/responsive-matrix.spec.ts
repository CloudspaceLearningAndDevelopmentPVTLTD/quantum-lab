/**
 * responsive-matrix.spec.ts — every route, at the sizes people actually own.
 *
 * mobile.spec.ts proves specific journeys at 390x844. This file proves the
 * broad claim underneath them: that NO route, at any common phone or tablet
 * size, spills sideways or hides its last row under the bottom tab bar. The
 * route list is derived (helpers.ALL_ROUTES), so a page added next month is
 * covered the day it lands.
 *
 * Run by the `mobile` project (touch on, mobile viewport meta handling on); the
 * size is overridden per describe block below.
 */

import { test, expect, type Page } from '@playwright/test'

import { ALL_ROUTES } from './helpers'

/** [width, height, label]. 320 is the iPhone SE 1st-gen / smallest Android floor. */
const SIZES: [number, number, string][] = [
  [320, 568, 'small phone (iPhone SE 1)'],
  [360, 740, 'common Android'],
  [390, 844, 'iPhone 12-15'],
  [430, 932, 'iPhone Pro Max'],
  [768, 1024, 'iPad portrait'],
  [1024, 768, 'iPad landscape'],
]

/** Routes whose chrome is intentionally absent (an iframe widget). */
const NO_CHROME = new Set(['/embed/circuit'])

async function open(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await page
    .locator('header[data-nav-ready="true"], [data-ql-embed]')
    .first()
    .waitFor({ state: 'attached' })
}

/**
 * The DEEPEST elements poking past the right edge and not inside their own
 * horizontal scroller — i.e. the cause, not the chain of ancestors it drags
 * wider. The fixed tab bar is skipped: it is stretched BY the overflow (it is
 * sized to the expanded layout viewport), so it is a symptom.
 */
async function offenders(page: Page, vw: number): Promise<string[]> {
  return page.evaluate((vw) => {
    const scrollsX = (el: Element | null): boolean => {
      // Start at the PARENT: a scroller that is itself wider than the screen is
      // the bug, not an excuse.
      for (let n = el?.parentElement ?? null; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
      }
      return false
    }
    const over = new Set<Element>()
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('[data-mobile-tabbar]')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1 && !scrollsX(el)) over.add(el)
    }
    const out: string[] = []
    for (const el of over) {
      if (Array.from(el.children).some((c) => over.has(c))) continue // a descendant is the cause
      const r = el.getBoundingClientRect()
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 6).join('.')
      const txt = (el.textContent ?? '').trim().slice(0, 30).replace(/\s+/g, ' ')
      out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} [w=${Math.round(r.width)} right=${Math.round(r.right)}] "${txt}"`)
      if (out.length >= 6) break
    }
    return out
  }, vw)
}

for (const [width, height, label] of SIZES) {
  test.describe(`${width}x${height} — ${label}`, () => {
    test.use({ viewport: { width, height } })

    for (const route of ALL_ROUTES) {
      test(`${route} fits the screen`, async ({ page }) => {
        await open(page, route)

        // Measured against the NOMINAL screen width, not window.innerWidth. On a
        // mobile-emulated page whose content is wider than the screen, the
        // browser widens the layout viewport to fit it, so innerWidth grows with
        // the overflow and `scrollWidth - innerWidth` reads 0 for a page that is
        // in fact sliding sideways. (Every earlier overflow check in this repo
        // used that form and was blind to exactly this.)
        const overflow = await page.evaluate(
          (w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w,
          width,
        )
        if (overflow > 0) {
          const who = await offenders(page, width)
          expect(
            overflow,
            `${route} is ${overflow}px wider than ${width}px. Offenders: ${who.join(' | ')}`,
          ).toBeLessThanOrEqual(0)
        }

        if (NO_CHROME.has(route)) return

        const bar = page.locator('[data-mobile-tabbar]')
        if (width < 1280) {
          await expect(bar, 'bottom tab bar missing below xl').toBeVisible()
          const box = (await bar.boundingBox())!
          expect(box.y + box.height, 'tab bar is not flush with the bottom edge').toBeLessThanOrEqual(
            height + 1,
          )
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)

          // Scrolled to the very end, the last piece of content must sit ABOVE
          // the bar, not under it. Polled: pages that fetch after load (the
          // leaderboard) grow while we measure, and one scroll-then-read would
          // sample the page mid-growth.
          await expect
            .poll(
              async () => {
                await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
                return page.evaluate(() => {
                  const b = document.querySelector('[data-mobile-tabbar]')!.getBoundingClientRect()
                  const foot = document.querySelector('footer')?.getBoundingClientRect()
                  return foot ? b.top - foot.bottom : 0
                })
              },
              { message: 'footer is underneath the tab bar', timeout: 5000 },
            )
            .toBeGreaterThanOrEqual(-1)
        } else {
          await expect(bar).toBeHidden()
        }
      })
    }
  })
}

test.describe('tab bar behaviour', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the four tabs navigate, mark the current one, and More opens the full drawer', async ({
    page,
  }) => {
    await open(page, '/')
    const bar = page.getByRole('navigation', { name: 'Primary mobile' })

    for (const [name, url] of [
      ['Visualize', /\/visualizations$/],
      ['Simulate', /\/simulator$/],
      ['Tutor', /\/tutor$/],
      ['Learn', /\/learn$/],
    ] as const) {
      await bar.getByRole('link', { name }).tap()
      await expect(page).toHaveURL(url)
      await expect(bar.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      const box = (await bar.getByRole('link', { name }).boundingBox())!
      expect(box.height, `${name} tab is ${box.height}px tall`).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }

    const more = bar.getByRole('button', { name: 'More' })
    await more.tap()
    await expect(page.locator('#site-nav-drawer')).toBeVisible()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    // The last drawer row must be reachable above the bar, not under it.
    const lastLink = page.locator('#site-nav-drawer a').last()
    await lastLink.scrollIntoViewIfNeeded()
    const lb = (await lastLink.boundingBox())!
    const bb = (await bar.boundingBox())!
    expect(lb.y + lb.height, 'last drawer row is under the tab bar').toBeLessThanOrEqual(bb.y + 1)

    await more.tap()
    await expect(page.locator('#site-nav-drawer')).toHaveCount(0)
  })

  test('the bar steps aside while the keyboard is up, and returns after', async ({ page }) => {
    await open(page, '/tutor')
    const bar = page.locator('[data-mobile-tabbar]')
    await expect(bar).toBeVisible()
    await page.getByRole('textbox').first().focus()
    await expect(bar).toBeHidden()
    await page.getByRole('textbox').first().blur()
    await expect(bar).toBeVisible()
  })

  test('the embeddable widget renders no tab bar and reserves no space', async ({ page }) => {
    await open(page, '/embed/circuit')
    await expect(page.locator('[data-mobile-tabbar]')).toBeHidden()
    const pad = await page.evaluate(() => getComputedStyle(document.body).paddingBottom)
    expect(pad).toBe('0px')
  })

  test('viewport allows pinch-zoom and draws under the safe areas', async ({ page }) => {
    await open(page, '/')
    const meta = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(meta).toContain('viewport-fit=cover')
    // Disabling zoom is an accessibility failure and an App Store review flag.
    expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)/)
    expect(meta).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/)
  })
})
