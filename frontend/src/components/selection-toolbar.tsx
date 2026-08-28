import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'

type SelectionToolbarProps = {
  selectedCount: number
  entityLabel: string
  onClear: () => void
  children: ReactNode
  countLabel?: ReactNode
  clearLabel?: string
  disabled?: boolean
  className?: string
  wrap?: boolean
}

export function SelectionToolbar({
  selectedCount,
  entityLabel,
  onClear,
  children,
  countLabel,
  clearLabel = '清除选择',
  disabled = false,
  className,
  wrap = true,
}: SelectionToolbarProps) {
  if (selectedCount <= 0) return null

  const body = (
    <>
      {!wrap ? (
        <span aria-hidden='true' className='mx-0.5 h-4 w-px shrink-0 bg-border' />
      ) : null}
      <Badge
        variant='secondary'
        className='h-7 shrink-0 border-0 bg-background px-2 text-[11px] tabular-nums'
      >
        {countLabel ?? `已选 ${selectedCount}`}
      </Badge>
      {children}
      <ToolbarAction label={clearLabel} disabled={disabled} onClick={onClear}>
        <X />
      </ToolbarAction>
    </>
  )

  if (!wrap) return body

  return (
    <ActionToolbar
      label={`已选择 ${selectedCount} 个${entityLabel}的批量操作`}
      className={cn(className)}
    >
      {body}
    </ActionToolbar>
  )
}
