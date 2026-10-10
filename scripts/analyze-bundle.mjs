#!/usr/bin/env node
/**
 * analyze-bundle.mjs — dependency-free First Load JS reporter.
 *
 * Reads `.next/build-manifest.json` and `.next/app-build-manifest.json`, resolves
 * every chunk a route loads to a file on disk, sums the raw byte sizes, and prints
 * a table sorted by total. Routes more than 1.5x the median are flagged, and the
 * largest chunks shared by all routes are listed separately.
 *
 * Why this exists: `next build` prints First Load JS once, into a terminal that
 * scrolls away, in gzipped-ish rounded kB with no attribution. This makes the same
 * finding reproducible and diffable — run it before and after a change and the
 * numbers are directly comparable.
 *
 * Note on units: sizes here are RAW (uncompressed) bytes on disk. `next build`
 * reports compressed sizes, so absolute numbers differ; RATIOS and DELTAS between
 * runs of this script are what matter.
 *
 * Usage:  npm run build && node scripts/analyze-bundle.mjs
 *         node scripts/analyze-bundle.mjs --dir apps/web/.next --json
 */

import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const asJson = argv.includes('--json')

const NEXT_DIR = resolve(REPO_ROOT, flag('--dir') ?? 'apps/web/.next')

function die(msg) {
  console.error(`analyze-bundle: ${msg}`)
  process.exit(1)
}

if (!existsSync(NEXT_DIR)) {
  die(`no build found at ${NEXT_DIR}. Run \`npm run build\` first.`)
}

function readJson(p) {
  if (!existsSync(p)) die(`missing manifest ${p}. Run \`npm run build\` first.`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

const buildManifest = readJson(join(NEXT_DIR, 'build-manifest.json'))
const appManifest = readJson(join(NEXT_DIR, 'app-build-manifest.json'))

/** Chunk path (relative to .next) -> size in bytes, memoised. */
const sizeCache = new Map()
function chunkSize(chunk) {
  if (sizeCache.has(chunk)) return sizeCache.get(chunk)
  // Manifest entries are relative to `.next/`, e.g. "static/chunks/foo.js".
  const abs = join(NEXT_DIR, chunk)
  let size = 0
  try {
    size = statSync(abs).size
  } catch {
    size = 0 // a manifest entry with no file on disk contributes nothing
  }
  sizeCache.set(chunk, size)
  return size
}

/**
 * Routes. App-router entries look like "/visualizations/bloch-sphere/page";
 * strip the trailing segment to get the URL path. Non-page entries (layout,
 * global-error, template) are infrastructure, not routes, so they are excluded
 * from the table but still counted when computing what is shared.
 */
const routeEntries = []
for (const [key, chunks] of Object.entries(appManifest.pages ?? {})) {
  if (!key.endsWith('/page')) continue
  const route = key.slice(0, -'/page'.length) || '/'
  routeEntries.push({ route, chunks: [...new Set(chunks)] })
}

// Pages-router routes, if any, come from build-manifest.json.
for (const [key, chunks] of Object.entries(buildManifest.pages ?? {})) {
  if (key.startsWith('/_')) continue
  if (routeEntries.some((r) => r.route === key)) continue
  routeEntries.push({ route: key, chunks: [...new Set(chunks)] })
}

if (routeEntries.length === 0) die('no routes found in the manifests.')

// A chunk is "shared by all" when every route loads it. That is the cost every
// visitor pays regardless of where they land, so it is budgeted separately.
const routeCount = routeEntries.length
const chunkUseCount = new Map()
for (const { chunks } of routeEntries) {
  for (const c of chunks) chunkUseCount.set(c, (chunkUseCount.get(c) ?? 0) + 1)
}
const sharedChunks = [...chunkUseCount.entries()]
  .filter(([, n]) => n === routeCount)
  .map(([c]) => c)
const sharedSet = new Set(sharedChunks)
const sharedTotal = sharedChunks.reduce((a, c) => a + chunkSize(c), 0)

const rows = routeEntries
  .map(({ route, chunks }) => {
    const total = chunks.reduce((a, c) => a + chunkSize(c), 0)
    const own = chunks.filter((c) => !sharedSet.has(c))
    return {
      route,
      total,
      shared: total - own.reduce((a, c) => a + chunkSize(c), 0),
      routeSpecific: own.reduce((a, c) => a + chunkSize(c), 0),
      chunkCount: chunks.length,
      largestOwn: own.sort((a, b) => chunkSize(b) - chunkSize(a)).slice(0, 3),
    }
  })
  .sort((a, b) => b.total - a.total)

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const med = median(rows.map((r) => r.total))
const THRESHOLD = med * 1.5

const kb = (b) => (b / 1024).toFixed(1)

if (asJson) {
  console.log(
    JSON.stringify(
      {
        nextDir: NEXT_DIR,
        routeCount,
        medianBytes: med,
        thresholdBytes: THRESHOLD,
        sharedTotalBytes: sharedTotal,
        sharedChunks: sharedChunks
          .map((c) => ({ chunk: c, bytes: chunkSize(c) }))
          .sort((a, b) => b.bytes - a.bytes),
        routes: rows,
      },
      null,
      2
    )
  )
  process.exit(0)
}

const W = 44
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

console.log(`\nFirst Load JS by route — raw bytes on disk from ${NEXT_DIR.replace(REPO_ROOT + '/', '')}`)
console.log(`${routeCount} routes · median ${kb(med)} kB · flag threshold 1.5x = ${kb(THRESHOLD)} kB\n`)

console.log(`${pad('Route', W)}${lpad('Total kB', 10)}${lpad('Shared', 10)}${lpad('Route-specific', 16)}  `)
console.log('-'.repeat(W + 36 + 2))
for (const r of rows) {
  const over = r.total > THRESHOLD
  console.log(
    `${pad(r.route, W)}${lpad(kb(r.total), 10)}${lpad(kb(r.shared), 10)}${lpad(kb(r.routeSpecific), 16)}  ${
      over ? `<< ${(r.total / med).toFixed(2)}x median` : ''
    }`
  )
}

const flagged = rows.filter((r) => r.total > THRESHOLD)
console.log(`\nFlagged (> 1.5x median): ${flagged.length}`)
for (const r of flagged) {
  console.log(`  ${r.route}  (${kb(r.total)} kB, ${kb(r.routeSpecific)} kB route-specific)`)
  for (const c of r.largestOwn) {
    console.log(`      ${lpad(kb(chunkSize(c)), 9)} kB  ${c}`)
  }
}

console.log(`\nShared by all ${routeCount} routes: ${kb(sharedTotal)} kB across ${sharedChunks.length} chunks`)
for (const c of sharedChunks.sort((a, b) => chunkSize(b) - chunkSize(a)).slice(0, 10)) {
  console.log(`  ${lpad(kb(chunkSize(c)), 9)} kB  ${c}`)
}
console.log('')
