'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import SurfaceCodeLab, {
  type ErrorChannel,
  type MonteCarloStats,
} from '@/components/viz/SurfaceCodeLab'
import {
  buildSurfaceCode,
  evaluateErrors,
  qubitCost,
} from '@/components/viz/surface/code'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, Slider, ButtonRow, Stat, Toggle } from '@/components/ui/Controls'
import { lazyViz } from '@/components/viz/LazyViz'
import type { SurfaceCodeLattice3DProps } from '@/components/viz/SurfaceCodeLattice3D'
import {
  buildLattice3D,
  edgesFromTypedMatching,
  errorsFromChannels,
  syndromeFromErrors,
} from '@/lib/qec3d/layout'
import { buildHistory, defaultBlip, defaultErrorRound, historyMatching } from '@/lib/qec3d/history'

const DISTANCES = [3, 5, 7] as const

/**
 * The 3-D lattice pulls in three.js, so it loads after hydration behind a
 * height-reserving skeleton, like every other WebGL view on the site. Module
 * scope, never inside render — see LazyViz.tsx. The 2-D canvas below is
 * untouched: the toggle only decides which of the two receives the same state.
 */
const SurfaceCodeLattice3D = lazyViz<SurfaceCodeLattice3DProps>(
  () => import('@/components/viz/SurfaceCodeLattice3D'),
  { minHeight: 440 }
)

type LatticeView = '2d' | '3d'

const pct = (p: number) => `${(p * 100).toFixed(2)}%`

