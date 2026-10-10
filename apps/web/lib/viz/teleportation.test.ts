/**
 * teleportation.test.ts — does the protocol actually teleport?
 *
 * The assertions here are deliberately against results this module does not
 * produce. Bob's final Bloch vector is compared with (sinθcosφ, sinθsinφ,
 * cosθ), the textbook vector for the state Alice prepared. The branch
 * probabilities are compared with 1/4, which is a consequence of the Bell basis
 * being an orthonormal basis and has nothing to do with our implementation.
 * And the no-signalling check — Bob's average state is the maximally mixed one
 * until the classical bits arrive — is the statement that would have to fail
 * for teleportation to beat light, so it is the one worth pinning hardest.
 */

import { describe, it, expect } from 'vitest'
import {
  ALICE,
  BOB,
  PAYLOAD,
  PRESET_STATES,
  TELEPORT_STAGES,
  averageBobVector,
  blochDistance,
  blochFidelity,
  blochLength,
  blochOf,
  payloadState,
  teleportBranches,
  teleportCircuit,
  teleportFrames,
  type Vec3,
} from './teleportation'
import { outcomeBranches, simulate } from '@/lib/quantum'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { VISUALIZATIONS } from '@/lib/visualizations'

/** A spread of input states, including the poles and some awkward angles. */
const ANGLES: { theta: number; phi: number }[] = [
  { theta: 0, phi: 0 },
  { theta: Math.PI, phi: 0 },
  { theta: Math.PI / 2, phi: 0 },
  { theta: Math.PI / 2, phi: Math.PI / 2 },
  { theta: Math.PI / 3, phi: (3 * Math.PI) / 4 },
  { theta: 1.1, phi: 2.3 },
  { theta: 2.7, phi: -0.9 },
  { theta: 0.37, phi: 5.1 },
]

const near = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('the reference state', () => {
  it('the simulator agrees with the textbook Bloch formula', () => {
    // Not circular: payloadState runs RY then RZ through the engine, blochOf is
    // trigonometry. They are computed by completely different code.
    for (const { theta, phi } of ANGLES) {
      const measured = payloadState(theta, phi).blochVector(0)
      const analytic = blochOf(theta, phi)
      expect(blochDistance(measured, analytic)).toBeLessThan(1e-12)
      near(blochLength(measured), 1, 1e-12)
    }
  })
})

describe('teleportation delivers the state', () => {
  it('every branch ends with Bob holding exactly what Alice prepared', () => {
    for (const { theta, phi } of ANGLES) {
      const analytic = blochOf(theta, phi)
      const branches = teleportBranches({ theta, phi })
      expect(branches).toHaveLength(4)
      for (const branch of branches) {
        expect(blochDistance(branch.bob, analytic)).toBeLessThan(1e-12)
        // Pure, not merely pointing the right way: length 1 rules out a state
        // that happens to have the right direction but is partly mixed.
        near(blochLength(branch.bob), 1, 1e-12)
        near(blochFidelity(analytic, branch.bob), 1, 1e-12)
      }
    }
  })

  it('all four Bell outcomes are equally likely, whatever was sent', () => {
    for (const { theta, phi } of ANGLES) {
      const branches = teleportBranches({ theta, phi })
      expect(branches.map((b) => b.label)).toEqual(['00', '01', '10', '11'])
      for (const branch of branches) near(branch.probability, 0.25, 1e-12)
    }
  })

  it('the outcome carries no information about the state — that is why it is safe to send', () => {
    // If the distribution over Alice's two bits depended on θ or φ, the bits
    // themselves would leak the state, and Alice could not send them over an
    // insecure channel. It does not: 1/4 each, always, checked just above.
    const flat = teleportBranches({ theta: 0, phi: 0 }).map((b) => b.probability)
    const odd = teleportBranches({ theta: 1.1, phi: 2.3 }).map((b) => b.probability)
    // Equal to floating-point round-off, which is where the difference stops:
    // the two runs multiply different amplitudes together to reach the same
    // quarter, so they land a few ulps apart rather than bit-for-bit.
    flat.forEach((v, i) => near(v, odd[i], 1e-14))
  })

  it('the payload qubit does not survive — no cloning', () => {
    for (const { theta, phi } of ANGLES.slice(0, 4)) {
      for (const branch of outcomeBranches(teleportCircuit({ theta, phi }))) {
        // Alice's two qubits are left in a definite computational state, which
        // carries no trace of θ or φ: their Bloch vectors are ±z, full stop.
        for (const q of [PAYLOAD, ALICE]) {
          const v = branch.state.blochVector(q)
          near(Math.abs(v.z), 1, 1e-12)
          near(v.x, 0, 1e-12)
          near(v.y, 0, 1e-12)
        }
      }
    }
  })
})

