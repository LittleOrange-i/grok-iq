import type { ReactNode } from 'react'
import { Loader2, PackageOpen } from 'lucide-react'

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
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
        <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
      </div>
      {actions && (
        <div className='flex shrink-0 flex-wrap gap-2'>{actions}</div>
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
}: {
  title: string
  description: string
}) {
  return (
    <div className='flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center'>
      <PackageOpen className='mb-3 size-8 text-muted-foreground' />
      <div className='font-medium'>{title}</div>
      <p className='mt-1 max-w-md text-sm text-muted-foreground'>
        {description}
      </p>
    </div>
  )
}
