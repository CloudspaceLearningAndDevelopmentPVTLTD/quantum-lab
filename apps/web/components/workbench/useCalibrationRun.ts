'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalibrationConfig, StepRecord } from '@/lib/workbench/calibration'
import {
  startPacedRun,
  type WorkerInbound,
  type WorkerOutbound,
} from '@/lib/workbench/calibration.worker'

/**
 * Owns one calibration run at a time and hands the page an append-only list of
 * step records. The run lives in a Web Worker; where `Worker` does not exist
 * (a very old browser, or a test renderer) the same paced loop runs inline on
 * setTimeout so the page still works, just with the loop on the main thread.
 *
 * Progress arrives in chunks at ~30 Hz. Every chunk is one setState, so React
 * re-renders at most 30 times a second regardless of steps per second.
 */
export type RunStatus = 'idle' | 'running' | 'done' | 'stopped'

export function useCalibrationRun() {
  const [records, setRecords] = useState<StepRecord[]>([])
  const [status, setStatus] = useState<RunStatus>('idle')
  const workerRef = useRef<Worker | null>(null)
  const inlineRef = useRef<ReturnType<typeof startPacedRun> | null>(null)
  const unmounted = useRef(false)
  /** The last start request, so a worker that fails to load can be replayed inline. */
  const lastStart = useRef<{ config: CalibrationConfig; stepsPerSecond: number } | null>(null)
  const receivedAny = useRef(false)
  const runId = useRef(0)

  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      workerRef.current?.terminate()
      workerRef.current = null
      inlineRef.current?.stop()
      inlineRef.current = null
    }
  }, [])

  const onProgress = useCallback((msg: WorkerOutbound) => {
    if (unmounted.current || msg.runId !== runId.current) return
    receivedAny.current = true
    setRecords((prev) => (msg.records.length ? prev.concat(msg.records) : prev))
    if (msg.done) setStatus('done')
  }, [])

  const stop = useCallback(() => {
    if (workerRef.current) {
      const m: WorkerInbound = { type: 'stop' }
      workerRef.current.postMessage(m)
    }
    inlineRef.current?.stop()
    inlineRef.current = null
    setStatus((s) => (s === 'running' ? 'stopped' : s))
  }, [])

  const startInline = useCallback(
    (config: CalibrationConfig, stepsPerSecond: number) => {
      inlineRef.current?.stop()
      inlineRef.current = startPacedRun(
        config,
        stepsPerSecond,
        onProgress,
        (fn, ms) => setTimeout(fn, ms),
        (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        runId.current
      )
    },
    [onProgress]
  )

  const start = useCallback(
    (config: CalibrationConfig, stepsPerSecond: number) => {
      stop()
      setRecords([])
      setStatus('running')
      lastStart.current = { config, stepsPerSecond }
      receivedAny.current = false
      runId.current += 1

      if (typeof Worker === 'function') {
        if (!workerRef.current) {
          try {
            // Relative to this file so the bundler can see the worker module.
            workerRef.current = new Worker(
              new URL('../../lib/workbench/calibration.worker.ts', import.meta.url),
              { type: 'module' }
            )
            workerRef.current.onmessage = (e: MessageEvent<WorkerOutbound>) => onProgress(e.data)
            workerRef.current.onerror = () => {
              // The worker script failed to load or threw. Give up on workers for
              // this page and, if this run produced nothing yet, replay it inline.
              workerRef.current?.terminate()
              workerRef.current = null
              if (unmounted.current) return
              if (!receivedAny.current && lastStart.current) {
                startInline(lastStart.current.config, lastStart.current.stepsPerSecond)
              } else {
                setStatus('stopped')
              }
            }
          } catch {
            workerRef.current = null
          }
        }
        if (workerRef.current) {
          const m: WorkerInbound = { type: 'start', runId: runId.current, config, stepsPerSecond }
          workerRef.current.postMessage(m)
          return
        }
      }

      startInline(config, stepsPerSecond)
    },
    [onProgress, startInline, stop]
  )

  const setSeverity = useCallback((value: number) => {
    if (workerRef.current) {
      const m: WorkerInbound = { type: 'severity', value }
      workerRef.current.postMessage(m)
    }
    inlineRef.current?.run.setSeverity(value)
  }, [])

  const reset = useCallback(() => {
    stop()
    setRecords([])
    setStatus('idle')
  }, [stop])

  return { records, status, start, stop, reset, setSeverity }
}
