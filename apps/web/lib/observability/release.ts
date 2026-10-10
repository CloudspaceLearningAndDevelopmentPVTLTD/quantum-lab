/**
 * release.ts — the version string attached to every error report.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. Without a release, a minified stack
 * trace in Sentry cannot be mapped back to a commit: source maps are uploaded
 * *under* a release name, and an event with no release matches no map. The
 * symptom is an issue page full of `t.default @ 4821-9c1.js:1:20461` and no way
 * to find the line. Setting this is what makes SENTRY_AUTH_TOKEN worth setting.
 *
 * THE CLIENT/SERVER ASYMMETRY IS REAL, not an oversight. Next inlines only
 * `NEXT_PUBLIC_*` into the browser bundle, so `VERCEL_GIT_COMMIT_SHA` — which
 * Vercel sets automatically — is visible on the server and invisible in the
 * browser. If you deploy on Vercel and set nothing, server events get a commit
 * sha and client events get `unknown`, and the client ones are the ones with
 * minified frames. So: SET `NEXT_PUBLIC_SENTRY_RELEASE` EXPLICITLY at build
 * time (`NEXT_PUBLIC_SENTRY_RELEASE=$VERCEL_GIT_COMMIT_SHA npm run build`) and
 * pass the same value to the source-map upload. docs/OPERATIONS.md has the
 * exact commands.
 *
 * Nothing here throws and nothing here is required: an unset release means the
 * literal string 'unknown', which is a worse debugging experience but not a
 * broken one.
 */

/**
 * The release identifier, or 'unknown'.
 *
 * Resolution order, first non-empty wins:
 *   1. NEXT_PUBLIC_SENTRY_RELEASE — explicit, and the only one that reaches the
 *      browser bundle.
 *   2. VERCEL_GIT_COMMIT_SHA      — server/edge only, set by Vercel.
 *   3. GITHUB_SHA                 — server only, set by GitHub Actions.
 */
export const RELEASE: string =
  (process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? '').trim() ||
  (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim() ||
  (process.env.GITHUB_SHA ?? '').trim() ||
  'unknown'

/**
 * The deployment environment Sentry groups and filters by.
 *
 * `VERCEL_ENV` distinguishes preview from production, which NODE_ENV cannot —
 * both are `production` in a preview build, and an alert firing on a preview
 * deploy at 2am is how people learn to ignore alerts.
 */
export const ENVIRONMENT: string =
  (process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? '').trim() ||
  (process.env.VERCEL_ENV ?? '').trim() ||
  process.env.NODE_ENV ||
  'development'
