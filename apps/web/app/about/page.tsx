import Link from 'next/link'
import { launchTrialUntil } from '@/lib/billing/launchTrial'
import SupportUs from '@/components/ui/SupportUs'
import OpenSource from '@/components/ui/OpenSource'

export default function AboutPage() {
  // Read from the policy, never written as a literal. A date typed into copy is
  // exactly how the last set of pricing claims drifted out of the entitlement
  // layer — see the header of app/pricing/faq.ts. When the promotion ends the
  // sentence disappears rather than becoming a lie.
  const until = launchTrialUntil()
  const untilLabel = until
    // timeZone: 'UTC' because launchTrialUntil() parses a bare date as UTC
    // midnight — without it every reader behind UTC is told the promotion ends
    // a day early. See the longer note in app/pricing/page.tsx.
    ? until.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="section-label">About</p>
        <h1 className="section-title mt-2">Qubit16</h1>
        <p className="section-desc mt-2">
          A quantum computing education platform built on one belief: you understand a qubit
          faster by watching it than by reading about it, and faster still by running a real
          circuit yourself than by watching someone else run one.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">Why this exists</h2>
        <div className="space-y-4 text-sm leading-relaxed text-ink-secondary">
          <p>
            Most ways to learn quantum computing today ask you to pick a side early. Video
            courses and interactive-visual platforms explain the ideas well but stop short of
            letting you run anything real. Notebook-based tools like Qiskit give you the real
            thing — actual circuit execution against a real simulator — but hand you a blank
            notebook and a textbook of math with no guided path through it. University courses
            split the difference but ask for a multi-week commitment before you know if the
            subject is for you.
          </p>
          <p>
            Qubit16 is built to not make you choose. Every visualization is interactive and
            computed in your browser, not a video. Every circuit you build runs on an exact
            statevector simulator in your browser — no upload, no queue — that is verified
            against Qiskit and PennyLane in our test suite; the AI tutor checks its answers
            with Qiskit/Aer, and every circuit exports as OpenQASM that loads straight into
            Qiskit. Not a canned animation. And when you get
            stuck, an AI tutor is there to explain specifically what you are looking at, not a
            search box pointed at a forum.
          </p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">What&rsquo;s actually different</h2>
        <ul className="space-y-3 text-sm leading-relaxed text-ink-secondary">
          <li>
            <strong className="text-ink">Exact, not simulated-to-look-real.</strong> Circuits run
            on an exact statevector simulator in your browser, and our test suite pins its
            results against Qiskit and PennyLane — the same libraries used in research and
            industry. Every circuit exports as OpenQASM that loads straight into Qiskit, so
            nothing you build here is a dead end.
          </li>
          <li>
            <strong className="text-ink">Zero install.</strong> No Jupyter, no Python
            environment, no package versions to fight. Open a browser tab and you are running
            circuits in seconds.
          </li>
          <li>
            <strong className="text-ink">Guided, not just reference material.</strong> A
            structured course sits alongside the tools, so &ldquo;what should I try
            next&rdquo; has an answer, and an AI tutor can see the actual circuit you built
            when you ask it a question about it — inspecting the statevector step by step,
            diffing two circuits to show exactly where they diverge, or fetching an arXiv
            abstract when a question calls for a primary source.
          </li>
          <li>
            <strong className="text-ink">Free to start, honestly.</strong> The simulator, the
            visualizations, the lessons and the challenges are free with no account required
            <span data-store-hide>
              {' '}— see <Link href="/pricing" className="text-primary underline">pricing</Link> for
              what paid plans add (mainly: running circuits on real quantum hardware, which costs
              money per job regardless of who is offering it)
            </span>
            .
          </li>
          <li>
            <strong className="text-ink">Built to fight forgetting, not just teach once.</strong>{' '}
            A spaced-repetition queue at{' '}
            <Link href="/review" className="text-primary underline">/review</Link> brings quiz
            questions back right before you&rsquo;d normally forget them — the same idea behind
            Quantum Country&rsquo;s essays, applied to this course. It is the one thing reviewers
            consistently say self-paced free courses are missing.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">How it&rsquo;s built</h2>
        <p className="text-sm leading-relaxed text-ink-secondary">
          Qubit16 is an open-source quantum mechanics learning platform. The visualizations,
          circuit editor and statevector simulator all run client-side, with the simulator
          verified against Qiskit and PennyLane in the test suite; the AI tutor checks its
          answers with Qiskit/Aer in a separate Python service, and exported notebooks and
          hardware jobs go through Qiskit too. The tutor uses a cheapest-first provider chain
          so answering a question does not depend on any one vendor. Progress and skill tracking are
          local-first — your learning data lives in your own browser by default, not on a
          server you have to trust.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">Who builds this</h2>
        <p className="text-sm leading-relaxed text-ink-secondary">
          A small team of developers who think quantum computing should be something you can
          learn by playing with it. Everything here is open source, and the Foundations course and
          all the visualizations are free permanently
          {untilLabel ? (
            <>
              , and until <strong className="text-ink">{untilLabel}</strong> every paid feature
              is free too — you only need an account
            </>
          ) : null}
          .
        </p>
      </section>

      <OpenSource className="mb-10" />

      <SupportUs className="mb-10" />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Get in touch</h2>
        <p className="text-sm leading-relaxed text-ink-secondary">
          Found a bug, have a feature request, or want to talk about using Qubit16 for a class
          or a team? Reach out through the{' '}
          <Link href="/account" className="text-primary underline">
            account
          </Link>{' '}
          page if you&rsquo;re signed in, or start at{' '}
          <Link href="/" className="text-primary underline">
            the homepage
          </Link>{' '}
          to explore what&rsquo;s here first.
        </p>
      </section>
    </div>
  )
}
