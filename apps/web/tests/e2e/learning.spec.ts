/**
 * learning.spec.ts — the course path end to end.
 *
 * The load-bearing assertion here is the localStorage round-trip: a lesson
 * marked complete has to still be complete on /learn after a full reload. Every
 * unit test in the repo can prove `markComplete` returns the right object; only
 * this can prove the button is wired to it and the index reads it back.
 */

import { test, expect, type Page } from '@playwright/test'

import { LESSONS, TRACKS, allSlugs, getLesson, getNextLesson } from '../../lib/lessons'
// Bodies live behind the server module now (see lib/lessons/server.ts). A
// Playwright spec runs in Node, so importing it here is legitimate — and it is
// the only way this file can still derive its prose probes from the real
// course data rather than from pasted sentences that rot. The `server-only`
// marker inside it throws under plain Node, so the neutraliser must be
// imported FIRST (see neutralizeServerOnly.ts for why that is safe).
import './neutralizeServerOnly'
import { allFullLessons, getFullLesson } from '../../lib/lessons/server'
import { FREE_PREVIEW_BLOCKS } from '../../lib/lessons/access'
import type { Lesson, LessonBlock } from '../../lib/lessons/types'
import { expectNoConsoleErrors, gotoClean, seedProgress } from './helpers'

const ORDER = allSlugs()
const FIRST_SLUG = TRACKS[0].lessonSlugs[0]
const FIRST_LESSON = getLesson(FIRST_SLUG)!
const TOTAL_LESSONS = ORDER.length

const ADVANCED_SLUG = TRACKS[1].lessonSlugs[0]
const ADVANCED_LESSON = getFullLesson(ADVANCED_SLUG)!

/**
 * A sentence from a block the server is supposed to withhold, and one from a
 * block it is supposed to serve. Derived from the lesson record rather than
 * pasted, so an edit to the course cannot leave this spec asserting on prose
 * that no longer exists.
 */
function firstParagraph(blocks: LessonBlock[]): string {
  for (const block of blocks) {
    if (block.kind === 'prose' && block.paragraphs[0]) return block.paragraphs[0]
  }
  throw new Error('no prose block to sample')
}

/**
 * The longest run of plain letters, digits and simple punctuation in a string.
 *
 * Needed because these probes are matched against RAW HTML. react-dom escapes
 * `& < > " '` in text content, so a probe containing an apostrophe would fail
 * to match prose that is present — and, far worse, a NEGATIVE assertion built
 * from such a probe would pass while the text was leaking. Restricting the
 * probe to characters no escaper touches makes both directions trustworthy.
 */
function probe(text: string, minimum = 40): string {
  const runs = text.match(/[A-Za-z0-9 ,.:;()/-]+/g) ?? []
  const best = runs.sort((a, b) => b.length - a.length)[0] ?? ''
  const trimmed = best.trim()
  if (trimmed.length < minimum) {
    throw new Error(`no escape-proof probe of ${minimum}+ chars in: ${text.slice(0, 60)}…`)
  }
  return trimmed
}

const PREVIEWED_PROBE = probe(
  firstParagraph(ADVANCED_LESSON.blocks.slice(0, FREE_PREVIEW_BLOCKS)),
)
const WITHHELD_PROBE = probe(firstParagraph(ADVANCED_LESSON.blocks.slice(FREE_PREVIEW_BLOCKS)))

/** The first lesson that carries a quiz block — the one this spec can answer. */
const QUIZ_LESSON = allFullLessons().find((lesson) => lesson.blocks.some((b) => b.kind === 'quiz'))!

const lessonBody = (page: Page) => page.getByRole('article').first()

/**
 * The question-first conversion gates every block below an unanswered
 * inline check. Skip through the gates ("Show me anyway" — the honest,
 * always-available escape hatch the card offers) until none remain, so a
 * spec can reach content further down the lesson: the quiz, the embeds.
 */
async function revealGatedBlocks(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /show me anyway/i })
  // Each click reveals the next section, which may contain the next gate.
  for (let i = 0; i < 10 && (await skip.count()) > 0; i++) {
    await skip.first().click()
  }
  await expect(skip).toHaveCount(0)
}

