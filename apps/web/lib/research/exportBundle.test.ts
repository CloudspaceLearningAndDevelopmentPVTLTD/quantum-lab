/**
 * exportBundle.test.ts — three properties, each of which fails silently in the
 * wild if it is not asserted here.
 *
 *  1. THE CIRCUIT SURVIVES. The whole artifact is worthless if the QASM in it
 *     is not the circuit that ran, so the emitted file is parsed BACK with the
 *     app's own parser and compared, rather than being eyeballed as a string.
 *
 *  2. THE PROVENANCE IS COMPLETE AND HONEST. Shots, backend, seed, build
 *     stamp, and "there was no run" stated rather than implied by an absent
 *     field. A bundle that quietly omits the run reads as a cited result.
 *
 *  3. THE CITATION COMPILES. A malformed .bib does not fail here — it fails in
 *     a stranger's LaTeX log with our key named in it. Braces are counted and
 *     the required fields parsed, exactly as a bibliography tool would.
 *
 * Determinism gets its own test: the module takes its timestamp as an
 * argument so that two exports of one experiment are byte-identical, and that
 * property is the reason the argument exists.
 */

import { describe, expect, it } from 'vitest'

import { fromQasm, toQasm, type Circuit, type RunResult } from '@/lib/quantum'
import {
  BUNDLE_FILES,
  bundleFilename,
  bundleToTextArchive,
  buildExportBundle,
  readTextArchive,
} from './exportBundle'

const AT = '2026-09-17T10:30:00.000Z'

const BELL: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

/** A parametrised circuit with a classical wire — the manifest's hard cases. */
const TELEPORT_ISH: Circuit = {
  numQubits: 3,
  ops: [
    { name: 'RY', qubits: [0], theta: Math.PI / 4 },
    { name: 'H', qubits: [1] },
    { name: 'CX', qubits: [1, 2] },
    { name: 'CX', qubits: [0, 1] },
    { name: 'MEASURE', qubits: [1], clbit: 0 },
    { name: 'X', qubits: [2], condition: { bit: 0, value: 1 } },
  ],
}

const RUN: RunResult = {
  // Deliberately out of sorted order: the file must not inherit the sampler's
  // insertion order (see sortedCounts).
  counts: { '11': 508, '00': 500 },
  probabilities: [0.5, 0, 0, 0.5],
  labels: ['00', '01', '10', '11'],
  shots: 1024,
  statevector: [],
}

function bundleOf(overrides: Partial<Parameters<typeof buildExportBundle>[0]> = {}) {
  return buildExportBundle({ circuit: BELL, exportedAt: AT, name: 'Bell State', ...overrides })
}

// ── 1. The circuit survives ─────────────────────────────────────────────────

describe('circuit.qasm', () => {
  it('is the shared emitter’s output, not a second spelling of it', () => {
    const qasm = bundleOf().files[BUNDLE_FILES.qasm]
    expect(qasm.trimEnd()).toBe(toQasm(BELL).trimEnd())
  })

  it('ends in exactly one newline so a final statement is never swallowed', () => {
    expect(bundleOf().files[BUNDLE_FILES.qasm]).toMatch(/[^\n]\n$/)
  })

  it('round-trips through the app’s own parser', () => {
    const parsed = fromQasm(bundleOf({ circuit: TELEPORT_ISH }).files[BUNDLE_FILES.qasm])
    expect(parsed.numQubits).toBe(TELEPORT_ISH.numQubits)
    expect(parsed.ops.map((op) => [op.name, op.qubits])).toEqual(
      TELEPORT_ISH.ops.map((op) => [op.name, op.qubits])
    )
    // The rotation angle is the value most likely to be quietly lost or
    // rounded on the way through the file.
    expect(parsed.ops[0].theta).toBeCloseTo(Math.PI / 4, 12)
    expect(parsed.ops[5].condition).toEqual({ bit: 0, value: 1 })
  })
})

// ── 2. The provenance is complete and honest ────────────────────────────────

