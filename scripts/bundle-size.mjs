#!/usr/bin/env node
/**
 * bundle-size.mjs — per-route First Load JS, in the same units `next build` prints,
 * plus a budget gate that fails CI by name and overage.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT scripts/analyze-bundle.mjs
 * ------------------------------------------------------------
 * `analyze-bundle.mjs` reports RAW bytes on disk and flags outliers relative to the
 * median of the same build. That is useful for attribution ("which chunk is fat")
 * but it cannot catch a regression: if every route grows 30 kB, the median grows
 * with them and nothing is ever flagged. It also cannot be compared with the
 * numbers in docs/PERFORMANCE.md, which are `next build`'s compressed kB.
 *
 * This script measures the same thing `next build` measures, against a fixed
 * budget file, so "the bundle got bigger" is a build failure rather than a number
 * that scrolls past in a log.
 *
 * HOW THE UNITS WERE CALIBRATED (measured, not assumed)
 * -----------------------------------------------------
 * Next 14 computes First Load JS as the gzip size of the route's entry chunk list
 * from `app-build-manifest.json` (polyfills excluded — they are reported on their
 * own line), at zlib's DEFAULT level, printed with kB = 1000 bytes.
 *
 * Reproducing that here and comparing against the `next build` numbers recorded in
 * docs/PERFORMANCE.md for the seven /visualizations/* routes that nothing has
 * touched since they were recorded:
 *
 *     route                              next build   this script
 *     /visualizations/qft                   108 kB       108.5 kB
 *     /visualizations/superposition         111 kB       110.9 kB
 *     /visualizations/grover                110 kB       110.0 kB
 *     /visualizations/entanglement          110 kB       110.1 kB
 *     /visualizations/bloch-sphere          108 kB       107.5 kB
 *     /visualizations/tunneling             105 kB       104.6 kB
 *     /visualizations/decoherence           103 kB       102.9 kB
 *     /                                    96.3 kB        95.9 kB
 *
 * Worst disagreement 0.5 kB, and `next build` rounds to three significant figures,
 * so that is rounding, not method error. DO NOT "improve" this by switching to
 * gzip level 9 or to kB = 1024: level 9 shifts every number ~0.2 kB low and 1024
 * shifts them ~2.4% low, and the budgets in bundle-budgets.json are stated in
 * these units.
 *
 * THAT CALIBRATION NO LONGER HOLDS, AND CANNOT BE REDONE (Next 16 / Turbopack)
 * ---------------------------------------------------------------------------
 * The table above is kept as history, not as a current claim. Two things broke
 * it, and neither is recoverable by tweaking this script:
 *
 *   1. Turbopack does not emit `app-build-manifest.json`, so the chunk list is
 *      now read from each route's prerendered HTML (see the note further down).
 *   2. Turbopack's build output no longer PRINTS a per-route "First Load JS"
 *      column at all, so there is no `next build` number left to agree with.
 *
 * The units are unchanged (gzip at zlib default, kB = 1000) but the measurement
 * is now "every .js the prerendered page references", and Turbopack splits
 * chunks differently from webpack. Measured numbers came out roughly double the
 * webpack-era budgets on the same routes. That is a change of RULER, not
 * necessarily of payload, and the two sets of numbers must not be compared:
 * bundle-budgets.json was therefore re-baselined in the same commit rather than
 * scaled. Treat the budgets as a regression guard from that point forward — a
 * route growing 10% over its recorded size is still exactly what this catches,
 * which is the job the file actually has.
 *
 * USAGE
 *   node scripts/bundle-size.mjs                 # table + budget check, exits 1 on overage
 *   node scripts/bundle-size.mjs --report        # table only, always exits 0
 *   node scripts/bundle-size.mjs --json          # machine-readable, always exits 0
 *   node scripts/bundle-size.mjs --update        # rewrite budgets from this build
 *   node scripts/bundle-size.mjs --dir path/.next
 *
 * It reads a build that already exists on disk. It never runs `next build` — that
 * is the CI step's job, and running one here would clobber a concurrent build.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const i = argv.indexOf(f)
  return i === -1 ? null : argv[i + 1]
}

const NEXT_DIR = resolve(REPO_ROOT, val('--dir') ?? 'apps/web/.next')
const BUDGET_FILE = resolve(REPO_ROOT, 'scripts/bundle-budgets.json')

/**
 * The margin between "what it measures today" and "what CI refuses".
 *
 * 10% is not a round number picked for looking reasonable. Two things had to fit
 * under it and one had to not:
 *  - Build-to-build drift with no source change on the route: docs/PERFORMANCE.md's
 *    before/after tables show +1 to +2 kB on 96-166 kB routes that the work did not
 *    touch, i.e. ~1-2%. 10% is five times that noise floor.
 *  - Ordinary feature work on a page: a new component or two.
 * And the thing it must NOT absorb: the two regressions this repo has actually had.
 * three.js on a route is +131 kB (+120%). The Supabase client arriving on a route is
 * +33 kB, which is +16% of the smallest budgeted route and +21% of /circuits. Both
 * trip a 10% margin on any route in the table.
 */
