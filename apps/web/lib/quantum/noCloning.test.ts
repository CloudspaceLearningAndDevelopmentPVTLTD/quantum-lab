import { describe, expect, it } from 'vitest'
import { type GateOp, c, mulberry32 } from '@/lib/quantum'
import { blochStateAmplitudes, randomPureState } from './tomography'
import {
  CANDIDATE_PRESETS,
  UNIVERSAL_CLONER_FIDELITY,
  cloneReport,
  linearityPrediction,
  noCloningVerdict,
  perfectBasisClonerBound,
  runCandidate,
} from './noCloning'

/**
 * Expected values are textbook: CNOT maps |+⟩|0⟩ to (|00⟩ + |11⟩)/√2 whose
 * overlap with |+⟩|+⟩ is ½; the Bužek–Hillery cloner gives 5/6 per copy and
 * 2/3 for the pair (Bužek & Hillery, PRA 54, 1844, 1996); a swap moves rather
 * than copies. The linearity gap must be zero to machine precision because the
 * simulator is a linear map — that is the entire content of the theorem.
 */

const R = Math.SQRT1_2
const ZERO: [ReturnType<typeof c>, ReturnType<typeof c>] = [c(1), c(0)]
const ONE: [ReturnType<typeof c>, ReturnType<typeof c>] = [c(0), c(1)]
const PLUS: [ReturnType<typeof c>, ReturnType<typeof c>] = [c(R), c(R)]
const PLUS_I: [ReturnType<typeof c>, ReturnType<typeof c>] = [c(R), c(0, R)]

const preset = (id: string): GateOp[] => CANDIDATE_PRESETS.find((p) => p.id === id)!.ops

describe('the CNOT copier', () => {
  const ops = preset('cnot')

  it('copies |0⟩ and |1⟩ perfectly', () => {
    for (const s of [ZERO, ONE]) {
      const r = cloneReport(ops, s)
      expect(r.joint).toBeCloseTo(1, 12)
      expect(r.original).toBeCloseTo(1, 12)
      expect(r.copy).toBeCloseTo(1, 12)
    }
  })

  it('fed |+⟩ it produces a Bell pair, whose overlap with |+⟩|+⟩ is exactly ½', () => {
    const r = cloneReport(ops, PLUS)
    expect(r.joint).toBeCloseTo(0.5, 12)
    // Each half of a Bell pair is I/2: fidelity ½ with anything.
    expect(r.original).toBeCloseTo(0.5, 12)
    expect(r.copy).toBeCloseTo(0.5, 12)
  })

  it('the linearity check rejects it on |+⟩', () => {
    const v = noCloningVerdict(ops, Math.PI / 2)
    expect(v.status).toBe('clones-basis-only')
    expect(v.f0.joint).toBeCloseTo(1, 12)
    expect(v.f1.joint).toBeCloseTo(1, 12)
    expect(v.test.joint).toBeCloseTo(0.5, 12)
    expect(v.predicted.joint).toBeCloseTo(0.5, 12)
    expect(v.linearityGap).toBeLessThan(1e-12)
    expect(v.overlapWithZero).toBeCloseTo(0.5, 12)
  })

  it('sits exactly on the (cos³ + sin³)² ceiling for every input angle', () => {
    for (const deg of [0, 30, 60, 90, 120, 150, 180]) {
      const theta = (deg * Math.PI) / 180
      const r = cloneReport(ops, blochStateAmplitudes(theta, 0))
      expect(r.joint).toBeCloseTo(perfectBasisClonerBound(theta), 12)
    }
    expect(perfectBasisClonerBound(Math.PI / 2)).toBeCloseTo(0.5, 12)
    expect(perfectBasisClonerBound(0)).toBeCloseTo(1, 12)
  })
})

