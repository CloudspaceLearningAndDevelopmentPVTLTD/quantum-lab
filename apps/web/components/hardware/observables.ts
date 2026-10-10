/**
 * observables.ts — the editable draft of an Estimator observable, and the
 * local echo of the server's rules for one.
 *
 * WHY THIS FILE IS SEPARATE FROM THE COMPONENT
 * --------------------------------------------
 * Everything here is pure: drafts in, wire payload and per-field messages out.
 * That is deliberate — it means the rules can be tested without a DOM, and
 * `observables.test.ts` runs under the plain-node vitest environment this repo
 * uses. The rejected alternative was validating inside `ObservableEditor.tsx`
 * with `@testing-library/react`; that would have added a jsdom environment and
 * a dependency to test arithmetic on strings.
 *
 * WHO IS AUTHORITATIVE
 * --------------------
 * `services/api/app/quantum/observables.py` is, and nothing here changes that.
 * This module is a FAST LOCAL ECHO of it: it exists so a user who forgets to
 * pad a Pauli string with I sees why before spending a round trip, a Qiskit
 * parse and — on a paid device — a queue slot. Every message below is worded
 * to match its Python counterpart, and if the two ever drift the server wins
 * and this file is the one that is wrong.
 *
 * Deliberately NOT mirrored: this module cannot know the circuit, so it cannot
 * check the rule that actually ruins an Estimator run — that the circuit
 * carries no measurements. That check lives in
 * `services/api/app/quantum/hardware.py::_has_measurements`, and the editor
 * surfaces it as a warning rather than pretending to enforce it.
 *
 * QUBIT ORDERING, WHICH IS THE OTHER EASY MISTAKE
 * -----------------------------------------------
 * Pauli strings here are Qiskit labels, and Qiskit labels are LITTLE-ENDIAN:
 * the RIGHTMOST character is qubit 0. `"IZ"` on two qubits is Z on qubit 0 and
 * identity on qubit 1, not the other way round. Every helper below that builds
 * a string from a qubit index goes through {@link pauliOnQubits} so there is
 * one place that convention is written down.
 */

/** One Pauli term, exactly as POST /api/hardware/submit receives it. */
export interface PauliTerm {
  /** A Pauli string over I, X, Y, Z — one letter per qubit, qubit 0 rightmost. */
  pauli: string
  coefficient: number
}

/** One named observable, exactly as POST /api/hardware/submit receives it. */
export interface Observable {
  label: string
  terms: PauliTerm[]
}

/**
 * A term as the editor holds it.
 *
 * `coefficient` is a STRING, not a number, because a text box holds text: while
 * somebody types `-1.5e-3` it passes through `-`, `-1.5e` and `-1.5e-`, none of
 * which are numbers. Storing the number would force the field to fight the
 * user's cursor on every keystroke. The string is parsed once, at validation.
 */
export interface TermDraft {
  /** Stable key for React and for DOM ids. Never sent. */
  id: string
  pauli: string
  coefficient: string
}

/** One observable as the editor holds it. */
export interface ObservableDraft {
  /** Stable key for React and for DOM ids. Never sent. */
  id: string
  label: string
  terms: TermDraft[]
}

/**
 * Mirrors `MAX_OBSERVABLES` in services/api/app/quantum/observables.py.
 * Each observable is a separate expectation value the device has to estimate.
 */
export const MAX_OBSERVABLES = 32

/** Mirrors `MAX_TERMS_PER_OBSERVABLE` in the same Python module. */
export const MAX_TERMS_PER_OBSERVABLE = 512

/** Mirrors `MAX_LABEL_CHARS`. The server TRUNCATES to this; it does not refuse. */
export const MAX_LABEL_CHARS = 64

/**
 * The Pauli alphabet. Mirrors `_PAULI` in the Python module, minus the
 * anchors — matching is done against the whole trimmed string here.
 */
const PAULI_ALPHABET = /^[IXYZ]+$/

