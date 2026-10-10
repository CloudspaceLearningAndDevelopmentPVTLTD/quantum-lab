/**
 * lib/workbench/experimentStore.ts — which ExperimentStore this process uses.
 *
 * SERVER ONLY: reads the service-role key through lib/billing/entitlements.
 * Do not import from a client component; the page reads records over
 * /api/workbench/experiments instead.
 *
 * Service role present → SupabaseExperimentStore (durable, shared across
 * instances). Otherwise → one MemoryExperimentStore for the life of the
 * process. The choice is memoised so every route and every MCP tool in a
 * process sees the same map, and it is overridable so tests can hand the
 * tools a fresh memory store without touching the environment.
 */

import { getServiceSupabase } from '@/lib/billing/entitlements'
import {
  MemoryExperimentStore,
  SupabaseExperimentStore,
  type ExperimentStore,
} from '@/lib/workbench/experiments'

let store: ExperimentStore | null = null

export function getExperimentStore(): ExperimentStore {
  if (store) return store
  const service = getServiceSupabase()
  store = service ? new SupabaseExperimentStore(service) : new MemoryExperimentStore()
  return store
}

/** Test seam. Pass null to return to environment-driven resolution. */
export function setExperimentStore(next: ExperimentStore | null): void {
  store = next
}
