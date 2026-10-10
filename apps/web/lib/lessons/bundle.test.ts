/**
 * bundle.test.ts — proves that lesson BODIES are not reachable from the client.
 *
 * This is the test that makes the metadata/body split real rather than a
 * convention. It does two independent things:
 *
 *   1. IMPORT-GRAPH WALK. It reads every .ts/.tsx file under apps/web, finds
 *      the ones carrying the 'use client' directive, and follows their VALUE
 *      imports (type-only imports are erased by the compiler and cannot put a
 *      byte in a chunk). The set it reaches is, module for module, what Next
 *      hands to the client bundler as roots. If any of `lib/lessons/bodies/*`
 *      or `lib/lessons/server.ts` is in that closure, this fails and names the
 *      path that got it there.
 *
 *   2. SHAPE CHECK ON THE METADATA. Independent of the graph: it asserts that
 *      what `lib/lessons` actually exports, serialised, contains none of the
 *      prose, code, callouts or quiz text from any lesson body — including the
 *      free ones — and that outline entries carry no keys beyond `kind` and
 *      quiz question `id`s.
 *
 * WHAT IT DOES NOT PROVE. It is a static analysis of import statements, not a
 * measurement of a built chunk; `next build` is the only thing that measures
 * that, and this suite is not allowed to run one. The two facts it checks are
 * the ones a build would derive from, and (1) fails in CI in about a second
 * rather than after a four-minute build.
 *
 * The negative controls at the bottom are load-bearing: they assert that the
 * walker really does traverse into lib/lessons (metadata IS reachable from the
 * client) and that it really can see bodies when they are reachable (the lesson
 * page reaches them). Without those, a walker that silently resolved nothing
 * would pass every assertion above and prove nothing at all.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LESSONS } from './index'
import { allFullLessons } from './server'

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP_DIRS = new Set(['node_modules', '.next', 'public', 'tests', '.turbo', 'coverage'])
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

const BODY_MODULES = [
  'lib/lessons/bodies/foundations.ts',
  'lib/lessons/bodies/advanced.ts',
  'lib/lessons/bodies/tunneling.ts',
  'lib/lessons/server.ts',
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (EXTENSIONS.includes(path.extname(full))) out.push(full)
  }
  return out
}

/** Resolve a specifier the way tsconfig/webpack do here: '@/x' → apps/web/x. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(WEB_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier)
  else return null // a package; not our concern

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, 'index' + ext)),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not this one
    }
  }
  return null
}

/**
 * Value imports only. `import type { X }` and `export type { X } from` are
 * erased at compile time and ship nothing, so counting them would produce false
 * failures; `import { type X, y }` is a value import and IS counted, because y
 * is real.
 */
function valueImports(source: string): string[] {
  const out: string[] = []
  const patterns: RegExp[] = [
    /(?:^|[\n;])\s*import\s+(?!type\s)(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|[\n;])\s*export\s+(?!type\s)(?:\*|\{[\s\S]*?\})\s*(?:as\s+\w+\s*)?from\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1])
  }
  return out
}

function isClientModule(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use client['"]/.test(source)
}

const ALL_FILES = sourceFiles(WEB_ROOT)
const SOURCE = new Map(ALL_FILES.map((file) => [file, readFileSync(file, 'utf8')]))
const CLIENT_ENTRIES = ALL_FILES.filter((file) => isClientModule(SOURCE.get(file)!))

/** Everything reachable by value imports from `roots`, with the path that got there. */
function reachableFrom(roots: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue: { file: string; trail: string[] }[] = roots.map((file) => ({
    file,
    trail: [path.relative(WEB_ROOT, file)],
  }))
  while (queue.length > 0) {
    const { file, trail } = queue.shift()!
    if (seen.has(file)) continue
    seen.set(file, trail)
    const source = SOURCE.get(file) ?? (() => {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        return ''
      }
    })()
    for (const specifier of valueImports(source)) {
      const target = resolveSpecifier(file, specifier)
      if (target && !seen.has(target)) {
        queue.push({ file: target, trail: [...trail, path.relative(WEB_ROOT, target)] })
      }
    }
  }
  return seen
}

const CLIENT_GRAPH = reachableFrom(CLIENT_ENTRIES)

