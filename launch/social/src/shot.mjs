/** shot.mjs <page.html> <out.png> <w> <h> <k> <total> — one frame, as a PNG. */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [page_, out, w, h, k, total] = process.argv.slice(2)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('console', (m) => console.log('[console]', m.type(), m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.stack))
await page.goto(pathToFileURL(path.resolve(page_)).href, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
if (k !== undefined) await page.evaluate(([k, t]) => window.frame(Number(k), Number(t)), [k, total])
await page.screenshot({ path: out, type: 'png' })
await browser.close()
console.log('wrote', out)
