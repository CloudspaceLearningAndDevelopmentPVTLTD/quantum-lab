'use client'

/**
 * Pricing — free is the product, paid is the hardware.
 *
 * The honest version of this page: the entire course and every visualization is
 * free forever, and we say so above the table rather than burying it in an FAQ.
 */

import Link from 'next/link'
import { useSession } from '@/components/auth/useSession'
import { useEntitlement } from '@/components/billing/useEntitlement'
import { PricingTable } from '@/components/billing/PricingTable'
import { Button } from '@/components/ui/button'
import { VISUALIZATIONS } from '@/components/ui/Hero'
// The FAQ lives in ./faq.ts, not here: app/pricing/layout.tsx emits the FAQPage
// JSON-LD from the same array, and a server component cannot read a plain value
// out of a 'use client' module. See the header comment in that file.
import { FAQ } from './faq'
import { LAUNCH_TRIAL_PLAN, launchTrialDays, launchTrialUntil } from '@/lib/billing/launchTrial'
import { PLAN_BY_ID } from '@/lib/plans'
import SupportUs from '@/components/ui/SupportUs'
import OpenSource from '@/components/ui/OpenSource'

export default function PricingPage() {
  const { user } = useSession()
  const { plan } = useEntitlement()
  // The same policy lib/billing/entitlements.ts enforces, read from the same
  // two variables. While either is set, this page's job is to say "sign in,
  // everything is free", not to sell; see lib/billing/launchTrial.ts.
  //
  // `until` is the absolute end of the promotion and takes precedence in the
  // copy when both are set, because a date is a promise somebody can hold us
  // to and "your first N days" is not — and because a reader who registered
  // months ago is not helped by being told about their first 30 days.
  const trialDays = launchTrialDays()
  const trialUntil = launchTrialUntil()
  const trialOn = trialDays > 0 || trialUntil !== null
  // The allowance a promotion account actually gets. LAUNCH_TRIAL_PLAN is the
  // plan lib/billing/entitlements.ts grants, so this is the same number the
  // server enforces rather than a second copy of it written into prose.
  const trialHardwareJobs = PLAN_BY_ID[LAUNCH_TRIAL_PLAN].limits.hardwareJobsPerMonth
  /*
   * Both arguments are load-bearing, and passing `undefined` for the locale
   * was a live hydration bug on this page's <h1>.
   *
   * LOCALE: `undefined` means "whatever locale the runtime has". This is a
   * 'use client' page, so it renders twice — once in Node and once in the
   * browser — and those two runtimes do not agree. Measured against the
   * deployed configuration: the server emitted "1 January 2027" and the
   * browser "January 1, 2027", which is a hydration mismatch on the largest
   * text on the page. app/about/page.tsx already pins 'en-GB'; this was the
   * one caller that did not.
   *
   * TIME ZONE: launchTrialUntil() parses a bare YYYY-MM-DD as UTC midnight, so
   * formatting it in local time renders the PREVIOUS DAY for every reader
   * behind UTC — the promotion would appear to end on 31 December 2026 across
   * the Americas. Formatting in UTC prints the date that was configured.
   */
  const untilLabel = trialUntil
    ? trialUntil.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {/* Inside the Play Store / App Store apps nothing on this page may lead to
          a purchase (see lib/app-shell.ts). This replaces the header, the plan
          cards and the FAQ there; the contact block below stays. */}
      <header data-store-only className="mx-auto max-w-2xl text-center">
        <p className="section-label">Your account</p>
        {/* Not an <h1>: the page must contain exactly one h1 element (a11y
            suite), and the real one is only display:none here. In the app that
            real h1 leaves the accessibility tree, so this is the exposed
            level-1 heading. */}
        <p role="heading" aria-level={1} className="section-title mt-2 text-3xl md:text-4xl">
          Everything in the app works with your account
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">
          The full 16-qubit simulator, every visualization and the Quantum Foundations course are
          free. Subscriptions are not sold in the app.
        </p>
      </header>
      <header data-store-hide className="mx-auto max-w-2xl text-center">
        <p className="section-label">Pricing</p>
        {trialOn ? (
          <>
            <h1 className="section-title mt-2 text-3xl md:text-4xl">
              {untilLabel
                ? `Everything is free until ${untilLabel}.`
                : `Everything is free for your first ${trialDays} days.`}
            </h1>
            <p className="section-desc mt-3">
              Create a free account and every paid feature — the live AI tutor, the full
              advanced track, the research workbench, the API, and real quantum hardware where
              this deployment has provider credentials configured — is yours. No credit card,
              nothing to cancel.{' '}
              {untilLabel
                ? 'It applies to every signed-in account, whenever you registered.'
                : null}{' '}
              The Quantum Foundations course and all {VISUALIZATIONS.length} interactive
              visualizations stay free forever afterwards, with or without an account.
            </p>
            {/*
              The one thing the promotion does NOT cover, said plainly and in
              the same breath rather than in an FAQ nobody reaches. Access is
              free; QPU time is not, because it is bought from IBM, IonQ,
              Rigetti and Quantinuum with real money. Somebody who reads
              "everything is free" and then meets a monthly cap has been
              misled, and this is the sentence that prevents it.
            */}
            {/*
              States the NUMBER rather than pointing at "each plan", because
              the plan table is hidden while the promotion runs and a reader has
              nothing to look up. Read from PLAN_BY_ID so it cannot drift from
              what lib/billing/usage.ts actually enforces — a promise about a
              quota has to come from the quota.
            */}
            <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
              One honest exception: <strong className="text-ink">time on real quantum
              hardware is still metered</strong>. Simulation is unlimited, but every job on a
              physical QPU is bought from IBM, IonQ, Rigetti or Quantinuum at real cost, so a
              free account still gets{' '}
              <strong className="text-ink">{trialHardwareJobs} hardware jobs a month</strong>,
              not unlimited ones. Free access, same quota.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {user ? (
                <Button asChild>
                  <Link href="/simulator">You&rsquo;re in — open the simulator</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/account?next=%2Fsimulator">Create a free account</Link>
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="section-title mt-2 text-3xl md:text-4xl">
              Start free. Upgrade when you want the tutor, the advanced track and hardware.
            </h1>
            <p className="section-desc mt-3">
              The entire Quantum Foundations course and all {VISUALIZATIONS.length} interactive
              visualizations are free forever — no trial, no credit card, no feature countdown.
              Pro exists for the things that genuinely cost us money to run: the live AI tutor,
              the advanced track beyond the foundations, and jobs on real quantum processors
              (in preview — available once provider credentials are configured on this
              deployment; the Hardware page says which are live).
            </p>
          </>
        )}
      </header>

      {/*
        THE PLAN CARDS ARE HIDDEN WHILE THE PROMOTION IS ON.

        Nothing on this page is for sale until the date in the headline above,
        so a table of monthly prices with a "Current plan" badge is at best
        noise and at worst a contradiction: it invites somebody to reason about
        which tier to buy, immediately under a sentence promising that none of
        them are charged. Pricing that cannot be acted on is not information.

        Tied to `trialOn`, NOT deleted. The moment
        NEXT_PUBLIC_LAUNCH_TRIAL_UNTIL / _DAYS is cleared, the promotion ends
        and this table comes back on its own — the page that has to sell is one
        env change away, not one PR away. Every price, feature list and Stripe
        wiring in components/billing/PricingTable.tsx is untouched.

        The visually-hidden <h2> travelled with the cards, and had to: it exists
        only because those cards title themselves with <h3>, and an outline that
        jumps h1 → h3 fails tests/e2e/a11y.spec.ts. With no cards there is no
        jump, and an empty labelled section would be a landmark pointing at
        nothing.
      */}
      {trialOn ? null : (
        <section data-store-hide className="mt-10" aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="sr-only">
            Plans and pricing
          </h2>
          <PricingTable
            currentPlanId={plan.id}
            userId={user?.id}
            email={user?.email ?? undefined}
            launchTrialDays={trialDays}
          />
        </section>
      )}

      <section data-store-hide className="mt-14">
        <h2 className="section-title text-xl">Questions people actually ask</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {FAQ.map((item) => (
            <details key={item.q} className="card group p-5">
              <summary className="focus-ring cursor-pointer list-none text-sm font-semibold text-ink marker:hidden">
                <span className="flex items-start justify-between gap-3">
                  <span>{item.q}</span>
                  <span
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-2.5 text-[13px] leading-relaxed text-ink-secondary">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/*
        No donation ask, anywhere. The support this project asks for is
        questions, improvement ideas and concerns — see components/ui/SupportUs.
      */}
      <OpenSource className="mt-12" />

      <SupportUs className="mt-12" />

      <section className="card mt-12 flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-base font-bold text-ink">Not sure yet?</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Build a Bell state in the simulator, or read the first lesson. Neither asks you for
            anything.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/simulator">Open the simulator</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/learn">Start the course</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
