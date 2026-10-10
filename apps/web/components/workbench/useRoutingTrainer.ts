'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Circuit } from '@/lib/quantum'
import type { LearnedRouting } from '@/lib/quantum/routing'
import type {
  TrainerInbound,
  TrainerOutbound,
  TrainerProgressMessage,
} from '@/lib/quantum/routing.worker'
import type { TopologyKind } from '@/lib/quantum/topology'

export type TrainerStatus = 'idle' | 'running' | 'done' | 'error'

export interface TrainerState {
  status: TrainerStatus
  progress: TrainerProgressMessage | null
  result: LearnedRouting | null
  stoppedBy: 'episodes' | 'seconds' | 'user' | null
  secondsUsed: number
  error: string | null
}

const INITIAL: TrainerState = {
  status: 'idle',
  progress: null,
  result: null,
  stoppedBy: null,
  secondsUsed: 0,
  error: null,
}

/**
 * Owns one routing.worker.ts instance. `start` posts a job; `stop` asks the
 * worker to finish early with what it has. Unmounting terminates the worker
 * outright — a page that is gone has no use for a result.
 */
export function useRoutingTrainer(): TrainerState & {
  start(job: {
    circuit: Circuit
    topology: TopologyKind
    numQubits: number
    seed: number
    maxEpisodes: number
    maxSeconds: number
  }): void
  stop(): void
  reset(): void
} {
  const workerRef = useRef<Worker | null>(null)
  const [state, setState] = useState<TrainerState>(INITIAL)

  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current
    if (typeof Worker === 'undefined') return null
    const worker = new Worker(new URL('../../lib/quantum/routing.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<TrainerOutbound>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        setState((s) => ({ ...s, status: 'running', progress: msg, secondsUsed: msg.secondsUsed }))
      } else if (msg.type === 'done') {
        setState((s) => ({
          ...s,
          status: 'done',
          result: msg.result,
          stoppedBy: msg.stoppedBy,
          secondsUsed: msg.secondsUsed,
        }))
      } else if (msg.type === 'error') {
        setState((s) => ({ ...s, status: 'error', error: msg.message }))
      }
    }
    worker.onerror = (event) => {
      setState((s) => ({ ...s, status: 'error', error: event.message || 'the training worker crashed' }))
    }
    workerRef.current = worker
    return worker
  }, [])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  const start = useCallback(
    (job: Parameters<ReturnType<typeof useRoutingTrainer>['start']>[0]) => {
      const worker = ensureWorker()
      if (!worker) {
        setState({ ...INITIAL, status: 'error', error: 'Web Workers are not available in this browser.' })
        return
      }
      setState({ ...INITIAL, status: 'running' })
      const msg: TrainerInbound = { type: 'start', ...job }
      worker.postMessage(msg)
    },
    [ensureWorker],
  )

  const stop = useCallback(() => {
    const msg: TrainerInbound = { type: 'stop' }
    workerRef.current?.postMessage(msg)
  }, [])

  const reset = useCallback(() => {
    // A running job is abandoned by terminating the worker: the next start
    // spins up a fresh one.
    workerRef.current?.terminate()
    workerRef.current = null
    setState(INITIAL)
  }, [])

  return { ...state, start, stop, reset }
}
