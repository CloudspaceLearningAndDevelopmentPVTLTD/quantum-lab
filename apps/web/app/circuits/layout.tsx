import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Saved Circuits — Your Quantum Circuit Library',
  description:
    'Every circuit you have built and kept, in one place. Reopen one in the simulator, duplicate it as a starting point, or hand it to someone by link.',
  path: '/circuits',
})

export default function CircuitsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
