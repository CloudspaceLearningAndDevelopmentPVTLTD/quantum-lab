import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Platform console',
  description: 'Operator console for the Qubit16 AI tutor: providers, routing and access by tier.',
  path: '/admin/platform',
  noIndex: true,
})

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
