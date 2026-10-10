import { describe, expect, it } from 'vitest'
import type { Circuit } from '@/lib/quantum'
import { insertOpAt, moveOp, removeOpAt, retargetOp } from './circuitEdit'

function baseCircuit(): Circuit {
  return {
    numQubits: 3,
    ops: [
      { name: 'H', qubits: [0] },
      { name: 'X', qubits: [1] },
      { name: 'CX', qubits: [0, 1] },
      { name: 'Z', qubits: [2] },
    ],
  }
}

describe('moveOp', () => {
  it('moves an op earlier', () => {
    const c = baseCircuit()
    const next = moveOp(c, 2, 0)
    expect(next.ops.map((o) => o.name)).toEqual(['CX', 'H', 'X', 'Z'])
    // original untouched
    expect(c.ops.map((o) => o.name)).toEqual(['H', 'X', 'CX', 'Z'])
  })

  it('moves an op later', () => {
    const c = baseCircuit()
    const next = moveOp(c, 0, 2)
    expect(next.ops.map((o) => o.name)).toEqual(['X', 'CX', 'H', 'Z'])
  })

  it('moving to the same position is a no-op', () => {
    const c = baseCircuit()
    const next = moveOp(c, 1, 1)
    expect(next.ops.map((o) => o.name)).toEqual(['H', 'X', 'CX', 'Z'])
    expect(next).not.toBe(c) // still a new Circuit value
  })

  it('throws on an out-of-range fromIndex', () => {
    const c = baseCircuit()
    expect(() => moveOp(c, 10, 0)).toThrow(/out of range/)
    expect(() => moveOp(c, -1, 0)).toThrow(/out of range/)
  })

  it('throws on an out-of-range toIndex', () => {
    const c = baseCircuit()
    expect(() => moveOp(c, 0, 10)).toThrow(/out of range/)
  })
})

describe('retargetOp', () => {
  it("retargets a CX's control", () => {
    const c = baseCircuit()
    const next = retargetOp(c, 2, [2, 1])
    expect(next.ops[2].qubits).toEqual([2, 1])
  })

  it("retargets a CX's target", () => {
    const c = baseCircuit()
    const next = retargetOp(c, 2, [0, 2])
    expect(next.ops[2].qubits).toEqual([0, 2])
  })

  it('throws when retargeting to overlapping qubits', () => {
    const c = baseCircuit()
    expect(() => retargetOp(c, 2, [1, 1])).toThrow(/distinct/)
  })

  it('throws when retargeting to a qubit index the circuit does not have', () => {
    const c = baseCircuit()
    expect(() => retargetOp(c, 0, [5])).toThrow(/out of range/)
    expect(() => retargetOp(c, 2, [0, 5])).toThrow(/out of range/)
  })

  it('throws on an out-of-range op index', () => {
    const c = baseCircuit()
    expect(() => retargetOp(c, 99, [0])).toThrow(/out of range/)
  })

  it('throws when the arity would change for a fixed-arity gate', () => {
    const c = baseCircuit()
    expect(() => retargetOp(c, 0, [0, 1])).toThrow(/needs exactly/)
  })

  it('accepts a variadic gate with more than its minimum arity', () => {
    const c: Circuit = {
      numQubits: 3,
      ops: [{ name: 'MCX', qubits: [0, 1, 2] }],
    }
    const next = retargetOp(c, 0, [0, 1, 2])
    expect(next.ops[0].qubits).toEqual([0, 1, 2])
  })
})

describe('insertOpAt', () => {
  it('splices a new op in at the given index', () => {
    const c = baseCircuit()
    const next = insertOpAt(c, 1, { name: 'Y', qubits: [2] })
    expect(next.ops.map((o) => o.name)).toEqual(['H', 'Y', 'X', 'CX', 'Z'])
  })

  it('appends when index equals ops.length', () => {
    const c = baseCircuit()
    const next = insertOpAt(c, c.ops.length, { name: 'Y', qubits: [2] })
    expect(next.ops.map((o) => o.name)).toEqual(['H', 'X', 'CX', 'Z', 'Y'])
  })

  it('throws on an out-of-range index', () => {
    const c = baseCircuit()
    expect(() => insertOpAt(c, -1, { name: 'Y', qubits: [2] })).toThrow(/out of range/)
    expect(() => insertOpAt(c, c.ops.length + 1, { name: 'Y', qubits: [2] })).toThrow(/out of range/)
  })
})

describe('removeOpAt', () => {
  it('removes the op at the given index', () => {
    const c = baseCircuit()
    const next = removeOpAt(c, 1)
    expect(next.ops.map((o) => o.name)).toEqual(['H', 'CX', 'Z'])
  })

  it('throws on an out-of-range index', () => {
    const c = baseCircuit()
    expect(() => removeOpAt(c, 10)).toThrow(/out of range/)
  })
})
