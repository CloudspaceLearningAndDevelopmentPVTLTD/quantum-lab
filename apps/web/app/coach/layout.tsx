import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Your Personalised Quantum Study Plan',
  description:
    'A study plan built from what you have actually done: lessons finished, ideas you keep getting wrong, and the next thing worth an hour of your time.',
  path: '/coach',
})

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
