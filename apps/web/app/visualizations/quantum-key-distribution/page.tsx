'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import QkdLab, { type Protocol, type QkdLabStats } from '@/components/viz/QkdLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Segmented, ButtonRow, Slider, Stat } from '@/components/ui/Controls'
import {
  BASIS_LABEL,
  BASIS_NAME,
  E91_ANGLE_LABELS,
  E91_DETECTION_FRACTION,
  QBER_ABORT,
  VERDICT_MIN_SIFTED,
  E91_VERDICT_MIN_PAIRS,
  e91Role,
  type Bb84Qubit,
  type SettingIndex,
  type Verdict,
} from '@/lib/viz/qkd'

/**
 * /visualizations/quantum-key-distribution — BB84 and E91.
 *
 * The page owns the protocol settings and the prose. Every qubit is a real
 * statevector run through lib/viz/qkd.ts (gates, Eve's projective measurement,
 * Bob's measurement); the canvas lab runs them in animation-frame slices and
 * reports the tallies back up. The numbers on this page are what came out of
 * the Born rule, checked in lib/viz/qkd.test.ts against the hand-derived
 * expectations: 50% sifting, 25% under full intercept-resend, the 11% root of
 * 1 − 2h(Q), and √2(2 − f) for E91.
 */

type Budget = '256' | '1024' | '4096'

const BUDGETS: { value: Budget; label: string }[] = [
  { value: '256', label: '256' },
  { value: '1024', label: '1,024' },
  { value: '4096', label: '4,096' },
]