describe('SWAP is a move, not a copy', () => {
  const ops = preset('swap')

  it('the "copy" is perfect but the original is destroyed', () => {
    const r = cloneReport(ops, PLUS_I)
    expect(r.copy).toBeCloseTo(1, 12)
    expect(r.original).toBeCloseTo(0.5, 12) // |⟨+i|0⟩|² = ½
    expect(r.joint).toBeCloseTo(0.5, 12)
  })

  it('fails the basis check on |1⟩', () => {
    const v = noCloningVerdict(ops, Math.PI / 2)
    expect(v.status).toBe('fails-basis')
    expect(v.f1.joint).toBeCloseTo(0, 12)
  })
})

describe('the Bužek–Hillery universal cloner', () => {
  const ops = preset('buzek-hillery')

  it('gives each copy fidelity 5/6 and the pair 2/3, for every input', () => {
    const rng = mulberry32(42)
    const inputs = [ZERO, ONE, PLUS, PLUS_I, ...Array.from({ length: 6 }, () => randomPureState(2, rng) as typeof ZERO)]
    for (const s of inputs) {
      const r = cloneReport(ops, s)
      expect(r.original).toBeCloseTo(UNIVERSAL_CLONER_FIDELITY, 9)
      expect(r.copy).toBeCloseTo(UNIVERSAL_CLONER_FIDELITY, 9)
      expect(r.joint).toBeCloseTo(2 / 3, 9)
    }
  })

  it('is symmetric: the original and the copy are equally imperfect', () => {
    const r = cloneReport(ops, blochStateAmplitudes(1.3, 2.1))
    expect(Math.abs(r.original - r.copy)).toBeLessThan(1e-9)
  })

  it('is not a perfect cloner of anything — the verdict is fails-basis', () => {
    expect(noCloningVerdict(ops, Math.PI / 2).status).toBe('fails-basis')
  })
})

describe('linearity is inescapable', () => {
  it('the superposition of the |0⟩ and |1⟩ outputs equals the direct run, gate for gate', () => {
    const rng = mulberry32(9)
    const names: GateOp['name'][] = ['H', 'X', 'Z', 'S', 'T', 'RY', 'CX', 'CZ', 'SWAP', 'CCX']
    for (let trial = 0; trial < 20; trial++) {
      const ops: GateOp[] = []
      for (let g = 0; g < 6; g++) {
        const name = names[Math.floor(rng() * names.length)]
        const arity = name === 'CCX' ? 3 : name === 'CX' || name === 'CZ' || name === 'SWAP' ? 2 : 1
        const qubits = [0, 1, 2].sort(() => rng() - 0.5).slice(0, arity)
        ops.push({ name, qubits, theta: name === 'RY' ? rng() * Math.PI : undefined })
      }
      const theta = 0.2 + rng() * 2.7
      const phi = rng() * 2 * Math.PI
      const probe = blochStateAmplitudes(theta, phi)
      const direct = runCandidate(ops, probe)
      const predicted = linearityPrediction(ops, probe)
      for (let i = 0; i < 8; i++) {
        expect(predicted.amplitude(i).re).toBeCloseTo(direct.amplitude(i).re, 12)
        expect(predicted.amplitude(i).im).toBeCloseTo(direct.amplitude(i).im, 12)
      }
      // No unitary passes all three; the checker must never say otherwise.
      expect(noCloningVerdict(ops, theta, phi).status).not.toBe('passes-all')
    }
  })

  it('never reports passes-all for any preset at any probe angle', () => {
    for (const p of CANDIDATE_PRESETS) {
      for (let deg = 10; deg < 180; deg += 10) {
        expect(noCloningVerdict(p.ops, (deg * Math.PI) / 180).status).not.toBe('passes-all')
      }
    }
  })

  it('an empty circuit leaves the blank qubit blank', () => {
    const r = cloneReport([], PLUS)
    expect(r.original).toBeCloseTo(1, 12)
    expect(r.copy).toBeCloseTo(0.5, 12)
  })
})
