/**
 * plans.ts — the single source of truth for what each tier can do.
 *
 * This is a PURE module: no Stripe, no Supabase, no browser APIs. Both the
 * client (to grey out a locked control) and the server (to actually refuse the
 * request) import it, so a gate can never drift between the two.
 *
 * SECURITY: client-side checks are a courtesy, not a control. Every route that
 * grants a paid capability must call `assertFeature` server-side with an
 * entitlement it resolved itself — never one the browser sent.
 */

// Pure static data, not a browser/server API — importing it does not break
// this file's "no Stripe, no Supabase, no browser APIs" purity above. Used
// once below so the Free tier's highlight never drifts from the real
// catalogue count the way a hardcoded "eight" did (VISUALIZATIONS.length is
// 40 today; the pricing page still said eight).
import { VISUALIZATIONS } from './visualizations'

// ────────────────────────────────────────────────────────────
// Tiers
// ────────────────────────────────────────────────────────────

export type PlanId = 'free' | 'pro' | 'team' | 'edu'

export type BillingPeriod = 'monthly' | 'yearly'

/**
 * Every id here must be enforceable: something `assertFeature` can refuse in a
 * route handler. Do not add an id for a capability a human arranges off-platform
 * (SSO, a bespoke lesson track, a support contact) — listing it would make
 * `hasFeature` answer true for something no code delivers, which is the same
 * lie as the marketing copy, moved somewhere harder to spot. Those belong in
 * `Plan.arrangedHighlights`.
 */
export type FeatureId =
  | 'simulator.basic'
  | 'simulator.qubits.5'
  | 'simulator.qubits.12'
  | 'simulator.qubits.16'
  | 'circuits.save'
  | 'circuits.unlimited'
  | 'circuits.share'
  | 'hardware.simulator'
  | 'hardware.vendor'
  | 'hardware.real'
  | 'tutor.offline'
  | 'tutor.live'
  | 'course.foundations'
  | 'course.advanced'
  | 'certification'
  | 'export.qasm'
  | 'export.notebook'
  | 'team.seats'
  | 'team.admin'
  | 'analytics.usage'

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  /** Price in the smallest currency unit (cents), per period. */
  price: Record<BillingPeriod, number>
  currency: 'usd'
  /** Stripe price ids, read from env at runtime. Empty in dev. */
  stripePriceEnv: Record<BillingPeriod, string>
  features: FeatureId[]
  /**
   * Bullet copy for the pricing table. Every line here must be something the
   * entitlement layer grants the moment checkout completes — a self-serve buyer
   * clicks Upgrade and gets it. If a claim needs a human to arrange it, it goes
   * in `arrangedHighlights` instead, where the reader is told so.
   */
  highlights: string[]
  /**
   * Capabilities that are real but delivered by hand during onboarding, not by
   * the entitlement layer. Rendered under a heading that says exactly that, so
   * nobody mistakes them for something a subscription switch turns on.
   *
   * Only legitimate on a `contactSales` plan — there is a human in that loop to
   * keep the promise. plans.test.ts asserts that invariant; do not relax it to
   * park an unbuilt feature on a self-serve tier.
   */
  arrangedHighlights?: string[]
  limits: {
    maxQubits: number
    maxSavedCircuits: number
    /** Hardware jobs allowed per calendar month. 0 = none. */
    hardwareJobsPerMonth: number
    /** Tutor messages per day. Infinity for unlimited. */
    tutorMessagesPerDay: number
    seats: number
  }
  /** Rendered with a "most popular" ribbon. */
  featured?: boolean
  /** Contact-sales rather than self-serve checkout. */
  contactSales?: boolean
}

// The full 16-qubit simulator is free for everyone, signed in or not. It runs
// in the visitor's own browser, so it costs this deployment nothing, and a site
// called Qubit16 that capped visitors at 5 qubits (and launch-trial accounts at
// 12) was breaking its own name. Plans differ on hardware, the live tutor, the
// advanced track and seats — not on simulator width.
const FREE_FEATURES: FeatureId[] = [
  'simulator.basic',
  'simulator.qubits.5',
  'simulator.qubits.12',
  'simulator.qubits.16',
  'circuits.save',
  'circuits.share',
  'hardware.simulator',
  'tutor.offline',
  'course.foundations',
  'export.qasm',
]

const PRO_FEATURES: FeatureId[] = [
  ...FREE_FEATURES,
  'circuits.unlimited',
  'hardware.vendor',
  'hardware.real',
  'tutor.live',
  'course.advanced',
  'certification',
  'export.notebook',
]