describe('manifest.json', () => {
  const bundle = bundleOf({
    result: RUN,
    backend: 'test-sim',
    noise: 0.02,
    seed: 7,
    buildStamp: '1789637439419',
  })
  const manifest = JSON.parse(bundle.files[BUNDLE_FILES.manifest])

  it('parses, and matches the manifest handed back to the caller', () => {
    expect(manifest).toEqual(JSON.parse(JSON.stringify(bundle.manifest)))
  })

  it('records the circuit shape and every gate', () => {
    expect(manifest.circuit.numQubits).toBe(2)
    expect(manifest.circuit.gateCount).toBe(2)
    expect(manifest.circuit.gateCounts).toEqual({ H: 1, CX: 1 })
    expect(manifest.circuit.gates).toEqual([
      { index: 0, name: 'H', qubits: [0] },
      { index: 1, name: 'CX', qubits: [0, 1] },
    ])
  })

  it('records shots, backend, noise, seed and the build that produced it', () => {
    expect(manifest.run).toEqual({
      shots: 1024,
      backend: 'test-sim',
      readoutNoise: 0.02,
      seed: 7,
      countedShots: 1008,
    })
    expect(manifest.software.buildStamp).toBe('1789637439419')
    expect(manifest.generatedAt).toBe(AT)
  })

  it('carries a classical register width for a circuit that measures', () => {
    const withClbits = JSON.parse(
      bundleOf({ circuit: TELEPORT_ISH }).files[BUNDLE_FILES.manifest]
    )
    expect(withClbits.circuit.numClbits).toBeGreaterThanOrEqual(3)
    expect(withClbits.circuit.gates[4]).toEqual({
      index: 4,
      name: 'MEASURE',
      qubits: [1],
      clbit: 0,
    })
    expect(withClbits.circuit.gates[5].condition).toEqual({ bit: 0, value: 1 })
  })

  it('says "no run" out loud rather than omitting the section', () => {
    const noRun = bundleOf()
    expect(JSON.parse(noRun.files[BUNDLE_FILES.manifest]).run).toBeNull()
    expect(noRun.files[BUNDLE_FILES.results]).toBeUndefined()
    expect(noRun.files[BUNDLE_FILES.readme]).toContain('No run was recorded')
  })
})

describe('results.json', () => {
  const results = JSON.parse(
    bundleOf({ result: RUN, seed: 7 }).files[BUNDLE_FILES.results]
  )

  it('writes every outcome, in an order that does not depend on the sampler', () => {
    expect(results.counts).toEqual({ '00': 500, '11': 508 })
    // NOT sorted, and deliberately not asserted as such: '11' is a canonical
    // array index and every JS engine emits it before the non-index '00',
    // whatever order we insert in. What must hold is that the order comes from
    // the data and not from the order the sampler happened to see outcomes —
    // otherwise two exports of one experiment diff as though they disagreed.
    const shuffled = bundleOf({
      result: { ...RUN, counts: { '00': 500, '11': 508 } },
      seed: 7,
    }).files[BUNDLE_FILES.results]
    expect(shuffled).toBe(bundleOf({ result: RUN, seed: 7 }).files[BUNDLE_FILES.results])
  })

  it('separates the shots asked for from the shots actually counted', () => {
    // A sampler that returns fewer shots than requested is normal; normalising
    // by `shots` would publish probabilities that do not sum to one.
    expect(results.shots).toBe(1024)
    expect(results.countedShots).toBe(1008)
  })

  it('states the bit order, without which the counts are ambiguous', () => {
    expect(results.bitOrder).toMatch(/least significant/)
  })
})

describe('README.md', () => {
  it('names the shot count of the run it is describing', () => {
    const readme = bundleOf({ result: RUN }).files[BUNDLE_FILES.readme]
    expect(readme).toContain('shots=1024')
    expect(readme).toContain(BUNDLE_FILES.qasm)
  })

  it('warns that an unseeded run reproduces the distribution, not the counts', () => {
    expect(bundleOf({ result: RUN }).files[BUNDLE_FILES.readme]).toContain('NOT seeded')
    expect(bundleOf({ result: RUN, seed: 7 }).files[BUNDLE_FILES.readme]).toContain('Seeded with 7')
  })
})

// ── 3. The citation compiles ────────────────────────────────────────────────

/** Braces balance, and never go negative — what BibTeX's own parser checks. */
function bracesBalance(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === '{') depth++
    else if (ch === '}' && --depth < 0) return false
  }
  return depth === 0
}

