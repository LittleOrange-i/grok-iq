import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type ActionToolbarProps = {
  label: string
  children: ReactNode
  className?: string
}

export function ActionToolbar({
  label,
  children,
  className,
}: ActionToolbarProps) {
  return (
    <div
      role='toolbar'
      aria-label={label}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-lg border bg-muted/30 p-1 shadow-xs',
        className
      )}
    >
      {children}
    </div>
  )
}

type ToolbarActionProps = {
  label: string
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  pending?: boolean
  active?: boolean
  destructive?: boolean
  className?: string
  type?: 'button' | 'submit'
}

export function ToolbarAction({
  label,
  children,
  onClick,
  disabled = false,
  pending = false,
  active = false,
  destructive = false,
  className,
  type = 'button',
}: ToolbarActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex shrink-0'>
          <Button
            type={type}
            size='icon'
            variant={active ? 'secondary' : 'ghost'}
            className={cn(
              'size-8 shrink-0',
              destructive &&
                'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
              className
            )}
            disabled={disabled || pending}
            onClick={onClick}
            aria-label={label}
            aria-busy={pending || undefined}
          >
            {pending ? <Loader2 className='animate-spin' /> : children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
