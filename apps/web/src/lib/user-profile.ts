import type { User } from '@supabase/supabase-js'

export function userAvatarUrl(user: User | null | undefined): string | null {
  const direct = user?.user_metadata.avatar_url ?? user?.user_metadata.picture
  if (typeof direct === 'string' && direct) return direct
  for (const identity of user?.identities ?? []) {
    const value = identity.identity_data?.avatar_url ?? identity.identity_data?.picture
    if (typeof value === 'string' && value) return value
  }
  return null
}
