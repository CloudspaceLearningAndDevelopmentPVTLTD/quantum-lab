#!/usr/bin/env node
/**
 * offline_probe.mjs — grade tier 3 of the tutor (the offline answer set).
 *
 * NO MODEL CALL, NO API KEY, NO NETWORK. This is the part of the harness that
 * belongs in CI, because the offline answers are the tier most likely to rot:
 * they are prose in a TypeScript array that nothing else exercises.
 *
 * It imports the REAL module — apps/web/app/api/agent/offlineFaq.ts — and calls
 * the real `offlineReply()`. A Node-side re-implementation of the keyword
 * matcher would be a test that still passes after the feature is deleted.
 *
 * HOW THE TYPESCRIPT IS LOADED
 *   Via `ts.transpileModule` from the `typescript` already vendored in the
 *   repo's node_modules — the same technique scripts/export-lessons.mjs uses to
 *   read the lesson data. Types are stripped and the result is imported as
 *   .mjs. `node --experimental-strip-types` would also work on Node >= 22.6,
 *   but CI pins Node 20 (.github/workflows/ci.yml), where that flag does not
 *   exist. Transpiling works on both, so the probe runs where CI actually runs.
 *
 *   This is why offlineFaq.ts must stay free of `next/*` imports and `@/`
 *   path aliases: nothing here resolves them.
 *
 * GRADING (see eval/rubric.mjs and eval/rubric.py for the shared rules)
 *   Each question in eval/questions.json declares an `offline_expect`: the FAQ
 *   key the router should land on, or `null` for a question the offline set is
 *   not expected to answer. Three outcomes are distinguished, because they are
 *   three different situations for a learner:
 *
 *     pass      — routed to the intended entry, every required fact present,
 *                 no unrefuted misconception.
 *     declined  — no entry matched and the fallback menu was returned, on a
 *                 question marked `offline_expect: null`. This is CORRECT
 *                 behaviour: saying "I don't have an offline answer for that"
 *                 is not a wrong answer.
 *     fail      — everything else: wrong entry, missing facts, a misconception,
 *                 or a decline on a question that was supposed to be covered.
 *
 * Usage:
 *   node services/agent/eval/offline_probe.mjs           # human-readable report
 *   node services/agent/eval/offline_probe.mjs --json    # machine-readable
 *
 * Exit code 0 when every question passes or correctly declines, 1 otherwise.
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gradeAnswer } from './rubric.mjs'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const FAQ_TS = path.join(ROOT, 'apps', 'web', 'app', 'api', 'agent', 'offlineFaq.ts')
const QUESTIONS = path.join(HERE, 'questions.json')

/** Transpile offlineFaq.ts to a temp .mjs and import the real exports. */
async function loadOfflineFaq() {
  const ts = require('typescript')
  const src = fs.readFileSync(FAQ_TS, 'utf8')
  const emitted = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
    fileName: 'offlineFaq.ts',
  })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-faq-'))
  const file = path.join(tmp, 'offlineFaq.mjs')
  fs.writeFileSync(file, emitted.outputText, 'utf8')
  try {
    return await import(file)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Re-run the router's own scoring to find which entry answered.
 *
 * `offlineReply()` returns only text, so the entry is identified by matching
 * the returned answer against the FAQ array — an exact string comparison, not
 * a second implementation of the scoring.
 */
function routedEntry(faq, reply) {
  for (const entry of faq) {
    if (reply.startsWith(entry.answer)) return entry
  }
  return null
}

async function main() {
  const json = process.argv.includes('--json')
  const qset = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'))
  const { FAQ, offlineReply } = await loadOfflineFaq()

  const results = []
  for (const question of qset.questions) {
    const reply = offlineReply(question.question)
    const entry = routedEntry(FAQ, reply)
    const expect = question.offline_expect ?? null
    const declined = entry === null

    if (declined) {
      results.push({
        questionId: question.id,
        topic: question.topic,
        outcome: expect === null ? 'declined' : 'fail',
        routedTo: null,
        expected: expect,
        coverage: 0,
        matched: [],
        missing: expect === null ? [] : (question.must_include ?? []).map((g) => g.name),
        violations: [],
        notes: expect === null ? ['no offline entry, fallback menu returned (expected)'] : [],
      })
      continue
    }

    const routedKey = entry.keys[0]
    const routedRight = expect !== null && entry.keys.some((k) => k === expect)
    const grade = gradeAnswer(question, reply, qset)
    const notes = [...grade.notes]
    if (expect === null) {
      notes.push(`answered from the '${routedKey}' entry, which the set did not expect`)
    } else if (!routedRight) {
      notes.push(`routed to '${routedKey}', expected an entry keyed '${expect}'`)
    }

    results.push({
      questionId: question.id,
      topic: question.topic,
      outcome: routedRight && grade.passed ? 'pass' : 'fail',
      routedTo: routedKey,
      expected: expect,
      coverage: grade.coverage,
      matched: grade.matched,
      missing: grade.missing,
      violations: grade.violations,
      notes,
    })
  }

  const passed = results.filter((r) => r.outcome === 'pass').length
  const declined = results.filter((r) => r.outcome === 'declined').length
  const failed = results.filter((r) => r.outcome === 'fail').length
  const summary = {
    tier: 'offline',
    module: 'apps/web/app/api/agent/offlineFaq.ts',
    modelCall: false,
    total: results.length,
    passed,
    declined,
    failed,
  }

  if (json) {
    console.log(JSON.stringify({ summary, results }, null, 2))
  } else {
    console.log('Tier: OFFLINE answer set (apps/web/app/api/agent/offlineFaq.ts) — no model call')
    console.log('='.repeat(78))
    for (const r of results) {
      const mark = r.outcome === 'pass' ? 'PASS' : r.outcome === 'declined' ? 'DECL' : 'FAIL'
      console.log(
        `${mark}  ${r.questionId.padEnd(32)} ${(r.routedTo ?? '(no entry)').padEnd(26)} ` +
          `${Math.round(r.coverage * 100)}%`,
      )
      for (const m of r.missing) console.log(`        missing: ${m}`)
      for (const v of r.violations) console.log(`        MISCONCEPTION: ${v}`)
      for (const n of r.notes) console.log(`        note: ${n}`)
    }
    console.log('='.repeat(78))
    console.log(
      `${passed}/${results.length} passed, ${declined} correctly declined, ${failed} failed`,
    )
  }

  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
