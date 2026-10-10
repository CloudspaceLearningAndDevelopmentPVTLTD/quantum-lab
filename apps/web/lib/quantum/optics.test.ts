import { describe, it, expect } from 'vitest'
import {
  ARM_B,
  ARM_A,
  applyComponent,
  attenuator,
  beamSplitter,
  blocker,
  entangledPair,
  halfWavePlate,
  JONES_D,
  JONES_H,
  JONES_V,
  linearJones,
  machZehnder,
  machZehnderSweep,
  machZehnderTable,
  MACH_ZEHNDER_DEFAULTS,
  markerOverlap,
  mirror,
  modeProbabilities,
  modeProbability,
  phaseShifter,
  photonIn,
  polariser,
  polarisingBeamSplitter,
  predictedVisibility,
  projectIdler,
  quantumEraser,
  quarterWavePlate,
  runTable,
  totalProbability,
  visibilityOf,
  waveplate,
  amplitude,
  ERASER_DEFAULTS,
  eraserRates,
  type MachZehnderOptions,
} from './optics'

/**
 * Every expectation below is an INDEPENDENT analytic result — a textbook closed form
 * derived from the physics, not a value read back out of this module. The three that
 * would catch a wrong beam-splitter phase, a transposed Jones matrix or a mishandled
 * entangled marker are, in order:
 *
 *   • a balanced Mach–Zehnder at zero phase puts 100% into ONE port,
 *   • Malus's law, cos²θ, out of the polariser,
 *   • the delayed-choice coincidence rate ¼(1 − sin2θ cos φ), derived by hand in the
 *     comment above that test.
 */

const TOL = 1e-12
const close = (a: number, b: number, tol = 1e-10) => expect(a).toBeCloseTo(b, -Math.log10(tol))

function mz(overrides: Partial<MachZehnderOptions> = {}): MachZehnderOptions {
  return { ...MACH_ZEHNDER_DEFAULTS, ...overrides }
}

function runMZ(overrides: Partial<MachZehnderOptions> = {}) {
  return runTable(photonIn(2, ARM_A), machZehnderTable(mz(overrides)))
}

describe('the balanced Mach–Zehnder', () => {
  it('sends every photon to ONE port at zero phase difference — not 50/50', () => {
    const probs = modeProbabilities(runMZ({ phase: 0 }))
    // This is the result that proves the two arms interfered. A wrong reflection phase
    // on the beam splitter gives 0.5 / 0.5 here and looks superficially fine.
    expect(probs[ARM_A]).toBeLessThan(TOL)
    close(probs[ARM_B], 1)
  })

  it('swaps the ports at half a wavelength of extra path', () => {
    const probs = modeProbabilities(runMZ({ phase: Math.PI }))
    close(probs[ARM_A], 1)
    expect(probs[ARM_B]).toBeLessThan(TOL)
  })

  it('follows sin²(φ/2) and cos²(φ/2) across the whole sweep', () => {
    for (let i = 0; i <= 24; i++) {
      const phase = (2 * Math.PI * i) / 24
      const probs = modeProbabilities(runMZ({ phase }))
      close(probs[ARM_A], Math.sin(phase / 2) ** 2)
      close(probs[ARM_B], Math.cos(phase / 2) ** 2)
      close(probs[0] + probs[1], 1)
    }
  })

  it('does not care which arm the phase shifter sits in', () => {
    for (const phase of [0.3, 1.1, 2.7, 4.9]) {
      const inA = modeProbabilities(runMZ({ phase, phaseArm: ARM_A }))
      const inB = modeProbabilities(runMZ({ phase, phaseArm: ARM_B }))
      // Only the phase DIFFERENCE is physical, so a phase of φ in the other arm is the
      // same interferometer read backwards: P_A(φ in A) = P_A(−φ in B).
      const mirrored = modeProbabilities(runMZ({ phase: -phase, phaseArm: ARM_B }))
      close(inA[0], mirrored[0])
      close(inA[0] + inA[1], 1)
      close(inB[0] + inB[1], 1)
    }
  })

  it('reaches full visibility with nothing in the arms', () => {
    close(visibilityOf(machZehnderSweep(mz(), ARM_A)), 1, 1e-9)
  })
})

