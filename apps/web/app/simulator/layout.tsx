import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { simulatorSchema } from '@/components/seo/schema'
import { PLAN_BY_ID } from '@/lib/plans'

/**
 * The qubit count is read from `lib/plans.ts` rather than typed, so this
 * search-result description can never promise more than the page delivers.
 * Every plan, including a signed-out visitor, now gets the full 16 qubits —
 * the simulator runs in the visitor's browser and costs nothing to serve.
 */
const FREE_QUBITS = PLAN_BY_ID.free.limits.maxQubits

export const metadata: Metadata = pageMetadata({
  title: 'Quantum Circuit Simulator — Free, In-Browser',
  description:
    `A state-vector quantum circuit simulator that runs in your browser — all ${FREE_QUBITS} qubits ` +
    `free, no account needed. Inspect amplitudes, export OpenQASM 3.`,
  path: '/simulator',
})

/**
 * The one page on this site that is genuinely a SoftwareApplication rather than
 * a document about one. See the note on `simulatorSchema` for why there is no
 * `aggregateRating`.
 */
export default function SimulatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={simulatorSchema()} />
      {children}
    </>
  )
}
