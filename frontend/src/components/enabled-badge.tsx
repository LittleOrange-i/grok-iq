import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export function EnabledBadge({
  enabled,
  unknown = false,
  prefix,
  className,
}: {
  enabled?: boolean | null
  unknown?: boolean
  prefix?: string
  className?: string
}) {
  const isUnknown = unknown || enabled == null
  const on = !isUnknown && enabled === true
  const label = isUnknown
    ? `${prefix ?? ''}未知`
    : `${prefix ?? ''}${on ? '启用' : '停用'}`

  return (
    <Badge
      variant={isUnknown ? 'outline' : on ? 'success' : 'secondary'}
      className={cn(
        'h-5 gap-1 px-1.5 text-[11px] font-medium',
        className
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          isUnknown
            ? 'bg-muted-foreground/50'
            : on
              ? 'bg-emerald-500'
              : 'bg-zinc-400'
        )}
      />
      {label}
    </Badge>
  )
}