test.describe('the course', () => {
  test('lists every lesson and starts the first one', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    await gotoClean(page, '/learn')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(`0 of ${TOTAL_LESSONS} lessons complete`)).toBeVisible()

    await page.getByRole('link', { name: /start the course/i }).click()

    await expect(page).toHaveURL(new RegExp(`/learn/${FIRST_SLUG}$`))
    await expect(page.getByRole('heading', { level: 1, name: FIRST_LESSON.title })).toBeVisible()

    // Real content, not a shell: the objectives list and the prose blocks.
    await expect(page.getByText(/in this lesson you.{1,3}ll learn/i)).toBeVisible()
    const text = await lessonBody(page).innerText()
    expect(text.length).toBeGreaterThan(1000)
    expect(text).toContain(FIRST_LESSON.objectives[0])

    console_.assertClean('/learn/' + FIRST_SLUG)
  })

  test('answering a quiz question reveals the explanation', async ({ page }) => {
    await gotoClean(page, `/learn/${QUIZ_LESSON.slug}`)
    await revealGatedBlocks(page)

    const quiz = page.getByRole('region', { name: /check your understanding/i }).first()
    await expect(quiz).toBeVisible()

    const question = QUIZ_LESSON.blocks.find((b) => b.kind === 'quiz')!
    const first = question.kind === 'quiz' ? question.questions[0] : undefined
    expect(first, 'the quiz block has no questions').toBeTruthy()

    await expect(quiz.getByText(/0 \/ \d+ answered/)).toBeVisible()

    // The explanation must not be on screen before an answer is locked in.
    await expect(quiz.getByText(first!.explanation, { exact: false })).toHaveCount(0)

    await quiz.getByRole('button', { name: first!.options[0].text }).click()

    await expect(quiz.getByText(first!.explanation, { exact: false })).toBeVisible()
    await expect(quiz.getByText(/1 \/ \d+ answered/)).toBeVisible()

    // Locked: clicking a different option must not change the answer count.
    await expect(quiz.getByRole('button', { name: first!.options[1].text })).toBeDisabled()
  })

  test('completion survives a reload and shows on the course index', async ({ page }) => {
    await gotoClean(page, `/learn/${FIRST_SLUG}`)

    const complete = page.getByRole('button', { name: /mark as complete/i })
    await expect(complete).toBeVisible()
    await complete.click()
    await expect(lessonBody(page).getByText(/^Completed/)).toBeVisible()

    // Same page, fresh document — the state has to come back out of storage.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(lessonBody(page).getByText(/^Completed/)).toBeVisible()
    await expect(page.getByRole('button', { name: /mark as complete/i })).toHaveCount(0)

    await page.goto('/learn', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(`1 of ${TOTAL_LESSONS} lessons complete`)).toBeVisible()
    await expect(page.getByText(`Last read: ${FIRST_LESSON.title}`)).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(`1 of ${TOTAL_LESSONS} lessons complete`)).toBeVisible()
  })

  test('seeded progress is reflected on the index', async ({ page }) => {
    await gotoClean(page, '/learn')
    const seeded = ORDER.slice(0, 3)
    await seedProgress(page, seeded, { lastVisited: seeded[2] })

    await expect(page.getByText(`3 of ${TOTAL_LESSONS} lessons complete`)).toBeVisible()
    await expect(page.getByRole('link', { name: /continue where you left off/i })).toBeVisible()
    await expect(page.getByText(`Last read: ${getLesson(seeded[2])!.title}`)).toBeVisible()
  })

  test('next / previous navigate across a lesson boundary', async ({ page }) => {
    // The last lesson of the foundations track, whose "next" is the first
    // lesson of the advanced track — the boundary most likely to break.
    const foundationSlugs = TRACKS[0].lessonSlugs
    const from = foundationSlugs[foundationSlugs.length - 1]
    const to = getNextLesson(from)
    expect(to, `${from} has no next lesson — the track order is broken`).toBeTruthy()

    await gotoClean(page, `/learn/${from}`)

    const nav = page.getByRole('navigation', { name: /lesson navigation/i })
    await nav.getByRole('link', { name: /next/i }).click()

    await expect(page).toHaveURL(new RegExp(`/learn/${to!.slug}$`))
    await expect(page.getByRole('heading', { level: 1, name: to!.title })).toBeVisible()

    await page
      .getByRole('navigation', { name: /lesson navigation/i })
      .getByRole('link', { name: /previous/i })
      .click()

    await expect(page).toHaveURL(new RegExp(`/learn/${from}$`))
    await expect(page.getByRole('heading', { level: 1, name: getLesson(from)!.title })).toBeVisible()
  })

  test('the tunneling lesson renders with its live embed', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    const lesson = getFullLesson('tunneling')
    expect(lesson, 'the tunneling lesson is missing from the catalogue').toBeTruthy()

    await gotoClean(page, '/learn/tunneling')

    await expect(page.getByRole('heading', { level: 1, name: lesson!.title })).toBeVisible()
    await revealGatedBlocks(page)

    const embed = lesson!.blocks.find((b) => b.kind === 'embed')
    expect(embed, 'the tunneling lesson has no embed block').toBeTruthy()

    const link = lessonBody(page).getByRole('link', { name: /open the live simulation/i }).first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/visualizations/tunneling')

    await link.click()
    await expect(page).toHaveURL(/\/visualizations\/tunneling$/)
    await expect(page.locator('canvas').first()).toBeAttached({ timeout: 15000 })

    console_.assertClean('/learn/tunneling → /visualizations/tunneling')
  })
})