describe('lesson bodies are not in the client import graph', () => {
  it('found a client graph big enough to be believed', () => {
    // A walker that resolved nothing would pass every assertion below. Measured
    // on the tree this test was written against: 99 'use client' modules and
    // 137 modules reachable from them. The floors below are a sanity check that
    // the walk happened, not a budget, so a growing app does not fail here.
    expect(CLIENT_ENTRIES.length).toBeGreaterThan(20)
    expect(CLIENT_GRAPH.size).toBeGreaterThan(80)
  })

  it('reaches the lesson METADATA from the client, as designed', () => {
    // The chain the header of lib/lessons/index.ts describes: layout → SiteNav →
    // CommandPalette → lib/search/corpus → lib/lessons. If this ever stops
    // being true the test above stops meaning anything, because the walker
    // would no longer be entering lib/lessons at all.
    expect([...CLIENT_GRAPH.keys()]).toContain(path.join(WEB_ROOT, 'lib/lessons/index.ts'))
  })

  it.each(BODY_MODULES)('does not reach %s from any client component', (relative) => {
    const absolute = path.join(WEB_ROOT, relative)
    const trail = CLIENT_GRAPH.get(absolute)
    expect(
      trail,
      trail ? `lesson body reachable from the client via:\n  ${trail.join('\n  → ')}` : undefined,
    ).toBeUndefined()
  })

  it('does reach the bodies from the lesson page and the paid-content route', () => {
    // The negative control for the walker itself: it MUST be able to see body
    // modules when they really are imported, or the assertions above are
    // vacuous. These two server modules are the only intended readers.
    for (const server of ['app/learn/[slug]/page.tsx', 'app/learn/[slug]/content/route.ts']) {
      const graph = reachableFrom([path.join(WEB_ROOT, server)])
      expect(
        [...graph.keys()],
        `${server} cannot reach lesson bodies`,
      ).toContain(path.join(WEB_ROOT, 'lib/lessons/bodies/advanced.ts'))
    }
  })
})

describe('the metadata module carries no lesson text', () => {
  const serialised = JSON.stringify(LESSONS)

  it('contains none of the prose, code or quiz text of any lesson', () => {
    let sampled = 0
    for (const lesson of allFullLessons()) {
      for (const block of lesson.blocks) {
        const samples: string[] = []
        switch (block.kind) {
          case 'prose':
            samples.push(...block.paragraphs)
            break
          case 'callout':
            samples.push(block.body)
            break
          case 'code':
            samples.push(block.code)
            break
          case 'embed':
            samples.push(block.blurb)
            break
          case 'keypoints':
            samples.push(...block.points)
            break
          case 'quiz':
            for (const question of block.questions) {
              samples.push(question.prompt, question.explanation, ...question.options.map((o) => o.text))
            }
            break
        }
        for (const sample of samples) {
          // 60 characters is long enough that a match cannot be coincidence and
          // short enough to survive a copy-edit elsewhere in the paragraph.
          const probe = sample.trim().slice(0, 60)
          if (probe.length < 60) continue
          sampled += 1
          expect(serialised, `${lesson.slug}: body text found in LESSONS`).not.toContain(probe)
        }
      }
    }
    // Guards against the whole loop silently doing nothing.
    expect(sampled, 'no body text was sampled — the fixture is broken').toBeGreaterThan(200)
  })

  it('keeps the whole metadata export smaller than one lesson body', () => {
    // Measured on this tree: metadata + outlines 8,319 bytes as JSON against
    // 152,364 bytes of bodies, of which 68,707 is the paid advanced track. The
    // assertion is deliberately loose — it is here to fail loudly if someone
    // reintroduces block text into the metadata, not to police wording.
    expect(serialised.length).toBeLessThan(20_000)
  })

  it('exposes outline entries with no keys beyond kind and question ids', () => {
    for (const lesson of LESSONS) {
      for (const block of lesson.blocks) {
        const keys = Object.keys(block).sort()
        if (block.kind === 'quiz') {
          expect(keys, lesson.slug).toEqual(['kind', 'questions'])
          for (const question of block.questions) {
            expect(Object.keys(question), lesson.slug).toEqual(['id'])
          }
        } else {
          expect(keys, lesson.slug).toEqual(['kind'])
        }
      }
    }
  })
})
