#!/usr/bin/env node
/**
 * check-sw-invalidation.mjs — executable proof that a new build invalidates the
 * service worker cache.
 *
 * WHY A SCRIPT AND NOT A vitest TEST
 * ----------------------------------
 * apps/web/vitest.config.ts has `include: ['lib/**\/*.test.ts']`, so a test file next
 * to the worker would never be collected, and this workstream does not own that
 * config. Rather than leave the behaviour unverified, this runs as its own CI step.
 * If the vitest include pattern is ever widened, moving this is a straight port.
 *
 * WHAT IT ACTUALLY EXERCISES
 * --------------------------
 * public/sw.js is loaded and RUN, twice, in a fake ServiceWorkerGlobalScope with a
 * fake Cache Storage — once as if registered by build A and once as build B. The
 * assertions are about observed behaviour (which caches exist after `activate`
 * resolves), not about the presence of a string in the source.
 *
 * The three source-level assertions at the end are the exception, and they exist
 * because the coupling they check spans three files and cannot be observed from
 * inside sw.js alone: sw.js reads `?v=` from its own URL, so if
 * ServiceWorkerRegistrar.tsx stops appending it, or next.config.mjs stops defining
 * it, every simulation here still passes while the real thing silently reverts to a
 * cache that never rotates. That is precisely the regression this file is for.
 *
 *   node scripts/check-sw-invalidation.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SW_PATH = resolve(REPO_ROOT, 'apps/web/public/sw.js')
const REGISTRAR_PATH = resolve(REPO_ROOT, 'apps/web/components/pwa/ServiceWorkerRegistrar.tsx')
const CONFIG_PATH = resolve(REPO_ROOT, 'apps/web/next.config.mjs')

const failures = []
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok    ${name}`)
  } else {
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`)
    failures.push(name)
  }
}

const swSource = readFileSync(SW_PATH, 'utf8')

/** Shared across "deploys", the way a browser's Cache Storage is. */
const cacheStore = new Map()

const caches = {
  open: async (name) => {
    if (!cacheStore.has(name)) cacheStore.set(name, new Map())
    const store = cacheStore.get(name)
    return {
      addAll: async (urls) => urls.forEach((u) => store.set(u, { url: u, ok: true })),
      put: async (req, res) => store.set(typeof req === 'string' ? req : req.url, res),
      match: async (req) => store.get(typeof req === 'string' ? req : req.url),
    }
  },
  keys: async () => [...cacheStore.keys()],
  delete: async (name) => cacheStore.delete(name),
}

/**
 * Boot sw.js as if the browser had fetched it from `scriptUrl`, then drive the
 * lifecycle: install -> (wait?) -> activate. Returns what happened.
 */