/**
 * A decimal real number, and nothing else.
 *
 * Why not `Number(text)` alone: `Number('0x1f')` is 31, `Number('Infinity')` is
 * Infinity and `Number('')` is 0. The first two would poison the whole
 * expectation value, and the third silently turns an empty box into a zero
 * coefficient — a term the user believes is there and that contributes nothing.
 *
 * WHAT THE REGEX DOES NOT CATCH, and why there is a second check below it: a
 * string can be a perfectly well-formed decimal and still not be a finite
 * double. `'1e400'` matches this pattern and converts to Infinity, which
 * `JSON.stringify` then writes as `null` — so the server sees a missing
 * coefficient and answers "must be a real number", pointing at a field the user
 * filled in. The regex is the syntax check; {@link validateTerm} does the range
 * check with `Number.isFinite` afterwards.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** The message the server gives for a wrong-length Pauli string, which is the
 * one non-obvious rule in the whole surface: pad with I. */
function paddingMessage(got: number, numQubits: number): string {
  return (
    `This Pauli string is ${got} character${got === 1 ? '' : 's'} but the circuit has ` +
    `${numQubits} qubit${numQubits === 1 ? '' : 's'}. A Pauli string needs exactly one letter ` +
    `per qubit — pad with I for the qubits this term does not act on.`
  )
}

/** Per-field messages for one term; null where the field is fine. */
export interface TermIssues {
  pauli: string | null
  coefficient: string | null
}

/** Per-field messages for one observable; null where the field is fine. */
export interface ObservableIssues {
  /** Problem with the label field. */
  label: string | null
  /** Problem with the observable as a whole (e.g. too many terms). */
  form: string | null
  /** Index-aligned with the draft's terms. */
  terms: TermIssues[]
  /**
   * Things that are LEGAL and almost certainly not what was meant. Kept apart
   * from errors on purpose: the server accepts these, so calling them errors
   * here would make this echo stricter than the thing it echoes.
   */
  warnings: string[]
}

/** The result of checking a whole draft list. */
export interface ValidationResult {
  /** True when `payload` is safe to submit. */
  ok: boolean
  /** The exact body for `observables`, or null when anything is wrong. */
  payload: Observable[] | null
  /** A problem with the list itself rather than with one observable. */
  formError: string | null
  /** Index-aligned with the drafts passed in. */
  issues: ObservableIssues[]
}

let counter = 0

/**
 * Mint a draft-local id.
 *
 * Only ever used as a React key and as a DOM id suffix, never sent anywhere,
 * so a plain counter beats `crypto.randomUUID()` — which is absent in some
 * test and older-browser environments and would be a runtime failure in a
 * component whose whole job is typing into inputs.
 *
 * @param prefix Short tag, for readability in the DOM.
 * @returns An id unique within this page load.
 */
export function draftId(prefix: string): string {
  counter += 1
  return `${prefix}${counter}`
}

/**
 * Build a Pauli string that acts on the given qubits and is identity elsewhere.
 *
 * @param numQubits Width of the circuit the observable is written against.
 * @param acting Map of qubit index (0-based, 0 = least significant) to letter.
 * @returns A string of length `numQubits`, qubit 0 RIGHTMOST (Qiskit order).
 */
export function pauliOnQubits(numQubits: number, acting: Record<number, string>): string {
  const letters: string[] = []
  for (let qubit = numQubits - 1; qubit >= 0; qubit -= 1) {
    letters.push(acting[qubit] ?? 'I')
  }
  return letters.join('')
}

/** An identity string of the circuit's width — the starting point for a new term. */
export function identityPauli(numQubits: number): string {
  return 'I'.repeat(Math.max(1, numQubits))
}

/**
 * A blank observable, pre-filled with one identity term of the right width.
 *
 * Pre-filling with identity rather than an empty box is the point: the user's
 * first act is to change a letter, so the string is the right LENGTH by
 * construction and the padding rule never has to be learned the hard way.
 *
 * @param numQubits Width of the circuit.
 * @param label Optional starting label.
 * @returns A fresh draft with fresh ids.
 */
export function emptyObservable(numQubits: number, label = ''): ObservableDraft {
  return {
    id: draftId('obs'),
    label,
    terms: [{ id: draftId('term'), pauli: identityPauli(numQubits), coefficient: '1' }],
  }
}

