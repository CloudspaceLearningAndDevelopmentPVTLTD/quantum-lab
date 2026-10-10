'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import GatePalette from '@/components/circuit/GatePalette'
import CircuitGrid from '@/components/circuit/CircuitGrid'
import StateDiff from '@/components/challenge/StateDiff'
import { Histogram, type HistogramDatum } from '@/components/ui/Histogram'
import { ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import { GATE_BY_NAME, emptyCircuit, simulate, type Circuit, type GateName } from '@/lib/quantum'
import { getLesson } from '@/lib/lessons'
import { grade } from '@/lib/challenges/grade'
import {
  readProgress,
  writeProgress,
  type Challenge,
  type ChallengeProgress,
  type Grade,
} from '@/lib/challenges/types'

/** Deep-enough copy: ops are replaced wholesale by the editor, never mutated. */
function startingCircuitFor(challenge: Challenge): Circuit {
  if (challenge.startingCircuit) {
    return {
      numQubits: challenge.startingCircuit.numQubits,
      ops: challenge.startingCircuit.ops.map((op) => ({ ...op })),
    }
  }
  return emptyCircuit(challenge.numQubits)
}

/** Probabilities → histogram bars, as percentages so the axis reads naturally. */
function toBars(probabilities: number[], numQubits: number): HistogramDatum[] {
  return probabilities.map((p, i) => ({
    label: i.toString(2).padStart(numQubits, '0'),
    value: Math.round(p * 1000) / 10,
  }))
}

export default function ChallengeWorkbench({ challenge }: { challenge: Challenge }) {
  const [circuit, setCircuit] = useState<Circuit>(() => startingCircuitFor(challenge))
  const [selectedGate, setSelectedGate] = useState<GateName | null>(null)
  const [theta, setTheta] = useState(Math.PI / 2)
  const [hintsShown, setHintsShown] = useState(0)
  const [result, setResult] = useState<Grade | null>(null)
  // The circuit AS GRADED. Learners keep editing after a failed check, so a
  // diff read off the live `circuit` would drift out of step with the verdict
  // printed directly above it — same numbers, different circuit.
  const [gradedCircuit, setGradedCircuit] = useState<Circuit | null>(null)
  const [progress, setProgress] = useState<ChallengeProgress>({ solved: false, hintsUsed: 0 })

  // Progress is browser-only; read it after mount so SSR and the first client
  // render agree.
  useEffect(() => {
    const saved = readProgress()[challenge.id]
    if (saved) {
      setProgress(saved)
      setHintsShown(Math.min(saved.hintsUsed, challenge.hints.length))
    }
  }, [challenge.id, challenge.hints.length])

  const targetProbabilities = challenge.targetProbabilities ?? []

  const targetBars = useMemo(
    () => toBars(targetProbabilities, challenge.numQubits),
    [targetProbabilities, challenge.numQubits]
  )

  const highlight = useMemo(
    () =>
      targetProbabilities
        .map((p, i) => (p > 0 ? i.toString(2).padStart(challenge.numQubits, '0') : null))
        .filter((label): label is string => label !== null),
    [targetProbabilities, challenge.numQubits]
  )

  const liveBars = useMemo(() => {
    try {
      return toBars(simulate(circuit).probabilities(), circuit.numQubits)
    } catch {
      return []
    }
  }, [circuit])

  const gateCount = circuit.ops.filter(
    (op) => op.name !== 'BARRIER' && op.name !== 'MEASURE'
  ).length

  const lesson = getLesson(challenge.lessonSlug)
  const angleGate = selectedGate ? GATE_BY_NAME[selectedGate] : undefined

  const handleCheck = useCallback(() => {
    const verdict = grade(challenge, circuit)
    setResult(verdict)
    setGradedCircuit(circuit)

    if (verdict.passed) {
      const best =
        progress.bestGates === undefined
          ? verdict.gateCount
          : Math.min(progress.bestGates, verdict.gateCount)
      const next: ChallengeProgress = {
        solved: true,
        bestGates: best,
        hintsUsed: Math.max(progress.hintsUsed, hintsShown),
      }
      setProgress(next)
      writeProgress(challenge.id, next)
    } else if (hintsShown > progress.hintsUsed) {
      const next: ChallengeProgress = { ...progress, hintsUsed: hintsShown }
      setProgress(next)
      writeProgress(challenge.id, next)
    }
  }, [challenge, circuit, hintsShown, progress])

  const handleReset = useCallback(() => {
    setCircuit(startingCircuitFor(challenge))
    setSelectedGate(null)
    setResult(null)
    setGradedCircuit(null)
  }, [challenge])

  return (
    <div className="space-y-6">
      {/* ── Brief ── */}
      <header className="card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill">{challenge.level}</span>
          <span className="pill">
            {challenge.numQubits} qubit{challenge.numQubits === 1 ? '' : 's'}
          </span>
          {challenge.maxGates !== undefined ? (
            <span
              className="pill"
              style={{ color: 'var(--q-amber-text)', borderColor: 'rgb(var(--q-amber-rgb) / 0.33)' }}
            >
              par {challenge.maxGates}
            </span>
          ) : null}
          {progress.solved ? (
            <span
              className="pill"
              style={{ color: 'var(--q-teal-text)', borderColor: 'rgb(var(--q-teal-rgb) / 0.33)' }}
            >
              solved
            </span>
          ) : null}
        </div>
        <h1 className="section-title mt-3">{challenge.title}</h1>
        <p className="section-desc mt-2 max-w-3xl whitespace-pre-line">{challenge.brief}</p>
        {lesson ? (
          <p className="mt-3 text-xs text-ink-muted">
            Stuck on the concept? Read{' '}
            <Link href={`/learn/${lesson.slug}`} className="focus-ring text-q-violet-text underline">
              {lesson.title}
            </Link>
            .
          </p>
        ) : null}
      </header>

      {/* ── Target vs live, side by side ── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <span className="section-label">Target</span>
          <div className="mt-3">
            <Histogram
              data={targetBars}
              title="What you are aiming at"
              total={100}
              unit="%"
              highlight={highlight}
            />
          </div>
        </div>
        <div className="card p-5">
          <span className="section-label">Your circuit</span>
          <div className="mt-3">
            <Histogram
              data={liveBars}
              title="What you are producing right now"
              total={100}
              unit="%"
              highlight={highlight}
            />
          </div>
        </div>
      </section>

      {challenge.kind === 'oracle' ? (
        <p className="rounded-card border border-line bg-surface-2 px-4 py-3 text-xs text-ink-secondary">
          Heads up: this one is graded on <strong className="text-ink">amplitudes</strong>, not the
          histogram. A correct oracle leaves every bar exactly where it is — the two charts above
          will match long before you are done.
        </p>
      ) : null}

      {/* ── Editor ── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="card p-5">
          <span className="section-label">Gates</span>
          <div className="mt-3">
            <GatePalette selected={selectedGate} onSelect={setSelectedGate} />
          </div>
          {angleGate?.hasAngle ? (
            <div className="mt-4">
              <Slider
                label="θ"
                value={theta}
                min={0}
                max={2 * Math.PI}
                step={Math.PI / 16}
                onChange={setTheta}
                format={(v) => `${(v / Math.PI).toFixed(2)}π`}
                hint="Applied to the next rotation gate you place."
              />
            </div>
          ) : null}
        </div>

        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="section-label">Circuit</span>
            <div className="flex gap-2">
              <Stat label="Gates" value={String(gateCount)} />
              {challenge.maxGates !== undefined ? (
                <Stat label="Par" value={String(challenge.maxGates)} accent="amber" />
              ) : null}
            </div>
          </div>

          <CircuitGrid
            circuit={circuit}
            selectedGate={selectedGate}
            theta={theta}
            onChange={setCircuit}
          />

          <ButtonRow>
            <button type="button" className="btn-primary" onClick={handleCheck}>
              Check solution
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={hintsShown >= challenge.hints.length}
              onClick={() => setHintsShown((n) => Math.min(n + 1, challenge.hints.length))}
            >
              {hintsShown >= challenge.hints.length
                ? `All ${challenge.hints.length} hints shown`
                : `Hint ${hintsShown + 1} of ${challenge.hints.length}`}
            </button>
            <button type="button" className="btn-ghost" onClick={handleReset}>
              Reset
            </button>
          </ButtonRow>

          {hintsShown > 0 ? (
            <ol className="space-y-2">
              {challenge.hints.slice(0, hintsShown).map((hint, i) => (
                <li
                  key={hint}
                  className="rounded-card border border-line bg-surface-2 px-4 py-3 text-[13px] text-ink-secondary"
                >
                  <span className="mr-2 font-mono text-[11px] text-q-amber-text">
                    Hint {i + 1} of {challenge.hints.length}
                  </span>
                  {hint}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </section>

      {/* ── Verdict ── */}
      {result ? (
        <section className="card space-y-4 p-6" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="section-label">Result</span>
            <span className="font-mono text-xs text-ink-muted">
              score {(result.score * 100).toFixed(0)}%
            </span>
          </div>

          <p className={`text-sm font-semibold ${result.passed ? 'text-q-teal-text' : 'text-ink'}`}>
            {result.summary}
          </p>

          <ul className="space-y-2">
            {result.checks.map((check) => (
              <li
                key={check.label}
                className="flex items-start gap-3 rounded-card border border-line bg-surface-2 px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 font-mono text-sm font-bold"
                  style={{ color: check.passed ? 'var(--q-teal-text)' : 'var(--q-rose-text)' }}
                >
                  {check.passed ? '✓' : '✗'}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-ink">
                    {check.label}
                    <span className="sr-only">{check.passed ? ' passed' : ' failed'}</span>
                  </span>
                  <span className="block text-[13px] text-ink-secondary">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          {result.passed ? (
            <div
              className="rounded-card border px-5 py-4"
              style={{
                borderColor: 'rgb(var(--q-teal-rgb) / 0.33)',
                background: 'rgb(var(--q-teal-rgb) / 0.10)',
              }}
            >
              <p className="text-[13px] font-bold text-q-teal-text">Solved</p>
              <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-secondary">
                {challenge.successNote}
              </p>
              <p className="mt-3 font-mono text-xs text-ink-muted">
                {result.gateCount} gate{result.gateCount === 1 ? '' : 's'}
                {result.parCount !== undefined ? ` · par ${result.parCount}` : ''}
                {progress.bestGates !== undefined ? ` · your best ${progress.bestGates}` : ''}
                {hintsShown > 0
                  ? ` · ${hintsShown} hint${hintsShown === 1 ? '' : 's'} used`
                  : ' · no hints'}
              </p>
            </div>
          ) : (
            <>
              {gradedCircuit ? (
                <StateDiff challenge={challenge} circuit={gradedCircuit} />
              ) : null}
              {hintsShown > 0 ? (
                <p className="text-xs text-ink-muted">
                  {hintsShown} of {challenge.hints.length} hints revealed so far.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