describe('which-path information destroys interference', () => {
  it('blocking one arm restores 50/50 — and halves the count rate', () => {
    for (const phase of [0, 0.7, Math.PI / 2, Math.PI, 5.5]) {
      for (const blockedArm of [ARM_A, ARM_B]) {
        const probs = modeProbabilities(runMZ({ phase, blockedArm }))
        // Absolute: half the photons hit the card, and what is left splits evenly.
        close(probs[0], 0.25)
        close(probs[1], 0.25)
        // Conditional on the photon getting through, it is a coin flip either way.
        const survival = probs[0] + probs[1]
        close(probs[0] / survival, 0.5)
        close(survival, 0.5)
      }
    }
  })

  it('reports zero visibility once an arm is blocked', () => {
    close(visibilityOf(machZehnderSweep(mz({ blockedArm: ARM_B }), ARM_A)), 0)
  })

  it('a half-wave plate at 45° in one arm flattens the fringes just as thoroughly', () => {
    for (const phase of [0, 1, 2.2, 4]) {
      const probs = modeProbabilities(runMZ({ phase, markerAngle: Math.PI / 4 }))
      close(probs[0], 0.5)
      close(probs[1], 0.5)
    }
    // ... but without losing a single photon. Marking is not blocking.
    close(totalProbability(runMZ({ markerAngle: Math.PI / 4 })), 1)
  })

  it('traces the complementarity relation V² + D² = 1 for a partial marker', () => {
    // A half-wave plate at α turns arm A's H into linear at 2α, so the two
    // arms overlap by cos2α. The interferometer's visibility must then be |cos 2α|
    // and the which-path distinguishability |sin 2α| — a textbook result, and one this
    // engine has to reproduce rather than define.
    for (let k = 0; k <= 8; k++) {
      const alpha = (Math.PI / 2) * (k / 8)
      const result = machZehnder(mz({ markerAngle: alpha }))
      close(result.overlap, Math.abs(Math.cos(2 * alpha)), 1e-9)
      close(result.visibility, Math.abs(Math.cos(2 * alpha)), 1e-8)
      close(result.distinguishability, Math.abs(Math.sin(2 * alpha)), 1e-8)
      close(result.visibility ** 2 + result.distinguishability ** 2, 1, 1e-8)
    }
  })

  it('the measured visibility matches the closed form 2√(PaPb)|⟨a|b⟩|/(Pa+Pb)', () => {
    // Balanced splitters only: with a lopsided recombiner the measured fringes fall
    // short of this bound for a reason that has nothing to do with which-path
    // information. That case is pinned separately below.
    const cases: Partial<MachZehnderOptions>[] = [
      {},
      { markerAngle: 0.4 },
      { markerAngle: Math.PI / 8 },
      { markerAngle: 1.4, phaseArm: ARM_B },
      { blockedArm: ARM_A },
    ]
    for (const overrides of cases) {
      const result = machZehnder(mz(overrides))
      close(result.maxVisibility, predictedVisibility(result.armState, ARM_A, ARM_B), 1e-12)
      close(result.visibility, result.maxVisibility, 1e-8)
    }
  })
})

describe('an unbalanced interferometer', () => {
  it('matches |t²e^{iφ} − r²|² and r²t²|e^{iφ} + 1|² at every reflectivity', () => {
    for (const R of [0.1, 0.25, 0.5, 0.73, 0.9]) {
      const T = 1 - R
      for (const phase of [0, 0.8, 1.9, 3.0, 4.4]) {
        const probs = modeProbabilities(runMZ({ phase, reflectivity: R }))
        const p0 = T * T + R * R - 2 * R * T * Math.cos(phase)
        const p1 = 2 * R * T * (1 + Math.cos(phase))
        close(probs[0], p0)
        close(probs[1], p1)
        close(p0 + p1, 1)
      }
    }
  })

  it('cannot reach full visibility unless the splitters are balanced', () => {
    for (const R of [0.15, 0.35, 0.5, 0.65]) {
      const T = 1 - R
      const result = machZehnder(mz({ reflectivity: R }))
      // Measured: the two amplitudes arriving at port 0 are t·t and r·r, so from
      // P0 = T² + R² − 2RT cos φ the visibility is 2RT/(T² + R²).
      close(result.visibility, (2 * R * T) / (T * T + R * R), 1e-8)
      // The bound the ARMS impose is looser — 2√(RT) — because it assumes an ideal
      // recombiner. The shortfall is the second splitter's fault, not the photon's.
      close(result.maxVisibility, 2 * Math.sqrt(R * T), 1e-12)
      expect(result.visibility).toBeLessThanOrEqual(result.maxVisibility + 1e-12)
      // No which-path information exists here at all, so distinguishability tracks the
      // uneven arm powers alone: D = |T − R|.
      close(result.distinguishability, Math.abs(T - R), 1e-9)
    }
  })
})

