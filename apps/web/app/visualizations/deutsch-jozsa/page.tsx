'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useState } from 'react'
import DeutschJozsaLab from '@/components/viz/DeutschJozsaLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Stat, Slider } from '@/components/ui/Controls'
import { formatKet } from '@/lib/quantum'
import {
  MAX_INPUT_QUBITS,
  QUANTUM_QUERIES,
  bitString,
  bvClassicalQueries,
  bvReadout,
  classify,
  djClassicalQueries,
  djSteps,
  djVerdict,
  inputProbabilities,
  nonLinearBalancedTable,
  truthTable,
  type OracleSpec,
} from '@/lib/viz/deutschJozsa'

type Mode = 'dj' | 'bv'
type DjOracleId = 'const0' | 'const1' | 'parity' | 'nonlinear'

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'dj', label: 'Deutsch–Jozsa' },
  { value: 'bv', label: 'Bernstein–Vazirani' },
]

const QUBIT_OPTIONS = [2, 3, 4].map((n) => ({ value: String(n), label: `${n} qubits` }))

const ORACLE_OPTIONS: { value: DjOracleId; label: string }[] = [
  { value: 'const0', label: 'Constant 0' },
  { value: 'const1', label: 'Constant 1' },
  { value: 'parity', label: 'Balanced · parity' },
  { value: 'nonlinear', label: 'Balanced · not a parity' },
]

/**
 * Short names for the step control, not bare numbers: those buttons are the
 * fastest way back to the oracle step, and "4" is not a way back to anything.
 */
const STEP_LABELS = ['Init', 'Ancilla', 'H', 'Oracle', 'H again']

