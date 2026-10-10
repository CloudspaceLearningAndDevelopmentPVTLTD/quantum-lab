import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Offline',
  description:
    'You are offline. Qubit16 will reconnect when your network comes back.',
  path: '/offline',
  noIndex: true,
})

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