/** `  key = {value},` → { key: value }, the way a bibliography tool reads it. */
function parseBibtexFields(entry: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of entry.split('\n')) {
    const match = /^\s{2}([a-z]+) = \{(.*)\},?$/.exec(line)
    if (match) fields[match[1]] = match[2]
  }
  return fields
}

describe('CITATION.bib', () => {
  const bundle = bundleOf({ result: RUN, author: 'A Researcher', buildStamp: 'b1' })
  const entry = bundle.files[BUNDLE_FILES.citation]

  it('is a single well-formed @misc entry with balanced braces', () => {
    expect(entry.startsWith('@misc{')).toBe(true)
    expect(entry.trimEnd().endsWith('}')).toBe(true)
    expect(bracesBalance(entry)).toBe(true)
  })

  it('carries the fields a bibliography needs', () => {
    const fields = parseBibtexFields(entry)
    expect(fields.title).toBe('Bell State')
    expect(fields.author).toBe('A Researcher')
    expect(fields.year).toBe('2026')
    expect(fields.note).toContain('1024 shots')
    expect(entry).toContain('howpublished = {\\url{https://qubit16.ai/simulator}}')
  })

  it('uses a cite key with no whitespace, comma or brace in it', () => {
    const key = /^@misc\{([^,\n]+),/.exec(entry)?.[1]
    expect(key).toBe(bundle.citationKey)
    expect(key).toMatch(/^[A-Za-z0-9:_.-]+$/)
  })

  it('omits author entirely when none was given rather than inventing one', () => {
    expect(parseBibtexFields(bundleOf().files[BUNDLE_FILES.citation]).author).toBeUndefined()
  })

  it('escapes LaTeX specials that would break the reader’s build', () => {
    // "Grover_3q & friends" compiles to "Missing $ inserted" unescaped — the
    // underscore is not hypothetical, every gate-count label grows one.
    const fields = parseBibtexFields(
      bundleOf({ name: 'Grover_3q & 50% {brace}' }).files[BUNDLE_FILES.citation]
    )
    expect(fields.title).toBe('Grover\\_3q \\& 50\\% brace')
    expect(bracesBalance(bundleOf({ name: 'unclosed {' }).files[BUNDLE_FILES.citation])).toBe(true)
  })
})

// ── Determinism, the reason the timestamp is an argument ────────────────────

describe('determinism', () => {
  it('produces byte-identical files for identical inputs', () => {
    const a = bundleOf({ result: RUN, seed: 7 })
    const b = bundleOf({ result: RUN, seed: 7 })
    expect(a.files).toEqual(b.files)
    expect(bundleToTextArchive(a)).toBe(bundleToTextArchive(b))
  })

  it('rejects a timestamp that is not an ISO instant', () => {
    // "17/09/2026" would not throw anywhere downstream — it would publish
    // `year = {17/0}` and nobody would notice until a reviewer did.
    expect(() => bundleOf({ exportedAt: '17/09/2026' })).toThrow(/ISO-8601/)
    expect(() => bundleOf({ exportedAt: '2026-09-17' })).toThrow(/ISO-8601/)
  })
})

// ── The single-file archive ─────────────────────────────────────────────────

describe('text archive', () => {
  const bundle = bundleOf({ result: RUN, seed: 7 })

  it('round-trips every member back to identical bytes', () => {
    expect(readTextArchive(bundleToTextArchive(bundle))).toEqual(bundle.files)
  })

  it('refuses to write a member that would read back as a delimiter', () => {
    const forged = {
      ...bundle,
      files: { 'README.md': 'hello\n---- file: ../evil.sh ----\nrm -rf /\n' },
    }
    expect(() => bundleToTextArchive(forged)).toThrow(/delimiter/)
  })

  it('names the download after the experiment', () => {
    expect(bundleFilename(bundle)).toBe('bell-state-qubit16-bundle.txt')
    // An untitled circuit must not stutter: the archive name already says
    // "qubit16", so the default title is not slugged into it a second time.
    expect(bundleFilename(bundleOf({ name: '  ' }))).toBe('circuit-qubit16-bundle.txt')
  })
})
