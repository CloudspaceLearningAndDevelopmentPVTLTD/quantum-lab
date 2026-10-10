/**
 * mobile.spec.ts — the critical journeys at a phone viewport.
 *
 * Nothing in this suite set a mobile viewport before this file existed, so a
 * circuit editor, eight canvas visualizations, a chat panel, a timed exam and a
 * pricing table shipped having been looked at only at desktop width. The
 * headline defect that found: at 390x844 five of the six primary nav links and
 * the whole "More" menu sat between x=308 and x=911 — inside a horizontal
 * scroller with no scrollbar and no other affordance. Everything except /learn
 * was unreachable on a phone.
 *
 * The viewport comes from the `mobile` project in playwright.config.ts, not
 * from `test.use` here, so `npx playwright test` runs these once at 390x844 and
 * the rest of the suite is unaffected. `hasTouch` is on: `.tap()` below
 * dispatches real touch events, which is the only way to catch a control that
 * responds to hover and nothing else.
 *
 * Every test here must fail if its fix is reverted. Where that is not obvious,
 * the assertion says what the pre-change measurement was.
 */

import { test, expect, type Page } from '@playwright/test'

import { CHALLENGE_IDS, expectNoConsoleErrors, LESSON_SLUGS, PROGRESS_KEY } from './helpers'
import { CONCEPT_GRAPH } from '../../lib/coach/graph'
import { getExam } from '../../lib/exams/catalogue'

/** WCAG 2.5.5 Target Size (Enhanced), and the iOS/Android guidance number. */
const MIN_TAP = 44

/**
 * Navigate with storage cleared, then block until client React has committed.
 *
 * This does NOT use `gotoClean` from helpers.ts, and that is deliberate rather
 * than sloppy. `waitForHydration` there waits on the search trigger's ⌘K hint,
 * which is `md:block` — below 768px it is display:none, so it is absent from
 * the accessibility tree, the locator never matches, and every navigation burns
 * the full 15s timeout and then continues WITHOUT the guarantee it exists to
 * give. Measured against this build: `gotoClean('/')` takes 340ms at 1280px and
 * 15,266ms at 390px.
 *
 * `data-nav-ready` is set from a `useEffect` in components/ui/SiteNav.tsx and is
 * width-independent, so it is a correct signal at any viewport. helpers.ts
 * belongs to another workstream; when it adopts this attribute, this function
 * should collapse back into `gotoClean`.
 */
async function gotoMobile(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  const dirty = await page
    .evaluate(() => {
      const count = window.localStorage.length + window.sessionStorage.length
      if (count > 0) {
        window.localStorage.clear()
        window.sessionStorage.clear()
      }
      return count
    })
    .catch(() => 0)

  if (dirty > 0) await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('header[data-nav-ready="true"]').waitFor({ state: 'attached' })
}

