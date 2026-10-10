#!/usr/bin/env node
/**
 * Quantum Lab — pre-deploy preflight.
 *
 *   node scripts/preflight.mjs
 *
 * Exit code is 0 unless something is genuinely broken. WARN never fails the
 * run, because the defining property of this project is that it deploys and
 * works with a COMPLETELY EMPTY environment: no API keys, no database, no
 * payment provider. The course, the circuit simulator, the visualizations and
 * the offline tutor are all self-contained. Anything env-related is therefore
 * a warning about a feature you are choosing not to switch on — with one
 * exception, the Stripe half-configuration check below, which is a FAIL
 * because it silently charges real customers and then gives them nothing.
 *
 * Node builtins only. No dependencies, by design: this must run on a bare
 * runner before `npm install` has ever happened.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, s) => (useColor ? `[${code}m${s}[0m` : s)
const bold = (s) => paint('1', s)
const dim = (s) => paint('2', s)

const counts = { pass: 0, warn: 0, fail: 0 }

function pass(label, detail) {
  counts.pass++
  console.log(`${paint('32', 'PASS')}  ${label}${detail ? dim(` — ${detail}`) : ''}`)
}
function warn(label, detail) {
  counts.warn++
  console.log(`${paint('33', 'WARN')}  ${label}${detail ? ` — ${detail}` : ''}`)
}
function fail(label, detail) {
  counts.fail++
  console.log(`${paint('31', 'FAIL')}  ${label}${detail ? ` — ${detail}` : ''}`)
}
function note(text) {
  console.log(`      ${dim(text)}`)
}
function section(title) {
  console.log(`\n${bold(title)}`)
}

function readJson(relPath) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'))
  } catch {
    return null
  }
}

const env = (name) => (process.env[name] ?? '').trim()
const isSet = (name) => env(name).length > 0

// ---------------------------------------------------------------------------
// 1. Node version
// ---------------------------------------------------------------------------

section('Runtime')

{
  const major = Number(process.versions.node.split('.')[0])
  if (Number.isNaN(major)) {
    warn('Node version', `could not parse "${process.version}"`)
  } else if (major >= 18) {
    pass('Node version', `${process.version} (>= 18 required)`)
  } else {
    fail('Node version', `${process.version} — Next 14 requires Node >= 18.17`)
    note('Vercel and Railway both default to a supported Node; fix your local runtime.')
  }
}

// ---------------------------------------------------------------------------
// 2. Lockfile presence and agreement with the workspace package.json files
// ---------------------------------------------------------------------------

section('Dependencies')

const rootPkg = readJson('package.json')
const webPkg = readJson('apps/web/package.json')
const lock = readJson('package-lock.json')

if (!rootPkg) {
  fail('package.json', 'missing or unparseable at the repo root')
} else {
  pass('package.json', `${rootPkg.name}@${rootPkg.version}`)
}

if (!lock) {
  fail('package-lock.json', 'missing — `npm ci` (used by Docker and Vercel) cannot run without it')
  note('Fix: run `npm install` at the repo root and commit package-lock.json.')
} else if (!lock.packages) {
  warn('package-lock.json', `lockfileVersion ${lock.lockfileVersion} has no "packages" map; skipping the sync check`)
} else {
  pass('package-lock.json', `lockfileVersion ${lock.lockfileVersion}`)

  // Compare the declared dependency SET of each workspace against what the
  // lockfile recorded for that same workspace. A mismatch means someone edited
  // a package.json without re-running npm install, and `npm ci` will hard-fail
  // on the deploy runner with EUSAGE — after you have already pushed.
  const workspaces = [
    ['package.json', '', rootPkg],
    ['apps/web/package.json', 'apps/web', webPkg],
  ]

  let drift = 0
  for (const [label, lockKey, pkg] of workspaces) {
    if (!pkg) continue
    const declared = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    }
    const entry = lock.packages[lockKey]
    if (!entry) {
      fail(`lockfile sync (${label})`, `no "${lockKey || '<root>'}" entry in package-lock.json`)
      drift++
      continue
    }
    const recorded = {
      ...(entry.dependencies ?? {}),
      ...(entry.devDependencies ?? {}),
      ...(entry.optionalDependencies ?? {}),
    }

    const missing = Object.keys(declared).filter((d) => !(d in recorded))
    const extra = Object.keys(recorded).filter((d) => !(d in declared))
    const changed = Object.keys(declared).filter(
      (d) => d in recorded && recorded[d] !== declared[d]
    )

    if (missing.length || extra.length || changed.length) {
      drift++
      fail(`lockfile sync (${label})`, 'package.json and package-lock.json disagree')
      if (missing.length) note(`in package.json but not in the lock: ${missing.join(', ')}`)
      if (extra.length) note(`in the lock but not in package.json: ${extra.join(', ')}`)
      if (changed.length) {
        note(
          `range changed: ${changed.map((d) => `${d} (${recorded[d]} -> ${declared[d]})`).join(', ')}`
        )
      }
      note('Fix: run `npm install` at the repo root and commit the updated lockfile.')
    } else {
      pass(`lockfile sync (${label})`, `${Object.keys(declared).length} deps agree`)
    }
  }

  // The Docker build and Vercel both install from the ROOT. If the lockfile has
  // no entry for the workspace, a root-level `npm ci` will not install the web
  // app's dependencies at all and the build fails at `next build`.
  if (drift === 0 && webPkg && !lock.packages['apps/web']) {
    fail('workspace linkage', 'package-lock.json has no "apps/web" entry')
    note('The root `npm ci` used by the Dockerfile and by Vercel would not install web deps.')
  }
}

// ---------------------------------------------------------------------------
// 3. Build output expectations
// ---------------------------------------------------------------------------

section('Build output')

{
  const nextDir = join(ROOT, 'apps/web/.next')
  if (!existsSync(nextDir)) {
    pass('.next', 'absent — a clean build will create it (nothing to verify yet)')
  } else {
    const want = ['BUILD_ID', 'build-manifest.json', 'server', 'static']
    const have = new Set(readdirSync(nextDir))
    const absent = want.filter((f) => !have.has(f))
    if (absent.length) {
      warn('.next looks incomplete', `missing ${absent.join(', ')}`)
      note('A half-written .next usually means an interrupted build. Remove it and rebuild:')
      note('  rm -rf apps/web/.next && npm run build')
    } else {
      const buildId = readFileSync(join(nextDir, 'BUILD_ID'), 'utf8').trim()
      pass('.next', `complete build present (BUILD_ID ${buildId})`)
    }

    // Standalone output is what apps/web/Dockerfile ships. It only appears when
    // the build ran with NEXT_PRIVATE_STANDALONE=true (or output:'standalone').
    if (have.has('standalone')) {
      pass('.next/standalone', 'present — the standalone Docker image path is available')
    } else {
      pass(
        '.next/standalone',
        "absent — expected unless you built with NEXT_PRIVATE_STANDALONE=true (Vercel and `next start` do not need it)"
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Environment: what is set, what each thing unlocks, and that ZERO are required
// ---------------------------------------------------------------------------

section('Environment')

/** name, what setting it unlocks. Every one of these is optional. */
const ENV_TABLE = [
  ['ANTHROPIC_API_KEY', 'Live Claude tutor; without it the tutor uses the offline FAQ'],
  ['MODEL', 'Overrides the Anthropic model id (has a working default)'],
  ['NEXT_PUBLIC_APP_URL', 'Canonical URLs, OG tags, Stripe return URLs (defaults to localhost)'],
  ['NEXT_PUBLIC_API_URL', 'Points the web app at services/api (defaults to localhost:8000)'],
  ['AGENT_SERVICE_URL', 'Points /api/agent at services/agent'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'Accounts + saved progress; without it progress is local-only'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Client-side Supabase access'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Server-side Supabase writes (orgs, billing sync)'],
  ['STRIPE_SECRET_KEY', 'Checkout and billing; without it everyone is on the free plan'],
  ['STRIPE_WEBHOOK_SECRET', 'Verifies Stripe webhooks (from the endpoint, not the API keys page)'],
  ['STRIPE_PRICE_PRO_MONTHLY', 'Maps the Pro monthly price id to the Pro plan'],
  ['STRIPE_PRICE_PRO_YEARLY', 'Maps the Pro yearly price id to the Pro plan'],
  ['STRIPE_PRICE_TEAM_MONTHLY', 'Maps the Team monthly price id to the Team plan'],
  ['STRIPE_PRICE_TEAM_YEARLY', 'Maps the Team yearly price id to the Team plan'],
  ['NEXT_PUBLIC_SENTRY_DSN', 'Error reporting; absent = Sentry is not even wrapped in'],
  ['SENTRY_ORG', 'Sentry source-map upload target'],
  ['SENTRY_PROJECT', 'Sentry source-map upload target'],
  ['SENTRY_AUTH_TOKEN', 'Enables the source-map upload itself'],
  ['RESEND_API_KEY', 'Transactional email; without it email routes no-op'],
  ['EMAIL_FROM', 'From-address for Resend'],
  ['IBM_QUANTUM_TOKEN', 'The ibm_quantum hardware backend in services/api'],
  ['AWS_ACCESS_KEY_ID', 'The braket_local backend in services/api'],
  ['AWS_SECRET_ACCESS_KEY', 'The braket_local backend in services/api'],
  ['ALLOWED_ORIGINS', 'CORS origins accepted by services/api'],
  ['DEFAULT_BACKEND', 'Simulator used when a run names none (defaults to aer_simulator)'],
  ['NEXT_PUBLIC_ANALYTICS_ENDPOINT', 'Ships local-first analytics somewhere'],
]

