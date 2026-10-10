import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB, type SchemaNode } from '@/components/seo/schema'
import { resolveSeeLink, type SeeLink } from '@/lib/glossary/links'
import { GLOSSARY, getTerm, type GlossaryTerm } from '@/lib/glossary/terms'
import { absoluteUrl, pageMetadata } from '@/lib/seo'

/**
 * /glossary/<id> — one term, on its own URL.
 *
 * The A–Z page at /glossary holds every definition, which is right for
 * browsing and wrong for being found: sixty-odd terms shared one URL, one
 * title and one description, so "what is a stabilizer code" had nothing of its
 * own to land on. Each term now has a page whose title, description and
 * structured data are about that term alone.
 *
 * The content is the same catalogue entry /glossary renders (lib/glossary/
 * terms.ts) — nothing is written twice, and terms.test.ts already guarantees
 * every link on it resolves.
 */

interface TermPageProps {
  params: Promise<{ id: string }>
}

export function generateStaticParams(): { id: string }[] {
  return GLOSSARY.map((t) => ({ id: t.id }))
}

export async function generateMetadata(props: TermPageProps): Promise<Metadata> {
  const { id } = await props.params
  const term = getTerm(id)
  if (!term) return { title: 'Term not found · Qubit16' }
  return pageMetadata({
    title: `${term.term}: Definition, Explained Plainly`,
    description: term.short,
    path: `/glossary/${term.id}`,
    type: 'article',
  })
}

/**
 * The same DefinedTerm the index emits, under the same `@id`, so a consumer
 * that sees both resolves them to one entity. `url` is this page.
 */
function termSchema(term: GlossaryTerm): SchemaNode {
  const set = absoluteUrl('/glossary')
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    '@id': `${set}#${term.id}`,
    name: term.term,
    ...(term.aliases?.length ? { alternateName: term.aliases } : {}),
    description: `${term.short} ${term.body}`,
    url: absoluteUrl(`/glossary/${term.id}`),
    inDefinedTermSet: { '@type': 'DefinedTermSet', '@id': `${set}#set`, name: 'Qubit16 Quantum Glossary', url: set },
  }
}

export default async function GlossaryTermPage(props: TermPageProps) {
  const { id } = await props.params
  const term = getTerm(id)
  if (!term) notFound()

  const seeLinks = term.see.map(resolveSeeLink).filter((l): l is SeeLink => l !== null)
  const related = (term.related ?? []).map(getTerm).filter((t): t is GlossaryTerm => t !== undefined)

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <JsonLd
        data={[
          termSchema(term),
          breadcrumbSchema([
            HOME_CRUMB,
            { name: 'Glossary', path: '/glossary' },
            { name: term.term, path: `/glossary/${term.id}` },
          ]),
        ]}
      />

      <Link
        href="/glossary"
        className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <span aria-hidden>←</span> Glossary
      </Link>

      <article className="mt-6">
        <p className="section-label">Quantum glossary</p>
        <h1 className="section-title mt-2">{term.term}</h1>
        {term.aliases?.length ? <p className="mt-2 text-sm text-ink-muted">Also: {term.aliases.join(', ')}</p> : null}

        <p className="mt-6 text-lg font-medium leading-relaxed text-ink">{term.short}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">{term.body}</p>
        {term.formula ? (
          <p className="mt-5 overflow-x-auto rounded-lg bg-surface-2 px-4 py-3 font-mono text-sm text-ink">
            {term.formula}
          </p>
        ) : null}
      </article>

      <section className="mt-10" aria-labelledby="see-it">
        <h2 id="see-it" className="text-lg font-bold text-ink">
          See it for yourself
        </h2>
        <ul className="mt-3 space-y-2">
          {seeLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="card card-hover focus-ring flex items-baseline gap-3 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{link.kind}</span>
                <span className="font-semibold text-q-violet-text">{link.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {related.length ? (
        <section className="mt-10" aria-labelledby="related">
          <h2 id="related" className="text-lg font-bold text-ink">
            Related terms
          </h2>
          <ul className="mt-3 space-y-3">
            {related.map((rel) => (
              <li key={rel.id}>
                <Link
                  href={`/glossary/${rel.id}`}
                  className="focus-ring rounded font-semibold text-ink underline underline-offset-2"
                >
                  {rel.term}
                </Link>
                <span className="text-sm text-ink-secondary"> — {rel.short}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
