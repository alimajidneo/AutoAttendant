import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { RouteSkeleton } from '@/layout/RouteSkeleton'
import { keys, fetchers } from '@/lib/queries'

/**
 * Onboarded is derived from the agent row rather than held on the identity, so
 * the two cannot disagree about a business that already exists.
 */
export function AgentGate() {
  const location = useLocation()
  const { data, isPending, isError } = useQuery({
    queryKey: keys.session,
    queryFn: fetchers.session,
    // The gate blocks every route, so a wrong answer is worse than a slow one:
    // it is read once per session and not refetched behind the user.
    staleTime: Infinity,
  })

  if (isPending) {
    return <RouteSkeleton />
  }

  if (isError) return <p className="p-6">Unable to load your workspace. Refresh to retry.</p>
  if (data?.role === 'member') {
    const memberPath = location.pathname === '/'
      || location.pathname === '/calls'
      || location.pathname === '/appointments'
    return memberPath ? <Outlet /> : <Navigate to="/" replace />
  }
  if (!data?.onboarded && data?.hasWorkspaces) return <Navigate to="/workspaces" replace />

  const onboarded = !!data?.onboarded

  if (onboarded && location.pathname === '/onboarding') {
    return <Navigate to="/" replace />
  }
  if (!onboarded && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return <Outlet />
}
