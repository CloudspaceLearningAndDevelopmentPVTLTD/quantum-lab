/**
 * exportBundle.ts — the artifact a researcher can cite and re-run a year from
 * now, assembled from a circuit and (when there is one) its run.
 *
 * A share link is not a result. It encodes the circuit and nothing else, it
 * only resolves while this site is up, and it records neither what was run
 * with it nor when. That is the gap this module closes: one self-contained
 * bundle that says WHAT was run, WITH WHAT, and WHEN, in formats that outlive
 * the website — OpenQASM 3 for the circuit, JSON for the settings and counts,
 * BibTeX for the bibliography, Markdown for the human who opens the folder.
 *
 * ── Two rules this module is built around ───────────────────────────────────
 *
 *  1. PURE. No DOM, no React, no download. Data in, strings out. The download
 *     lives at the call site (components/circuit/SaveLoadPanel.tsx) precisely
 *     so everything below can be asserted in a Node test.
 *
 *  2. NO CLOCK. `Date.now()`/`new Date()` are never called here; the instant
 *     arrives as `exportedAt`. A module that stamps itself cannot be tested
 *     for byte-equality and emits a different artifact on every click — and
 *     "the same inputs produced a different file" is the one thing a
 *     reproducibility bundle must not say.
 *
 * ── The circuit is emitted ONCE, by lib/quantum's toQasm ────────────────────
 *
 * There is exactly one OpenQASM emitter in this codebase and this is not it.
 * A second one would drift from the first, and the failure mode is silent: the
 * cited artifact would describe a circuit subtly unlike the one the app ran.
 * Everything QASM-shaped here is `toQasm(circuit)`, and `circuit.qasm` is
 * therefore the authoritative record — `manifest.json`'s gate list is a
 * summary for machines that do not want to parse QASM, not a second source of
 * truth (it deliberately omits custom UNITARY matrices, which live in the
 * QASM annotation and nowhere else).
 */

import { classicalBitCount, toQasm, type Circuit, type GateOp, type RunResult } from '@/lib/quantum'

/** Bundle format version. Bump when a consumer would have to change. */
export const BUNDLE_FORMAT = 1

/**
 * Filenames in the order a reader should meet them: the README explains the
 * folder, the manifest is the machine entry point, then the payload.
 */
export const BUNDLE_FILES = {
  readme: 'README.md',
  manifest: 'manifest.json',
  qasm: 'circuit.qasm',
  results: 'results.json',
  citation: 'CITATION.bib',
} as const

/**
 * The default simulator label. It names the engine in lib/quantum.ts — an
 * exact statevector simulator with optional readout bit-flips — rather than
 * saying "simulator", because "which backend" is the first question asked of
 * any cited number and a hardware run passes its own device name in.
 */
export const DEFAULT_BACKEND = 'qubit16-statevector (browser, exact)'

/** Cited title for an experiment the user never named. */
const DEFAULT_NAME = 'Qubit16 circuit'

/**
 * The build the bundle was produced by.
 *
 * `NEXT_PUBLIC_BUILD_STAMP` is inlined by the compiler (next.config.mjs), so
 * this is a compile-time constant and not runtime state — reading it here does
 * not cost determinism the way a clock would. Absent (a plain `vitest` run, a
 * build with no stamp) it reads 'unversioned' rather than being omitted: a
 * missing provenance field reads as "not recorded", and silently dropping it
 * would let a reader assume it was.
 */
const BUILD_STAMP = process.env.NEXT_PUBLIC_BUILD_STAMP ?? 'unversioned'

