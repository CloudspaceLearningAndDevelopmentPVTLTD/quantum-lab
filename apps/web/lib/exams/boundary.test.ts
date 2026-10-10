/**
 * boundary.test.ts — the answer key does not reach the browser. Proven, not
 * asserted in a comment.
 *
 * ── Why a test that reads source files ──────────────────────────────────────
 *
 * The old design's whole failure was invisible to every runtime test you could
 * write: `lib/exams/questions.ts` was imported by `components/exam/ExamRunner`
 * and by `/certify`, both `'use client'`, so Next put the full bank (103
 * questions today) —
 * `correctIds`, `correctNumber`, `explanation` — into the JavaScript every
 * visitor downloaded. Nothing failed. The exam worked perfectly. It just could
 * not be passed honestly by anyone who opened a .js chunk.
 *
 * A unit test cannot see that, because in `vitest` everything runs on the
 * server and the answers are supposed to be there. What decides it is the
 * IMPORT GRAPH: which modules are reachable from a file marked `'use client'`.
 * So this test walks that graph over the real source tree.
 *
 * It is the test that would have caught the original design, and it is the test
 * that fails the day somebody adds a convenient `import { getQuestion }` to a
 * client component.
 *
 * ── What it costs to keep ───────────────────────────────────────────────────
 *
 * It resolves imports by trying `.ts`, `.tsx`, `/index.ts` and `/index.tsx`,
 * which is a simplification of what a bundler does — it does not read
 * tsconfig `paths` beyond the single `@/` alias this repo uses, and it ignores
 * bare specifiers (packages). That is enough for this codebase and will need
 * revisiting if the alias set grows. It does NOT need revisiting because
 * somebody added a file.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Modules that hold, or can trivially produce, a correct answer.
 * Anything reachable from a `'use client'` file is in the browser bundle.
 */
const SERVER_ONLY = [
  'lib/exams/questions.ts',
  'lib/exams/engine.ts',
  'lib/exams/service.ts',
  'lib/exams/store.ts',
  'lib/exams/session.ts',
]

const SOURCE_DIRS = ['app', 'components', 'lib']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const ALL_FILES = SOURCE_DIRS.flatMap((dir) => walk(join(WEB_ROOT, dir)))

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** Block and line comments removed, so prose about a field is not the field. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** `'use client'` must be the first statement, so a comment mentioning it does not count. */
function isClientEntry(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(source)
}

/** Every static import/export specifier, plus dynamic `import('…')`. */
function specifiers(source: string): string[] {
  const out: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) out.push(match[1])
    }
  }
  return out
}

/** Resolve a specifier to a file in this app, or null for a package. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(WEB_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not this one.
    }
  }
  return null
}

/** Every file reachable from `entry`, following imports. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    let source: string
    try {
      source = read(file)
    } catch {
      continue
    }
    for (const specifier of specifiers(source)) {
      const target = resolveSpecifier(file, specifier)
      if (target && !seen.has(target)) queue.push(target)
    }
  }
  return seen
}

describe('the question bank never reaches a browser bundle', () => {
  const clientEntries = ALL_FILES.filter((file) => isClientEntry(read(file)))

  it('finds the client components at all (a scan that matches nothing proves nothing)', () => {
    // If this ever drops to zero the test above becomes vacuous, which is
    // exactly the failure mode this repository's review kept finding.
    expect(clientEntries.length).toBeGreaterThan(20)
    /*
     * Compare with forward slashes on BOTH sides. ALL_FILES is built with
     * node:path join(), which emits backslashes on Windows, so
     * `endsWith('components/exam/ExamRunner.tsx')` could never match there —
     * this guard failed on every Windows run while passing in CI on Linux,
     * which is the most expensive shape a test failure can have: it looks like
     * a real regression to whoever is on Windows and is invisible to everyone
     * else. The assertion it guards ("no server-only exam module is reachable
     * from any client component") was always fine; only the did-the-scan-find-
     * anything check was broken.
     */
    const asPosix = (f: string) => f.split(sep).join('/')
    expect(
      clientEntries.some((f) => asPosix(f).endsWith('components/exam/ExamRunner.tsx')),
      'the exam runner is not being scanned'
    ).toBe(true)
  })

  it('no server-only exam module is reachable from any client component', () => {
    const offenders: string[] = []

    for (const entry of clientEntries) {
      const reachable = reachableFrom(entry)
      for (const serverOnly of SERVER_ONLY) {
        const full = join(WEB_ROOT, serverOnly)
        if (reachable.has(full)) {
          offenders.push(`${relative(WEB_ROOT, entry)} → ${serverOnly}`)
        }
      }
    }

    expect(
      offenders,
      `these client components pull a server-only exam module into the browser bundle:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('the client-safe catalogue carries no answer-shaped field', () => {
    // Comments stripped first: catalogue.ts's header NAMES these fields in
    // order to forbid them, and a test that failed on the warning label would
    // teach the next editor to delete the warning.
    const source = stripComments(read(join(WEB_ROOT, 'lib/exams/catalogue.ts')))
    for (const field of ['correctIds', 'correctNumber', 'tolerance', 'explanation']) {
      expect(source.includes(field), `catalogue.ts carries ${field}`).toBe(false)
    }
  })

  it('questions.ts refuses to load in a browser', () => {
    const source = read(join(WEB_ROOT, 'lib/exams/questions.ts'))
    // The guard is the backstop for a bundler configuration this test cannot
    // see. If someone deletes it, the only protection left is this file.
    expect(source).toMatch(/typeof window !== 'undefined'/)
    expect(source).toMatch(/throw new Error/)
  })
})

describe('the paper type cannot hold an answer', () => {
  it('PaperQuestion declares no key fields', () => {
    const source = read(join(WEB_ROOT, 'lib/exams/types.ts'))
    const start = source.indexOf('export interface PaperQuestion')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('}', start))
    for (const field of ['correctIds', 'correctNumber', 'tolerance', 'explanation']) {
      expect(body.includes(field), `PaperQuestion declares ${field}`).toBe(false)
    }
  })

  it('toPaperQuestion builds its result field by field, never by spreading', () => {
    const source = read(join(WEB_ROOT, 'lib/exams/engine.ts'))
    const start = source.indexOf('export function toPaperQuestion')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n}', start))
    // `{ ...q }` here would leak every future field added to ExamQuestion.
    expect(body.includes('...q'), 'toPaperQuestion spreads the bank question').toBe(false)
  })
})
