/**
 * health.ts — the dependency probes behind GET /api/health.
 *
 * A HEALTH CHECK THAT CANNOT FAIL IS DECORATION. `return { status: 'ok' }` tells
 * you the Node process is up, which the TCP connect already told you. What an
 * operator needs to know at 3am is which dependency stopped answering, and the
 * only way to know that is to actually talk to it.
 *
 * Three rules this file follows, all learned the hard way in other codebases:
 *
 * 1. UNCONFIGURED IS NOT UNHEALTHY. Qubit16 is designed to run with an
 *    empty environment: no Supabase, no Stripe, no Python services. A probe for
 *    something this deployment deliberately does not have reports `skipped`,
 *    and `skipped` never turns the overall status red. Otherwise every local
 *    developer and the container's own HEALTHCHECK would see a permanent
 *    failure, and a check that is always red is a check nobody reads.
 *
 * 2. EVERY PROBE HAS A TIMEOUT, and they run concurrently. A health endpoint
 *    that hangs because one dependency hangs is worse than useless: the
 *    orchestrator's probe times out, the container is killed, and the actual
 *    fault is never reported. PROBE_TIMEOUT_MS is 2500 because
 *    apps/web/Dockerfile's HEALTHCHECK is `--interval=30s --timeout=5s`, and
 *    the probes run CONCURRENTLY, so the whole endpoint's worst case is one
 *    timeout plus overhead — inside 5s. Adding a serial probe would break that
 *    arithmetic; add it to the Promise.all instead.
 *
 * 3. NO PROBE MUTATES ANYTHING and no probe costs money. The Supabase probe is
 *    a `HEAD` count against one table; the Stripe probe reads a key prefix and
 *    makes NO API CALL AT ALL, because a network call to Stripe on every
 *    liveness probe is both a rate-limit and a bill. That is a deliberate
 *    weakness and it is stated in the response: `stripe.checked` is false.
 */

import { launchTrialDays } from '@/lib/billing/launchTrial'
import { effectiveLlmSettings } from '@/lib/platform/settings'
import { anyProviderReady, resolveForTier } from '@/lib/llm/resolve'
import { TIER_IDS } from '@/lib/platform/llmConfig'
import { platformAdminEmails } from '@/lib/platform/admin'
import { getServiceSupabase } from '@/lib/billing/entitlements'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * `ok` — reachable and answering.
 * `degraded` — answering, but not in the state we want.
 * `failing` — configured, and did not answer.
 * `skipped` — not configured on this deployment. Never makes the app unhealthy.
 */
export type ProbeStatus = 'ok' | 'degraded' | 'failing' | 'skipped'

export interface ProbeResult {
  status: ProbeStatus
  /** One sentence, safe to publish. Never an exception message — see below. */
  detail: string
  /** Round-trip milliseconds, when a call was actually made. */
  ms?: number
  /** False when the probe reports configuration only, without a network call. */
  checked: boolean
}

/** See rule 2 in the header before changing this. */
const PROBE_TIMEOUT_MS = 2_500

/**
 * Fetch with a hard deadline.
 *
 * `AbortSignal.timeout` is not used: it is unavailable on the Node 18 runtime
 * some deployments still pin, and a health endpoint that throws a ReferenceError
 * is the exact failure this whole file exists to prevent.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe an HTTP dependency of ours by GETting its own health endpoint.
 *
 * THE RESPONSE BODY IS NEVER FORWARDED. An upstream's error page can contain a
 * stack trace, an internal hostname or a connection string; this endpoint is
 * reachable by anyone who can reach the app, so it publishes a status code and
 * nothing else.
 */
