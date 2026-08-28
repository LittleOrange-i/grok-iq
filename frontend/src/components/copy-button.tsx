import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { copyText } from '@/lib/clipboard'
import { cn, getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function CopyButton({
  value,
  className,
  disabled,
}: {
  value: string
  className?: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number>(0)
  const canCopy = Boolean(value) && !disabled

  useEffect(
    () => () => {
      window.clearTimeout(resetTimerRef.current)
    },
    []
  )

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canCopy) return
    void copyText(value)
      .then(() => {
        setCopied(true)
        window.clearTimeout(resetTimerRef.current)
        resetTimerRef.current = window.setTimeout(() => {
          setCopied(false)
          resetTimerRef.current = 0
        }, 1500)
      })
      .catch((error) => toast.error(getErrorMessage(error)))
  }

  const label = copied ? '已复制' : '复制'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          tabIndex={-1}
          className={cn('size-7 shrink-0', className)}
          disabled={!canCopy}
          aria-label={label}
          onClick={handleCopy}
        >
          {copied ? <Check className='text-emerald-500' /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CopyableText({
  value,
  children,
  className,
}: {
  value: string
  children?: ReactNode
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {children ?? <span className='min-w-0 truncate'>{value}</span>}
      <CopyButton value={value} className='size-6' />
    </span>
  )
}
