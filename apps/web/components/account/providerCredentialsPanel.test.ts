import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ProviderCredentials } from './ProviderCredentials'

/**
 * Render smoke test for the BYOK panel, in the same spirit as
 * components/viz/laserPage.test.ts: a bad import, a control given the wrong
 * prop shape or a conditional hook shows up here.
 *
 * `renderToStaticMarkup` runs no effects, so the panel renders in its LOADING
 * state — before `/api/credentials` has answered. That is the right thing to
 * assert on for this component, because the two blocks that must never go
 * missing are exactly the two that do not depend on the fetch:
 *
 *   · how to obtain the credential, and
 *   · what handing one over actually means.
 *
 * Everything else on the panel is a consequence of data — the field inputs are
 * generated from the server's catalogue, so there is nothing to render until
 * it arrives. Those two are the reason it is safe to ask for a credential at
 * all, and a refactor that moved them behind a loaded state would be a real
 * regression that no other test in this repository would notice.
 */

describe('the BYOK panel', () => {
  const html = renderToStaticMarkup(createElement(ProviderCredentials))

  it('mounts and explains what the feature does', () => {
    expect(html).toContain('Run on your own hardware account')
    expect(html).toContain('stop counting against your monthly allowance')
  })

  it('names all three providers, not just IBM', () => {
    expect(html).toContain('IBM Quantum')
    expect(html).toContain('Amazon Braket')
    expect(html).toContain('Azure Quantum')
  })

  it('tells the reader how to get the credential, in the panel', () => {
    // Not behind a documentation link. The errand is only quick if you already
    // know where the value lives.
    expect(html).toContain('How do I get IBM Quantum credentials?')
    expect(html).toContain('quantum.ibm.com')
    expect(html).toContain('Open plan is free')
    expect(html).toContain('API token')
    expect(html).toContain('CRN')
  })

  it('shows the disclosure even before the credential list has loaded', () => {
    // The form itself is gated on the fetch — the fields come from the
    // server's catalogue — but the disclosure is NOT, and that asymmetry is
    // the point. A reader must never reach an input for a live vendor
    // credential through a state where the consequences have not been stated.
    //
    // `renderToStaticMarkup` runs no effects, so this markup IS the pre-fetch
    // state: the disclosure being present here is the assertion.
    expect(html).toContain('Before you paste it')
    expect(html).toContain('How do I get IBM Quantum credentials?')
    expect(html).not.toContain('byok-ibm-token')
  })

  it('says the secret half is encrypted and never shown again', () => {
    expect(html).toContain('encrypted')
    expect(html).toContain('never sent back to your browser')
  })

  it('says which fields are NOT secret, and that they are stored in the clear', () => {
    // People expect both halves of an AWS key pair to be secret. A field that
    // is stored in the clear has to say so where they can see it, before they
    // paste it — not in a doc they will not read.
    expect(html).toContain('stored in the clear')
    expect(html).toContain('AWS access key ID')
  })

  it('says plainly that removing it here is NOT revocation', () => {
    // The sentence that decides whether somebody who thinks their credential
    // has leaked goes and actually kills it at the vendor.
    expect(html).toContain('Removing it here is not revocation')
  })

  it('never labels the remove control "revoke"', () => {
    expect(html).not.toMatch(/>\s*Revoke/i)
  })

  it('links to the vendor console with a safe target', () => {
    // `target=_blank` without `rel=noreferrer` hands the opener to a third
    // party; these point at IBM/AWS/Azure, but the rule has no exceptions.
    const anchors = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []
    expect(anchors.length).toBeGreaterThan(0)
    for (const anchor of anchors) expect(anchor).toContain('noreferrer')
  })
})
