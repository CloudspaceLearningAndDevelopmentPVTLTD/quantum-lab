#!/usr/bin/env node
/**
 * stripe-smoke.mjs — is the Stripe TEST-MODE wiring actually complete?
 *
 * WHY THIS EXISTS
 * ---------------
 * Every failure mode of the Stripe setup in docs/STRIPE-SETUP.md is silent from
 * the app's point of view: a wrong price id means the webhook downgrades a
 * paying customer to free, a live key means real money, a missing webhook
 * secret means every delivery 400s while checkout looks fine. Each of those
 * costs an afternoon when discovered from behaviour. This script asks Stripe
 * directly and prints one pass/fail line per claim, so "is my setup right?" is
 * one command instead of a debugging session.
 *
 * WHAT IT CHECKS
 *   1. STRIPE_SECRET_KEY is set, looks like a secret key, and is TEST mode.
 *   2. The key is accepted by the live API (GET /v1/balance).
 *   3. Each of the four STRIPE_PRICE_* vars is set, and the price it names
 *      exists with the exact amount/currency/interval lib/plans.ts sells.
 *   4. STRIPE_WEBHOOK_SECRET is set and whsec_-shaped.
 *   5. A dashboard webhook endpoint pointing at /api/billing/webhook exists —
 *      INFORMATIONAL only, because local dev uses `stripe listen`, which
 *      registers nothing. It never fails the run.
 *
 * The expected amounts are duplicated from apps/web/lib/plans.ts on purpose:
 * this is a plain-node script (no TS, no imports from the app), and the four
 * numbers are the product's price list — if they change, the docs, the
 * dashboard and this file all have to change together anyway.
 *
 * SECRETS: the key is sent only to api.stripe.com as HTTP basic auth and is
 * NEVER printed — not on success, not in error messages, not in --help.
 *
 * USAGE
 *   node --env-file=apps/web/.env.local scripts/stripe-smoke.mjs
 *   node scripts/stripe-smoke.mjs            # if the vars are already exported
 *
 * Exits 0 when every required check passes, 1 otherwise (including no key).
 * Uses only node built-ins (global fetch, node >= 18) — no new dependencies.
 */

const API = 'https://api.stripe.com/v1'

// The contract from apps/web/lib/plans.ts (`price` is in cents,
// `stripePriceEnv` names the vars). See the header for why it is duplicated.
const EXPECTED_PRICES = [
  { env: 'STRIPE_PRICE_PRO_MONTHLY', plan: 'Pro', unitAmount: 1900, interval: 'month', label: '$19.00 / month' },
  { env: 'STRIPE_PRICE_PRO_YEARLY', plan: 'Pro', unitAmount: 19000, interval: 'year', label: '$190.00 / year' },
  { env: 'STRIPE_PRICE_TEAM_MONTHLY', plan: 'Team', unitAmount: 9900, interval: 'month', label: '$99.00 / month' },
  { env: 'STRIPE_PRICE_TEAM_YEARLY', plan: 'Team', unitAmount: 99000, interval: 'year', label: '$990.00 / year' },
]

const results = []
/** kind: 'pass' | 'fail' | 'info' — info never affects the exit code. */
function record(kind, name, detail = '') {
  results.push({ kind, name, detail })
}

const KEY = (process.env.STRIPE_SECRET_KEY ?? '').trim()

// ── the no-key case, first and friendly ─────────────────────────────────────
if (!KEY) {
  console.log(
    '\nstripe-smoke: STRIPE_SECRET_KEY is not set, so there is nothing to check yet.\n\n' +
      '  Get a TEST key (sk_test_…) from the Stripe dashboard → Developers → API keys,\n' +
      '  put it in apps/web/.env.local, then run:\n\n' +
      '    node --env-file=apps/web/.env.local scripts/stripe-smoke.mjs\n\n' +
      '  Full walkthrough: docs/STRIPE-SETUP.md\n'
  )
  process.exit(1)
}

/**
 * One Stripe GET. Returns { ok, status, body } and never throws — a network
 * failure must read as a failed check with a reason, not a stack trace.
 * The key travels only in the Authorization header, to api.stripe.com.
 */
async function stripeGet(path) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${KEY}:`).toString('base64')}` },
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    return { ok: false, status: 0, body: { error: { message: String(err?.message ?? err) } } }
  }
}

/** Stripe error message with anything key-shaped removed, belt and braces. */
function safeError(body) {
  const msg = body?.error?.message ?? 'no error detail'
  return msg.replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_…[redacted]')
}

// ── 1. key shape and mode (no network needed) ───────────────────────────────
if (KEY.startsWith('sk_test_') || KEY.startsWith('rk_test_')) {
  record('pass', 'Key is a TEST-mode secret key')
} else if (KEY.startsWith('sk_live_') || KEY.startsWith('rk_live_')) {
  // Not a warning: everything downstream of a live key is real money, and this
  // script exists to verify the TEST setup.
  record('fail', 'Key is a LIVE key', 'this checklist is for test mode — use the sk_test_… key (docs/STRIPE-SETUP.md §1)')
} else if (KEY.startsWith('pk_')) {
  record('fail', 'Key is a PUBLISHABLE key', 'STRIPE_SECRET_KEY needs the secret key (sk_test_…), not pk_…')
} else {
  record('fail', 'Key does not look like a Stripe secret key', 'expected an sk_test_… value')
}