const MARGIN = 0.1

function die(msg) {
  console.error(`bundle-size: ${msg}`)
  process.exit(1)
}

if (!existsSync(NEXT_DIR)) {
  die(
    `no build found at ${NEXT_DIR}.\n` +
      `  This script reads an existing build; it does not create one.\n` +
      `  Run \`npm run build --workspace=web\` first.`,
  )
}

function readJson(p) {
  if (!existsSync(p)) die(`missing manifest ${p} — the build at ${NEXT_DIR} is incomplete.`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

const buildManifest = readJson(join(NEXT_DIR, 'build-manifest.json'))

/**
 * WHERE THE PER-ROUTE CHUNK LIST COMES FROM — and why this changed.
 *
 * Until Next 15 this script read `app-build-manifest.json`, which mapped every
 * app route to its entry chunks. Next 16 builds with Turbopack and DOES NOT
 * EMIT THAT FILE AT ALL, so the script died on a missing manifest and the
 * Bundle budgets step had been failing on every push since the upgrade — a red
 * check that was measuring nothing.
 *
 * `next build` is no longer a fallback either: Turbopack's build output has
 * dropped the per-route "Size / First Load JS" table the header's calibration
 * was matched against, so there is no printed number left to agree with.
 *
 * The replacement reads the PRERENDERED HTML each route actually ships and
 * takes the script URLs out of it. That is a better source than a manifest, not
 * merely an available one: it is what the browser is really told to download
 * for that page, so it cannot drift from the served bytes the way a manifest
 * can. It is also bundler-agnostic, which is the property that would have
 * prevented this breakage.
 *
 * The webpack path is kept: if `app-build-manifest.json` is present (an older
 * Next, or `--turbo` off) it is preferred, so this script keeps working on both
 * and a bisect across the upgrade still measures.
 */
const APP_DIR = join(NEXT_DIR, 'server', 'app')

/** Every prerendered HTML file, as [absolute path, concrete url path]. */
function prerenderedPages() {
  const out = []
  const walk = (dir, urlPrefix) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, `${urlPrefix}/${e.name}`)
      } else if (e.name.endsWith('.html')) {
        const base = e.name.slice(0, -'.html'.length)
        // `index.html` is the directory itself; `about.html` is `/about`.
        const url = base === 'index' ? urlPrefix || '/' : `${urlPrefix}/${base}`
        out.push([full, url || '/'])
      }
    }
  }
  walk(APP_DIR, '')
  return out
}

/**
 * Chunk paths (relative to NEXT_DIR, matching gzipBytes) referenced by one page.
 *
 * Both `src` and `href` are read: Turbopack emits the entry as <script src> and
 * preloads the rest with <link href>, and a page's first load is all of them.
 * Polyfills are excluded because `next build` reported them on their own line
 * and the budgets were written in those units.
 */
