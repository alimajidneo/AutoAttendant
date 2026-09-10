import { Suspense } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { useQuery } from '@tanstack/react-query'
import {
  Home,
  PhoneCall,
  AlertCircle,
  Calendar,
  BookOpen,
  Settings as SettingsIcon,
  CircleCheck,
  LogOut,
  CircleHelp,
} from 'lucide-react'
import { AudioWaveform } from 'lucide-react'
import { keys, fetchers } from '@/lib/queries'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { RouteSkeleton } from './RouteSkeleton'
import { setupItems } from '@/features/home/setup-items'
import { TopBar } from './TopBar'
import { userAvatarUrl } from '@/lib/user-profile'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',              label: 'Dashboard',    icon: Home,        end: true },
  { to: '/calls',         label: 'Calls',         icon: PhoneCall },
  { to: '/appointments',  label: 'Appointments', icon: Calendar },
  { to: '/escalations',   label: 'Questions',     icon: AlertCircle },
  { to: '/help',          label: 'Help & tutorial', icon: CircleHelp },
  { to: '/knowledge',     label: 'Knowledge',    icon: BookOpen },
]

function isPathActive(pathname: string, item: NavItem): boolean {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(item.to + '/')
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const { data: pendingEscalations } = useQuery({
    queryKey: keys.escalations('pending'),
    queryFn: () => fetchers.escalations('pending'),
  })
  const { user, signOut } = useAuth()

  // What makes dismissing the checklist safe: this entry stands exactly while
  // something is outstanding.
  const { data: settings } = useQuery({
    queryKey: keys.settings,
    queryFn: fetchers.settings,
  })
  const setupLeft = settings ? setupItems(settings).filter((i) => !i.done).length : 0

  const pendingCount = pendingEscalations?.length ?? 0
  const firstName = user?.user_metadata.first_name || user?.user_metadata.full_name || user?.email || 'Account'
  const avatarUrl = userAvatarUrl(user)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {/* One row. The label hides when collapsed and nothing moves, and h-8
              puts the trigger on the same centreline as the nav icons. */}
          <div className="flex h-9 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/20">
              <AudioWaveform className="size-4" />
            </span>
            <span className="truncate text-base font-bold tracking-tight text-white group-data-[collapsible=icon]:hidden">DeskRoute</span>
            <SidebarTrigger className="ml-auto shrink-0 group-data-[collapsible=icon]:ml-0" />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const active = isPathActive(pathname, item)
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        render={<Link to={item.to} />}
                        isActive={active}
                        tooltip={item.label}
                        className="text-sm"
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {item.to === '/escalations' && pendingCount > 0 && (
                        <SidebarMenuBadge className="text-sm font-semibold">
                          {pendingCount}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            {setupLeft > 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link to="/" />}
                  tooltip="Finish setup"
                  className="text-sm text-sidebar-foreground"
                >
                  <CircleCheck className="size-4" />
                  <span>Finish setup</span>
                </SidebarMenuButton>
                <SidebarMenuBadge className="text-sm font-semibold text-sidebar-foreground">
                  {setupLeft}
                </SidebarMenuBadge>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/settings" />}
                isActive={pathname === '/settings'}
                tooltip="Settings"
                className="text-sm"
              >
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Who you are is a label. Signing out is the only action, so
                it is the only thing that reacts to a pointer. */}
            <SidebarMenuItem>
              <div
                className="flex h-8 items-center gap-2 rounded-lg p-2 text-sm text-sidebar-foreground"
                title={firstName}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="size-[18px] shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="size-[18px] shrink-0 rounded-full bg-sunk-1" />
                )}
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  {firstName}
                </span>
              </div>
              <SidebarMenuAction
                onClick={() => signOut()}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut />
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="stage-float my-2.5 mr-3 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-auto">
          <TopBar />
          <Suspense fallback={<RouteSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
