/**
 * notebook.ts — build a runnable Jupyter notebook (.ipynb) from a Circuit.
 *
 * This is the learner-to-practitioner bridge: instead of hosting an IDE, we
 * hand the learner a notebook that runs in the tools practitioners actually
 * use (Jupyter/Colab + Qiskit or PennyLane). Everything here is a pure
 * string-in/string-out builder so it can be unit-tested in Node; the one
 * browser-touching function (downloadNotebook) is kept at the bottom and is
 * never imported by tests.
 *
 * Format: nbformat 4.5 — the `id` field on every cell is REQUIRED at
 * nbformat_minor >= 5, and Colab rejects notebooks that omit it. Cell ids are
 * deterministic strings, not random, so exporting the same circuit twice
 * yields byte-identical files (diffable, cacheable).
 *
 * API choices (verified against current docs, Aug 2026 — Qiskit 2.x):
 *  - `qiskit.qasm3.loads` is the supported OpenQASM 3 entry point but needs
 *    the optional `qiskit-qasm3-import` package, hence the
 *    `pip install "qiskit[qasm3-import,visualization]"` install cell.
 *  - The run cell tries AerSimulator (fast, optional dependency) and falls
 *    back to the reference StatevectorSampler primitive that ships inside
 *    Qiskit itself. The Sampler's V2 result is pub-based:
 *    `job.result()[0].data.c.get_counts()` — `c` is the classical register
 *    name toQasm() emits, so the attribute access is stable.
 *  - PennyLane has no QASM 3 importer, so that variant rebuilds the circuit
 *    gate-by-gate from our own model instead of round-tripping through QASM.
 *
 * Bit-ordering: Qubit16 (like Qiskit) treats qubit 0 as the LEAST
 * significant bit and prints labels MSB-first. PennyLane's qml.counts labels
 * wires in the order given, leftmost first — so the PennyLane cell passes the
 * wire list reversed to make its bitstrings match what the learner saw here.
 */

import { blockPermutation, splitBlockOperands, toQasm, type Circuit, type GateOp } from '@/lib/quantum'

export type NotebookVariant = 'qiskit' | 'pennylane'

// ────────────────────────────────────────────────────────────
// nbformat plumbing
// ────────────────────────────────────────────────────────────

interface NotebookCell {
  id: string
  cell_type: 'markdown' | 'code'
  metadata: Record<string, never>
  source: string[]
  execution_count?: null
  outputs?: never[]
}

/**
 * nbformat stores source as an array of lines, each KEEPING its trailing
 * newline (except possibly the last). A single joined string is also legal
 * but the array form is what jupyter itself writes, and it diffs better.
 */
function toSource(text: string): string[] {
  const lines = text.split('\n')
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line)).filter(
    // A trailing "\n" split leaves a final empty string — drop it rather than
    // emit a phantom empty source line.
    (line, i, arr) => !(i === arr.length - 1 && line === '')
  )
}

function markdownCell(id: string, text: string): NotebookCell {
  return { id, cell_type: 'markdown', metadata: {}, source: toSource(text) }
}

function codeCell(id: string, text: string): NotebookCell {
  return {
    id,
    cell_type: 'code',
    metadata: {},
    execution_count: null,
    outputs: [],
    source: toSource(text),
  }
}

