import { createClient } from '@supabase/supabase-js'

import { withoutProviderTokens } from './session-storage'

export const authConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
export const supabase = authConfigured ? createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: {
    flowType: 'pkce', detectSessionInUrl: false,
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, withoutProviderTokens(value)),
      removeItem: (key) => localStorage.removeItem(key),
    },
  } },
) : null

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Sign-in is not configured')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google', options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw error
}
