/**
 * rubric.mjs — the JavaScript half of the shared grading engine.
 *
 * This is a deliberate, line-by-line mirror of eval/rubric.py: the same
 * normalizer, the same must_include / must_not_include semantics, the same
 * refutation-cue heuristic. It exists because the offline answer set is
 * TypeScript that ships in the web app, and the only honest way to grade it is
 * to call the real matcher rather than a Python re-implementation that would
 * keep passing after the feature was deleted.
 *
 * If you change one of the two files, change the other. tests/test_eval.py
 * asserts that the normalizer tables agree, so a drift fails the Python suite.
 *
 * Read rubric.py's module docstring for what this grader can and cannot detect.
 * The short version: present-vocabulary checks are weak evidence of
 * comprehension; absent-misconception checks are strong evidence of error.
 */

/** Character folds applied before matching. Mirrors rubric.py NORMALIZE. */
export const NORMALIZE = [
  ['⟩', '>'],
  ['⟨', '<'],
  ['∣', '|'],
  ['−', '-'],
  ['–', '-'],
  ['—', '-'],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  [' ', ' '],
  ['²', '^2'],
  ['³', '^3'],
  ['ⁿ', '^n'],
  ['ˣ', '^x'],
  ['¹', '^1'],
  ['⁰', '^0'],
  ['⁻', '^-'],
  ['√', 'sqrt'],
  ['κ', 'kappa'],
  ['α', 'a'],
  ['β', 'b'],
  ['π', 'pi'],
  ['≈', '~'],
  ['≤', '<='],
  ['≥', '>='],
  ['×', '*'],
  ['⋅', '*'],
  ['′', "'"],
]

/** Lower-case and fold notation variants. Mirrors rubric.py normalize(). */
export function normalize(text) {
  let out = String(text ?? '')
  for (const [src, dst] of NORMALIZE) out = out.split(src).join(dst)
  return out.toLowerCase()
}

function cueNearby(text, start, end, cues, window) {
  const context = text.slice(Math.max(0, start - window), Math.min(text.length, end + window))
  for (const cue of cues) if (context.includes(cue)) return cue
  return null
}

/**
 * Grade one answer against one question's rubric.
 *
 * @returns {{questionId: string, passed: boolean, coverage: number,
 *            matched: string[], missing: string[], violations: string[],
 *            notes: string[]}}
 */
export function gradeAnswer(question, answer, qset) {
  const text = normalize(answer)
  const matched = []
  const missing = []
  const violations = []
  const notes = []

  for (const group of question.must_include ?? []) {
    const hit = (group.any ?? []).some((pattern) => new RegExp(pattern, 'i').test(text))
    ;(hit ? matched : missing).push(group.name)
  }

  for (const forbidden of question.must_not_include ?? []) {
    const re = new RegExp(forbidden.pattern, 'gi')
    const match = re.exec(text)
    if (!match) continue
    const cue = cueNearby(
      text,
      match.index,
      match.index + match[0].length,
      qset.refutation_cues,
      qset.refutation_window,
    )
    if (cue === null) violations.push(`${forbidden.name}: ${JSON.stringify(match[0])}`)
    else notes.push(`${forbidden.name}: quoted then refuted (cue ${JSON.stringify(cue)})`)
  }

  const total = matched.length + missing.length
  return {
    questionId: question.id,
    passed: missing.length === 0 && violations.length === 0,
    coverage: total === 0 ? 1 : matched.length / total,
    matched,
    missing,
    violations,
    notes,
  }
}
