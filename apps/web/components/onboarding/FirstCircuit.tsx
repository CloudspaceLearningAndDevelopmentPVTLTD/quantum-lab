'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import CircuitGrid from '@/components/circuit/CircuitGrid'
import GatePalette from '@/components/circuit/GatePalette'
import { Button } from '@/components/ui/button'
import { Histogram } from '@/components/ui/Histogram'
import {
  FIRST_CIRCUIT_STEP,
  markFirstCircuitRun,
  markStepComplete,
} from '@/lib/onboarding/state'
import { run, type Circuit, type GateName, type RunResult } from '@/lib/quantum'

const SHOTS = 1024

interface CoachMark {
  key: string
  title: string
  hint: string
}

/** The three things they have to do, in order. */
const COACH_MARKS: CoachMark[] = [
  { key: 'h', title: 'Place an H on q0', hint: 'Click H in the palette, then click the q0 wire.' },
  {
    key: 'cx',
    title: 'Place a CX from q0 to q1',
    hint: 'Click CX, then click q0 (the control), then q1 (the target).',
  },
  { key: 'run', title: 'Press Run', hint: 'Measure the circuit 1,024 times.' },
]

/** Has an H been placed on qubit 0? */
function hasHadamardOnQ0(circuit: Circuit): boolean {
  return circuit.ops.some((op) => op.name === 'H' && op.qubits[0] === 0)
}

/** Has a CX been placed with q0 as control and q1 as target? */
function hasCxQ0ToQ1(circuit: Circuit): boolean {
  return circuit.ops.some(
    (op) => op.name === 'CX' && op.qubits[0] === 0 && op.qubits[1] === 1
  )
}

