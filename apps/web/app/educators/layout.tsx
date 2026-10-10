import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Qubit16 for Educators and Institutions',
  description:
    'Run a quantum course on Qubit16: seats, classes, assignments from the same lessons, completion tracking, CSV export, an embeddable circuit widget.',
  path: '/educators',
})

export default function EducatorsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
