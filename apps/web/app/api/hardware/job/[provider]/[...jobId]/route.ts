/**
 * GET /api/hardware/job/{provider}/{jobId} — server-side proxy for the same
 * path on `services/api`.
 *
 * The job id is a catch-all segment because a Braket task id is an ARN
 * (`arn:aws:braket:us-east-1:123456789012:quantum-task/<uuid>`) and contains a
 * slash. Upstream declares `{job_id:path}` for the same reason.
 *
 * PATH TRAVERSAL is the risk a catch-all proxy segment carries: `..` in a
 * segment would let a caller aim this at any other upstream path — including
 * `/api/circuits/run`, which this proxy deliberately does not expose. Next
 * hands the segments already percent-decoded, so the check below runs on the
 * decoded form (checking the encoded form is the classic way to miss `%2e%2e`),
 * and every segment is re-encoded on the way out.
 *
 * ── Gate chain: identity + ownership, but NOT entitlement or quota ──────────
 *
 *   limitOrNull(ip) → shape/traversal → requireCaller → limitOrNull(account)
 *   → hardwareJobCredentialOwner → resolve BYOK credential → forward
 *
 * Polling costs nothing at a vendor: it is a status read against a job that has
 * already been paid for. So there is no `requireFeature` and no quota check —
 * gating a poll on the plan would mean that a Pro user who lapses to Free can
 * never see the results of jobs they already paid for, which is punitive and
 * gets a support ticket rather than an upgrade.
 *
 * WHAT IT IS, though, is an information leak. A job's status carries the
 * counts — the actual measurement results of somebody's circuit — plus the
 * backend and any provider error text. Before this change anyone who obtained a
 * job id could read all of it, from any IP, signed out, and the proxy attached
 * the operator's shared secret to make that work. Job ids are high-entropy so
 * this is not enumerable, but ids leak in the ordinary ways: a screenshot, a
 * shared log, a copied URL, a support thread.
 *
 * DECISION: a job is bound to the account that submitted it. `submit` stamps
 * `provider` + `job_id` onto the caller's `hardware_usage` row, and this route
 * refuses anything that does not match. Consequences, stated plainly:
 *
 *  · A job submitted BEFORE this change has no stamped row and is no longer
 *    pollable through the proxy. Those ids live in `localStorage` on the
 *    hardware page, so a few users will see "not found" on stale cards. The job
 *    itself is untouched — it lives at the provider — and the results remain
 *    available from the provider's own console. This is an acceptable one-time
 *    cost for closing the leak; the alternative is an unauthenticated read of
 *    everyone's results forever.
 *  · An unknown job and someone else's job return the SAME 404 with the same
 *    body. A 403 for "exists but not yours" would turn this route into an
 *    oracle for which job ids are real.
 *  · When the ownership store cannot answer, this route REFUSES (503) rather
 *    than falling through to the proxy. An outage is not a reason to publish a
 *    stranger's measurement results, and the JobMonitor already renders a
 *    failed poll as "the job is unaffected — it lives on the provider".
 *
 * ── BYOK: the poll must present the credential the SUBMIT used ─────────────
 *
 * The ownership lookup also answers whose credential paid, because a job run
 * on the caller's own IBM token is invisible to the operator's token and vice
 * versa. Keying on the stored row rather than on what the caller has attached
 * right now is what keeps old jobs pollable after somebody adds or removes a
 * credential. the internal handoff notes §4; the long comment on the branch below.
 */

import {
  forward,
  forwardedJson,
  badRequest,
  limitOrNull,
  quotaUnavailable,
  requireCaller,
  READ_LIMIT,
} from '@/lib/hardware/proxy'
import { isTerminalStatus } from '@/lib/hardware/types'
import { dispatchWebhookEventOnce } from '@/lib/integrations/webhooks'
import {
  hardwareJobCredentialOwner,
  recordHardwareResult,
  QuotaUnavailableError,
  type CredentialOwner,
} from '@/lib/billing/usage'
import { resolveSubmissionCredential } from '@/lib/hardware/byok'
import {
  ProviderCredentialStoreError,
  touchProviderCredential,
  type ResolvedCredential,
} from '@/lib/security/providerCredentials'
import { NextResponse } from 'next/server'
import { int, oneOf } from '@/lib/security/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The providers `poll_job()` in services/api/app/quantum/hardware.py
 * dispatches on. `azure` was missing here while the upstream handled it, so a
 * job submitted to a Quantinuum or IonQ target through Azure could never be
 * polled back: the id was stamped with provider `azure` and this route
 * refused it with a 400 before the ownership check ever ran.
 */
