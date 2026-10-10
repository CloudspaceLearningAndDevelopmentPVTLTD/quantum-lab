#!/usr/bin/env node
/**
 * export-lessons.mjs — bridge the TypeScript course content into JSON for Python.
 *
 * The lessons live in `apps/web/lib/lessons/*.ts` as typed data (a discriminated
 * `LessonBlock` union). Python cannot import TypeScript, so this script emits a
 * plain JSON snapshot that the agent's RAG indexer consumes.
 *
 * HOW IT WORKS (no new dependencies):
 *   The TypeScript compiler already vendored in `node_modules/typescript` is used
 *   via `ts.transpileModule` to strip the types from the lesson modules into a temp
 *   directory as `.mjs`, which plain `node` then dynamically imports. That means we
 *   read the *real* exported data structures — no regex guessing at the content.
 *   Compiler options are read from `apps/web/tsconfig.json`.
 *
 *   The visualization catalogue goes through the same path. It used to be
 *   regex-parsed out of `components/ui/Hero.tsx` because that was a React
 *   component; the array has since moved to `lib/visualizations.ts`, a pure
 *   data module with no imports, so it is transpiled and imported for real —
 *   and the regex, which silently broke the moment the array moved (this
 *   script threw "VISUALIZATIONS array not found", and the committed
 *   lessons.json quietly fell behind the course), is gone.
 *
 * Usage:  node scripts/export-lessons.mjs
 * Output: services/agent/data/lessons.json
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WEB = path.join(ROOT, 'apps', 'web')
const LESSON_DIR = path.join(WEB, 'lib', 'lessons')
const VIZ_MODULE = path.join(WEB, 'lib', 'visualizations.ts')
const OUT = path.join(ROOT, 'services', 'agent', 'data', 'lessons.json')

/** Read the web app's compiler options, tolerating comments and trailing commas. */
function readCompilerOptions(ts) {
  const raw = fs.readFileSync(path.join(WEB, 'tsconfig.json'), 'utf8')
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', raw)
  const options = (parsed.config && parsed.config.compilerOptions) || {}
  return {
    // Keep the app's semantics, but emit something plain node can run.
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    esModuleInterop: options.esModuleInterop !== false,
    downlevelIteration: options.downlevelIteration === true,
    isolatedModules: true,
  }
}

/**
 * Transpile the lesson modules to a temp dir as .mjs and return the imported module.
 * Relative specifiers are rewritten to explicit .mjs paths, which node ESM requires.
 */
async function loadLessonModule() {
  const ts = require('typescript')
  const options = readCompilerOptions(ts)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-'))

  // Metadata lives in lib/lessons/*.ts and the prose in lib/lessons/bodies/*.ts
  // (split so the paid course text stays out of the client bundle — see the
  // header of lib/lessons/index.ts). Both halves are transpiled, preserving the
  // directory layout so `./tunneling` and `../types` keep resolving. Test files
  // and `server.ts` are skipped: the former are not data, and the latter imports
  // 'server-only', which plain node cannot resolve — the join it performs is
  // done below instead.
  const transpileDir = (dir, outDir) => {
    fs.mkdirSync(outDir, { recursive: true })
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'server.ts') continue
      const name = f.replace(/\.ts$/, '')
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      const emitted = ts.transpileModule(src, { compilerOptions: options, fileName: f })
      // `from './advanced'` -> `from './advanced.mjs'`
      const rewritten = emitted.outputText.replace(
        /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
        (_m, a, spec, b) => `${a}${spec}.mjs${b}`,
      )
      fs.writeFileSync(path.join(outDir, `${name}.mjs`), rewritten, 'utf8')
    }
  }
  transpileDir(LESSON_DIR, tmp)
  transpileDir(path.join(LESSON_DIR, 'bodies'), path.join(tmp, 'bodies'))

  const meta = await import(path.join(tmp, 'index.mjs'))
  const foundations = await import(path.join(tmp, 'bodies', 'foundations.mjs'))
  const advanced = await import(path.join(tmp, 'bodies', 'advanced.mjs'))
  fs.rmSync(tmp, { recursive: true, force: true })

  // The same join lib/lessons/server.ts performs: metadata + body, by slug.
  const bodies = new Map(
    [...foundations.FOUNDATION_BODIES, ...advanced.ADVANCED_BODIES].map((b) => [b.slug, b.blocks]),
  )
  const LESSONS = meta.LESSONS.map((lesson) => {
    const blocks = bodies.get(lesson.slug)
    if (!blocks) throw new Error(`No lesson body for ${lesson.slug} — outline exported without prose`)
    return { ...lesson, blocks }
  })
  return { LESSONS, TRACKS: meta.TRACKS }
}

