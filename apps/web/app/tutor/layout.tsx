import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'AI Quantum Tutor That Runs Its Own Circuits',
  // The old copy promised every answer was circuit-verified. It is not: the
  // tutor has three tiers and only the top one runs circuits — the middle tier
  // is a plain model call and the bottom is a fixed offline answer set. The
  // page shows which tier is live; the description should not promise the top
  // one to someone whose deployment is running the bottom one.
  description:
    'Ask about gates, superposition or entanglement. The full agent checks its own answer by running the circuit; the page always says which tier replied.',
  path: '/tutor',
})

export default function TutorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
