/**
 * types.ts — the data model for team / university licensing.
 *
 * A PURE module: no browser APIs, no Supabase, no React. Both the store
 * (lib/orgs/store.ts), the route handlers under app/api/orgs/* and the admin
 * console components import these shapes, so the client and the server can
 * never disagree about what a seat is.
 *
 * The field names here are the *application* names (camelCase). The database
 * column names they map to live in supabase/schema-orgs.sql and are mirrored by
 * the row interfaces in store.ts — in particular `org_members.plan_id` and
 * `org_members.status`, which lib/billing/entitlements.ts already queries when
 * it takes the stronger of a personal plan and an org seat.
 */

import type { PlanId } from '@/lib/plans'

/**
 * Seat roles, ordered from most to least privileged.
 *  - owner  : billing contact. There must always be at least one.
 *  - admin  : may add, remove, suspend and re-role members.
 *  - member : may use the seat, may not manage it.
 */
export type OrgRole = 'owner' | 'admin' | 'member'

/** Whether a seat is currently consuming licence capacity. */
export type OrgMemberStatus = 'active' | 'invited' | 'suspended'

export interface Org {
  id: string
  name: string
  /** URL-safe short name, unique per deployment. */
  slug: string
  /** Only 'team' and 'edu' may own seats — see createOrg(). */
  planId: PlanId
  /** Licensed seats. `Number.POSITIVE_INFINITY` for the University plan. */
  seatsTotal: number
  /** Seats currently consumed (active + invited; suspended seats are freed). */
  seatsUsed: number
  /** Optional email domain used for auto-join in a future iteration. */
  domain?: string
  createdAt: string
  ownerId: string
}

export interface OrgMember {
  id: string
  orgId: string
  /** The auth.users id once the person has signed in; '' while only invited. */
  userId: string
  email: string
  role: OrgRole
  status: OrgMemberStatus
  joinedAt: string
  lastActiveAt?: string
}

export interface OrgInvite {
  id: string
  orgId: string
  email: string
  role: OrgRole
  /**
   * SHA-256 of the invite token, hex — NOT the token (audit finding INV-1).
   *
   * The raw token is a secret that exists exactly once, in the response that
   * mints it, and is never persisted. This field is what is stored and what is
   * looked up; see lib/orgs/invites.ts for why the scheme is random-and-hashed
   * rather than an HMAC. Anything that puts a raw token in this field has
   * reintroduced the bug.
   */
  tokenHash: string
  expiresAt: string
  /** Set the moment the invite is claimed. Single use — a set value is spent. */
  acceptedAt?: string
  createdAt: string
}

/** One row of the cohort progress table, derived rather than stored. */
export interface CohortStats {
  memberId: string
  email: string
  lessonsCompleted: number
  totalLessons: number
  /** Mean quiz score as a percentage, or null when nothing has been graded. */
  quizAverage: number | null
  circuitsSaved: number
  lastActiveAt?: string
}

/** Roles that may manage seats. Used by both the UI and the API routes. */
export const MANAGER_ROLES: OrgRole[] = ['owner', 'admin']

export function canManageSeats(role: OrgRole): boolean {
  return MANAGER_ROLES.includes(role)
}

/** Narrowing helpers for untrusted JSON bodies arriving at a route handler. */
export function isOrgRole(value: unknown): value is OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member'
}

export function isOrgMemberStatus(value: unknown): value is OrgMemberStatus {
  return value === 'active' || value === 'invited' || value === 'suspended'
}
