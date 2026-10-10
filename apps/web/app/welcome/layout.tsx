import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Get Started With Qubit16',
  description:
    'Pick a path — curious, student or developer — and build your first entangled circuit in under a minute. No install, no account, no maths degree.',
  path: '/welcome',
})

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