describe('the classical bits are load-bearing', () => {
  it('without the corrections, three of four branches are wrong', () => {
    const theta = 1.1
    const phi = 2.3
    const analytic = blochOf(theta, phi)
    const branches = teleportBranches({ theta, phi, correct: false })
    const correct = branches.filter((b) => blochDistance(b.bob, analytic) < 1e-9)
    expect(correct).toHaveLength(1)
    expect(correct[0].label).toBe('00')
    // The other three are pure states too — they are just the wrong ones.
    for (const b of branches) near(blochLength(b.bob), 1, 1e-12)
  })

  it('averaged over the unknown outcome, Bob has nothing at all', () => {
    // The no-signalling statement, and the reason teleportation does not beat
    // light: before the bits arrive Bob cannot tell which branch he is in, so
    // his state is the probability-weighted average of the four — and that
    // average is the maximally mixed state, identical for every input.
    for (const { theta, phi } of ANGLES) {
      const uncorrected = averageBobVector(teleportBranches({ theta, phi, correct: false }))
      expect(blochLength(uncorrected)).toBeLessThan(1e-12)
    }
    // Two very different inputs give Bob byte-identical statistics.
    const a = averageBobVector(teleportBranches({ theta: 0, phi: 0, correct: false }))
    const b = averageBobVector(teleportBranches({ theta: 2.7, phi: -0.9, correct: false }))
    expect(blochDistance(a, b)).toBeLessThan(1e-12)
  })

  it('with the corrections applied the average is the payload, as it must be', () => {
    for (const { theta, phi } of ANGLES) {
      const avg = averageBobVector(teleportBranches({ theta, phi }))
      expect(blochDistance(avg, blochOf(theta, phi))).toBeLessThan(1e-12)
    }
  })

  it("Bob's qubit is maximally mixed from the moment it is entangled until the fix", () => {
    const { theta, phi } = { theta: 1.1, phi: 2.3 }
    const frames = teleportFrames({ theta, phi }, { c0: 1, c1: 1 })
    // Frame 4: the pair is shared, nothing has been measured.
    expect(blochLength(frames[4].blochVector(BOB))).toBeLessThan(1e-12)
    // Frame 8: Alice has measured. Bob's qubit is now pure — but rotated into
    // the wrong place, and he has no way to know which way without the bits.
    near(blochLength(frames[8].blochVector(BOB)), 1, 1e-12)
    expect(blochDistance(frames[8].blochVector(BOB), blochOf(theta, phi))).toBeGreaterThan(0.1)
    // Frame 10: corrected.
    expect(blochDistance(frames[10].blochVector(BOB), blochOf(theta, phi))).toBeLessThan(1e-12)
  })
})

