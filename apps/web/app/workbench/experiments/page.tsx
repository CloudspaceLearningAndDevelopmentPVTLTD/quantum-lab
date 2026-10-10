'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ClaudeCodeSnippet } from '@/components/workbench/ClaudeCodeSnippet'
import { Explainer } from '@/components/ui/VizFrame'
import type { ExperimentSummary } from '@/lib/workbench/experiments'
import { EXPERIMENT_TOOL_NAMES } from '@/lib/workbench/toolNames'
import { DEFAULT_NOISE, MAX_QUBITS_NOISY, MAX_QUBITS_SIMULATOR, MAX_SHOTS } from '@/lib/workbench/targets'
import { SAMPLE_EXPERIMENT_ID } from '@/lib/workbench/sampleExperiment'

/**
 * /workbench/experiments — the experiment list.
 *
 * Reads /api/workbench/experiments (the same store the MCP tools write) and
 * links each record to its page. The built-in sample is always listed first so
 * the record view can be read before any agent has run anything.
 */

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; storage: 'memory' | 'supabase'; experiments: ExperimentSummary[] }
  | { status: 'error'; message: string }

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…'
}

const pct = (x: number) => `${(x * 100).toPrecision(2).replace(/\.?0+$/, '')}%`

export default function ExperimentsPage() {
  const [state, setState] = useState<ListState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/workbench/experiments', { cache: 'no-store' })
        const body: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          const message =
            body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `The list could not be loaded (HTTP ${res.status}).`
          if (!cancelled) setState({ status: 'error', message })
          return
        }
        const payload = body as { storage: 'memory' | 'supabase'; experiments: ExperimentSummary[] }
        if (!cancelled) setState({ status: 'ready', storage: payload.storage, experiments: payload.experiments })
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'The list could not be loaded.' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Workbench
      </Link>

      <header className="mb-8 max-w-3xl">
        <span className="pill border border-q-amber/30 bg-q-amber/15 text-q-amber-text">run</span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Experiment Runner</h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          A lab notebook an agent writes over MCP and you read afterwards. Each record states a hypothesis,
          then every circuit the agent ran — on the ideal simulator, on a noisy simulator with the error
          rates it chose, or on real hardware — with the counts it got and the note it left, and ends with
          a conclusion. You read the hypothesis, skim the timeline, and judge the conclusion against the
          numbers above it.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="records-title">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="records-title" className="text-lg font-bold">
              Records
            </h2>
            {state.status === 'ready' ? (
              <p className="text-xs text-ink-muted">
                {state.storage === 'supabase'
                  ? 'Stored in Supabase — durable, shared across instances.'
                  : 'Stored in this server’s memory — lost on restart, not shared between instances.'}
              </p>
            ) : null}
          </div>

          <ul className="mt-3 space-y-3">
            <li>
              <Link
                href={`/workbench/experiments/${SAMPLE_EXPERIMENT_ID}`}
                className="card card-accent-hover focus-ring block p-5"
                style={{ '--card-accent-rgb': 'var(--q-amber-rgb)' } as React.CSSProperties}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill border border-q-amber/30 bg-q-amber/15 text-q-amber-text">sample</span>
                  <span className="pill border-q-teal/30 bg-q-teal/15 text-q-teal-text">concluded</span>
                  <span className="text-xs text-ink-muted">4 steps · built in your browser right now</span>
                </div>
                <h3 className="mt-2 text-base font-bold text-ink">Bell pair under two-qubit depolarising noise</h3>
                <p className="mt-1 text-sm text-ink-secondary">
                  What a finished record looks like: the noisy simulator at three error rates against the
                  p₂/2 prediction, with a conclusion computed from the counts it actually got.
                </p>
              </Link>
            </li>

            {state.status === 'loading' ? (
              <li className="card p-5 text-sm text-ink-muted" role="status">
                Loading records…
              </li>
            ) : null}
            {state.status === 'error' ? (
              <li className="card p-5 text-sm text-ink-secondary" role="alert">
                {state.message}
              </li>
            ) : null}
            {state.status === 'ready' && state.experiments.length === 0 ? (
              <li className="card p-5 text-sm text-ink-secondary">
                No agent has written a record on this deployment yet. The snippet on the right is the whole
                setup.
              </li>
            ) : null}
            {state.status === 'ready'
              ? state.experiments.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/workbench/experiments/${e.id}`}
                      className="card card-accent-hover focus-ring block p-5"
                      style={{ '--card-accent-rgb': 'var(--q-amber-rgb)' } as React.CSSProperties}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`pill border ${e.conclusion !== null ? 'border-q-teal/30 bg-q-teal/15 text-q-teal-text' : 'border-q-amber/30 bg-q-amber/15 text-q-amber-text'}`}
                        >
                          {e.conclusion !== null ? 'concluded' : 'open'}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {e.stepCount} step{e.stepCount === 1 ? '' : 's'} · {formatWhen(e.createdAt)}
                        </span>
                      </div>
                      <h3 className="mt-2 text-base font-bold text-ink">{e.title}</h3>
                      <p className="mt-1 text-sm text-ink-secondary">{truncate(e.hypothesis, 220)}</p>
                    </Link>
                  </li>
                ))
              : null}
          </ul>
        </section>

        <aside className="card p-5" aria-label="Run your own experiment">
          <ClaudeCodeSnippet />
          <p className="mt-4 text-xs text-ink-muted">
            The five tools: {EXPERIMENT_TOOL_NAMES.map((n) => (
              <code key={n} className="font-mono text-ink-secondary">
                {n}{' '}
              </code>
            ))}
            — documented in <code className="font-mono">docs/MCP.md</code> alongside the rest of the server.
          </p>
        </aside>
      </div>

      <div className="mt-10">
        <Explainer title="What a step records">
          <p>
            <strong className="text-ink">The circuit</strong>, as the OpenQASM 3 the agent sent — not a
            re-serialisation, so what you read is what ran. <strong className="text-ink">The target</strong>
            with its parameters: <code className="font-mono">simulator</code> is the exact statevector engine
            behind every page on this site (up to {MAX_QUBITS_SIMULATOR} qubits, shots clamped to {MAX_SHOTS});{' '}
            <code className="font-mono">noisy-simulator</code> layers a Pauli-error model on the same engine —
            a depolarising channel after every one-qubit gate (default {pct(DEFAULT_NOISE.depolarizing1)}) and
            two-qubit gate ({pct(DEFAULT_NOISE.depolarizing2)}), and an independent readout flip per bit (
            {pct(DEFAULT_NOISE.readoutError)}), up to {MAX_QUBITS_NOISY} qubits;{' '}
            <code className="font-mono">hardware</code> submits through the same authenticated, plan-checked,
            quota-reserving route as the app’s hardware page and records the job handle.{' '}
            <strong className="text-ink">The result</strong>: counts (and, for the ideal simulator, the final
            amplitudes) or the job handle. <strong className="text-ink">The note</strong> the agent left.
          </p>
          <p>
            Watch for the two things a record makes visible that a chat transcript hides: whether the
            hypothesis was written before the runs (it is timestamped first), and whether the conclusion
            cites step numbers and counts that are actually on the page.
          </p>
        </Explainer>

        <Explainer title="What this tool does not do">
          <p>
            It does not run anything on its own. There is no scheduler and no agent here — Claude Code (or any
            MCP client) drives the tools, and this page only reads what was written. It does not verify a
            conclusion: the agent’s write-up is stored verbatim, and judging it against the counts is your job.
            The noisy simulator is a model, not a device: no T1/T2 decay, crosstalk, leakage or correlated
            readout error. Hardware steps record the submission, not the counts — those are polled from the
            hardware page once the job finishes. Records have no access control: they are attributed to a
            signed-in author when the request carried a token, but every record on a deployment is readable
            by anyone who can open this page, so the tools tell agents not to put secrets in them. Without a
            Supabase service role the store is this server’s memory (at most 200 records, 200 steps each),
            which a restart empties.
          </p>
        </Explainer>
      </div>
    </div>
  )
}
