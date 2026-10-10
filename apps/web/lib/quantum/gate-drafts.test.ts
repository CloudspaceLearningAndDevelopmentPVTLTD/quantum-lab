import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BLOCK_DRAFT,
  DEFAULT_MATRIX_DRAFT,
  blockDraftProblem,
  effectiveArity,
  minWidthFor,
  pendingHint,
  resolveMatrixDraft,
} from './gate-drafts'

const drafts = { mcxControls: 3, matrix: DEFAULT_MATRIX_DRAFT, block: DEFAULT_BLOCK_DRAFT }

describe('matrix draft', () => {
  it('the default draft is a unitary H', () => {
    const v = resolveMatrixDraft(DEFAULT_MATRIX_DRAFT)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.matrix[0].re).toBeCloseTo(Math.SQRT1_2, 12)
      expect(v.matrix[3].re).toBeCloseTo(-Math.SQRT1_2, 12)
      expect(v.error).toBeLessThan(1e-12)
    }
  })

  it('names the bad entry, and refuses a non-unitary matrix with its error', () => {
    const bad = resolveMatrixDraft({ qubits: 1, entries: ['1', 'x', '0', '1'], label: 'U' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toMatch(/row 1, column 2/)
    const shear = resolveMatrixDraft({ qubits: 1, entries: ['1', '1', '0', '1'], label: 'U' })
    expect(shear.ok).toBe(false)
    if (!shear.ok) expect(shear.message).toMatch(/Not unitary: ‖U†U − I‖ = 1\.00/)
    const wrongSize = resolveMatrixDraft({ qubits: 2, entries: ['1', '0', '0', '1'], label: 'U' })
    expect(wrongSize.ok).toBe(false)
  })
})

describe('block draft', () => {
  it('minWidthFor is ⌈log₂ N⌉ with a floor of 1', () => {
    expect(minWidthFor(15)).toBe(4)
    expect(minWidthFor(16)).toBe(4)
    expect(minWidthFor(17)).toBe(5)
    expect(minWidthFor(2)).toBe(1)
    expect(minWidthFor(1)).toBe(1)
  })

  it('accepts +7 mod 15 on 4 of 5 qubits and rejects what cannot be placed', () => {
    expect(blockDraftProblem('ADDK', DEFAULT_BLOCK_DRAFT, 5)).toBeNull()
    expect(blockDraftProblem('ADDK', { ...DEFAULT_BLOCK_DRAFT, controlled: true }, 4)).toMatch(/needs 5 qubits/)
    expect(blockDraftProblem('ADDK', { ...DEFAULT_BLOCK_DRAFT, modulus: 17 }, 8)).toMatch(/does not fit/)
    expect(blockDraftProblem('MULK', { ...DEFAULT_BLOCK_DRAFT, k: 6 }, 5)).toMatch(/gcd\(6, 15\) = 3/)
    expect(blockDraftProblem('MULK', DEFAULT_BLOCK_DRAFT, 5)).toBeNull()
    expect(blockDraftProblem('ADDK', { ...DEFAULT_BLOCK_DRAFT, k: 1.5 }, 5)).toMatch(/whole number/)
    expect(blockDraftProblem('ADDK', { ...DEFAULT_BLOCK_DRAFT, modulus: NaN }, 5)).toMatch(/positive whole/)
    expect(blockDraftProblem('QFT', { ...DEFAULT_BLOCK_DRAFT, width: 11 }, 16)).toMatch(/limited to 10/)
    // QFT ignores k and N entirely.
    expect(blockDraftProblem('QFT', { ...DEFAULT_BLOCK_DRAFT, k: 6, modulus: 99, width: 3 }, 3)).toBeNull()
  })
})

describe('placement gesture', () => {
  it('effectiveArity follows the drafts', () => {
    expect(effectiveArity('MCX', drafts)).toBe(4)
    expect(effectiveArity('UNITARY', drafts)).toBe(1)
    expect(effectiveArity('UNITARY', { ...drafts, matrix: { ...DEFAULT_MATRIX_DRAFT, qubits: 2 } })).toBe(2)
    expect(effectiveArity('ADDK', drafts)).toBe(4)
    expect(effectiveArity('IQFT', { ...drafts, block: { ...DEFAULT_BLOCK_DRAFT, controlled: true } })).toBe(5)
    expect(effectiveArity('BARRIER', drafts)).toBe(0)
    expect(effectiveArity('CX', drafts)).toBe(-1)
  })

  it('pendingHint walks controls, then target / register bits, least significant first', () => {
    expect(pendingHint('MCX', 0, drafts)).toBe('Pick control 1 of 3')
    expect(pendingHint('MCX', 2, drafts)).toBe('Pick control 3 of 3')
    expect(pendingHint('MCX', 3, drafts)).toBe('Pick the target qubit')
    expect(pendingHint('ADDK', 0, drafts)).toMatch(/register bit 0 \(least significant\) of 4/)
    const controlled = { ...drafts, block: { ...DEFAULT_BLOCK_DRAFT, controlled: true } }
    expect(pendingHint('MULK', 0, controlled)).toBe('Pick the control qubit')
    expect(pendingHint('MULK', 1, controlled)).toMatch(/register bit 0/)
    expect(pendingHint('MULK', 2, controlled)).toMatch(/register bit 1 of 4/)
    expect(pendingHint('CSWAP', 1, drafts)).toBe('Pick the first qubit to swap')
    expect(pendingHint('UNITARY', 1, drafts)).toMatch(/second qubit/)
  })
})