/** A fresh term, identity over the circuit width, coefficient 1. */
export function emptyTerm(numQubits: number): TermDraft {
  return { id: draftId('term'), pauli: identityPauli(numQubits), coefficient: '1' }
}

/**
 * Check one term against the circuit width.
 *
 * @param term The draft term.
 * @param numQubits Qubits in the circuit the observable is written against.
 * @returns Per-field messages; both null when the term is submittable.
 */
export function validateTerm(term: TermDraft, numQubits: number): TermIssues {
  const issues: TermIssues = { pauli: null, coefficient: null }

  const pauli = term.pauli.trim().toUpperCase()
  if (!pauli) {
    issues.pauli = 'A Pauli string is required, e.g. ' + identityPauli(numQubits) + '.'
  } else if (!PAULI_ALPHABET.test(pauli)) {
    // Name the offending characters: "invalid Pauli string" sends people
    // hunting through a 12-character string for the stray digit.
    const bad = Array.from(new Set(pauli.split('').filter((c) => !'IXYZ'.includes(c))))
    issues.pauli = `Only the letters I, X, Y and Z are Pauli operators — found ${bad
      .map((c) => `'${c}'`)
      .join(', ')}.`
  } else if (pauli.length !== numQubits) {
    issues.pauli = paddingMessage(pauli.length, numQubits)
  }

  // An empty coefficient means 1.0, matching the server, where `coefficient`
  // is optional and defaults to 1.0. Refusing a blank box for by far the most
  // common value would be friction with nothing behind it.
  const raw = term.coefficient.trim()
  if (raw && !DECIMAL.test(raw)) {
    issues.coefficient = `'${term.coefficient.trim()}' is not a real number. Use a decimal like 1, -0.5 or 2.5e-3.`
  } else if (raw && !Number.isFinite(Number(raw))) {
    // Well-formed decimal, unrepresentable double: '1e400' is Infinity, which
    // JSON.stringify writes as null. Caught here so the message names the
    // magnitude rather than arriving from the server as "must be a real
    // number" against a box that visibly contains one.
    issues.coefficient = `'${raw}' is too large to represent — it overflows to infinity. The largest usable coefficient is about 1.8e308.`
  }

  return issues
}

/**
 * Read a draft coefficient as a number, assuming it has already validated.
 *
 * @param raw The coefficient field's text.
 * @returns The number, or 1 for a blank field (the server's own default).
 */
export function coefficientValue(raw: string): number {
  const text = raw.trim()
  if (!text) return 1
  return Number(text)
}

/**
 * Check a whole draft list and, if it is clean, build the submit payload.
 *
 * Every rule here mirrors `parse_observables` in
 * services/api/app/quantum/observables.py. The server re-runs all of them; a
 * pass here is a prediction, not a guarantee.
 *
 * @param drafts The editor's current state.
 * @param numQubits Qubits in the circuit as the user wrote it — NOT the
 *   transpiled width. The server maps the observable through the device layout
 *   afterwards.
 * @returns Per-field messages plus the payload when everything checks out.
 */
