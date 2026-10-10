import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { pageMetadata } from '@/lib/seo'

/**
 * /verify — look up a certificate number.
 *
 * A plain GET form and no client JavaScript at all. The audience for this page
 * is a stranger checking somebody's claim — a hiring manager, an admissions
 * officer — often on a locked-down machine, and a verification tool that
 * requires a working bundle to answer a yes/no question is a worse tool.
 *
 * The form posts to this same route and the handler redirects to
 * `/verify/<id>`, so a checked certificate has a shareable URL.
 */

export const metadata: Metadata = pageMetadata({
  title: 'Verify a certificate',
  description:
    'Check a Qubit16 certification number. Confirms the name, the exam and the date it was issued, and nothing else.',
  path: '/verify',
})

export default async function VerifyIndexPage(
  props: {
    searchParams: Promise<{ id?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const typed = (searchParams.id ?? '').trim()
  if (typed) redirect(`/verify/${encodeURIComponent(typed)}`)

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="section-label">Verification</p>
      <h1 className="section-title mt-2 text-3xl">Check a certificate</h1>
      <p className="section-desc mt-3">
        Qubit16 certification numbers look like <code>QL-4F2AH-9C31T-K</code>. Enter one and we
        will confirm who it was issued to, which exam they passed, and when.
      </p>

      <form action="/verify" method="get" className="card mt-8 p-5">
        <label htmlFor="id" className="block text-[12px] font-semibold text-ink-secondary">
          Certificate number
        </label>
        <input
          id="id"
          name="id"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="QL-4F2AH-9C31T-K"
          className="focus-ring mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted"
        />
        <p className="mt-2 text-[12px] text-ink-muted">
          Case and hyphens do not matter, and the characters people commonly mistype — I for 1, O
          for 0 — are corrected automatically.
        </p>
        <button type="submit" className="btn-primary focus-ring mt-4">
          Check it
        </button>
      </form>

      <section className="card mt-6 p-5">
        <h2 className="text-base font-bold text-ink">What this proves, and what it does not</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
          A valid number means our server graded a timed, server-side attempt at that exam for a
          signed-in account and recorded a pass on that date. The name shown is the one the
          candidate gave when the certificate was issued; we do not verify identity documents, and
          the page says so. We do not publish the score, the number of attempts, or anything about
          the account.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          Course-completion certificates from{' '}
          <Link href="/learn/certificate" className="focus-ring underline">
            /learn/certificate
          </Link>{' '}
          are a different thing: they are a record of study, they are generated in the browser, and
          they are not checkable here. Only exam certifications are.
        </p>
      </section>
    </div>
  )
}
