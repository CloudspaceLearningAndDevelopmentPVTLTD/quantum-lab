import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Your Account',
  description:
    'Manage your Qubit16 account, plan and billing details.',
  path: '/account',
  noIndex: true,
})

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