describe('the stage model matches the circuit', () => {
  it('every stage frame is a real index into the frames array', () => {
    const frames = teleportFrames({ theta: 0.5, phi: 0.5 }, { c0: 0, c1: 0 })
    expect(frames).toHaveLength(teleportCircuit({ theta: 0.5, phi: 0.5 }).ops.length + 1)
    for (const stage of TELEPORT_STAGES) {
      expect(stage.frame).toBeGreaterThanOrEqual(0)
      expect(stage.frame).toBeLessThan(frames.length)
    }
  })

  it('sending the bits changes no qubit — the transit stage shares its frame', () => {
    const measure = TELEPORT_STAGES.find((s) => s.id === 'measure')!
    const send = TELEPORT_STAGES.find((s) => s.id === 'send')!
    expect(send.frame).toBe(measure.frame)
    expect(send.channel).toBe('flying')
  })

  it('every branch and both correction settings produce a usable frame list', () => {
    // The exact grid of states the page can be in. A forced outcome that could
    // not happen would throw here, and a stage index past the end of a shorter
    // uncorrected circuit would return undefined.
    for (const correct of [true, false]) {
      for (const c0 of [0, 1] as const) {
        for (const c1 of [0, 1] as const) {
          const frames = teleportFrames({ theta: 1.1, phi: 2.3, correct }, { c0, c1 })
          for (const stage of TELEPORT_STAGES) {
            const frame = frames[Math.min(stage.frame, frames.length - 1)]
            expect(frame).toBeDefined()
            // Every frame is a physical state, corrected or not.
            const total = frame.probabilities().reduce((a, b) => a + b, 0)
            near(total, 1, 1e-10)
          }
        }
      }
    }
  })

  it('what the page draws for Bob before the bits land is the zero vector, on every branch', () => {
    // The page reads Bob's vector from the pre-measurement frame (the end of
    // the Bell-basis stage) for every stage whose channel is not 'arrived',
    // because `teleportFrames` is computed for one forced branch and the
    // post-measurement frames would draw a full-length arrow before the bits
    // could have reached him. That frame is branch-independent and Bob's
    // reduced state in it has no length. At 'arrived', with the correction on,
    // he holds the payload exactly, whichever branch happened.
    const preMeasurement = TELEPORT_STAGES.find((s) => s.id === 'bell')!.frame
    for (const { theta, phi } of ANGLES) {
      const alice = blochOf(theta, phi)
      for (const c0 of [0, 1] as const) {
        for (const c1 of [0, 1] as const) {
          const frames = teleportFrames({ theta, phi }, { c0, c1 })
          for (const stage of TELEPORT_STAGES) {
            const frame = frames[Math.min(stage.frame, frames.length - 1)]
            const bob =
              stage.channel === 'arrived'
                ? frame.blochVector(BOB)
                : frames[Math.min(stage.frame, preMeasurement)].blochVector(BOB)
            if (stage.channel === 'arrived') {
              near(blochLength(bob), 1, 1e-12)
              near(blochFidelity(alice, bob), 1, 1e-12)
            } else if (stage.frame >= 4) {
              // From the moment the pair is shared: nothing to read.
              expect(blochLength(bob)).toBeLessThan(1e-12)
              near(blochFidelity(alice, bob), 0.5, 1e-12)
            } else {
              // Before the pair is shared Bob simply holds his own |0⟩.
              expect(blochDistance(bob, { x: 0, y: 0, z: 1 })).toBeLessThan(1e-12)
            }
          }
        }
      }
    }
  })

  it('the payload qubit on the left sphere: prepared arrow, then phase gone, then ±z', () => {
    for (const { theta, phi } of ANGLES) {
      const alice = blochOf(theta, phi)
      for (const c0 of [0, 1] as const) {
        for (const c1 of [0, 1] as const) {
          const frames = teleportFrames({ theta, phi }, { c0, c1 })
          const at = (id: string) => {
            const stage = TELEPORT_STAGES.find((s) => s.id === id)!
            return frames[Math.min(stage.frame, frames.length - 1)].blochVector(PAYLOAD)
          }
          expect(blochDistance(at('prepare'), alice)).toBeLessThan(1e-12)
          expect(blochDistance(at('entangle'), alice)).toBeLessThan(1e-12)
          // After CX the pair's mixedness has erased the payload's coherence,
          // leaving (0, 0, cosθ); the H then turns that into (cosθ, 0, 0). The
          // phase φ is gone here already; only the |0⟩/|1⟩ weight survives,
          // and for an equatorial state nothing survives at all.
          expect(blochDistance(at('bell'), { x: Math.cos(theta), y: 0, z: 0 })).toBeLessThan(1e-12)
          // Collapsed to the measured value, with no trace of θ or φ.
          for (const id of ['measure', 'send', 'correct']) {
            const v = at(id)
            near(Math.abs(v.z), 1, 1e-12)
            expect(v.z > 0 ? 0 : 1).toBe(c0)
            expect(Math.hypot(v.x, v.y)).toBeLessThan(1e-12)
          }
        }
      }
    }
  })

  it('stages only ever move forward', () => {
    const frames = TELEPORT_STAGES.map((s) => s.frame)
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1])
  })

  it('each preset state is a distinct point on the sphere', () => {
    const seen: Vec3[] = []
    for (const p of PRESET_STATES) {
      const v = blochOf(p.theta, p.phi)
      for (const other of seen) expect(blochDistance(v, other)).toBeGreaterThan(1e-6)
      seen.push(v)
    }
  })
})

describe('the displayed trajectory is one of the four enumerated branches', () => {
  it('simulate() lands on a branch the enumeration knows about', () => {
    const circuit = teleportCircuit({ theta: 1.1, phi: 2.3 })
    const displayed = simulate(circuit)
    const branches = outcomeBranches(circuit)
    const match = branches.some((b) => {
      const a = Array.from(b.state.data)
      const d = Array.from(displayed.data)
      return a.every((v, i) => Math.abs(v - d[i]) < 1e-12)
    })
    expect(match).toBe(true)
  })
})

describe('the page is registered', () => {
  // Registering in VISUALIZATIONS is what puts the route in the sitemap, the
  // index, the home page and the social card. A route directory with no entry
  // is a page nothing links to; an entry with no directory is a 404 in the
  // sitemap. Both halves are checked here.
  const HREF = '/visualizations/teleportation'

  it('appears in the catalogue with the right shape', () => {
    const entry = VISUALIZATIONS.find((v) => v.href === HREF)
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('Intermediate')
    expect(entry?.accent).toBe('sky')
    expect(entry?.title).toBe('Quantum Teleportation')
    expect(entry?.hook.length).toBeGreaterThan(30)
  })

  it('has the three files a visualization route needs', () => {
    for (const file of ['page.tsx', 'layout.tsx', 'opengraph-image.tsx']) {
      expect(existsSync(resolve(__dirname, '../../app', HREF.slice(1), file))).toBe(true)
    }
  })
})
