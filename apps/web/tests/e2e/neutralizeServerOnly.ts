/**
 * Neutralise the `server-only` marker for THIS Playwright process.
 *
 * `lib/lessons/server.ts` imports `server-only`, whose default entry throws on
 * import — by design, so a client bundle can never ship the paid lesson
 * bodies. Under React's `react-server` resolution condition the same package
 * resolves to an empty module instead; plain Node (which is what runs a
 * Playwright spec) uses the throwing default.
 *
 * `learning.spec.ts` imports the server module deliberately: it is the only
 * way the spec can derive its prose probes from the real course data rather
 * than from pasted sentences that rot. So before that import runs, this module
 * puts an empty stub into the require cache under `server-only`'s resolved
 * path, which is exactly what the `react-server` condition would have handed
 * back. Playwright compiles specs to CommonJS, so import order is require
 * order and the cache entry is in place in time.
 *
 * Scope check, honestly: this affects only the Playwright worker process. The
 * Next.js app build never loads this file, and the guard in the real bundle is
 * untouched — a11y/learning specs still prove the paid bodies stay off the
 * client by inspecting the served pages, not by trusting this stub.
 */
const resolved = require.resolve('server-only')
if (!require.cache[resolved]) {
  const stub = new (require('module').Module)(resolved, null)
  stub.filename = resolved
  stub.loaded = true
  stub.exports = {}
  require.cache[resolved] = stub
}

export {}
