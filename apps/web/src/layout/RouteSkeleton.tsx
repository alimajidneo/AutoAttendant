import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { PageContainer } from './PageContainer'

/** One clear loading state for authentication and lazy routes. */
export function RouteSkeleton() {
  return (
    <PageContainer>
      <LoadingIndicator label="Loading DeskRoute" />
    </PageContainer>
  )
}
