import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type InfoTooltipProps = {
  label: string
  content: ReactNode
  className?: string
  contentClassName?: string
}

export function InfoTooltip({
  label,
  content,
  className,
  contentClassName,
}: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            className
          )}
          aria-label={`${label}说明`}
        >
          <Info className='size-3.5' />
        </button>
      </TooltipTrigger>
      <TooltipContent className={cn('max-w-72 leading-5', contentClassName)}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
