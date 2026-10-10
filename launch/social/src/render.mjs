/**
 * render.mjs — frame-render an HTML page in Chromium and encode it as a GIF.
 *
 * The page exposes window.frame(k, total); we drive it frame by frame, take a
 * deterministic screenshot each time, and hand the stack of raw RGB frames to
 * sharp (libvips/cgif) as one tall multi-page buffer.
 *
 *   node render.mjs <page.html> <out.gif> <width> <height> <frames> <delayMs>
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const { chromium } = require('playwright')

const [page_, out, w, h, frames, delay, outW] = process.argv.slice(2)
const W = Number(w), H = Number(h), N = Number(frames), D = Number(delay)
const OW = outW ? Number(outW) : W
const OH = Math.round(H * OW / W)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(pathToFileURL(path.resolve(page_)).href, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)

const raw = Buffer.alloc(OW * OH * 3 * N)
for (let k = 0; k < N; k++) {
  await page.evaluate(([k, N]) => window.frame(k, N), [k, N])
  const png = await page.screenshot({ type: 'png' })
  const pipe = sharp(png).removeAlpha()
  if (OW !== W) pipe.resize(OW, OH, { kernel: 'lanczos3' })
  const { data } = await pipe.raw().toBuffer({ resolveWithObject: true })
  data.copy(raw, k * OW * OH * 3)
  process.stdout.write(`\rframe ${k + 1}/${N}`)
}
await browser.close()

await sharp(raw, { raw: { width: OW, height: OH * N, channels: 3, pageHeight: OH } })
  // a scalar `delay` only lands on the first page here; every frame needs its own.
  .gif({ loop: 0, delay: Array(N).fill(D), effort: 10, dither: 1, interFrameMaxError: 0, interPaletteMaxError: 3 })
  .toFile(out)

console.log(`\nwrote ${out}`)