const POLYFILLS = new Set((buildManifest.polyfillFiles ?? []).map((f) => `/_next/${f}`))
function chunksFromHtml(file) {
  const html = readFileSync(file, 'utf8')
  const found = new Set()
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)) {
    if (!POLYFILLS.has(m[1])) found.add(m[1].replace('/_next/', ''))
  }
  return [...found]
}

/** `/learn/[slug]` -> a regex that matches `/learn/what-is-a-qubit`. */
function patternToRegex(pattern) {
  const body = pattern
    .split('/')
    .map((seg) =>
      seg.startsWith('[...') || seg.startsWith('[[...')
        ? '.+'
        : seg.startsWith('[')
          ? '[^/]+'
          : seg.replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c),
    )
    .join('/')
  return new RegExp(`^${body}$`)
}

const gzCache = new Map()
/** Gzip size of one chunk, in bytes. Missing file = 0 rather than a crash. */
function gzipBytes(chunk) {
  if (gzCache.has(chunk)) return gzCache.get(chunk)
  let size = 0
  try {
    // Default zlib level on purpose — see the calibration note in the header.
    size = gzipSync(readFileSync(join(NEXT_DIR, chunk))).length
  } catch {
    size = 0
  }
  gzCache.set(chunk, size)
  return size
}

/** kB as `next build` prints it: 1000 bytes, one decimal. */
const kb = (bytes) => Number((bytes / 1000).toFixed(1))

const routes = []
const skipped = []

const legacyAppManifest = join(NEXT_DIR, 'app-build-manifest.json')
if (existsSync(legacyAppManifest)) {
  // Webpack build (Next <= 15, or Turbopack disabled). Original path, unchanged.
  const appManifest = JSON.parse(readFileSync(legacyAppManifest, 'utf8'))
  for (const [key, chunks] of Object.entries(appManifest.pages ?? {})) {
    if (!key.endsWith('/page')) continue
    const route = key.slice(0, -'/page'.length) || '/'
    routes.push({ route, chunks: [...new Set(chunks)] })
  }
} else {
  // Turbopack build: derive each route's chunks from the HTML it prerendered.
  const routeManifest = readJson(join(NEXT_DIR, 'app-path-routes-manifest.json'))
  const pages = prerenderedPages()
  const patterns = [...new Set(Object.values(routeManifest))]
    // Route handlers under /api ship no client JS and have no HTML.
    .filter((r) => typeof r === 'string' && !r.startsWith('/api/'))
    /*
     * Metadata routes are files, not pages: favicons, opengraph images,
     * robots.txt, the RSS feed, sitemaps. They load no client JS, they never
     * had a budget, and leaving them in made the "not measured" line 63 entries
     * long — which is how a genuinely useful warning gets ignored.
     */
    .filter((r) => !/\.(png|jpe?g|svg|ico|xml|txt|webmanifest)$/.test(r))
    .filter((r) => !/(^|\/)(opengraph-image|twitter-image|sitemap|robots|manifest)(\/|$)/.test(r))

  for (const pattern of patterns) {
    const re = patternToRegex(pattern)
    // A dynamic route is measured through ONE of its prerendered instances:
    // every instance loads the same entry chunks, which is what is budgeted.
    const hit = pages.find(([, url]) => re.test(url))
    if (!hit) {
      skipped.push(pattern)
      continue
    }
    routes.push({ route: pattern, chunks: chunksFromHtml(hit[0]) })
  }
}

if (routes.length === 0) die('no page routes found — the build at ' + NEXT_DIR + ' is incomplete.')

/*
 * NO SILENT CAPS. A route that is server-rendered on demand prerenders no HTML,
 * so it cannot be measured this way. Saying so is the difference between "all
 * routes are within budget" and "all MEASURABLE routes are within budget"; the
 * latter is the true claim and the reader is entitled to it.
 */
