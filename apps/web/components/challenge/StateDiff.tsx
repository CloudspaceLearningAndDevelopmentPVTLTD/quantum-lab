'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatKet, simulate, type Circuit } from '@/lib/quantum'
import { currentDeviceEngine, streamDeviceReply } from '@/lib/llm/webllm'
import type { Challenge } from '@/lib/challenges/types'

/**
 * StateDiff — "why is my circuit wrong?", answered with numbers.
 *
 * A bare pass/fail is the cheapest thing to render and the most expensive
 * thing for a learner. The gap quantum-education research keeps finding is
 * between the algorithm someone wrote and the state it actually produced, and
 * a red cross says nothing about either. So the failure branch spends its
 * space on that gap: per basis state, what the target wanted, what the circuit
 * made, and which single divergence is worth fixing first.
 *
 * This component NEVER re-grades. grade() owns the verdict; everything here is
 * the same simulation, read back out.
 */

/**
 * Mirrors DEFAULT_TOLERANCE in lib/challenges/grade.ts, which does not export
 * it. The two must not drift: a row painted "on target" in teal underneath a
 * FAILED verdict is worse than showing no diff at all, and a looser constant
 * here is exactly how that happens.
 */
const DEFAULT_TOLERANCE = 0.02

/**
 * Amplitudes smaller than this count as zero when a phase is read off them —
 * the same threshold, for the same reason, as grade.ts. A 1/sqrt(8) that has
 * been through a dozen gates is not exactly 1/sqrt(8), and dividing by a
 * leftover 1e-17 amplitude produces a confident, random sign.
 */
const AMPLITUDE_EPSILON = 1e-9

/** An amplitude ratio counts as real below this imaginary part. Matches grade.ts. */
const PHASE_EPSILON = 1e-6

/**
 * The register may be 16 qubits wide — 65,536 basis states. Listing them all
 * is not a diff, it is a wall, and 65,536 table rows will also stall the tab.
 * Show the rows carrying the divergence and say how many were left out.
 */
const MAX_ROWS = 8

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
const points = (v: number): string => `${(Math.abs(v) * 100).toFixed(1)} points`

type Divergence = 'excess' | 'short' | 'match'

interface DiffRow {
  index: number
  ket: string
  /** null when the challenge gives us nothing to compare this against. */
  expected: number | null
  actual: number
  /** actual − expected, so positive means the learner produces it too often. */
  delta: number
  kind: Divergence
}

/**
 * How a basis state's phase sits relative to the first non-zero amplitude.
 * 'absent' is not a phase: it is a basis state the target wants and the circuit
 * did not produce, which has no sign to read. grade.ts reaches the same verdict
 * by a different route — Math.sign(0) is 0, which matches neither +1 nor −1 —
 * and this is the name for it, because "relative sign plus" on an amplitude
 * that does not exist is a confident lie.
 */
type RelativeSign = 'plus' | 'minus' | 'complex' | 'absent'

interface SignRow {
  index: number
  ket: string
  expected: 'plus' | 'minus'
  actual: RelativeSign
  matches: boolean
}

type Analysis =
  | { mode: 'unavailable' }
  | { mode: 'actual-only'; rows: DiffRow[]; hidden: number; caption: string }
  | {
      mode: 'diff'
      rows: DiffRow[]
      hidden: number
      worst: DiffRow
      /**
       * Every basis state is inside tolerance, so the diff is all zeros and the
       * histogram has nothing to show. The interesting branch.
       */
      probabilitiesMatch: boolean
      signs: SignRow[]
      signsHidden: number
    }

/**
 * Keep the rows that carry the story. Ranking by |delta| first means the worst
 * divergence is never the one truncation throws away; the later keys keep the
 * choice deterministic on a flat distribution, where every delta is equal and
 * an unstable sort would otherwise reshuffle the table between renders.
 */