export function validateObservables(
  drafts: readonly ObservableDraft[],
  numQubits: number,
): ValidationResult {
  const issues: ObservableIssues[] = []
  let formError: string | null = null

  // A width of 0 or NaN would tag every term in the list with a length message
  // that is really about the circuit, not about the term. Say it once instead,
  // and skip the per-term length check entirely.
  const widthKnown = Number.isInteger(numQubits) && numQubits >= 1

  if (drafts.length > MAX_OBSERVABLES) {
    formError =
      `At most ${MAX_OBSERVABLES} observables per job, got ${drafts.length}. Each one is a ` +
      'separate expectation value the device has to estimate.'
  } else if (!widthKnown) {
    formError = 'The circuit width is unknown, so observables cannot be checked against it yet.'
  }

  const seenLabels = new Set<string>()
  let anyFieldError = false

  for (const draft of drafts) {
    const entry: ObservableIssues = { label: null, form: null, terms: [], warnings: [] }

    const label = draft.label.trim().slice(0, MAX_LABEL_CHARS)
    if (!label) {
      // The server would refuse a blank string too, but the reason matters more
      // than the rule: the label is how the value is found in the result.
      entry.label = 'Give this observable a name — the result comes back keyed by it.'
    } else if (seenLabels.has(label)) {
      entry.label = `Duplicate label '${label}'. Labels must be unique, or the results are ambiguous in exactly the way labels exist to prevent.`
    } else {
      seenLabels.add(label)
    }

    if (draft.terms.length === 0) {
      entry.form = 'An observable needs at least one Pauli term.'
    } else if (draft.terms.length > MAX_TERMS_PER_OBSERVABLE) {
      entry.form = `This observable has ${draft.terms.length} terms; the maximum is ${MAX_TERMS_PER_OBSERVABLE}.`
    }

    /*
     * Warnings are DEDUPLICATED, and that is not cosmetic. The component keys
     * the rendered list on the warning text, so two terms that produce the same
     * sentence — `[["II",1],["II",1]]` produces the identity warning twice —
     * gave React two children with the same key, which it drops with a console
     * error. Ten repeated terms also meant ten identical lines of advice.
     */
    const warn = (message: string): void => {
      if (!entry.warnings.includes(message)) entry.warnings.push(message)
    }

    const seenPaulis = new Set<string>()
    for (const term of draft.terms) {
      const termIssues: TermIssues = widthKnown
        ? validateTerm(term, numQubits)
        : { pauli: null, coefficient: null }
      entry.terms.push(termIssues)

      const pauli = term.pauli.trim().toUpperCase()
      if (!termIssues.pauli) {
        if (seenPaulis.has(pauli)) {
          // Legal — SparsePauliOp keeps both and sums them — but two identical
          // Paulis in one sum is nearly always a copy-paste that was meant to
          // be edited.
          warn(
            `'${pauli}' appears more than once. That is legal (the coefficients add) but it is usually a copy that was not edited.`,
          )
        }
        seenPaulis.add(pauli)
        if (/^I+$/.test(pauli)) {
          warn(
            `'${pauli}' is the identity: its expectation value is always exactly 1, whatever the circuit does.`,
          )
        }
      }

      /*
       * Underflow, warned about rather than refused. '1e-400' is a legal
       * decimal that converts to exactly 0, so the term contributes nothing
       * while the box still shows the number the user typed. The server
       * accepts 0.0 — it is a real coefficient — so refusing here would make
       * this echo stricter than the thing it echoes; saying so is enough.
       */
      const rawCoefficient = term.coefficient.trim()
      if (
        !termIssues.coefficient &&
        rawCoefficient &&
        Number(rawCoefficient) === 0 &&
        !/^[+-]?0*\.?0*([eE][+-]?\d+)?$/.test(rawCoefficient)
      ) {
        warn(
          `'${rawCoefficient}' is smaller than a double can hold and becomes exactly 0, so that term contributes nothing.`,
        )
      }
    }

    if (entry.label || entry.form || entry.terms.some((t) => t.pauli || t.coefficient)) {
      anyFieldError = true
    }
    issues.push(entry)
  }

  if (drafts.length === 0) {
    // Not an error state in the editor: an empty list means "sample instead of
    // estimate", which is a legitimate choice. It just has no payload.
    return { ok: false, payload: null, formError: null, issues }
  }

  if (formError || anyFieldError) {
    return { ok: false, payload: null, formError, issues }
  }

  const payload: Observable[] = drafts.map((draft) => ({
    label: draft.label.trim().slice(0, MAX_LABEL_CHARS),
    terms: draft.terms.map((term) => ({
      pauli: term.pauli.trim().toUpperCase(),
      coefficient: coefficientValue(term.coefficient),
    })),
  }))

  return { ok: true, payload, formError: null, issues }
}

/**
 * The labels, in submission order, that the caller must keep to read the
 * results back.
 *
 * `GET /api/hardware/job/{provider}/{job_id}?observables=a,b,c` names the
 * returned values with these; the vendor stores the operators but not our
 * names for them, so a lost label list means three anonymous floats.
 *
 * @param drafts The editor's current state.
 * @returns Comma-separated labels, ready to paste into that query parameter.
 */
