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
      <span className={cn('tabular-nums', className)}>
        {formatNumber(tps)}
        <span className='font-normal text-muted-foreground'>
          {' '}
          / 上游 {formatNumber(upstreamTps ?? tps)}
        </span>
      </span>
    )
  }
  return (
    <span className={cn('tabular-nums', className)}>
      <span className='block'>重算 {formatNumber(tps)}</span>
      <span className='mt-0.5 block text-xs font-normal text-muted-foreground'>
        上游 {formatNumber(upstreamTps ?? tps)}
      </span>
    </span>
  )
}
