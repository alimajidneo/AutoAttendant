import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { apiClient } from '@/lib/apiClient'

// React StrictMode can mount twice; an authorization code can only be used once.
let completion: Promise<string> | undefined
async function finishSignIn() {
  if (!supabase) throw new Error('Sign-in is not configured')
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  window.history.replaceState(null, '', '/auth/callback')
  if (params.has('error') || !code) throw new Error('Google sign-in was not completed. Please try again.')
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.session) throw new Error('This sign-in link has expired. Please sign in again.')
  const owner = sessionStorage.getItem('calendar-connect-owner')
  sessionStorage.removeItem('calendar-connect-owner')
  if (owner) {
    if (owner !== data.session.user.id) {
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error('Choose the same Google account you use for DeskRoute when connecting Calendar.')
    }
    const refreshToken = data.session.provider_refresh_token
    if (!refreshToken) throw new Error('Google did not grant offline Calendar access. Connect Calendar again and approve the requested permissions.')
    try { await apiClient.post('/admin/calendar/connect', { refreshToken }) }
    catch { throw new Error('Calendar connection could not be saved. Check the server configuration and reconnect from Settings.') }
    return '/settings?tab=connections'
  }
  return '/'
}

export default function SSOCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    completion ??= finishSignIn()
    completion.then(path => { if (active) navigate(path, { replace: true }) })
      .catch((err: Error) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [navigate])
  return <main className="mx-auto max-w-md p-8">
    {error ? <><p role="alert">{error}</p><Link className="underline" to="/">Return to DeskRoute</Link></> : <p>Completing sign-in…</p>}
  </main>
}
