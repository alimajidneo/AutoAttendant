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

export async function signInWithGoogle(calendarOwner?: string) {
  if (!supabase) throw new Error('Sign-in is not configured')
  if (calendarOwner) sessionStorage.setItem('calendar-connect-owner', calendarOwner)
  else sessionStorage.removeItem('calendar-connect-owner')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google', options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      ...(calendarOwner ? {
        scopes: ['calendar.events', 'calendar.calendarlist.readonly', 'calendar.freebusy']
          .map(scope => `https://www.googleapis.com/auth/${scope}`).join(' '),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      } : {}),
    },
  })
  if (error) throw error
}