function pickRows(rows: DiffRow[]): { rows: DiffRow[]; hidden: number } {
  if (rows.length <= MAX_ROWS) return { rows, hidden: 0 }
  const shown = [...rows]
    .sort(
      (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.actual - a.actual || a.index - b.index
    )
    .slice(0, MAX_ROWS)
    .sort((a, b) => a.index - b.index)
  return { rows: shown, hidden: rows.length - MAX_ROWS }
}

/**
 * Same truncation discipline as pickRows, and it matters more here.
 *
 * A 4-qubit oracle marks one of 16 basis states, and the wrong sign is as
 * likely to sit at index 12 as at index 1. Slicing in index order — which is
 * what this did — left the learner reading eight rows that all say "as wanted"
 * underneath a FAILED verdict, with the offending row cut off the bottom and
 * the sentence above it trailing into a full stop because nothing mismatched
 * in the visible set. That is the "nothing is wrong" lie this whole component
 * exists to avoid, so mismatches are kept first and index order is restored
 * only for display.
 */
function pickSignRows(rows: SignRow[]): { rows: SignRow[]; hidden: number } {
  if (rows.length <= MAX_ROWS) return { rows, hidden: 0 }
  const shown = [...rows]
    .sort((a, b) => Number(a.matches) - Number(b.matches) || a.index - b.index)
    .slice(0, MAX_ROWS)
    .sort((a, b) => a.index - b.index)
  return { rows: shown, hidden: rows.length - MAX_ROWS }
}

/**
 * Read the phases out, for the one case probabilities are blind to.
 *
 * Deliberately relative to the first non-zero amplitude rather than absolute:
 * a state and the same state times a global phase are physically identical, so
 * an absolute sign column would flash red at learners whose answer is perfect.
 * Same anchoring as the oracle check in grade.ts — this reports the phases, it
 * does not re-decide them.
 */
function readSigns(
  challenge: Challenge,
  target: number[],
  amplitudes: { re: number; im: number }[]
): SignRow[] {
  const wanted = challenge.targetSigns
  if (!wanted) return []

  const anchor = amplitudes.findIndex((a) => Math.hypot(a.re, a.im) > AMPLITUDE_EPSILON)
  if (anchor < 0) return []
  const a0 = amplitudes[anchor]
  const denom = a0.re * a0.re + a0.im * a0.im

  const rows: SignRow[] = []
  for (let i = 0; i < amplitudes.length; i++) {
    if ((target[i] ?? 0) <= 0) continue
    const a = amplitudes[i]
    // a_i / a_anchor, computed as a_i * conj(a_anchor) / |a_anchor|^2.
    const ratioRe = (a.re * a0.re + a.im * a0.im) / denom
    const ratioIm = (a.im * a0.re - a.re * a0.im) / denom

    const actual: RelativeSign =
      Math.hypot(a.re, a.im) <= AMPLITUDE_EPSILON
        ? 'absent'
        : Math.abs(ratioIm) > PHASE_EPSILON
          ? 'complex'
          : ratioRe < 0
            ? 'minus'
            : 'plus'
    const expected: 'plus' | 'minus' =
      (wanted[i] ?? 1) * (wanted[anchor] ?? 1) < 0 ? 'minus' : 'plus'

    rows.push({
      index: i,
      ket: formatKet(i, challenge.numQubits),
      expected,
      actual,
      matches: actual === expected,
    })
  }
  return rows
}

function analyse(challenge: Challenge, circuit: Circuit): Analysis {
  let probabilities: number[]
  let amplitudes: { re: number; im: number }[]
  try {
    const state = simulate(circuit)
    probabilities = state.probabilities()
    amplitudes = state.amplitudes()
  } catch {
    // The grader already says the circuit would not simulate, in the words it
    // chose. Two messages about one failure is one too many.
    return { mode: 'unavailable' }
  }

  const target = challenge.targetProbabilities
  const width = circuit.numQubits

  /*
   * Two ways the comparison is not on: a challenge with no target (grade.ts
   * refuses to grade those at all) and a register of the wrong width, where
   * index 3 means |11> on one side and |011> on the other. Lining those up
   * would invent a divergence the learner cannot act on, so fall back to their
   * own distribution and label it for what it is.
   */
  if (!target || target.length !== probabilities.length) {
    const all: DiffRow[] = probabilities.map((actual, index) => ({
      index,
      ket: formatKet(index, width),
      expected: null,
      actual,
      delta: 0,
      kind: 'match' as const,
    }))
    const { rows, hidden } = pickRows(all)
    return {
      mode: 'actual-only',
      rows,
      hidden,
      caption: target
        ? `This challenge is set on ${challenge.numQubits} qubits and your circuit has ${width}, so the basis states do not line up. Here is what your circuit produces on its own.`
        : 'This challenge ships without a target distribution, so there is nothing to compare against. Here is what your circuit produces on its own.',
    }
  }

  const tolerance = challenge.tolerance ?? DEFAULT_TOLERANCE

  const all: DiffRow[] = probabilities.map((actual, index) => {
    const expected = target[index] ?? 0
    const delta = actual - expected
    return {
      index,
      ket: formatKet(index, width),
      expected,
      actual,
      delta,
      kind: Math.abs(delta) <= tolerance ? 'match' : delta > 0 ? 'excess' : 'short',
    }
  })

  const fallback: DiffRow = {
    index: 0,
    ket: formatKet(0, width),
    expected: 0,
    actual: 0,
    delta: 0,
    kind: 'match',
  }
  const worst = all.reduce(
    (acc, row) => (Math.abs(row.delta) > Math.abs(acc.delta) ? row : acc),
    all[0] ?? fallback
  )
  const probabilitiesMatch = Math.abs(worst.delta) <= tolerance
  const { rows, hidden } = pickRows(all)
  const signs = pickSignRows(probabilitiesMatch ? readSigns(challenge, target, amplitudes) : [])

  return {
    mode: 'diff',
    rows,
    hidden,
    worst,
    probabilitiesMatch,
    signs: signs.rows,
    signsHidden: signs.hidden,
  }
}

/** The one sentence a learner should read if they read nothing else. */
function explainWorst(row: DiffRow): string {
  if (row.expected === null || row.kind === 'match') return ''
  if (row.expected <= 0) {
    return `You are producing ${row.ket} ${pct(row.actual)} of the time, and the target never does.`
  }
  if (row.actual <= 0) {
    return `The target lands on ${row.ket} ${pct(
      row.expected
    )} of the time, and your circuit never does.`
  }
  return row.delta > 0
    ? `${row.ket} should come up ${pct(row.expected)} of the time; yours comes up ${pct(
        row.actual
      )} — ${points(row.delta)} too often.`
    : `${row.ket} should come up ${pct(row.expected)} of the time; yours comes up ${pct(
        row.actual
      )} — ${points(row.delta)} short.`
}

const DELTA_TEXT: Record<Divergence, string> = {
  excess: 'text-q-rose-text',
  short: 'text-q-amber-text',
  match: 'text-q-teal-text',
}

/**
 * The difference column is words, not a signed number. "+12.5" needs a legend
 * and reads as "plus twelve point five" to a screen reader, which says nothing
 * about which direction is wrong.
 */
function deltaLabel(row: DiffRow): string {
  if (row.expected === null) return 'no target'
  if (row.kind === 'match') return 'on target'
  return row.kind === 'excess' ? `${points(row.delta)} too much` : `${points(row.delta)} short`
}

/**
 * What the on-device tutor is asked. Built out of the numbers already on
 * screen so the model is commenting on the diff rather than re-deriving it: a
 * 360M model asked to simulate a circuit in its head will confidently invent
 * one, and an invented state is worse here than no prose at all.
 */
function tutorPrompt(challenge: Challenge, analysis: Analysis): string {
  const brief = challenge.brief.replace(/\s+/g, ' ').slice(0, 240)
  if (analysis.mode !== 'diff') {
    return `I am working on a quantum circuit challenge: "${challenge.title}". ${brief} My circuit does not pass. What should I check first?`
  }
  if (analysis.probabilitiesMatch) {
    // Name the offending ket rather than asserting "one basis state needs a
    // minus sign": that sentence was true of the challenge the prompt was
    // written against and false of any oracle whose fault is a stray complex
    // phase, and a 360M model will happily build four confident sentences on
    // top of a premise we handed it.
    const bad = analysis.signs.find((s) => !s.matches)
    const fault = bad
      ? `${bad.ket} ${
          bad.actual === 'complex'
            ? 'carries a complex phase where the challenge wants a plain real sign'
            : bad.actual === 'absent'
              ? 'has no amplitude at all, so it carries no sign'
              : `has a relative ${bad.actual} sign where the challenge wants ${bad.expected}`
        }`
      : 'one basis state carries the wrong relative sign'
    return `I am working on a quantum circuit challenge: "${challenge.title}". ${brief} My measurement probabilities already match the target exactly, but it still fails on phase: ${fault}. Explain in plain language why probabilities cannot show a phase, and which gate puts a minus sign on a single basis state.`
  }
  const table = analysis.rows
    .map((r) => `${r.ket}: target ${pct(r.expected ?? 0)}, mine ${pct(r.actual)}`)
    .join('; ')
  return `I am working on a quantum circuit challenge: "${challenge.title}". ${brief} My measurement probabilities are wrong. ${table}. The biggest gap is on ${analysis.worst.ket}. In plain language, what is most likely wrong with my circuit and which gate should I look at?`
}

export default function StateDiff({
  challenge,
  circuit,
}: {
  challenge: Challenge
  circuit: Circuit
}) {
  const analysis = useMemo(() => analyse(challenge, circuit), [challenge, circuit])

  const [deviceModelId, setDeviceModelId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  /**
   * A stream that outlives its component would set state on a corpse and keep
   * the GPU busy producing an answer nobody can read. Bumping the counter on
   * unmount drops those tokens, and bumping it per request drops the tokens of
   * a superseded answer when the learner checks a second circuit while the
   * first one is still streaming.
   */
  const generation = useRef(0)
  useEffect(() => {
    return () => {
      generation.current += 1
    }
  }, [])

  /**
   * currentDeviceEngine() is module state, not React state, so nothing
   * re-renders when the tutor finishes loading elsewhere in the app. Re-reading
   * it whenever the diff changes — i.e. every time the learner presses Check —
   * is the natural re-poll point, and reading it in an effect rather than
   * during render keeps the server's HTML (no engine, no WebGPU) identical to
   * the client's first paint.
   */
  useEffect(() => {
    setDeviceModelId(currentDeviceEngine()?.modelId ?? null)
    setAnswer('')
    setAskError(null)
  }, [analysis])

  const handleAsk = useCallback(async () => {
    // Re-read rather than trusting the state flag: the learner may have
    // released the engine from /tutor since this component last rendered.
    // createDeviceEngine() is deliberately NOT called here — a diff is not
    // consent to download a gigabyte of weights.
    const live = currentDeviceEngine()
    if (!live) {
      setDeviceModelId(null)
      return
    }
    const mine = ++generation.current
    setAsking(true)
    setAskError(null)
    setAnswer('')
    try {
      await streamDeviceReply(
        live.engine,
        [{ role: 'user', content: tutorPrompt(challenge, analysis) }],
        (full) => {
          if (generation.current === mine) setAnswer(full)
        }
      )
    } catch {
      if (generation.current === mine) {
        setAskError('The on-device tutor stopped before it finished. The diff above still stands.')
      }
    } finally {
      if (generation.current === mine) setAsking(false)
    }
  }, [analysis, challenge])

  if (analysis.mode === 'unavailable') return null

  const worstSentence = analysis.mode === 'diff' ? explainWorst(analysis.worst) : ''
  const wrongSign = analysis.mode === 'diff' ? analysis.signs.find((s) => !s.matches) : undefined
  const showSignRows =
    analysis.mode === 'diff' && analysis.probabilitiesMatch && analysis.signs.length > 0

  return (
    <div className="rounded-card border border-line bg-surface-2 px-5 py-4">
      <h3 className="text-[13px] font-bold text-ink">Where your state diverges</h3>

      {analysis.mode === 'actual-only' ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{analysis.caption}</p>
      ) : analysis.probabilitiesMatch ? (
        /*
         * The classic beginner trap. Showing an all-zero diff here reads as
         * "nothing is wrong", which is the opposite of the lesson, so say what
         * is actually happening instead: probabilities are phase-blind, a
         * global phase is unobservable and never the fault, and what is graded
         * is the relative sign.
         */
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-secondary">
          <p>
            Every basis state is already within tolerance, so the probability diff is all zeros and
            the histogram has nothing left to show you. What differs is{' '}
            <strong className="text-ink">phase</strong>.
          </p>
          <p>
            A <strong className="text-ink">global</strong> phase is never the reason you failed: a
            state and that same state with a phase out front are physically identical, no
            measurement can tell them apart, and the grader ignores it on purpose. What is graded is
            the <strong className="text-ink">relative</strong> sign between basis states
            {wrongSign ? `, and ${wrongSign.ket} is the one carrying the wrong one.` : '.'}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{worstSentence}</p>
      )}

      {showSignRows && analysis.mode === 'diff' ? (
        <ul className="mt-3 space-y-1.5">
          {analysis.signs.map((row) => (
            <li
              key={row.index}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-card border px-3 py-2 text-xs ${
                row.matches ? 'border-line bg-surface-3' : 'border-line-strong bg-q-rose/15'
              }`}
            >
              <span className="font-mono text-q-violet-text">{row.ket}</span>
              <span className={row.matches ? 'text-q-teal-text' : 'text-q-rose-text'}>
                {row.matches
                  ? `relative sign ${row.actual}, as wanted`
                  : row.actual === 'complex'
                    ? `carries a complex phase; this one wants a plain ${row.expected} sign`
                    : row.actual === 'absent'
                      ? `has no amplitude left to carry a sign; this one wants a ${row.expected} sign`
                      : `relative sign ${row.actual}, should be ${row.expected}`}
              </span>
            </li>
          ))}
          {analysis.signsHidden > 0 ? (
            <li className="px-3 text-[11px] text-ink-muted">
              {/* Ordered mismatch-first by pickSignRows, so what is hidden here
                  is only ever rows that were already correct. */}
              {analysis.signsHidden === 1
                ? '1 further basis state carries'
                : `${analysis.signsHidden} further basis states carry`}{' '}
              the sign the challenge asks for.
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-xs">
            <caption className="sr-only">
              {analysis.mode === 'diff'
                ? 'Target probability against the probability your circuit produces, per basis state.'
                : 'The probability your circuit produces, per basis state.'}
            </caption>
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="px-2 py-2 text-left font-bold">
                  State
                </th>
                <th scope="col" className="px-2 py-2 text-right font-bold">
                  Target
                </th>
                <th scope="col" className="px-2 py-2 text-right font-bold">
                  Yours
                </th>
                <th scope="col" className="px-2 py-2 text-right font-bold">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {analysis.rows.map((row) => {
                const isWorst =
                  analysis.mode === 'diff' &&
                  row.index === analysis.worst.index &&
                  row.kind !== 'match'
                return (
                  <tr
                    key={row.index}
                    className={`border-b border-line last:border-0 ${
                      isWorst ? (row.kind === 'excess' ? 'bg-q-rose/15' : 'bg-q-amber/15') : ''
                    }`}
                  >
                    <th
                      scope="row"
                      className="px-2 py-1.5 text-left font-mono font-normal text-q-violet-text"
                    >
                      {row.ket}
                    </th>
                    <td className="px-2 py-1.5 text-right font-mono text-ink-secondary">
                      {row.expected === null ? '—' : pct(row.expected)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-ink-secondary">
                      {pct(row.actual)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right ${
                        // Without a target there is no verdict to colour: teal
                        // "on target" under a failed check would be a lie.
                        row.expected === null ? 'text-ink-muted' : DELTA_TEXT[row.kind]
                      }`}
                    >
                      {deltaLabel(row)}
                      {isWorst ? <span className="ml-1 font-semibold">(largest gap)</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {analysis.hidden > 0 ? (
            <p className="mt-2 text-[11px] text-ink-muted">
              Showing the {analysis.rows.length} most divergent of{' '}
              {analysis.rows.length + analysis.hidden} basis states.
            </p>
          ) : null}
        </div>
      )}

      {/* ── Optional second pass: the same diff, in prose, on the learner's own GPU ── */}
      <div className="mt-4 border-t border-line pt-3">
        {deviceModelId === null ? (
          <p className="text-[11px] text-ink-muted">
            Turning on the on-device tutor at{' '}
            <Link href="/tutor" className="focus-ring text-q-violet-text underline">
              /tutor
            </Link>{' '}
            adds a plain-language walkthrough of this diff, written on your own machine.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="btn-ghost focus-ring text-xs"
              disabled={asking}
              onClick={() => void handleAsk()}
            >
              {asking ? 'Working through it' : 'Explain this with the on-device tutor'}
            </button>

            {askError ? (
              <p className="mt-2 text-[12px] text-q-rose-text">{askError}</p>
            ) : null}

            {answer ? (
              /*
               * A11Y: aria-live is OFF here deliberately, and it has to be set
               * explicitly. This block renders inside the verdict section,
               * which is aria-live="polite", and liveness is inherited from the
               * nearest ancestor that declares it — so without this every
               * streamed token re-announces the whole growing paragraph and a
               * screen-reader user hears the same answer a hundred times. The
               * finished answer is announced exactly once, by the status line
               * below.
               */
              <p
                aria-live="off"
                className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-secondary"
              >
                {answer}
              </p>
            ) : null}

            <p role="status" className="sr-only">
              {asking
                ? 'The on-device tutor is writing an explanation.'
                : answer
                  ? 'The on-device tutor has finished its explanation.'
                  : ''}
            </p>

            {answer && !asking ? (
              <p className="mt-2 text-[11px] text-ink-muted">
                Written on your device by {deviceModelId}. The table above is the arithmetic; this
                is a small model reading it back to you.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
