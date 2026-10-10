'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import ShorLab, { type ShotStats } from '@/components/viz/ShorLab'
import {
  SUPPORTED_N,
  attemptFactor,
  buildPeriodFinding,
  convergents,
  coprimeBases,
  expectedPeaks,
  gcd,
  modPow,
  multiplicativeOrder,
  periodFromMeasurement,
  registerSizes,
} from '@/components/viz/shor/period'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Stat } from '@/components/ui/Controls'
import { mulberry32 } from '@/lib/quantum'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

/** How many spectrum peaks the table below the canvas lists. */
const TABLE_ROWS = 8

export default function ShorPage() {
  const [N, setN] = useState(15)
  const [a, setA] = useState(7)
  const [runKey, setRunKey] = useState(0)
  const [sampling, setSampling] = useState(false)
  const [shots, setShots] = useState<ShotStats>({
    total: 0,
    recovered: 0,
    factored: 0,
    lastC: null,
    lastR: null,
    lastFactors: null,
  })
  const baseSelectId = useId()

  const bases = useMemo(() => coprimeBases(N), [N])
  // Keep `a` legal when N changes. Reading it during render (rather than in an
  // effect) means the canvas never sees a base that is not coprime to N, which
  // buildPeriodFinding would throw on.
  const safeA = bases.includes(a) ? a : bases[0]

  const finding = useMemo(
    // runKey seeds the work-register measurement: a new run genuinely re-measures
    // and can land on a different residue class, which is why the surviving comb
    // shifts. Same runKey, same result.
    () => buildPeriodFinding(N, safeA, mulberry32(0x51f0 + runKey * 7919)),
    [N, safeA, runKey]
  )

  const onShots = useCallback((s: ShotStats) => {
    setShots((prev) => (prev.total === s.total && prev.lastC === s.lastC ? prev : s))
  }, [])

  const sizes = registerSizes(N)
  const order = finding.trueOrder
  const idealAttempt = order !== null ? attemptFactor(safeA, order, N) : null

  // The peaks the table lists: the highest-probability measurement outcomes, each
  // run through exactly the same classical post-processing a real shot would get.
  const rows = useMemo(() => {
    const indexed = Array.from(finding.spectrum, (p, y) => ({ p, y }))
    indexed.sort((u, v) => v.p - u.p)
    return indexed.slice(0, TABLE_ROWS).map(({ p, y }) => {
      const r = periodFromMeasurement(y, sizes.counting, N, safeA)
      const best = convergents(y, sizes.M).filter((cv) => cv.q < N).pop()
      return {
        c: y,
        probability: p,
        fraction: best ? `${best.p}/${best.q}` : '—',
        period: r,
        outcome:
          r === null
            ? 'no usable period'
            : (() => {
                const at = attemptFactor(safeA, r, N)
                return at.ok ? `${at.factors[0]} × ${at.factors[1]}` : at.reason.replace('-', ' ')
              })(),
      }
    })
  }, [finding, sizes.counting, sizes.M, N, safeA])

  const controls = (
    <>
      <Segmented
        label="Number to factor N"
        value={String(N)}
        options={SUPPORTED_N.map((n) => ({ value: String(n), label: String(n) }))}
        onChange={(v) => setN(Number(v))}
      />

      <div>
        <label
          htmlFor={baseSelectId}
          className="mb-1.5 block text-[13px] font-semibold text-ink-secondary"
        >
          Base a
        </label>
        <select
          id={baseSelectId}
          value={safeA}
          onChange={(e) => setA(Number(e.target.value))}
          className="focus-ring min-h-[44px] w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
        >
          {bases.map((b) => (
            <option key={b} value={b}>
              a = {b} (order {multiplicativeOrder(b, N)})
            </option>
          ))}
        </select>
        <p className="mt-1 block text-[11px] text-ink-muted">
          Only bases coprime to N are listed — gcd(a, N) &gt; 1 would have factored N by
          itself, classically, before the quantum computer was switched on.
        </p>
      </div>

      <ButtonRow>
        <button type="button" className="btn-primary" onClick={() => setSampling((s) => !s)}>
          {sampling ? 'Stop measuring' : 'Measure repeatedly'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setRunKey((k) => k + 1)
            setShots({
              total: 0,
              recovered: 0,
              factored: 0,
              lastC: null,
              lastR: null,
              lastFactors: null,
            })
          }}
        >
          Re-run
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="True order r" value={order === null ? '—' : String(order)} accent="amber" />
        <Stat label="Peaks expected" value={order === null ? '—' : String(order)} accent="amber" />
        <Stat label="Shots" value={String(shots.total)} accent="sky" />
        <Stat
          label="Period found"
          value={shots.total === 0 ? '—' : pct(shots.recovered / shots.total)}
          accent="teal"
        />
        <Stat
          label="N factored"
          value={shots.total === 0 ? '—' : pct(shots.factored / shots.total)}
          accent="violet"
        />
        <Stat
          label="Last c"
          value={shots.lastC === null ? '—' : String(shots.lastC)}
          accent="rose"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Counting register {sizes.counting} qubits ({sizes.M.toLocaleString('en-US')} amplitudes),
        work register {sizes.work}. A gate-level simulation of both together would be{' '}
        {sizes.counting + sizes.work} qubits —{' '}
        {sizes.jointAmplitudes.toLocaleString('en-US')} complex amplitudes.
      </p>
    </>
  )

  return (
    <VizFrame
      title="Shor's Algorithm: Period Finding"
      tagline="The one part of factoring that actually needs a quantum computer — and it does not factor anything."
      level="Advanced"
      canvas={
        <div className="p-2">
          <ShorLab
            finding={finding}
            sampling={sampling}
            resetKey={runKey}
            onShots={onShots}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            Teal dots in the top panel are the x values still in superposition after the work
            register was measured; they are spaced exactly r apart. Violet bars in the bottom
            panel are the measurement probabilities after the QFT; the dashed amber lines mark
            multiples of 2<sup>n</sup>/r. The sky outline is the histogram of shots you have
            actually drawn.
          </p>
        </div>
      }
      controls={controls}
    >
      {/* A11Y: the canvas carries a description of what it currently shows, but the
          precise numbers only exist here. This table is the non-visual route to the
          same information, and it is not a toggle — it is always rendered. */}
      <section className="card mb-4 p-6">
        <h2 className="mb-1 text-lg font-bold">The eight most likely measurements</h2>
        <p className="mb-4 text-[13px] text-ink-secondary">
          Exact per-bin probabilities from the post-QFT state, each run through the same
          continued-fraction step a real measurement would get. Note how many outcomes are
          useless: that is the algorithm, not a defect.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Highest-probability outcomes c of measuring the counting register for N = {N},
              a = {safeA}, with the period each one yields and whether it factors N.
            </caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="py-2 text-left font-bold" scope="col">
                  Measured c
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Probability
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  c / 2<sup>n</sup> ≈
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Period r
                </th>
                <th className="py-2 text-right font-bold" scope="col">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.c} className="border-b border-line last:border-0">
                  <td className="py-2 font-mono text-q-violet-text">{row.c}</td>
                  <td className="py-2 text-right text-ink-secondary">{pct(row.probability)}</td>
                  <td className="py-2 text-right font-mono text-ink-muted">{row.fraction}</td>
                  <td className="py-2 text-right font-mono text-ink-secondary">
                    {row.period ?? '—'}
                  </td>
                  <td
                    className={`py-2 text-right ${
                      row.period !== null && row.outcome.includes('×')
                        ? 'text-q-teal-text'
                        : 'text-ink-muted'
                    }`}
                  >
                    {row.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Explainer title="Where the quantum computer starts and stops">
        <p>
          Factoring N = {N} with base a = {safeA} is four steps, and only one of them is
          quantum.
        </p>
        <p>
          <strong>Classical.</strong> Check gcd({safeA}, {N}) = {gcd(safeA, N)}. If that had
          come out above 1 you would already have a factor and could stop — no quantum
          computer needed. It did not, so continue.
        </p>
        <p>
          <strong>Quantum.</strong> Put the counting register into an equal superposition of
          all {sizes.M.toLocaleString('en-US')} values of x, compute {safeA}
          <sup>x</sup> mod {N} into a second register, and measure that second register. The
          counting register collapses onto exactly the x that produce the residue you saw —
          an evenly spaced comb whose spacing is the period. Then apply the quantum Fourier
          transform, which turns a comb of spacing r into a comb of spacing 2<sup>n</sup>/r,
          and measure.
        </p>
        <p>
          <strong>Classical.</strong> The measured c is close to s·2<sup>n</sup>/r for some
          integer s you do not know. Expand c/2<sup>n</sup> as a continued fraction and read
          off the denominator: that is r{order !== null ? `, which is ${order} here` : ''}.
        </p>
        <p>
          <strong>Classical.</strong> If r is even and a<sup>r/2</sup> ≢ −1 (mod N), then
          gcd(a<sup>r/2</sup> ± 1, N) splits N.
          {order !== null && idealAttempt !== null
            ? idealAttempt.ok
              ? ` For this base: ${modPow(safeA, order / 2, N)}, giving ${idealAttempt.factors[0]} × ${idealAttempt.factors[1]} = ${N}.`
              : ` For this base it fails (${idealAttempt.reason.replace('-', ' ')}) — pick another a and rerun. At most half of all bases fail this way (for N = 15 only one of the seven coprime bases does).`
            : ''}
        </p>
        <p>
          Notice what the quantum step returned: a number that is <em>near</em> a multiple of
          2<sup>n</sup>/r. Not the factors. Not even the period. The famous speedup is
          entirely in finding a period exponentially faster than you could by evaluating
          a<sup>x</sup> mod N one x at a time.
        </p>
      </Explainer>

      <Explainer title="Why the peaks are not perfectly sharp">
        <p>
          If r divided 2<sup>n</sup> exactly, the QFT of the surviving comb would be exactly{' '}
          r spikes and nothing else. It almost never does.{' '}
          {order !== null
            ? `Here 2^${sizes.counting} = ${sizes.M.toLocaleString('en-US')} and r = ${order}, so the ideal peaks sit at ${expectedPeaks(sizes.counting, order).slice(0, 4).join(', ')}${order > 4 ? ', …' : ''} — ${Number.isInteger(sizes.M / order) ? 'which are integers, so the comb is sharp for this pair' : 'which are not integers, so each peak smears over its neighbouring bins'}.`
            : ''}
        </p>
        <p>
          That smearing is the reason for the continued-fraction step, and the reason
          n is chosen so that 2<sup>n</sup> ≥ N². With that much resolution the true s/r
          is the only fraction with denominator below N anywhere near c/2<sup>n</sup>, so
          the expansion cannot pick the wrong one. Use fewer counting qubits and the
          algorithm still runs, still produces peaks, and quietly stops being correct.
        </p>
      </Explainer>

      <Explainer title="Why N stops at 55, honestly">
        <p>
          The counting register here is a real statevector: {sizes.M.toLocaleString('en-US')}{' '}
          complex amplitudes, transformed by an actual Hadamard-and-controlled-phase QFT
          circuit. The work register is not expanded into gates — the joint state
          Σ<sub>x</sub>|x⟩|a<sup>x</sup> mod N⟩ is written down exactly from the classical
          table of a<sup>x</sup> mod N, and the measurement of the work register is applied
          to it with the Born rule. That is exact, but it does skip the compilation of
          modular exponentiation into adders, which is where a real machine spends nearly
          all its qubits and nearly all its gates.
        </p>
        <p>
          Simulated properly, N = {N} needs {sizes.counting} + {sizes.work} ={' '}
          {sizes.counting + sizes.work} qubits, which is{' '}
          {sizes.jointAmplitudes.toLocaleString('en-US')} amplitudes before a single ancilla. A
          2048-bit RSA modulus needs roughly 4096 counting qubits and a work register to
          match. That is 2<sup>6000</sup>-ish amplitudes. There are about 2<sup>270</sup>{' '}
          atoms in the observable universe. This is not a matter of buying a bigger laptop,
          and the fact that a quantum computer would not have to store any of it is the
          entire point of the field.
        </p>
      </Explainer>

      <Explainer title="What this does and does not mean for encryption">
        <p>
          A machine that ran this on a 2048-bit number would break RSA. Nobody has one. The
          largest numbers factored on real quantum hardware by an unassisted Shor run are
          two digits, and several widely publicised &ldquo;records&rdquo; were compiled
          using knowledge of the answer, which makes the circuit smaller and the result
          meaningless.
        </p>
        <p>
          The reason the field takes it seriously anyway is that encrypted traffic can be
          recorded now and decrypted later. That is why post-quantum key exchange is being
          deployed today, years ahead of any machine that could threaten what it replaces.
        </p>
      </Explainer>
    </VizFrame>
  )
}
