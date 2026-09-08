import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
export const AuthContext = createContext<{ session: Session | null; isLoaded: boolean }>({ session: null, isLoaded: false })

export function useAuth() {
  const { session, isLoaded } = useContext(AuthContext)
  return {
    user: session?.user ?? null, isSignedIn: !!session, isLoaded,
    signOut: async () => {
      if (!supabase) return
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    },
  }
}
