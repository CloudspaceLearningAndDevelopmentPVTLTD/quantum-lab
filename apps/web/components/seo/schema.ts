/**
 * schema.ts — every JSON-LD node this site emits, built from the same data the
 * pages render from.
 *
 * TWO RULES, both of which have teeth:
 *
 * 1. ONLY CLAIM WHAT THE PAGE IS. Structured data that describes something the
 *    page does not contain is a manual-action risk ("Structured data issue"),
 *    not a clever growth hack. Every property below is checked against the
 *    rendered page. Where the app and the marketing copy disagree, the property
 *    is omitted rather than guessed — `isAccessibleForFree` on advanced lessons
 *    was omitted for exactly that reason until the paywall was actually served,
 *    and is asserted now because the served HTML backs it.
 *
 * 2. NOTHING IS HAND-MAINTAINED. Names, descriptions, durations and counts come
 *    from `lib/lessons`, `lib/exams`, `lib/challenges` and `components/ui/Hero`.
 *    A literal string here is a claim that drifts the first time someone edits
 *    a lesson.
 *
 * TYPES: these are hand-rolled structural types, not `schema-dts`. That package
 * is not a dependency and package.json belongs to another workstream, so the
 * types below cover exactly the vocabulary we emit and nothing else. They still
 * catch the failure that matters most in practice — a misspelled property name
 * silently producing a node with no meaning. See docs/SEO.md.
 */

import { absoluteUrl, SITE } from '@/lib/seo'
import { LESSONS, TRACKS, getLesson } from '@/lib/lessons'
import { PAYWALLED_SECTION_CLASS, isLessonFree, trackForLesson } from '@/lib/lessons/access'
// Metadata only, deliberately: this module renders structured data — titles,
// levels, durations, paywall selectors — and must never pull a lesson BODY into
// its import graph. `LessonMeta` is what `lib/lessons` exports now; a full
// `Lesson` is assignable to it, so nothing here loses the ability to be called
// from the server with a complete lesson.
import type { LessonMeta, Track } from '@/lib/lessons/types'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import { PLAN_BY_ID } from '@/lib/plans'
import { WORKBENCH } from '@/lib/workbench'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SchemaNode = { '@context': 'https://schema.org' } & SchemaThing

type SchemaThing = {
  '@type': string
  '@id'?: string
  [key: string]: unknown
}

/**
 * A minimal restatement of a node that is defined in full elsewhere.
 *
 * NOT a bare `{ '@id': ... }`. A bare id reference only resolves if the full
 * node is in the same document, and the full Organization is only on the home
 * page — so `provider: { '@id': … }` on /learn would dangle, and Google drops a
 * Course whose provider has no name. Carrying `@type` + `name` + `url` makes
 * every page self-sufficient, while the shared `@id` still tells a consumer
 * that all of these are the same entity rather than one per page.
 */
type OrgRef = {
  '@type': 'Organization'
  '@id': string
  name: string
  url: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable @ids
//
// A node that appears on more than one page (the organization, a track) must
// carry the SAME @id everywhere, or a consumer treats each copy as a separate
// entity. Fragment ids on canonical URLs are the conventional way to do that.
// ─────────────────────────────────────────────────────────────────────────────

export const ORG_ID = absoluteUrl('/#organization')
export const WEBSITE_ID = absoluteUrl('/#website')

/** @id for a track's Course node. */
function courseId(trackId: string): string {
  return `${absoluteUrl('/learn')}#course-${trackId}`
}

const orgRef: OrgRef = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE.name,
  url: absoluteUrl('/'),
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minutes as an ISO 8601 duration. schema.org `timeRequired` and
 * `courseWorkload` are Durations, not numbers — "8 minutes" is not a valid
 * value and is dropped by every validator.
 */
export function isoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `PT${h}H${m}M`
  if (h) return `PT${h}H`
  return `PT${m}M`
}

