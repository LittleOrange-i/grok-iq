import { useId, type CSSProperties, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip } from '@/components/info-tooltip'

export type StatTone =
  | 'blue'
  | 'red'
  | 'rose'
  | 'sky'
  | 'violet'
  | 'amber'
  | 'cyan'
  | 'emerald'
  | 'indigo'

export type StatCardDetail = {
  label: string
  value: string
}

export type MetricStripItem = {
  label: string
  value: string
  detail?: string
  hint?: ReactNode
  icon: LucideIcon
  tone?: StatTone
}

type StatCardTo = '/accounts' | '/quarantine' | '/runs' | '/workers'

const TONE_STYLES: Record<StatTone, { icon: string; spark: string }> = {
  blue: {
    icon: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
    spark: 'text-blue-500',
  },
  red: {
    icon: 'bg-red-500/10 text-red-600 dark:text-red-300',
    spark: 'text-red-500',
  },
  rose: {
    icon: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    spark: 'text-rose-500',
  },
  sky: {
    icon: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
    spark: 'text-sky-500',
  },
  violet: {
    icon: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
    spark: 'text-violet-500',
  },
  amber: {
    icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
    spark: 'text-amber-500',
  },
  cyan: {
    icon: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
    spark: 'text-cyan-500',
  },
  emerald: {
    icon: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    spark: 'text-emerald-500',
  },
  indigo: {
    icon: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
    spark: 'text-indigo-500',
  },
}

function ToneIcon({
  icon: Icon,
  tone,
  className,
}: {
  icon: LucideIcon
  tone: StatTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        TONE_STYLES[tone].icon,
        className
      )}
    >
      <Icon className='size-4' />
    </span>
  )
}

