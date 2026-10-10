import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// /compete is a client component (it reads the live competition and the
// visitor's own attempts), so its metadata lives here. Without this it
// inherited the home page's long-form title — the only route that did, which
// tests/e2e/routes.spec.ts's distinct-title check exists to catch.
export const metadata: Metadata = pageMetadata({
  title: 'Weekly Gate Golf — Compete',
  description:
    'A fresh circuit puzzle every week: hit the target state in the fewest gates. Graded by the site’s own simulator, with a public leaderboard.',
  path: '/compete',
})

export default function CompeteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