const TEAM_FEATURES: FeatureId[] = [
  ...PRO_FEATURES,
  'team.seats',
  'team.admin',
  'analytics.usage',
]

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything you need to actually learn quantum mechanics.',
    price: { monthly: 0, yearly: 0 },
    currency: 'usd',
    stripePriceEnv: { monthly: '', yearly: '' },
    features: FREE_FEATURES,
    highlights: [
      `All ${VISUALIZATIONS.length} interactive visualizations`,
      'The full 16-qubit circuit simulator',
      'The full Quantum Foundations course',
      'Save and share up to 10 circuits',
      'Offline AI tutor',
    ],
    limits: {
      maxQubits: 16,
      maxSavedCircuits: 10,
      hardwareJobsPerMonth: 0,
      tutorMessagesPerDay: 20,
      seats: 1,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'The live tutor, the advanced track, and real quantum hardware in preview.',
    price: { monthly: 1900, yearly: 19000 },
    currency: 'usd',
    stripePriceEnv: {
      monthly: 'STRIPE_PRICE_PRO_MONTHLY',
      yearly: 'STRIPE_PRICE_PRO_YEARLY',
    },
    features: PRO_FEATURES,
    highlights: [
      'Everything in Free',
      'Run circuits on real quantum hardware (in preview — available once provider credentials are configured on this deployment)',
      'Live Claude-powered tutor',
      'Advanced course track and certification',
      'Unlimited saved circuits and notebook export',
    ],
    limits: {
      maxQubits: 16,
      maxSavedCircuits: Number.POSITIVE_INFINITY,
      hardwareJobsPerMonth: 50,
      tutorMessagesPerDay: Number.POSITIVE_INFINITY,
      seats: 1,
    },
    featured: true,
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'For research groups and classrooms.',
    price: { monthly: 9900, yearly: 99000 },
    currency: 'usd',
    stripePriceEnv: {
      monthly: 'STRIPE_PRICE_TEAM_MONTHLY',
      yearly: 'STRIPE_PRICE_TEAM_YEARLY',
    },
    features: TEAM_FEATURES,
    highlights: [
      'Everything in Pro, for 10 seats',
      'Admin console with seat management',
      'Cohort progress and usage analytics',
      '500 hardware jobs a month, per seat',
    ],
    // "Shared circuit library" used to be the fifth bullet and was removed: no
    // org-scoped circuit storage exists. `lib/circuit-store.ts` writes to
    // `public.circuits` keyed by the individual user, and the only sharing
    // primitive is `circuits.share` (a per-circuit link), which Free already
    // has. A $99/mo self-serve buyer would have clicked Upgrade and got
    // nothing. The replacement bullet is enforced by `limits`: the quota is
    // resolved per user in getEntitlement, so 500 really is per seat, not
    // pooled across the org. If an org library is ever built, it needs a
    // FeatureId, an org-scoped table, and a server gate — not a bullet.
    limits: {
      maxQubits: 16,
      maxSavedCircuits: Number.POSITIVE_INFINITY,
      hardwareJobsPerMonth: 500,
      tutorMessagesPerDay: Number.POSITIVE_INFINITY,
      seats: 10,
    },
  },
  {
    // ── Why this plan's copy reads the way it does ──────────────────────
    // The old highlights promised SSO, LMS grade passback, custom lesson
    // tracks and a priority hardware queue. None of the four is a FeatureId,
    // so the entitlement layer could neither grant nor refuse any of them.
    // Each was triaged against what exists in this repo:
    //
    //  · SSO — not built, but buildable by hand: Supabase Auth is the identity
    //    layer and its SAML/OIDC connection is project-level configuration, not
    //    app code. Kept as an `arrangedHighlights` line because a human is on
    //    the call for this plan. There is no self-serve toggle and there must
    //    not appear to be one.
    //  · Custom lesson tracks — same shape. `lib/lessons/index.ts` is compiled
    //    TypeScript, so a bespoke track is something we author and ship in a
    //    release, not something a customer edits. Kept, framed as such.
    //  · LMS grade passback — REMOVED. It is not merely unbuilt, it is not
    //    presently buildable: lesson progress lives in localStorage
    //    (`lib/lessons/progress.ts`) and never reaches a server, so there is no
    //    score on our side to push into an LTI gradebook. Restoring this line
    //    requires server-side progress first.
    //  · Priority hardware queue — REMOVED. The queue belongs to IBM/Azure;
    //    `services/api` submits jobs and cannot reorder a provider's queue for
    //    anyone. The real departmental benefit is the 5,000-job allowance,
    //    which is in `limits` and therefore true, so that is what we say.
    id: 'edu',
    name: 'University',
    tagline: 'Campus-wide access, arranged with us directly.',
    price: { monthly: 0, yearly: 0 },
    currency: 'usd',
    stripePriceEnv: { monthly: '', yearly: '' },
    features: TEAM_FEATURES,
    highlights: [
      'Everything in Team',
      'Unlimited seats across a department',
      '5,000 hardware jobs a month',
    ],
    arrangedHighlights: [
      'A named support contact',
      'Single sign-on, configured with your IT department',
      'A lesson track written for your syllabus and shipped in a release',
    ],
    limits: {
      maxQubits: 16,
      maxSavedCircuits: Number.POSITIVE_INFINITY,
      hardwareJobsPerMonth: 5000,
      tutorMessagesPerDay: Number.POSITIVE_INFINITY,
      seats: Number.POSITIVE_INFINITY,
    },
    contactSales: true,
  },
]

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p])
) as Record<PlanId, Plan>