const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(4)}`

/**
 * The headline the whole page exists to make legible: how many times each kind of
 * computer has to call the oracle. Extended past the 2-4 qubits the live demo can
 * run, because the gap only becomes absurd at sizes a browser cannot simulate.
 *
 * Deliberately a QUERY count, not a runtime: this page runs a classical
 * statevector simulator, so a wall-clock comparison here would be fabricated.
 * The query counts are theorems.
 */
function QueryScoreboard({ mode }: { mode: Mode }) {
  const [n, setN] = useState(10)
  const classical = mode === 'dj' ? 2 ** (n - 1) + 1 : n
  return (
    <Explainer title="One query, at any size">
      <p>
        {mode === 'dj' ? (
          <>
            To be <em>certain</em> whether f is constant or balanced, a classical algorithm may
            have to see half the inputs plus one: 2<sup>n−1</sup> + 1 queries. Until that last
            call, every answer so far is still consistent with both. The quantum circuit above
            asks once, at every n.
          </>
        ) : (
          <>
            A hidden n-bit string takes n classical queries — each call to f returns one bit, and
            n bits cannot be squeezed out of fewer than n bits of answer. The quantum circuit
            above gets the whole string from one call.
          </>
        )}
      </p>

      <div className="my-4 rounded-lg border border-line bg-surface-2 p-4">
        <Slider
          label="Input size n"
          value={n}
          min={2}
          max={40}
          step={1}
          onChange={(v) => setN(Math.round(v))}
          format={(v) => `${Math.round(v)} bits`}
          hint="The live demo above stops at 4 — past that the statevector no longer fits in a browser tab, but the counting does not change."
        />
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Stat
            label={mode === 'dj' ? 'Classical, to be certain' : 'Classical queries'}
            value={classical.toLocaleString('en-US')}
            accent="rose"
          />
          <Stat label="Quantum queries" value={`${QUANTUM_QUERIES}`} accent="teal" />
        </div>
      </div>

      <p>
        {mode === 'dj' ? (
          <>
            The honest footnote: if you allow a <em>small chance of being wrong</em>, a classical
            algorithm settles Deutsch–Jozsa in a handful of random queries — two differing answers
            prove balanced, and a run of identical ones makes constant overwhelmingly likely. The
            exponential gap here is against <em>certainty</em>, and that is exactly why
            Bernstein–Vazirani mattered more: its n-versus-1 gap survives randomness, because n
            bits of answer genuinely require n classical questions.
          </>
        ) : (
          <>
            Unlike Deutsch–Jozsa, this gap does not evaporate if you allow the classical algorithm
            to be occasionally wrong. Learning n bits requires n bits of answer, however you ask.
            That robustness is why Bernstein–Vazirani, not Deutsch–Jozsa, is the ancestor of
            Simon&rsquo;s algorithm and then of Shor&rsquo;s.
          </>
        )}
      </p>
    </Explainer>
  )
}

export default function DeutschJozsaPage() {
  const [mode, setMode] = useState<Mode>('dj')
  const [qubitChoice, setQubitChoice] = useState('3')
  const [oracleId, setOracleId] = useState<DjOracleId>('parity')
  const [hidden, setHidden] = useState(0b101)
  const [step, setStep] = useState(0)
  const hiddenGroupId = useId()

  const n = parseInt(qubitChoice, 10)
  const dim = 1 << n

  // Keep the hidden string inside the register when it shrinks, and restart the
  // walkthrough when the register size or the algorithm changes.
  //
  // Deliberately NOT reset when the oracle or the hidden string changes: parking
  // on step 4 and switching oracles is the sharpest comparison this page offers —
  // the same bars, a different set of signs — and resetting would throw the
  // reader back to the start every time they tried it.
  useEffect(() => {
    setHidden((s) => s & (dim - 1))
    setStep(0)
  }, [dim])
  useEffect(() => {
    setStep(0)
  }, [mode])

  const spec: OracleSpec = useMemo(() => {
    if (mode === 'bv') return { kind: 'parity', s: hidden & (dim - 1), b: 0 }
    switch (oracleId) {
      case 'const0':
        return { kind: 'constant', value: 0 }
      case 'const1':
        return { kind: 'constant', value: 1 }
      case 'parity':
        return { kind: 'parity', s: dim - 1, b: 0 }
      case 'nonlinear':
        return { kind: 'table', values: nonLinearBalancedTable(n) }
    }
  }, [mode, oracleId, hidden, dim, n])

  const table = useMemo(() => truthTable(spec, n), [spec, n])
  const steps = useMemo(() => djSteps(n, spec), [n, spec])
  const safeStep = Math.min(step, steps.length - 1)
  const current = steps[safeStep]

  const amplitudes = useMemo(() => current.amplitudes, [current])
  const probabilities = useMemo(() => inputProbabilities(current.state, n), [current, n])

  const oracleClass = classify(table)
  const finalState = steps[steps.length - 1].state
  const verdict = djVerdict(finalState, n)
  const readout = bvReadout(finalState, n)
  const highlight = mode === 'bv' ? readout.s : 0
  const done = safeStep === steps.length - 1

  const stepOptions = steps.map((s, i) => ({ value: String(i), label: STEP_LABELS[i] ?? s.title }))

  const controls = (
    <>
      <Segmented<Mode> label="Algorithm" value={mode} options={MODE_OPTIONS} onChange={setMode} />

      <Segmented
        label="Input register"
        value={qubitChoice}
        options={QUBIT_OPTIONS}
        onChange={setQubitChoice}
      />

      {mode === 'dj' ? (
        <Segmented<DjOracleId>
          label="Oracle f"
          value={oracleId}
          options={ORACLE_OPTIONS}
          onChange={setOracleId}
        />
      ) : (
        <div>
          <span
            id={hiddenGroupId}
            className="mb-1.5 block text-[13px] font-semibold text-ink-secondary"
          >
            Hidden string s
          </span>
          <div role="group" aria-labelledby={hiddenGroupId} className="flex flex-wrap gap-1">
            {Array.from({ length: n }, (_, k) => n - 1 - k).map((bit) => {
              const on = ((hidden >> bit) & 1) === 1
              return (
                <button
                  key={bit}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Bit ${bit} of the hidden string, currently ${on ? 1 : 0}`}
                  onClick={() => setHidden((s) => s ^ (1 << bit))}
                  className={`focus-ring min-h-[44px] min-w-[44px] flex-1 rounded-lg border font-mono text-sm font-bold transition-colors ${
                    on
                      ? 'border-q-teal/40 bg-q-teal/15 text-q-teal-text'
                      : 'border-line bg-surface-2 text-ink-muted hover:text-ink-secondary'
                  }`}
                >
                  {on ? 1 : 0}
                </button>
              )
            })}
          </div>
          <p className="mt-1 block text-[11px] text-ink-muted">
            f(x) = s · x mod 2. The circuit never sees s — only one call to f, which returns a
            single bit.
          </p>
        </div>
      )}

      <Segmented
        label="Step"
        value={String(safeStep)}
        options={stepOptions}
        onChange={(v) => setStep(parseInt(v, 10))}
      />

      <ButtonRow>
        <button
          type="button"
          className="btn-primary focus-ring"
          onClick={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
          disabled={done}
        >
          Next step
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={safeStep === 0}
        >
          Back
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={() => setStep(0)}>
          Reset
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Classical queries"
          value={`${mode === 'dj' ? djClassicalQueries(n) : bvClassicalQueries(n)}`}
          accent="rose"
        />
        <Stat label="Quantum queries" value={`${QUANTUM_QUERIES}`} accent="teal" />
        {mode === 'dj' ? (
          <>
            <Stat label="f is" value={oracleClass} accent="amber" />
            <Stat label={`P(${formatKet(0, n)})`} value={pct(verdict.pAllZero)} accent="violet" />
          </>
        ) : (
          <>
            <Stat label="s you hid" value={bitString(hidden & (dim - 1), n)} accent="amber" />
            <Stat label="s it reads" value={bitString(readout.s, n)} accent="violet" />
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        The oracle is a real reversible circuit on {n} + 1 qubits, built from X and
        multi-controlled X gates — not a phase table written in by hand.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Deutsch–Jozsa: The First Quantum Speedup"
      tagline="Two algorithms, one circuit, one call to the oracle — where a classical computer that has to be certain may need half the inputs plus one."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <DeutschJozsaLab
            amplitudes={amplitudes}
            numQubits={n}
            table={table}
            caption={`${safeStep + 1}/${steps.length} · ${current.title}`}
            highlight={done ? highlight : null}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Bars are amplitudes, not probabilities — they carry a sign. Step through and watch the
            oracle change only which side of the line each bar sits on, then watch the second
            Hadamard layer turn that pattern into an answer.
          </p>
        </div>
      }
      controls={controls}
    >
      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">
          Step {safeStep + 1} of {steps.length}: {current.title}
        </h2>
        <p className="mb-4 text-[15px] leading-relaxed text-ink-secondary">{current.detail}</p>

        {/* A11Y and precision: the canvas is a picture of these numbers. The table
            is always rendered, never a toggle, because the exact signs are the
            content of the page and a bar chart cannot state them. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Amplitude of every input-register basis state after step {safeStep + 1},{' '}
              {current.title}, with the oracle&rsquo;s truth table.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="py-2 text-left font-bold" scope="col">
                  x
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  f(x)
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Amplitude
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  P(x) if measured now
                </th>
              </tr>
            </thead>
            <tbody>
              {amplitudes.map((a, x) => (
                <tr
                  key={x}
                  className={`border-b border-line last:border-0 ${
                    done && x === highlight ? 'bg-q-amber/10' : ''
                  }`}
                >
                  <td className="py-1.5 font-mono text-q-violet-text">{formatKet(x, n)}</td>
                  <td
                    className={`py-1.5 text-right font-mono ${
                      table[x] === 1 ? 'text-q-amber-text' : 'text-ink-muted'
                    }`}
                  >
                    {table[x]}
                  </td>
                  <td
                    className={`py-1.5 text-right font-mono ${
                      a < -1e-9 ? 'text-q-rose-text' : a > 1e-9 ? 'text-q-teal-text' : 'text-ink-muted'
                    }`}
                  >
                    {signed(a)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-ink-secondary">
                    {pct(probabilities[x])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Explainer title="What you are manipulating">
        <p>
          The circuit is {n} input qubits plus one ancilla. You choose the oracle — a black box
          that computes some f you are not allowed to look inside — and then step the circuit:
          prepare the ancilla, spread the input register over all {dim} inputs, call f{' '}
          <strong>once</strong>, and interfere.
        </p>
        <p>
          Watch two things. At step 4, the bar heights do not change at all: the oracle rearranges
          signs, and a measurement taken there is uniform noise. At step 5,{' '}
          {mode === 'dj'
            ? `all of that amplitude either piles onto ${formatKet(0, n)} or vanishes from it — there is no in-between.`
            : `all of it piles onto the string you hid, and nowhere else.`}
        </p>
      </Explainer>

      <Explainer title="How one call learns something global">
        <p>
          The trick is the ancilla. Put it in |−⟩ = (|0⟩ − |1⟩)/√2 and the oracle&rsquo;s XOR onto
          it stops being a write and becomes a <em>sign</em>: U<sub>f</sub>|x⟩|−⟩ = (−1)
          <sup>f(x)</sup>|x⟩|−⟩. The ancilla comes out exactly as it went in — you can check this
          on the page, the state stays a product at every step — and the input register is left
          carrying f&rsquo;s entire truth table as a pattern of plus and minus signs.
        </p>
        <p>
          That pattern is not readable. Every outcome is still equally likely, so measuring it
          gives you one random x and one bit of f, which is exactly what a classical query gives.
          What the second Hadamard layer does is ask a question about the pattern as a whole:
          amplitude {formatKet(0, n)} after it is the <em>average</em> of the signs. A constant f
          averages to ±1, a balanced f averages to exactly 0. Nothing else can happen.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          {mode === 'dj' ? (
            <>
              You called f once and learned a property of all {dim} of its values. The oracle you
              picked is <strong>{oracleClass}</strong>, and the final state puts{' '}
              {pct(verdict.pAllZero)} of its probability on {formatKet(0, n)} — so a single shot,
              with no repetition and no error bars, decides it. Switch between a constant and a
              balanced oracle and watch that number jump between 100% and 0% with nothing in
              between.
            </>
          ) : (
            <>
              You hid the string {bitString(hidden & (dim - 1), n)} inside a function that only
              ever answers one bit at a time, and the circuit read all {n} bits back in one call.
              The final state puts {pct(readout.probability)} of its probability on exactly that
              string. Change a bit and watch the peak move to match.
            </>
          )}
        </p>
        <p>
          Try the balanced oracle that is <em>not</em> a parity. Deutsch–Jozsa still answers
          correctly — it only ever asks &ldquo;is the average of the signs zero?&rdquo; — but the
          Bernstein–Vazirani readout on the same function is spread across several outcomes,
          because there is no hidden string to find. The promise that f is linear is doing real
          work, and at 2 qubits you cannot even see the difference: every balanced function on two
          bits happens to be a parity.
        </p>
      </Explainer>

      <QueryScoreboard mode={mode} />

      <Explainer title="Why a contrived problem is still the right place to start">
        <p>
          Nobody needs to know whether a black box is constant or balanced. Deutsch–Jozsa was built
          to be the smallest problem where a quantum computer is provably faster than any
          classical algorithm that must be certain of its answer — small enough that you can follow
          it amplitude by amplitude, as you just did, instead of taking the speedup on faith.
        </p>
        <p>
          The technique generalised immediately. Bernstein–Vazirani is the same circuit reading a
          linear function; Simon&rsquo;s algorithm is the same idea with a hidden period instead of
          a hidden string, and gives an exponential separation that no randomised classical
          algorithm can close; Shor&rsquo;s algorithm is Simon&rsquo;s idea over the integers, with{' '}
          <Link href="/visualizations/qft" className="focus-ring text-q-teal-text underline">
            the quantum Fourier transform
          </Link>{' '}
          doing the final read. Every one of them is: spread out, make the answer interfere with
          itself, measure once.
        </p>
        <p>
          The other family starts from{' '}
          <Link href="/visualizations/grover" className="focus-ring text-q-teal-text underline">
            Grover&rsquo;s search
          </Link>
          , which uses the same phase-kickback oracle you just stepped through but amplifies one
          answer instead of cancelling a pattern — and buys a quadratic speedup rather than an
          exponential one, on a problem people actually have.
        </p>
      </Explainer>

      <Explainer title="What the oracle costs, honestly">
        <p>
          Query counts hide the price of the box. The oracle here is a real circuit: for a general
          truth table it is one {n}-controlled X per input with f(x) = 1, and a {n}-controlled X
          decomposes into a number of two-qubit gates that grows with {n}. On a machine, the
          &ldquo;one query&rdquo; is one call to a subroutine that may be enormous.
        </p>
        <p>
          The comparison is still fair, because the classical algorithm has to run that same
          subroutine 2<sup>n−1</sup> + 1 times. But &ldquo;one query&rdquo; is not &ldquo;one gate&rdquo;,
          and a page that let you believe otherwise would be selling something. The register here
          stops at {MAX_INPUT_QUBITS} qubits for the same reason every simulator does: the
          statevector doubles with each one.
        </p>
      </Explainer>
    </VizFrame>
  )
}
