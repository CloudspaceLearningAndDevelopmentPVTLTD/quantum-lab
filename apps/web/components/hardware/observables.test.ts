/**
 * Tests for the local echo of the server's observable rules.
 *
 * The bar every test here is held to: it names the specific wrong submission it
 * would catch. "validates correctly" would tell a future editor nothing about
 * what broke.
 *
 * The one thing these tests CANNOT prove is agreement with the server. They
 * assert the messages and limits this module was written to mirror from
 * services/api/app/quantum/observables.py; if that file's rules change, these
 * tests keep passing while the editor starts lying. The MAX_* constants are
 * therefore asserted against their literal values, so a drift in either
 * direction is at least visible as a two-file diff.
 *
 * THIS FILE DOES NOT RUN YET. `vitest.config.ts` includes only
 * `lib/**\/*.test.ts` and `components/viz/**\/*.test.ts`, and that config's own
 * comment warns about this trap: "without this pattern their test files exist
 * and never run". `npx vitest run components/hardware/observables.test.ts`
 * answers "No test files found" today. Either add
 * `components/hardware/**\/*.test.ts` to that include list, or move
 * `observables.ts` and this file to `lib/hardware/`, where the rest of the
 * page's pure logic already lives. Until one of those happens every assertion
 * below is decoration.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_OBSERVABLES,
  MAX_TERMS_PER_OBSERVABLE,
  MAX_LABEL_CHARS,
  OBSERVABLE_PRESETS,
  coefficientValue,
  draftId,
  emptyObservable,
  hasMeasurements,
  identityPauli,
  labelQueryString,
  pauliOnQubits,
  presetsForWidth,
  refitToWidth,
  stripMeasurements,
  validateObservables,
  validateTerm,
  type ObservableDraft,
} from './observables'

/** A draft built inline, so a test reads as the thing it is testing. */
function draft(label: string, terms: Array<[string, string]>): ObservableDraft {
  return {
    id: draftId('t-obs'),
    label,
    terms: terms.map(([pauli, coefficient]) => ({ id: draftId('t-term'), pauli, coefficient })),
  }
}

describe('limits mirror the Python module', () => {
  it('holds the literal caps from services/api/app/quantum/observables.py, so a server-side change shows up as a failing test rather than as a 400 the user sees first', () => {
    expect(MAX_OBSERVABLES).toBe(32)
    expect(MAX_TERMS_PER_OBSERVABLE).toBe(512)
    expect(MAX_LABEL_CHARS).toBe(64)
  })
})

describe('validateTerm', () => {
  it('rejects a Pauli string shorter than the circuit and says to pad with I — the failure this whole module exists for, because "ZZ" on a 5-qubit circuit is the single most common Estimator mistake', () => {
    const issue = validateTerm({ id: 'x', pauli: 'ZZ', coefficient: '1' }, 5)
    expect(issue.pauli).toContain('pad with I')
    expect(issue.pauli).toContain('5 qubits')
  })

  it('rejects a Pauli string LONGER than the circuit too, which would otherwise be submitted and measure a qubit the circuit does not have', () => {
    const issue = validateTerm({ id: 'x', pauli: 'ZZZ', coefficient: '1' }, 2)
    expect(issue.pauli).toContain('pad with I')
  })

  it('names the offending characters rather than saying "invalid", so a stray digit in a 12-character string does not have to be hunted', () => {
    const issue = validateTerm({ id: 'x', pauli: 'Z0Z', coefficient: '1' }, 3)
    expect(issue.pauli).toContain("'0'")
  })

  it('accepts lower case and upper-cases it, matching the server, which also accepts "zz"', () => {
    expect(validateTerm({ id: 'x', pauli: 'zz', coefficient: '1' }, 2).pauli).toBeNull()
    const result = validateObservables([draft('ZZ', [['zz', '1']])], 2)
    expect(result.payload?.[0]?.terms[0]?.pauli).toBe('ZZ')
  })

  it('rejects Infinity and NaN spelled out, which survive JSON in some encoders and would poison the expectation value with no error anywhere', () => {
    expect(validateTerm({ id: 'x', pauli: 'Z', coefficient: 'Infinity' }, 1).coefficient).not.toBeNull()
    expect(validateTerm({ id: 'x', pauli: 'Z', coefficient: 'NaN' }, 1).coefficient).not.toBeNull()
  })

  it('rejects hex, which Number() would silently accept as 31 — a coefficient nobody typed', () => {
    expect(validateTerm({ id: 'x', pauli: 'Z', coefficient: '0x1f' }, 1).coefficient).not.toBeNull()
  })

  it('accepts scientific notation and a leading sign, because a Hamiltonian coefficient is routinely -2.5e-3', () => {
    expect(validateTerm({ id: 'x', pauli: 'Z', coefficient: '-2.5e-3' }, 1).coefficient).toBeNull()
    expect(coefficientValue('-2.5e-3')).toBeCloseTo(-0.0025)
  })

  it('rejects a well-formed decimal that OVERFLOWS to infinity — "1e400" passes the syntax regex, becomes Infinity, and JSON.stringify writes it as null, so the server answers "coefficient must be a real number" about a box the user can see a number in', () => {
    const issue = validateTerm({ id: 'x', pauli: 'Z', coefficient: '1e400' }, 1)
    expect(issue.coefficient).not.toBeNull()
    expect(issue.coefficient).toContain('infinity')
    // And the shape that would have been sent: JSON turns Infinity into null.
    expect(JSON.stringify({ c: coefficientValue('1e400') })).toBe('{"c":null}')
  })

  it('treats a blank coefficient as 1, not as 0 — the server defaults the field to 1.0, and a silent 0 would delete a term the user believes is there', () => {
    expect(validateTerm({ id: 'x', pauli: 'Z', coefficient: '' }, 1).coefficient).toBeNull()
    expect(coefficientValue('   ')).toBe(1)
  })
})

