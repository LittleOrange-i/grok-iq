import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowUpRight,
  FileText,
  ScanSearch,
  ShieldBan,
  Undo2,
} from 'lucide-react'
import {
  type TimelineItem,
  type TimelineItemHref,
  type TimelineItemType,
} from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

const TYPE_LABELS: Record<TimelineItemType, string> = {
  sample: '样本',
  audit: '审计',
  isolate: '隔离',
  restore: '恢复',
  note: '备注',
}

const TYPE_VARIANTS: Record<
  TimelineItemType,
  'outline' | 'secondary' | 'destructive' | 'success' | 'info'
> = {
  sample: 'info',
  audit: 'secondary',
  isolate: 'destructive',
  restore: 'success',
  note: 'outline',
}

const TYPE_ICONS: Record<TimelineItemType, typeof Activity> = {
  sample: Activity,
  audit: ScanSearch,
  isolate: ShieldBan,
  restore: Undo2,
  note: FileText,
}

function hrefLabel(href: TimelineItemHref) {
  if (href.startsWith('/request-audits')) return '请求审计'
  if (href === '/runs') return '任务中心'
  return '隔离区'
}

export function timelineRangeLabel(items: TimelineItem[]) {
  if (items.length === 0) return ''
  const newestAt = items[0]?.at
  const oldestAt = items[items.length - 1]?.at
  if (!newestAt || !oldestAt) return ''
  if (newestAt === oldestAt) return formatDate(newestAt)
  return `${formatDate(oldestAt)} ~ ${formatDate(newestAt)}`
}

function TimelineJumpLink({
  item,
  onNavigate,
}: {
  item: TimelineItem
  onNavigate?: () => void
}) {
  if (!item.href) return null
  const className =
    'mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline'
  const label = (
    <>
      查看{hrefLabel(item.href)}
      <ArrowUpRight className='size-3' />
    </>
  )
  if (item.href === '/quarantine') {
    return (
      <Link to={item.href} onClick={() => onNavigate?.()} className={className}>
        {label}
      </Link>
    )
  }
  return (
    <Link
      to={item.href}
      search={item.search as never}
      onClick={() => onNavigate?.()}
      className={className}
    >
      {label}
    </Link>
  )
}

export function AccountTimeline({
  items,
  isLoading = false,
  isError = false,
  errorMessage,
  onNavigate,
}: {
  items: TimelineItem[]
  isLoading?: boolean
  isError?: boolean
  errorMessage?: string
  onNavigate?: () => void
}) {
  if (isLoading) {
    return (
      <div className='space-y-3 rounded-lg border bg-muted/10 px-3 py-3'>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className='flex gap-3'>
            <Skeleton className='size-6 rounded-full' />
            <div className='min-w-0 flex-1 space-y-2 py-0.5'>
              <Skeleton className='h-4 w-40' />
              <Skeleton className='h-3 w-56' />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (isError) {
    return (
      <div className='rounded-lg border border-destructive/30 px-4 py-8 text-center text-sm text-destructive'>
        {errorMessage || '时间线加载失败'}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className='rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground'>
        暂无时间线事件
      </div>
    )
  }
  return (
    <ol className='max-h-96 space-y-0 overflow-y-auto rounded-lg border bg-muted/10 px-3 py-2'>
      {items.map((item, index) => {
        const Icon = TYPE_ICONS[item.type] ?? Activity
        return (
          <li key={item.id} className='relative flex gap-3 py-2.5'>
            {index < items.length - 1 ? (
              <span className='absolute top-8 bottom-0 left-[11px] w-px bg-border' />
            ) : null}
            <span
              className={cn(
                'relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground',
                item.type === 'isolate' &&
                  'border-destructive/40 text-destructive',
                item.type === 'restore' &&
                  'border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
              )}
            >
              <Icon className='size-3.5' />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge
                  variant={TYPE_VARIANTS[item.type]}
                  className='h-5 px-1.5 text-[10px]'
                >
                  {TYPE_LABELS[item.type]}
                </Badge>
                <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                  {item.title}
                </span>
                <span className='text-[11px] text-muted-foreground tabular-nums'>
                  {formatDate(item.at)}
                </span>
              </div>
              {item.detail ? (
                <p className='mt-1 text-xs leading-5 text-muted-foreground break-all'>
                  {item.detail}
                </p>
              ) : null}
              {item.href ? (
                <TimelineJumpLink item={item} onNavigate={onNavigate} />
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
