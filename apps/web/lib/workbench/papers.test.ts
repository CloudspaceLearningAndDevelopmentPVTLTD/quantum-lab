import { describe, it, expect } from 'vitest'
import { PAPERS } from './papers'

describe('PAPERS catalogue', () => {
  it('has unique ids and hrefs implied by id', () => {
    const ids = PAPERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a non-empty venue and claim, and a plausible year', () => {
    for (const p of PAPERS) {
      expect(p.venue.length).toBeGreaterThan(5)
      expect(p.claim.length).toBeGreaterThan(10)
      expect(p.historicalResult.length).toBeGreaterThan(10)
      // 1969, not 1980: chsh-1969 (Clauser, Horne, Shimony & Holt) is a real,
      // correctly-cited landmark that predates the original bound — the bound
      // exists to catch a typo'd year, not to exclude genuinely early physics.
      expect(p.year).toBeGreaterThanOrEqual(1960)
      expect(p.year).toBeLessThanOrEqual(2026)
      expect(p.qubits).toBeGreaterThanOrEqual(1)
    }
  })

  it('only post-1991 entries may carry an arXiv id (arXiv opened in 1991)', () => {
    for (const p of PAPERS) {
      if (p.arxivId) expect(p.year).toBeGreaterThanOrEqual(1991)
    }
  })

  it('every paper reproduces a result consistent with its historical claim', () => {
    for (const p of PAPERS) {
      const result = p.run(12345)
      expect(result.consistent, `${p.id}: ${result.summary}`).toBe(true)
      expect(result.details.length).toBeGreaterThan(0)
      expect(result.summary.length).toBeGreaterThan(5)
    }
  })

  it('is deterministic for a fixed seed', () => {
    for (const p of PAPERS) {
      const a = p.run(7)
      const b = p.run(7)
      expect(a.summary).toBe(b.summary)
      expect(a.details).toEqual(b.details)
    }
  })

  describe('teleportation-1993', () => {
    it('reproduces perfect fidelity across many random measurement outcomes', () => {
      const paper = PAPERS.find((p) => p.id === 'teleportation-1993')!
      const r1 = paper.run(1)
      const r2 = paper.run(999)
      expect(r1.consistent).toBe(true)
      expect(r2.consistent).toBe(true)
    })
  })

  describe('grover-1996', () => {
    it('amplifies the marked state from 25% to ~100% in one iteration on 2 qubits', () => {
      const paper = PAPERS.find((p) => p.id === 'grover-1996')!
      const r = paper.run(1)
      const pct = Number(r.details.find((d) => d.label === 'Marked-state probability')!.value.replace('%', ''))
      expect(pct).toBeGreaterThan(99)
    })
  })

  describe('ghz-1989', () => {
    it('reproduces the actual GHZ paradox: XXX=+1 deterministically while local realism (from XYY/YXY/YYX) predicts -1', () => {
      const paper = PAPERS.find((p) => p.id === 'ghz-1989')!
      const r = paper.run(1)
      expect(r.consistent).toBe(true)
      const val = (label: string) => Number(r.details.find((d) => d.label === label)!.value)
      expect(val('⟨XXX⟩')).toBeCloseTo(1, 3)
      expect(val('⟨XYY⟩')).toBeCloseTo(-1, 3)
      expect(val('⟨YXY⟩')).toBeCloseTo(-1, 3)
      expect(val('⟨YYX⟩')).toBeCloseTo(-1, 3)
    })

    it('is deterministic across different seeds/runs (run() ignores its seed here, correctly — the circuit has no randomness)', () => {
      const paper = PAPERS.find((p) => p.id === 'ghz-1989')!
      expect(paper.run(1).summary).toBe(paper.run(2).summary)
    })
  })

  describe('bb84-1984', () => {
    it('shows a near-zero QBER with no eavesdropper and ~25% with full interception', () => {
      const paper = PAPERS.find((p) => p.id === 'bb84-1984')!
      const r = paper.run(42)
      expect(r.consistent).toBe(true)
    })
  })

  describe('ekert-1991', () => {
    it('violates the classical CHSH bound with no eavesdropper, and is within sampling error of the Tsirelson bound', () => {
      const paper = PAPERS.find((p) => p.id === 'ekert-1991')!
      const r = paper.run(42)
      expect(r.consistent).toBe(true)
      const noEveEntry = r.details.find((d) => d.label === '|S|, no Eve')!.value
      const [sNoEve, seNoEve] = noEveEntry.split('±').map((s) => Number(s.trim()))
      expect(sNoEve).toBeGreaterThan(2)
      // A Monte Carlo estimate of a quantity sitting exactly AT its own upper
      // bound (the ideal singlet's true |S| = 2√2) reads above that bound
      // about half the time by construction -- so the right test is "within a
      // few standard errors of theory", not "never exceeds the printed bound".
      // toBeLessThanOrEqual(bound + fixed margin) was the bug this test used
      // to have: it failed for the production seed (20260905) even though
      // that reading (2.882) was only 0.7 sigma from theory.
      const zScore = Math.abs(sNoEve - 2 * Math.SQRT2) / seNoEve
      expect(zScore).toBeLessThanOrEqual(3)
    })

    it('is consistent for the actual seed the production page uses', () => {
      const paper = PAPERS.find((p) => p.id === 'ekert-1991')!
      const r = paper.run(20260905)
      expect(r.consistent).toBe(true)
    })
  })

  describe('deutsch-jozsa-1992', () => {
    it('gives a constant oracle P(all-zero)=1 and a balanced oracle P(all-zero)=0, after one query each', () => {
      const paper = PAPERS.find((p) => p.id === 'deutsch-jozsa-1992')!
      const r = paper.run(1)
      expect(r.consistent).toBe(true)
      const val = (label: string) => Number(r.details.find((d) => d.label === label)!.value.replace('%', ''))
      expect(val('P(|0…0⟩), constant f')).toBeCloseTo(100, 3)
      expect(val('P(|0…0⟩), balanced f')).toBeCloseTo(0, 3)
    })
  })

  describe('chsh-1969', () => {
    it('reaches exactly Tsirelson\'s bound 2√2 at the optimal settings, above the classical bound of 2', () => {
      const paper = PAPERS.find((p) => p.id === 'chsh-1969')!
      const r = paper.run(1)
      expect(r.consistent).toBe(true)
      const sAbs = Number(r.details.find((d) => d.label === '|S|, quantum prediction')!.value)
      expect(sAbs).toBeCloseTo(2 * Math.SQRT2, 6)
      expect(sAbs).toBeGreaterThan(2)
    })
  })

  describe('kitaev-1995', () => {
    it('reads out φ = 1/4 exactly with 3 counting qubits, probability 1', () => {
      const paper = PAPERS.find((p) => p.id === 'kitaev-1995')!
      const r = paper.run(1)
      expect(r.consistent).toBe(true)
      const readPhi = Number(r.details.find((d) => d.label === 'Measured φ (y / 2^t)')!.value)
      expect(readPhi).toBeCloseTo(0.25, 9)
    })
  })

  describe('shor-1994', () => {
    it('recovers the true order of 7 mod 15 and factors 15 = 3 × 5, within its shot budget', () => {
      const paper = PAPERS.find((p) => p.id === 'shor-1994')!
      const r = paper.run(1)
      expect(r.consistent).toBe(true)
      expect(r.details.find((d) => d.label === 'True order of a mod N')!.value).toBe('4')
      expect(r.details.find((d) => d.label === 'Recovered period')!.value).toBe('4')
      expect(r.details.find((d) => d.label === 'Factors found')!.value).toBe('3 × 5')
    })

    it('is consistent for the actual seed the production page uses', () => {
      const paper = PAPERS.find((p) => p.id === 'shor-1994')!
      const r = paper.run(20260905)
      expect(r.consistent).toBe(true)
    })
  })

  describe('surface-code-2002', () => {
    it('corrects every weight-3 test pattern on a distance-7 code, and flags a weight-7 logical-shaped error as an undetected logical error', () => {
      const paper = PAPERS.find((p) => p.id === 'surface-code-2002')!
      const r = paper.run(1)
      expect(r.consistent).toBe(true)
      expect(r.details.find((d) => d.label === 'Weight-3 patterns corrected')!.value).toBe('5/5')
    })

    it('ignores its seed — the reproduction is deterministic hand-placed errors, not sampling', () => {
      const paper = PAPERS.find((p) => p.id === 'surface-code-2002')!
      expect(paper.run(1).summary).toBe(paper.run(999).summary)
    })
  })

  describe('qubit-tomography-2001', () => {
    it('recovers a physical (positive semi-definite, trace-1) density matrix with high fidelity from a naive reconstruction that comes out unphysical', () => {
      const paper = PAPERS.find((p) => p.id === 'qubit-tomography-2001')!
      const r = paper.run(12345)
      expect(r.consistent).toBe(true)
      const rawMinEig = Number(r.details.find((d) => d.label === 'Naive reconstruction smallest eigenvalue')!.value)
      // The whole point of this entry is that 180 shots of Bell-state noise
      // reliably makes the naive linear-inversion estimate unphysical — if
      // this ever reads non-negative the entry stops demonstrating anything.
      expect(rawMinEig).toBeLessThan(0)
      expect(r.details.find((d) => d.label === 'Constrained fit is physical?')!.value).toBe('Yes')
    })

    it('is consistent for the actual seed the production page uses', () => {
      const paper = PAPERS.find((p) => p.id === 'qubit-tomography-2001')!
      const r = paper.run(20260905)
      expect(r.consistent).toBe(true)
    })
  })

  describe('surface-code-below-threshold-2024', () => {
    it('shows strictly decreasing logical failure rate as code distance increases, at a fixed below-threshold physical error rate', () => {
      const paper = PAPERS.find((p) => p.id === 'surface-code-below-threshold-2024')!
      const r = paper.run(12345)
      expect(r.consistent).toBe(true)
      const rate = (label: string) => Number(r.details.find((d) => d.label === label)!.value.replace('%', ''))
      const r3 = rate('Logical failure rate, d=3')
      const r5 = rate('Logical failure rate, d=5')
      const r7 = rate('Logical failure rate, d=7')
      expect(r3).toBeGreaterThan(r5)
      expect(r5).toBeGreaterThan(r7)
    })

    it('is consistent for the actual seed the production page uses', () => {
      const paper = PAPERS.find((p) => p.id === 'surface-code-below-threshold-2024')!
      const r = paper.run(20260905)
      expect(r.consistent).toBe(true)
    })
  })
})