export default function SurfaceCodePage() {
  const [d, setD] = useState<number>(5)
  const [channel, setChannel] = useState<ErrorChannel>('X')
  const [p, setP] = useState(0.05)
  const [monteCarlo, setMonteCarlo] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [mc, setMc] = useState<MonteCarloStats>({
    shots: 0,
    failures: 0,
    failuresX: 0,
    failuresZ: 0,
  })
  const [view, setView] = useState<LatticeView>('2d')
  const [stackRounds, setStackRounds] = useState(false)
  const [rounds, setRounds] = useState(5)
  const [withBlip, setWithBlip] = useState(true)
  const [renderer3d, setRenderer3d] = useState<'webgl' | 'canvas2d' | null>(null)

  const code = useMemo(() => buildSurfaceCode(d), [d])
  const [errors, setErrors] = useState(() => ({
    X: new Uint8Array(d * d),
    Z: new Uint8Array(d * d),
  }))

  // The lattice changed size: hand-placed errors on the old one are meaningless.
  // Derived during render rather than in an effect, so the canvas never sees an
  // error array of the wrong length.
  const safeErrors =
    errors.X.length === code.numData ? errors : { X: new Uint8Array(code.numData), Z: new Uint8Array(code.numData) }

  const onToggleQubit = useCallback(
    (q: number) => {
      setErrors((prev) => {
        const base =
          prev.X.length === code.numData
            ? prev
            : { X: new Uint8Array(code.numData), Z: new Uint8Array(code.numData) }
        const next = { X: new Uint8Array(base.X), Z: new Uint8Array(base.Z) }
        next[channel][q] ^= 1
        return next
      })
    },
    [channel, code.numData]
  )

  const onMonteCarloStats = useCallback((s: MonteCarloStats) => {
    setMc((prev) => (prev.shots === s.shots ? prev : s))
  }, [])

  const clear = () =>
    setErrors({ X: new Uint8Array(code.numData), Z: new Uint8Array(code.numData) })

  // Exact decode of the hand-placed errors, for the tables below. The canvas
  // computes this too; recomputing here keeps the numbers and the picture in step
  // without threading the whole result back up through a callback.
  const result = useMemo(
    () => evaluateErrors(code, safeErrors.X, safeErrors.Z),
    [code, safeErrors]
  )

  const cost = qubitCost(d)
  const placed = countOnes(safeErrors.X) + countOnes(safeErrors.Z)

  // ── The 3-D view: the same errors and the same decoder output, re-expressed ──
  // as the lattice component's props. The matching is the 2-D decoder's, converted
  // edge for edge; in stacked mode it is lifted to the round the errors occur in,
  // plus the vertical edge for the one-round measurement error (lib/qec3d/history).
  const lattice3d = useMemo(() => buildLattice3D(d), [d])
  const errors3d = useMemo(() => errorsFromChannels(safeErrors.X, safeErrors.Z), [safeErrors])
  const flatMatching = useMemo(
    () => [
      ...edgesFromTypedMatching(lattice3d, 'Z', result.decX.defects, result.decX.matching.pairs),
      ...edgesFromTypedMatching(lattice3d, 'X', result.decZ.defects, result.decZ.matching.pairs),
    ],
    [lattice3d, result]
  )
  const history = useMemo(() => {
    if (!stackRounds) return null
    const flat = syndromeFromErrors(lattice3d, errors3d)
    const spec = {
      rounds,
      errorRound: defaultErrorRound(rounds),
      blip: withBlip ? defaultBlip(lattice3d, flat, rounds) : null,
    }
    return {
      spec,
      rounds: buildHistory(lattice3d, flat, spec),
      matching: historyMatching(flatMatching, spec),
    }
  }, [stackRounds, lattice3d, errors3d, rounds, withBlip, flatMatching])

  const chooseView = (v: LatticeView) => {
    setView(v)
    // Random rounds are gathered by the 2-D canvas's frame loop; there is nothing
    // to gather in the 3-D view, so switching stops them rather than freezing them.
    if (v === '3d') setMonteCarlo(false)
  }

  const controls = (
    <>
      <Segmented<LatticeView>
        label="View"
        value={view}
        options={[
          { value: '2d', label: '2-D lattice' },
          { value: '3d', label: '3-D lattice' },
        ]}
        onChange={chooseView}
      />

      {view === '3d' ? (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-1">
          <Toggle
            label="Stack syndrome rounds (time axis)"
            checked={stackRounds}
            onChange={setStackRounds}
            hint="Measure every stabiliser again and again; each round is one layer up"
          />
          {stackRounds ? (
            <>
              <Slider
                label="Rounds"
                value={rounds}
                min={2}
                max={9}
                step={1}
                format={(v) => String(v)}
                onChange={(v) => setRounds(Math.round(v))}
                hint={`The placed errors happen in round ${defaultErrorRound(rounds)} and persist`}
              />
              <Toggle
                label="Add a one-round measurement error"
                checked={withBlip}
                onChange={setWithBlip}
                hint={
                  rounds < 3
                    ? 'Needs at least 3 rounds to show both of its events'
                    : 'One stabiliser reads wrong for one round: two events, stacked'
                }
              />
            </>
          ) : null}
        </div>
      ) : null}

      <Segmented
        label="Code distance d"
        value={String(d)}
        options={DISTANCES.map((v) => ({ value: String(v), label: `d = ${v}` }))}
        onChange={(v) => {
          const next = Number(v)
          setD(next)
          setErrors({ X: new Uint8Array(next * next), Z: new Uint8Array(next * next) })
          setResetKey((k) => k + 1)
        }}
      />

      <Segmented
        label="Inject which error"
        value={channel}
        options={[
          { value: 'X', label: 'X (bit flip)' },
          { value: 'Z', label: 'Z (phase flip)' },
        ]}
        onChange={(v) => setChannel(v as ErrorChannel)}
      />

      <ButtonRow>
        <button type="button" className="btn-ghost" onClick={clear} disabled={monteCarlo}>
          Clear errors
        </button>
      </ButtonRow>

      <div className="border-t border-line pt-4">
        <Slider
          label="Physical error rate p"
          value={p}
          min={0.005}
          max={0.3}
          step={0.005}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          onChange={setP}
          hint="Chance each data qubit picks up an X error, and independently a Z error, per round"
        />
        <div className="mt-3">
          <ButtonRow>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setMonteCarlo((m) => !m)}
              disabled={view === '3d'}
              title={view === '3d' ? 'Random rounds run in the 2-D view' : undefined}
            >
              {monteCarlo ? 'Stop rounds' : 'Run random rounds'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setResetKey((k) => k + 1)
                setMc({ shots: 0, failures: 0, failuresX: 0, failuresZ: 0 })
              }}
            >
              Reset stats
            </button>
          </ButtonRow>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Physical qubits" value={String(cost.total)} accent="sky" />
        <Stat label="Corrects up to" value={`${(d - 1) / 2} errors`} accent="teal" />
        <Stat label="Rounds run" value={mc.shots.toLocaleString('en-US')} accent="violet" />
        <Stat
          label="Logical error rate"
          value={mc.shots === 0 ? '—' : pct(mc.failures / mc.shots)}
          accent="rose"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {cost.data} data qubits plus {cost.ancilla} measurement ancillas, one per
        stabiliser, to protect a single logical qubit. Each round decodes both channels
        with minimum-weight matching over the real syndrome graph.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Surface Code"
      tagline="Why one usable qubit costs a hundred real ones — and what happens when you do not spend enough."
      level="Advanced"
      canvas={
        <div className="p-2">
          {view === '2d' ? (
            <SurfaceCodeLab
              code={code}
              errorsX={safeErrors.X}
              errorsZ={safeErrors.Z}
              channel={channel}
              p={p}
              monteCarlo={monteCarlo}
              resetKey={resetKey}
              onToggleQubit={onToggleQubit}
              onMonteCarlo={onMonteCarloStats}
            />
          ) : (
            <SurfaceCodeLattice3D
              d={d}
              errors={errors3d}
              rounds={history?.rounds}
              matching={history ? history.matching : flatMatching}
              onQubitActivate={onToggleQubit}
              activateLabel={`Toggle ${channel} error`}
              onRendererChange={setRenderer3d}
            />
          )}
          {view === '2d' ? (
            <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
              Click a circle — or tab to it and press Enter — to inject a {channel} error.
              Rings show the chains the decoder proposes to flip: amber for the X channel,
              violet for the Z channel. The dashed lines mark one representative of each
              logical operator; a residual chain that crosses the lattice between the two
              matching boundaries is a logical error.
            </p>
          ) : (
            <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
              {renderer3d === 'canvas2d'
                ? 'This browser refused a WebGL context, so the lattice is drawn in oblique projection instead: rows recede along the diagonal and time goes up the page. '
                : 'Drag to orbit, scroll or pinch to zoom; with the view focused, the arrow keys orbit and Home resets. '}
              Tap a sphere — or tab to it and press Enter — to inject a {channel} error.
              Spheres are data qubits (amber X, violet Z, rose Y); diamonds are stabilisers
              (teal X-type, sky Z-type), bright when their parity flipped. Rods are the
              decoder&rsquo;s matching: amber for the X channel, violet for the Z channel.
              {stackRounds
                ? ` Each layer up is one more round of measurement; only detection events — outcomes that differ from the round below — are lit. ${
                    history?.spec.blip
                      ? 'The vertical rod is a measurement error being matched to itself: the decoder flips nothing.'
                      : ''
                  }`
                : ' Turn on the time axis to see why real decoders work on a stack of rounds.'}
            </p>
          )}
        </div>
      }
      controls={controls}
    >
      {/* A11Y: the syndrome is the only thing a real machine can see, and on the canvas
          it is colour. Here it is text, always rendered. */}
      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">The syndrome, in words</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          {monteCarlo
            ? 'Randomised rounds are running; this table describes the errors you placed by hand, which are restored when you stop.'
            : placed === 0
              ? 'No errors placed yet. Every stabiliser reads even parity.'
              : `${placed} physical error${placed === 1 ? '' : 's'} placed.`}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Stabiliser measurement outcomes and the decoder&rsquo;s response for the
              currently placed errors on a distance-{d} surface code.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="py-2 text-left font-bold" scope="col">
                  Channel
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Errors
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Stabilisers lit
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Correction weight
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-2 text-q-amber-text">X errors, seen by Z stabilisers</td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {countOnes(safeErrors.X)}
                </td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {result.decX.defects.length}
                </td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {result.decX.matching.weight}
                </td>
                <td
                  className={`py-2 text-right ${result.logicalXError ? 'text-q-rose-text' : 'text-q-teal-text'}`}
                >
                  {result.logicalXError ? 'logical X error' : 'corrected'}
                </td>
              </tr>
              <tr className="border-b border-line last:border-0">
                <td className="py-2 text-q-violet-text">Z errors, seen by X stabilisers</td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {countOnes(safeErrors.Z)}
                </td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {result.decZ.defects.length}
                </td>
                <td className="py-2 text-right font-mono text-ink-secondary">
                  {result.decZ.matching.weight}
                </td>
                <td
                  className={`py-2 text-right ${result.logicalZError ? 'text-q-rose-text' : 'text-q-teal-text'}`}
                >
                  {result.logicalZError ? 'logical Z error' : 'corrected'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Announced, not just drawn: the banner on the canvas is the only signal a
            sighted user gets when a correction goes wrong. */}
        <p role="status" className="mt-4 text-sm font-semibold">
          {result.failed ? (
            <span className="text-q-rose-text">
              Logical error: the decoder returned the lattice to the code space, but the
              encoded qubit is now the wrong one.
            </span>
          ) : (
            <span className="text-q-teal-text">
              No logical error: the residual chain is a product of stabilisers, which acts
              as identity on the encoded qubit.
            </span>
          )}
        </p>
      </section>

      <Explainer title="What the machine actually sees">
        <p>
          You cannot look at a qubit. Reading it collapses it, and reading an encoded
          qubit destroys the very superposition you were trying to protect. So error
          correction never measures the data. It measures <em>parities</em>: the diamonds
          on the lattice each check whether an even or odd number of their neighbours has
          flipped.
        </p>
        <p>
          A parity carries no information about the state — it is the same whether the
          logical qubit is |0⟩, |1⟩ or anything between — which is exactly why measuring
          it does no damage. Place a single error and watch: two diamonds light up, at the
          two ends of the chain you created. That pair of lit diamonds is called a defect
          pair, and it is the entire input to the decoder.
        </p>
      </Explainer>

      <Explainer title="The decoder is guessing, and it can guess wrong">
        <p>
          Two lit diamonds tell you the error chain <em>ends</em> there. They do not tell
          you which path it took. The decoder assumes the shortest one, because at low
          error rates short chains are exponentially more likely than long ones. That is
          minimum-weight perfect matching, and it is what runs here — exact, over
          distances measured on the real syndrome graph, not a Manhattan approximation.
        </p>
        <p>
          Now place a chain of {(d + 1) / 2} errors straight down the left column of the
          d = {d} lattice. The syndrome looks identical to a chain of {(d - 1) / 2} errors
          coming from the other side, so the decoder takes the shorter route — and error
          plus correction now form a complete path from one boundary to the other. Every
          stabiliser reads even. Nothing is lit. Nothing is wrong, as far as the machine
          can tell. And the logical qubit has been flipped.
        </p>
        <p>
          That is what &ldquo;distance d&rdquo; buys: you need at least{' '}
          {(d + 1) / 2} simultaneous errors before that can happen. Fewer than that, and
          the shortest explanation is always the right one.
        </p>
      </Explainer>

      <Explainer title="The threshold, measured here">
        <p>
          Press <strong>Run random rounds</strong> and change d. Below a critical physical
          error rate, a bigger code has a lower logical error rate — that is the whole
          promise, and it compounds: each step in d buys another factor. Above it, a
          bigger code is <em>worse</em>, because you have added more places for errors to
          appear than the extra redundancy can pay for.
        </p>
        <p>
          MEASURED for this simulation, 4,000 rounds per point (the curves cross between
          8% and 10%):
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Logical error rate against physical error rate for code distances 3, 5 and
              7, from 4,000 rounds per cell of this page&rsquo;s own simulation.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="py-2 text-left font-bold" scope="col">
                  p
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  d = 3
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  d = 5
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  d = 7
                </th>
              </tr>
            </thead>
            <tbody>
              {THRESHOLD_TABLE.map((row) => (
                <tr key={row[0]} className="border-b border-line last:border-0">
                  <td className="py-2 font-mono text-ink-secondary">{row[0]}</td>
                  <td className="py-2 text-right font-mono text-ink-secondary">{row[1]}</td>
                  <td className="py-2 text-right font-mono text-ink-secondary">{row[2]}</td>
                  <td className="py-2 text-right font-mono text-ink-secondary">{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Do not read 9% as the surface code&rsquo;s threshold. This simulation assumes
          <em> perfect</em> stabiliser measurement and a single round of correction. Real
          machines measure the syndrome with the same faulty gates that caused the errors,
          repeatedly, and must decode in three dimensions with time as the third. That
          drops the threshold to roughly 1%, which is the number the hardware industry is
          actually chasing.
        </p>
      </Explainer>

      <Explainer title="The third dimension is time">
        <p>
          Switch to the <strong>3-D lattice</strong> and turn on the time axis. The
          bottom layer is the lattice you have been breaking. Every layer above it is the
          same set of stabilisers measured <em>again</em>, one round later — because a
          real machine never measures the syndrome once. It measures it continuously, for
          as long as the computation runs, with gates as faulty as the ones that caused
          the errors in the first place.
        </p>
        <p>
          That is why the vertical axis exists. A data error that happens in round{' '}
          {defaultErrorRound(rounds)} flips two stabilisers there and they <em>stay</em>{' '}
          flipped, so the raw outcomes above are all odd — but the decoder does not look
          at outcomes. It looks at <em>changes</em> between consecutive rounds, called
          detection events, and a persisting error is exactly one pair of them, at the
          round it happened. Everything above is quiet. The volume is mostly empty, which
          is what makes it decodable.
        </p>
        <p>
          Now the measurement error. One stabiliser reads wrong for one round and right
          again the next: two detection events stacked vertically on the same plaquette.
          Look at one slice alone and that lone lit stabiliser looks like a data error
          matched to the boundary — the decoder would &ldquo;correct&rdquo; a qubit that
          was never wrong, and could walk a chain across the lattice doing it. Look at the
          stack and the two events sit one round apart on the same site, the cheapest
          possible pairing. The decoder matches them to each other along the vertical rod
          and flips nothing. It has told a lie in the readout apart from a flip in the
          data, and it can only do that because it can see time.
        </p>
        <p>
          So decoders for real hardware match on this whole space-time volume — rows and
          columns across, rounds up — with edges that run sideways for data errors,
          vertically for measurement errors, and diagonally for the faults that do both.
          The picture the hardware groups publish for below-threshold experiments is this
          stack. The history shown here is constructed (the placed errors occur in one
          round and persist, plus one readout blip) and the matching is the 2-D
          decoder&rsquo;s lifted to that round with the blip paired to itself, which is
          the minimum-weight matching for these events; the workbench&rsquo;s decoder lab
          runs a genuine space-time decode.
        </p>
      </Explainer>

      <Explainer title="Why a logical qubit costs so much">
        <p>
          A distance-{d} patch is {cost.data} data qubits and {cost.ancilla} ancillas:{' '}
          {cost.total} physical qubits, for one logical qubit that is still not perfect,
          only better. And the payoff is only exponential in d if p stays below threshold,
          so the answer to &ldquo;we need a lower logical error rate&rdquo; is always
          &ldquo;a bigger patch&rdquo;.
        </p>
        <p>
          Estimates for factoring a 2048-bit RSA key with surface-code-protected qubits
          land in the millions of physical qubits, dominated by exactly this overhead.
          That number is why the interesting engineering question is not &ldquo;can we
          build a qubit&rdquo; but &ldquo;can we build one whose error rate leaves enough
          headroom below threshold that the patch does not have to be enormous&rdquo;.
        </p>
        <p>
          One honest limitation of this page: X and Z errors are decoded independently. A
          Y error is an X and a Z on the same qubit, and a decoder that knew that could do
          better with the same syndrome. Real decoders exploit the correlation; this one
          does not.
        </p>
      </Explainer>

      <Explainer title="Train a decoder for this code">
        <p>
          The matching decoder on this page is one fixed algorithm. The{' '}
          <Link href="/workbench/decoder-lab" className="underline">
            Decoder Lab
          </Link>{' '}
          in the workbench puts it up against decoders that learn: a lookup table, an MLP and a
          small attention decoder in the shape of AlphaQubit, trained in your browser on this
          same lattice at d = 3, 5 and 7, with measurement noise as an option. It draws the
          logical-versus-physical error-rate curves with the threshold crossing, one per
          decoder, and states how many samples each was trained on — and the learned decoders
          do exploit the X–Z correlation this page&rsquo;s matching ignores.
        </p>
      </Explainer>
    </VizFrame>
  )
}

function countOnes(a: Uint8Array): number {
  let n = 0
  for (const v of a) n += v
  return n
}

/**
 * MEASURED, not estimated: 4,000 rounds per cell of the same `runShot` the canvas
 * runs, seeded per point. Re-measure before editing these numbers — the sweep is a
 * dozen lines around `runShot` and the shape of the table is the claim.
 */
const THRESHOLD_TABLE: readonly [string, string, string, string][] = [
  ['1%', '0.30%', '0.05%', '0.00%'],
  ['2%', '1.20%', '0.35%', '0.20%'],
  ['3%', '3.15%', '1.32%', '0.43%'],
  ['5%', '7.10%', '4.45%', '3.15%'],
  ['8%', '15.85%', '14.85%', '12.53%'],
  ['10%', '22.25%', '23.08%', '22.93%'],
  ['12%', '30.78%', '31.90%', '35.68%'],
  ['15%', '38.02%', '45.00%', '50.60%'],
  ['20%', '51.65%', '59.80%', '65.97%'],
]
