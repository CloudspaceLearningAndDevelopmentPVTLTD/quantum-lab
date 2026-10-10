/**
 * certificate.ts — eligibility, identity and formatting for certificates.
 *
 * ── TWO KINDS OF NUMBER LIVE IN THIS FILE. THEY ARE NOT INTERCHANGEABLE. ────
 *
 * `makeCertificateId(name, trackId)` is an ORNAMENT. It is a deterministic hash
 *   of a name the learner typed, so /learn/certificate can print the same
 *   number every time it re-renders. Anyone can produce it for any name in one
 *   line of JavaScript, which is exactly why the course-completion certificate
 *   calls itself "a record of study rather than a credential". Do not put it on
 *   anything that claims to be verified.
 *
 * `newCertificateId()` is a CREDENTIAL id. 50 bits of `crypto` randomness plus
 *   a checksum character, minted on the server when — and only when — a
 *   server-graded attempt by a signed-in user passed. It is unguessable and it
 *   means nothing on its own: it is a key into `exam_certificates`, and
 *   `/verify/<id>` answers by looking it up. A number with no row is not a
 *   certificate, and the verification route says so.
 *
 * The checksum is not security. It exists so that a mistyped id is rejected as
 * a typo before it costs a database round trip, and so `/verify` can tell a
 * human "that is not the shape of a certificate number" instead of the more
 * alarming "no such certificate".
 */

import { TRACKS, LESSONS } from './lessons'
import type { Track } from './lessons/types'

export interface CertificateData {
  name: string
  trackName: string
  /** ISO-8601 timestamp of completion. */
  completedAt: string
  lessonCount: number
  id: string
}

/**
 * FNV-1a, 32-bit. Chosen because it is six lines, has no dependencies, and
 * spreads short strings well enough that neighbouring names do not collide
 * visibly. `>>> 0` after each step keeps the value an unsigned 32-bit integer
 * despite JavaScript's signed bitwise operators.
 */
