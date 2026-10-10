# ADR-0006 — Lesson bodies live in server-only modules

**Status:** accepted · **Applies to:** `apps/web/lib/lessons/{index,server,access}.ts`, `lib/lessons/bodies/**`, `lib/lessons/bundle.test.ts`

## Context

The course is eleven lessons: seven free foundations and four paid advanced. The natural shape is
one array of lesson objects, each with its metadata and its `blocks`:

```ts
export const LESSONS = [{ slug: 'shor', title: '…', minutes: 30, blocks: [ … ] }, …]
```

`LESSONS` is needed on the client: the command palette searches lesson titles, the coach graph
reads prerequisites, progress rendering needs slugs and lengths.

## The failure

`app/layout.tsx` → `SiteNav` → `CommandPalette` → `lib/search/corpus.ts` → `lib/lessons`. That
chain makes the lesson module reachable from the client graph of **every page on the site**.

A bundler cannot drop a property of a reachable object literal. So `blocks` — 152,364 bytes of
lesson text, 68,707 of it the paid advanced track — shipped in the shared client chunk downloaded
by every visitor of every route.

The server-side gate was real and correct at the same time. The HTML was right; the API was right;
the JavaScript handed the paid course to everyone who loaded the home page. The paywall raised the
cost of reading four paid lessons from `curl` to "open a .js chunk in DevTools", which is a real
improvement and is not the same as withholding.

## Decision

Split metadata from body, and make the body module unreachable from client code.

| Module | Contents | Imported by |
| --- | --- | --- |
| `lib/lessons/index.ts` | metadata plus a text-free structural outline | client and server, freely |
| `lib/lessons/bodies/*` | the prose | **only** `lib/lessons/server.ts` |
| `lib/lessons/server.ts` | `getLessonBody`, `getFullLesson`, `allFullLessons` | `app/learn/[slug]/page.tsx` (Server Component) and `app/learn/[slug]/content/route.ts` |

Three things hold the property, in descending order of how much they are worth:

1. **`lib/lessons/bundle.test.ts`** builds the import graph of `apps/web` starting from every
   module marked `'use client'`, follows value (non-type) imports, and fails if any body module —
   or `server.ts` itself — is reachable. It tests the actual property, and it runs in
   `npx vitest run`.
2. **A `typeof window !== 'undefined'` throw** at the top of `server.ts`. It fires at import time
   in a browser, so an import that slipped past review dies loudly on the first page load rather
   than quietly shipping the course.
3. **Not `import 'server-only'`.** That package is not a dependency of this repo. It would be
   strictly better than (2) — it turns a client import into a *build* error — and it is worth
   adding the day someone owns `apps/web/package.json`.

## Consequences

- `getFullLesson` returns `undefined` when metadata exists but the body does not, so a half-added
  lesson 404s instead of rendering a title with nothing under it. `lessons.test.ts` asserts the two
  halves match for every lesson, so that branch should be unreachable in a green tree.
- Adding a lesson means editing two files. The test above is what stops that from becoming a
  silently broken page.
- The free foundations track is still served in full to everyone, including crawlers, by design.
- Nothing here stops a subscriber copying text out of a page they legitimately loaded, and nothing
  claims to.

## What must not be undone

Do not delete the `typeof window` throw to "fix" a build error — the error is the feature. Do not
import `lib/lessons/server` or `lib/lessons/bodies/*` from a component with `'use client'` at the
top, and do not weaken `bundle.test.ts` to make such an import pass.
