'use client'

import { useMemo, useState } from 'react'
import type { StateVector } from '@/lib/quantum'
import {
  basisLabels,
  densityMatrix,
  purity,
  reducedState,
} from '@/lib/quantum/densityMatrixView'
import type { ComplexMatrix } from '@/lib/quantum/densityMatrixView'
import { Segmented, Stat } from '@/components/ui/Controls'
import { lazyViz } from './LazyViz'
import { HintonDiagram } from './HintonDiagram'

/**
 * StateAsMatrix — "The state, as a matrix": the section appended to
 * /visualizations/entanglement. Given the live two-qubit state, it shows ρ of
 * the whole pair as 3-D bars and as a Hinton diagram, then lets the reader
 * switch to the reduced state of either qubit and watch the coherences vanish
 * while the diagonal stays — the whole is pure, the part is maximally mixed.
 *
 * Props:
 *   state   the two-qubit StateVector currently on show (lib/quantum).
 *
 * The matrices are memoised on the state's amplitudes so the 3-D view rebuilds
 * only when the numbers change, not on every parent render.
 */

const MatrixHistogram3D = lazyViz(() => import('./MatrixHistogram3D'), { minHeight: 340 })

type View = 'pair' | 'A' | 'B'

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'pair', label: 'Whole pair ρ' },
  { value: 'A', label: 'Qubit A alone' },
  { value: 'B', label: 'Qubit B alone' },
]

export function StateAsMatrix({ state }: { state: StateVector }) {
  const [view, setView] = useState<View>('pair')

  // Key the memo on the numbers, not the object: the page hands over a fresh
  // clone after every measurement even when nothing changed.
  const stateKey = Array.from(state.data, (v) => v.toFixed(6)).join(',')
  const { pair, a, b } = useMemo(() => {
    const rho = densityMatrix(state.amplitudes())
    return {
      pair: rho,
      a: reducedState(rho, state.numQubits, [0]),
      b: reducedState(rho, state.numQubits, [1]),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey])

  const shown: ComplexMatrix = view === 'pair' ? pair : view === 'A' ? a : b
  const labels = useMemo(
    () => (view === 'pair' ? basisLabels(state.numQubits) : basisLabels(1)),
    [view, state.numQubits]
  )
  const title = view === 'pair' ? 'ρ of the whole pair' : view === 'A' ? 'ρ of qubit A alone' : 'ρ of qubit B alone'
  const shownPurity = purity(shown)
  const pairPurity = purity(pair)
  const partPurity = purity(a)

  const offDiagonal = shown.reduce(
    (s, row, i) => s + row.reduce((t, v, j) => (i === j ? t : t + Math.hypot(v.re, v.im)), 0),
    0
  )

  const verdict =
    view === 'pair'
      ? pairPurity > 0.999
        ? 'The pair is pure: Tr ρ² = 1. The tall off-diagonal bars are the coherences — the superposition itself, written into the matrix.'
        : 'A measurement has already collapsed part of this state, so the pair is no longer a single superposition.'
      : partPurity < 0.501
        ? 'Maximally mixed: Tr ρ² = ½, two equal diagonal bars and nothing else. On its own, this qubit is a fair coin with no phase at all.'
        : partPurity > 0.999
          ? 'Pure on its own: this qubit has a state of its own, so it is not entangled with its partner.'
          : `Partly mixed: Tr ρ² = ${partPurity.toFixed(2)}. Some of this qubit's description lives in the correlation with its partner.`

  return (
    <section className="card mb-6 p-6" aria-labelledby="state-as-matrix-title">
      <h2 id="state-as-matrix-title" className="section-label mb-1">
        The state, as a matrix
      </h2>
      <p className="mb-4 text-[13px] text-ink-secondary">
        Every entry ρ<sub>ij</sub> = ψ<sub>i</sub>ψ<sub>j</sub>* is a bar: height is its size, colour its
        phase. Switch to one qubit alone — that is the partial trace, summing out the partner —
        and watch what survives.
      </p>

      <div className="mb-4">
        <Segmented<View> label="Show" value={view} options={VIEW_OPTIONS} onChange={setView} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <MatrixHistogram3D matrix={shown} labels={labels} scale={1} title={title} height={340} />
          <p className="mt-2 text-[11px] text-ink-muted">
            Drag to walk around the bars; arrow keys also rotate. Full height is 1.
          </p>
        </div>
        <div>
          <HintonDiagram matrix={shown} labels={labels} scale={1} title={title} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stat label="Purity Tr ρ²" value={shownPurity.toFixed(2)} accent={shownPurity > 0.999 ? 'teal' : 'amber'} />
            <Stat label="Off-diagonal total" value={offDiagonal.toFixed(2)} accent="violet" />
          </div>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-ink-secondary" aria-live="polite">
        {verdict}
      </p>

      <div className="mt-4 space-y-2 text-[13px] text-ink-secondary">
        <p>
          For the Bell state the whole pair has purity 1 and each half has purity ½ — and no other
          way of writing the state changes that. A pure whole with maximally mixed parts is not a
          side effect of entanglement; it <em>is</em> entanglement. The information is not in A and
          not in B. It is in the four corner bars, which belong to neither.
        </p>
        <p>
          Compare the product state (H on A only): the whole and both parts are pure at once. The
          pair&apos;s four bars sit in the top-left block, A alone keeps its off-diagonal bars — it is
          |+⟩, a superposition in its own right — and B alone is a single bar at |0⟩⟨0|. Each half
          has a state of its own, so nothing was shared. Then measure A on the Bell state and look
          at the pair again: the corner bars are gone, and so is the entanglement.
        </p>
      </div>
    </section>
  )
}

export default StateAsMatrix