if (skipped.length > 0 && !has('--json')) {
  console.error(
    `bundle-size: ${skipped.length} route(s) prerender no HTML and were NOT measured: ` +
      `${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ', …' : ''}`,
  )
}

// Chunks every route loads. Everyone pays for these no matter where they land, so
// they get their own budget line: a 10 kB regression here is 10 kB x every route.
const useCount = new Map()
for (const { chunks } of routes) for (const c of chunks) useCount.set(c, (useCount.get(c) ?? 0) + 1)
const sharedChunks = [...useCount.entries()].filter(([, n]) => n === routes.length).map(([c]) => c)
const sharedKb = kb(sharedChunks.reduce((a, c) => a + gzipBytes(c), 0))

const measured = routes
  .map(({ route, chunks }) => ({ route, kb: kb(chunks.reduce((a, c) => a + gzipBytes(c), 0)) }))
  .sort((a, b) => b.kb - a.kb)

// --------------------------------------------------------------------------- json
if (has('--json')) {
  console.log(
    JSON.stringify(
      {
        nextDir: NEXT_DIR,
        buildId: existsSync(join(NEXT_DIR, 'BUILD_ID'))
          ? readFileSync(join(NEXT_DIR, 'BUILD_ID'), 'utf8').trim()
          : null,
        units: 'kB, gzip at zlib default, 1000 bytes. Sum of the .js referenced by the prerendered HTML for each route, polyfills excluded. NOT comparable to pre-Next-16 numbers - see the header.',
        sharedByAllKb: sharedKb,
        routes: measured,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

// ------------------------------------------------------------------------- update
function budgetFor(k) {
  // Round up to 0.5 kB so the file reads as a decision rather than a measurement.
  return Math.ceil(k * (1 + MARGIN) * 2) / 2
}

if (has('--update')) {
  const next = {
    _comment: [
      'Per-route First Load JS budgets, in kB (gzip, 1000 bytes) — the units',
      '`next build` prints. Enforced by scripts/bundle-size.mjs, which CI runs',
      'after the web build.',
      '',
      `Each budget is the measured size at the time of writing plus ${MARGIN * 100}%,`,
      'rounded up to 0.5 kB. The margin is justified in bundle-size.mjs.',
      '',
      'If a change legitimately makes a route bigger, RAISE THE NUMBER IN THIS FILE',
      'in the same commit and say why in the message. Do not raise it to make a red',
      'build green without knowing what grew — run',
      '`node scripts/bundle-size.mjs --report` and compare.',
      '',
      'A route with no entry here FAILS the check. That is deliberate: a new route',
      'is exactly when a budget is cheapest to set.',
    ],
    _measuredAgainstBuildId: existsSync(join(NEXT_DIR, 'BUILD_ID'))
      ? readFileSync(join(NEXT_DIR, 'BUILD_ID'), 'utf8').trim()
      : null,
    _generated: new Date().toISOString().slice(0, 10),
    sharedByAllKb: budgetFor(sharedKb),
    routes: Object.fromEntries(
      [...measured].sort((a, b) => a.route.localeCompare(b.route)).map((r) => [r.route, budgetFor(r.kb)]),
    ),
  }
  writeFileSync(BUDGET_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(`bundle-size: wrote ${routes.length} route budgets to ${BUDGET_FILE}`)
  process.exit(0)
}

// -------------------------------------------------------------------------- table
const W = 38
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

console.log(`\nFirst Load JS — ${routes.length} routes, gzip kB, from ${NEXT_DIR.replace(REPO_ROOT + '/', '')}`)

const budgets = has('--report') || !existsSync(BUDGET_FILE) ? null : readJson(BUDGET_FILE)
if (!budgets && !has('--report')) {
  die(`no budget file at ${BUDGET_FILE}. Create it with \`node scripts/bundle-size.mjs --update\`.`)
}

console.log(`${pad('Route', W)}${lpad('kB', 8)}${budgets ? lpad('budget', 9) + lpad('headroom', 10) : ''}`)
console.log('-'.repeat(W + (budgets ? 27 : 8)))
for (const r of measured) {
  const b = budgets?.routes?.[r.route]
  const head = typeof b === 'number' ? `${(b - r.kb).toFixed(1)}` : budgets ? 'NO BUDGET' : ''
  console.log(
    `${pad(r.route, W)}${lpad(r.kb.toFixed(1), 8)}${
      budgets ? lpad(typeof b === 'number' ? b.toFixed(1) : '—', 9) + lpad(head, 10) : ''
    }`,
  )
}
console.log(
  `${pad('(shared by all routes)', W)}${lpad(sharedKb.toFixed(1), 8)}${
    budgets ? lpad(String(budgets.sharedByAllKb ?? '—'), 9) : ''
  }`,
)

if (has('--report') || !budgets) {
  console.log('')
  process.exit(0)
}

// -------------------------------------------------------------------------- check
const over = []
const unbudgeted = []

for (const r of measured) {
  const b = budgets.routes?.[r.route]
  if (typeof b !== 'number') {
    unbudgeted.push(r)
    continue
  }
  if (r.kb > b) over.push({ ...r, budget: b })
}

if (typeof budgets.sharedByAllKb === 'number' && sharedKb > budgets.sharedByAllKb) {
  over.push({ route: '(shared by all routes)', kb: sharedKb, budget: budgets.sharedByAllKb })
}

const gone = Object.keys(budgets.routes ?? {}).filter((r) => !measured.some((m) => m.route === r))

console.log('')
if (gone.length) {
  // A deleted route is not a failure — but a budget for a route that no longer
  // exists is dead weight that will confuse the next person, so say so.
  console.log(`bundle-size: ${gone.length} budgeted route(s) not in this build — remove from bundle-budgets.json:`)
  for (const r of gone) console.log(`    ${r}`)
  console.log('')
}

if (unbudgeted.length) {
  console.error(`bundle-size: FAIL — ${unbudgeted.length} route(s) have no budget.\n`)
  for (const r of unbudgeted) {
    console.error(`    ${r.route}  measures ${r.kb.toFixed(1)} kB and is not in scripts/bundle-budgets.json`)
  }
  console.error(
    `\n  A new route without a budget is how the next regression gets in unseen.\n` +
      `  Add it to scripts/bundle-budgets.json (suggested: ${unbudgeted
        .map((r) => `${r.route} → ${budgetFor(r.kb).toFixed(1)}`)
        .join(', ')}),\n` +
      `  or regenerate the whole file with \`node scripts/bundle-size.mjs --update\`.`,
  )
}

if (over.length) {
  console.error(`bundle-size: FAIL — ${over.length} route(s) over budget.\n`)
  for (const r of over) {
    const delta = r.kb - r.budget
    const pct = ((delta / r.budget) * 100).toFixed(1)
    console.error(
      `    ${r.route}\n` +
        `        ${r.kb.toFixed(1)} kB  vs budget ${r.budget.toFixed(1)} kB  ` +
        `— OVER BY ${delta.toFixed(1)} kB (+${pct}%)`,
    )
  }
  console.error(
    `\n  Find what grew:  node scripts/bundle-size.mjs --report\n` +
      `  Attribute it:    node scripts/analyze-bundle.mjs   (raw bytes, per-chunk)\n` +
      `  The usual causes are a server-only module pulled into a client component and\n` +
      `  a heavy dependency imported statically instead of through next/dynamic.\n` +
      `  docs/PERFORMANCE.md § "Third-party weight" lists what each route is expected\n` +
      `  to be paying for.`,
  )
}

if (over.length || unbudgeted.length) process.exit(1)

console.log(`bundle-size: OK — ${measured.length} routes within budget, shared ${sharedKb.toFixed(1)} kB.`)
