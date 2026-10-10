import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Learning Insights, Computed in Your Browser',
  description:
    'See which lessons you finished, where you slowed down, and how your challenge attempts are trending — computed locally from your own progress.',
  path: '/insights',
})

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
