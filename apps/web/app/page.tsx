import type { Metadata } from 'next'
import Link from 'next/link'

import { FeatureCard } from '@/components/ui/FeatureCard'
import { Hero, VISUALIZATIONS, type VizAccent, type VizLevel } from '@/components/ui/Hero'
import { JsonLd } from '@/components/seo/JsonLd'
import { siteSchema, softwareApplicationSchema } from '@/components/seo/schema'
import { SITE, METADATA_BASE, absoluteUrl } from '@/lib/seo'
import { WORKBENCH } from '@/lib/workbench'
import { PATHS } from '@/lib/paths/catalogue'

/**
 * The home page had no metadata of its own, so it inherited the root layout's
 * title and description and shipped with NO canonical, NO og:url and NO
 * og:type — the only route on the site missing them. Everything else goes
 * through `pageMetadata`; `/` cannot, because its title is deliberately the
 * long-form one rather than "<page> · Qubit16", so the fields are spelled
 * out here instead of adding a special case to lib/seo.ts.
 *
 * `alternates.types` declares the lesson feed. It is declared here and on
 * /learn rather than sitewide because the feed is the course, not the site.
 */
const HOME_TITLE = 'Qubit16 — Learn quantum mechanics by playing with it'

export const metadata: Metadata = {
  // Without this the generated /opengraph-image resolves as a RELATIVE URL and
  // every scraper rejects it. `pageMetadata` sets it for all the other routes;
  // app/layout.tsx does not set it at all, so the home page has to.
  metadataBase: METADATA_BASE,
  title: HOME_TITLE,
  description: SITE.description,
  alternates: {
    canonical: absoluteUrl('/'),
    types: {
      'application/atom+xml': [{ url: absoluteUrl('/feed.xml'), title: 'Qubit16 lessons' }],
    },
  },
  openGraph: {
    title: HOME_TITLE,
    description: SITE.description,
    url: absoluteUrl('/'),
    siteName: SITE.name,
    type: 'website',
    locale: SITE.locale,
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: SITE.description,
  },
}

type Feature = {
  href: string
  icon: string
  title: string
  description: string
  accent: VizAccent
}

const FEATURES: readonly Feature[] = [
  {
    href: '/visualizations',
    icon: '🔬',
    title: 'Interactive Visualizations',
    description: `${VISUALIZATIONS.length} hands-on simulations, from the double-slit experiment to the surface code. Drag the sliders, break your intuition.`,
    accent: 'violet',
  },
  {
    href: '/simulator',
    icon: '⚛️',
    title: 'Circuit Simulator',
    description:
      'Build quantum circuits with drag-and-drop gates, run thousands of shots, and export real OpenQASM 3.',
    accent: 'teal',
  },
  {
    href: '/tutor',
    icon: '🤖',
    title: 'AI Tutor',
    description:
      'Ask anything. The tutor runs circuits to show you the answer instead of just asserting it.',
    accent: 'amber',
  },
  {
    href: '/workbench',
    icon: '🛠️',
    title: 'AI Workbench',
    description: `${WORKBENCH.length} tools that produce a result, not a lesson: verified circuits, trained decoders, routed circuits, mitigated readouts and agent-run experiments — on the same engines.`,
    accent: 'rose',
  },
]

const LEVEL_PILL: Record<VizLevel, string> = {
  Beginner: 'border-q-teal/30 bg-q-teal/15 text-q-teal-text',
  Intermediate: 'border-q-violet/30 bg-q-violet/15 text-q-violet-text',
  Advanced: 'border-q-amber/30 bg-q-amber/15 text-q-amber-text',
}

