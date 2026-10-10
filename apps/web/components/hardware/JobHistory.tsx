'use client'

/**
 * JobHistory — the durable record of every hardware run this account has made.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * `/hardware` kept its job list in `localStorage` under `quantum-lab.hw-jobs`:
 * twenty entries, each an id and a backend name. That list was per-browser, so
 * a second machine showed nothing; it died with site data; and it never held a
 * single measurement count, because the counts were fetched from the vendor on
 * each poll, drawn, and dropped.
 *
 * This panel reads `GET /api/hardware/jobs`, which serves the `hardware_usage`
 * rows the job-status route writes as it observes each job. Same account on any
 * device, and the counts are there.
 *
 * The `JobMonitor` cards above it are unchanged and still do their job: they
 * are the LIVE view of a job submitted in this tab. This is the archive.
 *
 * ── The honesty this component has to preserve ──────────────────────────────
 *
 * Every row is what WE observed, not what the vendor holds. A job nobody ever
 * polled has `status: null` however long ago it actually finished, because the
 * poll is the only thing that writes one. That case is rendered as "never
 * checked" rather than as "queued", because guessing here would mean telling
 * somebody their finished experiment is still in a queue.
 */

import { useCallback, useEffect, useState } from 'react'
import { listJobs } from '@/lib/hardware/client'
import { authFetch } from '@/lib/authFetch'
import type { HardwareJobHistoryEntry } from '@/lib/hardware/types'
import { SignInLink } from '@/components/auth/SignInLink'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; jobs: HardwareJobHistoryEntry[] }
  | { kind: 'signed-out' }
  | { kind: 'failed'; message: string }

/** How many rows the panel asks for. The route's own ceiling is 200. */
const PAGE_SIZE = 50

/**
 * Total shots actually returned, which is not always the shots requested:
 * a device can return fewer, and the difference is worth being able to see.
 *
 * @param counts The measurement histogram.
 * @returns The sum of all counts.
 */