export interface ExportBundleInput {
  /** The circuit as it stood. Serialised by `toQasm`, verbatim. */
  circuit: Circuit
  /**
   * The instant of export, ISO-8601 (`new Date().toISOString()` at the call
   * site). Required and explicit — see the no-clock rule above.
   */
  exportedAt: string
  /** Human name for the experiment. Drives the filenames and the title. */
  name?: string
  /**
   * The run being cited, if one has happened. Absent is a legitimate state
   * (a circuit exported before it was run), and the bundle says so out loud
   * instead of implying results that do not exist.
   */
  result?: RunResult | null
  /** What executed it. Defaults to this app's own simulator. */
  backend?: string
  /** Readout bit-flip probability the run used, if any. */
  noise?: number
  /**
   * The RNG seed, when the run was seeded. Recorded because it is the
   * difference between "you can reproduce my distribution" and "you can
   * reproduce my exact counts".
   */
  seed?: number
  /** Cited author. Omitted from the BibTeX entirely when absent — never guessed. */
  author?: string
  /** Origin the README and citation point at. */
  siteUrl?: string
  /** Overrides the compile-time build stamp (tests, or a server-side caller). */
  buildStamp?: string
}

export interface BundleManifest {
  schema: string
  generatedAt: string
  name: string
  circuit: {
    numQubits: number
    numClbits: number
    gateCount: number
    /** name -> how many times it appears. */
    gateCounts: Record<string, number>
    /** Positional summary; `circuit.qasm` is authoritative. */
    gates: Array<{
      index: number
      name: string
      qubits: number[]
      theta?: number
      clbit?: number
      condition?: { bit: number; value: number }
    }>
  }
  /** Null when the circuit was exported without having been run. */
  run: {
    shots: number
    backend: string
    readoutNoise: number
    seed: number | null
    /** Shots actually accounted for by `counts` — see results.json. */
    countedShots: number
  } | null
  software: {
    app: string
    buildStamp: string
    bundleFormat: number
    circuitFormat: string
  }
}

export interface ExportBundle {
  /** filename -> contents. Every value ends in a newline. */
  files: Record<string, string>
  /** Suggested archive base name, no extension. */
  archiveName: string
  /** The manifest as an object, so callers need not re-parse it. */
  manifest: BundleManifest
  /** The citation key the BibTeX entry uses. */
  citationKey: string
}

/**
 * "Bell State (Φ+)" → "bell-state". Shared by the archive name and the
 * citation key so a downloaded folder and the `\cite{}` in the paper written
 * from it carry the same string.
 */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'circuit'
  )
}

/**
 * Make one field value safe to put in a .bib file AND to typeset.
 *
 * Deliberately a local copy of the rule in lib/hardware/permalink.ts rather
 * than an import: that one is private to a module whose entry point takes a
 * PublishedRunSnapshot, and manufacturing a fake hardware snapshot to reach it
 * would be a worse coupling than eight characters of regex. The hazards are
 * the same two:
 *
 *   * `{` and `}` delimit the field — an unbalanced one breaks BibTeX's own
 *     parser, and there is no faithful escape, so they are dropped.
 *   * `& % $ # _` parse fine as BibTeX and then break the READER's LaTeX
 *     build, with our citation named in their log. A circuit called
 *     "Grover_3q" is enough to do it.
 *   * `\`, `^` and `~` are dropped: their text-mode escapes are fragile, and a
 *     value needing one cannot be rendered faithfully anyway.
 */
