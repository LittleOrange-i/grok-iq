import type { ReactNode } from 'react'
import { Loader2, PackageOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InfoTooltip } from '@/components/info-tooltip'

export function Page({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`mx-auto h-full min-h-0 w-full max-w-[1600px] space-y-6 overflow-y-auto p-4 md:p-6 ${className}`}
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
}: {
  title: string
  description: string
  actions?: ReactNode
  descriptionAsHint?: boolean
}) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
      <div className='min-w-0'>
        <div className='flex items-center gap-1.5'>
          <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
          {descriptionAsHint && (
            <InfoTooltip label={title} content={description} />
          )}
        </div>
        {!descriptionAsHint && (
          <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
        )}
      </div>
      {actions && (
        <div className='flex max-w-full shrink-0 flex-wrap gap-2'>{actions}</div>
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
        'flex flex-col items-center justify-center rounded-xl border border-dashed text-center',
        compact ? 'min-h-32 p-5' : 'min-h-48 p-8',
        className
      )}
    >
      <Icon
        className={cn(
          'text-muted-foreground',
          compact ? 'mb-2 size-6' : 'mb-3 size-8'
        )}
      />
      <div className='font-medium'>{title}</div>
      <p className='mt-1 max-w-md text-sm text-muted-foreground'>
        {description}
      </p>
      {action && <div className='mt-4'>{action}</div>}
    </div>
  )
}
