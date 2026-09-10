import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AudioWaveform, Moon, Sun } from 'lucide-react'
import { useAuth } from '@/features/auth/useAuth'
import { signInWithGoogle } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`grid place-items-center bg-linear-to-br from-[#4f8cff] to-[#8b5cf6] text-white shadow-[0_9px_25px_rgb(88_101_242_/_0.25)] ${compact ? 'size-8 rounded-[10px]' : 'size-11 rounded-[13px]'}`}>
      <AudioWaveform className={compact ? 'size-[18px]' : 'size-6'} />
    </span>
  )
}

export default function SignInPage() {
  const { isSignedIn } = useAuth()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const { theme, setTheme } = useTheme()
  if (isSignedIn) return <Navigate to="/" replace />
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f8fc] text-foreground dark:bg-[#080b18]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <span className="absolute -left-28 -top-28 size-[420px] rounded-full bg-[#8b9cff]/55 blur-[75px] dark:bg-[#6077ff]/30" />
        <span className="absolute -right-32 top-[4%] size-[500px] rounded-full bg-[#c18cff]/50 blur-[75px] dark:bg-[#9b5cff]/25" />
        <span className="absolute -bottom-60 left-1/3 size-[430px] rounded-full bg-[#70d7ff]/50 blur-[75px] dark:bg-[#2aaee8]/25" />
        <span className="absolute -bottom-44 right-[28%] size-72 rounded-full bg-[#ff9bd3]/30 blur-[75px] dark:bg-[#e855ac]/20" />
      </div>

      <header className="relative z-10 flex h-20 items-center justify-between px-5 sm:px-10">
        <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <BrandMark compact />
          DeskRoute
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card/70 p-1 shadow-low backdrop-blur-xl">
          <button
            type="button"
            className={`grid size-8 place-items-center rounded-full ${theme === 'light' ? 'bg-primary-subtle text-accent-ink' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTheme('light')}
            aria-label="Use light theme"
            aria-pressed={theme === 'light'}
          ><Sun className="size-4" /></button>
          <button
            type="button"
            className={`grid size-8 place-items-center rounded-full ${theme === 'dark' ? 'bg-primary-subtle text-accent-ink' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTheme('dark')}
            aria-label="Use dark theme"
            aria-pressed={theme === 'dark'}
          ><Moon className="size-4" /></button>
        </div>
      </header>

      <div className="relative z-10 grid min-h-[calc(100vh-5rem)] place-items-center px-5 pb-24 pt-6">
        <section className="w-full max-w-[430px] rounded-[22px] border border-border/80 bg-card/80 p-7 shadow-[0_24px_80px_rgb(26_32_60_/_0.13)] backdrop-blur-2xl sm:p-10 dark:shadow-[0_28px_90px_rgb(0_0_0_/_0.38)]" data-ground="card">
          <BrandMark />
          <h1 className="mt-6 text-[31px] font-bold leading-tight tracking-[-0.04em]">Welcome back</h1>
          <p className="mt-2 max-w-sm text-[15px] leading-6 text-muted-foreground">
            Sign in to manage calls, calendars, and your AI receptionist.
          </p>

          <Button
            variant="outline"
            size="lg"
            className="mt-8 h-12 w-full border-border bg-control text-base shadow-low"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(false)
              try { await signInWithGoogle() } catch { setError(true); setBusy(false) }
            }}
          >
            <span className="grid size-6 place-items-center rounded-full bg-white text-sm font-bold text-[#4285f4] shadow-sm">G</span>
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </Button>

          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            New customers can create their DeskRoute account through the same secure Google sign-in.
          </p>
          <Link to="/help" className="mt-4 block text-center text-sm font-semibold text-primary">New here? Read the setup tutorial</Link>
          {error && <p role="alert" className="mt-4 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive">Could not open Google sign-in. Please try again.</p>}
        </section>
      </div>

      <p className="absolute inset-x-0 bottom-5 z-10 text-center text-xs text-muted-foreground">
        AI receptionists for modern businesses
      </p>
    </main>
  )
}
