'use client'

import { useEffect, useMemo, useState } from 'react'
import QFTLab from '@/components/viz/QFTLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Segmented, Toggle, Stat } from '@/components/ui/Controls'
import { StateVector, formatKet } from '@/lib/quantum'

type QubitCount = '2' | '3' | '4'

const QUBIT_OPTIONS: { value: QubitCount; label: string }[] = [
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
]

/** Prepare the computational basis state |index⟩. */
function basisState(n: number, index: number): StateVector {
  const sv = new StateVector(n)
  for (let q = 0; q < n; q++) if ((index >> q) & 1) sv.applySingle('X', q)
  return sv
}

/** Standard QFT construction: H then a cascade of controlled phases, then bit reversal. */
function applyQFT(sv: StateVector, n: number): void {
  for (let j = n - 1; j >= 0; j--) {
    sv.applySingle('H', j)
    for (let k = j - 1; k >= 0; k--) {
      sv.applyControlled('P', [k], j, Math.PI / 2 ** (j - k))
    }
  }
  for (let i = 0; i < Math.floor(n / 2); i++) sv.applySwap(i, n - 1 - i)
}

/** The exact reverse of applyQFT, with every phase angle negated. */
function applyInverseQFT(sv: StateVector, n: number): void {
  for (let i = 0; i < Math.floor(n / 2); i++) sv.applySwap(i, n - 1 - i)
  for (let j = 0; j < n; j++) {
    for (let k = 0; k <= j - 1; k++) {
      sv.applyControlled('P', [k], j, -Math.PI / 2 ** (j - k))
    }
    sv.applySingle('H', j)
  }
}

export default function QFTPage() {
  const [qubitChoice, setQubitChoice] = useState<QubitCount>('3')
  const [index, setIndex] = useState(1)
  const [inverse, setInverse] = useState(false)

  const numQubits = parseInt(qubitChoice, 10)
  const dim = 1 << numQubits

  // Keep the chosen basis state inside range when the register shrinks.
  useEffect(() => {
    setIndex((i) => (i < dim ? i : dim - 1))
  }, [dim])

  const safeIndex = Math.min(index, dim - 1)

  const input = useMemo(() => basisState(numQubits, safeIndex), [numQubits, safeIndex])

  const output = useMemo(() => {
    const sv = basisState(numQubits, safeIndex)
    if (inverse) applyInverseQFT(sv, numQubits)
    else applyQFT(sv, numQubits)
    return sv
  }, [numQubits, safeIndex, inverse])

  const controlledPhaseGates = (numQubits * (numQubits - 1)) / 2
  const totalQftGates = (numQubits * (numQubits + 1)) / 2
  const classicalFft = dim * Math.log2(dim)

  const controls = (
    <>
      <Segmented<QubitCount>
        label="Qubits"
        value={qubitChoice}
        options={QUBIT_OPTIONS}
        onChange={setQubitChoice}
      />

      <Slider
        label="Input basis state"
        value={safeIndex}
        min={0}
        max={dim - 1}
        step={1}
        onChange={(v) => setIndex(Math.round(v))}
        format={(v) => formatKet(Math.round(v), numQubits)}
        hint="The slope of the output phase ramp is exactly this number."
      />

      <Toggle
        label="Show the inverse QFT instead"
        checked={inverse}
        onChange={setInverse}
        hint="Same construction run backwards, with every phase angle negated."
      />

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Amplitudes" value={`${dim}`} accent="violet" />
        <Stat label="Ctrl-phase gates" value={`${controlledPhaseGates}`} accent="teal" />
        <Stat label="Total QFT gates" value={`${totalQftGates}`} accent="amber" />
        <Stat label="Classical FFT" value={`${classicalFft} ops`} accent="sky" />
      </div>
    </>
  )

  return (
    <VizFrame
      title="Quantum Fourier Transform"
      tagline="A single basis state goes in; a flat spread of amplitudes with a phase ramp comes out. The ramp's slope is the number you started with."
      level="Advanced"
      canvas={
        <div className="p-2">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <QFTLab state={input} title={`Input state · ${formatKet(safeIndex, numQubits)}`} />
            <QFTLab state={output} title={inverse ? 'After inverse QFT' : 'After QFT'} />
          </div>
          <p className="px-3 pb-2 pt-1 text-[11px] text-ink-muted">
            Bar height is magnitude; the dial under each bar is that amplitude&apos;s phase. The
            input has one bar with a flat phase — the output has {dim} equal bars whose dial hands
            step around by a constant amount.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="A Fourier transform on amplitudes">
        <p>
          The QFT does to a quantum state what the discrete Fourier transform does to a signal: it
          turns position information into frequency information. A sharp spike at position x becomes
          a flat magnitude spread with a phase that winds around at a rate proportional to x.
        </p>
        <p>
          Drag the input basis state and watch the output dials. At {formatKet(0, numQubits)} every
          hand points the same way — zero frequency. Each step up the input adds one more full turn
          across the register, so the slope of the ramp <em>is</em> the input value. That is the
          entire content of the transform, and none of it shows up in the bar heights.
        </p>
      </Explainer>

      <Explainer title="Where the speedup lives (and where it doesn't)">
        <p>
          On {numQubits} qubits the QFT needs {totalQftGates} gates — about n²/2 — to transform all{' '}
          {dim} amplitudes. The best classical FFT needs about N log N = {classicalFft} operations
          for the same size, and N grows exponentially in n. On 50 qubits that gap is roughly 1,275
          gates against 5.6 × 10¹⁶ operations.
        </p>
        <p>
          But you cannot read all {dim} amplitudes out. One measurement gives one basis state, and
          the state is gone. The QFT is not a fast way to compute a Fourier transform of data you
          have; it is only useful inside an algorithm that arranges for the answer you want to be
          the thing you are likely to measure.
        </p>
      </Explainer>

      <Explainer title="This is the engine of Shor's algorithm">
        <p>
          Factoring reduces to period-finding: given f(x) = aˣ mod N, find the r with f(x + r) =
          f(x). A quantum computer can prepare a superposition whose amplitudes are periodic with
          period r — but measuring it directly just returns a random point, which tells you nothing.
        </p>
        <p>
          The QFT turns that periodic amplitude pattern into a sharp peak at the corresponding
          frequency. Now measurement returns something useful, because the peak is where almost all
          the probability went. The period falls out of that number by continued fractions, and the
          factors fall out of the period.
        </p>
      </Explainer>
    </VizFrame>
  )
}