function totalShots(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

/**
 * The most frequent bitstrings, largest first.
 *
 * @param counts The measurement histogram.
 * @param take How many to return.
 * @returns Up to `take` `[bitstring, count]` pairs.
 */
function topOutcomes(counts: Record<string, number>, take: number): [string, number][] {
  return Object.entries(counts)
    // Count descending, then bitstring ascending so two outcomes with the same
    // count do not swap places between renders.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, take)
}

/**
 * Render a status as a word and a colour class.
 *
 * `null` is its own case, not folded into "queued" — see the header.
 *
 * @param status The stored status, or null when never polled.
 * @returns The label and its Tailwind colour class.
 */
function statusLabel(status: string | null): { text: string; className: string } {
  switch (status) {
    case 'done':
      return { text: 'done', className: 'text-q-teal-text' }
    case 'error':
      return { text: 'error', className: 'text-q-rose-text' }
    case 'cancelled':
      return { text: 'cancelled', className: 'text-ink-secondary' }
    case 'running':
      return { text: 'running', className: 'text-q-violet-text' }
    case 'queued':
      return { text: 'queued', className: 'text-q-amber-text' }
    default:
      return { text: 'never checked', className: 'text-ink-secondary' }
  }
}

/**
 * Turn the history into a CSV, one row per measured bitstring.
 *
 * Long format rather than a column per bitstring: different circuits have
 * different outcome sets, so a wide table would be mostly empty and would
 * change shape every time a new job is added. Long format loads into pandas,
 * R or a spreadsheet pivot without any reshaping.
 *
 * @param jobs The rows to export.
 * @returns CSV text with a header line.
 */
export function historyToCsv(jobs: HardwareJobHistoryEntry[]): string {
  const header = [
    'submitted_at',
    'completed_at',
    'provider',
    'backend',
    'job_id',
    'status',
    'shots_requested',
    'optimization_level',
    'transpiled_depth',
    'transpiled_two_qubit_gates',
    'qpu_seconds',
    'error',
    'bitstring',
    'count',
  ].join(',')

  // RFC 4180: quote every field and double any embedded quote. Vendor error
  // text and backend names are not ours to assume are comma-free.
  const cell = (value: unknown): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`

  const lines: string[] = [header]
  for (const job of jobs) {
    const base = [
      job.submittedAt,
      job.completedAt ?? '',
      job.provider ?? '',
      job.backend,
      job.jobId ?? '',
      job.status ?? '',
      job.shots,
      job.optimizationLevel ?? '',
      job.transpiledDepth ?? '',
      job.transpiledTwoQubitGates ?? '',
      job.qpuSeconds ?? '',
      job.error ?? '',
    ]
    // SORTED, not insertion order. `Object.entries` puts integer-like keys
    // first in ascending numeric order and everything else in insertion order,
    // so a two-qubit histogram comes out as 11, 00, 01, 10: '11' is a
    // canonical array index and '00' is not. Two exports of the same job would
    // then differ by row order for no reason, which makes them undiffable.
    const entries = job.counts ? Object.entries(job.counts).sort((a, b) => a[0].localeCompare(b[0])) : []
    if (entries.length === 0) {
      // A job with no counts still gets a row. Dropping it would make the
      // export silently disagree with the panel about how many runs happened.
      lines.push([...base, '', ''].map(cell).join(','))
      continue
    }
    for (const [bitstring, count] of entries) {
      lines.push([...base, bitstring, count].map(cell).join(','))
    }
  }
  return lines.join('\n')
}

/** The states a run may be published in. Mirrors `PUBLISHABLE_STATUSES`. */
function isPublishable(status: string | null): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

/**
 * The publish control for one run.
 *
 * TWO CLICKS, ON PURPOSE. The first reveals what will become public; the
 * second does it. A permalink is world-readable and immutable once written, so
 * the confirmation is not friction for its own sake — it is the only moment
 * somebody is told that THE CIRCUIT IS PUBLISHED VERBATIM, comments included.
 * A one-click publish would be a one-click disclosure of whatever a comment in
 * that QASM happens to say.
 *
 * @param props The history row to publish.
 * @returns The control.
 */
function PublishRun({ job }: { job: HardwareJobHistoryEntry }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const publish = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await authFetch('/api/hardware/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `optIn` is the consent, sent only from this handler — the one
        // reachable solely by pressing the second button.
        body: JSON.stringify({ rowId: job.id, optIn: true }),
      })
      const body: unknown = await response.json().catch(() => null)
      const record = (body ?? {}) as Record<string, unknown>
      if (!response.ok) {
        setError(String(record.detail ?? 'This run could not be published.'))
        return
      }
      setPublished(typeof record.path === 'string' ? record.path : null)
      setConfirming(false)
    } catch {
      setError('This run could not be published.')
    } finally {
      setBusy(false)
    }
  }, [job.id])

  if (published) {
    return (
      <p className="mt-3 text-[12px] text-ink-secondary">
        Published:{' '}
        <a className="text-primary underline underline-offset-2" href={published}>
          {published}
        </a>
      </p>
    )
  }

  if (!confirming) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="focus-ring text-[11px] text-ink-muted hover:text-ink-secondary"
        >
          Publish a citable permalink
        </button>
        {error ? <p className="mt-1 text-[11px] text-q-rose-text">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-hairline bg-surface-2 p-3">
      <p className="text-[12px] leading-relaxed text-ink-secondary">
        This creates a <strong className="text-ink">public, permanent</strong> page that anyone
        with the link can read without an account. It publishes{' '}
        <strong className="text-ink">your circuit exactly as written, including any comments
        in it</strong>, the measured counts, the device and the compilation settings. Your
        account id and the vendor&rsquo;s job id are removed. You can withdraw it later, but it
        cannot be edited.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy}
          className="btn-primary focus-ring text-[12px] disabled:opacity-50"
        >
          {busy ? 'Publishing…' : 'Publish it'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost focus-ring text-[12px]"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="mt-2 text-[11px] text-q-rose-text">{error}</p> : null}
    </div>
  )
}

export function JobHistory() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const result = await listJobs(PAGE_SIZE)
    if (result.ok) {
      setState({ kind: 'ready', jobs: result.data.jobs })
      return
    }
    // 401 is not a failure state: it is the signed-out state, and it is the
    // normal state for most visitors to this page.
    if (result.status === 401) {
      setState({ kind: 'signed-out' })
      return
    }
    setState({
      kind: 'failed',
      message: result.offline
        ? 'Your job history could not be loaded. The jobs themselves are unaffected — they live on the provider.'
        : result.error,
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Download the full history, circuits included.
   *
   * A second request rather than exporting what is on screen: the panel is
   * deliberately loaded without `qasm`, and an export of results with no record
   * of which circuit produced them is not reproducible by anyone.
   */
  const download = useCallback(async (format: 'csv' | 'json') => {
    setExporting(true)
    const result = await listJobs(PAGE_SIZE, true)
    setExporting(false)
    if (!result.ok) return

    const body =
      format === 'csv'
        ? historyToCsv(result.data.jobs)
        : JSON.stringify(result.data.jobs, null, 2)
    const blob = new Blob([body], {
      type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `qubit16-hardware-jobs.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  return (
    <section aria-labelledby="hw-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="hw-history-heading" className="text-sm font-bold text-ink">
          Your hardware runs
        </h2>
        {state.kind === 'ready' && state.jobs.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void download('csv')}
              disabled={exporting}
              className="btn-ghost focus-ring text-[12px]"
            >
              {exporting ? 'Preparing…' : 'Download CSV'}
            </button>
            <button
              type="button"
              onClick={() => void download('json')}
              disabled={exporting}
              className="btn-ghost focus-ring text-[12px]"
            >
              Download JSON
            </button>
            <button type="button" onClick={() => void load()} className="btn-ghost focus-ring text-[12px]">
              Refresh
            </button>
          </div>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <p className="mt-3 text-[13px] text-ink-secondary" aria-busy="true">
          Loading your runs…
        </p>
      ) : null}

      {state.kind === 'signed-out' ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          <SignInLink /> to keep a permanent record of every hardware run — the circuit, the counts and
          the QPU time — on every device you use.
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <p className="mt-3 text-[13px] leading-relaxed text-q-amber-text">{state.message}</p>
      ) : null}

      {state.kind === 'ready' && state.jobs.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          No hardware runs yet. Everything you submit from this page is recorded here — the
          circuit, the counts, the device and the QPU time it used.
        </p>
      ) : null}

      {state.kind === 'ready' && state.jobs.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {state.jobs.map((job) => {
            const label = statusLabel(job.status)
            const outcomes = job.counts ? topOutcomes(job.counts, 4) : []
            const returned = job.counts ? totalShots(job.counts) : null
            return (
              <li key={job.id} className="card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-[13px] text-q-violet-text">{job.backend}</p>
                  <p className={`text-[12px] font-semibold ${label.className}`}>{label.text}</p>
                </div>

                <p className="mt-1 text-[12px] text-ink-secondary">
                  {job.shots.toLocaleString('en-US')} shots
                  {job.optimizationLevel !== null ? ` · opt ${job.optimizationLevel}` : ''}
                  {job.transpiledTwoQubitGates !== null
                    ? ` · ${job.transpiledTwoQubitGates} two-qubit gates`
                    : ''}
                  {job.qpuSeconds !== null ? ` · ${job.qpuSeconds.toFixed(2)}s QPU` : ''}
                  {job.submittedAt ? ` · ${new Date(job.submittedAt).toLocaleString('en-US')}` : ''}
                </p>

                {outcomes.length > 0 ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    {outcomes.map(([bitstring, count]) => (
                      <div key={bitstring} className="flex items-baseline justify-between gap-2">
                        <dt className="font-mono text-[12px] text-ink">{bitstring}</dt>
                        <dd className="text-[12px] tabular-nums text-ink-secondary">
                          {returned ? `${((count / returned) * 100).toFixed(1)}%` : count}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {job.error ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-q-rose-text">{job.error}</p>
                ) : null}

                {job.jobId ? (
                  <p className="mt-2 break-all font-mono text-[11px] text-ink-secondary">
                    {job.provider}/{job.jobId}
                  </p>
                ) : null}

                {/*
                  Terminal runs only. Publishing a queued job would produce a
                  permanent record of a result that does not exist yet, and the
                  server refuses it — so offering the button would be offering
                  a 409.
                */}
                {isPublishable(job.status) ? (
                  <PublishRun job={job} />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
