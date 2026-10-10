import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The '@/…' alias mirrors tsconfig.json's paths, so a test can import a route
  // handler (app/api/**) or a lib module by the same specifier the app uses.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Vitest resolves plain node/CJS conditions, not webpack's 'react-server'
      // condition, so `server-only`'s package.json exports would otherwise pick
      // its throwing `index.js` even here in a plain Node test. Point it at the
      // package's own empty module (what the 'react-server' condition resolves
      // to in a real server build) so lib/lessons/server.ts — legitimately
      // server-only in the app — stays importable from lib tests.
      'server-only': fileURLToPath(
        new URL('../../node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    // components/viz/** holds the physics engines behind the visualization pages
    // (period finding, the surface-code decoder, the VQE landscape). They are plain
    // TypeScript modules with no DOM dependency precisely so they can be tested
    // here; without this pattern their test files exist and never run.
    // components/hardware/** is here for the same reason: `observables.ts` is
    // the pure validation behind the observable editor, kept out of the .tsx
    // deliberately so it can be tested without a DOM. Its test file existed
    // and never ran until this pattern was added, which is the exact failure
    // the comment above describes — a test suite that is green because it is
    // not looking.
    // components/account/** is here for a third variant of the same reason:
    // the panels there are the surface where a credential is collected, and
    // their render tests assert on the DISCLOSURE — that the panel says what a
    // vendor token can do, and says it before the input rather than under it.
    // A test file sitting in a directory the runner does not look at is worse
    // than no test, because the suite is green either way.
    include: [
      'lib/**/*.test.ts',
      'components/viz/**/*.test.ts',
      'components/hardware/**/*.test.ts',
      'components/account/**/*.test.ts',
    ],
    globals: false,
    // The default 5s is measured against an idle machine. The full suite runs
    // ~190 files in parallel and several tests import a whole route handler
    // (Next + Supabase + Stripe module graphs) on first use; under that load a
    // cold import alone takes 5-7s, and the same tests passed in ~2s run on
    // their own. 20s keeps a real hang visible while ending the "fails only
    // in the full run" timeouts.
    testTimeout: 20_000,
    // …and half the cores, not all of them. With every core busy, the page-
    // render tests (components/viz/*Page.test.ts, lib/lessons/access.test.ts)
    // cold-import a full page graph while ~190 other files compete for CPU,
    // and time out even at 20s. They pass in seconds with room to run.
    maxWorkers: '50%',
    minWorkers: 1,
  },
})
