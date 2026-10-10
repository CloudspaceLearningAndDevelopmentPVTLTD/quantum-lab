import { CONTACT_EMAIL, CONTACT_PHONE, HELLO_EMAIL } from '@/lib/legal'

/**
 * "Support us" — with words, not money.
 *
 * Qubit16 does not ask visitors for donations. The support it wants is the
 * kind that makes the product better: a question someone got stuck on, an
 * improvement they would love, a concern about how something works, a bug.
 * One component so /about and /pricing say exactly the same thing with the
 * same three ways to reach the team.
 */

const WAYS: { title: string; body: string; subject: string }[] = [
  {
    title: 'Ask anything',
    body: 'Stuck on a lesson, a gate, or a result that looks wrong? No question is too small.',
    subject: 'A question about Qubit16',
  },
  {
    title: 'Suggest an improvement',
    body: 'The lesson you wish existed, the feature your research needs, the button that should be somewhere else.',
    subject: 'An idea for Qubit16',
  },
  {
    title: 'Raise a concern',
    body: 'Something broken, unclear, or not sitting right with you, including privacy or accuracy. Tell us straight.',
    subject: 'A concern about Qubit16',
  },
]

const mailto = (address: string, subject: string) =>
  `mailto:${address}?subject=${encodeURIComponent(subject)}`

export default function SupportUs({ className = '' }: { className?: string }) {
  return (
    <section className={`card p-6 ${className}`} aria-labelledby="support-us-heading">
      <p className="section-label">Support us</p>
      <h2 id="support-us-heading" className="mt-1 text-lg font-bold text-ink">
        The best support costs nothing: talk to us
      </h2>
      <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-secondary">
        We are not asking for money. What keeps Qubit16 getting better is hearing from the people
        who use it. Send us your questions, your ideas for improvements and any concerns you have.
        A real person on the team reads every message. We are genuinely happy to help, and the good
        ideas get built.
      </p>

      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {WAYS.map((w) => (
          <li key={w.title}>
            <a
              href={mailto(HELLO_EMAIL, w.subject)}
              className="card card-hover focus-ring flex h-full flex-col p-4"
            >
              <span className="text-sm font-bold text-ink">{w.title}</span>
              <span className="mt-1 flex-1 text-[13px] leading-relaxed text-ink-secondary">{w.body}</span>
              <span className="mt-3 text-[12px] font-semibold text-q-violet-text">Write to us →</span>
            </a>
          </li>
        ))}
      </ul>

      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Say hello</dt>
          <dd className="mt-0.5">
            <a className="font-semibold text-ink underline break-all" href={`mailto:${HELLO_EMAIL}`}>
              {HELLO_EMAIL}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Reach the team</dt>
          <dd className="mt-0.5">
            <a className="font-semibold text-ink underline break-all" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Call us</dt>
          <dd className="mt-0.5">
            <a className="font-semibold text-ink underline" href={`tel:${CONTACT_PHONE}`}>
              {CONTACT_PHONE}
            </a>
          </dd>
        </div>
      </dl>
    </section>
  )
}
