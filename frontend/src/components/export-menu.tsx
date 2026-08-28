import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn, getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function ExportMenu({
  label = '导出',
  pending = false,
  onExport,
  variant = 'toolbar',
}: {
  label?: string
  pending?: boolean
  onExport: (format: 'csv' | 'json') => void | Promise<void>
  variant?: 'button' | 'toolbar'
}) {
  const [busy, setBusy] = useState(false)
  const loading = pending || busy

  const run = async (format: 'csv' | 'json') => {
    if (loading) return
    setBusy(true)
    try {
      await onExport(format)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const triggerButton = (
    <Button
      type='button'
      variant={variant === 'toolbar' ? 'ghost' : 'outline'}
      size={variant === 'toolbar' ? 'icon' : 'sm'}
      className={cn(variant === 'toolbar' ? 'size-7 shrink-0' : 'h-8')}
      disabled={loading}
      aria-label={label}
      aria-busy={loading || undefined}
    >
      {loading ? <Loader2 className='animate-spin' /> : <Download />}
      {variant === 'button' ? label : null}
    </Button>
  )

  return (
    <DropdownMenu>
      {variant === 'toolbar' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex shrink-0'>
              <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align='end'>
        <DropdownMenuItem disabled={loading} onSelect={() => void run('csv')}>
          导出 CSV
        </DropdownMenuItem>
        <DropdownMenuItem disabled={loading} onSelect={() => void run('json')}>
          导出 JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
