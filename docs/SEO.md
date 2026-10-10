# Findability — metadata, structured data, social cards, feeds

This is an educational product with no ad budget. Organic discovery is the
distribution channel, so the machine-readable surface of the site is a product
surface, not a chore. This document says what exists, what it deliberately does
not claim, and how to check any of it without guessing.

Everything below was verified against rendered output — HTML from the running
server, PNGs decoded and looked at, JSON-LD parsed and asserted. Where something
is still broken or unverified it says so.

---

## The one setting that silently breaks all of it

`NEXT_PUBLIC_APP_URL` must be set **in the production build environment**.

It is baked in at build time. A production build that runs without it emits
`http://localhost:3000` as every canonical URL, every `og:url`, every sitemap
entry, every `@id` in the structured data, and every link in the feed. Nothing
errors. Nothing warns. The pages simply never rank, and the social cards never
unfurl. Set it in the deployment environment, not in `.env.local`.

This is the single highest-consequence line in `apps/web/lib/seo.ts`.

---

## The files

| Path | Role |
| --- | --- |
| `apps/web/lib/seo.ts` | Site identity, `absoluteUrl`, `pageMetadata`. **Not owned by this workstream** — read it, do not restructure it. |
| `apps/web/app/sitemap.ts` | `/sitemap.xml`, derived from the catalogues. |
| `apps/web/app/robots.ts` | `/robots.txt`, generated. Do not add `public/robots.txt`. |
| `apps/web/app/feed.xml/route.ts` | Atom feed of the course, in teaching order. |
| `apps/web/app/opengraph-image.tsx` | Default social card, inherited by every route without its own. |
| `apps/web/app/learn/[slug]/opengraph-image.tsx` | Per-lesson card (one file, eleven cards). |
| `apps/web/app/visualizations/*/opengraph-image.tsx` | Per-visualization card, eight files of six lines. |
| `apps/web/components/seo/og.tsx` | The card layout everything above is drawn with. |
| `apps/web/components/seo/vizCard.tsx` | Builds a card input from a `VISUALIZATIONS` entry. |
| `apps/web/components/seo/schema.ts` | Every JSON-LD node the site emits. |
| `apps/web/components/seo/JsonLd.tsx` | Renders one `<script type="application/ld+json">`. |
| `apps/web/components/seo/content-version.ts` | `CONTENT_UPDATED` — the sitemap and feed `lastmod`. |
| `apps/web/app/*/layout.tsx` | Per-route metadata, and the mount point for that route's JSON-LD. |

---

## Metadata

Every route has a title and description written for a person deciding whether to
click. `tests/e2e/routes.spec.ts` asserts every route has a distinct non-empty
`<title>`; that is a floor, not the bar.

Client-component pages cannot export `metadata`, so they carry a sibling
`layout.tsx` that does. That pattern predates this pass and is used everywhere.
Dynamic routes (`/learn/[slug]`, `/challenges/[id]`, `/certify/[examId]`) use
`generateMetadata` in `page.tsx`, and all three now go through `pageMetadata` —
before this pass they hand-built a `{ title, description }` object and therefore
had **no canonical URL and no Open Graph tags at all**. The lesson route also
used an em dash separator where the other ~56 routes use `·`.

### Copy corrections made because the old text was not true

These were metadata bugs, not style preferences:

- `/simulator` advertised "a 16-qubit state-vector simulator ... no account". 16
  is the Team/University ceiling. An anonymous visitor gets
  `PLAN_BY_ID.free.limits.maxQubits`, which is **5** —
  `app/simulator/page.tsx` clamps the picker to `maxQubitsFor(entitlement)`. The
  description now states both numbers and reads them from `lib/plans.ts`.
- `/tutor` promised every answer was verified by running the circuit. The tutor
  has three tiers and only the top one runs circuits; the bottom one is a fixed
  offline answer set. The description now says the page tells you which tier
  replied, which is what it actually does.
- `/visualizations` wrote the count out as "Eight" in both title and
  description. It is now `VISUALIZATIONS.length`.