/**
 * The advanced-track paywall.
 *
 * The assertions that matter are the RAW-DOCUMENT ones. A Playwright page check
 * only proves the browser is not painting the paid prose; `request.get()` is
 * `curl`, and it proves the bytes never left the server. That is the difference
 * between the gate this repo has now and the client-side check it had before,
 * so it is checked at the level where the difference is visible.
 *
 * Nothing here signs in, because CI has no Supabase project: every caller is
 * anonymous and therefore locked. The Pro-caller half — that a verified,
 * entitled caller gets the whole lesson — is `lib/lessons/access.test.ts`,
 * which drives the route handler directly against a stubbed subscription.
 */
test.describe('the advanced track is paid, and behaves like it', () => {
  test('the served HTML of an advanced lesson carries the preview and not the body', async ({
    request,
  }) => {
    const response = await request.get(`/learn/${ADVANCED_SLUG}`)
    expect(response.status()).toBe(200)
    const html = await response.text()

    // The hook is there — this is a preview, not a stub.
    expect(html).toContain(PREVIEWED_PROBE)
    // The rest is not, in any form: not in the DOM, and not in the RSC flight
    // payload the page ships alongside it.
    expect(html).not.toContain(WITHHELD_PROBE)

    // And the structured data says so, rather than advertising a free lesson.
    // JsonLd writes the node raw into a <script>, so this is the literal JSON.
    expect(html).toContain('"isAccessibleForFree":false')
    expect(html).toContain('"cssSelector":".paywalled-content"')
    // The selector has to resolve against the markup, or it is a claim about a
    // page that does not exist.
    expect(html).toContain('class="paywalled-content')
  })

  test('an advanced lesson page shows real material, then the paywall', async ({ page }) => {
    const console_ = expectNoConsoleErrors(page)
    await gotoClean(page, `/learn/${ADVANCED_SLUG}`)

    await expect(
      page.getByRole('heading', { level: 1, name: ADVANCED_LESSON.title }),
    ).toBeVisible()

    const body = page.getByRole('article').first()
    const text = await body.innerText()
    // A preview thin enough to feel like a bait-and-switch is a product bug.
    expect(text.length).toBeGreaterThan(1500)
    expect(text).toContain(PREVIEWED_PROBE)
    expect(text).not.toContain(WITHHELD_PROBE)

    const paywall = page.getByRole('region', { name: /upgrade to continue this lesson/i })
    await expect(paywall).toBeVisible()
    await expect(paywall.getByRole('link', { name: /see plans/i })).toHaveAttribute(
      'href',
      '/pricing',
    )

    console_.assertClean(`/learn/${ADVANCED_SLUG}`)
  })

  test('the content endpoint refuses an anonymous caller with 402', async ({ request }) => {
    const response = await request.get(`/learn/${ADVANCED_SLUG}/content`)
    expect(response.status()).toBe(402)

    const body = await response.text()
    expect(body).not.toContain(WITHHELD_PROBE)
    expect(JSON.parse(body).upgradeUrl).toBe('/pricing')
  })

  test('the free track is untouched: whole lessons, no paywall, no account', async ({
    request,
    page,
  }) => {
    for (const slug of TRACKS[0].lessonSlugs) {
      const lesson = getFullLesson(slug) as Lesson
      const html = await (await request.get(`/learn/${slug}`)).text()

      // Every prose paragraph of every free lesson, in the document, for a
      // caller with no cookie, no token and no account. This is the product's
      // core promise and /pricing states it in writing.
      for (const block of lesson.blocks) {
        if (block.kind !== 'prose') continue
        for (const paragraph of block.paragraphs) {
          expect(html, `${slug} withheld a foundations paragraph`).toContain(probe(paragraph))
        }
      }

      expect(html, `${slug} is marked as paid`).toContain('"isAccessibleForFree":true')
      expect(html, `${slug} rendered a paywalled section`).not.toContain('paywalled-content')
    }

    await gotoClean(page, `/learn/${FIRST_SLUG}`)
    await expect(
      page.getByRole('region', { name: /upgrade to continue this lesson/i }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /mark as complete/i })).toBeVisible()
  })

  test('the advanced certification is not simply handed over by URL', async ({ page }) => {
    // /certify hides the "Start exam" button for a locked exam; the exam page
    // used to serve the paper to anyone who typed the address. NOTE: this is a
    // consistency check, not a security one — see lib/exams/access.ts.
    await gotoClean(page, '/certify/advanced-cert')

    await expect(page.getByRole('link', { name: /see plans/i })).toBeVisible()
    await expect(page.getByRole('region', { name: /^Question 1 of/ })).toHaveCount(0)

    // The free certification still starts for anyone — but the paper is now a
    // server-created attempt, so it begins on the press rather than on the load.
    await gotoClean(page, '/certify/foundations-cert')
    await page.getByRole('button', { name: /^Begin exam$/ }).click()
    await expect(page.getByRole('region', { name: /^Question 1 of/ })).toBeVisible()
  })
})
