import { useState } from 'react'
import { BrainCircuit, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export function ReasoningPanel({
  content,
  streaming = false,
  defaultOpen,
  className,
}: {
  content: string
  streaming?: boolean
  defaultOpen?: boolean
  className?: string
}) {
  const text = content.trim()
  const [open, setOpen] = useState(defaultOpen ?? streaming)

  if (!text && !streaming) return null

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('mb-3', className)}
    >
      <div className='overflow-hidden rounded-md bg-muted/35'>
        <CollapsibleTrigger asChild>
          <button
            type='button'
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground'
          >
            <BrainCircuit className='size-3.5 text-primary' />
            <span>思考过程</span>
            {streaming && (
              <span className='ms-auto inline-flex items-center gap-1 text-primary'>
                <Loader2 className='size-3 animate-spin' />
                接收中
              </span>
            )}
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform',
                open && 'rotate-180',
                !streaming && 'ms-auto'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className='max-h-80 overflow-y-auto overscroll-contain px-3 pb-2.5 text-xs leading-5'>
            {text ? (
              <div className='[overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground'>
                {text}
                {streaming && (
                  <span
                    className='ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle'
                    aria-hidden='true'
                  />
                )}
              </div>
            ) : (
              <span className='text-muted-foreground'>正在等待思考片段…</span>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