export function MetricStrip({
  items,
  loading = false,
  className,
}: {
  items: MetricStripItem[]
  loading?: boolean
  className?: string
}) {
  const columns =
    items.length >= 4
      ? 'sm:grid-cols-2 xl:grid-cols-4'
      : items.length === 3
        ? 'sm:grid-cols-3'
        : 'sm:grid-cols-2'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-card',
        className
      )}
    >
      <div className={cn('grid divide-y sm:divide-x sm:divide-y-0', columns)}>
        {items.map((item) => {
          const tone = item.tone ?? 'blue'
          return (
            <div key={item.label} className='min-w-0 px-4 py-4 sm:px-5'>
              <div className='flex items-center gap-2'>
                <ToneIcon icon={item.icon} tone={tone} className='size-7' />
                <div className='flex min-w-0 items-center gap-1 text-xs text-muted-foreground'>
                  <span className='truncate'>{item.label}</span>
                  {item.hint ? (
                    <InfoTooltip label={item.label} content={item.hint} />
                  ) : null}
                </div>
              </div>
              {loading ? (
                <>
                  <Skeleton className='mt-3 h-8 w-20' />
                  <Skeleton className='mt-2 h-3 w-28' />
                </>
              ) : (
                <>
                  <div className='number mt-2.5 text-2xl font-semibold tracking-tight'>
                    {item.value}
                  </div>
                  {item.detail ? (
                    <div className='mt-1 truncate text-xs text-muted-foreground/70'>
                      {item.detail}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StatCard({
  label,
  value,
  detail,
  hint,
  icon: Icon,
  tone = 'blue',
  sparkline,
  details,
  to,
  loading = false,
  index = 0,
  compact = false,
  className,
}: {
  label: string
  value: string
  detail?: string
  hint?: ReactNode
  icon: LucideIcon
  tone?: StatTone
  sparkline?: number[]
  sparklineVariant?: 'line' | 'bars'
  details?: StatCardDetail[]
  to?: StatCardTo
  loading?: boolean
  index?: number
  compact?: boolean
  className?: string
}) {
  const styles = TONE_STYLES[tone]
  const content = (
    <div
      style={{ '--stagger': String(index) } as CSSProperties}
      className={cn(
        'animate-rise group relative flex h-full flex-col justify-between rounded-2xl border bg-card',
        compact ? 'min-h-0 p-3.5' : 'min-h-[8.5rem] p-4',
        to && 'cursor-pointer transition-colors hover:bg-muted/20',
        className
      )}
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
          <ToneIcon icon={Icon} tone={tone} />
          <span className='truncate font-medium'>{label}</span>
          {hint ? <InfoTooltip label={label} content={hint} /> : null}
        </div>
        {to ? (
          <ArrowUpRight className='size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground' />
        ) : null}
      </div>

      <div className={cn(compact ? 'mt-3' : 'mt-4')}>
        {loading ? (
          <>
            <Skeleton className={cn('w-24', compact ? 'h-7' : 'h-8')} />
            <Skeleton className='mt-2 h-3 w-32' />
          </>
        ) : (
          <>
            <p
              className={cn(
                'number leading-none font-semibold tracking-tight',
                compact ? 'text-2xl' : 'text-[1.75rem]'
              )}
            >
              {value}
            </p>
            {detail ? (
              <p className='mt-2 truncate text-xs text-muted-foreground/70'>
                {detail}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className={cn('relative', compact ? 'mt-3' : 'mt-4')}>
        {loading ? (
          <Skeleton className='h-8 w-full rounded-lg' />
        ) : details?.length ? (
          <div className='grid grid-cols-2 gap-2'>
            {details.map((item) => (
              <div
                key={item.label}
                className='rounded-xl bg-muted/40 px-2.5 py-2'
              >
                <div className='truncate text-[11px] text-muted-foreground'>
                  {item.label}
                </div>
                <div className='number mt-1 truncate text-xs font-semibold'>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <LineSparkline values={sparkline} className={styles.spark} />
        )}
      </div>
    </div>
  )

  if (!to) return content
  return (
    <Link
      to={to}
      aria-label={`${label}，前往详情`}
      className='block h-full rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      {content}
    </Link>
  )
}

function LineSparkline({
  values,
  className,
}: {
  values?: number[]
  className?: string
}) {
  const rawId = useId()
  const gradientId = `stat-line-${rawId.replaceAll(':', '')}`
  const paths = buildLineSparkline(values)
  if (!paths) {
    return <div className='h-8' aria-hidden='true' />
  }
  return (
    <div
      className={cn('relative h-8 overflow-hidden rounded-lg', className)}
      aria-hidden='true'
    >
      <svg viewBox='0 0 160 36' preserveAspectRatio='none' className='size-full'>
        <defs>
          <linearGradient id={gradientId} x1='0' x2='0' y1='0' y2='1'>
            <stop offset='0%' stopColor='currentColor' stopOpacity='0.28' />
            <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
          </linearGradient>
        </defs>
        <path d={paths.areaPath} fill={`url(#${gradientId})`} />
        <path
          d={paths.linePath}
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth='2.25'
          vectorEffect='non-scaling-stroke'
        />
      </svg>
    </div>
  )
}

function buildLineSparkline(values?: number[]) {
  if (!values?.length) return null
  const sanitized = values.map((value) => Math.max(0, Number(value) || 0))
  const width = 160
  const height = 36
  const padding = 3
  const max = Math.max(...sanitized)
  const min = Math.min(...sanitized)
  const range = max - min
  const points = sanitized.map((value, index) => {
    const x =
      sanitized.length === 1
        ? width / 2
        : (index / (sanitized.length - 1)) * width
    let normalized = 0.5
    if (range > 0) normalized = (value - min) / range
    else if (max > 0) normalized = 0.5
    const y = height - padding - normalized * (height - padding * 2)
    return { x, y }
  })
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
  const firstPoint = points.at(0)
  const lastPoint = points.at(-1)
  if (!firstPoint || !lastPoint) return null
  return {
    linePath,
    areaPath: `${linePath} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`,
  }
}