export function labelQueryString(drafts: readonly ObservableDraft[]): string {
  return drafts
    .map((draft) => draft.label.trim())
    .filter(Boolean)
    .join(',')
}

/**
 * Does this OpenQASM source contain a measure instruction?
 *
 * WHY THE EDITOR NEEDS THIS. `lib/quantum.ts::toQasm` unconditionally appends
 * `c = measure q;` to every circuit it writes, so EVERY circuit the /hardware
 * page stages has measurements — which means every Estimator submission from
 * that page is refused by
 * services/api/app/quantum/hardware.py::_has_measurements unless something
 * removes them first. This is the check that lets the editor say so before the
 * submit button is pressed.
 *
 * Deliberately a text scan, not a parse: this runs on every keystroke and the
 * app has no QASM AST on the client. It matches the `measure` keyword outside
 * comments and is therefore CONSERVATIVE in one direction — a `measure` inside
 * a string literal or an unusual gate name would be a false positive. Since a
 * false positive only shows a warning and a false negative would let a doomed
 * job be submitted, erring this way is the right side to be wrong on.
 *
 * @param qasm OpenQASM 3 source.
 * @returns True when at least one measure instruction appears to be present.
 */
export function hasMeasurements(qasm: string): boolean {
  return MEASURE.test(codeOnly(qasm))
}

/** The `measure` keyword. Non-global, so `.test` carries no lastIndex state. */
const MEASURE = /\bmeasure\b/

/**
 * The start of a classical conditional, for ANY register name.
 *
 * `if (c[` was the first spelling here and it was a hole: `lib/quantum.ts`
 * always names its register `c`, but a circuit pasted from Qiskit or from
 * another toolchain calls it `meas` or `creg`, and a conditional on one of
 * those went unreported — so {@link stripMeasurements} removed the measure that
 * fed it, said the circuit was clean, and a job that no longer computed what
 * the user wrote would have been submitted to a paid device. Every `if` in an
 * OpenQASM circuit this app can produce is a classical conditional, so matching
 * all of them costs nothing and closes that.
 */