export default function FirstCircuit({
  onDone,
  onSkip,
  onBack,
}: {
  onDone: () => void
  onSkip: () => void
  /** Omitted when this is the first screen of the flow — see WelcomeFlow. */
  onBack?: () => void
}) {
  const [circuit, setCircuit] = useState<Circuit>({ numQubits: 2, ops: [] })
  const [selectedGate, setSelectedGate] = useState<GateName | null>('H')
  const [result, setResult] = useState<RunResult | null>(null)

  const builtH = hasHadamardOnQ0(circuit)
  const builtCx = builtH && hasCxQ0ToQ1(circuit)
  const ran = result !== null

  // The step they are on is DERIVED from the circuit — placing the gate is
  // what advances the flow, not a "next" button. Detecting it is the reward.
  const stage = ran ? 3 : builtCx ? 2 : builtH ? 1 : 0

  // Nudge the palette along with them so the next gate is one click away.
  // Only when the currently selected gate is the one they just finished with,
  // so we never yank a gate out from under a deliberate choice.
  useEffect(() => {
    if (builtH && !builtCx) setSelectedGate((g) => (g === 'H' ? 'CX' : g))
  }, [builtH, builtCx])

  // Announce each completed sub-step once, for screen readers and for the
  // small "nice" line under the coach mark.
  const prevStage = useRef(0)
  const [justAdvanced, setJustAdvanced] = useState(false)
  useEffect(() => {
    if (stage > prevStage.current) {
      setJustAdvanced(true)
      const t = window.setTimeout(() => setJustAdvanced(false), 2600)
      prevStage.current = stage
      return () => window.clearTimeout(t)
    }
    prevStage.current = stage
    return undefined
  }, [stage])

  const counts = useMemo(() => {
    if (!result) return []
    return Object.entries(result.counts).map(([label, value]) => ({ label, value }))
  }, [result])

  const doRun = () => {
    const outcome = run(circuit, SHOTS)
    setResult(outcome)
    markFirstCircuitRun()
    markStepComplete(FIRST_CIRCUIT_STEP)
  }

  const clear = () => {
    setCircuit({ numQubits: 2, ops: [] })
    setResult(null)
    setSelectedGate('H')
    prevStage.current = 0
  }

  const mark = stage < COACH_MARKS.length ? COACH_MARKS[stage] : null

  return (
    <div className="space-y-5">
      <div>
        <p className="section-label">Step 1 of 3</p>
        <h2 className="section-title mt-2">Build something in sixty seconds</h2>
        <p className="section-desc mt-2">
          Two qubits, two gates. This is the real editor — the same one the course and the
          challenges use — so anything you learn here you keep.
        </p>
      </div>

      {/* Coach mark. Fixed height so advancing never shifts the layout. */}
      <div
        className="min-h-[76px] rounded-card border p-3.5"
        style={{
          borderColor: mark ? 'rgb(var(--q-violet-rgb) / 0.5)' : 'rgb(var(--q-teal-rgb) / 0.5)',
          background: mark ? 'rgb(var(--q-violet-rgb) / 0.10)' : 'rgb(var(--q-teal-rgb) / 0.10)',
        }}
        role="status"
        aria-live="polite"
      >
        {mark ? (
          <>
            <p className="text-sm font-bold text-q-violet-text">
              {stage + 1}. {mark.title}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">{mark.hint}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-q-teal-text">That is a Bell pair.</p>
            <p className="mt-1 text-xs text-ink-secondary">
              Two qubits, 1,024 measurements, two outcomes.
            </p>
          </>
        )}
        {justAdvanced && mark ? (
          <p className="mt-1.5 text-xs font-semibold text-q-teal-text">
            Got it — {stage === 1 ? 'H is on q0.' : 'the CX is in.'}
          </p>
        ) : null}
      </div>

      {/* Progress ticks */}
      <ol className="flex flex-wrap gap-2">
        {COACH_MARKS.map((m, i) => {
          const done = stage > i
          const active = stage === i
          return (
            <li
              key={m.key}
              className="pill text-[11px]"
              style={{
                borderColor: done
                  ? 'rgb(var(--q-teal-rgb) / 0.5)'
                  : active
                    ? 'rgb(var(--q-violet-rgb) / 0.5)'
                    : 'var(--line)',
                color: done ? 'var(--q-teal-text)' : active ? 'var(--q-violet-text)' : 'var(--ink-muted)',
              }}
              data-testid={`fc-tick-${m.key}`}
              data-done={done ? 'true' : 'false'}
            >
              {done ? '✓ ' : ''}
              {m.title}
            </li>
          )
        })}
      </ol>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[214px_minmax(0,1fr)]">
        <div className="rounded-card border border-line bg-surface-2 p-3">
          <GatePalette selected={selectedGate} onSelect={setSelectedGate} />
        </div>
        <div>
          <CircuitGrid
            circuit={circuit}
            selectedGate={selectedGate}
            theta={Math.PI / 2}
            onChange={setCircuit}
            // A guided "place an H, now place a CX" tour. Classical binding is
            // a third choice nobody has asked for yet; it lives in /simulator.
            classicalControl={false}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={doRun}
          disabled={!builtCx}
          data-testid="fc-run"
        >
          Run {SHOTS.toLocaleString('en-US')} shots
        </Button>
        <Button type="button" variant="secondary" onClick={clear}>
          Clear
        </Button>
        <span className="text-xs text-ink-muted">
          {builtCx ? 'Ready.' : 'Run unlocks once both gates are placed.'}
        </span>
      </div>

      {result ? (
        <div className="rounded-card border border-line bg-surface-2 p-4" data-testid="fc-results">
          <Histogram
            data={counts}
            title="Measurement outcomes"
            total={SHOTS}
            unit="shots"
            highlight={['00', '11']}
          />
          <p className="mt-4 text-sm text-ink-secondary">
            Only <span className="font-mono text-q-teal-text">00</span> and{' '}
            <span className="font-mono text-q-teal-text">11</span> came back — never{' '}
            <span className="font-mono">01</span>, never <span className="font-mono">10</span>.
            Each qubit on its own is a coin flip, yet the two always agree. Nothing is passing
            between them and neither one carried the answer in advance. That is entanglement,
            and it has no classical explanation.
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        {onBack ? (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={onSkip}>
            Skip this
          </Button>
          <Button type="button" onClick={onDone} disabled={!ran}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}
