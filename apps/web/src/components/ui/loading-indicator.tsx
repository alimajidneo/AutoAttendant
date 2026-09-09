import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoadingIndicator({
  label = 'Loading',
  className,
  compact = false,
}: {
  label?: string
  className?: string
  compact?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center text-muted-foreground',
        compact ? 'gap-2 py-3' : 'min-h-56 flex-col gap-3',
        className,
      )}
    >
      <span className="relative grid place-items-center">
        <span className="absolute size-9 rounded-full bg-primary/12" />
        <LoaderCircle className={cn('relative animate-spin text-primary', compact ? 'size-5' : 'size-7')} />
      </span>
      <span className="font-medium">{label}</span>
    </div>
  )
}
