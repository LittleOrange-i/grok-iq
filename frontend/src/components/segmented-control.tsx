import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (value: T) => void
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      role='tablist'
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap items-center gap-0.5 rounded-md bg-muted p-[3px]',
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type='button'
            role='tab'
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon ? <Icon className='size-3.5' /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