describe('polarisation components', () => {
  it('obeys Malus’s law', () => {
    for (let k = 0; k <= 12; k++) {
      const angle = (Math.PI * k) / 12
      const out = applyComponent(photonIn(1, 0, JONES_H), polariser(0, angle))
      close(totalProbability(out), Math.cos(angle) ** 2)
    }
  })

  it('blocks crossed polarisers completely and passes parallel ones intact', () => {
    const crossed = runTable(photonIn(1, 0, JONES_H), [polariser(0, Math.PI / 2)])
    expect(totalProbability(crossed)).toBeLessThan(TOL)
    const parallel = runTable(photonIn(1, 0, JONES_H), [polariser(0, 0)])
    close(totalProbability(parallel), 1)
  })

  it('recovers the three-polariser paradox', () => {
    // H then V passes nothing; slip a 45° sheet between them and a quarter of the beam
    // gets through — cos²45° twice. Nothing was added; a measurement was.
    // (The figure quoted in textbooks is ⅛, because there the light starts unpolarised
    // and the first sheet throws away half of it before any of this begins. This photon
    // arrives already horizontal, so that first factor of ½ is not ours to pay.)
    const out = runTable(photonIn(1, 0, JONES_H), [
      polariser(0, Math.PI / 4),
      polariser(0, Math.PI / 2),
    ])
    close(totalProbability(out), 0.25)
  })

  it('rotates linear polarisation by twice the half-wave plate angle', () => {
    for (let k = 0; k <= 8; k++) {
      const alpha = (Math.PI * k) / 8
      const out = applyComponent(photonIn(1, 0, JONES_H), halfWavePlate(0, alpha))
      const h = amplitude(out, 0, 0)
      const v = amplitude(out, 0, 1)
      close(Math.hypot(h.re, h.im), Math.abs(Math.cos(2 * alpha)))
      close(Math.hypot(v.re, v.im), Math.abs(Math.sin(2 * alpha)))
      close(totalProbability(out), 1)
    }
  })

  it('turns horizontal into circular with a quarter-wave plate at 45°', () => {
    const out = applyComponent(photonIn(1, 0, JONES_H), quarterWavePlate(0, Math.PI / 4))
    const h = amplitude(out, 0, 0)
    const v = amplitude(out, 0, 1)
    close(Math.hypot(h.re, h.im) ** 2, 0.5)
    close(Math.hypot(v.re, v.im) ** 2, 0.5)
    // Equal magnitudes AND a quarter-turn between them is what "circular" means.
    const relPhase = Math.atan2(v.im, v.re) - Math.atan2(h.im, h.re)
    close(Math.abs(Math.sin(relPhase)), 1)
    close(totalProbability(out), 1)
  })

  it('leaves polarisation alone when the wave plate has no retardance', () => {
    const out = applyComponent(photonIn(1, 0, JONES_D), waveplate(0, 0, 0.7))
    close(amplitude(out, 0, 0).re, Math.SQRT1_2)
    close(amplitude(out, 0, 1).re, Math.SQRT1_2)
  })

  it('sorts H from V at a polarising beam splitter without losing anything', () => {
    const diagonal = applyComponent(photonIn(2, 0, JONES_D), polarisingBeamSplitter(0, 1))
    const probs = modeProbabilities(diagonal)
    close(probs[0], 0.5)
    close(probs[1], 0.5)
    close(totalProbability(diagonal), 1)

    const pure = applyComponent(photonIn(2, 0, JONES_V), polarisingBeamSplitter(0, 1))
    expect(modeProbability(pure, 0)).toBeLessThan(TOL)
    close(modeProbability(pure, 1), 1)
  })
})

