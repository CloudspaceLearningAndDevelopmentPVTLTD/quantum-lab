import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB } from '@/components/seo/schema'
import { PATH_ACCENT } from '@/components/paths/accent'
import { PathJourney, type JourneyMilestone } from '@/components/paths/PathJourney'
import { allSteps, getPath, PATHS } from '@/lib/paths/catalogue'
import { resolveSteps } from '@/lib/paths/resolve'
import { pageMetadata } from '@/lib/seo'

interface PathPageProps {
  params: Promise<{ slug: string }>
}

export function generateStaticParams(): { slug: string }[] {
  return PATHS.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata(props: PathPageProps): Promise<Metadata> {
  const { slug } = await props.params
  const path = getPath(slug)
  if (!path) return { title: 'Path not found · Qubit16' }
  return pageMetadata({
    title: `${path.title} — Learning Path`,
    description: `${path.tagline} A step-by-step roadmap: ${path.outcomes.slice(0, 2).join('; ')}.`,
    path: `/paths/${path.slug}`,
  })
}

export default async function PathPage(props: PathPageProps) {
  const { slug } = await props.params
  const path = getPath(slug)
  if (!path) notFound()

  const accent = PATH_ACCENT[path.accent]
  const milestones: JourneyMilestone[] = path.milestones.map((m) => ({
    title: m.title,
    summary: m.summary,
    steps: resolveSteps(m.steps),
  }))
  const totalMinutes = milestones
    .flatMap((m) => m.steps)
    .reduce((sum, s) => sum + (s.minutes ?? 0), 0)

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <JsonLd
        data={breadcrumbSchema([
          HOME_CRUMB,
          { name: 'Learning paths', path: '/paths' },
          { name: path.title, path: `/paths/${path.slug}` },
        ])}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/paths" className="focus-ring rounded underline-offset-4 hover:underline">
          ← All learning paths
        </Link>
      </nav>

      <header
        className="card relative mt-4 overflow-hidden p-6 md:p-8"
        style={{ backgroundImage: `radial-gradient(120% 90% at 100% 0%, rgb(${accent.rgb} / 0.16), transparent 60%)` }}
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl"
            style={{ backgroundColor: `rgb(${accent.rgb} / 0.18)` }}
          >
            {path.icon}
          </span>
          <div className="min-w-0">
            <p className="section-label">Learning path</p>
            <h1 className="section-title mt-1">{path.title}</h1>
          </div>
        </div>
        <p className={`mt-5 text-lg font-semibold italic ${accent.text}`}>&ldquo;{path.tagline}&rdquo;</p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">{path.forWho}</p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.09em] text-ink-muted">
          {path.milestones.length} milestones · {allSteps(path).length} steps
          {totalMinutes > 0 ? ` · ${totalMinutes} minutes of reading, plus hands-on time` : ''}
        </p>
      </header>

      <section className="mt-8" aria-labelledby="outcomes-heading">
        <h2 id="outcomes-heading" className="text-lg font-bold text-ink">By the end, you will be able to</h2>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {path.outcomes.map((outcome) => (
            <li key={outcome} className="card flex gap-3 p-4 text-sm text-ink-secondary">
              <span aria-hidden="true" className={`font-bold ${accent.text}`}>✓</span>
              <span>{outcome}</span>
            </li>
          ))}
        </ul>
      </section>

      <PathJourney slug={path.slug} title={path.title} rgb={accent.rgb} milestones={milestones} />

      <section className="mt-12" aria-labelledby="beyond-heading">
        <h2 id="beyond-heading" className="text-lg font-bold text-ink">After this path</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary">
          {path.beyond.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className={accent.text}>→</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/paths" className="btn-ghost focus-ring">Explore other paths</Link>
          <Link href="/tutor" className="btn-ghost focus-ring">Stuck? Ask the tutor</Link>
          <Link href="/glossary" className="btn-ghost focus-ring">Look up a term</Link>
        </div>
      </section>
    </div>
  )
}
