import Link from 'next/link'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB } from '@/components/seo/schema'
import { PATH_ACCENT } from '@/components/paths/accent'
import { PathProgressBadge } from '@/components/paths/PathProgressBadge'
import { allSteps, PATHS } from '@/lib/paths/catalogue'

/**
 * /paths — pick where you are heading.
 *
 * Server-rendered: the cards, the outcomes and the step counts are all static.
 * Only the progress line on each card reads this browser's storage, and it does
 * so in its own small client component.
 */
export default function PathsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'Learning paths', path: '/paths' }])} />

      <header className="max-w-3xl">
        <p className="section-label">Learning paths</p>
        <h1 className="section-title mt-2">Where do you want quantum to take you?</h1>
        <p className="section-desc mt-3">
          Pick the goal that sounds like you. Each path is an ordered route through the
          lessons, experiments, challenges and research tools already on this site — with
          milestones, so you always know what is next and when you are done. Your progress
          counts across paths: a lesson finished on one is finished on all of them.
        </p>
      </header>

      <ul className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {PATHS.map((path) => {
          const accent = PATH_ACCENT[path.accent]
          const steps = allSteps(path).length
          return (
            <li key={path.slug} className="flex">
              <Link
                href={`/paths/${path.slug}`}
                className="card card-accent-hover focus-ring flex w-full flex-col p-6 transition-transform duration-200 hover:-translate-y-0.5"
                style={{ '--card-accent-rgb': accent.rgb } as React.CSSProperties}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl"
                    style={{ backgroundColor: `rgb(${accent.rgb} / 0.15)` }}
                  >
                    {path.icon}
                  </span>
                  <h2 className="text-lg font-bold leading-snug text-ink">{path.title}</h2>
                </div>
                <p className={`mt-4 text-[15px] font-semibold italic ${accent.text}`}>
                  &ldquo;{path.tagline}&rdquo;
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-secondary">
                  {path.outcomes.slice(0, 3).map((outcome) => (
                    <li key={outcome} className="flex gap-2">
                      <span aria-hidden="true" className={accent.text}>✓</span>
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-ink-muted">
                  {path.milestones.length} milestones · {steps} steps
                </p>
                <PathProgressBadge slug={path.slug} rgb={accent.rgb} />
              </Link>
            </li>
          )
        })}
      </ul>

      <section className="card mt-12 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between" aria-label="Not sure where to start">
        <div>
          <h2 className="text-base font-bold text-ink">Not sure which one?</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Start with <em>Quantum, explained properly</em>. Every other path assumes some of it,
            and nothing you finish there is wasted when you switch.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link href="/paths/quantum-curious" className="btn-primary focus-ring">Start at the beginning</Link>
          <Link href="/glossary" className="btn-ghost focus-ring">Browse the glossary</Link>
        </div>
      </section>
    </div>
  )
}
