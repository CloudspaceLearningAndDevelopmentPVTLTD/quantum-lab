'use client'

/**
 * JobMonitor — polls one submitted hardware job until it settles.
 *
 * POLLING CADENCE. A QPU queue is measured in minutes to hours, so a fixed 2s
 * poll would mean thousands of pointless requests against a provider-backed
 * endpoint for a single job. The interval therefore backs off:
 *
 *   0–30s   → every 2s   (submissions that fail validation fail fast; the user
 *                         is still watching, so keep it responsive)
 *   30s–5m  → every 5s   (attention has moved on; nothing is gained by 2s)
 *   5m+     → every 15s  (this is a real queue wait; poll politely)
 *
 * Polling stops permanently on a terminal status and the timer is always
 * cleared on unmount, so navigating away cannot leave a request loop running.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { announce } from '@/lib/a11y/announce'
import { DeviceTopology } from '@/components/hardware/DeviceTopology'
import { Histogram, type HistogramDatum } from '@/components/ui/Histogram'
import { pollJob, transpile } from '@/lib/hardware/client'
import { formatSequence, parseGateSequence } from '@/lib/hardware/topology'
import { isTerminalStatus, type JobStatus, type TranspileResult } from '@/lib/hardware/types'

export interface JobMonitorProps {
  provider: string
  jobId: string
  /**
   * Backend id the job was submitted to (e.g. 'ibm_brisbane'). Optional and
   * additive: when present, the monitor can show the device-family topology
   * sketch and — together with `qasm` — the transpiled circuit the device
   * actually ran. Absent, the monitor renders exactly as before.
   */
  backend?: string
  /** The submitted OpenQASM source, for the post-submit transpile view. */
  qasm?: string
  onDone?: (counts: Record<string, number>) => void
}

const FAST_UNTIL_MS = 30_000
const MEDIUM_UNTIL_MS = 5 * 60_000

/** Poll delay for a job that has been alive for `elapsedMs`. */
function pollDelay(elapsedMs: number): number {
  if (elapsedMs < FAST_UNTIL_MS) return 2000
  if (elapsedMs < MEDIUM_UNTIL_MS) return 5000
  return 15_000
}

