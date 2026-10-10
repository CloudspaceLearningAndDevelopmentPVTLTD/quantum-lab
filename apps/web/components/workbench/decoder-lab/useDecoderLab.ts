'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DecoderName } from '@/lib/qec/model'
import type { LabConfig, SweepPoint, TrainBudget, TrainProgress } from '@/lib/qec/session'
import type { ShotReport, TrainedSummary, WorkerRequest, WorkerResponse } from '@/lib/qec/worker'

/**
 * The page's handle on the Decoder Lab worker. Owns the worker's lifetime, turns
 * its messages into React state, and exposes four verbs: run, stop, resweep,
 * inspect. Nothing numeric happens on this thread.
 */

export type LabPhase = 'idle' | 'training' | 'sweeping'

export type LabState = {
  /** False until the worker has been created, or forever if Workers are unavailable. */
  ready: boolean
  phase: LabPhase
  progress: Partial<Record<DecoderName, TrainProgress>>
  summary: TrainedSummary | null
  points: SweepPoint[]
  sweepTotal: number
  /** The last sweep ended on the stop button. */
  stopped: boolean
  error: string | null
  shot: ShotReport | null
  /** How many run/sweep cycles have completed, for keys and annotations. */
  runs: number
}

export type RunRequest = {
  config: LabConfig
  decoders: DecoderName[]
  budget: TrainBudget
  seed: number
  sweepShots: number
}

const INITIAL: LabState = {
  ready: false,
  phase: 'idle',
  progress: {},
  summary: null,
  points: [],
  sweepTotal: 0,
  stopped: false,
  error: null,
  shot: null,
  runs: 0,
}

export function useDecoderLab(): { state: LabState; run: (r: RunRequest) => void; stop: () => void; resweep: (shots: number, seed: number) => void; inspect: (seed: number) => void } {
  const workerRef = useRef<Worker | null>(null)
  const [state, setState] = useState<LabState>(INITIAL)

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setState((s) => ({ ...s, error: 'This browser has no Web Worker support; the lab cannot train here.' }))
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('../../../lib/qec/worker.ts', import.meta.url), { type: 'module' })
    } catch (err) {
      setState((s) => ({ ...s, error: `Could not start the worker: ${err instanceof Error ? err.message : String(err)}` }))
      return
    }
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      setState((s) => {
        switch (msg.type) {
          case 'phase':
            return { ...s, phase: msg.phase, runs: msg.phase === 'idle' ? s.runs + 1 : s.runs }
          case 'train-progress':
            return { ...s, progress: { ...s.progress, [msg.progress.decoder]: msg.progress } }
          case 'trained':
            return { ...s, summary: msg.summary }
          case 'sweep-point': {
            const points = s.points.slice()
            points[msg.index] = msg.point
            return { ...s, points, sweepTotal: msg.total }
          }
          case 'sweep-done':
            return { ...s, stopped: msg.stopped }
          case 'shot-result':
            return { ...s, shot: msg.report }
          case 'error':
            return { ...s, error: msg.message, phase: 'idle' }
          default:
            return s
        }
      })
    }
    worker.onerror = (event) => {
      setState((s) => ({ ...s, error: event.message || 'The worker crashed.', phase: 'idle' }))
    }
    setState((s) => ({ ...s, ready: true }))
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const send = useCallback((req: WorkerRequest) => {
    workerRef.current?.postMessage(req)
  }, [])

  const run = useCallback(
    (r: RunRequest) => {
      setState((s) => ({
        ...s,
        progress: {},
        summary: null,
        points: [],
        sweepTotal: 0,
        stopped: false,
        error: null,
        shot: null,
        phase: 'training',
      }))
      send({
        type: 'run',
        config: r.config,
        decoders: r.decoders,
        budget: r.budget,
        seed: r.seed,
        sweep: { shots: r.sweepShots },
      })
    },
    [send]
  )

  const stop = useCallback(() => send({ type: 'stop' }), [send])

  const resweep = useCallback(
    (shots: number, seed: number) => {
      setState((s) => ({ ...s, points: [], sweepTotal: 0, stopped: false, phase: 'sweeping' }))
      send({ type: 'sweep', shots, seed })
    },
    [send]
  )

  const inspect = useCallback((seed: number) => send({ type: 'shot', seed }), [send])

  return { state, run, stop, resweep, inspect }
}