const PROVIDERS = ['ibm', 'braket', 'azure'] as const

/** Longer than any IBM job id or Braket ARN; short enough to be a bound. */
const MAX_JOB_ID_CHARS = 512

/**
 * Characters that appear in a real job handle: IBM ids are hex-ish, Braket
 * ARNs add colons and hyphens. Nothing legitimate needs a dot, so `..` cannot
 * be spelled at all.
 */
const JOB_SEGMENT = /^[A-Za-z0-9:_-]+$/

/** One body for "no such job" and for "not yours". See the header. */
function notFound(): NextResponse {
  return NextResponse.json({ detail: 'No such job.' }, { status: 404 })
}

export async function GET(
  req: Request,
  props: { params: Promise<{ provider: string; jobId: string[] }> }
): Promise<Response> {
  const params = await props.params;
  const limited = await limitOrNull(req, 'hw-job', READ_LIMIT)
  if (limited) return limited

  // Shape and traversal checks run BEFORE the identity check, deliberately.
  // They are pure, cheap and leak nothing (the messages are static), and
  // refusing `..` must not depend on Supabase being reachable — a path-
  // traversal guard that stops working during an auth outage is not a guard.
  const provider = oneOf(params.provider, PROVIDERS, 'provider')
  if (!provider.ok) return badRequest(provider.error)

  const segments = params.jobId ?? []
  if (segments.length === 0 || segments.length > 8) {
    return badRequest('job id must be 1 to 8 path segments.')
  }
  if (segments.join('/').length > MAX_JOB_ID_CHARS) {
    return badRequest(`job id must be at most ${MAX_JOB_ID_CHARS} characters.`)
  }
  if (!segments.every((segment) => JOB_SEGMENT.test(segment))) {
    return badRequest('job id contains characters that are not part of any job handle.')
  }

  const caller = await requireCaller(req, 'hardware:read')
  if (!caller.ok) return caller.response

  // The monitor polls with backoff, so a per-account bucket at the read limit is
  // generous for a real page and still bounds a script holding one session.
  const perAccount = await limitOrNull(req, 'hw-job-acct', READ_LIMIT, caller.id)
  if (perAccount) return perAccount

  // The id as `submit` stamped it: the upstream `job_id` string, which for
  // Braket contains the slashes that made this a catch-all route.
  const jobId = segments.join('/')
  const url = new URL(req.url)

  // Ownership AND funding in one lookup. `null` is "not yours (or no such
  // job)"; otherwise it says whose credential this job was submitted with.
  let fundedBy: CredentialOwner | null
  try {
    fundedBy = await hardwareJobCredentialOwner(caller.id, provider.value, jobId)
    if (!fundedBy) return notFound()
  } catch (err) {
    if (err instanceof QuotaUnavailableError) {
      return quotaUnavailable(
        err,
        'api/hardware/job',
        'Job status is temporarily unavailable because job ownership cannot be checked. The job itself is unaffected — it lives on the provider.'
      )
    }
    throw err
  }

  // ── Poll with the credential the job was SUBMITTED with ───────────────────
  //
  // A job that ran on the caller's own IBM token can only be read back with
  // that same token: IBM does not show one account another account's job, so
  // the operator's credential answers "no such job" — which this route would
  // faithfully relay as an eternally-pending card.
  //
  // The decision is keyed on the usage row, not on what the caller has stored
  // right now, because those differ in both directions the moment somebody
  // attaches or removes a credential — see `hardwareJobCredentialOwner`.
  //
  // WHEN THE CREDENTIAL IS GONE: the row says 'user' and the store has nothing
  // (removed, or `SETTINGS_ENCRYPTION_KEY` rotated). `resolve…` returns null
  // and this polls with the operator's credential, which will almost certainly
  // answer "not found". That is the honest outcome: the job exists at the
  // vendor, under credentials this platform no longer holds, and the user can
  // still see it in their own IBM console. Refusing here instead would say
  // "unavailable" about a job that is perfectly available — just not to us.
  let credential: ResolvedCredential | null = null
  if (fundedBy === 'user') {
    try {
      credential = await resolveSubmissionCredential(caller.id, provider.value, null)
    } catch (err) {
      if (err instanceof ProviderCredentialStoreError) {
        console.error(`[api/hardware/job] ${err.why}`)
        return quotaUnavailable(
          new QuotaUnavailableError('the BYOK credential store could not be read'),
          'api/hardware/job',
          'Job status is temporarily unavailable because your saved provider credential could ' +
            'not be read. The job itself is unaffected — it lives on the provider.'
        )
      }
      throw err
    }
  }

  const path = segments.map(encodeURIComponent).join('/')

  // Observable labels make this an ESTIMATOR poll. They are the CALLER's
  // record: IBM stores the observables but not our names for them, so without
  // these the upstream can only answer with positional names. Bounded and
  // sanitised here because they are echoed straight back into the response.
  const rawLabels = url.searchParams.get('observables')
  let query = ''
  if (rawLabels !== null) {
    const labels = rawLabels
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label.length > 0 && label.length <= 64)
      .slice(0, 32)
    query = `?observables=${encodeURIComponent(labels.join(','))}`
  }

  // How many points the job swept, from the submission record the caller kept.
  // Without it a swept sampler result is read as ONE merged histogram — the
  // average of the sweep, presented as a measurement — and a swept estimator
  // result is read at the wrong rank. Both silently.
  const rawPoints = url.searchParams.get('sweep_points')
  if (rawPoints !== null) {
    const points = int(Number(rawPoints), 1, 1024, 'sweep_points')
    if (!points.ok) return badRequest(points.error)
    query += `${query ? '&' : '?'}sweep_points=${points.value}`
  }

  const response = await forward(
    `/api/hardware/job/${provider.value}/${path}${query}`,
    undefined,
    undefined,
    credential
  )

  // Bookkeeping for the owner ("am I still using this?"), never awaited in a
  // way that can fail the poll the caller actually asked for.
  if (credential) void touchProviderCredential(caller.id, credential.provider)

  // ── Persist what this poll saw, then notify ────────────────────────────────
  //
  // This poll is the ONE place the server ever observes a hardware job's state.
  // Submission is asynchronous at the vendor and nothing calls us back, so if
  // the observation is not written down here it is not written down at all —
  // which is exactly what used to happen: counts were rendered and dropped, the
  // job list lived in `localStorage`, and a job that finished overnight was
  // never collected.
  //
  // Both writes are best-effort behind one catch. The caller asked for a job
  // status and gets it whatever the record-keeping thinks; a database blip must
  // not turn a successful read into an error.
  try {
    const data = await forwardedJson(response)
    const status = data && typeof data.status === 'string' ? data.status : null

    if (status) {
      // Written on EVERY poll, not only terminal ones, so a queued job's row
      // reflects that it is queued rather than staying null until it finishes.
      // `recordHardwareResult` only writes fields it was actually given, so a
      // queued poll cannot erase a finished job's counts.
      await recordHardwareResult(caller.id, provider.value, jobId, {
        status,
        counts: isCountsRecord(data?.counts) ? data.counts : null,
        error: typeof data?.error === 'string' ? data.error : null,
        qpuSeconds: typeof data?.qpu_seconds === 'number' ? data.qpu_seconds : null,
        // The device the job actually RAN on, which IBM can change when the
        // named one is retired mid-queue.
        backend: typeof data?.backend === 'string' ? data.backend : null,
      })
    }

    // A5 integration seam. Deduped per process so a page polling a finished job
    // does not re-notify on every poll (across instances this is at-least-once
    // — receivers key on the delivery id, see lib/integrations/webhooks.ts).
    // Only status/provider/jobId are sent, never the counts: results stay
    // behind the ownership check above.
    if (status && isTerminalStatus(status)) {
      dispatchWebhookEventOnce(
        `hwjob:${caller.id}:${provider.value}:${jobId}`,
        'hardware_job_finished',
        { provider: provider.value, jobId, status },
        caller.id
      )
    }
  } catch {
    // Deliberately swallowed — the caller asked for the job status, and they
    // get it regardless of what the record-keeping or notification path thinks.
  }

  return response
}

/**
 * Is this a measurement histogram?
 *
 * Checked rather than cast because the value is about to be written to a
 * `jsonb` column and served back as somebody's experimental record. An array
 * or a string would be stored perfectly happily by Postgres and then break
 * every reader downstream, so the shape is verified once, here, at the only
 * point where it enters our storage.
 *
 * @param value The `counts` field as the upstream sent it.
 * @returns True when it is an object of bitstring to non-negative count.
 */
function isCountsRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return false
  return entries.every(
    ([key, count]) =>
      /^[01]+$/.test(key) && typeof count === 'number' && Number.isFinite(count) && count >= 0
  )
}