describe('validateObservables', () => {
  it('emits exactly the wire shape POST /api/hardware/submit documents, so a renamed field cannot reach the API as undefined', () => {
    const result = validateObservables([draft('ZZ', [['ZZ', '1.0']])], 2)
    expect(result.ok).toBe(true)
    expect(result.payload).toEqual([{ label: 'ZZ', terms: [{ pauli: 'ZZ', coefficient: 1 }] }])
  })

  it('refuses duplicate labels, which would make two results indistinguishable in exactly the way labels exist to prevent', () => {
    const result = validateObservables([draft('E', [['ZZ', '1']]), draft('E', [['XX', '1']])], 2)
    expect(result.ok).toBe(false)
    expect(result.issues[1]?.label).toContain('Duplicate')
    // The FIRST one is innocent; flagging both would send the user editing the
    // wrong row.
    expect(result.issues[0]?.label).toBeNull()
  })

  it('refuses a blank label, because the vendor stores the operator but not our name for it and the value comes back anonymous', () => {
    const result = validateObservables([draft('  ', [['ZZ', '1']])], 2)
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.label).toContain('name')
  })

  it('refuses more than MAX_OBSERVABLES, so a bulk paste is a local message instead of a 400 after a round trip and a Qiskit parse', () => {
    const many = Array.from({ length: MAX_OBSERVABLES + 1 }, (_, i) =>
      draft(`Z${i}`, [['ZZ', '1']]),
    )
    const result = validateObservables(many, 2)
    expect(result.ok).toBe(false)
    expect(result.formError).toContain('32')
  })

  it('refuses more than MAX_TERMS_PER_OBSERVABLE within one observable', () => {
    const huge = draft(
      'H',
      Array.from({ length: MAX_TERMS_PER_OBSERVABLE + 1 }, () => ['ZZ', '1'] as [string, string]),
    )
    const result = validateObservables([huge], 2)
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.form).toContain('512')
  })

  it('truncates an over-long label to 64 characters rather than refusing it, because that is what the server does and an editor that refuses what the server accepts is a worse liar than one that is merely strict', () => {
    const long = 'x'.repeat(MAX_LABEL_CHARS + 20)
    const result = validateObservables([draft(long, [['Z', '1']])], 1)
    expect(result.ok).toBe(true)
    expect(result.payload?.[0]?.label).toHaveLength(MAX_LABEL_CHARS)
  })

  it('returns no payload — but no error either — for an empty list, because "no observables" means sample instead of estimate and is a legitimate choice, not a mistake to shout about', () => {
    const result = validateObservables([], 2)
    expect(result.ok).toBe(false)
    expect(result.payload).toBeNull()
    expect(result.formError).toBeNull()
  })

  it('says the width is unknown once instead of tagging every term, when the circuit has not been analysed yet', () => {
    const result = validateObservables([draft('ZZ', [['ZZ', '1']])], 0)
    expect(result.formError).toContain('width is unknown')
    expect(result.issues[0]?.terms[0]?.pauli).toBeNull()
  })

  it('warns, without refusing, about an all-identity term whose expectation value is always exactly 1 no matter what the circuit does', () => {
    const result = validateObservables([draft('one', [['II', '1']])], 2)
    expect(result.ok).toBe(true)
    expect(result.issues[0]?.warnings.join(' ')).toContain('identity')
  })

  it('warns, without refusing, about a repeated Pauli in one sum — legal (the coefficients add) but nearly always an un-edited copy', () => {
    const result = validateObservables(
      [draft('H', [['ZZ', '1'], ['ZZ', '0.5']])],
      2,
    )
    expect(result.ok).toBe(true)
    expect(result.issues[0]?.warnings.join(' ')).toContain('more than once')
  })

  it('never repeats a warning string, because the component keys the rendered warnings on their text and two identical keys make React drop one child with a console error', () => {
    const result = validateObservables([draft('two-identities', [['II', '1'], ['II', '1']])], 2)
    expect(result.ok).toBe(true)
    const warnings = result.issues[0]?.warnings ?? []
    expect(new Set(warnings).size).toBe(warnings.length)
    // Both distinct warnings are still present — deduplication must not swallow
    // the second, different one.
    expect(warnings.join(' ')).toContain('identity')
    expect(warnings.join(' ')).toContain('more than once')
  })

  it('warns that a coefficient which UNDERFLOWS to exactly 0 contributes nothing, because the box still shows the number that was typed while the term has quietly left the sum', () => {
    const result = validateObservables([draft('tiny', [['ZZ', '1e-400']])], 2)
    expect(result.ok).toBe(true)
    expect(result.issues[0]?.warnings.join(' ')).toContain('contributes nothing')
  })

  it('does not cry underflow over a coefficient that is deliberately zero', () => {
    const result = validateObservables([draft('zero', [['ZZ', '0']])], 2)
    expect(result.issues[0]?.warnings.join(' ')).not.toContain('contributes nothing')
  })

  it('keeps issues index-aligned with the drafts, so the component can bind each message to its own input with aria-describedby', () => {
    const result = validateObservables(
      [draft('good', [['ZZ', '1']]), draft('bad', [['Q', '1']])],
      2,
    )
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0]?.terms).toHaveLength(1)
    expect(result.issues[1]?.terms[0]?.pauli).not.toBeNull()
  })
})

