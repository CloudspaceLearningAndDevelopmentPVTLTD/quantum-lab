import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'QML Reality Check — Quantum vs Classical Classifiers',
  description:
    'Train a variational quantum classifier against tuned logistic regression and a small MLP on moons, circles and a quantum-made dataset, plus 2026 evidence.',
  path: '/workbench/qml-check',
})

export default function WorkbenchQmlCheckLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/qml-check')} />
      {children}
    </>
  )
}