// ── 2. key accepted by the API ──────────────────────────────────────────────
// /v1/balance is the cheapest authenticated call and its response carries
// `livemode`, which cross-checks the prefix above against Stripe's own view.
const balance = await stripeGet('/balance')
if (balance.ok) {
  record('pass', 'Key accepted by the Stripe API')
  if (balance.body.livemode === true) {
    record('fail', 'API reports livemode=true', 'this key operates on real money')
  }
} else {
  record(
    'fail',
    'Key rejected by the Stripe API',
    balance.status === 401 ? 'invalid or revoked key' : `HTTP ${balance.status}: ${safeError(balance.body)}`
  )
}

// ── 3. the four prices ──────────────────────────────────────────────────────
// Only meaningful with a working key; without one, every lookup would fail
// with the same 401 and bury the real finding in noise.
if (balance.ok) {
  for (const expected of EXPECTED_PRICES) {
    const id = (process.env[expected.env] ?? '').trim()
    const name = `${expected.env} → ${expected.plan} ${expected.label}`
    if (!id) {
      record('fail', name, 'env var not set — an unset price id silently downgrades a paying subscriber to free')
      continue
    }
    const res = await stripeGet(`/prices/${encodeURIComponent(id)}`)
    if (!res.ok) {
      record(
        'fail',
        name,
        res.status === 404
          ? `no price with this id in this account/mode (test vs live mode have separate prices)`
          : `HTTP ${res.status}: ${safeError(res.body)}`
      )
      continue
    }
    const p = res.body
    const problems = []
    if (p.unit_amount !== expected.unitAmount) {
      problems.push(`amount is ${p.unit_amount}¢, expected ${expected.unitAmount}¢`)
    }
    if ((p.currency ?? '').toLowerCase() !== 'usd') problems.push(`currency is ${p.currency}, expected usd`)
    if (!p.recurring) problems.push('price is one-time, expected recurring')
    else if (p.recurring.interval !== expected.interval) {
      problems.push(`interval is ${p.recurring.interval}, expected ${expected.interval}`)
    }
    if (p.active === false) problems.push('price is archived (inactive)')
    if (problems.length) record('fail', name, problems.join('; '))
    else record('pass', name)
  }
} else {
  record('info', 'Price checks skipped', 'fix the key first')
}

// ── 4. webhook signing secret ───────────────────────────────────────────────
const WHSEC = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim()
if (!WHSEC) {
  record('fail', 'STRIPE_WEBHOOK_SECRET is set', 'unset — copy the whsec_… that `stripe listen` prints (docs/STRIPE-SETUP.md §4)')
} else if (!WHSEC.startsWith('whsec_')) {
  record(
    'fail',
    'STRIPE_WEBHOOK_SECRET is set',
    'value does not start with whsec_ — an sk_… here makes every webhook fail signature verification'
  )
} else {
  record('pass', 'STRIPE_WEBHOOK_SECRET is set and whsec_-shaped')
}

// ── 5. dashboard webhook endpoint (informational) ───────────────────────────
// `stripe listen` registers no endpoint, so absence is NORMAL in local dev.
// This only tells a production deployer whether Stripe has anywhere to push.
if (balance.ok) {
  const hooks = await stripeGet('/webhook_endpoints?limit=100')
  if (!hooks.ok) {
    record('info', 'Webhook endpoint listing failed', `HTTP ${hooks.status}: ${safeError(hooks.body)}`)
  } else {
    const match = (hooks.body.data ?? []).find(
      (e) => typeof e.url === 'string' && e.url.includes('/api/billing/webhook') && e.status === 'enabled'
    )
    if (match) {
      record('info', `Dashboard webhook endpoint found: ${match.url}`, 'needed for production; its own signing secret must be the deployed STRIPE_WEBHOOK_SECRET')
    } else {
      record(
        'info',
        'No dashboard webhook endpoint for /api/billing/webhook',
        'fine for local dev (`stripe listen` replaces it); production needs one — docs/BILLING.md §4'
      )
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const MARK = { pass: 'PASS', fail: 'FAIL', info: 'INFO' }
console.log('\nstripe-smoke — test-mode setup checklist\n')
for (const r of results) {
  console.log(`  [${MARK[r.kind]}] ${r.name}${r.detail ? `\n         ${r.detail}` : ''}`)
}
const failed = results.filter((r) => r.kind === 'fail').length
console.log('')
if (failed > 0) {
  console.log(`stripe-smoke: ${failed} check(s) failed. The paste-along fix for each step is in docs/STRIPE-SETUP.md.`)
  process.exit(1)
}
console.log('stripe-smoke: OK — keys, prices and webhook secret all check out. Now run the 4242 checkout (docs/STRIPE-SETUP.md §5).')