// ────────────────────────────────────────────────────────────
// Entitlement — the resolved answer to "what can THIS user do right now"
// ────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'

export interface Entitlement {
  planId: PlanId
  status: SubscriptionStatus
  /** ISO timestamp when the current period ends, if subscribed. */
  currentPeriodEnd?: string
  /** True when the subscription is set to lapse at period end. */
  cancelAtPeriodEnd?: boolean
  /** Set when the plan comes from an org seat rather than a personal sub. */
  viaOrgId?: string
  /**
   * Set when the plan comes from the launch-period policy — every account
   * younger than NEXT_PUBLIC_LAUNCH_TRIAL_DAYS is Pro — rather than from a
   * subscription row. See lib/billing/launchTrial.ts. `currentPeriodEnd` is
   * then the trial's end, or absent if the account's age was unknowable.
   */
  launchTrial?: boolean
  /** Hardware jobs already used this calendar month. */
  hardwareJobsUsed: number
}

/** The entitlement for a signed-out or unsubscribed visitor. */
export const FREE_ENTITLEMENT: Entitlement = {
  planId: 'free',
  status: 'none',
  hardwareJobsUsed: 0,
}

/**
 * A subscription only confers its plan while it is in good standing.
 * `past_due` deliberately keeps access — dunning should not lock someone out of
 * a lesson mid-sentence — but `canceled` and `incomplete` fall back to free.
 */
export function effectivePlan(e: Entitlement): Plan {
  const good = e.status === 'active' || e.status === 'trialing' || e.status === 'past_due'
  return good ? PLAN_BY_ID[e.planId] : PLAN_BY_ID.free
}

export function hasFeature(e: Entitlement, feature: FeatureId): boolean {
  return effectivePlan(e).features.includes(feature)
}

export function limitsFor(e: Entitlement): Plan['limits'] {
  return effectivePlan(e).limits
}

export function maxQubitsFor(e: Entitlement): number {
  return effectivePlan(e).limits.maxQubits
}

export function canRunHardware(e: Entitlement): { allowed: boolean; reason?: string } {
  const plan = effectivePlan(e)
  if (!plan.features.includes('hardware.real')) {
    return { allowed: false, reason: 'Running on real quantum hardware is a Pro feature.' }
  }
  if (e.hardwareJobsUsed >= plan.limits.hardwareJobsPerMonth) {
    return {
      allowed: false,
      reason: `You have used all ${plan.limits.hardwareJobsPerMonth} hardware jobs included this month.`,
    }
  }
  return { allowed: true }
}

export function canSaveAnotherCircuit(e: Entitlement, currentCount: number): boolean {
  return currentCount < effectivePlan(e).limits.maxSavedCircuits
}

/** Thrown by `assertFeature`. Route handlers should map this to HTTP 402. */
export class FeatureLockedError extends Error {
  readonly feature: FeatureId
  readonly requiredPlan: PlanId
  constructor(feature: FeatureId, requiredPlan: PlanId) {
    super(`This requires the ${PLAN_BY_ID[requiredPlan].name} plan.`)
    this.name = 'FeatureLockedError'
    this.feature = feature
    this.requiredPlan = requiredPlan
  }
}

/** The cheapest plan that includes a given feature. */
export function requiredPlanFor(feature: FeatureId): PlanId {
  const found = PLANS.find((p) => p.features.includes(feature))
  return found ? found.id : 'pro'
}

/**
 * Server-side gate. Call this in a route handler BEFORE doing the paid work.
 * Never trust a plan id sent from the browser — resolve the entitlement first.
 */
export function assertFeature(e: Entitlement, feature: FeatureId): void {
  if (!hasFeature(e, feature)) {
    throw new FeatureLockedError(feature, requiredPlanFor(feature))
  }
}

// ────────────────────────────────────────────────────────────
// Display helpers
// ────────────────────────────────────────────────────────────

export function formatPrice(cents: number, currency: 'usd' = 'usd'): string {
  if (cents === 0) return 'Free'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** Yearly saving as a percentage of twelve monthly payments. */
export function yearlySavingPercent(plan: Plan): number {
  const twelve = plan.price.monthly * 12
  if (twelve === 0 || plan.price.yearly === 0) return 0
  return Math.round((1 - plan.price.yearly / twelve) * 100)
}

export function formatLimit(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : 'Unlimited'
}
