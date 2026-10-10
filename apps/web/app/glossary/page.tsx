import type { Metadata } from 'next'
import { GlossaryBrowser, type GlossaryEntry } from '@/components/glossary/GlossaryBrowser'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB, type SchemaNode } from '@/components/seo/schema'
import { resolveSeeLink, type SeeLink } from '@/lib/glossary/links'
import { GLOSSARY } from '@/lib/glossary/terms'
import { absoluteUrl, pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Quantum Glossary: Every Term, Explained Plainly',
  description: `${GLOSSARY.length} quantum computing terms — qubit, entanglement, decoherence, surface code, VQE — each in plain language, with a live simulation to see it in.`,
  path: '/glossary',
})

function glossarySchema(): SchemaNode {
  const url = absoluteUrl('/glossary')
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': `${url}#set`,
    name: 'Qubit16 Quantum Glossary',
    url,
    hasDefinedTerm: GLOSSARY.map((t) => ({
      '@type': 'DefinedTerm',
      '@id': `${url}#${t.id}`,
      name: t.term,
      ...(t.aliases?.length ? { alternateName: t.aliases } : {}),
      description: t.short,
      url: absoluteUrl(`/glossary/${t.id}`),
      inDefinedTermSet: `${url}#set`,
    })),
  }
}

/**
 * /glossary — server-rendered, so every definition is in the HTML a crawler and
 * a no-JS reader get. The client component only adds filtering on top.
 */
export default function GlossaryPage() {
  const entries: GlossaryEntry[] = GLOSSARY.map((t) => ({
    ...t,
    seeLinks: t.see.map(resolveSeeLink).filter((l): l is SeeLink => l !== null),
    relatedTerms: (t.related ?? [])
      .map((id) => GLOSSARY.find((g) => g.id === id))
      .filter((g): g is (typeof GLOSSARY)[number] => g !== undefined)
      .map((g) => ({ id: g.id, term: g.term })),
  }))

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'Glossary', path: '/glossary' }])} />
      <JsonLd data={glossarySchema()} />

      <header className="max-w-3xl">
        <p className="section-label">Glossary</p>
        <h1 className="section-title mt-2">Quantum, word by word</h1>
        <p className="section-desc mt-3">
          {GLOSSARY.length} terms, each said plainly — with the usual misleading metaphor corrected
          where there is one, and a link to the simulation where you can watch it happen.
        </p>
      </header>

      <GlossaryBrowser entries={entries} />
    </div>
  )
}
