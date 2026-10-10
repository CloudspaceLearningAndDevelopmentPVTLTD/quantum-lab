'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import CircuitGrid from '@/components/circuit/CircuitGrid'
import { Explainer } from '@/components/ui/VizFrame'
import { ButtonRow, Segmented, Stat } from '@/components/ui/Controls'
import { announce } from '@/lib/a11y/announce'
import { authFetch } from '@/lib/authFetch'
import { fromQasm, type Circuit } from '@/lib/quantum'
import { encodeCircuit } from '@/lib/share-link'
import { generateVerifiedCircuit } from '@/lib/workbench/generate'
import {
  GENERATE_CAVEAT,
  serializeGenerateResult,
  type SerializedAttempt,
  type SerializedGenerateResult,
} from '@/lib/workbench/mcpTool'
import { SPEC_PRESETS, presetById } from '@/lib/workbench/specs'
import { validateSpec, type CircuitSpec } from '@/lib/workbench/verify'

/**
 * /workbench/generate — Verified Circuit Generation.
 *
 * The page owns three things: the spec (a JSON textarea seeded by presets and
 * validated on every keystroke by lib/workbench/verify.ts's validateSpec), the
 * run (a POST to /api/workbench/generate, which runs the generate → verify →
 * repair loop server-side because that is where the model key lives), and the
 * timeline (every attempt the loop recorded, with verdict, diagnostics and
 * diff). Verifying a pasted circuit needs no model, so that path runs in the
 * browser through the same loop function with no provider — the verdict is
 * the same code either way.
 */

type PresetChoice = string

const ATTEMPT_OPTIONS = ['1', '2', '3', '5'] as const
type AttemptChoice = (typeof ATTEMPT_OPTIONS)[number]

