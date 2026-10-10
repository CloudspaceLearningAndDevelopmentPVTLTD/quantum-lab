import Link from 'next/link'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB } from '@/components/seo/schema'
import { CONTACT_EMAIL, CONTACT_PHONE, LEGAL_UPDATED } from '@/lib/legal'

/**
 * /privacy — written from the code, not from a template. Every statement
 * below corresponds to something in lib/ (analytics, supabase, billing,
 * the tutor route, the hardware submit route). If the code changes, this
 * page must change with it; docs/ANALYTICS.md is the technical authority.
 */

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'The short version',
    body: (
      <>
        <p>
          Without an account, Qubit16 stores everything — saved circuits, lesson progress,
          quiz scores, review schedule, preferences — in your own browser&rsquo;s local storage.
          None of it is sent to us. You can use the entire course, the simulator and the
          visualizations this way indefinitely.
        </p>
        <p>
          With an account, we store the minimum that sign-in and syncing need: your email
          address, the circuits you save to the cloud, exam attempts and certificates, and
          your organisation membership if an institution invited you. Progress sharing with
          an instructor is a separate, explicit switch that is off by default.
        </p>
      </>
    ),
  },
  {
    title: 'What we do not do',
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>No advertising, no ad networks, no third-party tracking pixels.</li>
        <li>No selling, renting or sharing of personal data with anyone.</li>
        <li>No fingerprinting. Our optional usage analytics keep a random per-tab session id in memory only; it is never written to storage and cannot follow you across tabs or days.</li>
        <li>No reading of your progress by the AI tutor unless you turn on &ldquo;share my skill map&rdquo;, and even then it receives a handful of concept names and rounded scores, never your identity.</li>
      </ul>
    ),
  },
  {
    title: 'Accounts (Supabase)',
    body: (
      <>
        <p>
          Sign-in is by magic link: we store your email address and a session token; there is
          no password. Account data is held by Supabase, our database and authentication
          provider, in a project we control. Row-level security means your browser can only
          read your own rows.
        </p>
        <p>
          To delete your account and everything attached to it, email{' '}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the
          address on the account. We confirm within a few days. Certificates you earned remain
          verifiable by their number unless you ask us to revoke them.
        </p>
      </>
    ),
  },
  {
    title: 'The AI tutor',
    body: (
      <>
        <p>
          When you ask the tutor a question, the text of the conversation and, if you have one
          open, the circuit in your editor are sent to a language-model provider to generate
          the answer. Depending on how this deployment is configured that is Google (Gemini),
          Groq, Anthropic, or Microsoft Azure OpenAI; the page tells you which tier answered.
          No account identifier is sent with the request. Conversations are not stored on our
          servers; they live in your browser tab and are gone when you close it.
        </p>
        <p>
          Do not paste personal data into the tutor. It is a physics tutor, and what you type
          is processed by the provider under that provider&rsquo;s terms.
        </p>
      </>
    ),
  },
  {
    title: 'Real quantum hardware',
    body: (
      <p>
        If you submit a circuit to a real device, the circuit (OpenQASM text) and the shot
        count are sent to the hardware provider — IBM Quantum or Amazon Braket — through our
        API, which holds the provider credentials. We record the job id, its status and the
        results so you can retrieve them, and count the job against your monthly quota. The
        provider processes the job under its own terms.
      </p>
    ),
  },
  {
    title: 'Payments',
    body: (
      <p>
        Card details never touch our servers. If paid plans are enabled, checkout and card
        storage are handled by Stripe, and we store only the subscription status Stripe reports
        to us (plan, period end, whether it is set to cancel). During the launch period there is
        no checkout at all: every new account is on the Pro tier free for 30 days.
      </p>
    ),
  },
  {
    title: 'Usage analytics and error reporting',
    body: (
      <>
        <p>
          The app keeps a small local log of which pages and features you used, in your
          browser, to power your own <Link className="underline" href="/insights">Insights</Link>{' '}
          page. It is only sent to us if this deployment has an analytics endpoint configured,
          and never if your browser sends Do Not Track or Global Privacy Control, or if you
          turn analytics off in the app. It contains no names, emails, question text or
          circuit contents.
        </p>
        <p>
          If error reporting (Sentry) is configured, a crash report contains the error, the
          route and browser details — never the contents of what you were typing.
        </p>
      </>
    ),
  },
  {
    title: 'Cookies and local storage',
    body: (
      <p>
        We set no advertising or analytics cookies. Sign-in uses a session stored by the
        Supabase client in your browser&rsquo;s local storage. The app also caches pages for
        offline use through a service worker; clearing site data in your browser removes all
        of it.
      </p>
    ),
  },
  {
    title: 'Children',
    body: (
      <p>
        Qubit16 is for learners of any age, and nothing on it requires an account. Accounts are
        intended for people 13 and over; institutions running classes with younger students
        should use seats managed by the institution rather than individual sign-ups.
      </p>
    ),
  },
  {
    title: 'Changes and contact',
    body: (
      <p>
        We update this page when the product changes what it stores; the date below is the
        last substantive change. Questions:{' '}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or{' '}
        <a className="underline" href={`tel:${CONTACT_PHONE}`}>{CONTACT_PHONE}</a>. The
        application is open source, so every claim on this page can be checked against the
        code.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'Privacy', path: '/privacy' }])} />
      <header className="mb-10">
        <p className="section-label">Privacy</p>
        <h1 className="section-title mt-2">What Qubit16 stores, and what it doesn&rsquo;t</h1>
        <p className="section-desc mt-2">Last updated {LEGAL_UPDATED}.</p>
      </header>
      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 text-lg font-semibold text-ink">{s.title}</h2>
            <div className="space-y-3 text-sm leading-relaxed text-ink-secondary">{s.body}</div>
          </section>
        ))}
      </div>
    </div>
  )
}
