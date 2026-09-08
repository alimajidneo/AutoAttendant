import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { signInWithGoogle } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

export default function SignInPage() {
  const { isSignedIn } = useAuth()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  if (isSignedIn) return <Navigate to="/" replace />
  return <main className="flex min-h-screen items-center justify-center bg-background p-6">
    <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
      <div><h1 className="text-2xl font-semibold">Welcome to DeskRoute</h1>
      <p className="mt-2 text-muted-foreground">Sign in to manage your receptionist.</p></div>
      <Button className="w-full" disabled={busy} onClick={async () => {
        setBusy(true); setError(false)
        try { await signInWithGoogle() } catch { setError(true); setBusy(false) }
      }}>{busy ? 'Opening Google…' : 'Continue with Google'}</Button>
      {error && <p role="alert">Could not open Google sign-in. Please try again.</p>}
    </div>
  </main>
}
