import { describe, expect, it } from 'vitest'
import { withoutProviderTokens } from './session-storage'

describe('persisted authentication session', () => {
  it('keeps the Supabase session but excludes Google provider credentials', () => {
    expect(JSON.parse(withoutProviderTokens(JSON.stringify({
      access_token: 'supabase-access', refresh_token: 'supabase-refresh',
      provider_token: 'google-access', provider_refresh_token: 'google-refresh',
      user: { id: 'owner' },
    })))).toEqual({ access_token: 'supabase-access', refresh_token: 'supabase-refresh', user: { id: 'owner' } })
  })
  it('preserves the PKCE verifier', () => {
    expect(withoutProviderTokens('pkce-verifier')).toBe('pkce-verifier')
  })
})