- The eight visualization descriptions all ended with the same sentence
  ("An interactive simulation, computed live in your browser"). Eight results
  with an identical tail is one result as far as a person scanning a page is
  concerned. Each now names the controls that page actually has — T1 and T2, the
  which-path detector, the barrier height, the oracle and diffusion steps.
- `/instructor` was in the sitemap at priority 0.5. It is an authoring tool that
  emits unreviewed model output about quantum mechanics. It is now `noIndex`,
  disallowed in robots.txt, and absent from the sitemap.

### Descriptions are kept under ~155 characters

Google truncates around there. All 28 visualization descriptions are 133–155;
the important clause is first in all of them, because truncation is a
possibility you plan for rather than a rule you obey.

This is a rule a new page could only break silently — sixteen visualizations
landed at once and every one of them overshot, because nothing checked. So it
is now a test: `lib/seo.test.ts` reads the description out of each route in
`VISUALIZATIONS` and fails if any exceeds 155 characters. The rest of the site
is held to the same rule by a second test covering every other statically-described
public route (`/about`, `/compare`, `/educators`, `/help`, and fourteen more —
`lib/seo.test.ts`'s "site meta descriptions" block). `/simulator` and
`/visualizations` build their description from a template literal (a qubit
limit, a catalogue count) the regex the other tests use cannot read off the
source, so they get their own tests that compute the real string instead —
which is how they were found at 226 and 186 characters respectively, silently
past the limit, before this pass.

---

## Structured data

One rule: **only claim what the page actually is.** Structured data describing
content the page does not contain is a manual-action risk, not a growth hack.

| Page | Nodes |
| --- | --- |
| `/` | `Organization`, `WebSite` |
| `/learn` (and, by inheritance, every lesson) | two `Course` nodes, one per track |
| `/learn/<slug>` | `LearningResource` + `BreadcrumbList` |
| `/visualizations/<slug>` | `LearningResource` (`Simulation`) + `BreadcrumbList` |
| `/simulator` | `SoftwareApplication` |
| `/pricing` | `FAQPage` |
| `/learn/certificate`, `/challenges/<id>`, `/certify/<id>` | `BreadcrumbList` |
| `/workbench` | `ItemList` of the tools + `BreadcrumbList` |
| `/workbench/<tool>` | `WebApplication` + `BreadcrumbList` (`workbenchToolSchemas`) |
| `/glossary` | `DefinedTermSet` of every term + `BreadcrumbList` |
| `/glossary/<term>` | `DefinedTerm` (same `@id` as the index's) + `BreadcrumbList` |

### What is deliberately NOT claimed, and why

- **No `aggregateRating` anywhere.** There is no review system in this product.
  Invented star ratings are the most common `SoftwareApplication` spam pattern
  and are grounds for a manual action.
- **No `sameAs` on the Organization.** That property is for verified profiles on
  other services and this deployment has none configured.
- **No `SearchAction`.** It promises a URL template a crawler can query, and
  there is no `/search` route — the palette in `components/search` is
  client-side with no addressable results page. Ship the route first.
- **No `Quiz` on `/challenges/<id>` or `/certify/<id>`.** A challenge is graded
  by simulating what the learner built; there is no answer string. Exam questions
  are drawn from a pool at attempt time and are not in the served HTML.
- **No `instructor` on the `CourseInstance`.** schema.org expects a `Person`
  there and this course does not have one.

### Three things this section used to say that are no longer true

Each was accurate when written and has been overtaken by code. They are corrections, and the
missing markup is a real, currently-open item rather than a hypothetical.

- **`isAccessibleForFree` on advanced lessons.** This said the paywall was not wired up, that
  `lib/lessons/access.ts` had no callers, and that `LessonShell` rendered `lesson.blocks` in full.
  All three are now false. `app/learn/[slug]/page.tsx` renders `previewBlocks(lesson, false)` for
  every document request, so a crawler receives exactly `FREE_PREVIEW_BLOCKS = 3` blocks and the
  tail is never serialised into the HTML; `app/learn/[slug]/content/route.ts` serves that tail only
  to a caller `verifiedCallerId` + `requireFeature('course.advanced')` has cleared;
  `components/seo/schema.ts` imports `isLessonFree` and `trackForLesson` from that module today.
  **`isAccessibleForFree: false` is now the accurate claim on an advanced lesson and is not
  emitted. Add it.**
- **`offers` on the advanced `Course`.** Omitted for the same reason, and defensible for the same
  reason it no longer holds. The foundations track keeps `offers` at price 0, which is exactly what
  the app serves.
- **`EducationalOccupationalCredential` on `/learn/certificate`.** This said certificates are
  issued from browser-local progress with no server-side record and nothing a third party could
  verify. There is now `public.exam_certificates`, a `GET /api/exams/verify/[certificateId]` route
  that is deliberately unauthenticated, and a `/verify/[certificateId]` page. A certificate earned
  through a **server-graded** attempt is verifiable by a stranger. Note the qualification before
  emitting markup: the holder's display name is self-attested at issue (`/verify` says so in as
  many words), so any credential node must not imply identity verification.
- **No `instructor` on the `CourseInstance`.** schema.org expects a `Person`
  there and this course does not have one.

### Two things that look like bugs and are not

**The Course nodes appear on lesson pages too.** `app/learn/layout.tsx` wraps
`/learn/<slug>`, and the layout is the only file in that segment this workstream
owns. That is why every shared node carries a stable `@id`
(`…/learn#course-foundations`) and each lesson's `LearningResource` points at it
via `isPartOf` — a consumer resolves both copies to one entity. Removing the
`@id`s would turn this into a real duplication bug.

**References carry a name, not just an `@id`.** A bare `{ "@id": … }` only
resolves if the full node is in the same document, and the full `Organization`
lives only on the home page. `provider` on `/learn` would dangle, and Google
drops a `Course` whose provider has no name. Every cross-page reference restates
`@type` + `name` + `url` alongside the shared `@id`.

### Types

`components/seo/schema.ts` uses hand-rolled structural types, not
[`schema-dts`](https://github.com/google/schema-dts). That package is not a
dependency and `package.json` belongs to another workstream. **Suggested
follow-up for whoever owns it:** `npm i -D schema-dts` and type the builders as
`WithContext<Course>` etc.; that would catch a property that is valid English
and invalid schema.org, which the current types cannot.

---

## Social cards

`app/opengraph-image.tsx` is the default. It does **not** cascade on its own to
a route that sets an `openGraph` object (which is every `pageMetadata` route) —
`pageMetadata` names it explicitly; see the October 2026 audit below. Lessons and
visualizations define their own, generated from their own catalogue entries —
there is no hand-maintained card anywhere.

There are **no `twitter-image` routes and there should not be.** Next reuses
`opengraph-image` for `twitter:image` when no `twitter-image` exists; the served
HTML confirms it (`meta name="twitter:image" content=".../opengraph-image?…"`).
A second set of files would be a second set of things to keep in sync for an
identical result.

### Emoji do not render. This was measured.

The first version of these cards put each visualization's emoji (🌊, 🔮, 🔗) on
its card and an ⚛ in the wordmark tile — as `app/opengraph-image.tsx` had done
since it was written. Rendering the PNGs and looking at them shows the glyphs are
simply **absent**: `next/og` ships no emoji font, and Satori drops a glyph it
cannot resolve rather than erroring, so the route "succeeds" with a hole in the
image. `new ImageResponse(…, { emoji: 'twemoji' })` fixes it by fetching SVGs
from a CDN at render time, which trades a silent visual bug for a silent network
dependency inside an image route. Both cards now use a per-page accent colour
instead. **Do not put a symbol back without rendering the file and reading the
image.**

### Legibility at the size these are actually seen

A Slack unfurl renders the card around 360px wide; an X timeline card around
250px — a ~4.8x downscale. Measured on real downscaled renders:

| element | source | at 250px | verdict |
| --- | --- | --- | --- |
| title | 104 / 88 / 72px | 22 / 18 / 15px | reads at a glance |
| kicker | 34px | ~7px | readable, with effort |
| eyebrow | 26px | ~5px | strained — texture only |

So the hierarchy is deliberately shallow: one element (the title) is meant to
survive the thumbnail. A fourth text block would shrink the title and buy
nothing.

`next/og` has no text measurement, so `titleSize()` steps the title size by
string length. The steps were chosen by rendering the longest real title in each
catalogue and checking it fits.

### Rendering a card without running a build

`next build` is off-limits while other agents are working. Bundle the route with
esbuild and call it directly:

```sh
cd /home/claude/quantum-lab
./node_modules/.bin/esbuild path/to/entry.tsx --bundle --platform=node \
  --format=cjs --outfile=.og-check.cjs --external:next/og --jsx=automatic \
  --alias:@=/home/claude/quantum-lab/apps/web
node .og-check.cjs          # writes PNGs; must run from the repo root so
                            # `next/og` resolves
```

where `entry.tsx` imports `vizCard`/`ogCard` and writes
`Buffer.from(await res.arrayBuffer())` to disk. Then **look at the PNG**, and
look at it downscaled — a card that is fine at 1200px and mush at 250px is a
card that failed.

---

## Canonicals

Every route emits `<link rel="canonical">` via `pageMetadata`. Two routes needed
fixing:

- **`/` had none.** It inherited the root layout's title and description and had
  no canonical, no `og:url` and no `og:type` — the only route on the site without
  them. It cannot use `pageMetadata` because its title is deliberately the
  long-form one rather than `<page> · Quantum Lab`, so `app/page.tsx` spells the
  fields out, including `metadataBase` (which `app/layout.tsx` does not set).
- **The three dynamic routes had none**, as described above.

---

## Search Console / Bing Webmaster verification

`app/layout.tsx` emits a `google-site-verification` and/or `msvalidate.01`
meta tag from `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` — unset by
default, and no tag is rendered until one is (see `.env.example` and
`lib/env.ts` for where to get the token and where to set it; both are [BUILD],
same as `NEXT_PUBLIC_APP_URL`).

**This is necessary but not sufficient for a new domain to appear in search
results.** Everything else in this document — metadata, structured data,
sitemap, canonicals — makes the site *correctly describable* to a crawler that
visits it. None of it makes a crawler visit a brand-new domain sooner, and
none of it is a ranking lever on its own. What actually gets a new domain
indexed:

1. Verify ownership in Search Console (the tag above) and Bing Webmaster
   Tools, then submit `https://qubit16.ai/sitemap.xml` in each.
2. Use each tool's "request indexing" / URL inspection on the home page at
   minimum. This asks for a crawl; it does not guarantee one on any schedule.
3. Get at least one real external link to the domain (a GitHub repo
   description/README, a Show HN or Product Hunt post, a directory listing).
   A domain with zero inbound links has nothing telling a crawler it exists
   or is worth revisiting, independent of how correct its own markup is.
4. Wait. Coverage for a new domain is commonly days to weeks, not minutes, and
   there is no code fix for that.

Ranking *first* for a query is a different problem again, decided by
competition for that term, domain age, and backlinks accumulated over time —
not by anything in this repository.

---

## Sitemap and feed

`app/sitemap.ts` derives every entry from the same catalogues the pages render
from: 204 URLs as of 3 October 2026, and a new lesson appears the moment it is added to
`lib/lessons`.

Excluded, each also `noIndex` at the route and disallowed in `robots.txt`:
`/account`, `/admin`, `/instructor`, `/offline`, `/api/*`. Three mechanisms,
because each covers a hole the others do not — robots stops a polite crawler
fetching, the meta tag stops a page reached by a link from being indexed, and
the sitemap omission stops us actively submitting it. **None of them is access
control.**

`/circuits`, `/coach` and `/insights` are kept despite being thin to a crawler:
they read from browser-local progress, so a crawler sees the empty state, but
that empty state is itself a real explanation of the feature, and all three are
linked from the nav — omitting a linked indexable page from the sitemap does not
stop it being crawled, it only hides it from Search Console coverage.

### `lastmod` is a constant, on purpose

`sitemap.ts` used to stamp every entry with `new Date()`, i.e. "all 57 URLs
changed at the instant you fetched this". For a site whose lessons are static
TypeScript literals that is false, and it is exactly the pattern that teaches a
crawler to ignore `lastmod` entirely — Google's documentation says as much.

`components/seo/content-version.ts` holds `CONTENT_UPDATED`, a date a human
bumps. **Bump it when you add, remove or materially rewrite a lesson,
visualization, challenge or exam. Do not bump it for CSS, typos or refactors** —
a `lastmod` that moves for cosmetic edits is the same lie in slower motion.

### The feed is Atom, and it is in teaching order

`/feed.xml`. Atom rather than RSS because RSS 2.0's date field is optional and
RFC-822 (parsed inconsistently) and Atom requires a stable `id` per entry, which
is what stops a reader re-showing all fourteen lessons every time the file changes.

Entries are **summaries, not full lessons**: every lesson has an inline quiz and
an embedded live visualization, neither of which survives serialization into a
feed reader, and shipping the prose alone would deliver the worse half of the
lesson to someone who then has no reason to open the real one.

Order is pedagogical, not newest-first. This feed's one job is "follow the
course"; lesson 1 has to arrive before lesson 2. All entries share one `updated`
date for the reason above — lessons carry no per-lesson date and inventing one
would be a lie a reader would act on.

The feed is declared with `alternates.types` on `/` and `/learn` rather than
sitewide, because it is the course, not the site. It cannot go in
`app/layout.tsx` in any case — that file belongs to another workstream.

---

## Performance, as far as SEO measures it

Re-verified against the build on disk with `node scripts/analyze-bundle.mjs`
(read-only; it parses `.next/build-manifest.json`, it does not build):

- **three.js is in exactly two components** (`components/viz/BlochSphere.tsx`,
  `components/viz/DecoherenceLab.tsx`), and both routes load them through
  `lazyViz(...)` with `ssr: false`. No other route imports three.js
  synchronously or otherwise. `/visualizations/bloch-sphere` is 350.2 kB raw on
  disk against a 462.7 kB median — it is now one of the *lightest* routes on the
  site. **0 routes flagged above 1.5x median.** The earlier 239 kB → 108 kB
  First Load JS win holds, and there is no second offender to fix.
- **The landing page has no canvas.** `app/page.tsx` renders `Hero`, three
  `FeatureCard`s and static prose; `Hero` is a server component whose background
  is a CSS radial gradient. The LCP element is the `<h1>`, which is in the
  server-rendered HTML and does not wait on hydration.

### One open LCP item

`components/ui/Hero.tsx` puts `animate-fade-up` on the container holding the
`<h1>`. That animation is `fade-up 0.4s ease-out both`, and its 0% keyframe is
`opacity: 0` — with `fill-mode: both`, the LCP element starts fully transparent
and Chrome does not count a fully transparent element for LCP. The h1 is also
`bg-clip-text text-transparent`, which interacts with LCP candidate selection in
its own right.

Reduced-motion users are unaffected (`globals.css` clamps every animation to
0.01ms under `prefers-reduced-motion: reduce`). Everyone else pays up to the
animation's duration on the site's most-linked page.

The fix — dropping the animation from the h1's container, or starting it at a
non-zero opacity — is one line in `components/ui/Hero.tsx`, which belongs to
another workstream. **Not done. Reported, not fixed.**

---

## Audit of 3 October 2026 — measured against the live site

All 133 sitemap URLs on `https://qubit16.ai` were fetched and their tags read.
What that found, and what was done:

| Finding | Scale | Status |
| --- | --- | --- |
| **No `og:image` / `twitter:image` at all.** The section above says the root card "cascades to every route that does not define its own". It does not: a route that sets its own `openGraph` object replaces the parent's, image included, and `pageMetadata` always sets one. | 63 pages — every route without its own card file | Fixed. `pageMetadata` names `/opengraph-image` explicitly, except on routes with their own card (`hasOwnSocialCard`, held to the filesystem by `lib/seo.test.ts`). |
| **Meta descriptions far over the limit.** Routes that build a description from catalogue prose (challenge brief, lesson subtitle, path tagline, exam subtitle) sent it whole. | 55 pages, worst 687 characters | Fixed. `clampDescription` in `pageMetadata` keeps whole sentences up to 155 characters. |
| **`/benchmark` had no canonical and its `og:image` pointed at `http://localhost:3000`.** It hand-built its metadata, and the root layout set no `metadataBase`. | 1 page | Fixed: uses `pageMetadata`; root layout now sets `metadataBase`. |
| **No structured data on any workbench page.** | 14 pages | Fixed, see the table above. |
| **The glossary's 62 terms shared one URL.** | 1 page holding 62 definitions | Each term now also has `/glossary/<id>`, in the sitemap. |
| **Sitemap `lastmod` was 2026-08-17** while content had changed since. | all URLs | `CONTENT_UPDATED` bumped. |
| **`public/llms.txt` did not mention the workbench, glossary or paths.** | — | Updated. |
| **`https://www.qubit16.ai` returns HTTP 525** (TLS handshake failure between Cloudflare and the origin). Anyone who types or links the `www` form gets an error page, and link equity pointed there is lost. | host-level | **Open — not a code change.** Add `www` as a custom domain on the web Container App (or a Cloudflare redirect rule `www` → apex). |
| `/certify/<id>` serves no `<h1>` in its HTML; the heading is rendered client-side by `ExamRunner` after load. | 2 pages | Open. |
| `isAccessibleForFree: false` on advanced lessons, as described under "Three things…" above. | advanced lessons | Still open. |

The "one open LCP item" under Performance is closed: `components/ui/Hero.tsx`
no longer puts `animate-fade-up` on the `<h1>`'s container.

One trap worth recording, because it cost a regression during this pass:
setting `openGraph.images` in config on a route that has its own
`opengraph-image` file is **not** harmless. `og:image` kept the file on static
routes, but `twitter:image` switched to the configured image, and on
`/learn/<slug>` (card from `generateImageMetadata`) the configured image
replaced the lesson's card for both. Check both tags on both kinds of route.

---

## How to check any of this

```sh
# types
cd /home/claude/quantum-lab && npx tsc --noEmit -p apps/web/tsconfig.json

# what a route actually serves (against the LAST build on :3000 — your source
# changes are NOT live there)
curl -s http://localhost:3000/simulator | tr '>' '>\n' | grep -iE 'og:|twitter:|canonical|ld\+json'

# bundle sizes, no build
node scripts/analyze-bundle.mjs
```

To assert the JSON-LD, sitemap, robots and feed without a build, bundle them the
same way as the cards (`--external:next/og`, run from the repo root) and check
shapes directly. What was asserted in this pass: every node has `@context` and
`@type`; every `Course` has `name`, `description`, `provider` and a
`CourseInstance` with `courseMode` and an ISO-8601 `courseWorkload`; each
lesson's `isPartOf` resolves to a `Course` `@id` that exists; breadcrumb
positions are 1-based and contiguous with unique absolute URLs; the FAQ node has
exactly as many questions as the page renders; the sitemap has no duplicates,
contains `/`, `/welcome` and every lesson and visualization, and contains none of
`/account`, `/admin`, `/instructor`, `/offline`; robots disallows all four plus
`/api/`; the feed has one entry per lesson and the Atom content type.

**Not verified:** none of this has been through Google's Rich Results Test or
the schema.org validator, because that needs a public URL and this build has
never been deployed. Do that after the first deploy — it is the only check that
catches "valid JSON-LD that Google declines to use".