async function probeHttp(name: string, url: string): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' })
    const ms = Date.now() - started
    if (!res.ok) {
      return {
        status: 'failing',
        detail: `${name} answered HTTP ${res.status}.`,
        ms,
        checked: true,
      }
    }
    return { status: 'ok', detail: `${name} answered.`, ms, checked: true }
  } catch {
    // Deliberately not reporting the exception: a fetch failure message names
    // the internal host and port, and this endpoint is publicly reachable.
    return {
      status: 'failing',
      detail: `${name} did not answer within ${PROBE_TIMEOUT_MS}ms.`,
      ms: Date.now() - started,
      checked: true,
    }
  }
}

/**
 * Configuration-only version of a probe: reports what is wired up, makes no
 * network call, and can never be `failing` (an unmade call proves nothing).
 * This is what a SHALLOW health check returns; see `runHealthChecks`.
 */
function configuredOnly(name: string): ProbeResult {
  return {
    status: 'ok',
    detail: `${name} is configured. Reachability is NOT probed — call ?deep=1 for that.`,
    checked: false,
  }
}

/**
 * The database's CONFIGURATION, with no query. Same three cases probeDatabase
 * distinguishes, minus the one that needs a round trip. `degraded` for an
 * anon-key-only project is preserved because that verdict was always about
 * configuration, never about reachability.
 */
function databaseConfiguration(): ProbeResult {
  if (!isSupabaseConfigured) {
    return { status: 'skipped', detail: 'No Supabase configured; storage is local-only.', checked: false }
  }
  if (!getServiceSupabase()) {
    return {
      status: 'degraded',
      detail:
        'Supabase is configured but SUPABASE_SERVICE_ROLE_KEY is not, so this cannot distinguish an RLS denial from an outage.',
      checked: false,
    }
  }
  return configuredOnly('Supabase')
}

/**
 * Database probe: a zero-row count against `subscriptions`.
 *
 * `head: true` means PostgREST returns headers only, so this reads no rows and
 * no personal data — the table is chosen because it is the one every billing
 * path depends on, not because of anything in it.
 *
 * Needs the service-role key. With only the anon key configured this reports
 * `degraded`, not `ok`: RLS would deny the read and a denial is indistinguish-
 * able from a healthy database at this layer, so claiming `ok` would be a lie.
 */
async function probeDatabase(): Promise<ProbeResult> {
  if (!isSupabaseConfigured) {
    return { status: 'skipped', detail: 'No Supabase configured; storage is local-only.', checked: false }
  }
  const supabase = getServiceSupabase()
  if (!supabase) {
    return {
      status: 'degraded',
      detail:
        'Supabase is configured but SUPABASE_SERVICE_ROLE_KEY is not, so this cannot distinguish an RLS denial from an outage.',
      checked: false,
    }
  }
  const started = Date.now()
  try {
    const { error } = await supabase
      .from('subscriptions')
      .select('user_id', { count: 'exact', head: true })
      .limit(1)
    const ms = Date.now() - started
    if (error) {
      // PostgrestError.message names the table, the column and sometimes the
      // policy. It goes to the server log, not into this body.
      console.error('[api/health] database probe failed:', error.message)
      return { status: 'failing', detail: 'The database rejected a read.', ms, checked: true }
    }
    return { status: 'ok', detail: 'Database answered a read.', ms, checked: true }
  } catch (err) {
    console.error('[api/health] database probe threw:', err)
    return {
      status: 'failing',
      detail: 'The database did not answer.',
      ms: Date.now() - started,
      checked: true,
    }
  }
}

/**
 * Stripe probe — CONFIGURATION ONLY, on purpose.
 *
 * Stripe has no free liveness endpoint. Any real call (`balance.retrieve`, a
 * customer list) counts against the account's rate limit and appears in the
 * dashboard's request log, on every probe, forever. At a 30-second HEALTHCHECK
 * interval that is 2,880 calls a day per replica to learn something Stripe's
 * own status page already publishes.
 *
 * So this reports whether the SDK could be constructed and nothing more, and it
 * says so via `checked: false`. If billing ever needs a real reachability
 * signal, subscribe to Stripe's status webhook — do not put a call here.
 */
