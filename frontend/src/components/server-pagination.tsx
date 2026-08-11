import type { ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const DEFAULT_PAGE_SIZE_OPTIONS = [20, 50, 100]

export function ServerPagination({
  page,
  pageSize,
  total,
  disabled,
  loading,
  itemLabel,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  disabled: boolean
  loading: boolean
  itemLabel: string
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total ? (page - 1) * pageSize + 1 : 0
  const end = Math.min(page * pageSize, total)

  return (
    <div className='mt-4 flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex items-center gap-2 text-muted-foreground'>
        {loading && <Loader2 className='size-3.5 animate-spin text-primary' />}
        <span className='tabular-nums'>
          {start}–{end} / {total} 个{itemLabel}
        </span>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={String(pageSize)}
          disabled={disabled}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className='h-8 w-24'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value} / 页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className='min-w-20 text-center text-muted-foreground tabular-nums'>
          {page} / {totalPages}
        </span>
        <PaginationButton
          label='第一页'
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft />
        </PaginationButton>
        <PaginationButton
          label='上一页'
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </PaginationButton>
        <PaginationButton
          label='下一页'
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </PaginationButton>
        <PaginationButton
          label='最后一页'
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          <ChevronsRight />
        </PaginationButton>
      </div>
    </div>
  )
}

export function ServerTableLoadingOverlay({
  page,
  itemLabel,
  message,
}: {
  page: number
  itemLabel: string
  message?: ReactNode
}) {
  return (
    <div
      className='absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/65 backdrop-blur-[1px]'
      role='status'
      aria-live='polite'
    >
      <div className='flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm'>
        <Loader2 className='size-3.5 animate-spin text-primary' />
        {message ?? `正在加载第 ${page} 页${itemLabel}…`}
      </div>
    </div>
  )
}

function PaginationButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          size='icon'
          variant='outline'
          className='size-8'
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
