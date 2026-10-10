import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Run Your Circuit on Real Quantum Hardware',
  description:
    'Send a circuit you built here to a real IBM or IonQ processor, see the cost first, then compare the noisy hardware counts against the ideal run.',
  path: '/hardware',
})

export default function HardwareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
