/**
 * instrumentation.ts — Next.js 14's register() hook.
 *
 * Validates the environment, then loads the right Sentry config for the runtime
 * that is actually booting, and only when a DSN exists. With no DSN the Sentry
 * configs are never even imported, so an unconfigured app pays nothing.
 *
 * `experimental.instrumentationHook` is set unconditionally in next.config.mjs
 * (not just inside its Sentry branch), so this file — and therefore the
 * `assertEnv()` call below — runs on every deployment, including the default
 * one with no Sentry DSN. `node scripts/preflight.mjs` remains available for
 * checking the environment before a deploy, with no build required.
 */

import { assertEnv } from '@/lib/env'

export async function register(): Promise<void> {
  // First, and on the Node runtime only. The edge runtime sees a narrower
  // process.env, so running it there would report server-only variables as
  // missing when they are present — a false alarm is worse than no alarm.
  if (process.env.NEXT_RUNTIME === 'nodejs') assertEnv()

  if (!(process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim()) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    return
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // The edge runtime gets its OWN config, not a reuse of the server one.
    // `withSentryConfig` looks for `sentry.edge.config.ts` by name when it
    // instruments the build. As of Next.js 16, proxy.ts (formerly
    // middleware.ts) always runs on the nodejs runtime, not edge, so this
    // branch is now reached only by routes that opt into
    // `export const runtime = 'edge'` (the opengraph-image.tsx routes).
    // Read that file's header before merging the two configs back together.
    await import('./sentry.edge.config')
  }
}
