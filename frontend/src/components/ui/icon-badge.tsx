import type { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconBadgeVariants = cva(
  'flex shrink-0 items-center justify-center [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        muted: 'bg-muted text-muted-foreground',
        primary: 'bg-primary/10 text-primary',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        info: 'bg-info/10 text-info',
        destructive: 'bg-destructive/10 text-destructive',
        blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
        sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
        violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
        amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
        cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
        emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
        rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
        indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
      },
      size: {
        sm: 'size-7 rounded-full [&>svg]:size-3.5',
        md: 'size-8 rounded-full [&>svg]:size-4',
        lg: 'size-9 rounded-full [&>svg]:size-4',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'md',
    },
  }
)

export type IconBadgeTone = NonNullable<
  VariantProps<typeof iconBadgeVariants>['tone']
>

export function IconBadge({
  children,
  tone,
  size,
  className,
}: {
  children?: ReactNode
  tone?: IconBadgeTone
  size?: VariantProps<typeof iconBadgeVariants>['size']
  className?: string
}) {
  return (
    <span
      className={cn(iconBadgeVariants({ tone, size }), className)}
      aria-hidden
    >
      {children}
    </span>
  )
}
