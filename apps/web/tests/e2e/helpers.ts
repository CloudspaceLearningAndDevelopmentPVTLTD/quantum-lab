/**
 * Shared end-to-end helpers.
 *
 * Three jobs:
 *   1. Determinism — `gotoClean` guarantees a page starts with empty browser
 *      storage, so no spec can inherit state from another (Playwright already
 *      gives each test a fresh context; this makes it true *within* a test too,
 *      and survives someone reusing a page across navigations).
 *   2. Noise control — `expectNoConsoleErrors` knows which console output is
 *      expected in a CI environment with no Python API, no Stripe and no
 *      Supabase, and refuses to fail a test over it.
 *   3. Interaction — the circuit editor is an SVG with click strips rather than
 *      DOM buttons, so `placeGate` encodes that geometry once.
 */

import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, type Response } from '@playwright/test'

import { allSlugs } from '../../lib/lessons'
import { CHALLENGES } from '../../lib/challenges/catalogue'
import { EXAMS } from '../../lib/exams/catalogue'

// ───────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────

const APP_DIR = path.resolve(__dirname, '..', '..', 'app')

/**
 * Every statically-addressable route, read off the filesystem rather than
 * hardcoded, so a page another agent adds tomorrow is covered automatically.
 * Route groups `(group)` are transparent; dynamic segments are filled in from
 * the data modules below.
 */
function staticRoutes(dir: string = APP_DIR, prefix = ''): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) found.push(prefix === '' ? '/' : prefix)
      continue
    }
    if (!entry.isDirectory()) continue
    const name = entry.name
    // Private folders, API handlers and dynamic segments are not page routes.
    if (name.startsWith('_') || name === 'api') continue
    if (name.startsWith('[')) continue
    // Route groups and parallel routes do not contribute a path segment.
    const segment = name.startsWith('(') || name.startsWith('@') ? '' : `/${name}`
    found.push(...staticRoutes(path.join(dir, name), `${prefix}${segment}`))
  }
  return found
}

export const LESSON_SLUGS: string[] = allSlugs()
export const CHALLENGE_IDS: string[] = CHALLENGES.map((c) => c.id)
export const EXAM_IDS: string[] = EXAMS.map((e) => e.id)

export const DYNAMIC_ROUTES: string[] = [
  ...LESSON_SLUGS.map((slug) => `/learn/${slug}`),
  ...CHALLENGE_IDS.map((id) => `/challenges/${id}`),
  ...EXAM_IDS.map((id) => `/certify/${id}`),
]

/** Every route the app serves, sorted and de-duplicated. */
export const ALL_ROUTES: string[] = Array.from(
  new Set([...staticRoutes(), ...DYNAMIC_ROUTES]),
).sort()

// ───────────────────────────────────────────────────────────────────────────
// Storage keys — kept in one place so a rename shows up as one failing import
// ───────────────────────────────────────────────────────────────────────────

export const PROGRESS_KEY = 'quantum-lab.progress'
export const CHALLENGE_KEY = 'quantum-lab.challenges'
export const ONBOARDING_KEY = 'quantum-lab.onboarding'

// ───────────────────────────────────────────────────────────────────────────
// Navigation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Navigate to `path` with localStorage and sessionStorage guaranteed empty at
 * document load.
 *
 * Storage is origin-scoped, so it can only be cleared from a page already on
 * the origin. The sequence is therefore: land, wipe, reload — and the reload is
 * skipped when there was nothing to wipe, which is the common case inside a
 * fresh Playwright context. That skip is what keeps the 60-odd route smoke
 * tests to one navigation each.
 */
export async function gotoClean(page: Page, route: string): Promise<Response | null> {
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' })

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

  const settled =
    dirty === 0 ? response : ((await page.reload({ waitUntil: 'domcontentloaded' })) ?? response)

  await waitForHydration(page)
  return settled
}

/**
 * Block until React has hydrated the document.
 *
 * Without this a `click()` issued straight after `domcontentloaded` lands on
 * server-rendered markup whose event handlers do not exist yet, and simply does
 * nothing — the single most common source of "passes locally, fails in CI"
 * flake in this kind of suite.
 *
 * The signal is the nav search trigger's keyboard hint. It is rendered from a
 * `useEffect` (platform detection has no SSR answer), so its appearance proves
 * client React is running and has committed at least one effect. It lives in
 * the root layout, so it is present on every route.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('load').catch(() => undefined)
  await page
    .getByRole('button', { name: /^Search\s+(⌘K|Ctrl K)$/ })
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 })
    .catch(() => undefined)
}

/** Clear storage without navigating anywhere. The page must already be on the origin. */
export async function clearStorage(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    .catch(() => undefined)
}

// ───────────────────────────────────────────────────────────────────────────
// Console errors
// ───────────────────────────────────────────────────────────────────────────

/**
 * Output that is EXPECTED in the environment CI runs in and must never fail a
 * test:
 *   - favicon / manifest / icon fetches for assets that may not be generated
 *   - ERR_CONNECTION_REFUSED and friends — the Python simulation API is not
 *     running, and every caller is written to degrade to the in-browser path
 *   - the generic "Failed to load resource" line the browser emits alongside
 *     the network error above
 *   - Next.js dev/prefetch chatter and Sentry's "no DSN" note
 */
const BENIGN = [
  /favicon/i,
  /manifest/i,
  /apple-touch-icon/i,
  /net::ERR_/i,
  /Failed to load resource/i,
  /ERR_CONNECTION_REFUSED/i,
  /Failed to fetch/i,
  /\bload failed\b/i,
  /sentry/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
]

const isBenign = (text: string): boolean => BENIGN.some((re) => re.test(text))

