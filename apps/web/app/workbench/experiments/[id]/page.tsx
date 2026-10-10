'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ExperimentRecord } from '@/components/workbench/ExperimentRecord'
import type { Experiment } from '@/lib/workbench/experiments'
import { SAMPLE_EXPERIMENT_ID, buildSampleExperiment } from '@/lib/workbench/sampleExperiment'

/**
 * /workbench/experiments/[id] — one record, readable top to bottom.
 *
 * The id "sample" builds the built-in record in the browser with the same
 * store and targets an agent uses; any other id is fetched from
 * /api/workbench/experiments/[id], which reads the same store the MCP tools
 * write.
 */

type RecordState =
  | { status: 'loading' }
  | { status: 'ready'; experiment: Experiment; note?: string }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export default function ExperimentPage() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [state, setState] = useState<RecordState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!id) {
        setState({ status: 'missing' })
        return
      }
      if (id === SAMPLE_EXPERIMENT_ID) {
        try {
          const experiment = await buildSampleExperiment()
          if (!cancelled) {
            setState({
              status: 'ready',
              experiment,
              note:
                'Sample record, built in your browser just now by the same store and targets an agent drives. ' +
                'Seeds are fixed, so it reads the same on every visit.',
            })
          }
        } catch (cause) {
          if (!cancelled) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Could not build the sample.' })
        }
        return
      }
      try {
        const res = await fetch(`/api/workbench/experiments/${encodeURIComponent(id)}`, { cache: 'no-store' })
        if (res.status === 404 || res.status === 400) {
          if (!cancelled) setState({ status: 'missing' })
          return
        }
        const body: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          const message =
            body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `The record could not be loaded (HTTP ${res.status}).`
          if (!cancelled) setState({ status: 'error', message })
          return
        }
        const payload = body as { storage: 'memory' | 'supabase'; experiment: Experiment }
        if (!cancelled) {
          setState({
            status: 'ready',
            experiment: payload.experiment,
            note:
              payload.storage === 'supabase'
                ? 'Stored in Supabase.'
                : 'Stored in this server’s memory: it will not survive a restart and is not shared between instances.',
          })
        }
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'The record could not be loaded.' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/workbench/experiments"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> All experiments
      </Link>

      {state.status === 'loading' ? (
        <p className="card p-6 text-sm text-ink-muted" role="status">
          Loading the record…
        </p>
      ) : null}
      {state.status === 'missing' ? (
        <div className="card p-6">
          <h1 className="text-xl font-bold">No experiment with that id</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            It may have been written to a server instance that has since restarted (records live in memory
            unless Supabase is configured), or the id was mistyped. The list shows what this deployment holds.
          </p>
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="card p-6" role="alert">
          <h1 className="text-xl font-bold">The record could not be loaded</h1>
          <p className="mt-2 text-sm text-ink-secondary">{state.message}</p>
        </div>
      ) : null}
      {state.status === 'ready' ? <ExperimentRecord experiment={state.experiment} storageNote={state.note} /> : null}
    </div>
  )
}