describe('component bookkeeping', () => {
  it('keeps the lossless components unitary', () => {
    const start = photonIn(3, 0, linearJones(0.6))
    const table = [
      beamSplitter(0, 1, 0.37),
      mirror(1),
      phaseShifter(0, 1.23),
      waveplate(0, 0.9, 0.4),
      beamSplitter(1, 2, 0.5),
      polarisingBeamSplitter(0, 2),
      halfWavePlate(2, 0.3),
    ]
    let state = start
    for (const component of table) {
      state = applyComponent(state, component)
      close(totalProbability(state), 1, 1e-11)
    }
  })

  it('attenuates by intensity, not amplitude', () => {
    const out = applyComponent(photonIn(1, 0), attenuator(0, 0.3))
    close(totalProbability(out), 0.3)
  })

  it('empties the mode a blocker sits in', () => {
    const out = applyComponent(photonIn(2, 1), blocker(1))
    expect(totalProbability(out)).toBeLessThan(TOL)
  })

  it('reports no overlap between an occupied arm and an empty one', () => {
    const state = runMZ({ blockedArm: ARM_B })
    close(markerOverlap(runTable(photonIn(2, ARM_A), [beamSplitter(0, 1), blocker(1)]), 0, 1), 0)
    expect(totalProbability(state)).toBeGreaterThan(0)
  })
})

describe('the local eraser: a polariser in front of the detector', () => {
  const marked = mz({ markerAngle: Math.PI / 4 })

  it('shows no fringes with the marker in and no analyser', () => {
    close(visibilityOf(machZehnderSweep(marked, ARM_A)), 0)
  })

  it('brings the fringes back at 45°, at the cost of half the photons', () => {
    // Both arms are projected onto the same diagonal state, so the which-path record
    // is gone. Analytic: P(D0) = ¼(1 − cos φ), whose visibility is 1 and whose mean is
    // ¼ — half of the ½ the marked interferometer delivered.
    for (const phase of [0, 0.9, 2.0, Math.PI, 5.1]) {
      const probs = modeProbabilities(
        runMZ({ markerAngle: Math.PI / 4, phase, analyserAngle: Math.PI / 4 }),
      )
      close(probs[ARM_A], 0.25 * (1 - Math.cos(phase)))
      close(probs[ARM_B], 0.25 * (1 + Math.cos(phase)))
    }
    close(
      visibilityOf(machZehnderSweep(mz({ markerAngle: Math.PI / 4, analyserAngle: Math.PI / 4 }), ARM_A)),
      1,
      1e-9,
    )
  })

  it('gives the anti-fringe at 135°, so the two analyser settings add back to flat', () => {
    for (const phase of [0.3, 1.4, 3.3]) {
      const a = modeProbabilities(runMZ({ markerAngle: Math.PI / 4, phase, analyserAngle: Math.PI / 4 }))
      const b = modeProbabilities(
        runMZ({ markerAngle: Math.PI / 4, phase, analyserAngle: (3 * Math.PI) / 4 }),
      )
      close(b[ARM_A], 0.25 * (1 + Math.cos(phase)))
      close(a[ARM_A] + b[ARM_A], 0.5)
    }
  })

  it('does not resurrect anything when the analyser is in the marking basis', () => {
    const v = visibilityOf(
      machZehnderSweep(mz({ markerAngle: Math.PI / 4, analyserAngle: 0 }), ARM_A),
    )
    close(v, 0)
  })
})

