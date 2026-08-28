import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function TablePanel({
  toolbar,
  footer,
  children,
  className,
}: {
  toolbar?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        className
      )}
    >
      {toolbar ? (
        <div className='flex flex-col gap-2 px-4 py-3'>{toolbar}</div>
      ) : null}
      <div className='relative min-w-0 px-3 pb-3'>{children}</div>
      {footer ? <div className='border-t border-border/60 px-4 py-3'>{footer}</div> : null}
    </section>
  )
}