describe('qubit ordering', () => {
  it('puts qubit 0 RIGHTMOST, matching Qiskit — the reverse convention would measure the wrong qubit and return a perfectly plausible number', () => {
    expect(pauliOnQubits(3, { 0: 'Z' })).toBe('IIZ')
    expect(pauliOnQubits(3, { 2: 'X' })).toBe('XII')
    expect(pauliOnQubits(2, { 0: 'Z', 1: 'Z' })).toBe('ZZ')
  })

  it('pads a widened string on the LEFT, since padding on the right would renumber every qubit in it', () => {
    const { drafts, lostOperators } = refitToWidth([draft('Z0', [['Z', '1']])], 3)
    expect(drafts[0]?.terms[0]?.pauli).toBe('IIZ')
    expect(lostOperators).toBe(false)
  })

  it('reports when narrowing the circuit drops a non-identity operator, so the caller can warn instead of quietly measuring something else', () => {
    const wide = refitToWidth([draft('X2', [['XII', '1']])], 2)
    expect(wide.drafts[0]?.terms[0]?.pauli).toBe('II')
    expect(wide.lostOperators).toBe(true)
  })

  it('does not claim a loss when the dropped letters were identity', () => {
    const { lostOperators } = refitToWidth([draft('Z0', [['IIZ', '1']])], 1)
    expect(lostOperators).toBe(false)
  })
})