function probeStripe(): ProbeResult {
  if (!isStripeConfigured) {
    return { status: 'skipped', detail: 'No Stripe configured; billing is off.', checked: false }
  }
  return {
    status: 'ok',
    detail: 'Stripe key present. Reachability is NOT probed — see lib/observability/health.ts.',
    checked: false,
  }
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'failing'
  version: string
  environment: string
  /** ISO-8601, so a cached response is obvious. */
  at: string
  /**
   * True when the dependency probes actually made network calls. A shallow
   * report (`false`) can say `ok` while a dependency is down — it proves the
   * process is up and wired, nothing more. Echoed so a monitor cannot mistake
   * one for the other.
   */
  deep: boolean
  checks: Record<string, ProbeResult>
}

/**
 * Roll the individual probes into one status.
 *
 * `skipped` is ignored entirely (rule 1). Any `failing` makes the whole report
 * `failing`, which is what a 503 is derived from — an operator should not have
 * to read the body to know something is wrong.
 */
export function overallStatus(checks: Record<string, ProbeResult>): 'ok' | 'degraded' | 'failing' {
  const statuses = Object.values(checks).map((c) => c.status)
  if (statuses.includes('failing')) return 'failing'
  if (statuses.includes('degraded')) return 'degraded'
  return 'ok'
}

/**
 * Run the probes concurrently. Never throws.
 *
 * ── Shallow by default, deep on request ─────────────────────────────────────
 *
 * A SHALLOW run (the default) makes NO network calls at all: it reports which
 * integrations are configured and returns. That is what a liveness probe
 * actually needs — "is this process up and correctly wired" — and it is what
 * the Dockerfile HEALTHCHECK, a load balancer and any public prober should get.
 *
 * A DEEP run makes three network calls: a Supabase HEAD count and two upstream
 * `/health` fetches. Those are the expensive part, and until this change every
 * anonymous request to `/api/health` triggered all three. At a HEALTHCHECK
 * interval of 30s that is already 2,880 database round trips a day per replica;
 * pointed at by anyone on the internet with a `while true` loop it is a free
 * amplifier that turns one cheap request into three expensive ones against our
 * own dependencies. Hence: deep is opt-in, and the route rate-limits it hard.
 *
 * Consequence, stated plainly: a shallow report can say `ok` while a dependency
 * is down. It is not a readiness check and must not be alerted on. Point the
 * uptime monitor at `?deep=1` (with `HEALTH_DEEP_TOKEN` set) and the
 * orchestrator at the bare path.
 */
/**
 * The tutor's effective provider per tier — env layer PLUS whatever a platform
 * admin saved (lib/platform/settings.ts). Presence only: a probe call to any
 * provider is billable, and the console has its own explicit "Test" button.
 */
async function modelProviderReport(): Promise<ProbeResult> {
  try {
    const eff = await effectiveLlmSettings()
    const per = TIER_IDS.map((tier) => {
      const r = resolveForTier(eff.settings, tier)
      return `${tier}=${r.kind === 'live' ? r.provider.label : r.kind}`
    }).join(', ')
    const ready = anyProviderReady(eff.settings)
    const source = eff.stored ? `settings v${eff.stored.version} over env` : 'env only'
    const admins = platformAdminEmails().length
    return {
      status: ready ? 'ok' : 'skipped',
      detail:
        (ready
          ? `Live tutor ready (${source}): ${per}. Reachability is NOT probed — a probe call would be billed.`
          : `No provider ready (${source}); every tier gets the offline answer set.`) +
        (eff.unreadable.length ? ` UNREADABLE stored keys: ${eff.unreadable.join(', ')} (SETTINGS_ENCRYPTION_KEY changed?).` : '') +
        (admins === 0 ? ' PLATFORM_ADMIN_EMAILS is unset, so /admin/platform is closed.' : ` ${admins} platform admin(s).`),
      checked: false,
    }
  } catch {
    return { status: 'skipped', detail: 'Could not read the LLM configuration.', checked: false }
  }
}