const STATUS_STYLE: Record<string, { label: string; color: string; border: string }> = {
  queued: { label: 'queued', color: 'var(--q-amber-text)', border: 'rgb(var(--q-amber-rgb) / 0.45)' },
  running: { label: 'running', color: 'var(--q-violet-text)', border: 'rgb(var(--q-violet-rgb) / 0.5)' },
  done: { label: 'done', color: 'var(--q-teal-text)', border: 'rgb(var(--q-teal-rgb) / 0.45)' },
  error: { label: 'error', color: 'var(--q-rose-text)', border: 'rgb(var(--q-rose-rgb) / 0.45)' },
  cancelled: {
    label: 'cancelled',
    color: 'var(--ink-secondary)',
    border: 'color-mix(in srgb, var(--ink-muted) 70%, transparent)',
  },
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function JobMonitor({ provider, jobId, backend, qasm, onDone }: JobMonitorProps) {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [failure, setFailure] = useState<{ message: string; offline: boolean } | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)

  /*
   * "What did the device actually run?" — the transpile preview, re-shown
   * POST-submit. The transpiler is deterministic for a given (qasm, backend,
   * level), and the submit path in services/api uses the same transpile_for
   * (Braket/Azure) or the device's own target (IBM, where the ISA circuit is
   * at least as constrained), so re-running the preview here shows the same
   * native gate sequence the job carried — labelled as the transpilation
   * preview, not as telemetry read back from the provider.
   *
   * Fetched LAZILY, on first open: a page can show many stored jobs at once
   * and each monitor already polls; N unconditional transpile calls on mount
   * would be pure waste for a section most users open once.
   */
  const [showRan, setShowRan] = useState(false)
  const [ran, setRan] = useState<TranspileResult | null>(null)
  const [ranError, setRanError] = useState<string | null>(null)
  const [ranLoading, setRanLoading] = useState(false)
  const ranRequested = useRef(false)

  const toggleRan = useCallback(() => {
    setShowRan((open) => {
      if (!open && !ranRequested.current && backend && qasm) {
        ranRequested.current = true
        setRanLoading(true)
        void transpile(qasm, backend, 1).then((result) => {
          setRanLoading(false)
          if (result.ok) {
            setRan(result.data)
            setRanError(null)
          } else {
            setRan(null)
            // Allow a retry on the next open instead of caching the failure.
            ranRequested.current = false
            setRanError(
              result.offline
                ? 'The quantum API is not reachable, so the transpiled circuit cannot be shown. The job itself is unaffected.'
                : result.error,
            )
          }
        })
      }
      return !open
    })
  }, [backend, qasm])

  const startedAt = useRef<number>(Date.now())
  const notified = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const headingId = useId()

  /*
   * A11Y (WCAG 4.1.3). This component's whole job is to report a change that
   * happens minutes to hours after the user pressed Submit, and it did it
   * entirely by swapping a coloured pill. A screen-reader user submitted a job
   * that cost real money and was never told it started, finished, or failed.
   *
   * The pill itself is deliberately NOT a live region: it re-renders on every
   * poll (elapsed time, counts, failure text) and would re-read "queued" every
   * two seconds. Only genuine STATE TRANSITIONS are announced, tracked by a ref
   * so a re-render with the same status stays silent — the same shape as the
   * exam clock's threshold throttle in components/exam/ExamRunner.tsx.
   */
  const lastAnnounced = useRef<JobStatus['status'] | null>(null)

  // Reset the clock whenever we start watching a different job or retry.
  useEffect(() => {
    startedAt.current = Date.now()
    notified.current = false
    lastAnnounced.current = null
    setElapsedMs(0)
    setStatus(null)
    setFailure(null)
  }, [provider, jobId, attempt])

  const terminal = status !== null && isTerminalStatus(status.status)

  // Live elapsed counter, independent of the (backing-off) poll cadence.
  useEffect(() => {
    if (terminal) return
    const tick = window.setInterval(() => setElapsedMs(Date.now() - startedAt.current), 1000)
    return () => window.clearInterval(tick)
  }, [terminal, attempt])

  // Announce state transitions only — see the note on `lastAnnounced` above.
  useEffect(() => {
    if (status === null) return
    if (lastAnnounced.current === status.status) return
    lastAnnounced.current = status.status

    const shots = Object.values(status.counts ?? {}).reduce((a, n) => a + n, 0)
    switch (status.status) {
      case 'queued':
        announce(`Job queued on ${provider}. Waiting behind other users; this page keeps checking.`)
        return
      case 'running':
        announce(`Job running on ${provider}. The device is executing your shots now.`)
        return
      case 'done':
        announce(
          shots > 0
            ? `Job complete on ${provider}. ${shots.toLocaleString('en-US')} shots measured; results are below.`
            : `Job complete on ${provider}, but it returned no counts.`,
        )
        return
      case 'cancelled':
        announce(`Job cancelled on ${provider} before it ran.`)
        return
      case 'error':
        // Assertive: the job is over, it may have cost money, and there is a
        // "Try again" button the user needs to know about.
        announce(
          `Job failed on ${provider}. ${status.error ?? 'The provider reported an error without a message.'}`,
          'assertive',
        )
        return
    }
  }, [status, provider])

  // A recoverable poll failure, said once. Keyed on the message so a flapping
  // API does not repeat itself every two seconds, but a *different* failure
  // still gets through.
  const lastFailure = useRef<string | null>(null)
  useEffect(() => {
    if (failure === null) {
      lastFailure.current = null
      return
    }
    if (lastFailure.current === failure.message) return
    lastFailure.current = failure.message
    announce(
      failure.offline
        ? `Status check failed: ${failure.message} The job itself is unaffected — it lives on the provider. Polling continues.`
        : `Status check failed: ${failure.message} Polling continues.`,
    )
  }, [failure])

  useEffect(() => {
    if (terminal) return

    let cancelled = false
    let timer = 0

    const run = async () => {
      const result = await pollJob(provider, jobId)
      if (cancelled) return

      if (result.ok) {
        setFailure(null)
        setStatus(result.data)
        if (result.data.status === 'done' && !notified.current) {
          notified.current = true
          onDoneRef.current?.(result.data.counts ?? {})
        }
        if (isTerminalStatus(result.data.status)) return
      } else {
        // A poll failure is not fatal: the API may have restarted. Show it and
        // keep trying on the same backed-off schedule.
        setFailure({ message: result.error, offline: result.offline })
      }

      timer = window.setTimeout(run, pollDelay(Date.now() - startedAt.current))
    }

    void run()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [provider, jobId, terminal, attempt])

  const copyId = useCallback(() => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) return
    clipboard.writeText(jobId).then(
      () => {
        setCopied(true)
        // The button's own label flipping to "Copied" while it still holds
        // focus is not reliably re-read by assistive tech.
        announce('Job id copied to the clipboard.')
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => setCopied(false),
    )
  }, [jobId])

  const state = status?.status ?? 'queued'
  const style = STATUS_STYLE[state] ?? STATUS_STYLE.queued
  const counts = status?.counts ?? null
  const bars: HistogramDatum[] = counts
    ? Object.entries(counts).map(([label, value]) => ({ label, value }))
    : []
  const totalShots = bars.reduce((acc, bar) => acc + bar.value, 0)

  return (
    <div className="card p-4" role="region" aria-labelledby={headingId}>
      {/*
        The region needs a name that says WHICH job, because /hardware can show
        several. Visually the heading is the pill + provider row below, so this
        is the text-only equivalent rather than a duplicate.
      */}
      <h3 id={headingId} className="sr-only">
        Hardware job {jobId} on {provider} — {style.label}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="pill" style={{ color: style.color, borderColor: style.border }}>
            {style.label}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">{provider}</span>
        </div>
        {/*
          A11Y: `aria-label` on a bare <span> is ignored — a generic element
          with no role has no accessible name, so "Elapsed time" was never
          exposed. role="timer" gives it one. `aria-live="off"` is explicit and
          the digits are aria-hidden, for the same reason as the exam clock:
          a counter that re-reads itself every second makes the page unusable.
          The elapsed figure is carried in the transition announcements instead.
        */}
        <span
          role="timer"
          aria-live="off"
          aria-label={`Elapsed time, ${formatElapsed(elapsedMs)}`}
          className="font-mono text-xs text-ink-secondary"
        >
          <span aria-hidden="true">{formatElapsed(elapsedMs)}</span>
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-surface-3 px-2 py-1 font-mono text-[11px] text-q-violet-text">
          {jobId}
        </code>
        <button type="button" onClick={copyId} className="btn-ghost focus-ring px-2.5 py-1 text-xs">
          {copied ? 'Copied' : 'Copy id'}
        </button>
      </div>

      {status?.status === 'queued' || status === null ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
          Real-hardware jobs commonly wait minutes to hours behind other users. Nothing has hung —
          it is safe to close this page and come back later; the job id above is all you need to
          pick it up again.
        </p>
      ) : null}

      {status?.status === 'running' ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
          The device is executing your shots now. This part is fast — usually seconds.
        </p>
      ) : null}

      {failure ? (
        <p className="mt-3 text-[12px] leading-relaxed text-q-amber-text">
          {failure.offline
            ? `${failure.message} The job is unaffected — it lives on the provider, not here. Polling will resume as soon as the API answers.`
            : `Status check failed: ${failure.message}`}
        </p>
      ) : null}

      {status?.status === 'error' ? (
        <div className="mt-3">
          <p className="text-[12px] leading-relaxed text-q-rose-text">
            {status.error ?? 'The provider reported an error without a message.'}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="btn-ghost focus-ring mt-2.5 px-3 py-1.5 text-xs"
          >
            Try again
          </button>
        </div>
      ) : null}

      {status?.status === 'cancelled' ? (
        <p className="mt-3 text-[12px] text-ink-muted">This job was cancelled before it ran.</p>
      ) : null}

      {status?.status === 'done' ? (
        bars.length > 0 ? (
          <div className="mt-4">
            <Histogram
              data={bars}
              title="Measured on real hardware"
              total={totalShots}
              unit="shots"
            />
            <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
              Counts that &quot;should not&quot; appear are not a bug: they are decoherence,
              readout error and crosstalk on physical qubits.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[12px] text-ink-muted">
            The job finished but returned no counts.
          </p>
        )
      ) : null}

      {backend ? (
        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={toggleRan}
            aria-expanded={showRan}
            className="btn-ghost focus-ring px-2.5 py-1 text-xs"
          >
            {showRan ? 'Hide' : 'Show'} device layout &amp; transpiled circuit
          </button>

          {showRan ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DeviceTopology backend={backend} />

              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  Transpiled gate sequence
                </div>

                {!qasm ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                    The submitted circuit source was not kept for this job, so its transpiled
                    form cannot be reconstructed here. New submissions keep it.
                  </p>
                ) : null}

                {ranLoading ? (
                  <p className="mt-2 text-[11px] text-ink-secondary" aria-busy="true">
                    Transpiling for {backend}…
                  </p>
                ) : null}

                {ranError ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-q-amber-text">{ranError}</p>
                ) : null}

                {ran && !ranLoading ? (
                  <RanSequence result={ran} />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The transpiled instruction list, rendered from the preview the API returns.
 *
 * The list is derived by `parseGateSequence` from the transpiled OpenQASM —
 * the same program text the submit path hands the provider — and consecutive
 * repeats are collapsed (`rz q0 ×3`) so a 60-instruction circuit reads as a
 * dozen lines. The caption is explicit that this is the transpilation
 * preview re-run, not data read back from the device.
 */
function RanSequence({ result }: { result: TranspileResult }) {
  const parsed = parseGateSequence(result.qasm)
  const lines = formatSequence(parsed.entries)
  return (
    <div className="mt-2">
      <p className="text-[11px] leading-relaxed text-ink-secondary">
        Native basis{' '}
        <span className="font-mono text-q-violet-text">{result.basis_gates.join(', ')}</span> ·
        depth {result.depth_before} → {result.depth_after} · {result.two_qubit_gates_after}{' '}
        two-qubit gate{result.two_qubit_gates_after === 1 ? '' : 's'}
      </p>
      {lines.length > 0 ? (
        <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-ink">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[11px] text-ink-muted">The transpiled program has no operations.</p>
      )}
      {parsed.truncated ? (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          Long circuit — only the first {parsed.entries.length} instructions are listed.
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
        Reconstructed by re-running the transpilation preview for this backend — the same
        deterministic rewrite the submission used, not telemetry from the device.
      </p>
    </div>
  )
}

export default JobMonitor