const IF_STATEMENT = /\bif\s*\(/

/**
 * Drop `//` comments from every line, keeping the line structure.
 *
 * Block comments (`/* … *\/`) are NOT handled: spanning lines would need a
 * scanner with state, and the failure it would fix — a `measure` written inside
 * a block comment — reads as a false positive, which is the safe direction.
 *
 * @param qasm OpenQASM source.
 * @returns The same source with line comments blanked out.
 */
function codeOnly(qasm: string): string {
  return qasm
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/**
 * Remove measure instructions so a circuit can be submitted to the Estimator.
 *
 * THE SERVER WILL NOT DO THIS FOR YOU, and that is the correct design: a
 * terminal measurement collapses the state before the observable is applied,
 * so stripping one server-side would change the user's circuit on their behalf
 * and return a number for a circuit they never wrote. Doing it HERE is
 * different in the way that matters — it is visible, it is opt-in per
 * submission, and the editor tells the user it happened.
 *
 * WHAT IT DOES NOT HANDLE, all of which it REPORTS rather than guesses at:
 *
 *  - Feed-forward. `if (c[0] == true) { x q[1]; }` depends on a measured bit,
 *    so removing the measure leaves a gate reading a bit nobody wrote. Those
 *    lines are left alone and `conditionalsLeft` goes true, so the caller can
 *    refuse rather than submit a circuit whose meaning changed.
 *  - A measure SHARING A LINE with another statement, as in
 *    `x q[0]; c[0] = measure q[0];`. An earlier version deleted the whole line,
 *    which threw the `x` away as well — silently editing the user's circuit,
 *    the exact thing the paragraph above says the server is right not to do.
 *    Such a line is now kept intact, which leaves a `measure` in the output and
 *    therefore also raises `conditionalsLeft`: the caller refuses, the user
 *    splits the line, nothing is lost behind their back.
 *
 * The `bit[n] c;` declaration is left in place: an unused classical register is
 * harmless to Qiskit, and removing it would break exactly those conditional
 * lines this function refuses to touch.
 *
 * `conditionalsLeft` therefore means "this output is NOT safe to submit as it
 * stands" in general, not only "a conditional survived". Check it, always: a
 * caller that reads `removed` alone can submit a circuit this function knew was
 * broken.
 *
 * @param qasm OpenQASM 3 source.
 * @returns The stripped source, how many measure statements were removed, and
 *   whether anything survives that makes the result unsafe to submit — a
 *   conditional reading an unwritten bit, or a measure this refused to touch.
 */
export function stripMeasurements(qasm: string): {
  qasm: string
  removed: number
  conditionalsLeft: boolean
} {
  let removed = 0
  const kept: string[] = []
  for (const line of qasm.split('\n')) {
    const code = line.replace(/\/\/.*$/, '')
    if (!MEASURE.test(code) || IF_STATEMENT.test(code)) {
      kept.push(line)
      continue
    }
    // Only a line whose ENTIRE content is one measure statement is dropped.
    // Anything else on the line would go with it.
    const statements = code
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
    if (statements.length !== 1) {
      kept.push(line)
      continue
    }
    removed += 1
  }
  const result = kept.join('\n').replace(/\n{3,}/g, '\n\n')
  // Tested against the COMMENT-STRIPPED result, matching hasMeasurements. The
  // previous version scanned the raw text, so `// no measure here` survived the
  // strip and reported a clean circuit as unsafe with nothing the user could do
  // about it.
  const remaining = codeOnly(result)
  return {
    qasm: result,
    removed,
    conditionalsLeft: IF_STATEMENT.test(remaining) || MEASURE.test(remaining),
  }
}

/** A one-click starting point a physicist would actually reach for. */
export interface ObservablePreset {
  id: string
  /** Button text. Short — it sits in a row of them. */
  title: string
  /** What the preset measures, and why somebody would want it. */
  description: string
  /** Smallest circuit width this preset makes sense on. */
  minQubits: number
  /**
   * Build the drafts, with fresh ids.
   *
   * @param numQubits Circuit width.
   * @returns Drafts ready to become the editor's state.
   */
  build: (numQubits: number) => ObservableDraft[]
}

/**
 * The preset catalogue.
 *
 * Chosen for what they are used FOR, not for what is easy to generate:
 * per-qubit ⟨Z⟩ is what you read after a state-preparation circuit, ⟨ZZ⟩ and
 * ⟨XX⟩ together are the Bell correlators that tell entanglement from a
 * classical mixture, magnetisation is the Ising order parameter, and global
 * parity is the cheap population check.
 *
 * These are textbook definitions written from knowledge, not transcribed from a
 * cited source, and the descriptions say what each one CANNOT distinguish
 * rather than only what it measures — a preset that oversells what its number
 * proves is worse than no preset. The tests check only that every preset
 * produces a submittable draft at every width it offers itself at; the physics
 * in the prose is reviewed, not tested.
 */
export const OBSERVABLE_PRESETS: readonly ObservablePreset[] = [
  {
    id: 'single-z',
    title: 'Z on each qubit',
    description:
      'One observable per qubit. What you read after a state preparation: +1 means |0>, -1 means |1>, 0 means an equal superposition or a fully mixed state — those last two are NOT distinguished by Z alone.',
    minQubits: 1,
    build: (numQubits) =>
      Array.from({ length: Math.min(numQubits, MAX_OBSERVABLES) }, (_, qubit) => ({
        id: draftId('obs'),
        label: `Z${qubit}`,
        terms: [
          {
            id: draftId('term'),
            pauli: pauliOnQubits(numQubits, { [qubit]: 'Z' }),
            coefficient: '1',
          },
        ],
      })),
  },
  {
    id: 'bell-correlators',
    title: 'ZZ and XX',
    description:
      'The two-qubit correlators on qubits 0 and 1. A Bell state gives |ZZ| = |XX| = 1; a classical 50/50 mixture of |00> and |11> gives ZZ = 1 and XX = 0, which is how the pair tells entanglement from correlation.',
    minQubits: 2,
    build: (numQubits) => [
      {
        id: draftId('obs'),
        label: 'ZZ',
        terms: [
          {
            id: draftId('term'),
            pauli: pauliOnQubits(numQubits, { 0: 'Z', 1: 'Z' }),
            coefficient: '1',
          },
        ],
      },
      {
        id: draftId('obs'),
        label: 'XX',
        terms: [
          {
            id: draftId('term'),
            pauli: pauliOnQubits(numQubits, { 0: 'X', 1: 'X' }),
            coefficient: '1',
          },
        ],
      },
    ],
  },
  {
    id: 'magnetisation',
    title: 'Magnetisation',
    description:
      'One observable summing Z on every qubit, divided by the qubit count. The Ising order parameter: the average spin, in a single number between -1 and +1.',
    minQubits: 1,
    build: (numQubits) => [
      {
        id: draftId('obs'),
        label: 'M',
        terms: Array.from({ length: numQubits }, (_, qubit) => ({
          id: draftId('term'),
          pauli: pauliOnQubits(numQubits, { [qubit]: 'Z' }),
          // The full double, not a rounded one: at three qubits this box reads
          // '0.3333333333333333', which is ugly and is the point — rounding to
          // '0.333' would make the three coefficients sum to 0.999 and put a
          // 0.1% bias on an order parameter whose whole use is comparing runs.
          // The user can still shorten it by hand if they want the ugliness
          // gone and the bias with it.
          coefficient: String(1 / numQubits),
        })),
      },
    ],
  },
  {
    id: 'parity',
    title: 'Global parity',
    description:
      'Z on every qubit in one Pauli string: +1 on a basis state with an even number of excited qubits, -1 on an odd one. It measures populations only, so it detects bit flips and readout error but NOT loss of coherence — a GHZ state that has fully dephased into a classical mixture gives the same value as the real thing. On a GHZ state itself it is +1 for an even qubit count and exactly 0 for an odd one, which is the ideal answer and not a fault.',
    minQubits: 2,
    build: (numQubits) => [
      {
        id: draftId('obs'),
        label: 'parity',
        terms: [{ id: draftId('term'), pauli: 'Z'.repeat(numQubits), coefficient: '1' }],
      },
    ],
  },
]

/**
 * The presets that fit a circuit of this width.
 *
 * @param numQubits Circuit width.
 * @returns Presets whose `minQubits` the circuit satisfies.
 */
export function presetsForWidth(numQubits: number): ObservablePreset[] {
  return OBSERVABLE_PRESETS.filter((preset) => numQubits >= preset.minQubits)
}

/**
 * Re-pad every Pauli string in a draft list to a new circuit width.
 *
 * Called when the user swaps the staged circuit under an observable list they
 * already wrote. Widening pads on the LEFT, because qubit 0 is rightmost and
 * padding on the right would silently renumber every qubit in the string.
 * Narrowing drops the leftmost letters, which CAN discard a non-identity
 * operator — it is reported so the caller can warn rather than quietly change
 * what is being measured.
 *
 * @param drafts The current drafts.
 * @param numQubits The new circuit width.
 * @returns The re-padded drafts and whether any non-identity letter was lost.
 */
export function refitToWidth(
  drafts: readonly ObservableDraft[],
  numQubits: number,
): { drafts: ObservableDraft[]; lostOperators: boolean } {
  let lostOperators = false
  const next = drafts.map((draft) => ({
    ...draft,
    terms: draft.terms.map((term) => {
      const pauli = term.pauli.trim().toUpperCase()
      if (pauli.length === numQubits) return term
      if (pauli.length < numQubits) {
        return { ...term, pauli: 'I'.repeat(numQubits - pauli.length) + pauli }
      }
      const dropped = pauli.slice(0, pauli.length - numQubits)
      if (/[XYZ]/.test(dropped)) lostOperators = true
      return { ...term, pauli: pauli.slice(pauli.length - numQubits) }
    }),
  }))
  return { drafts: next, lostOperators }
}