export async function runHealthChecks(
  options: { deep?: boolean } = {}
): Promise<Record<string, ProbeResult>> {
  const deep = options.deep === true
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').trim()
  const agentUrl = (process.env.AGENT_SERVICE_URL ?? '').trim()

  const [database, quantumApi, agentService] = await Promise.all([
    deep ? probeDatabase() : Promise.resolve(databaseConfiguration()),
    apiUrl
      ? deep
        ? probeHttp('services/api', `${apiUrl.replace(/\/+$/, '')}/api/health`)
        : Promise.resolve(configuredOnly('services/api'))
      : Promise.resolve<ProbeResult>({
          status: 'skipped',
          detail: 'NEXT_PUBLIC_API_URL is not set; hardware and Qiskit features are off.',
          checked: false,
        }),
    agentUrl
      ? deep
        ? probeHttp('services/agent', `${agentUrl.replace(/\/+$/, '')}/api/agent/health`)
        : Promise.resolve(configuredOnly('services/agent'))
      : Promise.resolve<ProbeResult>({
          status: 'skipped',
          // Not 'failing': the tutor degrades to a direct model call and then to
          // an offline answer set, so no agent service is a supported state.
          detail: 'AGENT_SERVICE_URL is not set; the tutor falls back to its lower tiers.',
          checked: false,
        }),
  ])

  return {
    database,
    stripe: probeStripe(),
    quantumApi,
    agentService,
    modelProvider: await modelProviderReport(),
    // Configuration-only reports for the rest of what infra/azure/deploy.sh
    // wires (step 7b), so one `?deep=1` call after a deploy answers "what is
    // actually on". None of these makes a network call.
    launchTrial: launchTrialReport(),
    email: {
      status: process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? 'ok' : 'skipped',
      detail:
        process.env.RESEND_API_KEY && process.env.EMAIL_FROM
          ? `Resend configured, sending as ${process.env.EMAIL_FROM}. Reachability is NOT probed.`
          : process.env.RESEND_API_KEY
            ? 'RESEND_API_KEY present but EMAIL_FROM is not set; nothing can be sent.'
            : 'No RESEND_API_KEY; onboarding and schedule emails are off.',
      checked: false,
    },
    deepProbeToken: {
      status: process.env.HEALTH_DEEP_TOKEN ? 'ok' : 'skipped',
      detail: process.env.HEALTH_DEEP_TOKEN
        ? 'HEALTH_DEEP_TOKEN set; ?deep=1 requires it.'
        : 'HEALTH_DEEP_TOKEN not set; ?deep=1 is open to anyone (docs/SECURITY.md HEALTH-1).',
      checked: false,
    },
  }
}

/**
 * The launch-period policy (lib/billing/launchTrial.ts) is only meaningful
 * with accounts, and only expires with the service-role key. Say which of
 * the three states this deployment is in, since two of them look identical
 * from the pricing page.
 */
function launchTrialReport(): ProbeResult {
  const days = launchTrialDays()
  if (days <= 0) {
    return { status: 'skipped', detail: 'NEXT_PUBLIC_LAUNCH_TRIAL_DAYS not set; no launch trial.', checked: false }
  }
  if (!isSupabaseConfigured) {
    return {
      status: 'failing',
      detail: `NEXT_PUBLIC_LAUNCH_TRIAL_DAYS=${days} but Supabase is not configured, so nobody can sign up to receive it.`,
      checked: false,
    }
  }
  if (!getServiceSupabase()) {
    return {
      status: 'ok',
      detail: `${days}-day launch trial on, but SUPABASE_SERVICE_ROLE_KEY is not set: account ages are unknowable, so trials are granted and never expire.`,
      checked: false,
    }
  }
  return { status: 'ok', detail: `${days}-day launch trial on; every new account is Pro until ${days} days after sign-up.`, checked: false }
}