describe('the delayed-choice quantum eraser', () => {
  /**
   * Derivation, done by hand so the numbers below are not this module's own output.
   *
   * Source: Φ⁺ = (|HH⟩ + |VV⟩)/√2, signal into the upper input port.
   * After the first splitter the arms carry amplitude 1/√2 (upper) and i/√2 (lower).
   * A half-wave plate at 45° in the upper arm swaps the signal's H and V, so the arms
   * carry Ψ⁺ = (|VH⟩ + |HV⟩)/√2 and Φ⁺ respectively — orthogonal, hence no fringes.
   * With a phase φ in the upper arm, the recombining splitter gives
   *
   *     port0 = ½( e^{iφ}|Ψ⁺⟩ − |Φ⁺⟩ ),    port1 = (i/2)( e^{iφ}|Ψ⁺⟩ + |Φ⁺⟩ ).
   *
   * Projecting the idler onto |θ⟩ = cosθ|H⟩ + sinθ|V⟩:
   *     ⟨θ|Ψ⁺⟩ = (sinθ, cosθ)/√2,   ⟨θ|Φ⁺⟩ = (cosθ, sinθ)/√2   in the signal's (H,V).
   * so
   *     P(port0, θ) = ⅛( |e^{iφ}sinθ − cosθ|² + |e^{iφ}cosθ − sinθ|² )
   *                 = ¼( 1 − sin2θ · cos φ ),
   *     P(port1, θ) = ¼( 1 + sin2θ · cos φ ).
   */
  const coincidence = (phase: number, idlerAngle: number) =>
    quantumEraser({ ...ERASER_DEFAULTS, phase, idlerAngle }).coincidence

  it('matches ¼(1 ∓ sin2θ cos φ) across a grid of analyser angle and phase', () => {
    for (let a = 0; a <= 8; a++) {
      const theta = (Math.PI * a) / 8
      for (let p = 0; p <= 10; p++) {
        const phase = (2 * Math.PI * p) / 10
        const [c0, c1] = coincidence(phase, theta)
        close(c0, 0.25 * (1 - Math.sin(2 * theta) * Math.cos(phase)))
        close(c1, 0.25 * (1 + Math.sin(2 * theta) * Math.cos(phase)))
      }
    }
  })

  it('records flat singles no matter what the idler analyser is set to', () => {
    // THE point of the page. The signal detectors cannot tell that a choice was made.
    for (const theta of [0, Math.PI / 8, Math.PI / 4, 1.1, Math.PI / 2]) {
      for (const phase of [0, 1.2, 2.6, 4.7]) {
        const r = quantumEraser({ ...ERASER_DEFAULTS, phase, idlerAngle: theta })
        close(r.singles[0], 0.5)
        close(r.singles[1], 0.5)
        close(r.visibility.singles, 0)
      }
    }
  })

  it('reads no fringes in the which-path basis and full fringes in the erasing basis', () => {
    const whichPath = quantumEraser({ ...ERASER_DEFAULTS, idlerAngle: 0 })
    close(whichPath.visibility.coincidence, 0)
    close(whichPath.coincidence[0], 0.25)

    const erased = quantumEraser({ ...ERASER_DEFAULTS, idlerAngle: Math.PI / 4 })
    close(erased.visibility.coincidence, 1, 1e-9)
    close(erased.visibility.coincidenceOrthogonal, 1, 1e-9)
  })

  it('gives coincidence visibility |sin 2θ| at intermediate analyser angles', () => {
    for (let a = 0; a <= 8; a++) {
      const theta = (Math.PI * a) / 8
      const r = quantumEraser({ ...ERASER_DEFAULTS, idlerAngle: theta })
      close(r.visibility.coincidence, Math.abs(Math.sin(2 * theta)), 1e-8)
    }
  })

  it('adds the two subensembles back to the flat singles curve — no signalling', () => {
    for (const theta of [0, Math.PI / 6, Math.PI / 4, 1.3]) {
      for (const phase of [0, 0.9, 2.4, 3.9, 5.8]) {
        const r = quantumEraser({ ...ERASER_DEFAULTS, phase, idlerAngle: theta })
        close(r.coincidence[0] + r.coincidenceOrthogonal[0], r.singles[0])
        close(r.coincidence[1] + r.coincidenceOrthogonal[1], r.singles[1])
        close(r.idlerRate, 0.5)
      }
    }
  })

  it('keeps full fringes in coincidence when the marker is never inserted', () => {
    // No half-wave plate: the arms are indistinguishable, the singles show fringes, and
    // the coincidences are just half of them regardless of analyser angle.
    for (const theta of [0, Math.PI / 4, 1.0]) {
      for (const phase of [0.4, 1.7, 3.1]) {
        const r = quantumEraser({ ...ERASER_DEFAULTS, markerAngle: null, phase, idlerAngle: theta })
        close(r.singles[0], Math.sin(phase / 2) ** 2)
        close(r.coincidence[0], 0.5 * Math.sin(phase / 2) ** 2)
        close(r.visibility.singles, 1, 1e-9)
      }
    }
  })

  it('reports an orthogonal marker as zero overlap and a missing one as perfect overlap', () => {
    close(quantumEraser({ ...ERASER_DEFAULTS }).overlap, 0)
    close(quantumEraser({ ...ERASER_DEFAULTS, markerAngle: null }).overlap, 1, 1e-9)
  })

  it('lets the idler projection commute with the signal-side optics', () => {
    // Delayed choice, stated as arithmetic: measuring the idler first and then running
    // the signal through the table gives the same numbers as running the table first
    // and measuring the idler afterwards. The two operations act on different factors
    // of the state, so they simply commute — that is the entire mystery, dissolved.
    const options = { ...ERASER_DEFAULTS, phase: 1.35, idlerAngle: Math.PI / 4 }
    const table = machZehnderTable({
      ...MACH_ZEHNDER_DEFAULTS,
      phase: options.phase,
      markerAngle: options.markerAngle,
    })
    const signalFirst = modeProbabilities(projectIdler(runTable(entangledPair(2, ARM_A), table), options.idlerAngle))
    const idlerFirst = modeProbabilities(runTable(projectIdler(entangledPair(2, ARM_A), options.idlerAngle), table))
    close(signalFirst[0], idlerFirst[0])
    close(signalFirst[1], idlerFirst[1])
  })
})

