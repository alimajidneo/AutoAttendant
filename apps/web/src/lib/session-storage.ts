// Calendar refresh tokens go directly to the API, never into persistent browser storage.
export function withoutProviderTokens(value: string): string {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') {
      delete parsed.provider_token
      delete parsed.provider_refresh_token
      return JSON.stringify(parsed)
    }
  } catch { /* PKCE verifier values are plain strings. */ }
  return value
}

