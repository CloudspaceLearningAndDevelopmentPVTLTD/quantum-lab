/**
 * NotFoundPanel.tsx — the body of every not-found.tsx in this app.
 *
 * NOT a client component, and deliberately so: a 404 has nothing to report and
 * nothing to reset. `notFound()` is a routing outcome, not a failure, and
 * sending one to the error tracker would fill it with crawler traffic and bury
 * the errors that matter.
 *
 * WHAT MAKES A 404 USEFUL HERE. Every `notFound()` in this app is thrown for
 * one reason: a slug that is not in a small, known, entirely local set — seven
 * lesson slugs, ten challenge ids, two exam ids. So the honest message is not
 * "page not found" but "there is no lesson by that name, here is the list",
 * and the list is one click away. That turns a dead end into a redirect the
 * learner performs themselves.
 */

import Link from 'next/link'

export interface NotFoundPanelProps {
  /** Headline naming the thing that does not exist. */
  title: string
  /** One or two sentences. Say what set was searched. */
  children: React.ReactNode
  /** Where to go instead. The first is rendered as the primary action. */
  links: { href: string; label: string }[]
}

export function NotFoundPanel({ title, children, links }: NotFoundPanelProps): React.JSX.Element {
  const [primary, ...rest] = links

  return (
    // Not <main>: app/layout.tsx owns the single <main> landmark. See RouteError.
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="card p-8">
        <p className="section-label">Not found</p>
        <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-secondary">
          {children}
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          {primary ? (
            <Link href={primary.href} className="btn-primary focus-ring">
              {primary.label}
            </Link>
          ) : null}
          {rest.map((link) => (
            <Link key={link.href} href={link.href} className="btn-ghost focus-ring">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