const clean = (s) => String(s || '').replace(/[ \t]+\n/g, '\n').trim()

/**
 * Flatten one LessonBlock into human-readable text.
 * Quiz explanations are deliberately kept — they are some of the best prose in
 * the course and the answer to a lot of learner questions.
 */
function flattenBlock(block) {
  switch (block.kind) {
    case 'prose':
      return clean([block.title, ...(block.paragraphs || [])].filter(Boolean).join('\n\n'))
    case 'callout':
      return clean(`${block.title}\n${block.body}`)
    case 'code': {
      const parts = []
      if (block.caption) parts.push(block.caption)
      parts.push(`Code example (${block.language}):`)
      parts.push(block.code)
      return clean(parts.join('\n'))
    }
    case 'embed':
      return clean(`${block.title}\n${block.blurb}\n${block.href}`)
    case 'quiz':
      return clean(
        (block.questions || [])
          .map((q) => {
            const correct = (q.options || []).find((o) => o.id === q.correctId)
            return [
              `Question: ${q.prompt}`,
              correct ? `Answer: ${correct.text}` : null,
              q.explanation ? `Why: ${q.explanation}` : null,
            ]
              .filter(Boolean)
              .join('\n')
          })
          .join('\n\n'),
      )
    case 'keypoints':
      return clean((block.points || []).map((p) => `- ${p}`).join('\n'))
    default:
      return ''
  }
}

/** Map every lesson slug to the track that contains it. */
function trackBySlug(tracks) {
  const map = new Map()
  for (const track of tracks) {
    for (const slug of track.lessonSlugs) map.set(slug, track.id)
  }
  return map
}

/**
 * Transpile `lib/visualizations.ts` (pure data, no imports) and read its
 * VISUALIZATIONS export — the same mechanism as the lesson modules, no regex.
 */
async function readVisualizations() {
  const ts = require('typescript')
  const options = readCompilerOptions(ts)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-'))
  const src = fs.readFileSync(VIZ_MODULE, 'utf8')
  const emitted = ts.transpileModule(src, { compilerOptions: options, fileName: 'visualizations.ts' })
  const file = path.join(tmp, 'visualizations.mjs')
  fs.writeFileSync(file, emitted.outputText, 'utf8')
  const mod = await import(file)
  fs.rmSync(tmp, { recursive: true, force: true })
  if (!Array.isArray(mod.VISUALIZATIONS) || !mod.VISUALIZATIONS.length) {
    throw new Error('VISUALIZATIONS export not found in lib/visualizations.ts')
  }
  return mod.VISUALIZATIONS.map((viz) => ({
    slug: viz.href.replace(/^\/visualizations\//, ''),
    href: viz.href,
    title: viz.title,
    level: viz.level,
    tagline: viz.hook,
  }))
}

const wordCount = (s) => (s.match(/\S+/g) || []).length

async function main() {
  const mod = await loadLessonModule()
  const lessons = mod.LESSONS
  const tracks = mod.TRACKS
  if (!Array.isArray(lessons) || !lessons.length) {
    throw new Error('No lessons found — did the export shape of lib/lessons change?')
  }

  const byTrack = trackBySlug(tracks)
  const out = lessons.map((lesson) => ({
    slug: lesson.slug,
    title: lesson.title,
    subtitle: lesson.subtitle,
    level: lesson.level,
    minutes: lesson.minutes,
    track: byTrack.get(lesson.slug) || 'unassigned',
    blocks: lesson.blocks
      .map((block) => ({ kind: block.kind, text: flattenBlock(block) }))
      .filter((block) => block.text),
  }))

  const visualizations = await readVisualizations()

  const payload = {
    generated_by: 'scripts/export-lessons.mjs',
    generated_at: new Date().toISOString(),
    lessons: out,
    visualizations,
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')

  const blocks = out.reduce((n, l) => n + l.blocks.length, 0)
  const words = out.reduce(
    (n, l) => n + wordCount(`${l.title} ${l.subtitle}`) + l.blocks.reduce((k, b) => k + wordCount(b.text), 0),
    0,
  )
  console.log(`Wrote ${path.relative(ROOT, OUT)}`)
  console.log(`  lessons exported: ${out.length}`)
  console.log(`  blocks:           ${blocks}`)
  console.log(`  visualizations:   ${visualizations.length}`)
  console.log(`  total words:      ${words}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
