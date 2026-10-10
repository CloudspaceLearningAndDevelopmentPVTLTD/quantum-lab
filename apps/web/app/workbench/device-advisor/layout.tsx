import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Device Advisor',
  description:
    'Paste a circuit and see IBM, IonQ, Rigetti and Quantinuum devices ranked by projected success and cost per surviving shot. Nothing is submitted.',
  path: '/workbench/device-advisor',
})

export default function WorkbenchDeviceAdvisorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/device-advisor')} />
      {children}
    </>
  )
}
