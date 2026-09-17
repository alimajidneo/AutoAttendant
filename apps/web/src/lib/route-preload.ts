type RouteLoader = () => Promise<unknown>

export const routeLoaders: Record<string, RouteLoader> = {
  '/': () => import('@/features/home/HomePage'),
  '/calls/': () => import('@/features/calls/CallDetailPage'),
  '/calls': () => import('@/features/calls/CallsPage'),
  '/escalations/queue': () => import('@/features/escalations/QueuePage'),
  '/escalations': () => import('@/features/escalations/EscalationsPage'),
  '/appointments': () => import('@/features/appointments/AppointmentsPage'),
  '/employee': () => import('@/features/employees/EmployeeSelfPage'),
  '/knowledge': () => import('@/features/knowledge/KnowledgePage'),
  '/settings': () => import('@/features/settings/SettingsPage'),
  '/workspaces': () => import('@/features/workspaces/WorkspacesPage'),
  '/help': () => import('@/features/help/HelpPage'),
}

export async function preloadRoute(path: string, loaders: Record<string, RouteLoader> = routeLoaders) {
  const match = Object.keys(loaders)
    .filter(route => route === path || (route !== '/' && path.startsWith(route.endsWith('/') ? route : `${route}/`)))
    .sort((left, right) => right.length - left.length)[0]
  if (match) await loaders[match]!()
}
