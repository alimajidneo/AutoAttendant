import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { cn } from '@/lib/utils'

export function RouteSkeleton({ fullScreen = true, label = 'Loading DeskRoute' }: { fullScreen?: boolean; label?: string }) {
  return (
    <div className={cn('flex w-full flex-1 items-center justify-center p-6', fullScreen ? 'min-h-dvh' : 'min-h-56')}>
      <LoadingIndicator label={label} />
    </div>
  )
}
