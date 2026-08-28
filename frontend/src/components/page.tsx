import { useEffect, useRef, type ReactNode, type UIEvent } from 'react'
import { Loader2, PackageOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip } from '@/components/info-tooltip'

export function Page({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const hideScrollbarTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (hideScrollbarTimer.current != null) {
        window.clearTimeout(hideScrollbarTimer.current)
      }
    },
    []
  )

  const revealScrollbar = (event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    container.dataset.scrollbarVisible = 'true'
    if (hideScrollbarTimer.current != null) {
      window.clearTimeout(hideScrollbarTimer.current)
    }
    hideScrollbarTimer.current = window.setTimeout(() => {
      container.dataset.scrollbarVisible = 'false'
      hideScrollbarTimer.current = null
    }, 900)
  }

  return (
    <div
      data-auto-hide-scrollbar
      data-scrollbar-visible='false'
      onScroll={revealScrollbar}
      className={`mx-auto h-full min-h-0 auto-hide-scrollbar w-full max-w-[1600px] space-y-5 overflow-y-auto p-5 md:p-6 ${className}`}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  descriptionAsHint = false,
  hintContentClassName,
}: {
  title: string
  description: ReactNode
  actions?: ReactNode
  descriptionAsHint?: boolean
  hintContentClassName?: string
}) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
      <div className='min-w-0'>
        <div className='flex items-center gap-2'>
          <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
            {title}
          </h1>
          {descriptionAsHint && (
            <InfoTooltip
              label={title}
              content={description}
              contentClassName={hintContentClassName}
            />
          )}
        </div>
        {!descriptionAsHint && (
          <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
        )}
      </div>
      {actions && (
        <div className='flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5'>
          {actions}
        </div>
      )}
    </div>
  )
}

export function LoadingState({ label = '正在加载' }: { label?: string }) {
  return (
    <div className='flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground'>
      <Loader2 className='size-4 animate-spin' />
      {label}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon: Icon = PackageOpen,
  action,
  compact = false,
  className,
}: {
  title: string
  description: string
  icon?: typeof PackageOpen
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 text-center',
        compact ? 'min-h-32 p-5' : 'min-h-48 p-8',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-300',
          compact ? 'mb-2 size-10' : 'mb-3 size-12'
        )}
      >
        <Icon className={cn(compact ? 'size-5' : 'size-6')} />
      </div>
      <div className='font-medium'>{title}</div>
      <p className='mt-1 max-w-md text-sm text-muted-foreground'>
        {description}
      </p>
      {action && <div className='mt-4'>{action}</div>}
    </div>
  )
}

export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className='h-32 rounded-2xl' />
        ))}
      </div>
      <div className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]'>
        <Skeleton className='h-72 rounded-2xl' />
        <Skeleton className='h-72 rounded-2xl' />
      </div>
    </div>
  )
}

