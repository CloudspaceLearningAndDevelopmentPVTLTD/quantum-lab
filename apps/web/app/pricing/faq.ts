import { CONTACT_EMAIL, CONTACT_PHONE, HELLO_EMAIL } from '@/lib/legal'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import { TRACKS } from '@/lib/lessons'
import { PLAN_BY_ID, formatLimit } from '@/lib/plans'

/**
 * The pricing FAQ, in its own module so that two things can read it: the page
 * that renders it, and `app/pricing/layout.tsx`, which emits the FAQPage
 * JSON-LD from it.
 *
 * WHY IT IS NOT STILL IN page.tsx: that file is `'use client'`, and a server
 * component importing a plain value from a client module gets a client-
 * reference proxy, not the array — reading it on the server throws. Splitting
 * the data out is the only way the structured data and the rendered answers can
 * be the same strings. Restating six paragraphs of refund and seat policy in
 * the layout would be wrong within a month, and FAQ markup that does not match
 * the visible page is a structured-data violation, not a cosmetic slip.
 *
 * Every number a plan is quoted with is read from `lib/plans.ts`. A literal
 * here is how the last set of claims drifted out of the entitlement layer.
 *
 * The one number below that is NOT a plan limit — the per-job shots cap in
 * "What counts as a hardware job?" — cannot be imported the same way: it lives
 * in `lib/hardware/proxy.ts` (`MAX_SHOTS`), a server-only module that reads a
 * secret out of `process.env` and explicitly forbids being imported from a
 * component, and this FAQ is read by the client-rendered pricing page. That
 * value mirrors `services/api/app/core/config.py`'s `max_shots`, which is the
 * actual enforced backend limit (20,000) — not the hardware page's shots
 * slider, whose 4,096 ceiling was never anything but a UI oversight (see
 * `app/hardware/page.tsx`, which now matches this number). If `MAX_SHOTS`
 * ever changes, update the literal below and the slider's `max` together.
 */
const HARDWARE_JOB_MAX_SHOTS = 20_000

const FOUNDATIONS_LESSON_COUNT = TRACKS[0].lessonSlugs.length
const FREE_SAVED_CIRCUITS = formatLimit(PLAN_BY_ID.free.limits.maxSavedCircuits)
const FREE_QUBITS = PLAN_BY_ID.free.limits.maxQubits
// Read from the plan, never written as a literal — the launch promotion
// grants Pro, so Pro's allowance is the number people actually meet.
const PRO_HARDWARE_JOBS = formatLimit(PLAN_BY_ID.pro.limits.hardwareJobsPerMonth)
const TEAM_SEATS = formatLimit(PLAN_BY_ID.team.limits.seats)
const TEAM_HARDWARE_JOBS = formatLimit(PLAN_BY_ID.team.limits.hardwareJobsPerMonth)
const EDU_HARDWARE_JOBS = formatLimit(PLAN_BY_ID.edu.limits.hardwareJobsPerMonth)

export interface FaqItem {
  q: string
  a: string
}

export const FAQ: FaqItem[] = [
  {
    q: 'What happens when I cancel?',
    a: `Your subscription stays active until the end of the period you already paid for, then drops to Free — we do not cut access the moment you click cancel. Nothing is deleted: every circuit you saved stays in your library and stays readable, you just cannot save new ones past the Free limit of ${FREE_SAVED_CIRCUITS} until you delete some or resubscribe. Course progress and certificates are yours permanently.`,
  },
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The Free plan is not a trial — there is no card field anywhere in the signup flow and no expiry date on your account. You are only ever asked for payment details at the moment you choose to upgrade, on a Stripe-hosted checkout page. We never see or store your card number.',
  },
  {
    q: 'What counts as a hardware job?',
    a: `One submission of one circuit to a real quantum processor, regardless of how many shots you request (up to ${HARDWARE_JOB_MAX_SHOTS.toLocaleString('en-US')}, which is the per-job cap). Runs against the local simulator and the noisy simulator backends are unlimited on every plan and never count. If a job fails in the provider queue or is cancelled before it executes, email us and we will credit it back to your allowance — that credit is a person, not an automated rule.`,
  },
  {
    q: 'Can I use this for a university course?',
    a: `Yes, and this is the case we designed the Team and University plans for. Team gives you ${TEAM_SEATS} seats with an admin console and cohort progress analytics, and ${TEAM_HARDWARE_JOBS} hardware jobs a month per seat. University adds unlimited departmental seats and a ${EDU_HARDWARE_JOBS}-job monthly allowance. Two more things come with University, but they are arranged with us on a call rather than switched on by a subscription: single sign-on, which we configure with your IT department, and a lesson track written for your syllabus, which we author and ship in a release. We do not currently do LMS grade passback — progress is stored in the learner's own browser, so there is no score on our side to push into a gradebook — and we cannot give you priority in a hardware provider's queue, because that queue is IBM's, not ours. Instructors can also just point a class at the Free plan; the full Foundations course works with no account at all.`,
  },
  {
    q: 'Is the course really free?',
    a: `Really. All ${FOUNDATIONS_LESSON_COUNT} Quantum Foundations lessons, all ${VISUALIZATIONS.length} interactive visualizations, the circuit simulator up to ${FREE_QUBITS} qubits, QASM export, and the offline tutor are free permanently and will not move behind the paywall later. We would rather more people understand superposition than squeeze a subscription out of a beginner. Pro covers the advanced track and the costs that scale with usage.`,
  },
  {
    // The single most likely misreading of "everything is free", and the one
    // that turns into a support ticket the first time somebody hits the cap.
    // The answer has to be the specific number, not a reassurance.
    q: 'Everything is free right now — is hardware unlimited too?',
    a: `No, and this is the one exception worth knowing before you plan around it. During the launch period every signed-in account gets the Pro feature set free — the live tutor, the advanced track, the workbench, the API and real hardware access — but the monthly HARDWARE ALLOWANCE still applies: ${PRO_HARDWARE_JOBS} jobs a month on Pro. Simulation is unlimited and always has been, on every plan, with no account. The difference is that a job on a physical QPU is bought from IBM, IonQ, Rigetti or Quantinuum at real cost, and no promotion on our side changes what they charge us. Free access, same quota.`,
  },
  {
    q: 'Is this open source? How can I support it?',
    a: `Yes, it is open source, and we are not asking anyone for money. The plans exist because real QPU time is bought from the hardware providers at real cost, but during the launch period none of them are charged, and the Foundations course and every visualization are free permanently either way. The best way to support Qubit16 is to talk to us: send your questions, ideas for improvements and any concerns to ${HELLO_EMAIL} or ${CONTACT_EMAIL}, or call ${CONTACT_PHONE}. We read every message, we are genuinely happy to help, and the good ideas get built.`,
  },
  {
    q: 'How do refunds work?',
    a: 'Email us within 14 days of any charge and we refund it in full, no questions and no exit survey — including annual plans and including renewals you forgot were coming. Refunds go back to the original card and typically land in 5 to 10 business days. If a hardware provider outage kept you from running jobs you paid for, tell us and we will credit the month even outside that window.',
  },
]