/** schema.org's `educationalLevel` takes free text; ours already matches. */
function levelOf(lesson: LessonMeta): string {
  return lesson.level
}

function lessonsIn(track: Track): LessonMeta[] {
  return track.lessonSlugs
    .map((slug) => getLesson(slug))
    .filter((lesson): lesson is LessonMeta => Boolean(lesson))
}

// ─────────────────────────────────────────────────────────────────────────────
// Site-level: Organization + WebSite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emitted once, on the home page.
 *
 * No `sameAs` array: that property is for verified profiles on other services,
 * and this deployment has none configured. An empty or speculative `sameAs` is
 * exactly the kind of unverifiable claim that makes the rest of the graph less
 * trusted.
 *
 * No `SearchAction` either: `potentialAction`/SearchAction promises a URL
 * template a crawler can query, and there is no `/search` route — the search UI
 * in `components/search` is a client-side palette over local data with no
 * addressable results page. Adding one means shipping that route first.
 */
export function siteSchema(): SchemaNode[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': ORG_ID,
      name: SITE.name,
      url: absoluteUrl('/'),
      description: SITE.description,
      logo: absoluteUrl('/icons/icon.svg'),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      name: SITE.name,
      url: absoluteUrl('/'),
      description: SITE.description,
      inLanguage: 'en',
      publisher: orgRef,
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Course
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One Course node per track.
 *
 * `provider` and `hasCourseInstance` are both required for Google's course rich
 * result; a Course without them validates as schema but is ineligible. The
 * instance is honest: the course is self-paced online material with no cohort,
 * so `courseMode: 'online'` and a `courseWorkload` summed from the lessons'
 * own `minutes` fields.
 *
 * `offers` appears only on the foundations track, where "free forever, no
 * account" is exactly what the pricing page promises and exactly what the app
 * serves. The advanced track carries `isAccessibleForFree: false` — its
 * paywall is live, per-lesson — but no `offers` node: it is not sold on its own
 * and has no price. What it has is inclusion in a $19/mo subscription, and an
 * `Offer` with `price: 19` would read to a consumer as "this course costs $19",
 * which is not true in either direction. The lesson-level nodes carry the
 * paywall markup that actually matters.
 */
export function courseSchema(track: Track): SchemaNode {
  const lessons = lessonsIn(track)
  const totalMinutes = lessons.reduce((sum, lesson) => sum + lesson.minutes, 0)
  const isFree = track.id === 'foundations'

  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': courseId(track.id),
    name: track.name,
    description: track.blurb,
    url: absoluteUrl('/learn'),
    provider: orgRef,
    inLanguage: 'en',
    educationalLevel: track.id === 'advanced' ? 'Advanced' : 'Beginner',
    teaches: lessons.flatMap((lesson) => lesson.objectives),
    // No `instructor`: schema.org expects a Person there, and this course does
    // not have one — it is written material with no named teacher. An
    // Organization in that slot would be a shape error dressed up as a fact.
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'online',
      courseWorkload: isoDuration(totalMinutes),
    },
    // Named, not bare `@id` references: the lesson nodes live on the lesson
    // pages, not in this document, so an id-only reference would dangle here.
    hasPart: lessons.map((lesson) => ({
      '@type': 'LearningResource',
      '@id': lessonId(lesson.slug),
      name: lesson.title,
      url: absoluteUrl(`/learn/${lesson.slug}`),
    })),
    ...(isFree
      ? {
          isAccessibleForFree: true,
          offers: {
            '@type': 'Offer',
            price: 0,
            priceCurrency: PLAN_BY_ID.free.currency.toUpperCase(),
            category: 'Free',
            availability: 'https://schema.org/InStock',
          },
        }
      : { isAccessibleForFree: false }),
  }
}

export function allCourseSchemas(): SchemaNode[] {
  return TRACKS.map(courseSchema)
}

// ─────────────────────────────────────────────────────────────────────────────
// LearningResource — one lesson
// ─────────────────────────────────────────────────────────────────────────────

