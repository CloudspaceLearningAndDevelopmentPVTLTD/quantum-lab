/**
 * certificate.badge.test.ts — what a shared certificate may say, and what it
 * must never say.
 *
 * The badge assertion and the LinkedIn deep link are the two formats a
 * certificate leaves this site in, so the load-bearing assertions here are
 * negative ones: neither format contains the score, the attempt id, the user
 * id, or the email — the same privacy line /verify draws, now enforced at the
 * serialisation boundary. The route test runs against the real
 * `lookupCertificate` chain with the in-memory exam store (no
 * SUPABASE_SERVICE_ROLE_KEY set), because a badge built from anything other
 * than the verified server record would be the bug this feature must not have.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  badgeAssertion,
  linkedInAddToProfileUrl,
  newCertificateId,
  type VerifiedCertificateFacts,
} from '@/lib/certificate'
import { getExamStore } from '@/lib/exams/store'
import { GET as badgeGET } from '@/app/api/certificates/[certificateId]/badge/route'

const FACTS: VerifiedCertificateFacts = {
  id: 'QL-4F2AH-9C31T-K',
  name: 'Ada Lovelace',
  examTitle: 'Quantum Foundations Certification',
  examId: 'foundations-cert',
  issuedAt: '2026-08-16T12:34:56.000Z',
}

const ORIGIN = 'https://quantum-lab.example'

describe('badgeAssertion', () => {
  it('is an Open Badges 3.0-style OpenBadgeCredential', () => {
    const badge = badgeAssertion(FACTS, ORIGIN)
    expect(badge['@context']).toEqual([
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
    ])
    expect(badge.type).toEqual(['VerifiableCredential', 'OpenBadgeCredential'])
    expect(badge.id).toBe(`${ORIGIN}/api/certificates/${FACTS.id}/badge`)
    expect(badge.validFrom).toBe(FACTS.issuedAt)

    const subject = badge.credentialSubject as Record<string, unknown>
    const achievement = subject.achievement as Record<string, unknown>
    expect(achievement.name).toBe(FACTS.examTitle)
    expect(JSON.stringify(subject)).toContain('Ada Lovelace')
  })

  it('names this site as the issuer and links back to /verify', () => {
    const badge = badgeAssertion(FACTS, `${ORIGIN}/`) // trailing slash tolerated
    const issuer = badge.issuer as Record<string, unknown>
    expect(issuer.name).toBe('Qubit16')
    expect(issuer.url).toBe(`${ORIGIN}/`)
    const status = badge.credentialStatus as Record<string, unknown>
    expect(status.id).toBe(`${ORIGIN}/verify/${FACTS.id}`)
  })

  it('never mentions score, attempts, user id or email', () => {
    const json = JSON.stringify(badgeAssertion(FACTS, ORIGIN)).toLowerCase()
    for (const banned of ['score', 'attempt', 'userid', 'user_id', 'email']) {
      expect(json).not.toContain(banned)
    }
  })
})

describe('linkedInAddToProfileUrl', () => {
  it('builds the documented add-to-profile deep link', () => {
    const url = new URL(linkedInAddToProfileUrl(FACTS, ORIGIN))
    expect(url.origin).toBe('https://www.linkedin.com')
    expect(url.pathname).toBe('/profile/add')
    expect(url.searchParams.get('startTask')).toBe('CERTIFICATION_NAME')
    expect(url.searchParams.get('name')).toBe(FACTS.examTitle)
    expect(url.searchParams.get('organizationName')).toBe('Qubit16')
    expect(url.searchParams.get('certId')).toBe(FACTS.id)
    expect(url.searchParams.get('certUrl')).toBe(`${ORIGIN}/verify/${FACTS.id}`)
    // UTC parts of issuedAt; issueMonth is 1–12, not JavaScript's 0–11.
    expect(url.searchParams.get('issueYear')).toBe('2026')
    expect(url.searchParams.get('issueMonth')).toBe('8')
  })

  it('omits the issue date rather than sending garbage for a bad timestamp', () => {
    const url = new URL(linkedInAddToProfileUrl({ ...FACTS, issuedAt: 'not-a-date' }, ORIGIN))
    expect(url.searchParams.get('issueYear')).toBeNull()
    expect(url.searchParams.get('issueMonth')).toBeNull()
    // The rest of the link still works.
    expect(url.searchParams.get('certId')).toBe(FACTS.id)
  })

  it('carries no score and no holder name (LinkedIn asks the holder, not us)', () => {
    const url = linkedInAddToProfileUrl(FACTS, ORIGIN)
    expect(url).not.toContain('score')
    expect(url).not.toContain(encodeURIComponent('Ada Lovelace'))
  })
})

describe('GET /api/certificates/[certificateId]/badge', () => {
  const request = (id: string) =>
    badgeGET(new Request(`http://test.local/api/certificates/${id}/badge`), {
      params: Promise.resolve({ certificateId: id }),
    })

  let issuedId: string

  beforeEach(async () => {
    issuedId = newCertificateId()
    await getExamStore().insertCertificate({
      id: issuedId,
      userId: 'user_123',
      examId: 'foundations-cert',
      attemptId: 'att_abc',
      displayName: 'Ada Lovelace',
      score: 92,
      issuedAt: '2026-08-16T12:34:56.000Z',
    })
  })

  it('serves the badge for an issued certificate, from the verified record', async () => {
    const res = await request(issuedId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/ld+json')

    const badge = (await res.json()) as Record<string, unknown>
    expect(badge.type).toEqual(['VerifiableCredential', 'OpenBadgeCredential'])
    expect(badge.validFrom).toBe('2026-08-16T12:34:56.000Z')
    const subject = badge.credentialSubject as Record<string, unknown>
    expect(JSON.stringify(subject)).toContain('Ada Lovelace')
    // The stored row has a score of 92; the badge must not carry it.
    expect(JSON.stringify(badge).toLowerCase()).not.toContain('score')
    expect(JSON.stringify(badge)).not.toContain('att_abc')
    expect(JSON.stringify(badge)).not.toContain('user_123')
  })

  it('404s a well-formed number that was never issued', async () => {
    const res = await request(newCertificateId())
    expect(res.status).toBe(404)
  })

  it('404s a malformed number', async () => {
    const res = await request('QL-NOT-A-CERT')
    expect(res.status).toBe(404)
  })
})