/** Widest element on the page against the viewport. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

// ───────────────────────────────────────────────────────────────────────────
// Navigation — the one that made the product unusable on a phone
// ───────────────────────────────────────────────────────────────────────────

test.describe('navigation', () => {
  test('every primary destination is reachable, and none of them is in the header bar', async ({
    page,
  }) => {
    await gotoMobile(page, '/')

    const nav = page.locator('header nav')

    // The inline bar is `hidden xl:flex` now. If someone deletes that, these
    // links come back into the header at 390px and go off-screen again — which
    // is precisely the bug, so assert on the header specifically rather than
    // on the page.
    await expect(nav.getByRole('link', { name: 'Visualizations' })).toBeHidden()

    const toggle = page.getByRole('button', { name: 'Menu', exact: true })
    const box = await toggle.boundingBox()
    expect(box, 'the menu toggle has no box').not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TAP)
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP)

    await toggle.tap()

    const drawer = page.locator('#site-nav-drawer')
    await expect(drawer).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // All six primary destinations plus the nine that used to hide behind
    // "More". Two taps to anything in the product, from any route.
    // The "More" rows carry a one-line hint inside the link, so their
    // accessible name is "Coach What to study next, from your progress" — match
    // on the leading label rather than pinning the hint copy into a test.
    for (const label of [
      /^Learn$/,
      /^Visualizations$/,
      /^Simulator$/,
      /^Challenges$/,
      /^AI Tutor$/,
      /^Pricing$/,
      /^Coach\b/,
      /^Real hardware\b/,
      /^Saved circuits\b/,
      /^Certification\b/,
      /^Insights\b/,
      /^Account\b/,
    ]) {
      const link = drawer.getByRole('link', { name: label })
      await expect(link, `${label} missing from the drawer`).toBeVisible()
      const linkBox = await link.boundingBox()
      expect(linkBox!.height, `${label} row is ${linkBox!.height}px tall`).toBeGreaterThanOrEqual(
        MIN_TAP,
      )
      // Fully inside the viewport, which is the thing that was broken.
      expect(linkBox!.x).toBeGreaterThanOrEqual(0)
      expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(390)
    }

    await drawer.getByRole('link', { name: 'Simulator', exact: true }).tap()
    await expect(page).toHaveURL(/\/simulator$/)
    // Closes itself on navigation — otherwise it covers the page you asked for.
    await expect(page.locator('#site-nav-drawer')).toHaveCount(0)
  })

  test('the drawer is dismissible without navigating', async ({ page }) => {
    await gotoMobile(page, '/learn')
    const toggle = page.getByRole('button', { name: 'Menu', exact: true })

    // 1. the toggle itself, which is what a thumb reaches for
    await toggle.tap()
    await expect(page.locator('#site-nav-drawer')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.tap()
    await expect(page.locator('#site-nav-drawer')).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // 2. Escape, for the keyboard and for anyone on a tablet with one attached
    await toggle.tap()
    await expect(page.locator('#site-nav-drawer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#site-nav-drawer')).toHaveCount(0)

    // There is deliberately no "tap outside to dismiss" assertion at 390px: the
    // drawer's max-height is calc(100dvh - 3.5rem), so at this size there IS no
    // outside. The outside-pointerdown handler in SiteNav still matters on a
    // tablet, where fifteen 44px rows leave the lower half of the screen free.
  })

  test('the search palette opens and can be dismissed at phone width', async ({ page }) => {
    await gotoMobile(page, '/')
    await page.getByRole('button', { name: /^Search/ }).first().tap()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // A modal that covers a 390px screen and cannot be closed is a dead end.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Nothing spills sideways
// ───────────────────────────────────────────────────────────────────────────

const OVERFLOW_ROUTES = [
  '/',
  '/learn',
  '/simulator',
  '/visualizations',
  '/visualizations/bloch-sphere',
  '/visualizations/tunneling',
  '/challenges',
  '/tutor',
  '/pricing',
  '/circuits',
  '/hardware',
  '/certify',
  '/coach',
  '/instructor',
  // Phase 15 surfaces — leaderboard table and decoder-duel canvas both have
  // obvious ways to overflow a 390px screen; guard them like the rest.
  '/compete',
  '/visualizations/qec-duel',
  // Phase 16 — the agent benchmark page ships a results table wide enough to
  // overflow a phone if it ever loses its scroll container.
  '/benchmark',
  // A long path title in the sticky "Continue" button, and unbroken formulas
  // in the glossary, are the two ways these could push past 390px.
  '/paths/quantum-software-engineer',
  '/glossary',

  // The visualization wave added the same two shapes again, and both are
  // correct today only because someone remembered the wrapper:
  //   mach-zehnder — a canvas with a hard `minWidth: MIN_TABLE_WIDTH` (600px),
  //     which is 210px wider than this viewport and stays on the page only
  //     because it sits inside `overflow-x-auto`.
  //   bell-test — a `min-w-[30rem]` results table, same wrapper, same risk.
  // Nothing else guards either; dropping the wrapper is a one-character edit.
  '/visualizations/mach-zehnder',
  '/visualizations/bell-test',
]

for (const route of OVERFLOW_ROUTES) {
  test(`${route} does not scroll sideways`, async ({ page }) => {
    await gotoMobile(page, route)
    // A wide table or code block inside its own `overflow-x-auto` is fine and
    // deliberate; what is not fine is the *document* being wider than the
    // screen, which is what makes the whole page slide under the thumb.
    expect(await horizontalOverflow(page), `${route} overflows the viewport`).toBeLessThanOrEqual(0)
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Interactive physics under a finger
// ───────────────────────────────────────────────────────────────────────────

test.describe('touch controls', () => {
  test('a visualization slider is grabbable and moves the state', async ({ page }) => {
    await gotoMobile(page, '/visualizations/bloch-sphere')

    const slider = page.getByRole('slider').first()
    await expect(slider).toBeVisible()
    // touchscreen.tap() takes viewport coordinates, so the control has to be
    // on screen before its box is worth anything. On a 390px screen the
    // controls rail sits below a full-width canvas.
    await slider.scrollIntoViewIfNeeded()

    // The hit box, not the painted track. This was `h-1.5` — a 6px band — on
    // every Slider in the app, which is not grabbable with a finger.
    const box = await slider.boundingBox()
    expect(box, 'the slider has no box').not.toBeNull()
    expect(
      box!.height,
      `slider hit box is ${box!.height}px tall; it was 6px before this workstream`,
    ).toBeGreaterThanOrEqual(MIN_TAP)

    // And it actually responds to a touch drag, not just to a keypress.
    const before = await slider.inputValue()
    await page.touchscreen.tap(box!.x + box!.width * 0.8, box!.y + box!.height / 2)
    await expect
      .poll(async () => await slider.inputValue(), { message: 'tapping the track moved nothing' })
      .not.toBe(before)
  })

  test('a gate can be placed and removed by tapping the circuit grid', async ({ page }) => {
    const watcher = expectNoConsoleErrors(page)
    await gotoMobile(page, '/simulator')

    const svg = page.getByRole('group', { name: /quantum circuit/i }).first()
    await expect(svg).toBeVisible()
    await svg.scrollIntoViewIfNeeded()

    // The editor's own gate counter, read off the SVG's accessible name.
    const gateCount = async (): Promise<number> => {
      const label = (await svg.getAttribute('aria-label')) ?? ''
      return Number(/and (\d+) gates?/.exec(label)?.[1] ?? '0')
    }
    expect(await gateCount()).toBe(0)

    // Palette tiles are h-11 (44px) already; assert it so a later "tighten the
    // palette" change has to argue with a test.
    const hGate = page.getByRole('button', { name: /^H gate$/i })
    const paletteBox = await hGate.boundingBox()
    expect(paletteBox!.height).toBeGreaterThanOrEqual(MIN_TAP)

    await hGate.tap()

    await svg.scrollIntoViewIfNeeded()
    // Geometry of components/circuit/CircuitGrid.tsx: LABEL_W 46, COL_W 52,
    // ROW_H 56, PAD_TOP 18 — the same four constants tests/e2e/helpers.ts
    // encodes. A cell is therefore 52x48 CSS px, which clears 44.
    const svgBox = (await svg.boundingBox())!
    const cellX = svgBox.x + 46 + 52 / 2
    const wire0Y = svgBox.y + 18 + 56 / 2
    await page.touchscreen.tap(cellX, wire0Y)
    await expect.poll(gateCount, { message: 'tapping a wire placed nothing' }).toBe(1)

    // Tapping the placed glyph removes it — the remove badge is a hover
    // affordance and a touch screen has no hover, so this is the only route.
    await page.touchscreen.tap(cellX, wire0Y)
    await expect.poll(gateCount, { message: 'tapping a placed gate removed nothing' }).toBe(0)

    watcher.assertClean('/simulator at 390x844')
  })

  test('the tutor composer fits and can be submitted by tap', async ({ page }) => {
    await gotoMobile(page, '/tutor')

    const textarea = page.getByRole('textbox', { name: 'Message the tutor' })
    const send = page.getByRole('button', { name: 'Send' })

    const taBox = (await textarea.boundingBox())!
    const sendBox = (await send.boundingBox())!

    // The textarea is `flex-1` in a flex row; without `min-w-0` its
    // min-content width (the `cols` default) stopped it shrinking and the Send
    // button was pushed past the card's right edge.
    expect(sendBox.x + sendBox.width, 'Send is clipped by the viewport').toBeLessThanOrEqual(390)
    expect(taBox.x + taBox.width, 'the textarea overhangs Send').toBeLessThanOrEqual(sendBox.x + 1)
    expect(sendBox.height).toBeGreaterThanOrEqual(MIN_TAP)

    // 16px minimum: iOS Safari zooms the page in on focus below that and does
    // not zoom back out.
    const fontSize = await textarea.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize, 'a sub-16px field makes iOS Safari zoom on focus').toBeGreaterThanOrEqual(16)

    await textarea.tap()
    await textarea.fill('What is a Bell state?')
    await expect(send).toBeEnabled()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// /coach — the concept graph. RESPONSIVE.md logged this one, unfixed, as
// belonging to components/coach/**: at 390px the hand-drawn SVG measured
// x=33 to x=673 with node paths at x=388 and x=480 off-screen, and it sat
// outside any scroll container, so those nodes could not be reached at all.
// ───────────────────────────────────────────────────────────────────────────

test.describe('coach concept graph', () => {
  test('every concept node is reachable by scrolling the map at phone width', async ({
    page,
  }) => {
    await gotoMobile(page, '/coach')

    const svg = page.locator('svg[aria-label*="Dependency map"]')
    await expect(svg).toBeVisible()

    // The map genuinely does not fit at 390px — if it ever did (a much
    // smaller CONCEPT_GRAPH, say), the rest of this test would pass
    // vacuously, so pin that down rather than assume it.
    const scroller = page.locator('div.overflow-x-auto', { has: svg })
    const overflows = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflows, 'the map already fits — scroll reachability is not being exercised').toBeGreaterThan(0)

    // The container that scrolls is not the document: the page itself must
    // stay put, exactly like every other route in this suite.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

    // One <g data-node-id> per concept in the graph — every node the SVG
    // draws, not just the ones already on screen before scrolling.
    const nodeCount = await page.locator('svg [data-node-id]').count()
    expect(nodeCount).toBe(CONCEPT_GRAPH.length)

    // Every node has to become reachable by scrolling — not all of them at
    // once (the map is wider than the phone, so the first column is
    // necessarily off-screen once the last one is in view; that is normal
    // horizontal scrolling, not the bug). Scroll each node into view on its
    // own and check it individually lands fully inside the viewport.
    for (const concept of CONCEPT_GRAPH) {
      const node = page.locator(`svg [data-node-id="${concept.id}"]`)
      await node.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
      const box = await node.boundingBox()
      expect(box, `${concept.id} has no box after scrolling it into view`).not.toBeNull()
      expect(
        box!.x >= 0 && box!.x + box!.width <= 390,
        `${concept.id} sits at x=${box!.x}..${box!.x + box!.width} after scrolling it into view, outside the 390px viewport`
      ).toBe(true)
    }

    // And a node scrolled into view is genuinely operable, not just inside
    // the viewport on paper: tapping the last one — the one furthest off the
    // original right edge — navigates, the same as any other node.
    const last = CONCEPT_GRAPH[CONCEPT_GRAPH.length - 1]
    const lastNode = page.locator(`svg [data-node-id="${last.id}"]`)
    await lastNode.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
    // Tap the <g> itself, not the child <rect>: the node's label <text> paints
    // over the rect (same stacking context, later in DOM order) so a tap
    // exactly centred on the rect finds the text in front of it instead. A
    // real touch would too, and the click still lands — the handler is on the
    // <g>, an ancestor of both — but Playwright's actionability check is
    // stricter about that than a browser's hit-test, so target the element
    // that actually owns the click.
    await lastNode.tap()
    await expect(page).toHaveURL(new RegExp(`/learn/${last.id}$`))
  })

  test('a visible hint marks the map as scrollable, and it clears once fully scrolled', async ({
    page,
  }) => {
    await gotoMobile(page, '/coach')

    const svg = page.locator('svg[aria-label*="Dependency map"]')
    await expect(svg).toBeVisible()
    const scroller = page.locator('div.overflow-x-auto', { has: svg })

    const hint = page.getByText('Scroll for more', { exact: false })
    await expect(hint, 'no visible affordance says the map keeps going').toBeVisible()

    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await expect(hint).toBeHidden()
  })

  // The screen-reader list under the map is the older fix — this asserts it
  // was not the thing that regressed while the visual scroll affordance was
  // built.
  test('the accessible concept list still lists every concept', async ({ page }) => {
    await gotoMobile(page, '/coach')
    const list = page.getByRole('list', { name: 'Concepts in prerequisite order' })
    await expect(list.getByRole('link')).toHaveCount(CONCEPT_GRAPH.length)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Accessibility that must survive the reflow
// ───────────────────────────────────────────────────────────────────────────

test.describe('a11y is not regressed by the mobile layout', () => {
  test('the skip link is still the first tab stop and still reaches main', async ({ page }) => {
    await gotoMobile(page, '/learn')
    await page.keyboard.press('Tab')

    const focused = page.locator(':focus')
    await expect(focused).toHaveText(/skip to main content/i)

    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()
  })

  test('a challenge page keeps its landmarks and one h1 at phone width', async ({ page }) => {
    await gotoMobile(page, `/challenges/${CHALLENGE_IDS[0]}`)

    // Roles, not tags: a <header> nested inside <main> is a plain element, not
    // a second banner, and this page renders one. Exactly one banner and one
    // main is the thing that must survive the reflow.
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('banner')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })

  test('lesson progress written on a phone still drives the learn index', async ({ page }) => {
    await gotoMobile(page, '/learn')
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [PROGRESS_KEY, JSON.stringify({ completed: [LESSON_SLUGS[0]], quizScores: {} })] as const,
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('header[data-nav-ready="true"]').waitFor({ state: 'attached' })

    // The lesson row's status is an sr-only "Completed" / "Not yet completed".
    // Exactly one lesson was seeded, so exactly one row should read Completed —
    // an assertion that fails both if the seed did not land and if the reflowed
    // index stopped rendering the status.
    await expect(page.getByText('Completed', { exact: true })).toHaveCount(1)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// /certify/[examId] at phone width
// ───────────────────────────────────────────────────────────────────────────

/**
 * docs/RESPONSIVE.md § 3 re-verified the "Preparing your paper…" hang was
 * fixed, but only at desktop width — exam.spec.ts runs under the `chromium`
 * project, which `playwright.config.ts` does not point at 390x844, and this
 * file's OVERFLOW_ROUTES entry for `/certify` only exercises the exam list
 * page, never an actual `[examId]` paper. This closes that specific gap: the
 * one route in the app with a running clock and a server round-trip on a
 * touch device.
 */
test.describe('/certify/[examId] at phone width', () => {
  const EXAM_ID = 'foundations-cert'
  const EXAM = getExam(EXAM_ID)!

  test('the exam paper starts and does not scroll sideways on a phone', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    await gotoMobile(page, `/certify/${EXAM_ID}`)

    const begin = page.getByRole('button', { name: /^Begin exam$/ })
    await expect(begin).toBeVisible()
    // Tap, not click — this is the control that starts a timed, graded attempt,
    // and a hover-only affordance here would be a real bug, not a nitpick.
    await begin.tap()

    await expect(page.getByRole('heading', { level: 1, name: EXAM.title })).toBeVisible()
    await expect(page.getByRole('region', { name: /^Question 1 of \d+$/ })).toBeVisible()
    await expect(page.getByRole('timer')).toBeVisible()

    expect(await horizontalOverflow(page), '/certify/[examId] overflows the viewport').toBeLessThanOrEqual(0)

    console_.assertClean(`/certify/${EXAM_ID}`)
  })
})
