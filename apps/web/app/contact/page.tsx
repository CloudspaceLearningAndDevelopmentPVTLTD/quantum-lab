import Link from 'next/link'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB } from '@/components/seo/schema'
import { CONTACT_EMAIL, CONTACT_PHONE, HELLO_EMAIL } from '@/lib/legal'
import OpenSource from '@/components/ui/OpenSource'

const mail = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`

const ROUTES: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: 'Something is broken',
    body: 'Tell us the page, what you did, and what you expected. A screenshot helps; the exact URL helps more.',
    href: mail('Bug report'),
    cta: 'Report a bug',
  },
  {
    title: 'Institutions and licences',
    body: 'Departmental pilots, seat counts, invoicing, and questions about assignments, classes and progress export.',
    href: mail('Qubit16 for our institution'),
    cta: 'Talk to us',
  },
  {
    title: 'Your account or data',
    body: 'Sign-in trouble, deleting your account, or a question about what we store. Email from the address on the account.',
    href: mail('Account help'),
    cta: 'Account help',
  },
  {
    title: 'Ideas and content',
    body: 'A lesson you wish existed, a visualization that would have helped you, a mistake in the course. We read all of it.',
    href: mail('Suggestion'),
    cta: 'Send a suggestion',
  },
]

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'Contact', path: '/contact' }])} />
      <header className="mb-10 max-w-2xl">
        <p className="section-label">Contact</p>
        <h1 className="section-title mt-2">A person replies</h1>
        <p className="section-desc mt-2">
          Questions, ideas for improvements, concerns: we are genuinely happy to hear all of
          it, and the good ideas get built. Write to{' '}
          <a className="font-semibold text-ink underline" href={`mailto:${HELLO_EMAIL}`}>
            {HELLO_EMAIL}
          </a>{' '}
          or{' '}
          <a className="font-semibold text-ink underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          , or call{' '}
          <a className="font-semibold text-ink underline" href={`tel:${CONTACT_PHONE}`}>
            {CONTACT_PHONE}
          </a>
          . The buttons below just pre-fill the subject so it reaches the right place faster.
          Before writing about a feature, the{' '}
          <Link className="underline" href="/help">help page</Link> answers the common
          questions.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ROUTES.map((r) => (
          <section key={r.title} className="card card-hover flex flex-col p-5">
            <h2 className="text-base font-bold text-ink">{r.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-secondary">{r.body}</p>
            <a href={r.href} className="btn-ghost focus-ring mt-4 self-start">
              {r.cta}
            </a>
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm text-ink-muted">
        Qubit16 is open source. Security issues: please email rather than filing them publicly,
        with &ldquo;Security&rdquo; in the subject.
      </p>
      <OpenSource className="mt-10" />
    </div>
  )
}