function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function block(value: number): string {
  return (value & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

/**
 * A short, stable, human-readable id such as 'QL-4F2A-9C31'.
 * Same name and track always give the same id.
 *
 * ORNAMENT, NOT CREDENTIAL — see this file's header. Used by
 * /learn/certificate, which is a record of study. The certification exams use
 * `newCertificateId` and nothing else.
 */
export function makeCertificateId(name: string, trackId: string): string {
  const seed = `${name.trim().toLowerCase()}|${trackId.trim().toLowerCase()}`
  const a = hash32(seed)
  const b = hash32(`${seed}|${a.toString(16)}`)
  return `QL-${block(a >>> 16)}-${block(b)}`
}

// ────────────────────────────────────────────────────────────
// Credential ids — the exam certificates
// ────────────────────────────────────────────────────────────

/**
 * Crockford's base32 alphabet: no I, L, O or U.
 *
 * I/1, O/0 and L/1 are the pairs people mis-transcribe off a printed
 * certificate, and U is dropped so a random id cannot spell an unfortunate
 * word. `parseCertificateId` folds the ambiguous characters back in, so
 * someone who types QL-I… gets the certificate whose id contains 1.
 */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 10 payload characters = 50 bits. */
const PAYLOAD_CHARS = 10

/** `QL-` + 5 + `-` + 5 + `-` + 1 checksum, e.g. `QL-4F2AH-9C31T-K`. */
export const CERTIFICATE_ID_PATTERN = /^QL-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]$/

function checksumChar(payload: string): string {
  let sum = 0
  for (const ch of payload) sum = (sum + B32.indexOf(ch)) % 32
  return B32[sum] as string
}

/**
 * A fresh credential id. SERVER-SIDE USE ONLY — minting one in a browser would
 * mean the browser decides what a certificate number is.
 *
 * `crypto.getRandomValues` and not `Math.random`: this id is the only thing
 * standing between a stranger and a certificate lookup, so it has to be
 * unguessable rather than merely unlikely. 50 bits is ~1.1e15 possibilities;
 * at one guess per millisecond, finding any single issued certificate takes
 * longer than the product will exist. `byte % 32` is exactly uniform because
 * 32 divides 256: each of the 32 symbols owns eight of the 256 byte values.
 * (No rejection step — an earlier `if (byte >= 248) continue` was wrong
 * arithmetic, 256 % 32 being 0, and it threw away one of the eight aliases of
 * symbols 24–31 so R…Z came up 7/8 as often as the rest.)
 */
export function newCertificateId(): string {
  let payload = ''
  const buf = new Uint8Array(PAYLOAD_CHARS)
  crypto.getRandomValues(buf)
  for (const byte of buf) payload += B32[byte % 32] as string
  return `QL-${payload.slice(0, 5)}-${payload.slice(5)}-${checksumChar(payload)}`
}

/**
 * Normalise something a human typed into the canonical id, or null.
 *
 * Accepts lower case, missing hyphens, surrounding whitespace and the
 * transcription-ambiguous characters. Returns null when the checksum fails,
 * which is the "you have mistyped this" case rather than the "no such
 * certificate" case — `/verify` distinguishes the two in what it says.
 */
export function parseCertificateId(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/^QL/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
  if (cleaned.length !== PAYLOAD_CHARS + 1) return null
  const payload = cleaned.slice(0, PAYLOAD_CHARS)
  const check = cleaned.slice(PAYLOAD_CHARS)
  for (const ch of payload) if (!B32.includes(ch)) return null
  if (checksumChar(payload) !== check) return null
  return `QL-${payload.slice(0, 5)}-${payload.slice(5)}-${check}`
}

export interface CertificateEligibility {
  eligible: boolean
  completed: number
  total: number
}

function findTrack(trackId: string): Track | undefined {
  return TRACKS.find((track) => track.id === trackId)
}

/** Which lessons a track contains, and how many of them are done. */
export function certificateEligibility(
  trackId: string,
  completedSlugs: string[]
): CertificateEligibility {
  const track = findTrack(trackId)
  if (!track) return { eligible: false, completed: 0, total: 0 }

  const done = new Set(completedSlugs)
  const completed = track.lessonSlugs.filter((slug) => done.has(slug)).length
  const total = track.lessonSlugs.length
  return { eligible: total > 0 && completed === total, completed, total }
}

/** Slugs in a track that the learner has not finished yet, in track order. */
export function remainingLessons(trackId: string, completedSlugs: string[]): string[] {
  const track = findTrack(trackId)
  if (!track) return []
  const done = new Set(completedSlugs)
  return track.lessonSlugs.filter((slug) => !done.has(slug))
}

/** Display title for a slug, falling back to the slug itself. */
export function lessonTitle(slug: string): string {
  return LESSONS.find((lesson) => lesson.slug === slug)?.title ?? slug
}

// ────────────────────────────────────────────────────────────
// Sharing a verified certificate — Open Badges + LinkedIn
// ────────────────────────────────────────────────────────────

/**
 * The facts a share format may carry: exactly what `/verify` shows and nothing
 * more. This type exists so the badge and the LinkedIn link are BUILT FROM the
 * verification result rather than from the stored row — there is no field here
 * for score, attempts, account or email, so those cannot leak by refactor.
 *
 * Deliberately structural (not imported from lib/exams/types): this file is
 * shared with client components, and `boundary.test.ts` counts import edges
 * into the exam service layer.
 */
export interface VerifiedCertificateFacts {
  /** The credential id, e.g. QL-4F2AH-9C31T-K. */
  id: string
  /** The self-attested holder name, as printed on the certificate. */
  name: string
  /** Display title of the exam ("Quantum Foundations Certification"). */
  examTitle: string
  /** ISO-8601 issue timestamp. */
  issuedAt: string
  /** Catalogue id of the exam, when it still exists. */
  examId?: string
}

const ISSUER_NAME = 'Qubit16'

/**
 * An Open Badges 3.0-style JSON-LD assertion (an `OpenBadgeCredential`).
 *
 * UNSIGNED, deliberately: without an issuer keypair a fabricated `proof` block
 * would be worse than none. What makes this badge checkable is that its `id`
 * is a URL on our origin — a consumer who dereferences it gets this same
 * document only while the certificate row exists, and `/verify/<id>` gives the
 * human-readable answer. `origin` is a parameter (not read from env here) so
 * the function stays pure and testable.
 */
export function badgeAssertion(
  facts: VerifiedCertificateFacts,
  origin: string
): Record<string, unknown> {
  const base = origin.replace(/\/+$/, '')
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
    ],
    id: `${base}/api/certificates/${facts.id}/badge`,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    name: facts.examTitle,
    issuer: {
      id: `${base}/`,
      type: ['Profile'],
      name: ISSUER_NAME,
      url: `${base}/`,
    },
    validFrom: facts.issuedAt,
    credentialSubject: {
      type: ['AchievementSubject'],
      // The name is self-attested at claim time; /verify says the same thing.
      identifier: [
        {
          type: 'IdentityObject',
          identityType: 'name',
          hashed: false,
          identityHash: facts.name,
        },
      ],
      achievement: {
        id: `${base}/certify#${facts.examId ?? 'retired'}`,
        type: ['Achievement'],
        name: facts.examTitle,
        description:
          `Awarded for passing the ${facts.examTitle} — a timed, server-graded ` +
          `${ISSUER_NAME} certification exam.`,
        criteria: {
          narrative:
            'The holder completed a timed exam graded entirely on the server ' +
            'while signed in, and met the pass mark. Verifiable at the URL below.',
        },
      },
    },
    /** Where a human checks this credential. */
    credentialStatus: {
      id: `${base}/verify/${facts.id}`,
      type: 'CredentialStatusList2017',
    },
  }
}

/**
 * LinkedIn's "Add to profile" deep link for a certification.
 *
 * Format per LinkedIn's Add-to-Profile program (addtoprofile.linkedin.com):
 * `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&…` with
 * `name`, `organizationName`, `issueYear`/`issueMonth` (1–12), `certId` and
 * `certUrl`. `certUrl` points at `/verify/<id>` so the "Show credential"
 * button on the profile lands on the page that actually checks the number.
 * No expiration parameters: these certificates do not expire.
 */
export function linkedInAddToProfileUrl(
  facts: VerifiedCertificateFacts,
  origin: string
): string {
  const base = origin.replace(/\/+$/, '')
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: facts.examTitle,
    organizationName: ISSUER_NAME,
    certId: facts.id,
    certUrl: `${base}/verify/${facts.id}`,
  })
  const issued = new Date(facts.issuedAt)
  if (!Number.isNaN(issued.getTime())) {
    // UTC, matching formatCertificateDate — the date shown on /verify and the
    // date on the LinkedIn entry must never disagree by a timezone.
    params.set('issueYear', String(issued.getUTCFullYear()))
    params.set('issueMonth', String(issued.getUTCMonth() + 1))
  }
  return `https://www.linkedin.com/profile/add?${params.toString()}`
}

/**
 * "16 August 2026". Fixed to en-GB so the server and the client agree — a
 * locale-dependent format would be a hydration mismatch waiting to happen.
 */
export function formatCertificateDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
