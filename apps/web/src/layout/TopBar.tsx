import { useQuery } from '@tanstack/react-query'
import { keys, fetchers } from '@/lib/queries'
import { Link } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { userAvatarUrl } from '@/lib/user-profile'

import { NotificationCenter } from '@/features/notifications/NotificationCenter'

export function TopBar() {
  const { user } = useAuth()
  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session, staleTime: Infinity })
  const memberOnly = session?.role === 'member'
  const { data: settings } = useQuery({ queryKey: keys.settings, queryFn: fetchers.settings, enabled: !memberOnly })
  const { theme, setTheme } = useTheme()
  const avatarUrl = userAvatarUrl(user)
  const name = user?.user_metadata.full_name || user?.email || 'Account'
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date())

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-border bg-stage/90 px-5 backdrop-blur-xl md:px-8">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="md:hidden" />
        <Link to="/workspaces" className="text-sm font-semibold text-primary">{settings?.business.name || 'Workspaces'} · Switch</Link>
        <span className="hidden text-sm font-medium text-muted-foreground sm:block">{today}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        {!memberOnly && <NotificationCenter />}
        <Link
          to={memberOnly ? '/workspaces' : '/settings?tab=account'}
          className="ml-1 flex items-center gap-2 rounded-full p-1 pr-2 text-sm font-medium hover:bg-sunk-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={memberOnly ? `Open ${name} workspace` : `Open ${name} account settings`}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="hidden max-w-36 truncate sm:block">{name}</span>
        </Link>
      </div>
    </header>
  )
}
