import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RouteSkeleton } from '@/layout/RouteSkeleton'
import { supabase } from '@/lib/supabase'

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
  if (!error) return <RouteSkeleton label="Completing sign-in…" />
  return <main className="mx-auto max-w-narrow p-8">
    <p role="alert">{error}</p><Link className="underline" to="/">Return to DeskRoute</Link>
  </main>
}