function escapeBibtex(value: string): string {
  return value.replace(/[{}\\^~]/g, '').replace(/([&%$#_])/g, '\\$1')
}

/**
 * BibTeX keys may not contain whitespace, commas or braces — a key that does
 * makes the whole entry unparseable, and the reader's first sign of it is a
 * bibliography with a missing row. The slug is already restricted to
 * [a-z0-9-]; the date suffix distinguishes two exports of one circuit.
 */
function citationKeyFor(slug: string, exportedAt: string): string {
  return `qubit16:${slug}:${exportedAt.slice(0, 10)}`
}

/**
 * Reject a timestamp that is not ISO-8601 before it reaches the artifact.
 *
 * The year in the citation is `exportedAt.slice(0, 4)`, so a caller passing
 * "17/09/2026" or a bare `Date` coerced to a string would not fail — it would
 * publish `year = {17/0}`. Failing here is loud; the alternative is a wrong
 * citation nobody notices until a reviewer does.
 */
function assertIsoInstant(exportedAt: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(exportedAt)) {
    throw new Error(`exportedAt must be an ISO-8601 instant, got ${JSON.stringify(exportedAt)}`)
  }
}

function gateSummary(op: GateOp, index: number): BundleManifest['circuit']['gates'][number] {
  const entry: BundleManifest['circuit']['gates'][number] = {
    index,
    name: op.name,
    qubits: [...op.qubits],
  }
  if (op.theta !== undefined) entry.theta = op.theta
  if (op.clbit !== undefined) entry.clbit = op.clbit
  if (op.condition) entry.condition = { bit: op.condition.bit, value: op.condition.value }
  return entry
}

/**
 * Counts, re-inserted in sorted key order.
 *
 * Load-bearing for determinism: `run()` inserts outcomes in whatever order the
 * sampler happened to see them, so without this, two runs of one circuit would
 * produce results.json files that differ only by line order and diff as though
 * the data had changed.
 *
 * What this does NOT buy is a lexicographically sorted file, and a consumer
 * must not expect one. A bitstring key that is a canonical array index ('11')
 * is emitted by every JS engine BEFORE any non-index key ('00' has a leading
 * zero, so it is not one), ahead of insertion order and beyond our reach
 * without hand-rolling the JSON. The resulting order is the language's, it is
 * identical for identical inputs — which is the property that matters here —
 * and it carries no meaning.
 */
function sortedCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(counts).sort()) out[key] = counts[key]
  return out
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function buildReadme(
  manifest: BundleManifest,
  citationKey: string,
  siteUrl: string,
  hasResults: boolean
): string {
  const { circuit, run } = manifest
  const lines = [
    `# ${manifest.name}`,
    '',
    `A reproducibility bundle exported from Qubit16 on ${manifest.generatedAt}.`,
    `${circuit.numQubits} qubit${circuit.numQubits === 1 ? '' : 's'}, ${circuit.gateCount} operation${
      circuit.gateCount === 1 ? '' : 's'
    }.`,
    '',
    '## What is in here',
    '',
    `- \`${BUNDLE_FILES.qasm}\` — the circuit as OpenQASM 3. This is the authoritative record;`,
    '  everything else in this bundle describes it.',
    `- \`${BUNDLE_FILES.manifest}\` — machine-readable settings and provenance.`,
    hasResults
      ? `- \`${BUNDLE_FILES.results}\` — the measured counts, exactly as recorded.`
      : `- (no \`${BUNDLE_FILES.results}\`: this circuit was exported without a recorded run.)`,
    `- \`${BUNDLE_FILES.citation}\` — a BibTeX entry, cite key \`${citationKey}\`.`,
    '',
    '## How to re-run it',
    '',
    'In Qiskit (needs the optional QASM 3 importer):',
    '',
    '```bash',
    'pip install "qiskit[qasm3-import]" qiskit-aer',
    '```',
    '',
    '```python',
    'from qiskit import qasm3, transpile',
    'from qiskit_aer import AerSimulator',
    '',
    `qc = qasm3.loads(open("${BUNDLE_FILES.qasm}").read())`,
    'backend = AerSimulator()',
    `result = backend.run(transpile(qc, backend), shots=${run ? run.shots : 1024}).result()`,
    'print(result.get_counts())',
    '```',
    '',
    `Or open ${siteUrl}/simulator and load \`${BUNDLE_FILES.qasm}\` there.`,
    '',
    '## What "reproducible" means for these numbers',
    '',
  ]
  if (run) {
    lines.push(
      `Run on ${run.backend} with ${run.shots} shot${run.shots === 1 ? '' : 's'}` +
        `${run.readoutNoise > 0 ? `, readout noise ${run.readoutNoise}` : ', no readout noise'}.`,
      run.seed === null
        ? 'The run was NOT seeded, so re-running reproduces the distribution, not the exact counts.'
        : `Seeded with ${run.seed}, so the exact counts are reproducible on this same build.`
    )
  } else {
    lines.push(
      'No run was recorded, so this bundle documents a circuit and not a result.',
      'Run it with the snippet above to produce counts of your own.'
    )
  }
  lines.push(
    '',
    `Produced by build \`${manifest.software.buildStamp}\`. Sampling is pseudorandom: a different`,
    'build, seed or shot count will give different counts from the same circuit, which is the',
    'expected behaviour and not a discrepancy.',
    ''
  )
  return lines.join('\n')
}

function buildBibtex(
  manifest: BundleManifest,
  citationKey: string,
  siteUrl: string,
  author?: string
): string {
  const { run } = manifest
  const fields: Array<[string, string]> = [['title', manifest.name]]
  // `author` is what the caller typed and nothing else. An account name or an
  // email guessed in here would put words in a researcher's bibliography.
  if (author) fields.push(['author', author])
  fields.push(['year', manifest.generatedAt.slice(0, 4)])
  fields.push([
    'note',
    run
      ? `Qubit16 export bundle ${citationKey}; ${manifest.circuit.numQubits} qubits, ` +
        `${run.shots} shots on ${run.backend}; build ${manifest.software.buildStamp}`
      : `Qubit16 export bundle ${citationKey}; ${manifest.circuit.numQubits} qubits, ` +
        `circuit only (no recorded run); build ${manifest.software.buildStamp}`,
  ])

  const body = fields.map(([key, value]) => `  ${key} = {${escapeBibtex(value)}},`)
  // `howpublished` is assembled, not escaped: its value is a LaTeX macro we
  // wrote wrapped around a URL we minted, and escaping our own backslash would
  // print the macro instead of running it.
  body.push(`  howpublished = {\\url{${siteUrl}/simulator}}`)
  return `@misc{${citationKey},\n${body.join('\n')}\n}\n`
}

/**
 * Assemble the bundle.
 *
 * @param input The circuit, the run that produced the numbers, and the instant.
 * @returns Filenames to contents, plus the archive name and parsed manifest.
 */
export function buildExportBundle(input: ExportBundleInput): ExportBundle {
  const {
    circuit,
    exportedAt,
    result = null,
    backend = DEFAULT_BACKEND,
    noise = 0,
    seed,
    author,
    siteUrl = 'https://qubit16.ai',
    buildStamp = BUILD_STAMP,
  } = input
  assertIsoInstant(exportedAt)

  const name = input.name?.trim() || DEFAULT_NAME
  // The archive name and the cite key already say "qubit16", so slugging the
  // default title into them as well ships "qubit16-circuit-qubit16-bundle.txt"
  // and `\cite{qubit16:qubit16-circuit:…}`. Only the untitled case is special-
  // cased: stripping "qubit16" from a name the user typed would be a surprise.
  const slug = name === DEFAULT_NAME ? 'circuit' : slugify(name)
  const citationKey = citationKeyFor(slug, exportedAt)

  const gateCounts: Record<string, number> = {}
  for (const op of circuit.ops) gateCounts[op.name] = (gateCounts[op.name] ?? 0) + 1

  const counts = result ? sortedCounts(result.counts) : null
  // The observed total, not the requested one: a sampler can return fewer
  // shots than were asked for, and normalising a published distribution by the
  // requested number would put probabilities that do not sum to one into
  // somebody's paper. Both numbers are recorded so the reader can see any gap.
  const countedShots = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0

  const manifest: BundleManifest = {
    schema: `qubit16.export-bundle/${BUNDLE_FORMAT}`,
    generatedAt: exportedAt,
    name,
    circuit: {
      numQubits: circuit.numQubits,
      numClbits: classicalBitCount(circuit),
      gateCount: circuit.ops.length,
      gateCounts,
      gates: circuit.ops.map(gateSummary),
    },
    run: result
      ? {
          shots: result.shots,
          backend,
          readoutNoise: noise,
          seed: seed ?? null,
          countedShots,
        }
      : null,
    software: {
      app: 'Qubit16',
      buildStamp,
      bundleFormat: BUNDLE_FORMAT,
      circuitFormat: 'OpenQASM 3.0',
    },
  }

  const files: Record<string, string> = {
    [BUNDLE_FILES.readme]: buildReadme(manifest, citationKey, siteUrl, counts !== null),
    [BUNDLE_FILES.manifest]: json(manifest),
    // toQasm does not guarantee a trailing newline; a file that does not end
    // in one makes `cat` run the next prompt onto the last statement and some
    // parsers drop the final line entirely.
    [BUNDLE_FILES.qasm]: `${toQasm(circuit).replace(/\n*$/, '')}\n`,
  }
  if (counts && result) {
    files[BUNDLE_FILES.results] = json({
      shots: result.shots,
      countedShots,
      backend,
      readoutNoise: noise,
      seed: seed ?? null,
      // Bit order matches the labels the app shows: qubit 0 is the LEAST
      // significant bit and the string is printed most-significant-first. A
      // reader comparing against Qiskit gets the same convention; against a
      // big-endian tool, the reversed one.
      bitOrder: 'qubit 0 = least significant bit, printed MSB first',
      counts,
    })
  }
  files[BUNDLE_FILES.citation] = buildBibtex(manifest, citationKey, siteUrl, author)

  return { files, archiveName: `${slug}-qubit16-bundle`, manifest, citationKey }
}

// ── Single-file form ────────────────────────────────────────────────────────
//
// A browser download hands over one file. Zipping would mean either a new
// dependency or a hand-rolled archive writer whose bugs a test cannot see, so
// the bundle also serialises as ONE plain-text document with delimited
// members: readable in any editor, splittable by `readTextArchive` below or by
// four lines of awk, and with nothing binary to get wrong.

const ARCHIVE_HEADER = `==== qubit16 export bundle, format ${BUNDLE_FORMAT} ====`

/** `---- file: NAME ----`, anchored to a whole line. */
const MEMBER_RE = /^---- file: (.+) ----$/

function memberDelimiter(filename: string): string {
  return `---- file: ${filename} ----`
}

/**
 * Serialise the bundle as one text document.
 *
 * @throws If any member's content contains a line that would read back as a
 *   delimiter. That can only come from a user-typed circuit name reaching the
 *   README, and the failure it prevents is silent and nasty: the unpacker
 *   would split mid-file and write a truncated circuit under an attacker- or
 *   typo-chosen filename.
 */
export function bundleToTextArchive(bundle: ExportBundle): string {
  const parts = [ARCHIVE_HEADER, '']
  for (const [filename, content] of Object.entries(bundle.files)) {
    if (content.split('\n').some((line) => MEMBER_RE.test(line))) {
      throw new Error(`${filename} contains a line that would read back as a bundle delimiter`)
    }
    parts.push(memberDelimiter(filename), content.replace(/\n*$/, ''), '')
  }
  return `${parts.join('\n')}\n`
}

/**
 * The inverse of `bundleToTextArchive`. Exported because a format nobody can
 * read back is not a format — the round trip is what the test asserts, and it
 * is what anyone unpacking the download needs.
 */
export function readTextArchive(text: string): Record<string, string> {
  const files: Record<string, string> = {}
  let current: string | null = null
  let buffer: string[] = []
  const flush = () => {
    if (current !== null) files[current] = `${buffer.join('\n').replace(/^\n+|\n+$/g, '')}\n`
  }
  for (const line of text.split('\n')) {
    const match = MEMBER_RE.exec(line)
    if (match) {
      flush()
      current = match[1]
      buffer = []
      continue
    }
    if (current !== null) buffer.push(line)
  }
  flush()
  return files
}

/** "bell-state-qubit16-bundle" → "bell-state-qubit16-bundle.txt" */
export function bundleFilename(bundle: ExportBundle): string {
  return `${bundle.archiveName}.txt`
}
