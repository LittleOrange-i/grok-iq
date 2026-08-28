import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { InfoTooltip } from '@/components/info-tooltip'

export function TitledCard({
  title,
  description,
  hint,
  icon,
  iconTone = 'primary',
  action,
  children,
  className,
  headerClassName,
  contentClassName,
}: {
  title: ReactNode
  description?: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  iconTone?: IconBadgeTone
  action?: ReactNode
  children?: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
}) {
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <CardHeader
        className={cn(
          'border-b px-4 py-3 sm:px-5 sm:py-4',
          headerClassName
        )}
      >
        <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex min-w-0 items-center gap-3'>
            {icon != null ? <IconBadge tone={iconTone}>{icon}</IconBadge> : null}
            <div className='min-w-0'>
              <CardTitle className='flex items-center gap-1.5 text-base tracking-tight'>
                {title}
                {hint != null ? (
                  <InfoTooltip
                    label={typeof title === 'string' ? title : '说明'}
                    content={hint}
                  />
                ) : null}
              </CardTitle>
              {description != null ? (
                <CardDescription className='mt-1 text-xs leading-5'>
                  {description}
                </CardDescription>
              ) : null}
            </div>
          </div>
          {action != null ? (
            <div className='w-full shrink-0 sm:w-auto'>{action}</div>
          ) : null}
        </div>
      </CardHeader>
      {children != null ? (
        <CardContent className={cn('px-4 py-4 sm:px-5', contentClassName)}>
          {children}
        </CardContent>
      ) : null}
    </Card>
  )
}
