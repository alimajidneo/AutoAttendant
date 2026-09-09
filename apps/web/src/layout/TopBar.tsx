import { Link } from 'react-router-dom'
import { Bell, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { userAvatarUrl } from '@/lib/user-profile'

interface TopBarProps {
  pendingCount: number
}

export function TopBar({ pendingCount }: TopBarProps) {
  const { user } = useAuth()
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
        <span className="text-sm font-medium text-muted-foreground">{today}</span>
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
        <Button
          render={<Link to="/escalations" />}
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={pendingCount ? `${pendingCount} questions need attention` : 'No questions need attention'}
        >
          <Bell />
          {pendingCount > 0 && (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive ring-2 ring-stage" />
          )}
        </Button>
        <Link
          to="/settings?tab=account"
          className="ml-1 flex items-center gap-2 rounded-full p-1 pr-2 text-sm font-medium hover:bg-sunk-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${name} account settings`}
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
