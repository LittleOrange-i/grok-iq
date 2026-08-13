import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PlaygroundField({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <label className='text-sm font-medium'>{label}</label>
      {children}
    </div>
  )
}