function pretty(spec: CircuitSpec): string {
  return JSON.stringify(spec, null, 2)
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function verdictLabel(a: SerializedAttempt): { text: string; tone: 'pass' | 'fail' | 'none' } {
  if (a.verdict) return a.verdict.pass ? { text: 'Pass', tone: 'pass' } : { text: 'Fail', tone: 'fail' }
  return { text: a.parseError?.startsWith('provider error') ? 'Provider error' : 'No circuit', tone: 'none' }
}

const TONE_CLASS: Record<'pass' | 'fail' | 'none', string> = {
  pass: 'bg-q-teal/15 text-q-teal-text border-q-teal/30',
  fail: 'bg-q-rose/15 text-q-rose-text border-q-rose/30',
  none: 'bg-surface-3 text-ink-secondary',
}

export default function GeneratePage() {
  const [presetId, setPresetId] = useState<PresetChoice>('bell')
  const [specText, setSpecText] = useState<string>(() => pretty(presetById('bell')!.spec))
  const [attemptChoice, setAttemptChoice] = useState<AttemptChoice>('3')
  const [candidateQasm, setCandidateQasm] = useState('')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [attempts, setAttempts] = useState<SerializedAttempt[]>([])
  const [result, setResult] = useState<SerializedGenerateResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const specErrorsId = useId()
  const specHintId = useId()
  const candidateHintId = useId()

  useEffect(() => () => abortRef.current?.abort(), [])

  // ── Spec validation, live.
  const validation = useMemo(() => {
    try {
      return validateSpec(JSON.parse(specText))
    } catch (cause) {
      return { ok: false as const, errors: [`Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`] }
    }
  }, [specText])
  const spec = validation.ok ? validation.spec : null

  const candidate = useMemo<Circuit | null>(() => {
    if (!candidateQasm.trim()) return null
    const c = fromQasm(candidateQasm)
    return c.ops.length > 0 ? c : null
  }, [candidateQasm])

  const applyPreset = (id: PresetChoice) => {
    const p = presetById(id)
    if (!p) return
    setPresetId(id)
    setSpecText(pretty(p.spec))
  }

  const presetOptions = [
    ...SPEC_PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ...(presetId === 'edited' ? [{ value: 'edited', label: 'Edited' }] : []),
  ]

  // ── Local verification: the same loop, no provider, one round.
  const verifyLocally = useCallback(
    async (prefix = '') => {
      if (!spec || !candidate) return
      setPhase('running')
      setNotice(null)
      const r = await generateVerifiedCircuit(spec, null, { maxAttempts: 1, candidate })
      const serialized = serializeGenerateResult(r, spec)
      setAttempts(serialized.attempts)
      setResult(serialized)
      setPhase('done')
      const msg = `${prefix}${serialized.ok ? 'Candidate passes the spec.' : 'Candidate fails the spec — see the diagnostics.'} Verified in your browser; no model was called.`
      setNotice(msg)
      announce(msg)
    },
    [spec, candidate],
  )

  // ── The real run: server-side loop, streamed one attempt per line.
  const generate = useCallback(async () => {
    if (!spec) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('running')
    setNotice(null)
    setResult(null)
    setAttempts([])
    const seen: SerializedAttempt[] = []
    let finished = false

    const handleLine = async (line: string) => {
      const body = JSON.parse(line) as
        | { type: 'attempt'; attempt: SerializedAttempt }
        | ({ type: 'result' } & SerializedGenerateResult)
        | { type: 'error'; error: string }
        | { offline: true; reason: string }
        | { error: string }
        | SerializedGenerateResult
      if ('type' in body && body.type === 'attempt') {
        seen.push(body.attempt)
        setAttempts([...seen])
        announce(
          body.attempt.verdict
            ? `Attempt ${body.attempt.index}: ${body.attempt.verdict.pass ? 'pass' : 'fail'}.`
            : `Attempt ${body.attempt.index}: no circuit.`,
        )
        return
      }
      if ('offline' in body && body.offline) {
        finished = true
        if (candidate) await verifyLocally(`${body.reason} `)
        else {
          setNotice(body.reason)
          announce(body.reason)
          setPhase('done')
        }
        return
      }
      if ('error' in body && !('attempts' in body)) {
        finished = true
        setNotice(body.error)
        setPhase('done')
        announce(body.error, 'assertive')
        return
      }
      const r = body as SerializedGenerateResult
      finished = true
      setResult(r)
      setAttempts(r.attempts)
      setPhase('done')
      const msg = r.ok
        ? `Passed on attempt ${r.attempts.length} of ${attemptChoice}.`
        : r.stopped === 'exhausted'
          ? `No attempt passed after ${r.attempts.length} round(s).`
          : r.stopped === 'provider_error'
            ? `The model call failed: ${r.error ?? 'unknown error'}.`
            : r.stopped === 'no_provider'
              ? 'No model is configured for your tier.'
              : 'Stopped.'
      setNotice(msg)
      announce(msg)
    }

    try {
      const res = await authFetch('/api/workbench/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec,
          maxAttempts: Number(attemptChoice),
          ...(candidate ? { candidateQasm } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.body) {
        await handleLine(await res.text())
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (line) await handleLine(line)
          nl = buffer.indexOf('\n')
        }
      }
      const tail = buffer.trim()
      if (tail) await handleLine(tail)
      if (!finished) {
        setNotice('The run ended without a final verdict.')
        setPhase('done')
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        const msg =
          seen.length > 0
            ? `Stopped after ${seen.length} attempt(s). They are kept below; no circuit was verified as passing.`
            : 'Stopped before the first attempt came back.'
        setNotice(msg)
        announce(msg)
        setPhase('done')
        return
      }
      setNotice(`The run failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      setPhase('done')
    }
  }, [spec, attemptChoice, candidate, candidateQasm, verifyLocally])

  const stop = () => abortRef.current?.abort()

  // ── What to draw: the passing circuit, else the last one that parsed.
  const shown = useMemo(() => {
    if (result?.circuit) return { circuit: result.circuit, qasm: result.qasm, passed: true }
    const last = [...attempts].reverse().find((a) => a.circuit)
    return last ? { circuit: last.circuit!, qasm: last.qasm, passed: last.verdict?.pass === true } : null
  }, [result, attempts])

  const copyQasm = async () => {
    if (!shown?.qasm) return
    try {
      await navigator.clipboard.writeText(shown.qasm)
      setCopied(true)
      announce('QASM copied to the clipboard.')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      announce('Could not copy. Select the text and copy it by hand.', 'assertive')
    }
  }

  const specSummary = spec
    ? `${spec.numQubits} qubit(s) · ${spec.target.kind}` +
      (spec.constraints?.allowedGates ? ` · gates {${spec.constraints.allowedGates.join(', ')}}` : '') +
      (spec.constraints?.maxDepth !== undefined ? ` · depth ≤ ${spec.constraints.maxDepth}` : '') +
      (spec.constraints?.maxGates !== undefined ? ` · gates ≤ ${spec.constraints.maxGates}` : '')
    : null

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="max-w-3xl">
        <p className="section-label">Workbench · Generate</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">Verified Circuit Generation</h1>
        <p className="section-desc mt-3">
          Write down what the circuit must do — a histogram, a state, a unitary, and what it may
          use to get there. A model proposes a circuit; the simulator checks it against your spec;
          if it fails, the exact diagnostics go back to the model and it tries again. You get the
          circuit that passed, and the record of every one that did not.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ── 1 · Spec ─────────────────────────────────────────────── */}
        <section aria-labelledby="spec-heading" className="card space-y-4 p-5">
          <h2 id="spec-heading" className="section-label">
            1 · The spec
          </h2>

          <Segmented<PresetChoice>
            label="Presets"
            value={presetId}
            options={presetOptions}
            onChange={applyPreset}
          />

          <label className="block">
            <span className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-ink-secondary">Spec (JSON)</span>
              <span className="font-mono text-[11px] text-ink-muted">{specSummary ?? 'invalid'}</span>
            </span>
            <textarea
              value={specText}
              onChange={(e) => {
                setSpecText(e.target.value)
                setPresetId('edited')
              }}
              spellCheck={false}
              rows={14}
              aria-invalid={!validation.ok}
              aria-describedby={`${specHintId} ${validation.ok ? '' : specErrorsId}`.trim()}
              className="focus-ring w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink"
            />
            <span id={specHintId} className="mt-1 block text-[11px] text-ink-muted">
              target.kind is distribution, statevector or unitary. Labels are MSB-first: on two
              qubits &ldquo;01&rdquo; means q[1]=0, q[0]=1. State and unitary targets are compared
              up to global phase.
            </span>
          </label>

          {!validation.ok ? (
            <ul id={specErrorsId} className="space-y-1 rounded-lg border border-q-rose/30 bg-q-rose/10 p-3 text-[12px] text-ink">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}

          <Segmented<AttemptChoice>
            label="Attempt budget"
            value={attemptChoice}
            options={ATTEMPT_OPTIONS.map((v) => ({ value: v, label: v }))}
            onChange={setAttemptChoice}
          />

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary">
              Candidate circuit (optional, OpenQASM 3)
            </span>
            <textarea
              value={candidateQasm}
              onChange={(e) => setCandidateQasm(e.target.value)}
              spellCheck={false}
              rows={5}
              placeholder={'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];'}
              aria-describedby={candidateHintId}
              className="focus-ring w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink"
            />
            <span id={candidateHintId} className="mt-1 block text-[11px] text-ink-muted">
              Checked first. If it passes, no model is called; if it fails, its diagnostics seed the
              first repair round.
              {candidateQasm.trim() && !candidate ? ' No gates could be parsed from this yet.' : ''}
            </span>
          </label>

          <ButtonRow>
            <button
              type="button"
              className="btn-primary focus-ring"
              onClick={generate}
              disabled={!spec || phase === 'running'}
            >
              {phase === 'running' ? 'Running…' : 'Generate and verify'}
            </button>
            <button
              type="button"
              className="btn-ghost focus-ring"
              onClick={() => verifyLocally()}
              disabled={!spec || !candidate || phase === 'running'}
            >
              Verify candidate only
            </button>
            {phase === 'running' ? (
              <button type="button" className="btn-ghost focus-ring" onClick={stop}>
                Stop
              </button>
            ) : null}
          </ButtonRow>

          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[12px] text-ink-secondary">
            {phase === 'running'
              ? `Running up to ${attemptChoice} round(s). Each round is one model call and one exact simulation.`
              : notice ?? ''}
          </p>

          <p className="text-[11px] leading-relaxed text-ink-muted">
            <strong className="text-ink-secondary">What this does not do.</strong> It verifies
            against <em>your</em> spec on an ideal simulator. It cannot tell whether the spec is
            what you meant, it ignores noise, and nothing here runs on hardware. Generation uses
            the same model and daily allowance as the tutor; verification runs locally and is free.
          </p>
        </section>

        {/* ── 2 · Attempts ─────────────────────────────────────────── */}
        <section aria-labelledby="timeline-heading" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="timeline-heading" className="section-label">
              2 · Attempts
            </h2>
            {result ? (
              <span className="font-mono text-[11px] text-ink-muted">
                {result.modelCalls} model call(s)
                {result.provider ? ` · ${result.provider}` : ''}
              </span>
            ) : null}
          </div>

          {attempts.length === 0 ? (
            <div className="card p-5 text-[13px] text-ink-secondary">
              {phase === 'running' ? (
                <span className="motion-safe:animate-pulse">Waiting for the first attempt…</span>
              ) : (
                <>
                  Nothing yet. Pick a preset, adjust the spec if you like, and press{' '}
                  <strong className="text-ink">Generate and verify</strong>. Each attempt lands
                  here with its verdict, the diagnostics the verifier produced, and what changed
                  from the attempt before.
                </>
              )}
            </div>
          ) : (
            <ol className="space-y-3">
              {attempts.map((a) => (
                <AttemptCard key={a.index} attempt={a} />
              ))}
              {phase === 'running' ? (
                <li className="card p-4 text-[13px] text-ink-secondary motion-safe:animate-pulse">
                  Attempt {attempts.length + 1}: waiting for the model…
                </li>
              ) : null}
            </ol>
          )}
        </section>
      </div>

      {/* ── 3 · The circuit ─────────────────────────────────────────── */}
      {shown ? (
        <section aria-labelledby="circuit-heading" className="card mt-6 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="circuit-heading" className="section-label">
              3 · {shown.passed ? 'The verified circuit' : 'Last attempt (did not pass)'}
            </h2>
            <span className={`pill ${TONE_CLASS[shown.passed ? 'pass' : 'fail']}`}>
              {shown.passed ? 'Passes the spec' : 'Fails the spec'}
            </span>
          </div>
          {/* Read-only: `inert` takes the grid out of pointer and keyboard reach. */}
          <div inert className="overflow-x-auto">
            <CircuitGrid
              circuit={shown.circuit}
              selectedGate={null}
              theta={0}
              onChange={() => undefined}
              classicalControl={false}
            />
          </div>
          {shown.qasm ? (
            <pre className="code-block mt-3" tabIndex={0} aria-label="Circuit as OpenQASM 3">
              {shown.qasm}
            </pre>
          ) : null}
          <div className="mt-3">
            <ButtonRow>
              <button type="button" className="btn-ghost focus-ring" onClick={copyQasm} disabled={!shown.qasm}>
                {copied ? 'Copied' : 'Copy QASM'}
              </button>
              <a className="btn-ghost focus-ring" href={`/simulator?c=${encodeCircuit(shown.circuit)}`}>
                Open in the simulator
              </a>
            </ButtonRow>
          </div>
        </section>
      ) : null}

      <div className="mt-8">
        <Explainer title="What a pass means">
          <p>
            The verifier runs the circuit on the exact statevector simulator behind every
            visualization on this site and compares the result with the target you wrote. A
            distribution target passes when every basis state is within the tolerance. A
            statevector target passes when |⟨target|ψ⟩|² clears the fidelity bar; a unitary target
            when |Tr(V†U)|²/d² does. Both are blind to a global phase, on purpose: X and Y both
            prepare |1⟩ and both pass a |1⟩ spec.
          </p>
          <p>
            A pass is a statement about the spec as written. If the spec says &ldquo;50% on 00 and
            50% on 11&rdquo;, a circuit that prepares (|00⟩ − |11⟩)/√2 passes it — the histogram
            cannot see the sign. If the sign matters to you, write a statevector target.
          </p>
        </Explainer>

        <Explainer title="What to watch for in the timeline">
          <p>
            The interesting attempt is usually the second one. Read its diff: did the model change
            the gate the diagnostics pointed at, or something unrelated? A model that answers
            &ldquo;|01⟩ has 100% but should have 0%&rdquo; by adding a CX has read the message; one
            that rewrites the whole circuit has not.
          </p>
          <p>
            Constraint failures are reported separately from physics failures. A verdict that
            reads &ldquo;right physics, but gates outside the allowed set&rdquo; means the model
            solved the problem and ignored the rules — the repair prompt says so in those words.
          </p>
        </Explainer>

        <Explainer title="Writing a spec by hand">
          <p>
            <code>numQubits</code> fixes the register width; the circuit must use exactly that many.
            Bitstring labels are MSB-first like Qiskit&rsquo;s: qubit 0 is the rightmost character.
            Amplitudes and matrix entries are listed in basis order 0 … 2ⁿ−1, where index i has
            qubit k set when bit k of i is set; write complex entries as{' '}
            <code>{'{ "re": 0, "im": 1 }'}</code>. <code>constraints.allowedGates</code> takes the
            names from the gate palette (H, X, CX, RY, …); <code>maxDepth</code> counts layers of
            gates that cannot run at the same time.
          </p>
          <p className="text-ink-muted">{GENERATE_CAVEAT}</p>
        </Explainer>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// One attempt in the timeline
// ────────────────────────────────────────────────────────────

function AttemptCard({ attempt: a }: { attempt: SerializedAttempt }) {
  const verdict = verdictLabel(a)
  const v = a.verdict
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">
          Attempt {a.index}
          <span className="ml-2 font-normal text-ink-muted">
            {a.source === 'candidate' ? 'your candidate' : 'model'} · {(a.durationMs / 1000).toFixed(1)}s
          </span>
        </h3>
        <span className={`pill ${TONE_CLASS[verdict.tone]}`}>{verdict.text}</span>
      </div>

      {v ? (
        <>
          <p className="mt-2 text-[13px] text-ink-secondary">{v.summary}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Score" value={v.score.toFixed(3)} accent={v.pass ? 'teal' : 'rose'} />
            <Stat label="Fidelity" value={v.fidelity === null ? '—' : v.fidelity.toFixed(4)} accent="violet" />
            <Stat label="Gates · 2-qubit" value={`${v.metrics.gateCount} · ${v.metrics.twoQubitGates}`} accent="sky" />
            <Stat label="Depth" value={String(v.metrics.depth)} accent="amber" />
          </div>
          {v.diagnostics.some((d) => d.level !== 'info') ? (
            <ul className="mt-3 space-y-1 text-[12px] leading-relaxed">
              {v.diagnostics
                .filter((d) => d.level !== 'info')
                .map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className={`shrink-0 font-mono text-[11px] ${d.level === 'error' ? 'text-q-rose-text' : 'text-q-amber-text'}`}
                    >
                      {d.level}
                    </span>
                    <span className="text-ink">{d.message}</span>
                  </li>
                ))}
            </ul>
          ) : null}
          {v.stateDeviations.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse text-left text-[12px]">
                <caption className="sr-only">Basis states whose probability is off, worst first.</caption>
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink-muted">
                    <th scope="col" className="py-1 pr-3 font-bold">State</th>
                    <th scope="col" className="py-1 pr-3 text-right font-bold">Target</th>
                    <th scope="col" className="py-1 pr-3 text-right font-bold">Got</th>
                    <th scope="col" className="py-1 text-right font-bold">Δ</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {v.stateDeviations.map((d) => (
                    <tr key={d.label} className="border-b border-line">
                      <th scope="row" className="py-1 pr-3 text-left font-semibold text-ink">|{d.label}⟩</th>
                      <td className="py-1 pr-3 text-right text-ink-secondary">{pct(d.target)}</td>
                      <td className="py-1 pr-3 text-right text-ink">{pct(d.actual)}</td>
                      <td className={`py-1 text-right ${d.delta > 0 ? 'text-q-amber-text' : 'text-q-rose-text'}`}>
                        {d.delta >= 0 ? '+' : ''}
                        {pct(d.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[13px] text-q-rose-text">{a.parseError ?? 'No circuit was produced.'}</p>
      )}

      {a.diff ? (
        <details className="mt-3">
          <summary className="focus-ring cursor-pointer rounded text-[12px] font-semibold text-ink-secondary">
            Diff against the previous attempt
            {a.diffCounts ? ` (+${a.diffCounts.added} −${a.diffCounts.removed})` : ''}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-3 p-3 font-mono text-[11px] leading-relaxed">
            {a.diff.split('\n').map((line, i) => (
              <span
                key={i}
                className={
                  line.startsWith('+')
                    ? 'block text-q-teal-text'
                    : line.startsWith('-')
                      ? 'block text-q-rose-text'
                      : 'block text-ink-secondary'
                }
              >
                {line}
              </span>
            ))}
          </pre>
        </details>
      ) : null}

      {a.qasm ? (
        <details className="mt-2">
          <summary className="focus-ring cursor-pointer rounded text-[12px] font-semibold text-ink-secondary">
            Circuit (OpenQASM 3)
          </summary>
          <pre className="code-block mt-2">{a.qasm}</pre>
        </details>
      ) : null}

      {a.prompt || a.reply ? (
        <details className="mt-2">
          <summary className="focus-ring cursor-pointer rounded text-[12px] font-semibold text-ink-secondary">
            What the model was told, and what it said
          </summary>
          {a.prompt ? (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-3 p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
              {a.prompt}
            </pre>
          ) : null}
          {a.reply ? (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-3 p-3 font-mono text-[11px] leading-relaxed text-ink">
              {a.reply}
            </pre>
          ) : null}
        </details>
      ) : null}
    </li>
  )
}
