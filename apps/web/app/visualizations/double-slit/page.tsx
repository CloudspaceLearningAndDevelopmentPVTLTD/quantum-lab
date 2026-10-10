'use client'

import { useCallback, useState } from 'react'
import DoubleSlit from '@/components/viz/DoubleSlit'
import { VizFrame, Explainer } from '@/components/ui/VizFrame'
import { Slider, Toggle, ButtonRow, Stat } from '@/components/ui/Controls'

/** Barrier-to-screen distance used by the intensity model, kept in sync with DoubleSlit. */
const SCREEN_DISTANCE = 900

const int = (v: number) => v.toFixed(0)

export default function DoubleSlitPage() {
  const [slitSeparation, setSlitSeparation] = useState(60)
  const [slitWidth, setSlitWidth] = useState(12)
  const [wavelength, setWavelength] = useState(16)
  const [speed, setSpeed] = useState(40)
  const [particleMode, setParticleMode] = useState(false)
  const [observing, setObserving] = useState(false)
  const [hits, setHits] = useState(0)
  const [resetKey, setResetKey] = useState(0)

  const handleStats = useCallback((n: number) => setHits(n), [])

  const clearScreen = () => {
    setResetKey((k) => k + 1)
    setHits(0)
  }

  const fringeSpacing = (wavelength * SCREEN_DISTANCE) / slitSeparation

  return (
    <VizFrame
      title="The Double-Slit Experiment"
      tagline="The experiment that broke classical physics — and you can run it yourself."
      level="Beginner"
      canvas={
        <DoubleSlit
          slitSeparation={slitSeparation}
          slitWidth={slitWidth}
          wavelength={wavelength}
          observing={observing}
          particleMode={particleMode}
          speed={speed}
          resetKey={resetKey}
          onStats={handleStats}
        />
      }
      controls={
        <>
          <Slider
            label="Slit separation"
            value={slitSeparation}
            min={10}
            max={120}
            step={1}
            onChange={setSlitSeparation}
            format={int}
            hint="How far apart the two openings are"
          />
          <Slider
            label="Slit width"
            value={slitWidth}
            min={2}
            max={40}
            step={1}
            onChange={setSlitWidth}
            format={int}
            hint="Narrow slits spread each beam wider"
          />
          <Slider
            label="Wavelength"
            value={wavelength}
            min={4}
            max={40}
            step={1}
            onChange={setWavelength}
            format={int}
            hint="Longer waves spread out more"
          />
          <Slider
            label="Emission rate"
            value={speed}
            min={1}
            max={120}
            step={1}
            onChange={setSpeed}
            format={(v) => `${v.toFixed(0)}/s`}
            hint="Particles per second — only used in particle mode"
          />

          <Toggle
            label="Fire one particle at a time"
            checked={particleMode}
            onChange={setParticleMode}
            hint="Watch the pattern build from single impacts"
          />
          <Toggle
            label="Watch which slit (measure)"
            checked={observing}
            onChange={setObserving}
            hint="Detecting the path destroys the pattern"
          />

          <ButtonRow>
            <button type="button" className="btn-ghost" onClick={clearScreen}>
              Clear screen
            </button>
          </ButtonRow>

          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Particles detected"
              value={particleMode ? hits.toLocaleString('en-US') : '—'}
              accent={particleMode ? 'teal' : 'violet'}
            />
            <Stat
              label="Fringe spacing"
              value={observing ? 'none' : fringeSpacing.toFixed(1)}
              accent={observing ? 'amber' : 'violet'}
            />
          </div>
        </>
      }
    >
      <Explainer title="What you're looking at">
        <p>
          Light — or electrons, or whole molecules — leaves the source on the left, passes through
          two narrow openings in the barrier, and piles up on the screen at the right.
        </p>
        <p>
          Classically you would expect two bands, one behind each slit. Instead you get stripes:
          bright, dark, bright, dark, spreading out across the whole screen. Stripes are what waves
          do. Where the two paths arrive in step they add and you get a bright fringe; where they
          arrive out of step they cancel and you get nothing at all. Widen the slit separation and
          the stripes crowd together; stretch the wavelength and they fan apart.
        </p>
      </Explainer>

      <Explainer title="One particle at a time">
        <p>
          Turn on <em>Fire one particle at a time</em> and watch. Now the source releases a single
          quantum, waits, and releases another. Each one arrives as a single dot in a spot you
          cannot predict — the individual impacts look like pure noise.
        </p>
        <p>
          Keep going. After a few hundred dots the stripes appear anyway, exactly where the wave
          picture said they would. The pattern was never a property of the crowd. Each particle
          interferes with itself: it goes through both slits as a spread-out amplitude, and there is
          nothing else in the apparatus for it to interfere with.
        </p>
      </Explainer>

      <Explainer title="The moment you look">
        <p>
          Now switch on <em>Watch which slit</em>. Put a detector at each opening so you always know
          which one the particle used. The stripes vanish. What is left is one smooth blob — the
          single-slit envelope with the fringes washed out — the classical answer, the one that was
          wrong a moment ago.
        </p>
        <p>
          The usual story is that the detector nudges the particle off course. That is not it. The
          real reason is that once which-path information exists <em>anywhere</em> in the world, the
          two routes are no longer alternatives that add as amplitudes; they are distinct outcomes
          whose probabilities simply add. Interference needs the paths to be indistinguishable in
          principle. Erase the information and the fringes come back.
        </p>
        <p>
          This is the whole mystery of quantum mechanics in one picture: what exists depends on what
          can be known.
        </p>
      </Explainer>
    </VizFrame>
  )
}
