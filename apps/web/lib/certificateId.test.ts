/**
 * certificateId.test.ts — the credential number.
 *
 * `makeCertificateId` is deliberately NOT tested here for uniqueness or
 * unguessability, because it is neither: it is a hash of a name, it is an
 * ornament on the course-completion certificate, and lib/certificate.ts says so
 * at the top. What this file pins down is the other one — the id the exam
 * service mints, which is the only thing standing between a stranger and a
 * certificate lookup.
 */

import { describe, expect, it } from 'vitest'

import {
  CERTIFICATE_ID_PATTERN,
  makeCertificateId,
  newCertificateId,
  parseCertificateId,
} from './certificate'

describe('newCertificateId', () => {
  it('has the documented shape', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newCertificateId()).toMatch(CERTIFICATE_ID_PATTERN)
    }
  })

  it('does not repeat itself', () => {
    // 50 bits: a collision in 10,000 draws would be a broken RNG, not luck.
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i += 1) seen.add(newCertificateId())
    expect(seen.size).toBe(10_000)
  })

  it('uses no character that is mistyped off a printed page', () => {
    const ids = Array.from({ length: 500 }, () => newCertificateId())
    for (const id of ids) {
      const payload = id.slice(3).replace(/-/g, '')
      expect(/[ILOU]/.test(payload), `${id} contains an ambiguous character`).toBe(false)
    }
  })

  it('spreads evenly across the whole 32-symbol alphabet', () => {
    // `byte % 32` is exactly uniform (32 divides 256). A stray rejection step
    // once made symbols 24–31 (R…Z) 7/8 as likely as the others and the old
    // bounds caught that only 1–2% of the time; this pins it.
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i += 1) {
      for (const ch of newCertificateId().slice(3).replace(/-/g, '').slice(0, 10)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1)
      }
    }
    // 32 symbols over 40,000 draws: mean 1,250, σ ≈ 35; the per-symbol bounds
    // sit more than 5σ out. They are too loose to catch the 7/8 skew on their
    // own (skewed mean ≈ 1,129, only 2.4σ above 1,050 — hence the old flake),
    // so the eight symbols that skew is checked as a group: uniform gives
    // 10,000 ± 87, the skew gave ≈ 9,032, and 9,500 is > 5σ from both.
    expect(counts.size).toBe(32)
    for (const [, count] of counts) {
      expect(count).toBeGreaterThan(1_050)
      expect(count).toBeLessThan(1_800)
    }
    let upperEight = 0
    for (const ch of 'RSTVWXYZ') upperEight += counts.get(ch) ?? 0
    expect(upperEight).toBeGreaterThan(9_500)
    expect(upperEight).toBeLessThan(10_500)
  })
})

describe('parseCertificateId', () => {
  it('round-trips its own output', () => {
    for (let i = 0; i < 100; i += 1) {
      const id = newCertificateId()
      expect(parseCertificateId(id)).toBe(id)
    }
  })

  it('forgives how a human retypes one off a certificate', () => {
    const id = newCertificateId()
    const payload = id.slice(3).replace(/-/g, '')
    expect(parseCertificateId(id.toLowerCase())).toBe(id)
    expect(parseCertificateId(`  ${id}  `)).toBe(id)
    expect(parseCertificateId(`QL${payload}`)).toBe(id)
    expect(parseCertificateId(payload)).toBe(id)
  })

  it('folds the characters people confuse back into the ones we mint', () => {
    // '1' is in the alphabet and 'I' is not, so someone reading a serif font
    // and typing I must still land on the right certificate.
    expect(parseCertificateId('QL-11111-11111-B')).toBe(parseCertificateId('QL-IIIII-IIIII-B'))
    expect(parseCertificateId('QL-00000-00000-0')).toBe(parseCertificateId('QL-OOOOO-OOOOO-0'))
  })

  it('rejects a number whose checksum does not add up', () => {
    const id = newCertificateId()
    const wrongCheck = `${id.slice(0, -1)}${id.endsWith('Z') ? 'Y' : 'Z'}`
    expect(parseCertificateId(wrongCheck)).toBeNull()
  })

  it('rejects anything that is not a certificate number at all', () => {
    for (const junk of ['', 'hello', 'QL-', 'QL-AAAA-AAAA-A', '../../etc/passwd', 'QL-AAAAA-AAAAA']) {
      expect(parseCertificateId(junk), `${junk} was accepted`).toBeNull()
    }
  })
})

describe('makeCertificateId is still the ornament it claims to be', () => {
  it('is a pure function of the name and the track', () => {
    // Pinned deliberately: /learn/certificate depends on the same learner
    // getting the same number on every render, and someone reading this file
    // should see immediately that anyone can compute it for any name — which is
    // exactly why the exam certification does not use it.
    expect(makeCertificateId('Ada Lovelace', 'foundations')).toBe(
      makeCertificateId('  ada lovelace ', 'FOUNDATIONS')
    )
    expect(makeCertificateId('Ada Lovelace', 'foundations')).not.toBe(
      makeCertificateId('Ada Lovelace', 'advanced')
    )
    expect(makeCertificateId('Ada Lovelace', 'foundations')).not.toMatch(CERTIFICATE_ID_PATTERN)
  })
})
