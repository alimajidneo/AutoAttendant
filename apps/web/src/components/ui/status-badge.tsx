import { cn } from '@/lib/utils'
import { toneToClasses, type StatusEntry } from '@/lib/status-config'

interface StatusBadgeProps<T extends string> {
  value: T | null | undefined
  config: Record<T, StatusEntry>
  className?: string
}

/**
 * Compact colour-coded pills make outcomes scannable in dense lists.
 */
export function StatusBadge<T extends string>({
  value,
  config,
  className,
}: StatusBadgeProps<T>) {
  const entry = value ? config[value] : undefined
  const label = entry?.label ?? ''
  const tone = entry?.tone ?? 'quiet'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-sm',
        toneToClasses(tone),
        className,
      )}
    >
      {label}
    </span>
  )
}
