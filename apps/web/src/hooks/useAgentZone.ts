import { useQuery } from '@tanstack/react-query'
import { keys, fetchers } from '@/lib/queries'

/** The business's timezone. Undefined while settings load, so `toLocaleString`
 *  falls back to the viewer's zone for one frame. */
export function useAgentZone(): string | undefined {
  const { data: session } = useQuery({ queryKey: keys.session, queryFn: fetchers.session, staleTime: Infinity })
  const { data: settings } = useQuery({
    queryKey: keys.settings,
    queryFn: fetchers.settings,
    enabled: session?.role !== 'member',
  })
  return session?.role === 'member' ? session.timezone : settings?.business.timezone
}