describe('presets', () => {
  it('hides the two-qubit presets on a one-qubit circuit instead of offering a string that cannot validate', () => {
    const ids = presetsForWidth(1).map((p) => p.id)
    expect(ids).toContain('single-z')
    expect(ids).not.toContain('bell-correlators')
    expect(ids).not.toContain('parity')
  })

  it('produces only submittable drafts, for every preset at every width it claims to support — the check that stops a preset from being a one-click validation error', () => {
    for (const preset of OBSERVABLE_PRESETS) {
      for (const width of [1, 2, 3, 5]) {
        if (width < preset.minQubits) continue
        const result = validateObservables(preset.build(width), width)
        expect(
          result.ok,
          `${preset.id} at ${width} qubits: ${result.formError ?? JSON.stringify(result.issues)}`,
        ).toBe(true)
      }
    }
  })

  it('caps the per-qubit Z preset at MAX_OBSERVABLES, so a 127-qubit device does not produce a list the server refuses whole', () => {
    const preset = OBSERVABLE_PRESETS.find((p) => p.id === 'single-z')
    expect(preset?.build(127)).toHaveLength(MAX_OBSERVABLES)
  })

  it('gives unique ids across two builds of the same preset, so appending one twice does not collide React keys', () => {
    const preset = OBSERVABLE_PRESETS.find((p) => p.id === 'bell-correlators')!
    const ids = [...preset.build(2), ...preset.build(2)].map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('result-reading helpers', () => {
  it('builds the comma-separated label list the job-status endpoint needs, which is the only thing that names the returned floats', () => {
    expect(labelQueryString([draft('ZZ', [['ZZ', '1']]), draft('XX', [['XX', '1']])])).toBe('ZZ,XX')
  })

  it('skips unnamed drafts rather than emitting an empty slot that would shift every later label onto the wrong value', () => {
    expect(labelQueryString([draft('ZZ', [['ZZ', '1']]), draft('  ', [['XX', '1']])])).toBe('ZZ')
  })
})

describe('measurement stripping', () => {
  /** What lib/quantum.ts::toQasm writes for every circuit the page stages. */
  const staged = [
    'OPENQASM 3.0;',
    'include "stdgates.inc";',
    'qubit[2] q;',
    'bit[2] c;',
    'h q[0];',
    'cx q[0], q[1];',
    '',
    'c = measure q;',
  ].join('\n')

  it('sees the measure-all that toQasm appends to EVERY circuit — without this the editor would tell the user the circuit is fine and the server would refuse it', () => {
    expect(hasMeasurements(staged)).toBe(true)
  })

  it('does not count the word inside a comment, which would warn about a circuit that is already clean', () => {
    expect(hasMeasurements('h q[0]; // no measure here')).toBe(false)
  })

  it('removes the trailing measure-all and leaves the gates, so an Estimator submission from the hardware page is possible at all', () => {
    const { qasm, removed, conditionalsLeft } = stripMeasurements(staged)
    expect(removed).toBe(1)
    expect(hasMeasurements(qasm)).toBe(false)
    expect(qasm).toContain('cx q[0], q[1];')
    expect(conditionalsLeft).toBe(false)
  })

  it('keeps the classical register declaration, because removing it would break the conditional lines this function refuses to touch', () => {
    expect(stripMeasurements(staged).qasm).toContain('bit[2] c;')
  })

  it('reports a surviving feed-forward conditional rather than submitting a circuit whose meaning silently changed — the gate would now read a bit nobody wrote', () => {
    const teleport = [
      'qubit[2] q;',
      'bit[2] c;',
      'c[0] = measure q[0];',
      'if (c[0] == true) { x q[1]; }',
    ].join('\n')
    const { conditionalsLeft, removed } = stripMeasurements(teleport)
    expect(removed).toBe(1)
    expect(conditionalsLeft).toBe(true)
  })

  it('reports a surviving conditional whose classical register is NOT named "c" — a circuit pasted from Qiskit calls it "meas", and matching only "if (c[" let that one through: the measure feeding it was removed, the circuit was declared clean, and a job computing something the user never wrote would have gone to a paid device', () => {
    const pasted = [
      'qubit[2] q;',
      'bit[2] meas;',
      'meas[0] = measure q[0];',
      'if (meas[0] == true) { x q[1]; }',
    ].join('\n')
    const { removed, conditionalsLeft } = stripMeasurements(pasted)
    expect(removed).toBe(1)
    expect(conditionalsLeft).toBe(true)
  })

  it('does not delete a gate that shares a line with a measure — dropping the whole line threw the "x" away too, silently editing the circuit in exactly the way the server refuses to', () => {
    const packed = 'qubit[1] q;\nbit[1] c;\nx q[0]; c[0] = measure q[0];'
    const { qasm, removed, conditionalsLeft } = stripMeasurements(packed)
    expect(qasm).toContain('x q[0];')
    // Left intact rather than half-edited, so the measure is still there and
    // the caller is told the result is not submittable.
    expect(removed).toBe(0)
    expect(conditionalsLeft).toBe(true)
  })

  it('does not treat the word "measure" inside a trailing comment as an unsafe leftover, which would have marked a clean stripped circuit unsubmittable with nothing the user could do about it', () => {
    const commented = 'qubit[1] q;\nbit[1] c;\nh q[0]; // then measure by hand\nc = measure q;'
    const { removed, conditionalsLeft } = stripMeasurements(commented)
    expect(removed).toBe(1)
    expect(conditionalsLeft).toBe(false)
  })
})

describe('new-draft helpers', () => {
  it('starts a new observable at the circuit width, so the padding rule never has to be learned the hard way', () => {
    expect(emptyObservable(4).terms[0]?.pauli).toBe('IIII')
    expect(identityPauli(4)).toBe('IIII')
  })
})
