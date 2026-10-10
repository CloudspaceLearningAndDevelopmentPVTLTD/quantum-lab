'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  DEFAULT_DEVICE_MODEL,
  DEVICE_MODELS,
  DEVICE_MODEL_KEY,
  type DeviceBlocker,
  type DeviceEngine,
  createDeviceEngine,
  currentDeviceEngine,
  deviceTutorBlocker,
  formatSize,
  releaseDeviceEngine,
} from '@/lib/llm/webllm'

/**
 * DeviceTutorPanel — the opt-in control for running the tutor on this device.
 *
 * THE ONE RULE THIS COMPONENT EXISTS TO ENFORCE: nothing downloads until the
 * learner presses the button. The model is between 376 MB and 2.2 GB. Starting
 * that automatically — on mount, on hover, on "prefetch when idle" — would be
 * an unrequested multi-gigabyte transfer on someone's metered phone plan. So
 * the size is stated in the button's own label, before the press, and the
 * press is the consent.
 *
 * After the first successful load the weights live in the browser's Cache
 * Storage, so a later visit reuses them and the same button returns in
 * seconds. The stored MODEL ID (not the weights) is kept in localStorage so we
 * re-offer the size the learner already paid for rather than the default.
 */
export interface DeviceTutorPanelProps {
  /** Build-time flag; false hides the feature entirely. */
  enabled: boolean
  /** Handed up to ChatPanel so it can route sends through the device engine. */
  onReady: (engine: DeviceEngine | null, modelId: string | null) => void
  className?: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'blocked'; blocker: DeviceBlocker }
  | { kind: 'loading'; ratio: number; text: string }
  | { kind: 'ready'; modelId: string }
  | { kind: 'failed'; message: string }

export default function DeviceTutorPanel({ enabled, onReady, className }: DeviceTutorPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [modelId, setModelId] = useState<string>(DEFAULT_DEVICE_MODEL)
  const engineRef = useRef<DeviceEngine | null>(null)
  const selectId = useId()
  const progressId = useId()

  // Restore the size the learner already downloaded, so the offer matches what
  // is actually cached. A stale id from an older build is ignored rather than
  // offered, because its weights are not necessarily cached either.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEVICE_MODEL_KEY)
      if (saved && DEVICE_MODELS.some((m) => m.id === saved)) setModelId(saved)
    } catch {
      // Safari private mode and blocked third-party storage both throw here.
      // The default model is a fine answer; this is a convenience, not state.
    }
  }, [])

  // Capability check runs on mount. It is cheap (no download) and it decides
  // whether we show a working control or an honest explanation.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const blocker = await deviceTutorBlocker(enabled)
      if (cancelled) return
      setPhase(blocker ? { kind: 'blocked', blocker } : { kind: 'idle' })
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  /*
   * Deliberately NOT unloading on unmount.
   *
   * The engine is a module singleton (lib/llm/webllm.ts) precisely so it
   * survives navigation: a learner who waited out an 879 MB download should
   * not lose it by clicking through to a lesson and back. An earlier version
   * of this component released the GPU memory here, which looked tidy and
   * meant every return to /tutor paid a fresh WebGPU recompile for weights
   * that were already cached.
   *
   * The memory is released when the learner presses "switch off", and by the
   * tab closing. That is the right trade: the resource is one they explicitly
   * chose to acquire, and they have an explicit control to give it back.
   */
  useEffect(() => {
    const live = currentDeviceEngine()
    if (live) {
      engineRef.current = live.engine
      setModelId(live.modelId)
      setPhase({ kind: 'ready', modelId: live.modelId })
      onReady(live.engine, live.modelId)
    }
    // Runs once: re-adopting on every onReady identity change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async () => {
    setPhase({ kind: 'loading', ratio: 0, text: 'Starting…' })
    try {
      const engine = await createDeviceEngine(modelId, (p) =>
        setPhase({ kind: 'loading', ratio: p.ratio, text: p.text }),
      )
      engineRef.current = engine
      try {
        localStorage.setItem(DEVICE_MODEL_KEY, modelId)
      } catch {
        /* see above — convenience only */
      }
      setPhase({ kind: 'ready', modelId })
      onReady(engine, modelId)
    } catch (err) {
      engineRef.current = null
      onReady(null, null)
      setPhase({
        kind: 'failed',
        message:
          err instanceof Error && err.message
            ? err.message.slice(0, 160)
            : 'The model could not be loaded.',
      })
    }
  }, [modelId, onReady])

  const stop = useCallback(() => {
    void releaseDeviceEngine()
    engineRef.current = null
    onReady(null, null)
    setPhase({ kind: 'idle' })
  }, [onReady])

  // A deployment with the feature off renders nothing at all, rather than a
  // disabled control advertising something the operator chose not to ship.
  if (!enabled) return null
  if (phase.kind === 'checking') return null
  if (phase.kind === 'blocked' && phase.blocker.reason === 'disabled') return null

  const selected = DEVICE_MODELS.find((m) => m.id === modelId) ?? DEVICE_MODELS[1]

  return (
    <section
      className={`rounded-card border border-line bg-surface-2 p-4 ${className ?? ''}`}
      aria-labelledby={`${selectId}-heading`}
    >
      <h2 id={`${selectId}-heading`} className="text-[13px] font-bold text-ink">
        Run the tutor on this device
      </h2>

      {phase.kind === 'blocked' ? (
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
          {phase.blocker.detail} The hosted tutor above still works.
        </p>
      ) : (
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
          Downloads a small model once, then answers with no network, no account and no
          message limit. Your questions never leave the device.
        </p>
      )}

      {phase.kind === 'idle' || phase.kind === 'failed' ? (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={selectId} className="block text-[11px] font-semibold text-ink-secondary">
              Model size
            </label>
            <select
              id={selectId}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink"
            >
              {DEVICE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {formatSize(m.sizeMb)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{selected.blurb}</p>
          </div>

          {/* The size is IN the button, not only in the select above it: the
              button is the consent, so the number has to be on the thing being
              pressed. */}
          <button
            type="button"
            onClick={() => void start()}
            className="btn btn-primary w-full text-[13px]"
          >
            Download {formatSize(selected.sizeMb)} and run here
          </button>

          {phase.kind === 'failed' ? (
            <p role="alert" className="text-[12px] leading-relaxed text-q-rose-text">
              {phase.message} The hosted tutor above is unaffected.
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Downloaded once, then cached by your browser. On a metered connection, wait for
              Wi-Fi.
            </p>
          )}
        </div>
      ) : null}

      {phase.kind === 'loading' ? (
        <div className="mt-3">
          {/* A native <progress> is announced by screen readers as a progress
              bar with a value, which a styled <div> is not. The percentage is
              also written out, because "68%" read aloud is more useful than a
              bar, and sighted users on a 15-minute download want the number. */}
          <label htmlFor={progressId} className="block text-[11px] font-semibold text-ink-secondary">
            Loading {selected.label} — {Math.round(phase.ratio * 100)}%
          </label>
          <progress
            id={progressId}
            className="mt-1 h-2 w-full"
            value={phase.ratio}
            max={1}
          />
          <p className="mt-1 truncate text-[11px] text-ink-muted" aria-live="polite">
            {phase.text}
          </p>
        </div>
      ) : null}

      {phase.kind === 'ready' ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[12px] text-q-teal-text">
            <span aria-hidden="true">● </span>
            Running {selected.label} on this device. Questions stay local.
          </p>
          <button
            type="button"
            onClick={stop}
            className="focus-ring rounded text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            switch off
          </button>
        </div>
      ) : null}
    </section>
  )
}
