import { describe, it, expect } from 'vitest'
import { STORE_APP_ATTR, STORE_APP_SCRIPT } from './app-shell'

/** Run the inline detection script against a fake browser; report whether it marked <html>. */
function detect(opts: { ua?: string; referrer?: string; search?: string; stored?: string | null }) {
  const attrs: Record<string, string> = {}
  const store: Record<string, string> = opts.stored ? { 'qubit16.storeApp': opts.stored } : {}
  const document = {
    referrer: opts.referrer ?? '',
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } },
  }
  const sessionStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
  }
  new Function('navigator', 'document', 'location', 'sessionStorage', STORE_APP_SCRIPT)(
    { userAgent: opts.ua ?? 'Mozilla/5.0 Chrome/154.0' },
    document,
    { search: opts.search ?? '' },
    sessionStorage,
  )
  return { marked: attrs[STORE_APP_ATTR] === '1', remembered: store['qubit16.storeApp'] === '1' }
}

describe('store-app detection (purchase entry points are hidden when it fires)', () => {
  it('fires in the iOS app (user-agent token)', () => {
    expect(detect({ ua: 'Mozilla/5.0 (iPhone) AppleWebKit Qubit16App/ios' }).marked).toBe(true)
  })

  it('fires in the Android TWA (android-app:// referrer) and remembers it for the session', () => {
    expect(detect({ referrer: 'android-app://ai.qubit16.app/' })).toEqual({ marked: true, remembered: true })
  })

  it('fires on the ?app=android launch marker', () => {
    expect(detect({ search: '?app=android' }).marked).toBe(true)
  })

  it('keeps firing on later pages of the same app session', () => {
    expect(detect({ stored: '1' }).marked).toBe(true)
  })

  it('does NOT fire in an ordinary browser, or for look-alike params and referrers', () => {
    expect(detect({}).marked).toBe(false)
    expect(detect({ referrer: 'https://www.google.com/' }).marked).toBe(false)
    expect(detect({ referrer: 'android-app://com.google.android.gm/' }).marked).toBe(false)
    expect(detect({ search: '?app=androidish' }).marked).toBe(false)
  })
})
