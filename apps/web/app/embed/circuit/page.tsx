'use client'

/**
 * /embed/circuit — the chrome-free widget a host page (vegaduta.ai) iframes.
 * See docs/EMBED.md for the integration guide and public/embed.js for the
 * loader that most hosts will use instead of hand-writing an iframe.
 *
 * This file is deliberately just WIRING. Every decision with a failure mode —
 * what the `?c=` token may contain, what an incoming message must look like,
 * what an outgoing message may carry — lives in lib/embed/protocol.ts, where
 * it is unit-tested. The page's own responsibilities are the three effects a
 * browser requires: read the URL once, listen for messages, post results.
 *
 * TRUST MODEL, in one paragraph: this page runs UNAUTHENTICATED on purpose.
 * It never reads a session, never calls an API, and simulates entirely
 * in-browser at the anonymous tier's qubit limit, so there is nothing here
 * for a hostile host page to steal — which is what makes posting results with
 * targetOrigin '*' acceptable: `ql:result` carries measurement counts of a
 * circuit the host itself supplied. Inbound messages are the reverse problem
 * (any window may send), and every payload goes through parseLoadMessage's
 * validation before it is allowed to become state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import CircuitGrid from '@/components/circuit/CircuitGrid'
import GatePalette from '@/components/circuit/GatePalette'
import { Slider } from '@/components/ui/Controls'
import { Histogram, type HistogramDatum } from '@/components/ui/Histogram'
import {
  EMBED_MAX_QUBITS,
  EMBED_SHOTS,
  buildReadyMessage,
  buildResultMessage,
  parseEmbedSearch,
  parseLoadMessage,
} from '@/lib/embed/protocol'
import {
  GATE_BY_NAME,
  emptyCircuit,
  run,
  type Circuit,
  type GateName,
  type RunResult,
} from '@/lib/quantum'

export default function EmbedCircuitPage() {
  const [circuit, setCircuit] = useState<Circuit>(() => emptyCircuit(2))
  const [readonly, setReadonly] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [selectedGate, setSelectedGate] = useState<GateName | null>('H')
  const [theta, setTheta] = useState(Math.PI / 2)

  // Effect 1: the URL, read exactly once. A client component cannot see the
  // query string during prerender, so this runs on mount — the same pattern
  // (and the same decoder) as /simulator's shared-link handling.
  useEffect(() => {
    const params = parseEmbedSearch(window.location.search)
    if (params.circuit) setCircuit(params.circuit)
    setReadonly(params.readonly)
    // The handshake goes out only after the URL circuit is applied, so a
    // loader that queues ql:load behind ql:ready can never have its message
    // overwritten by this effect.
    if (window.parent !== window) {
      window.parent.postMessage(buildReadyMessage(), '*')
    }
  }, [])

  // Effect 2: inbound ql:load messages. No origin filter BY DESIGN — the CSP
  // frame-ancestors allowlist decides who may embed us, and once embedded the
  // host page is exactly who this message channel exists for. The validation
  // burden sits entirely on parseLoadMessage: anything that is not a bounded,
  // parseable, in-limit circuit is silently ignored.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const loaded = parseLoadMessage(event.data)
      if (!loaded) return
      setCircuit(loaded)
      setResult(null)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Effect 3 (event-driven): run locally, report upward.
  const handleRun = useCallback(() => {
    const runResult = run(circuit, EMBED_SHOTS)
    setResult(runResult)
    if (window.parent !== window) {
      window.parent.postMessage(buildResultMessage(runResult), '*')
    }
  }, [circuit])

  const handleChange = useCallback(
    (next: Circuit) => {
      if (readonly) return
      setCircuit(next)
      setResult(null)
    },
    [readonly],
  )

  const histogramData = useMemo<HistogramDatum[]>(
    () => (result ? Object.entries(result.counts).map(([label, value]) => ({ label, value })) : []),
    [result],
  )

  const selectedSpec = selectedGate ? GATE_BY_NAME[selectedGate] : undefined

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Visually hidden on purpose: the widget is chrome-free for the host
          page, but an iframe is its own document and a screen reader lands in
          it with no landmark heading otherwise. */}
      <h1 className="sr-only">Qubit16 circuit simulator</h1>
      {readonly ? null : (
        <GatePalette selected={selectedGate} onSelect={setSelectedGate} />
      )}
      {!readonly && selectedSpec?.hasAngle ? (
        <Slider
          label="θ"
          min={-Math.PI}
          max={Math.PI}
          step={Math.PI / 12}
          value={theta}
          onChange={setTheta}
          format={(v) => `${(v / Math.PI).toFixed(2)}π`}
        />
      ) : null}
      {/* Read-only mode: `inert` removes the grid from both pointer and
          keyboard/AT interaction in one attribute, which is exactly the
          contract "look, run, but do not edit" needs. */}
      <div inert={readonly || undefined}>
        <CircuitGrid
          circuit={circuit}
          selectedGate={readonly ? null : selectedGate}
          theta={theta}
          onChange={handleChange}
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary focus-ring" onClick={handleRun}>
          Run
        </button>
        <span className="text-xs text-ink-muted">
          {EMBED_SHOTS.toLocaleString('en-US')} shots · up to {EMBED_MAX_QUBITS} qubits · runs in your
          browser
        </span>
      </div>
      {result ? (
        <Histogram data={histogramData} title="Measurement outcomes" total={result.shots} />
      ) : (
        <p className="text-sm text-ink-muted">Press Run to sample this circuit.</p>
      )}
      {/* The one link out — attribution, opening in a full tab, never navigating
          the host page. A plain <a>, not next/link: this is an escape hatch to a
          new context, and prefetching the whole simulator from inside every
          host page is bandwidth the host did not ask to spend. */}
      <a
        href="/simulator"
        target="_blank"
        rel="noreferrer"
        className="self-end text-xs text-ink-muted underline hover:text-ink-secondary"
      >
        Powered by Qubit16 — open in the full simulator
      </a>
    </div>
  )
}