describe('eraserRates', () => {
  it('agrees with quantumEraser on every rate it reports', () => {
    // The visualization calls this once per phase bin and once per frame, so a drift
    // between the cheap path and the full one would put the drawn curves and the
    // printed visibilities into quiet disagreement.
    for (const markerAngle of [null, Math.PI / 4, 0.6]) {
      for (const idlerAngle of [0, Math.PI / 4, 1.05]) {
        for (const phase of [0, 1.1, 3.4, 5.9]) {
          const options = { ...ERASER_DEFAULTS, markerAngle, idlerAngle, phase }
          const cheap = eraserRates(options)
          const full = quantumEraser(options)
          close(cheap.singles[0], full.singles[0], 1e-14)
          close(cheap.singles[1], full.singles[1], 1e-14)
          close(cheap.coincidence[0], full.coincidence[0], 1e-14)
          close(cheap.coincidenceOrthogonal[0], full.coincidenceOrthogonal[0], 1e-14)
          close(cheap.idlerRate, full.idlerRate, 1e-14)
        }
      }
    }
  })

  it('never loses a photon: the four joint outcomes are a complete distribution', () => {
    // The eraser page samples one shot from exactly these four numbers, so if they do
    // not sum to one the histograms are silently sampling from a defective die.
    for (const idlerAngle of [0, 0.3, Math.PI / 4, 1.4]) {
      for (const phase of [0, 2.2, 4.8]) {
        const r = eraserRates({ ...ERASER_DEFAULTS, idlerAngle, phase })
        const total =
          r.coincidence[0] + r.coincidence[1] + r.coincidenceOrthogonal[0] + r.coincidenceOrthogonal[1]
        close(total, 1)
      }
    }
  })
})

describe('helpers', () => {
  it('computes visibility of a sampled curve', () => {
    close(visibilityOf([1, 0, 1, 0]), 1)
    close(visibilityOf([0.5, 0.5]), 0)
    expect(visibilityOf([])).toBe(0)
    expect(visibilityOf([0, 0])).toBe(0)
  })

  it('builds linear Jones vectors that a polariser at the same angle passes intact', () => {
    for (const angle of [0, 0.4, Math.PI / 3, 2.9]) {
      const out = applyComponent(photonIn(1, 0, linearJones(angle)), polariser(0, angle))
      close(totalProbability(out), 1)
    }
    close(totalProbability(applyComponent(photonIn(1, 0, JONES_V), polariser(0, 0))), 0)
  })
})
