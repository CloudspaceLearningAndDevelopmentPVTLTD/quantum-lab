import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, HOME_CRUMB } from '@/components/seo/schema'
import { LESSONS } from '@/lib/lessons'
import { CHALLENGES } from '@/lib/challenges/catalogue'
import { EXAMS } from '@/lib/exams/catalogue'
import { VISUALIZATIONS } from '@/lib/visualizations'
import { CONTACT_EMAIL } from '@/lib/legal'

/**
 * /educators — the institutional pitch, written from docs/CLASSROOM.md, which
 * describes code that exists. Every claim below names the feature behind it;
 * nothing here promises a roadmap item. The counts are derived from the
 * catalogues so they cannot go stale.
 */

const SALES_EMAIL = CONTACT_EMAIL

const CAPABILITIES: { title: string; body: string; where: string }[] = [
  {
    title: 'Assignments from the material you already trust',
    body: `An assignment is a title, a due date and an ordered list of items — any of the ${LESSONS.length} lessons, ${CHALLENGES.length} graded challenges or ${EXAMS.length} certification exams. Learners see a checklist; you see who has finished it.`,
    where: '/instructor → Cohort',
  },
  {
    title: 'Classes inside one licence',
    body: 'Group seats into named classes and publish an assignment to one class or to everyone. Completion figures count only the learners the assignment applies to.',
    where: 'org_classes · lib/orgs/assignments.ts',
  },
  {
    title: 'Progress that learners choose to share',
    body: 'Progress lives in the learner\'s browser by default. Sharing it with an instructor is an explicit, revocable switch on the learner\'s side — the console never invents data it was not given.',
    where: '/admin → Coursework · org_progress_consent',
  },
  {
    title: 'Export and grade your way',
    body: 'One-click CSV of completion per learner per item, so it lands in your gradebook or LMS without anyone re-typing it.',
    where: '/instructor → Cohort → Export',
  },
  {
    title: 'A co-pilot for course material',
    body: 'Draft quizzes, worked examples and lab scripts against the course\'s own content with the AI tutor\'s tool-calling agent — it can run the circuit it is writing about to check itself.',
    where: '/instructor → Co-pilot',
  },
  {
    title: 'Embed a live circuit in your own pages',
    body: 'A chrome-free circuit widget your LMS or course site can iframe, with a two-line loader and a documented message protocol. Runs in the student\'s browser; nothing to install.',
    where: '/embed/circuit · docs/EMBED.md',
  },
  {
    title: 'Certification with public verification',
    body: 'Timed, randomised exams drawn from a question bank, graded server-side. Every certificate has a verification page a third party can check without an account.',
    where: '/certify · /verify',
  },
  {
    title: 'Real hardware, budgeted per seat',
    body: 'Submit circuits to IBM or Amazon Braket devices from the same editor, with a per-seat monthly quota so a class cannot run up a bill by accident.',
    where: '/hardware · hardware_usage',
  },
]

export default function EducatorsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <JsonLd data={breadcrumbSchema([HOME_CRUMB, { name: 'For educators', path: '/educators' }])} />

      <header className="mx-auto max-w-3xl text-center">
        <p className="section-label">For educators and institutions</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">
          Teach quantum computing with a lab, not a slide deck.
        </h1>
        <p className="section-desc mt-4 text-base">
          Qubit16 gives every student a browser-based quantum lab — {VISUALIZATIONS.length}{' '}
          interactive visualizations, a 16-qubit circuit simulator, an AI tutor that checks its
          own answers by running circuits, and real hardware access — and gives you the tools to
          run a course on top of it: seats, classes, assignments, completion tracking and export.
          Nothing to install on any machine.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Qubit16 for our institution')}`}>
              Talk to us about a licence
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/instructor">See the instructor console</Link>
          </Button>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Every learner also gets everything free for 30 days with an individual account — try
          it with one class before you talk to anyone.
        </p>
      </header>

      <section className="mt-14" aria-labelledby="capabilities">
        <h2 id="capabilities" className="section-title text-xl">
          What you can actually do
        </h2>
        <p className="section-desc mt-1">
          Each item names the part of the product it lives in. If it is not listed here, it is not
          built yet.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <article key={c.title} className="card card-hover p-5">
              <h3 className="text-base font-bold text-ink">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{c.body}</p>
              <p className="mt-3 font-mono text-[11px] text-ink-muted">{c.where}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="How a course runs">
        {[
          ['1', 'Invite', 'Add seats by email from /admin. Learners sign in with a magic link — no passwords to manage, no accounts to provision by hand.'],
          ['2', 'Assign', 'Compose an assignment from lessons, challenges and exams, set a due date, publish to a class or to everyone.'],
          ['3', 'See', 'Watch completion in the cohort console as learners opt in to share; export CSV whenever grades are due.'],
        ].map(([n, title, body]) => (
          <div key={n} className="card p-5">
            <p className="font-mono text-2xl font-bold text-q-violet-text">{n}</p>
            <h3 className="mt-1 text-base font-bold text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 card p-6 md:p-8" aria-labelledby="privacy">
        <h2 id="privacy" className="text-lg font-bold text-ink">
          Privacy, stated plainly
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          A learner&rsquo;s progress, quiz scores and exam attempts live in their own browser by
          default and never reach a server unless they turn on sharing for your organisation.
          When they do, the instructor console shows completion of assigned items — not
          keystrokes, not time-on-page, not anything the learner did not ask to share. A learner
          can revoke sharing at any time. The AI tutor is never shown a learner&rsquo;s identity.
          This is the design, not a setting: see docs/ANALYTICS.md and docs/CLASSROOM.md in the
          open-source repository.
        </p>
      </section>

      <section className="mt-14 card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-ink">Pilot it with one class</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Team and University plans are on the pricing page. For a departmental pilot, a
            custom seat count or an invoice, email us — a person replies.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 sm:shrink-0">
          <Button asChild>
            <a href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Qubit16 pilot')}`}>Email {SALES_EMAIL}</a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pricing">See plans</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
