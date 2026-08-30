import type { AccountDisposition } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export function hasDisposition(
  value?: AccountDisposition | null
): value is AccountDisposition {
  return Boolean(value && (value.source || value.reason))
}

export function dispositionOrigin(value?: AccountDisposition | null): {
  origin: string
  originLabel: string
} {
  if (!value) return { origin: '', originLabel: '' }
  if (value.origin) {
    return {
      origin: value.origin,
      originLabel: value.originLabel || value.origin,
    }
  }
  const origin = value.source === 'quality_retry' ? 'grok2api' : 'grokiq'
  return {
    origin,
    originLabel: origin === 'grok2api' ? 'grok2api' : 'GrokIQ',
  }
}

export function DispositionBanner({
  disposition,
  sampleReasons = [],
}: {
  disposition?: AccountDisposition | null
  sampleReasons?: string[]
}) {
  if (!hasDisposition(disposition) && sampleReasons.length === 0) return null
  const origin = dispositionOrigin(disposition)
  return (
    <div className='rounded-lg border border-amber-500/25 bg-amber-500/5 p-3'>
      {hasDisposition(disposition) ? (
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='text-sm font-medium text-amber-700 dark:text-amber-300'>
              停用原因
            </div>
            {origin.originLabel ? (
              <Badge
                variant={
                  origin.origin === 'grok2api' ? 'secondary' : 'outline'
                }
                className='h-5 px-1.5 text-[10px]'
              >
                {origin.originLabel}
              </Badge>
            ) : null}
            <Badge variant='outline' className='h-5 px-1.5 text-[10px]'>
              {disposition.sourceLabel || disposition.source}
            </Badge>
            <Badge variant='secondary' className='h-5 px-1.5 text-[10px]'>
              {disposition.actionLabel || disposition.action}
            </Badge>
          </div>
          <p className='text-sm leading-6'>{disposition.reason}</p>
          {disposition.at ? (
            <div className='text-[11px] text-muted-foreground tabular-nums'>
              {formatDate(disposition.at)}
            </div>
          ) : null}
          {(disposition.evidence ?? []).length > 0 ? (
            <ul className='list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
              {(disposition.evidence ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {sampleReasons.length > 0 ? (
        <div
          className={
            hasDisposition(disposition)
              ? 'mt-3 border-t border-amber-500/20 pt-3'
              : ''
          }
        >
          <div className='text-sm font-medium text-amber-700 dark:text-amber-300'>
            {hasDisposition(disposition) ? '探针样本' : '判定依据'}
          </div>
          <ul className='mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
            {sampleReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function DispositionSummary({
  disposition,
  sampleReasons = [],
  sampleCount = 0,
  anomalyCount = 0,
  hardCount = 0,
  score = 0,
}: {
  disposition?: AccountDisposition | null
  sampleReasons?: string[]
  sampleCount?: number
  anomalyCount?: number
  hardCount?: number
  score?: number
}) {
  const evidence = disposition?.evidence ?? []
  const showDisposition = hasDisposition(disposition)
  if (
    !showDisposition &&
    sampleReasons.length === 0 &&
    anomalyCount === 0 &&
    hardCount === 0
  ) {
    return <span className='text-muted-foreground'>—</span>
  }
  const origin = dispositionOrigin(disposition)
  const summary = showDisposition
    ? `${origin.originLabel ? `${origin.originLabel} · ` : ''}${disposition.sourceLabel || disposition.source}`
    : hardCount > 0
      ? `硬信号 ${hardCount}`
      : anomalyCount > 0
        ? `异常 ${anomalyCount}`
        : `${sampleReasons.length} 条原因`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-8 max-w-56 gap-1.5 px-2.5 text-xs font-normal'
        >
          <span className='truncate'>{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 p-0'>
        <div className='border-b px-3 py-2.5'>
          <div className='text-sm font-medium'>
            {showDisposition ? '停用原因' : '风险原因'}
          </div>
          <div className='mt-1 text-[11px] leading-5 text-muted-foreground'>
            {showDisposition
              ? [
                  origin.originLabel,
                  disposition.sourceLabel || disposition.source,
                  disposition.actionLabel,
                  disposition.at ? formatDate(disposition.at) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `样本 ${sampleCount} · 异常 ${anomalyCount} · 硬信号 ${hardCount}${
                  score ? ` · ${formatNumber(score)} 分` : ''
                }`}
          </div>
        </div>
        <div className='max-h-80 space-y-3 overflow-y-auto p-3'>
          {showDisposition ? (
            <p className='text-sm leading-6'>{disposition.reason}</p>
          ) : null}
          {evidence.length > 0 ? (
            <div>
              <div className='text-[11px] text-muted-foreground'>处置证据</div>
              <ul className='mt-1 space-y-0.5'>
                {evidence.map((item) => (
                  <li
                    key={item}
                    className='rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-5'
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {sampleReasons.length > 0 ? (
            <div>
              <div className='text-[11px] text-muted-foreground'>
                {showDisposition ? '探针样本' : '规则说明'}
              </div>
              <ul className='mt-1 space-y-0.5'>
                {sampleReasons.map((reason) => (
                  <li
                    key={reason}
                    className='rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-5'
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : !showDisposition ? (
            <p className='text-xs text-muted-foreground'>暂无规则说明</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
