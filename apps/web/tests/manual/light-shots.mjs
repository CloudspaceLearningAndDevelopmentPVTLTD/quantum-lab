/**
 * Manual light-theme spot check.
 *
 * The automated suite asserts structure, not colour: nothing in it would catch
 * "the circuit wires are white on white". This script pins the light theme the
 * same way ThemeScript does (localStorage + the .light class on <html>), loads
 * the surfaces that paint to canvas / SVG, and writes a screenshot of each so a
 * human can look at them.
 *
 *   node tests/manual/light-shots.mjs            # needs a server on :3000
 *   BASE=http://localhost:3100 node tests/manual/light-shots.mjs
 *
 * Not part of `npx playwright test` — it asserts nothing and is not a gate.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const OUT = 'tests/manual/shots'

const ROUTES = [
  '/',
  '/simulator',
  '/visualizations',
  '/visualizations/bloch-sphere',
  '/visualizations/superposition',
  '/visualizations/double-slit',
  '/visualizations/entanglement',
  '/visualizations/tunneling',
  '/pricing',
  '/insights',
  '/coach',
  '/welcome',
]

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })

// Pin the theme before any app code runs, exactly as the anti-flash script reads it.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('quantum-lab:theme', 'light')
  } catch {}
  document.documentElement.classList.add('light')
  document.documentElement.classList.remove('dark')
})

await mkdir(OUT, { recursive: true })
const page = await ctx.newPage()

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  // Let a canvas mount, run a few frames, and settle any easing animation.
  await page.waitForTimeout(1800)
  const name = route === '/' ? 'home' : route.slice(1).replace(/\//g, '-')
  await page.screenshot({ path: `${OUT}/light-${name}.png`, fullPage: false })
  console.log('shot', route)
}

await browser.close()