async function runWorker(scriptUrl) {
  const listeners = new Map()
  let skipWaitingCalls = 0
  let claimed = false

  const self = {
    location: new URL(scriptUrl),
    addEventListener: (type, fn) => listeners.set(type, fn),
    skipWaiting: () => {
      skipWaitingCalls += 1
    },
    clients: {
      claim: async () => {
        claimed = true
      },
    },
  }

  const sandbox = {
    self,
    caches,
    URL,
    Response: class Response {
      constructor(body, init = {}) {
        this.body = body
        this.status = init.status ?? 200
        this.ok = this.status >= 200 && this.status < 300
      }
    },
    fetch: async () => {
      throw new Error('network disabled in this harness')
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    console,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(swSource, vm.createContext(sandbox), { filename: SW_PATH })

  const fire = async (type) => {
    const fn = listeners.get(type)
    if (!fn) throw new Error(`sw.js registered no '${type}' listener`)
    const waits = []
    await fn({ waitUntil: (p) => waits.push(p), request: undefined, respondWith: () => {} })
    await Promise.all(waits)
  }

  await fire('install')
  const skipWaitingCallsAfterInstall = skipWaitingCalls
  await fire('activate')

  return {
    listeners,
    self,
    skipWaitingCallsAfterInstall,
    skipWaitingCalls: () => skipWaitingCalls,
    claimed: () => claimed,
    fireMessage: async (data) => {
      const fn = listeners.get('message')
      if (!fn) throw new Error("sw.js registered no 'message' listener")
      const waits = []
      await fn({ data, waitUntil: (p) => waits.push(p) })
      await Promise.all(waits)
    },
  }
}

console.log('\ncheck-sw-invalidation: driving apps/web/public/sw.js through two deploys\n')

// --- Deploy A ---------------------------------------------------------------
const a = await runWorker('https://example.test/sw.js?v=buildAAA')
const cachesAfterA = [...cacheStore.keys()]

check(
  'build A creates exactly one cache',
  cachesAfterA.length === 1,
  `caches after A: ${JSON.stringify(cachesAfterA)}`,
)
check(
  "build A's cache name contains its build stamp",
  cachesAfterA[0]?.includes('buildAAA'),
  `got ${cachesAfterA[0]}`,
)
check(
  'the app shell is precached (install did real work)',
  (cacheStore.get(cachesAfterA[0])?.size ?? 0) >= 4,
  `${cacheStore.get(cachesAfterA[0])?.size ?? 0} entries`,
)
check('build A claims clients on activate', a.claimed())
check(
  'install does NOT call skipWaiting — the update banner needs a waiting worker',
  a.skipWaitingCallsAfterInstall === 0,
  `skipWaiting() was called ${a.skipWaitingCallsAfterInstall}x during install`,
)

// Simulate the user browsing: a hashed chunk from build A gets cached.
const aCache = await caches.open(cachesAfterA[0])
await aCache.put('/_next/static/chunks/app/page-AAA.js', { ok: true })
check(
  "build A's chunk is served from cache",
  Boolean(await aCache.match('/_next/static/chunks/app/page-AAA.js')),
)

// --- Deploy B: same file, different build stamp ------------------------------
const b = await runWorker('https://example.test/sw.js?v=buildBBB')
const cachesAfterB = [...cacheStore.keys()]

check(
  'THE POINT: build B evicts build A — exactly one cache remains',
  cachesAfterB.length === 1,
  `caches after B: ${JSON.stringify(cachesAfterB)}`,
)
check(
  "the surviving cache is build B's",
  cachesAfterB[0]?.includes('buildBBB') && !cachesAfterB[0]?.includes('buildAAA'),
  `got ${cachesAfterB[0]}`,
)
check(
  "build A's stale chunk is gone, so no tab can be served last deploy's JS",
  !(await (await caches.open(cachesAfterB[0])).match('/_next/static/chunks/app/page-AAA.js')),
)

await b.fireMessage({ type: 'SKIP_WAITING' })
check(
  'the Reload button\'s SKIP_WAITING message does activate the waiting worker',
  b.skipWaitingCalls() === 1,
  `skipWaiting() called ${b.skipWaitingCalls()}x`,
)

// --- Control: same stamp twice must NOT churn the cache ----------------------
const before = cacheStore.get(cachesAfterB[0])?.size ?? 0
await (await caches.open(cachesAfterB[0])).put('/_next/static/chunks/keep-me.js', { ok: true })
await runWorker('https://example.test/sw.js?v=buildBBB')
check(
  'a re-registration at the SAME stamp keeps the cache (no needless eviction)',
  Boolean(await (await caches.open(cachesAfterB[0])).match('/_next/static/chunks/keep-me.js')) &&
    (cacheStore.get(cachesAfterB[0])?.size ?? 0) > before,
)

// --- The cross-file coupling sw.js cannot see --------------------------------
const registrar = readFileSync(REGISTRAR_PATH, 'utf8')
const config = readFileSync(CONFIG_PATH, 'utf8')

check(
  'ServiceWorkerRegistrar.tsx registers the worker WITH a ?v= build stamp',
  /register\(\s*SW_URL/.test(registrar) && /\/sw\.js\?v=\$\{/.test(registrar),
  "expected a SW_URL of the form `/sw.js?v=${...}` passed to register()",
)
check(
  'ServiceWorkerRegistrar.tsx sources that stamp from NEXT_PUBLIC_BUILD_STAMP',
  /process\.env\.NEXT_PUBLIC_BUILD_STAMP/.test(registrar),
)
check(
  'next.config.mjs exposes NEXT_PUBLIC_BUILD_STAMP to the client',
  /NEXT_PUBLIC_BUILD_STAMP:\s*BUILD_STAMP/.test(config),
)
check(
  'next.config.mjs ties Next’s build id to the same value',
  /generateBuildId:\s*\(\)\s*=>\s*BUILD_STAMP/.test(config),
)

console.log('')
if (failures.length) {
  console.error(
    `check-sw-invalidation: FAIL — ${failures.length} check(s) failed:\n` +
      failures.map((f) => `    ${f}`).join('\n') +
      '\n\n  A service worker that does not invalidate is worse than no service worker:\n' +
      '  it pins users to a deploy that no longer exists on the origin. See\n' +
      '  docs/PWA.md § "Deploy invalidation" before changing any of these.',
  )
  process.exit(1)
}
console.log('check-sw-invalidation: OK — a build stamp change rotates the cache.\n')