const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`

function verdictLabel(v: Verdict): string {
  if (v === 'pending') return 'collecting…'
  return v === 'secure' ? 'key accepted' : 'ABORT'
}

function verdictAccent(v: Verdict): 'teal' | 'rose' | 'amber' {
  if (v === 'pending') return 'amber'
  return v === 'secure' ? 'teal' : 'rose'
}

export default function QkdPage() {
  const [protocol, setProtocol] = useState<Protocol>('bb84')
  const [bb84Intercept, setBb84Intercept] = useState(0)
  const [channelNoise, setChannelNoise] = useState(0)
  const [e91Intercept, setE91Intercept] = useState(0)
  const [budget, setBudget] = useState<Budget>('1024')
  const [running, setRunning] = useState(true)
  const [runKey, setRunKey] = useState(0)
  const [report, setReport] = useState<QkdLabStats | null>(null)

  // The lab keys its run on these objects, so they must be stable across
  // renders that do not change them — a fresh object per render would restart
  // the experiment on every stats tick.
  const bb84 = useMemo(
    () => ({ interceptFraction: bb84Intercept / 100, channelNoise: channelNoise / 100 }),
    [bb84Intercept, channelNoise]
  )
  const e91 = useMemo(() => ({ interceptFraction: e91Intercept / 100 }), [e91Intercept])
  const target = parseInt(budget, 10)

  const onStats = useCallback((s: QkdLabStats) => setReport(s), [])

  const bb84Report = report?.protocol === 'bb84' ? report : null
  const e91Report = report?.protocol === 'e91' ? report : null

  const controls = (
    <>
      <Segmented<Protocol>
        label="Protocol"
        value={protocol}
        options={[
          { value: 'bb84', label: 'BB84' },
          { value: 'e91', label: 'E91' },
        ]}
        onChange={(p) => {
          setProtocol(p)
          setReport(null)
        }}
      />

      {protocol === 'bb84' ? (
        <>
          <Slider
            label="Eve intercepts"
            value={bb84Intercept}
            min={0}
            max={100}
            step={5}
            onChange={setBb84Intercept}
            format={(v) => `${v.toFixed(0)}% of qubits`}
            hint="Intercept-resend: she measures in a guessed basis and forwards what she found. Expected QBER is a quarter of this."
          />
          <Slider
            label="Channel noise"
            value={channelNoise}
            min={0}
            max={15}
            step={0.5}
            onChange={setChannelNoise}
            format={(v) => `${v.toFixed(1)}% depolarising`}
            hint="A random Pauli with this probability per qubit. Two of the three flip the bit, so it adds two-thirds of this to the QBER — and the check cannot tell it from Eve."
          />
        </>
      ) : (
        <Slider
          label="Eve intercepts"
          value={e91Intercept}
          min={0}
          max={100}
          step={5}
          onChange={setE91Intercept}
          format={(v) => `${v.toFixed(0)}% of pairs`}
          hint="She measures Bob's qubit along one of his three axes and forwards the eigenstate. |S| is expected to fall to √2·(2 − f)."
        />
      )}

      <Segmented<Budget>
        label={protocol === 'bb84' ? 'Qubits to send' : 'Pairs to send'}
        value={budget}
        options={BUDGETS}
        onChange={setBudget}
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Run'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => {
            setRunKey((k) => k + 1)
            setRunning(true)
          }}
        >
          New run
        </button>
      </ButtonRow>

      {protocol === 'bb84' ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Sent" value={(bb84Report?.stats.sent ?? 0).toLocaleString('en-US')} accent="sky" />
          <Stat
            label="Sifted"
            value={
              bb84Report && bb84Report.stats.sent > 0
                ? `${bb84Report.stats.sifted.toLocaleString('en-US')} · ${pct(bb84Report.stats.siftedFraction, 0)}`
                : '—'
            }
            accent="violet"
          />
          <Stat
            label="QBER"
            value={
              bb84Report && bb84Report.stats.sifted > 0
                ? `${pct(bb84Report.stats.qber)} ± ${pct(bb84Report.stats.qberSe)}`
                : '—'
            }
            accent={bb84Report && bb84Report.stats.qber > QBER_ABORT ? 'rose' : 'teal'}
          />
          <Stat
            label="Verdict"
            value={verdictLabel(bb84Report?.stats.verdict ?? 'pending')}
            accent={verdictAccent(bb84Report?.stats.verdict ?? 'pending')}
          />
          <Stat
            label="Final key"
            value={bb84Report ? `${bb84Report.stats.finalKeyBits.toLocaleString('en-US')} bits` : '—'}
            accent="amber"
          />
          <Stat
            label="Eve holds"
            value={
              bb84Report && bb84.interceptFraction > 0 && bb84Report.stats.sifted > 0
                ? pct(bb84Report.stats.eveKnowledge, 0)
                : '—'
            }
            accent="rose"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Pairs" value={(e91Report?.stats.sent ?? 0).toLocaleString('en-US')} accent="sky" />
          <Stat
            label="|S|"
            value={
              e91Report && Number.isFinite(e91Report.stats.chsh.se)
                ? `${e91Report.stats.chsh.sAbs.toFixed(2)} ± ${e91Report.stats.chsh.se.toFixed(2)}`
                : '—'
            }
            accent={e91Report && e91Report.stats.chsh.sAbs <= 2 ? 'rose' : 'teal'}
          />
          <Stat
            label="Key bits"
            value={e91Report ? e91Report.stats.keyBits.toLocaleString('en-US') : '—'}
            accent="violet"
          />
          <Stat
            label="Key QBER"
            value={e91Report && e91Report.stats.keyBits > 0 ? pct(e91Report.stats.keyQber) : '—'}
            accent="amber"
          />
          <Stat
            label="Verdict"
            value={verdictLabel(e91Report?.stats.verdict ?? 'pending')}
            accent={verdictAccent(e91Report?.stats.verdict ?? 'pending')}
          />
          <Stat
            label="Final key"
            value={e91Report ? `${e91Report.stats.finalKeyBits.toLocaleString('en-US')} bits` : '—'}
            accent="amber"
          />
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-muted">
        {protocol === 'bb84'
          ? `The verdict waits for ${VERDICT_MIN_SIFTED} sifted bits, then aborts if the QBER is above 11%. "Final key" is sifted bits × (1 − 2h(Q)), what survives error correction and privacy amplification.`
          : `The verdict waits for ${E91_VERDICT_MIN_PAIRS} CHSH pairs, then aborts if |S| ≤ 2 or the matched-axis QBER is above 11%. Key bits come only from the two matched-axis combinations.`}
      </p>
    </>
  )

  return (
    <VizFrame
      title="Quantum Key Distribution"
      tagline="Send random bits in random bases and throw half of them away. Anyone who listens in leaves a quarter of the rest wrong — and cannot do quieter."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <QkdLab
            protocol={protocol}
            bb84={bb84}
            e91={e91}
            target={target}
            running={running}
            runKey={runKey}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-ink-muted">
            {protocol === 'bb84'
              ? 'Violet photons were prepared in the rectilinear (+) basis, teal in the diagonal (×). A rose ring means Eve measured that one; an amber ~ means the channel hit it. In the strip, each column is one qubit: basis symbol and bit for each party, then a filled square if the bases matched — teal for agreement, rose for an error. The violet curve is the running QBER with a ±1σ band; the dotted rose line is the value the current attack should produce.'
              : 'Each pair leaves the source in opposite directions. The strip shows the axis each side chose and the spin it read (↑ = +1). Teal squares are key pairs (matched axes, expected to disagree), amber squares feed the CHSH test, empty ones are discarded. The violet curve is |S| with a ±1σ band. If your system asks for reduced motion the run completes in one step instead of animating photons.'}
          </p>
        </div>
      }
      controls={controls}
    >
      {protocol === 'bb84' ? (
        <Bb84Ledger rows={bb84Report?.ledger ?? []} />
      ) : (
        <E91Grid grid={e91Report?.grid ?? new Array(9).fill(0)} />
      )}

      <Explainer title="Run these, in this order">
        <p>
          <strong className="text-ink">Nobody listening.</strong> Eve at 0%, noise at 0%. Watch the
          strip: wherever Alice&rsquo;s and Bob&rsquo;s basis symbols match, the bits match too, every
          time. About half the columns are filled, and the QBER curve sits on the floor. That is the
          sifted key: identical on both ends, and nothing has been transmitted that reveals it.
        </p>
        <p>
          <strong className="text-ink">Eve at 100%.</strong> Every photon gets a rose ring. Rose
          squares appear in the kept row and the curve climbs to a quarter — not to zero, not to a
          half. Note the &ldquo;Eve holds&rdquo; number: she knows about three quarters of the sifted
          key, and Alice and Bob will never use it, because the curve went through the amber line.
        </p>
        <p>
          <strong className="text-ink">Slide Eve down.</strong> QBER is a quarter of her interception
          fraction, so she crosses 11% at about 44%. Sit her at 40% and she is inside the threshold —
          she gets a slice of the key and the protocol still delivers one. That is what privacy
          amplification is for: the final-key count shrinks with the QBER so that what she has is
          hashed away.
        </p>
        <p>
          <strong className="text-ink">Noise, no Eve.</strong> Set Eve to 0% and noise to 15%. The
          QBER climbs to 10% and the verdict hovers at the edge. Alice and Bob cannot tell noise from
          an eavesdropper — the security proof does not try, and blames Eve for all of it. This is
          why QKD range is limited: loss and dark counts raise the QBER until nothing is left.
        </p>
      </Explainer>

      <Explainer title="Why a quarter, and why she cannot be quieter">
        <p>
          Eve cannot copy the photon — no-cloning — so to learn anything she has to measure it, and to
          measure it she has to pick a basis. Half the time she picks Alice&rsquo;s basis: her
          measurement reads the bit exactly, and the state she forwards is the state that arrived. Bob
          sees nothing.
        </p>
        <p>
          The other half, she measures |0⟩ or |1⟩ in the diagonal basis and gets |+⟩ or |−⟩ at
          random. She forwards that. Now when Bob measures in Alice&rsquo;s basis — the only positions
          that survive sifting — he gets a coin flip, and disagrees with Alice half the time. Half of a
          half is 25%. In the strip, every rose square sits under a column where Eve&rsquo;s basis
          symbol differs from Alice&rsquo;s; the unit tests check that no error ever occurs elsewhere.
        </p>
        <p>
          The 25% is set by the physics of measurement, not by Eve&rsquo;s equipment. Any measurement
          that extracts information about a non-orthogonal pair of states disturbs them, and the
          trade-off is quantitative: less disturbance means less information. The interception
          slider is the only knob she has, and it trades her knowledge against her visibility one for
          one.
        </p>
      </Explainer>

      <Explainer title="Where the 11% comes from">
        <p>
          The abort threshold is not a convention. After sifting, Alice and Bob run error correction
          (which leaks about h(Q) bits per key bit to the public channel, where h is the binary
          entropy) and privacy amplification (which discards another h(Q) per bit to erase what Eve
          could have learned from a disturbance of size Q). The Shor–Preskill rate is
        </p>
        <p className="font-mono text-[14px] text-ink">r(Q) = 1 − 2 h(Q)</p>
        <p>
          secret bits per sifted bit, and it hits zero at Q ≈ 0.110. That root is the amber line.
          Below it, the &ldquo;Final key&rdquo; counter is sifted bits × r(Q); above it, there is no
          rate, and the honest thing to do is to throw the run away. Better classical post-processing
          (two-way, or with pre-processing) pushes the threshold a little higher, but the arithmetic
          that produced 25% for Eve does not move.
        </p>
      </Explainer>

      <Explainer title="E91: the discarded runs are the alarm">
        <p>
          Switch to E91. Nobody prepares a bit now. A source — which could be Eve&rsquo;s — emits
          singlet pairs, and each side measures spin along one of three axes chosen at random:
          Alice from {E91_ANGLE_LABELS.alice.join(', ')}, Bob from {E91_ANGLE_LABELS.bob.join(', ')}.
          Two of the nine combinations are matched axes; there the singlet&rsquo;s perfect
          anticorrelation gives Alice the complement of Bob&rsquo;s bit, and those are the key.
        </p>
        <p>
          Four of the remaining seven are exactly the four settings of a CHSH test, which BB84 would
          simply discard. From them Alice and Bob compute |S|. An untouched singlet gives 2√2 ≈ 2.83;
          any pair carrying a pre-agreed answer is bounded by 2. That is the same bound the{' '}
          <Link href="/visualizations/bell-test" className="focus-ring rounded text-q-sky-text underline">
            Bell test page
          </Link>{' '}
          races against, and here it doubles as a security check. A violation proves the pair is
          entangled and rules out any pre-agreed answer; it does not by itself prove the pair is
          maximally entangled (every entangled pure pair violates CHSH by some margin). Monogamy of
          entanglement is quantitative: the closer |S| is to 2√2, the closer the pair is to a pure
          singlet and the less correlation a third party can hold, so the key QBER is checked as
          well.
        </p>
        <p>
          Turn Eve up. She measures Bob&rsquo;s qubit along one of his axes and forwards the
          eigenstate — the pair is now a product state with only classical anticorrelation, and its
          CHSH value is √2 whichever axis she chose. So |S| falls linearly, √2·(2 − f), and crosses 2
          when she intercepts {pct(E91_DETECTION_FRACTION, 1)} of the pairs. She also corrupts the key:
          on a matched-axis pair her measurement is invisible only when she happened to pick that same
          axis.
        </p>
      </Explainer>

      <Explainer title="What this simulation does and does not show">
        <p>
          Every qubit here is a genuine one- or two-qubit statevector on the same simulator as the{' '}
          <Link href="/simulator" className="focus-ring rounded text-q-sky-text underline">
            circuit builder
          </Link>
          : Alice&rsquo;s X and H gates, Eve&rsquo;s projective measurement and re-preparation, the
          channel&rsquo;s random Pauli, Bob&rsquo;s measurement. The sifting yield, the 25%, the 2√2
          and the √2 are outcomes, not parameters, and{' '}
          <code className="mx-1 rounded bg-surface-3 px-1 py-0.5 text-[12px]">lib/viz/qkd.test.ts</code>
          checks each against the value derived by hand.
        </p>
        <p>
          What is missing is everything that breaks real systems. There is no photon loss, so no
          multi-photon pulses and no photon-number-splitting attack, and no decoy states to counter
          it. Detectors here cannot be blinded. The classical channel over which bases are announced
          is assumed authenticated; without that assumption Eve simply runs the protocol with each
          side and both of them share a key with her. And the &ldquo;final key&rdquo; is an
          asymptotic rate applied to a few thousand bits — a real finite-key analysis would keep
          fewer. The{' '}
          <Link href="/learn/quantum-cryptography" className="focus-ring rounded text-q-sky-text underline">
            quantum cryptography lesson
          </Link>{' '}
          covers each of these, and why the practical answer to a quantum computer is post-quantum
          cryptography rather than a fibre link.
        </p>
      </Explainer>
    </VizFrame>
  )
}

/** The first two dozen qubits of the run, as the ledger the three parties would keep. */
function Bb84Ledger({ rows }: { rows: Bb84Qubit[] }) {
  return (
    <div className="card mb-6 p-6">
      <h2 className="section-label mb-1">The first {rows.length || 24} qubits, in full</h2>
      <p className="mb-3 text-[13px] text-ink-secondary">
        What each party writes down. Alice and Bob announce their bases publicly, never their bits;
        the positions where the bases match are the sifted key.
      </p>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <caption className="sr-only">
            Per-qubit ledger: Alice&rsquo;s bit and basis, whether Eve intercepted and what she read,
            Bob&rsquo;s basis and bit, whether the position was kept, and whether it is an error.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-bold">#</th>
              <th scope="col" className="py-2 pr-3 font-bold">Alice bit</th>
              <th scope="col" className="py-2 pr-3 font-bold">Alice basis</th>
              <th scope="col" className="py-2 pr-3 font-bold">Eve</th>
              <th scope="col" className="py-2 pr-3 font-bold">Channel</th>
              <th scope="col" className="py-2 pr-3 font-bold">Bob basis</th>
              <th scope="col" className="py-2 pr-3 font-bold">Bob bit</th>
              <th scope="col" className="py-2 font-bold">Kept</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-3 text-ink-muted">
                  Waiting for the first qubit…
                </td>
              </tr>
            ) : null}
            {rows.map((q, i) => (
              <tr key={i} className="border-b border-line">
                <th scope="row" className="py-1.5 pr-3 text-left font-sans font-semibold text-ink">
                  {i + 1}
                </th>
                <td className="py-1.5 pr-3 text-ink">{q.aliceBit}</td>
                <td className={`py-1.5 pr-3 ${q.aliceBasis === 0 ? 'text-q-violet-text' : 'text-q-teal-text'}`}>
                  {BASIS_LABEL[q.aliceBasis]} {BASIS_NAME[q.aliceBasis]}
                </td>
                <td className="py-1.5 pr-3 text-q-rose-text">
                  {q.eve ? `read ${q.eve.bit} in ${BASIS_LABEL[q.eve.basis]}` : <span className="text-ink-muted">—</span>}
                </td>
                <td className="py-1.5 pr-3 text-q-amber-text">
                  {q.noise ? `${q.noise} flip` : <span className="text-ink-muted">clean</span>}
                </td>
                <td className={`py-1.5 pr-3 ${q.bobBasis === 0 ? 'text-q-violet-text' : 'text-q-teal-text'}`}>
                  {BASIS_LABEL[q.bobBasis]} {BASIS_NAME[q.bobBasis]}
                </td>
                <td className="py-1.5 pr-3 text-ink">{q.bobBit}</td>
                <td className="py-1.5">
                  {!q.sifted ? (
                    <span className="text-ink-muted">discarded</span>
                  ) : q.error ? (
                    <span className="font-bold text-q-rose-text">kept · ERROR</span>
                  ) : (
                    <span className="text-q-teal-text">kept · match</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The nine setting combinations and what each is used for. */
function E91Grid({ grid }: { grid: number[] }) {
  const total = grid.reduce((a, b) => a + b, 0)
  return (
    <div className="card mb-6 p-6">
      <h2 className="section-label mb-1">Where each pair went</h2>
      <p className="mb-3 text-[13px] text-ink-secondary">
        Rows are Alice&rsquo;s axis, columns Bob&rsquo;s. Each combination is chosen one time in
        nine. Matched axes make key; the four CHSH combinations make |S|; the other three are thrown
        away.
      </p>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[420px] border-collapse text-center text-sm">
          <caption className="sr-only">
            Pair counts for every combination of Alice&rsquo;s and Bob&rsquo;s measurement axes,
            labelled by whether the combination is used for key, for the CHSH test, or discarded.
          </caption>
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
              <th scope="col" className="py-2 pr-3 text-left font-bold">Alice ↓ · Bob →</th>
              {E91_ANGLE_LABELS.bob.map((b) => (
                <th key={b} scope="col" className="py-2 font-bold text-q-sky-text">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-[13px]">
            {E91_ANGLE_LABELS.alice.map((a, ai) => (
              <tr key={a} className="border-b border-line">
                <th scope="row" className="py-2 pr-3 text-left font-sans font-semibold text-q-violet-text">
                  {a}
                </th>
                {E91_ANGLE_LABELS.bob.map((b, bi) => {
                  const { role } = e91Role(ai as SettingIndex, bi as SettingIndex)
                  const n = grid[ai * 3 + bi] ?? 0
                  const cls =
                    role === 'key'
                      ? 'text-q-teal-text'
                      : role === 'chsh'
                        ? 'text-q-amber-text'
                        : 'text-ink-muted'
                  return (
                    <td key={b} className={`py-2 ${cls}`}>
                      <div className="font-bold">{n.toLocaleString('en-US')}</div>
                      <div className="text-[10px] uppercase tracking-wider">{role}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-ink-secondary">
        {total.toLocaleString('en-US')} pairs so far. Two ninths become key, four ninths go into the
        Bell test, three ninths are wasted — E91 is less efficient than BB84 and buys a certificate
        about the source in exchange.
      </p>
    </div>
  )
}
