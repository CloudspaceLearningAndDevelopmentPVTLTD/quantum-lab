'use client'

import { useCallback, useState } from 'react'
import MachZehnderLab, {
  type Arm,
  type MachZehnderStats,
  type Tool,
} from '@/components/viz/MachZehnderLab'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { ButtonRow, Slider, Stat, Toggle } from '@/components/ui/Controls'
import Link from 'next/link'
import { ARM_A } from '@/lib/quantum/optics'

const pct = (p: number) => `${(p * 100).toFixed(1)}%`
const MARKER_ANGLE = Math.PI / 4
const ERASER_ANGLE = Math.PI / 4

const EMPTY_STATS: MachZehnderStats = {
  ports: [0, 1],
  arms: [0.5, 0.5],
  survival: 1,
  visibility: 1,
  maxVisibility: 1,
  distinguishability: 0,
  overlap: 1,
  counts: [0, 0],
  lost: 0,
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'phase', label: 'φ  Phase shifter', hint: 'Adds optical path to one arm' },
  { id: 'block', label: '▮  Beam block', hint: 'A card in the beam. Which-path, the blunt way' },
]

export default function MachZehnderPage() {
  const [phase, setPhase] = useState(0)
  const [phaseArm, setPhaseArm] = useState<Arm | null>(null)
  const [blockedArm, setBlockedArm] = useState<Arm | null>(null)
  const [marker, setMarker] = useState(false)
  const [eraser, setEraser] = useState(false)
  const [reflectivity, setReflectivity] = useState(0.5)
  const [running, setRunning] = useState(true)
  const [selectedTool, setSelectedTool] = useState<Tool>('phase')
  const [resetKey, setResetKey] = useState(0)
  const [stats, setStats] = useState<MachZehnderStats>(EMPTY_STATS)

  const onStats = useCallback((s: MachZehnderStats) => {
    setStats((prev) =>
      prev.counts[0] === s.counts[0] &&
      prev.counts[1] === s.counts[1] &&
      prev.ports[0] === s.ports[0] &&
      prev.ports[1] === s.ports[1] &&
      prev.lost === s.lost
        ? prev
        : s,
    )
  }, [])

  /**
   * One component per slot. Dropping the block where the shifter sits sends the shifter
   * back to the tray rather than stacking them — a card and a phase plate in the same
   * arm is not a configuration worth being able to build by accident.
   */
  const onPlace = useCallback((arm: Arm, tool: Tool) => {
    if (tool === 'phase') {
      setPhaseArm((current) => (current === arm ? null : arm))
      setBlockedArm((current) => (current === arm ? null : current))
    } else {
      setBlockedArm((current) => (current === arm ? null : arm))
      setPhaseArm((current) => (current === arm ? null : current))
    }
  }, [])

  const clearTable = () => {
    setPhaseArm(null)
    setBlockedArm(null)
    setMarker(false)
    setEraser(false)
    setPhase(0)
    setReflectivity(0.5)
  }

  const controls = (
    <>
      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-secondary" id="mz-tray">
          Component tray
        </span>
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby="mz-tray">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', tool.id)
                e.dataTransfer.effectAllowed = 'copy'
                setSelectedTool(tool.id)
              }}
              onClick={() => setSelectedTool(tool.id)}
              aria-pressed={selectedTool === tool.id}
              className={`focus-ring cursor-grab rounded-lg border px-3 py-2 text-left transition-colors ${
                selectedTool === tool.id
                  ? 'border-q-violet/60 bg-q-violet/10'
                  : 'border-line bg-surface-2 hover:border-line-strong'
              }`}
            >
              <span className="block text-[13px] font-semibold text-ink-secondary">{tool.label}</span>
              <span className="mt-0.5 block text-[11px] text-ink-muted">{tool.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
          Drag a component onto an arm — or select it here, tab to a slot on the table, and press
          Enter. Activating a slot that already holds that component takes it back off the table.
        </p>
      </div>

      <Slider
        label="Phase difference φ"
        value={phase}
        min={0}
        max={2 * Math.PI}
        step={0.01}
        onChange={setPhase}
        format={(v) => `${(v / Math.PI).toFixed(2)}π`}
        hint={
          phaseArm === null
            ? 'Inert until the phase shifter is on the table.'
            : `Extra optical path in arm ${phaseArm === ARM_A ? 'A' : 'B'}.`
        }
      />

      <Slider
        label="Splitter reflectivity"
        value={reflectivity}
        min={0.05}
        max={0.95}
        step={0.01}
        onChange={setReflectivity}
        format={(v) => `${(v * 100).toFixed(0)} : ${((1 - v) * 100).toFixed(0)}`}
        hint="Both splitters at once. Away from 50:50, D1 can no longer go fully dark (its floor is (R−T)²); D2 still does, at φ = π."
      />

      <Toggle
        label="Polarisation marker in arm A"
        checked={marker}
        onChange={setMarker}
        hint="A half-wave plate that turns arm A's photons vertical. Absorbs nothing."
      />
      <Toggle
        label="45° polariser at the detectors"
        checked={eraser}
        onChange={setEraser}
        hint="Reads both arms in the same basis, discarding the marking — and half the photons."
      />

      <ButtonRow>
        <button type="button" className="btn-primary focus-ring" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Run'}
        </button>
        <button
          type="button"
          className="btn-ghost focus-ring"
          onClick={() => setResetKey((k) => k + 1)}
        >
          Reset counts
        </button>
        <button type="button" className="btn-ghost focus-ring" onClick={clearTable}>
          Clear table
        </button>
      </ButtonRow>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="P(D1)" value={pct(stats.ports[0])} accent="violet" />
        <Stat label="P(D2)" value={pct(stats.ports[1])} accent="teal" />
        <Stat label="Fringe visibility" value={stats.visibility.toFixed(3)} accent="amber" />
        <Stat label="Which-path D" value={stats.distinguishability.toFixed(3)} accent="rose" />
        <Stat label="Photons detected" value={pct(stats.survival)} accent="sky" />
        <Stat
          label="Shots recorded"
          value={`${stats.counts[0] + stats.counts[1] + stats.lost}`}
          accent="violet"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        Beam brightness is the probability in that mode, straight from the simulated table.
        Each ring at a detector is one sampled photon, so the running percentages converge on the
        theory the way real counts do — slowly, and from below or above at random.
      </p>
    </>
  )

  return (
    <VizFrame
      title="The Mach-Zehnder Interferometer"
      tagline="Split one photon two ways, bring the two ways back together, and decide by hand where it is allowed to arrive."
      level="Intermediate"
      canvas={
        <div className="p-2">
          <MachZehnderLab
            phase={phase}
            phaseArm={phaseArm}
            blockedArm={blockedArm}
            markerAngle={marker ? MARKER_ANGLE : null}
            analyserAngle={eraser ? ERASER_ANGLE : null}
            reflectivity={reflectivity}
            running={running}
            resetKey={resetKey}
            selectedTool={selectedTool}
            onPlace={onPlace}
            onStats={onStats}
          />
          <p className="px-3 pb-2 pt-2 text-[11px] leading-relaxed text-ink-muted">
            Arm A is violet, arm B teal. Both arms stay at 50% no matter what you do to the phase —
            the interference lives entirely in where the photon is allowed to <em>leave</em>.
          </p>
        </div>
      }
      controls={controls}
    >
      <Explainer title="What you are about to do">
        <p>
          A photon meets a half-silvered mirror. It does not choose a side. Both arms of the
          interferometer end up carrying half the probability — you can watch that on the table: the
          violet and teal beams stay equally bright whatever you change. Then the two arms meet
          again at a second splitter, and something strange happens to where the photon can come
          out.
        </p>
        <p>
          Start with the table empty and the phase shifter still in the tray. Every photon leaves
          through D2. Not most of them, not 90% — all of them, and D1 counts zero. Two beams, each
          carrying half the probability, arriving at a detector that never clicks.
        </p>
        <p>
          Now drag the phase shifter into an arm and pull φ up to π. The ports swap completely. You
          have changed nothing about how much light is in each arm; you have changed only the length
          of one path, by half a wavelength, and the photon has stopped being allowed to arrive
          where it was arriving before.
        </p>
      </Explainer>

      <Explainer title="What just happened">
        <p>
          At the second splitter each detector can be reached two ways: straight through from one
          arm, or bounced from the other. Those two routes carry amplitudes, and amplitudes add
          before they are squared. At the dark port the two routes arrive exactly out of step and
          cancel; at the bright port they arrive in step and add to a probability of one.
        </p>
        <p>
          The half-wavelength you added with the phase shifter puts the two routes out of step at
          the port that used to be bright and in step at the port that used to be dark. Slide φ
          slowly and the curve below the table is what you are tracing:{' '}
          <span className="font-mono text-q-violet-text">sin²(φ/2)</span> at D1 and{' '}
          <span className="font-mono text-q-teal-text">cos²(φ/2)</span> at D2, always summing to
          one, because the photon does arrive somewhere.
        </p>
        <p>
          Turn the splitter reflectivity away from 50:50 and D1 stops being able to go dark. That
          is not a failure of the physics — cancellation needs two amplitudes of equal size, and
          D1&rsquo;s two routes are transmitted twice (size T) and reflected twice (size R), which a
          70:30 splitter never makes equal. D1&rsquo;s floor is{' '}
          <span className="font-mono">(R − T)²</span>, its visibility readout falls to{' '}
          <span className="font-mono">2RT/(R² + T²)</span>, and no amount of tuning φ recovers it.
          D2 is different: each of its two routes is reflected once and transmitted once, so both
          have size <span className="font-mono">√(RT)</span> whatever the splitter does, and D2
          still goes perfectly dark at φ = π for any reflectivity.
        </p>
      </Explainer>

      <Explainer title="Blocking an arm: the interference dies, and so does half the light">
        <p>
          Drag the beam block into either arm. The counts go to roughly 50/50 at both detectors, and
          they stay there as you sweep φ. The fringes are gone.
        </p>
        <p>
          It is worth being precise about why, because the obvious explanation is the wrong one. The
          block did not disturb the photon in the other arm. What it did was make the two routes
          unequal — one of them now has zero amplitude — and one route cannot interfere with
          nothing. What is left is an ordinary beam splitter with one input: a coin flip.
        </p>
        <p>
          Look at the count rate too. Only half the photons reach a detector at all; the rest end in
          the card. That is the tell that a block is a crude instrument. It destroys the
          interference by destroying the photon.
        </p>
      </Explainer>

      <Explainer title="Marking the path without touching the energy">
        <p>
          Now take the block off and switch on the polarisation marker instead. It is a half-wave
          plate in arm A that rotates that arm&rsquo;s polarisation from horizontal to vertical. It
          absorbs nothing — the detected fraction stays at 100% — and yet the fringes vanish just as
          completely as they did under the card.
        </p>
        <p>
          Nothing was blocked and nothing was measured. But the two routes to a detector no longer
          arrive in the same state: one is horizontal, one is vertical, and orthogonal states do not
          interfere. In principle, someone could put a polarising splitter in front of D1 and read
          off which arm every photon came from. The mere fact that the information is{' '}
          <em>there to be read</em> is enough. This is complementarity with the numbers attached:
          at 50:50, the visibility and the which-path distinguishability in the readout always
          satisfy V² + D² = 1. (Away from 50:50 the measured V at D1 drops below the bound the
          arms allow, as the previous section explains; it is that bound, not the readout, that
          pairs with D.)
        </p>
        <p>
          Then switch on the 45° polariser in front of the detectors. Both the horizontal and the
          vertical route are projected onto the same diagonal state, the record of which arm the
          photon took is thrown away, and the fringes come back at full visibility — while the
          detected fraction drops to 50%. You paid for the interference with half your photons. The{' '}
          <Link
            href="/visualizations/quantum-eraser"
            className="focus-ring rounded font-semibold text-q-rose-text underline decoration-q-rose/40 underline-offset-2 hover:decoration-q-rose"
          >
            quantum eraser
          </Link>{' '}
          is what happens when you make that same choice with a second photon, after the first one
          has already been detected.
        </p>
      </Explainer>

      <Explainer title="Why anyone builds these">
        <p>
          An interferometer converts a length into a click rate, and the conversion factor is a
          wavelength. That is why LIGO is a Michelson interferometer four kilometres on a side: a
          passing gravitational wave stretches one arm by a fraction of a proton&rsquo;s width, and
          the dark port stops being dark.
        </p>
        <p>
          It is also the shape of most of quantum computing. A Hadamard, some phases, another
          Hadamard — that is a Mach-Zehnder written in gates, and Grover&rsquo;s search and the
          quantum Fourier transform are both large arrangements of exactly this move: put amplitude
          down every path, arrange the phases so the wrong answers cancel, and read out what is
          left.
        </p>
      </Explainer>
    </VizFrame>
  )
}
