import { cn, formatNumber } from '@/lib/utils'
import { tpsOverridden } from '@/lib/tps'

export function DualTpsValue({
  tps,
  upstreamTps,
  compact = false,
  className,
}: {
  tps: number
  upstreamTps?: number | null
  compact?: boolean
  className?: string
}) {
  const overridden = tpsOverridden(tps, upstreamTps)
  if (!overridden) {
    return (
      <span className={cn('tabular-nums', className)}>{formatNumber(tps)}</span>
    )
  }
  if (compact) {
    return (
      <span
        className={cn('inline-flex items-baseline gap-1.5 tabular-nums', className)}
      >
        <span
          className='font-semibold text-violet-600 dark:text-violet-400'
          title='重算 TPS'
        >
          {formatNumber(tps)}
        </span>
        <span className='font-normal text-muted-foreground' title='上游 TPS'>
          {formatNumber(upstreamTps ?? tps)}
        </span>
      </span>
    )
  }
  return (
    <span className={cn('block tabular-nums', className)}>
      <span
        className='block font-semibold text-violet-600 dark:text-violet-400'
        title='重算 TPS'
      >
        {formatNumber(tps)}
      </span>
      <span
        className='mt-0.5 block text-xs font-normal text-muted-foreground'
        title='上游 TPS'
      >
        {formatNumber(upstreamTps ?? tps)}
      </span>
    </span>
  )
}