export interface ConsoleWatcher {
  /** Everything seen so far that is not on the benign list. */
  errors: () => string[]
  /** Assert nothing unexpected was logged. Call at the end of the test. */
  assertClean: (context?: string) => void
}

/**
 * Attach console/pageerror listeners immediately and hand back an assertion to
 * run at the end of the test. Attach BEFORE navigating — errors thrown during
 * the first paint are exactly the ones worth catching.
 */
export function expectNoConsoleErrors(page: Page): ConsoleWatcher {
  const collected: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!isBenign(text)) collected.push(`console.error: ${text}`)
  })

  page.on('pageerror', (error) => {
    const text = `${error.name}: ${error.message}`
    if (!isBenign(text)) collected.push(`pageerror: ${text}`)
  })

  return {
    errors: () => [...collected],
    assertClean: (context = page.url()) => {
      expect(collected, `unexpected console errors on ${context}:\n${collected.join('\n')}`).toEqual(
        [],
      )
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Seeding
// ───────────────────────────────────────────────────────────────────────────

export interface SeedProgressOptions {
  quizScores?: Record<string, number>
  lastVisited?: string
  /** Reload after writing so the page picks the state up. Default true. */
  reload?: boolean
}

/**
 * Write lesson progress straight into localStorage so a test can start from a
 * known state instead of clicking through ten lessons. The page must already be
 * on the app origin (call `gotoClean` first).
 */
export async function seedProgress(
  page: Page,
  slugs: string[],
  options: SeedProgressOptions = {},
): Promise<void> {
  const payload = {
    completed: slugs,
    quizScores: options.quizScores ?? {},
    ...(options.lastVisited === undefined ? {} : { lastVisited: options.lastVisited }),
  }

  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [PROGRESS_KEY, JSON.stringify(payload)] as const,
  )

  if (options.reload !== false) await page.reload({ waitUntil: 'domcontentloaded' })
}

/** Same idea for challenge progress. */
export async function seedChallengeProgress(
  page: Page,
  solvedIds: string[],
  options: { reload?: boolean } = {},
): Promise<void> {
  const payload = Object.fromEntries(
    solvedIds.map((id) => [id, { solved: true, hintsUsed: 0, bestGates: 2 }]),
  )

  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [CHALLENGE_KEY, JSON.stringify(payload)] as const,
  )

  if (options.reload !== false) await page.reload({ waitUntil: 'domcontentloaded' })
}

// ───────────────────────────────────────────────────────────────────────────
// Circuit editor
// ───────────────────────────────────────────────────────────────────────────

/**
 * Geometry of `components/circuit/CircuitGrid.tsx`. Each qubit wire has a
 * full-row transparent click strip; clicking it appends the selected gate.
 * These four numbers are the component's layout constants — if the editor is
 * re-laid-out these change, and that is a deliberate, visible coupling rather
 * than a brittle CSS selector.
 */
const GRID = { labelWidth: 46, rowHeight: 56, padTop: 18, colWidth: 52 }

const wireY = (qubit: number): number =>
  GRID.padTop + qubit * GRID.rowHeight + GRID.rowHeight / 2

/**
 * Horizontal centre of column `col`. Placed gates occupy columns 0..n-1 and are
 * themselves clickable (clicking one REMOVES it), so a placement click has to
 * land in the first free column — clicking a fixed x is how you accidentally
 * delete the gate you just placed.
 */
const columnX = (col: number): number =>
  GRID.labelWidth + col * GRID.colWidth + GRID.colWidth / 2

/**
 * The circuit SVG, addressed by its accessible name.
 *
 * role="group", NOT role="img", and the distinction is the whole reason the
 * grid is usable by a screen reader. The element used to be role="img", which
 * declares its entire subtree to be one flat graphic — so the role="grid"
 * inside it and every focusable role="gridcell" were made presentational. The
 * editor was reachable by Tab and arrow keys and announced nothing; axe-core
 * reports it as `nested-interactive`. Changing the role fixed that and broke
 * this locator, which is why a dozen specs went red at once: challenges,
 * onboarding, billing and mobile all place gates through here.
 *
 * If this ever needs changing again, change it HERE — one locator, one edit.
 */
export const circuitSvg = (page: Page) =>
  page.getByRole('group', { name: /quantum circuit/i }).first()

/**
 * Select `gate` in the palette and place it on `qubits`.
 *
 * Single-qubit gates take a number; multi-qubit gates take the qubits in the
 * order the editor asks for them (control first for CX). The palette button is
 * found by its accessible name — `aria-label="H gate"` — not by class.
 */
export async function placeGate(
  page: Page,
  gate: string,
  qubits: number | number[],
): Promise<void> {
  const targets = Array.isArray(qubits) ? qubits : [qubits]

  const paletteButton = page.getByRole('button', { name: new RegExp(`^${gate} gate$`, 'i') })
  await expect(paletteButton).toBeVisible()
  await paletteButton.click()

  const svg = circuitSvg(page)
  await expect(svg).toBeVisible()

  for (const qubit of targets) {
    const box = await svg.boundingBox()
    expect(box, 'the circuit SVG has no bounding box').not.toBeNull()
    // The next free column, recomputed per click: a multi-qubit gate is only
    // committed on its last click, so the free column can move underneath us.
    const x = Math.min(columnX(await gateGlyphCount(page)), box!.width - 8)
    await svg.click({ position: { x, y: wireY(qubit) } })
  }
}

/** Gate count as the editor reports it, for asserting a placement landed. */
export async function gateGlyphCount(page: Page): Promise<number> {
  const label = await circuitSvg(page).getAttribute('aria-label')
  const match = /and (\d+) gates?/.exec(label ?? '')
  return match ? Number(match[1]) : 0
}
