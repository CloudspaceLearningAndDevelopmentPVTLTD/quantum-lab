/**
 * The two Azure inputs that silently produce a 404.
 *
 * Both failures answer with the identical body —
 * `{"error":{"code":"404","message":"Resource not found"}}` — which is also
 * what a wrong deployment name returns, so nothing in the error tells you
 * which of the three it was. Measured against the live resource on
 * 2026-09-12: `/openai/deployments/<d>/chat/completions?api-version=2024-10-21`
 * answered 200; the same URL minus `/openai` answered 404; the same URL with
 * `api-version=v1` answered 404.
 */
import { describe, expect, it } from 'vitest'

import { generateText } from 'ai'

import { AZURE_DEFAULT_API_VERSION, azureApiVersion, azureBaseUrl, buildLanguageModel } from './model'

describe('azureBaseUrl', () => {
  it('adds the /openai segment the portal endpoint leaves off', () => {
    // Exactly what Azure portal → Keys and Endpoint puts on the clipboard.
    expect(azureBaseUrl('https://vegaduta-ai-az-aoai.openai.azure.com/')).toBe(
      'https://vegaduta-ai-az-aoai.openai.azure.com/openai',
    )
    expect(azureBaseUrl('https://vegaduta-ai-az-aoai.openai.azure.com')).toBe(
      'https://vegaduta-ai-az-aoai.openai.azure.com/openai',
    )
  })

  it('leaves a base that already carries the segment alone', () => {
    const good = 'https://vegaduta-ai-az-aoai.openai.azure.com/openai'
    expect(azureBaseUrl(good)).toBe(good)
    expect(azureBaseUrl(`${good}/`)).toBe(good)
  })

  it('leaves the versionless /openai/v1 base alone — the SDK routes it differently', () => {
    const v1 = 'https://vegaduta-ai-az-aoai.openai.azure.com/openai/v1'
    expect(azureBaseUrl(v1)).toBe(v1)
  })

  it('handles the cognitiveservices hostname the CLI reports', () => {
    // az cognitiveservices account show returns this form for kind=AIServices;
    // it answers 200 on the same path as the openai.azure.com alias.
    expect(azureBaseUrl('https://vegaduta-ai-az-aoai.cognitiveservices.azure.com/')).toBe(
      'https://vegaduta-ai-az-aoai.cognitiveservices.azure.com/openai',
    )
  })

  it('passes an empty base through so providerReady still sees it as unset', () => {
    expect(azureBaseUrl('')).toBe('')
    expect(azureBaseUrl('   ')).toBe('')
  })
})

describe('azureApiVersion', () => {
  it('never leaves the version blank — the SDK would send the literal "v1"', () => {
    expect(azureApiVersion('')).toBe(AZURE_DEFAULT_API_VERSION)
    expect(azureApiVersion('   ')).toBe(AZURE_DEFAULT_API_VERSION)
  })

  it('keeps a configured version, trimmed', () => {
    expect(azureApiVersion('2025-04-01-preview')).toBe('2025-04-01-preview')
    expect(azureApiVersion(' 2024-10-21 ')).toBe('2024-10-21')
  })

  it('defaults to the version infra/azure/deploy.sh pins', () => {
    expect(AZURE_DEFAULT_API_VERSION).toBe('2024-10-21')
  })
})

/**
 * The Azure ROUTE, not just its URL prefix.
 *
 * Regression guard for a production outage in which every tutor request
 * returned {"error":{"code":"404","message":"Resource not found"}}. Every
 * piece of configuration was correct — endpoint, deployment name, api-version
 * and key were all verified by hand against the live resource — but the AI
 * SDK's provider call signature selects the RESPONSES API, so the request
 * went to `/deployments/<deployment>/responses`, a route Azure does not serve
 * on its GA api-versions. Azure reports a missing route with the same body as
 * a missing deployment, so the error pointed at the one thing that was not
 * wrong.
 *
 * No key and no network: a stub `fetch` captures the URL the SDK builds.
 */
describe('the Azure client targets the chat-completions route', () => {
  async function urlFor(p: Parameters<typeof buildLanguageModel>[0]): Promise<string> {
    let captured = ''
    const stub = async (input: unknown): Promise<Response> => {
      captured = String((input as { url?: string })?.url ?? input)
      return new Response(JSON.stringify({ error: { code: '404', message: 'Resource not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    const original = globalThis.fetch
    globalThis.fetch = stub as unknown as typeof globalThis.fetch
    try {
      await generateText({ model: buildLanguageModel(p), prompt: 'hi' }).catch(() => undefined)
    } finally {
      globalThis.fetch = original
    }
    return captured
  }

  const azureProvider = {
    id: 'azure' as const,
    apiKey: 'dummy',
    model: 'gpt-4-1-mini',
    baseUrl: 'https://example-resource.openai.azure.com/openai',
    apiVersion: '2024-10-21',
    label: 'Azure OpenAI',
    litellmModel: 'azure/gpt-4-1-mini',
  }

  it('uses /chat/completions and never /responses', async () => {
    const url = await urlFor(azureProvider as Parameters<typeof buildLanguageModel>[0])
    expect(url).toContain('/deployments/gpt-4-1-mini/chat/completions')
    // The actual defect: /responses 404s on every GA api-version.
    expect(url).not.toContain('/responses')
  })

  it('keeps the deployment name and api-version intact in that URL', async () => {
    const url = await urlFor(azureProvider as Parameters<typeof buildLanguageModel>[0])
    expect(url).toContain('api-version=2024-10-21')
    expect(url.startsWith('https://example-resource.openai.azure.com/openai/deployments/')).toBe(true)
  })
})
