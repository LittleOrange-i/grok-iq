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
}: SelectionToolbarProps) {
  if (selectedCount <= 0) return null

  return (
    <ActionToolbar
      label={`已选择 ${selectedCount} 个${entityLabel}的批量操作`}
      className={cn(className)}
    >
      <Badge
        variant='secondary'
        className='h-8 shrink-0 border-0 bg-background px-2.5 tabular-nums'
      >
        {countLabel ?? `已选 ${selectedCount}`}
      </Badge>
      {children}
      <ToolbarAction label={clearLabel} disabled={disabled} onClick={onClear}>
        <X />
      </ToolbarAction>
    </ActionToolbar>
  )
}
