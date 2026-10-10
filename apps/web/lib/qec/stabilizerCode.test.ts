import { describe, expect, it } from 'vitest'
import { CODE_PRESETS, analyseCode, commutes, parsePauli, syndromeOf, weight } from './stabilizerCode'

describe('analyseCode on codes with known parameters', () => {
  for (const preset of CODE_PRESETS) {
    const [n, k, d] = preset.params
    it(`${preset.name} is [[${n},${k},${d}]]`, () => {
      const a = analyseCode(preset.generators)
      expect([a.n, a.k]).toEqual([n, k])
      expect(a.distance).toMatchObject({ exact: true, lower: d, upper: d })
      expect(a.logicals).toHaveLength(k)
    })
  }

  it('returns logical operators that really are logical', () => {
    for (const preset of CODE_PRESETS) {
      const a = analyseCode(preset.generators)
      const gens = preset.generators.map((g) => parsePauli(g).pauli)
      const ops = a.logicals.flatMap((l) => [parsePauli(l.x).pauli, parsePauli(l.z).pauli])
      // Each commutes with every stabilizer…
      for (const op of ops) for (const g of gens) expect(commutes(op, g)).toBe(true)
      // …and the pairs have the Pauli algebra: X_i anticommutes with Z_i only.
      a.logicals.forEach((li, i) => {
        a.logicals.forEach((lj, j) => {
          expect(commutes(parsePauli(li.x).pauli, parsePauli(lj.z).pauli)).toBe(i !== j)
          expect(commutes(parsePauli(li.x).pauli, parsePauli(lj.x).pauli)).toBe(true)
          expect(commutes(parsePauli(li.z).pauli, parsePauli(lj.z).pauli)).toBe(true)
        })
      })
      // The distance witness is a logical operator of the claimed weight.
      const witness = parsePauli(a.distance!.witness).pauli
      expect(weight(witness)).toBe(a.distance!.upper)
      for (const g of gens) expect(commutes(witness, g)).toBe(true)
    }
  })

  it('knows which codes are CSS and which are degenerate', () => {
    const by = (id: string) => analyseCode(CODE_PRESETS.find((p) => p.id === id)!.generators)
    expect(by('five-qubit').css).toBe(false)
    expect(by('steane').css).toBe(true)
    expect(by('five-qubit').degenerate).toBe(false)
    expect(by('steane').degenerate).toBe(false)
    expect(by('shor').degenerate).toBe(true)
    expect(by('shor').minStabilizerWeight).toBe(2)
  })

  it('counts the toric code’s two redundant checks', () => {
    const a = analyseCode(CODE_PRESETS.find((p) => p.id === 'toric-3')!.generators)
    expect(a.rank).toBe(16)
    expect(a.redundant).toHaveLength(2)
  })
})

describe('analyseCode edge cases', () => {
  it('a full stabilizer state has k = 0 and no distance', () => {
    const a = analyseCode(['XX', 'ZZ'])
    expect(a.k).toBe(0)
    expect(a.distance).toBeNull()
    expect(a.logicals).toEqual([])
  })

  it('names anticommuting generators', () => {
    expect(() => analyseCode(['XI', 'ZI'])).toThrow(/Generators 1 and 2 anticommute/)
  })

  it('rejects a group containing −I', () => {
    expect(() => analyseCode(['XX', 'ZZ', 'YY'])).toThrow(/−I/)
    // −YY is the product of XX and ZZ, so this one is merely redundant.
    expect(analyseCode(['XX', 'ZZ', '-YY']).redundant).toEqual([2])
  })

  it('rejects ragged or malformed input', () => {
    expect(() => analyseCode(['XXX', 'ZZ'])).toThrow(/Generator 2 acts on 2 qubits/)
    expect(() => analyseCode(['XQX'])).toThrow(/not a Pauli/)
    expect(() => analyseCode([' ', ''])).toThrow(/at least one/)
  })

  it('reports a bracket, not a guess, when the budget runs out', () => {
    const steane = CODE_PRESETS.find((p) => p.id === 'steane')!.generators
    const a = analyseCode(steane, { distanceBudget: 30 })
    // 21 weight-1 Paulis fit in the budget; the 189 of weight 2 do not.
    expect(a.distance).toMatchObject({ exact: false, lower: 2, upper: 3 })
    expect(a.degenerate).toBeNull()
  })

  it('accepts signs, underscores and lower case', () => {
    expect(analyseCode(['+xzzx_', '-_xzzx', 'x_xzz', 'zx_xz']).k).toBe(1)
  })
})

describe('syndromeOf', () => {
  it('gives every single-qubit error on the five-qubit code its own syndrome', () => {
    const gens = CODE_PRESETS.find((p) => p.id === 'five-qubit')!.generators
    const seen = new Set<string>()
    for (let q = 0; q < 5; q++) {
      for (const p of ['X', 'Y', 'Z']) {
        const error = 'IIIII'.slice(0, q) + p + 'IIIII'.slice(q + 1)
        seen.add(syndromeOf(gens, error))
      }
    }
    // 15 errors, 15 distinct non-zero syndromes out of 2^4 − 1: the code is perfect.
    expect(seen.size).toBe(15)
    expect(seen.has('0000')).toBe(false)
  })
})
