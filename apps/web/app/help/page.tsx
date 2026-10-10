import Link from 'next/link'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB } from '@/components/seo/schema'
import { HELP_FAQ } from './faq'

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'Help', path: '/help' }])} />
      <header className="mb-10">
        <p className="section-label">Help</p>
        <h1 className="section-title mt-2">Questions people actually ask</h1>
        <p className="section-desc mt-2">
          If yours is not here, the <Link className="underline" href="/contact">contact page</Link>{' '}
          reaches a person.
        </p>
      </header>
      <div className="space-y-3">
        {HELP_FAQ.map((item) => (
          <details key={item.q} className="card group p-5">
            <summary className="focus-ring cursor-pointer list-none rounded text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span className="mr-2 inline-block text-q-violet-text transition-transform group-open:rotate-90">
                ▸
              </span>
              {item.q}
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{item.a}</p>
          </details>
        ))}
      </div>
      <div className="card mt-10 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-secondary">Still stuck?</p>
        <div className="flex gap-3">
          <Link href="/contact" className="btn-primary focus-ring">Contact us</Link>
          <Link href="/welcome" className="btn-ghost focus-ring">Start over from the guide</Link>
        </div>
      </div>
    </div>
  )
}
