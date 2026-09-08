import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { setTokenGetter } from '@/lib/apiClient'
import { supabase } from '@/lib/supabase'
import { AuthContext } from './useAuth'

async function getToken(options?: { skipCache?: boolean }) {
  if (!supabase) return null
  const { data, error } = options?.skipCache
    ? await supabase.auth.refreshSession() : await supabase.auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}
setTokenGetter(getToken)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; isLoaded: boolean }>({ session: null, isLoaded: false })
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!supabase) return
    let previousUser: string | undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (previousUser !== session?.user.id) queryClient.clear()
      previousUser = session?.user.id
      setState({ session, isLoaded: true })
    })
    return () => subscription.unsubscribe()
  }, [queryClient])
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
