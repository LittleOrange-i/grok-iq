import { cn, formatNumber } from '@/lib/utils'
import {
  durationWindowTps,
  tpsOverridden,
} from '@/lib/tps'

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
        className={cn(
          'inline-flex items-baseline gap-1.5 tabular-nums',
          className
        )}
      >
        <span
          className='font-semibold text-violet-600 dark:text-violet-400'
          title='全程耗时校正 TPS'
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
        title='全程耗时校正 TPS'
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

export function SampleTpsDetail({
  tps,
  upstreamTps,
  outputTokens,
  durationMs,
  className,
}: {
  tps: number
  upstreamTps?: number | null
  outputTokens?: number | null
  durationMs?: number | null
  className?: string
}) {
  const upstream = upstreamTps ?? tps
  const duration = durationWindowTps(outputTokens, durationMs)
  const usedOverride = tpsOverridden(tps, upstream)
  const showDurationHint =
    !usedOverride && duration != null && tpsOverridden(duration, upstream)
  if (!usedOverride && !showDurationHint) {
    return (
      <span className={cn('tabular-nums', className)}>{formatNumber(tps)}</span>
    )
  }
  return (
    <span className={cn('block tabular-nums', className)}>
      <span
        className={cn(
          'block',
          usedOverride && 'font-semibold text-violet-600 dark:text-violet-400'
        )}
        title={
          usedOverride
            ? '按全程耗时校正的 TPS，已用于判定'
            : '用于判定的 TPS'
        }
      >
        {formatNumber(tps)}
      </span>
      {usedOverride && (
        <span
          className='mt-0.5 block text-xs font-normal text-muted-foreground'
          title='上游 TPS'
        >
          {formatNumber(upstream)}
        </span>
      )}
      {showDurationHint && duration != null && (
        <span
          className='mt-0.5 block text-[10px] font-normal text-violet-600/80 dark:text-violet-300/80'
          title='按全程耗时计算的 TPS，未用于判定。把最大生成窗口调到覆盖该样本的生成窗口后才会用于判定。'
        >
          {formatNumber(duration)}
          <span className='ms-1'>全程参考</span>
        </span>
      )}
    </span>
  )
}
