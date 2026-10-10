import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { workbenchToolSchemas } from '@/components/seo/schema'

export const metadata: Metadata = pageMetadata({
  title: 'Calibration Agent',
  description:
    'An RL agent holds X-gate fidelity on a drifting qubit from measurement counts alone, against scheduled recalibration — Google\'s Willow result in miniature.',
  path: '/workbench/calibration',
})

export default function WorkbenchCalibrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={workbenchToolSchemas('/workbench/calibration')} />
      {children}
    </>
  )
}
