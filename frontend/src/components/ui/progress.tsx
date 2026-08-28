import { cn } from '@/lib/utils'

export function ProgressBar({
  value,
  active = false,
  className,
  indicatorClassName,
}: {
  value: number
  active?: boolean
  className?: string
  indicatorClassName?: string
}) {
  const normalized = Math.min(100, Math.max(0, Number(value) || 0))
  const indeterminate = active && normalized === 0

  return (
    <div
      className={cn(
        'h-1.5 overflow-hidden rounded-full bg-muted',
        className
      )}
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : normalized}
    >
      <div
        className={cn(
          'h-full rounded-full bg-progress transition-[width] duration-500',
          indeterminate && 'w-1/5 animate-progress-indeterminate',
          indicatorClassName
        )}
        style={indeterminate ? undefined : { width: `${normalized}%` }}
      />
    </div>
  )
}