export default function HomePage() {
  return (
    <div>
      {/* Organization + WebSite, emitted once on the home page. Every other
          node on the site references the Organization by @id rather than
          restating it. See components/seo/schema.ts. */}
      <JsonLd data={siteSchema()} />
      <JsonLd data={softwareApplicationSchema()} />

      <Hero />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <p className="section-label">Four ways in</p>
        <h2 className="section-title mt-2">What&rsquo;s inside</h2>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <FeatureCard
              key={feature.href}
              href={feature.href}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              accent={feature.accent}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16" aria-labelledby="paths-heading">
        <p className="section-label">Learning paths</p>
        <h2 id="paths-heading" className="section-title mt-2">Where do you want quantum to take you?</h2>
        <p className="section-desc mt-2 max-w-2xl">
          Pick a goal and follow a roadmap built from everything here — milestone by milestone,
          with your progress tracked, until you are there.
        </p>

        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PATHS.map((path) => (
            <li key={path.slug} className="flex">
              <Link
                href={`/paths/${path.slug}`}
                className="card card-hover focus-ring flex w-full items-start gap-4 p-5 transition-transform duration-200 hover:-translate-y-0.5"
              >
                <span aria-hidden="true" className="shrink-0 text-2xl leading-none">{path.icon}</span>
                <span className="min-w-0">
                  <span className="block text-base font-bold text-ink">{path.title}</span>
                  <span className="mt-1 block text-sm italic text-ink-secondary">&ldquo;{path.tagline}&rdquo;</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/paths" className="btn-ghost focus-ring mt-6 inline-flex">Compare all paths</Link>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <p className="section-label">A path through it</p>
        <h2 className="section-title mt-2">Start here</h2>
        <p className="section-desc mt-2 max-w-2xl">
          Each one builds on the last. Start with the experiment that broke classical
          physics, finish with the algorithm that reads a phase out of a quantum register.
        </p>

        <ol className="mt-6 space-y-3">
          {VISUALIZATIONS.map((viz, index) => (
            <li key={viz.href}>
              <Link
                href={viz.href}
                className="card card-hover focus-ring flex items-start gap-4 p-5 transition-transform duration-200 hover:-translate-y-0.5 sm:items-center sm:gap-5"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-2xl font-bold tabular-nums text-ink-muted sm:text-3xl"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>

                <span aria-hidden="true" className="shrink-0 text-2xl leading-none">
                  {viz.icon}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base font-bold text-ink">{viz.title}</span>
                    <span className={`pill ${LEVEL_PILL[viz.level]}`}>{viz.level}</span>
                  </span>
                  <span className="mt-1 block text-sm text-ink-secondary">{viz.hook}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div
          className="card relative overflow-hidden border-q-violet/25 p-6 md:p-8"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 60% 80% at 100% 0%, rgb(var(--q-violet-rgb) / 0.10) 0%, transparent 65%), radial-gradient(ellipse 50% 60% at 0% 100%, rgb(var(--q-teal-rgb) / 0.08) 0%, transparent 65%)',
          }}
        >
          <p className="section-label">Why not just use IBM, Brilliant, or a MOOC?</p>
          <h2 className="section-title mt-2">The combination nobody else offers</h2>
          <p className="section-desc mt-3 max-w-3xl">
            IBM Quantum has real hardware and a huge community, but no guided tutoring.
            Brilliant teaches beautifully, with an in-browser simulator, but has no free-form
            circuit editor, no OpenQASM export and no path to hardware. University courses
            give you rigor and a credential, at a multi-week pace. Qubit16 is the one place
            that combines Brilliant&rsquo;s visual, interactive teaching with an exact
            statevector simulator that runs in your browser — no upload, no queue — and is
            verified against Qiskit and PennyLane in our test suite; the AI tutor checks its
            answers with Qiskit/Aer, and every circuit exports as OpenQASM that loads straight
            into Qiskit. Add a live AI tutor that can see what you built, and a
            spaced-repetition review queue that brings quiz questions back right before
            you&rsquo;d forget them, instead of leaving retention to chance.
            Free to start, zero install, and every line of progress stays in your browser —
            no account required to begin.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/compare" className="btn-primary focus-ring w-full sm:w-auto">
              See the full comparison →
            </Link>
            <Link href="/about" className="btn-ghost focus-ring w-full sm:w-auto">
              Why this exists
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20" aria-label="Who it is for">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card card-accent-hover p-6" style={{ '--card-accent-rgb': 'var(--q-teal-rgb)' } as React.CSSProperties}>
            <p className="section-label text-q-teal">For learners</p>
            <h2 className="mt-2 text-xl font-bold text-ink">Everything free for your first 30 days</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              Create an account and every Pro feature — the live AI tutor, the full advanced
              track, and real quantum hardware where this deployment has provider credentials
              configured — is included, no card, nothing to cancel. The foundations
              course and all {VISUALIZATIONS.length} visualizations stay free forever, with or
              without an account.
            </p>
            <Link href="/account" className="btn-primary focus-ring mt-5 inline-flex">
              Create a free account
            </Link>
          </div>
          <div className="card card-accent-hover p-6" style={{ '--card-accent-rgb': 'var(--q-amber-rgb)' } as React.CSSProperties}>
            <p className="section-label text-q-amber">For educators and institutions</p>
            <h2 className="mt-2 text-xl font-bold text-ink">Run a course on a real quantum lab</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              Seats, classes and assignments built from the same lessons, challenges and exams;
              completion tracking your students opt into; CSV export; an embeddable circuit
              widget for your own pages. Nothing to install in any lab.
            </p>
            <Link href="/educators" className="btn-ghost focus-ring mt-5 inline-flex">
              See what educators get →
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
