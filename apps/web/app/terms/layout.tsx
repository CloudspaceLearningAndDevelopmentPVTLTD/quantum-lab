import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Terms of Use',
  description:
    'Plain-language terms for using Qubit16: what’s free, the launch trial, acceptable use, hardware costs, certification, and the open-source licence.',
  path: '/terms',
})

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
