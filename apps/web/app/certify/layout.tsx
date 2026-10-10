import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Quantum Computing Certification Exams',
  description:
    'Timed, graded certification exams covering the foundations and advanced tracks. Sit one when ready and earn a shareable certificate for a passing score.',
  path: '/certify',
})

export default function CertifyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