function wrapNotebook(cells: NotebookCell[]): string {
  const notebook = {
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
  return JSON.stringify(notebook, null, 1)
}

/**
 * Serialise a rotation angle as a Python float literal. String(number) is
 * round-trip exact for doubles and Python's float literal grammar accepts
 * every form it produces (including exponents), so no precision is lost
 * between the canvas and the notebook.
 */
function pyFloat(theta: number): string {
  if (!Number.isFinite(theta)) throw new Error(`angle must be finite, got ${theta}`)
  return String(theta)
}

// ────────────────────────────────────────────────────────────
// Shared provenance cell
// ────────────────────────────────────────────────────────────

function provenanceMarkdown(circuit: Circuit, name: string, framework: string): string {
  const qasm = toQasm(circuit)
  return [
    `# ${name}`,
    '',
    `Exported from [Qubit16](https://qubit16.ai) — ${circuit.numQubits} qubit${
      circuit.numQubits === 1 ? '' : 's'
    }, ${circuit.ops.length} operation${circuit.ops.length === 1 ? '' : 's'}. This notebook`,
    `rebuilds the circuit in **${framework}** so you can run it, tweak it, and take it further`,
    'than the browser simulator goes.',
    '',
    'The circuit as OpenQASM 3:',
    '',
    '```qasm',
    qasm,
    '```',
  ].join('\n')
}

// ────────────────────────────────────────────────────────────
// Qiskit variant
// ────────────────────────────────────────────────────────────

function qiskitLoadCell(circuit: Circuit): string {
  const qasm = toQasm(circuit)
  // toQasm never emits a double quote, but guard anyway: a `"""` inside the
  // triple-quoted literal would silently truncate the program.
  if (qasm.includes('"""')) throw new Error('QASM unexpectedly contains a triple quote')
  return [
    'from qiskit import qasm3, transpile',
    '',
    'QASM = """\\',
    qasm,
    '"""',
    '',
    'circuit = qasm3.loads(QASM)',
    'circuit.draw("mpl")',
  ].join('\n')
}

const QISKIT_RUN = [
  'shots = 4096',
  'try:',
  '    # Fast path: qiskit-aer, if installed.',
  '    from qiskit_aer import AerSimulator',
  '',
  '    backend = AerSimulator()',
  '    counts = backend.run(transpile(circuit, backend), shots=shots).result().get_counts()',
  'except ImportError:',
  '    # Reference Sampler primitive — ships inside qiskit itself, no extra install.',
  '    from qiskit.primitives import StatevectorSampler',
  '',
  '    job = StatevectorSampler().run([circuit], shots=shots)',
  '    # V2 primitive results are per-pub; "c" is the classical register name.',
  '    counts = job.result()[0].data.c.get_counts()',
  'counts',
].join('\n')

const QISKIT_PLOT = [
  'from qiskit.visualization import plot_histogram',
  '',
  'plot_histogram(counts)',
].join('\n')

export function buildQiskitNotebook(circuit: Circuit, name = 'Qubit16 circuit'): string {
  return wrapNotebook([
    markdownCell('provenance', provenanceMarkdown(circuit, name, 'Qiskit')),
    codeCell('install', '%pip install "qiskit[qasm3-import,visualization]" qiskit-aer'),
    codeCell('load-circuit', qiskitLoadCell(circuit)),
    codeCell('run', QISKIT_RUN),
    codeCell('plot', QISKIT_PLOT),
  ])
}

// ────────────────────────────────────────────────────────────
// PennyLane variant
// ────────────────────────────────────────────────────────────

/**
 * One PennyLane call per GateOp, or null for ops with no gate equivalent
 * (MEASURE/BARRIER — measurement is the qnode's return value in PennyLane).
 * Exported so tests can pin the mapping gate-by-gate.
 */
export function pennylaneGateLine(op: GateOp): string | null {
  const { name, qubits } = op
  const theta = op.theta ?? 0
  const q = qubits[0]
  switch (name) {
    case 'H':    return `qml.Hadamard(wires=${q})`
    case 'X':    return `qml.PauliX(wires=${q})`
    case 'Y':    return `qml.PauliY(wires=${q})`
    case 'Z':    return `qml.PauliZ(wires=${q})`
    case 'S':    return `qml.S(wires=${q})`
    case 'SDG':  return `qml.adjoint(qml.S)(wires=${q})`
    case 'T':    return `qml.T(wires=${q})`
    case 'TDG':  return `qml.adjoint(qml.T)(wires=${q})`
    case 'RX':   return `qml.RX(${pyFloat(theta)}, wires=${q})`
    case 'RY':   return `qml.RY(${pyFloat(theta)}, wires=${q})`
    case 'RZ':   return `qml.RZ(${pyFloat(theta)}, wires=${q})`
    case 'P':    return `qml.PhaseShift(${pyFloat(theta)}, wires=${q})`
    case 'CX':   return `qml.CNOT(wires=[${qubits[0]}, ${qubits[1]}])`
    case 'CY':   return `qml.CY(wires=[${qubits[0]}, ${qubits[1]}])`
    case 'CZ':   return `qml.CZ(wires=[${qubits[0]}, ${qubits[1]}])`
    case 'SWAP': return `qml.SWAP(wires=[${qubits[0]}, ${qubits[1]}])`
    case 'CCX':  return `qml.Toffoli(wires=[${qubits[0]}, ${qubits[1]}, ${qubits[2]}])`
    // ── Wave 2 ──
    case 'SX':   return `qml.SX(wires=${q})`
    case 'SXDG': return `qml.adjoint(qml.SX)(wires=${q})`
    case 'CSWAP': return `qml.CSWAP(wires=[${qubits[0]}, ${qubits[1]}, ${qubits[2]}])`
    case 'MCX':  return `qml.MultiControlledX(wires=[${qubits.join(', ')}])`
    case 'UNITARY': {
      // PennyLane is big-endian (wires[0] is the matrix's most significant
      // bit); our matrix has qubits[0] least significant, so the wire list is
      // reversed to keep the SAME matrix meaning the same thing.
      const rows = pyMatrix(op.matrix ?? [])
      return `qml.QubitUnitary(np.array(${rows}), wires=[${[...qubits].reverse().join(', ')}])`
    }
    case 'ADDK':
    case 'MULK': {
      const { controls, register } = splitBlockOperands(op)
      const perm = blockPermutation(op, register.length)
      // Column x of the permutation matrix has its 1 in row perm[x]:
      // np.eye(d)[perm].T. Big-endian wires, so the register is reversed.
      const gate = `qml.QubitUnitary(np.eye(${perm.length})[[${perm.join(', ')}]].T, wires=[${[...register].reverse().join(', ')}])`
      return controls.length ? `qml.ctrl(${gate}, control=[${controls.join(', ')}])` : gate
    }
    case 'QFT':
    case 'IQFT': {
      const { controls, register } = splitBlockOperands(op)
      const wires = `wires=[${[...register].reverse().join(', ')}]`
      const gate = name === 'QFT' ? `qml.QFT(${wires})` : `qml.adjoint(qml.QFT)(${wires})`
      return controls.length ? `qml.ctrl(${gate}, control=[${controls.join(', ')}])` : gate
    }
    case 'MEASURE':
    case 'BARRIER':
      return null
    case 'U3':
      // Same (theta, phi, lambda) convention as OpenQASM's U(...) — PennyLane's
      // qml.U3 is defined to match it exactly.
      return `qml.U3(${pyFloat(theta)}, ${pyFloat(op.phi ?? 0)}, ${pyFloat(op.lambda ?? 0)}, wires=${q})`
    case 'RESET':
      // Mid-circuit measurement with reset — PennyLane's closest equivalent to
      // "measure, then flip back to |0⟩ if it read 1".
      return `qml.measure(wires=${q}, reset=True)`
    case 'POSTSELECT':
      return `qml.measure(wires=${q}, postselect=${op.postselectValue})`
    // TODO: op.extraControls (any-basis extra controls) has no PennyLane
    // export yet — every case above ignores it and emits the bare gate. Add
    // qml.ctrl(...) plus a basis-change Hadamard/Sdg wrapper (the same recipe
    // StateVector.applyExtraControls documents) if/when this notebook export
    // needs to round-trip a Task-4 circuit exactly.
  }
}

/** A row-major square matrix as a Python nested list of complex literals. */
function pyMatrix(matrix: readonly { re: number; im: number }[]): string {
  const d = Math.round(Math.sqrt(matrix.length))
  const rows: string[] = []
  for (let r = 0; r < d; r++) {
    rows.push(
      '[' +
        matrix
          .slice(r * d, (r + 1) * d)
          .map((z) => `complex(${pyFloat(z.re)}, ${pyFloat(z.im)})`)
          .join(', ') +
        ']',
    )
  }
  return `[${rows.join(', ')}]`
}

function pennylaneCircuitCell(circuit: Circuit): string {
  const gateLines = circuit.ops
    .map(pennylaneGateLine)
    .filter((line): line is string => line !== null)
    .map((line) => `    ${line}`)
  const body = gateLines.length > 0 ? gateLines : ['    pass  # empty circuit']
  return [
    'import numpy as np',
    'import pennylane as qml',
    '',
    `num_wires = ${circuit.numQubits}`,
    'shots = 4096',
    'dev = qml.device("default.qubit", wires=num_wires, shots=shots)',
    '',
    '',
    '@qml.qnode(dev)',
    'def circuit():',
    ...body,
    '    # Reversed wire order so bitstrings read MSB-first with qubit 0',
    '    # rightmost — the same labels Qubit16 and Qiskit display.',
    '    return qml.counts(wires=list(range(num_wires))[::-1])',
    '',
    '',
    'counts = circuit()',
    'counts',
  ].join('\n')
}

const PENNYLANE_PLOT = [
  'import matplotlib.pyplot as plt',
  '',
  'labels = sorted(counts)',
  'plt.bar(labels, [counts[k] for k in labels])',
  'plt.xlabel("measurement outcome")',
  'plt.ylabel("counts")',
  'plt.title("Measurement histogram")',
  'plt.show()',
].join('\n')

export function buildPennylaneNotebook(circuit: Circuit, name = 'Qubit16 circuit'): string {
  return wrapNotebook([
    markdownCell('provenance', provenanceMarkdown(circuit, name, 'PennyLane')),
    codeCell('install', '%pip install pennylane matplotlib'),
    codeCell('build-circuit', pennylaneCircuitCell(circuit)),
    codeCell('plot', PENNYLANE_PLOT),
  ])
}

// ────────────────────────────────────────────────────────────
// Public entry points
// ────────────────────────────────────────────────────────────

export function buildNotebook(
  circuit: Circuit,
  variant: NotebookVariant,
  name?: string
): string {
  return variant === 'qiskit'
    ? buildQiskitNotebook(circuit, name)
    : buildPennylaneNotebook(circuit, name)
}

/** "Bell State (Φ+)" → "bell-state.qiskit.ipynb" */
export function notebookFilename(name: string, variant: NotebookVariant): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'circuit'}.${variant}.ipynb`
}

/**
 * Client-side download — no server round trip, the notebook is built in the
 * browser. Kept apart from the pure builders above so tests never touch it.
 */
export function downloadNotebook(circuit: Circuit, variant: NotebookVariant, name: string): void {
  const json = buildNotebook(circuit, variant, name)
  const blob = new Blob([json], { type: 'application/x-ipynb+json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = notebookFilename(name, variant)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick: revoking synchronously races the click in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
