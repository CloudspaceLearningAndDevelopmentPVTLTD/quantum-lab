# Web application

`apps/web` is a Next.js 16 App Router application in strict TypeScript. It contains 100 pages, 61 route handlers, 175 components and 202 test files.

## Rendering strategy

Pages are **static by default**. Because the session is carried in a header rather than a cookie, no page can know who is viewing it at render time, so every page renders identically for everyone and can be prerendered. The dynamic exceptions are explicit:

| Kind | Examples | Why dynamic |
| --- | --- | --- |
| `generateStaticParams` (SSG) | `learn/[slug]`, `certify/[examId]`, `challenges/[id]`, `paths/[slug]`, `glossary/[id]` | Prerendered from the catalogues at build time |
| `force-dynamic` pages | `/verify/[certificateId]`, `/runs/[publicId]`, `/benchmark` | Read a database row or a results file |
| `force-dynamic` handlers | `learn/[slug]/content`, `hardware/*`, `agent`, `mcp`, `health` | Per-request authorisation |

The paywall follows from this. A paid lesson's HTML contains its first three blocks for everyone (crawlers included, with `isAccessibleForFree: false` in the structured data), and `LessonShell` fetches the rest after mount from an authenticated route. There is no cloaking, and the paid prose is in neither the HTML nor the client bundle; a test walks the import graph to prove the second part.

Next.js's `generateBuildId` is pinned to a build stamp (`NEXT_PUBLIC_BUILD_STAMP`, else the git SHA) that is also the service worker's cache key, so a deploy and a cache rotation are the same event.

## Design system

Theme tokens are generated from `lib/theme/tokens.ts` into CSS custom properties: surfaces (`--bg`, `--surface`, `--line`), text (`--ink`, `--ink-secondary`, `--ink-muted`), five categorical hues (`--q-violet`, `--q-teal`, `--q-sky`, `--q-amber`, `--q-rose`) each with a contrast-tuned `-text` variant and an `-rgb` triplet. Dark is the default; light is a `.light` class; visitors without JavaScript get `prefers-color-scheme`.

Two decisions are recorded as ADRs because they are easy to undo by accident:

- **No `light-dark()`** (ADR-0001). Canvas and WebGL code reads `--q-violet` and friends through `getComputedStyle`, which must return a resolved colour.
- **Canvas colours are read at runtime** (ADR-0007), so a theme toggle recolours a running three.js scene.

A parser-blocking `ThemeScript` in `<head>` applies the stored theme before first paint. It is a static string and one of only two justified `dangerouslySetInnerHTML` uses in the codebase; the ESLint rule `react/no-danger` is an error everywhere else.

Utility classes in `@layer components` (`card`, `btn-primary`, `focus-ring`, `section-title`, `pill`) and shadcn/Radix primitives (dialog, dropdown, select, tabs, tooltip) make up the component vocabulary. Design rules in `CONTRIBUTING.md`: five hues in a fixed order, never a dual-axis chart, one hue for a single series, legends only for two or more series.

## Responsive layout

Tailwind's default breakpoints are used. Below `xl` (1280 px) the primary navigation is a drawer plus a bottom tab bar (`MobileTabBar`: Learn, Visualize, Simulate, Tutor, More), because the six primary links measured 603 px of an 820 px tablet bar. The body carries `padding-bottom: var(--mobile-nav-h)` with the safe-area inset so nothing hides under the bar.

A Playwright audit at six widths (320, 360, 390, 430, 768, 1024) found 41 routes wider than their viewport. The fixes became rules: grids declare `grid-cols-1` as a base, `1fr` tracks are `minmax(0,1fr)` so a long word cannot push a page sideways, form inputs are `text-base sm:text-sm` to stop iOS zooming on focus, and the `responsive-matrix` spec now asserts no horizontal overflow on every route at every width.

## Progressive web app

`public/sw.js` is a hand-written service worker with no build step:

- **Navigations** are network-first with a 3 s timeout, falling back to cached HTML and then `/offline`.
- **`/_next/static/`** is cache-first (immutable, hashed).
- **Other same-origin requests** are stale-while-revalidate.
- **`/api/`** is never cached; offline requests get a JSON fallback.

The cache name embeds the build stamp, so every deploy installs a new worker and drops the old cache. `scripts/check-sw-invalidation.mjs` runs the worker twice in a Node `vm` with a fake Cache Storage and asserts the rotation, and it runs as its own CI step because the worker is not a Vitest target. The manifest declares `standalone` display, maskable icons and three shortcuts.

## SEO and structured data

`lib/seo.ts` builds every page's metadata through one `pageMetadata()` call (canonical URL, Open Graph, Twitter card, description clamped to 155 characters). `components/seo/schema.ts` emits JSON-LD: `Course` and `LearningResource` for lessons, `SoftwareApplication`, `FAQPage` for pricing, breadcrumbs, and a `WebSite` node. The sitemap is generated from the same catalogues the pages render from, so a new lesson cannot be missing from it. 53 `opengraph-image.tsx` routes render social cards on the edge runtime. `public/llms.txt` is a hand-written summary for AI assistants.

## Integrations surface

Four layers, documented in `docs/INTEGRATIONS.md`:

1. **MCP server** at `/api/mcp/mcp`: a stateless Streamable-HTTP JSON-RPC handler of about 150 lines with no SDK dependency, exposing 17 tools (run a circuit, statevector at a step, list and grade challenges, export a notebook, lessons and gate reference, a verified generate→verify→repair loop, and five experiment-record tools). Everything except hardware submission is anonymous; submission requires a bearer token and dispatches internally to the real submit route so the full gate chain applies.
2. **REST tools** at `/api/tools`: `run_circuit` and `grade_challenge`, anonymous, 30 requests per minute per IP.
3. **Outbound webhooks**: HMAC-SHA256 signed (`x-quantum-lab-signature`), three events, at-least-once delivery with backoff, auto-disable after ten consecutive failures, and an SSRF guard that requires HTTPS and rejects private and special-purpose addresses at registration and again at dispatch.
4. **Embedding**: `/embed/circuit` and `public/embed.js`, with `frame-ancestors` widened only for that route and only to the configured allow-list.

Scoped API keys (`qb16_sk_` + 43 base64url characters from 32 CSPRNG bytes) are stored as a SHA-256 hash plus a 16-character display prefix. SHA-256 rather than a slow hash is deliberate and explained in the schema: the key carries 256 bits of entropy, so there is nothing for a password cracker to gain. Scopes are `hardware:read` and `hardware:submit`; a key cannot mint keys or reach account routes.

## Analytics

Local-first. Events go to a 1,000-entry `localStorage` ring buffer and leave the device only if `NEXT_PUBLIC_ANALYTICS_ENDPOINT` is set. Properties may only be strings, numbers or booleans; keys matching PII patterns (email, name, token, key, secret, password, phone, address) are dropped and strings are truncated to 64 characters before anything is sent. The `/insights` page computes its dashboards from the local buffer. The ingest route stores nothing unless both a table name and Supabase are configured, and returns 400, never 500, on a bad body.
