import Link from 'next/link'
import { Button } from '@/components/ui/button'

type Row = {
  name: string
  offers: string
  missing: string
}

const ROWS: Row[] = [
  {
    name: 'IBM Quantum (Composer + IBM Quantum Learning)',
    offers:
      'Free; Composer is a browser-native drag-and-drop editor that runs on simulators and real hardware; Qiskit and a huge community',
    missing:
      'No AI tutor, no spaced-repetition review; the courses assume linear algebra, so it is steep for beginners; self-paced with nothing bringing you back',
  },
  {
    name: 'Brilliant.org — Quantum Computing',
    offers:
      'Best-in-class interactive visual teaching (built with Microsoft, Alphabet X and Caltech IQIM), an in-browser circuit simulator and Q# code exercises',
    missing:
      'No free-form circuit editor, no OpenQASM/Qiskit export, no path to real hardware, no spaced-repetition review, no AI tutor',
  },
  {
    name: 'University courses (edX/Coursera — MIT, Berkeley, UChicago)',
    offers: 'Academic rigor and a real credential',
    missing:
      'Lecture-and-problem-set format; usually self-paced but multi-week, with auto-graded quizzes rather than a live tutor; hands-on circuit work is a separate Qiskit/Jupyter setup; no spaced-repetition review',
  },
  {
    name: 'Microsoft Learn — Get started with Azure Quantum',
    offers: 'Free Q#-first modules; Azure Quantum also accepts Qiskit, Cirq and OpenQASM',
    missing: 'Requires a VS Code / QDK install; code-first rather than visualization-first; no tutor or review queue',
  },
]

export default function ComparePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="section-label">Compare</p>
        <h1 className="section-title mt-2">How Qubit16 stacks up</h1>
        <p className="section-desc mt-2">
          There are several genuinely good ways to learn quantum computing online today. Each
          one asks you to trade off something. Qubit16 is the only one that combines
          Brilliant&rsquo;s visual, interactive approachability with an exact statevector
          simulator that runs in your browser — no upload, no queue — and is verified against
          Qiskit and PennyLane in our test suite; the AI tutor checks its answers with
          Qiskit/Aer, and every circuit exports as OpenQASM that loads straight into Qiskit.
          Add a live AI tutor and a spaced-repetition review queue, with zero install, in the
          browser.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">Where the others stand out</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-secondary">
          This isn&rsquo;t a claim that Qubit16 is better at everything. IBM&rsquo;s community and
          real hardware access is unmatched. Brilliant&rsquo;s visual teaching is best-in-class.
          A university course still gets you a credential Qubit16 doesn&rsquo;t offer. Each of
          these is a fair choice depending on what you&rsquo;re optimizing for.
        </p>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-3 font-semibold text-ink">
                  Platform
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink">
                  What it offers
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink">
                  What it&rsquo;s missing
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 align-top font-medium text-ink">{row.name}</td>
                  <td className="px-4 py-3 align-top text-ink-secondary">{row.offers}</td>
                  <td className="px-4 py-3 align-top text-ink-secondary">{row.missing}</td>
                </tr>
              ))}
              <tr className="bg-primary/5">
                <td className="px-4 py-3 align-top font-medium text-ink">Qubit16</td>
                <td className="px-4 py-3 align-top text-ink-secondary">
                  Interactive visualizations, a free-form circuit editor on an exact in-browser
                  statevector simulator (verified against Qiskit and PennyLane, with OpenQASM
                  export), a live AI tutor that checks its answers with Qiskit/Aer, and a
                  spaced-repetition review queue that resurfaces quiz questions before
                  you&rsquo;d forget them — free to start, zero install, in the browser
                </td>
                <td className="px-4 py-3 align-top text-ink-secondary">
                  No hardware-vendor community the size of IBM&rsquo;s, no academic credential
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">The gap this fills</h2>
        <p className="text-sm leading-relaxed text-ink-secondary">
          Nobody else on this list combines all four: a visual, interactive approach you don&rsquo;t
          need to already know how to code to follow; a free-form circuit editor on an exact
          simulator, with OpenQASM export and a path to hardware, rather than a fixed set of
          exercises; an AI tutor that can see what you built and explain it, not a
          search box pointed at a forum; and a spaced-repetition queue that gives a self-paced,
          free course the one thing reviewers consistently say self-paced free courses lack —
          something that brings you back before you forget, without a deadline or a mentor call.
          That&rsquo;s the specific combination Qubit16 is built around.
        </p>
      </section>

      <section className="card flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="mb-1 text-base font-semibold text-ink">See it for yourself</h2>
          <p className="text-sm text-ink-secondary">
            Free to start, no account required.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button asChild>
            <Link href="/welcome">Get started</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/simulator">Try the simulator</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