function lessonId(slug: string): string {
  return `${absoluteUrl(`/learn/${slug}`)}#lesson`
}

/**
 * `teaches` is the lesson's own `objectives` array, which is the closest thing
 * schema.org has to a learning outcome and is already written as one ("Describe
 * what makes a qubit different from a classical bit").
 *
 * `isAccessibleForFree` now states a fact about the served page rather than an
 * intention. Foundations lessons are free and served in full: `true`. Advanced
 * lessons are served as a three-block preview plus a paywall to EVERY document
 * request — crawler and subscriber alike, because the page cannot identify the
 * caller (see app/learn/[slug]/page.tsx) — so they are `false`, with the
 * `hasPart` WebPageElement that Google's paywalled-content markup requires
 * pointing at the withheld section by class name.
 *
 * The two halves have to agree or this is worse than saying nothing: `false`
 * with no `hasPart` reads as "the whole page is gated" and can drop the page
 * from Search, and a `cssSelector` matching no element is a structured-data
 * issue. `PAYWALLED_SECTION_CLASS` is imported rather than typed out here so
 * the selector cannot drift from the markup `LessonShell` renders.
 */
export function lessonSchema(lesson: LessonMeta): SchemaNode {
  const url = absoluteUrl(`/learn/${lesson.slug}`)
  const track = trackForLesson(lesson.slug)

  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    '@id': lessonId(lesson.slug),
    name: lesson.title,
    description: lesson.subtitle,
    url,
    learningResourceType: 'Lesson',
    educationalLevel: levelOf(lesson),
    timeRequired: isoDuration(lesson.minutes),
    teaches: lesson.objectives,
    inLanguage: 'en',
    provider: orgRef,
    isPartOf: { '@id': courseId(track) },
    ...(lesson.prerequisites.length
      ? {
          coursePrerequisites: lesson.prerequisites.map((slug) => ({
            '@type': 'AlignmentObject',
            alignmentType: 'assesses',
            targetName: getLesson(slug)?.title ?? slug,
            targetUrl: absoluteUrl(`/learn/${slug}`),
          })),
        }
      : {}),
    ...(isLessonFree(lesson.slug)
      ? { isAccessibleForFree: true }
      : {
          isAccessibleForFree: false,
          hasPart: {
            '@type': 'WebPageElement',
            isAccessibleForFree: false,
            cssSelector: `.${PAYWALLED_SECTION_CLASS}`,
          },
        }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LearningResource — one visualization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A visualization page is an interactive simulation with surrounding prose, so
 * `learningResourceType: 'Simulation'` rather than 'Lesson'. Every one of them
 * computes its physics in the browser with no account, so `isAccessibleForFree`
 * is true without qualification.
 *
 * Deliberately NOT `SoftwareApplication`: these are pages inside an app, not
 * separately installable applications, and the SoftwareApplication rich result
 * expects an install/price story none of them has.
 */
export function visualizationSchema(href: string): SchemaNode | null {
  const viz = VISUALIZATIONS.find((v) => v.href === href)
  if (!viz) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    '@id': `${absoluteUrl(href)}#simulation`,
    name: viz.title,
    description: viz.hook,
    url: absoluteUrl(href),
    learningResourceType: 'Simulation',
    educationalLevel: viz.level,
    interactivityType: 'active',
    isAccessibleForFree: true,
    inLanguage: 'en',
    provider: orgRef,
  }
}

/**
 * Everything one visualization route emits: the Simulation node and the
 * Home › Visualizations › <page> trail, with the crumb's name taken from the
 * catalogue so it matches the card, the <h1> and the sitemap entry.
 *
 * An href with no catalogue entry yields the breadcrumb alone — a trail we can
 * still state truthfully — rather than a LearningResource with a made-up name.
 */
export function vizPageSchemas(href: string): SchemaNode[] {
  const viz = VISUALIZATIONS.find((v) => v.href === href)
  const node = visualizationSchema(href)

  return [
    ...(node ? [node] : []),
    breadcrumbSchema([
      HOME_CRUMB,
      { name: 'Visualizations', path: '/visualizations' },
      { name: viz?.title ?? 'Visualization', path: href },
    ]),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// SoftwareApplication — the simulator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one page on this site that genuinely is an application: a state-vector
 * simulator that runs entirely client-side.
 *
 * `offers` at price 0 is required for the rich result and is true — the free
 * plan runs the simulator up to `PLAN_BY_ID.free.limits.maxQubits` qubits with
 * no account. NO `aggregateRating`: there is no review system anywhere in this
 * product, and inventing star ratings is both the most common
 * SoftwareApplication spam pattern and grounds for a manual action.
 */
export function simulatorSchema(): SchemaNode {
  const freeQubits = PLAN_BY_ID.free.limits.maxQubits

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${absoluteUrl('/simulator')}#app`,
    name: 'Qubit16 Circuit Simulator',
    description:
      `A state-vector quantum circuit simulator that runs entirely in the browser: ` +
      `build a circuit gate by gate, inspect amplitudes and entanglement, sample shots, ` +
      `and import or export OpenQASM 3. Free up to ${freeQubits} qubits with no account.`,
    url: absoluteUrl('/simulator'),
    applicationCategory: 'EducationalApplication',
    applicationSubCategory: 'Quantum circuit simulator',
    operatingSystem: 'Any modern web browser',
    browserRequirements: 'Requires JavaScript. No plugins or WebAssembly.',
    inLanguage: 'en',
    publisher: orgRef,
    featureList: [
      'Keyboard-navigable circuit editor',
      'State inspector with entanglement detection',
      'Shot sampling and measurement histograms',
      'OpenQASM 3 import and export with exact π fractions',
      'Save and reload circuits',
    ],
    offers: {
      '@type': 'Offer',
      price: 0,
      priceCurrency: PLAN_BY_ID.free.currency.toUpperCase(),
      availability: 'https://schema.org/InStock',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SoftwareApplication — the site itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The site-wide counterpart to `simulatorSchema()`, emitted once on the home
 * page. Where that one describes a single route, this describes the product
 * as a whole — the shape an AI answer engine (ChatGPT, Perplexity, and
 * friends) looks for when it is deciding whether to cite "Qubit16" as an
 * answer to "is there a free way to learn quantum computing in the browser".
 *
 * `applicationCategory: 'EducationalApplication'` matches what the product
 * actually is; `operatingSystem: 'Web'` is deliberately not "Windows, macOS,
 * Linux" or similar — there is no install, no binary, nothing platform-
 * specific, just a browser tab. Overstating that list is exactly the
 * "specify a real operating system" spam pattern Google's SoftwareApplication
 * guidelines call out.
 *
 * `offers` covers ONLY the free tier, at the same `price: 0` the pricing page
 * and the served app agree on — the same justification `courseSchema()` uses
 * for the foundations track. Pro/Team/University are real, paid products
 * (`lib/plans.ts` has the numbers), but this node describes the application
 * as a whole, not one purchasable plan, and a single `Offer` here can only
 * assert one price. Rather than pick one paid tier and imply the other two
 * don't exist, or list all four and misuse `Offer` as a plan comparison table,
 * `offers` is limited to the one thing this node can say honestly and
 * unambiguously: you can start using Qubit16 for $0.
 *
 * NO `aggregateRating`, NO `review`: there is no review or rating system
 * anywhere in this product (see `simulatorSchema()`'s comment — the same
 * reasoning applies here, and applies more, since this is the node most
 * likely to be copy-pasted with a fake rating bolted on).
 */
export function softwareApplicationSchema(): SchemaNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${absoluteUrl('/')}#software`,
    name: SITE.name,
    url: absoluteUrl('/'),
    description: SITE.description,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    inLanguage: 'en',
    publisher: orgRef,
    offers: {
      '@type': 'Offer',
      price: 0,
      priceCurrency: PLAN_BY_ID.free.currency.toUpperCase(),
      category: 'Free',
      availability: 'https://schema.org/InStock',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQPage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FAQPage requires that every question and answer marked up here is VISIBLE on
 * the page. The pricing FAQ renders inside <details> elements, which counts:
 * the text is in the DOM and reachable by clicking, which is what the guideline
 * asks. Marking up answers that are not on the page at all is a violation.
 *
 * The items are passed in from the page's own FAQ array — never retyped here.
 */
export function faqSchema(
  items: readonly { q: string; a: string }[],
  pagePath: string
): SchemaNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${absoluteUrl(pagePath)}#faq`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BreadcrumbList
// ─────────────────────────────────────────────────────────────────────────────

export type Crumb = { name: string; path: string }

/**
 * `position` is 1-based and must be contiguous — a gap makes the whole list
 * invalid. The final crumb is the page itself; Google expects it present and
 * pointing at the page's own canonical.
 */
export function breadcrumbSchema(crumbs: Crumb[]): SchemaNode {
  const last = crumbs[crumbs.length - 1]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${absoluteUrl(last.path)}#breadcrumbs`,
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  }
}

/** The crumb every trail starts from. */
export const HOME_CRUMB: Crumb = { name: 'Qubit16', path: '/' }

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: the full graph for one lesson page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both tracks live on the single `/learn` index, so the trail is
 * Home › Learn › <lesson> and NOT Home › Learn › <track> › <lesson>. A track
 * crumb would have to point at `/learn` too, and two crumbs sharing one URL is
 * how a BreadcrumbList gets rejected as malformed.
 */
export function lessonPageSchemas(slug: string): SchemaNode[] {
  const lesson = LESSONS.find((l) => l.slug === slug)
  if (!lesson) return []

  return [
    lessonSchema(lesson),
    breadcrumbSchema([
      HOME_CRUMB,
      { name: 'Learn', path: '/learn' },
      { name: lesson.title, path: `/learn/${slug}` },
    ]),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// WebApplication — one workbench tool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each workbench page is a tool you operate in the browser and take a result
 * away from, which is what `WebApplication` describes. The description is the
 * catalogue's `result` sentence — what the page hands you — not a pitch.
 *
 * NO `offers`: some tools run for anyone and some need a signed-in plan (the
 * generation and hardware-facing ones), and this node cannot say which without
 * a per-tool flag the catalogue does not carry. Saying nothing is accurate;
 * a blanket price of 0 would not be. NO `aggregateRating`, as everywhere.
 */
export function workbenchToolSchemas(href: string): SchemaNode[] {
  const tool = WORKBENCH.find((t) => t.href === href)
  const crumbs = breadcrumbSchema([
    HOME_CRUMB,
    { name: 'Workbench', path: '/workbench' },
    { name: tool?.title ?? 'Tool', path: href },
  ])
  if (!tool) return [crumbs]

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      '@id': `${absoluteUrl(href)}#tool`,
      name: tool.title,
      description: tool.result,
      url: absoluteUrl(href),
      applicationCategory: 'ScienceApplication',
      operatingSystem: 'Web',
      browserRequirements: 'Requires JavaScript',
      inLanguage: 'en',
      publisher: orgRef,
    },
    crumbs,
  ]
}

/** The /workbench index: the tools as an ordered list, plus the trail. */
export function workbenchIndexSchemas(): SchemaNode[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${absoluteUrl('/workbench')}#tools`,
      name: 'Qubit16 Workbench',
      numberOfItems: WORKBENCH.length,
      itemListElement: WORKBENCH.map((tool, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: tool.title,
        url: absoluteUrl(tool.href),
      })),
    },
    breadcrumbSchema([HOME_CRUMB, { name: 'Workbench', path: '/workbench' }]),
  ]
}