{
  const nameWidth = Math.max(...ENV_TABLE.map(([n]) => n.length))
  const setNames = ENV_TABLE.filter(([n]) => isSet(n)).map(([n]) => n)

  console.log(dim('  All variables below are OPTIONAL. ZERO are required: with an entirely'))
  console.log(dim('  empty environment the course, simulator, visualizations and offline'))
  console.log(dim('  tutor all work. Each variable only unlocks something extra.'))
  console.log('')
  console.log(
    `  ${bold('status'.padEnd(6))}  ${bold('variable'.padEnd(nameWidth))}  ${bold('unlocks')}`
  )
  for (const [name, unlocks] of ENV_TABLE) {
    const status = isSet(name) ? paint('32', 'set   ') : dim('unset ')
    console.log(`  ${status}  ${name.padEnd(nameWidth)}  ${dim(unlocks)}`)
  }
  console.log('')
  pass('environment', `${setNames.length}/${ENV_TABLE.length} optional variables set, 0 required`)
}

// ---------------------------------------------------------------------------
// 5. Canonical URL in production
// ---------------------------------------------------------------------------

{
  const isProd = env('NODE_ENV') === 'production'
  if (!isSet('NEXT_PUBLIC_APP_URL')) {
    if (isProd) {
      warn('NEXT_PUBLIC_APP_URL', 'NOT SET while NODE_ENV=production')
      note('This is the single most commonly missed production variable.')
      note('Canonical <link> tags, sitemap entries and OG image URLs will all point at')
      note('http://localhost:3000 — search engines will index localhost, and social')
      note('previews will be blank. Stripe checkout success/cancel URLs are built from')
      note('the same value, so a real customer paying you gets redirected to a host that')
      note('does not exist on their machine. Nothing throws; it just quietly does this.')
      note('Fix: NEXT_PUBLIC_APP_URL=https://your-domain.example')
    } else {
      pass('NEXT_PUBLIC_APP_URL', 'unset, but NODE_ENV is not production — localhost is correct here')
    }
  } else {
    const value = env('NEXT_PUBLIC_APP_URL')
    if (isProd && /localhost|127\.0\.0\.1/.test(value)) {
      warn('NEXT_PUBLIC_APP_URL', `set to "${value}" while NODE_ENV=production`)
      note('Canonical URLs and Stripe redirects will point at localhost. Use the real domain.')
    } else if (!/^https?:\/\//.test(value)) {
      warn('NEXT_PUBLIC_APP_URL', `"${value}" has no scheme — use a full origin like https://example.com`)
    } else {
      pass('NEXT_PUBLIC_APP_URL', value)
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Stripe: half-configured billing is worse than no billing
// ---------------------------------------------------------------------------

section('Billing')

{
  const PRICE_VARS = [
    'STRIPE_PRICE_PRO_MONTHLY',
    'STRIPE_PRICE_PRO_YEARLY',
    'STRIPE_PRICE_TEAM_MONTHLY',
    'STRIPE_PRICE_TEAM_YEARLY',
  ]

  if (!isSet('STRIPE_SECRET_KEY')) {
    pass('Stripe', 'not configured — billing is off and every account is on the free plan')
    note('This is a supported, fully working configuration. Nothing else in this section applies.')
  } else {
    const missingPrices = PRICE_VARS.filter((n) => !isSet(n))
    if (missingPrices.length === 0) {
      pass('Stripe price ids', 'all four are set')
    } else {
      fail('Stripe price ids', `STRIPE_SECRET_KEY is set but ${missingPrices.join(', ')} ${missingPrices.length === 1 ? 'is' : 'are'} missing`)
      note('READ THIS ONE. Plan resolution works by matching the price id on the Stripe')
      note('subscription against these variables. An unset variable matches nothing, so the')
      note('webhook falls through to the FREE plan — for a customer who has just been')
      note('charged. Real money leaves their account and their entitlement is silently')
      note('downgraded to free; existing paying customers are downgraded on their next')
      note('renewal webhook. There is no error, no 500, no Stripe-side failure to alert on.')
      note('Do not deploy with a live secret key until all four price ids are set.')
      note('Get them from Stripe Dashboard -> Product catalogue -> your product -> pricing')
      note('(the id starts with price_, not prod_).')
    }

    if (isSet('STRIPE_WEBHOOK_SECRET')) {
      pass('STRIPE_WEBHOOK_SECRET', 'set')
    } else {
      warn('STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY is set but the webhook secret is not')
      note('Webhooks cannot be verified, so subscription state will never reach the app:')
      note('customers pay and stay on free until you set it. It comes from creating the')
      note('endpoint at /api/billing/webhook, NOT from the API keys page.')
    }

    const liveKey = env('STRIPE_SECRET_KEY').startsWith('sk_live_')
    const testPrices = PRICE_VARS.filter((n) => isSet(n) && !/^price_/.test(env(n)))
    if (testPrices.length) {
      warn('Stripe price id format', `${testPrices.join(', ')} does not look like a price id (expected price_...)`)
    }
    if (liveKey) {
      note('Live secret key detected — double-check the price ids come from live mode too;')
      note('test-mode price ids do not exist in live mode and resolve to the free plan.')
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Sentry consistency
// ---------------------------------------------------------------------------

section('Observability')

{
  if (!isSet('NEXT_PUBLIC_SENTRY_DSN')) {
    pass('Sentry', 'no DSN — the Sentry webpack plugin is not even loaded (faster builds)')
  } else {
    const missing = ['SENTRY_ORG', 'SENTRY_PROJECT'].filter((n) => !isSet(n))
    if (missing.length) {
      warn('Sentry config', `DSN is set but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing`)
      note('Errors will still be captured, but the build cannot associate a release with a')
      note('project, so source maps are not uploaded and every stack trace you receive will')
      note('be minified single-letter garbage. Both come from your Sentry project settings.')
    } else {
      pass('Sentry config', `${env('SENTRY_ORG')}/${env('SENTRY_PROJECT')}`)
    }
    if (!isSet('SENTRY_AUTH_TOKEN')) {
      warn('SENTRY_AUTH_TOKEN', 'not set — source-map upload is disabled, traces stay minified')
    } else {
      pass('SENTRY_AUTH_TOKEN', 'set — source maps will be uploaded')
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Python services
// ---------------------------------------------------------------------------

section('Python services')

for (const svc of ['services/api', 'services/agent']) {
  const req = join(ROOT, svc, 'requirements.txt')
  const dockerfile = join(ROOT, svc, 'Dockerfile')
  if (!existsSync(req)) {
    fail(`${svc}/requirements.txt`, 'missing — the Docker build cannot install dependencies')
  } else {
    const lines = readFileSync(req, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    if (lines.length === 0) {
      warn(`${svc}/requirements.txt`, 'present but empty')
    } else {
      pass(`${svc}/requirements.txt`, `${lines.length} requirement${lines.length === 1 ? '' : 's'}`)
    }
  }
  if (!existsSync(dockerfile)) {
    fail(`${svc}/Dockerfile`, 'missing — Railway is configured to build with DOCKERFILE')
  } else {
    pass(`${svc}/Dockerfile`, 'present')
  }
}

// ---------------------------------------------------------------------------
// 9. Stray local env file
// ---------------------------------------------------------------------------

section('Hygiene')

{
  const local = join(ROOT, 'apps/web/.env.local')
  if (existsSync(local)) {
    warn('apps/web/.env.local exists', 'it must never be committed or copied into an image')
    note('.gitignore and both .dockerignore files already exclude it — this is only a')
    note('reminder that real secrets are sitting in your working tree. Confirm with:')
    note('  git check-ignore -v apps/web/.env.local')
    note('Deployed environments get their values from Vercel / Railway / compose, not this file.')
  } else {
    pass('apps/web/.env.local', 'not present')
  }

  const rootEnv = join(ROOT, '.env')
  if (existsSync(rootEnv)) {
    note('A repo-root .env exists (used by docker compose locally). It is gitignored and')
    note('dockerignored; make sure it never reaches a registry image.')
  }

  for (const f of ['vercel.json', 'services/api/railway.json', 'services/agent/railway.json']) {
    if (!existsSync(join(ROOT, f))) {
      warn(`${f}`, 'missing — that deploy target will fall back to platform defaults')
    } else if (readJson(f) === null) {
      fail(`${f}`, 'is not valid JSON — the platform will reject the deploy')
    } else {
      pass(f, 'valid JSON')
    }
  }

  if (!existsSync(join(ROOT, 'apps/web/Dockerfile'))) {
    fail('apps/web/Dockerfile', 'missing — `docker compose up web` will fail')
  } else {
    pass('apps/web/Dockerfile', 'present')
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

section('Summary')

console.log(
  `  ${paint('32', `${counts.pass} pass`)}  ${paint('33', `${counts.warn} warn`)}  ${paint('31', `${counts.fail} fail`)}`
)

if (counts.fail > 0) {
  console.log(`\n${paint('31', 'Preflight FAILED.')} Fix the FAIL lines above before deploying.`)
  process.exit(1)
}

if (counts.warn > 0) {
  console.log(
    `\n${paint('33', 'Preflight passed with warnings.')} Every warning is an optional feature you have`
  )
  console.log('not switched on, or a production detail worth a second look. Deploying is safe.')
} else {
  console.log(`\n${paint('32', 'Preflight passed.')} Ready to deploy.`)
}

process.exit(0)
