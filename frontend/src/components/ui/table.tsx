import * as React from 'react'
import { cn } from '@/lib/utils'

type TableInteractionContextValue = {
  activeRowId: string | null
  activateRow: (rowId: string) => void
}

const TableInteractionContext = React.createContext<
  TableInteractionContextValue | undefined
>(undefined)

type TableProps = React.ComponentProps<'table'> & {
  rememberRowKey?: string
}

function Table({ className, rememberRowKey, ...props }: TableProps) {
  const storageKey = rememberRowKey
    ? `grokiq-current-table-row::${rememberRowKey}`
    : ''
  const [activeRowId, setActiveRowId] = React.useState<string | null>(() => {
    if (!storageKey || typeof window === 'undefined') return null
    try {
      return window.sessionStorage.getItem(storageKey)
    } catch {
      return null
    }
  })
  const activateRow = React.useCallback(
    (rowId: string) => {
      setActiveRowId(rowId)
      if (!storageKey || typeof window === 'undefined') return
      try {
        window.sessionStorage.setItem(storageKey, rowId)
      } catch {
        /* 浏览器禁用会话存储时仍保留当前页面内的高亮。 */
      }
    },
    [storageKey]
  )
  const interaction = React.useMemo(
    () => ({ activeRowId, activateRow }),
    [activeRowId, activateRow]
  )

  return (
    <TableInteractionContext.Provider value={interaction}>
      <div
        data-slot='table-container'
        className='relative w-full overflow-x-auto'
      >
        <table
          data-slot='table'
          className={cn('w-full caption-bottom text-sm', className)}
          {...props}
        />
      </div>
    </TableInteractionContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot='table-header'
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot='table-body'
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot='table-footer'
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        className
      )}
      {...props}
    />
  )
}

type TableRowProps = React.ComponentProps<'tr'> & {
  rowId?: string | number
}

function TableRow({
  className,
  rowId,
  onFocusCapture,
  onPointerDownCapture,
  ...props
}: TableRowProps) {
  const interaction = React.useContext(TableInteractionContext)
  const normalizedRowId = rowId == null ? null : String(rowId)
  const current =
    normalizedRowId != null && interaction?.activeRowId === normalizedRowId
  const activate = () => {
    if (normalizedRowId != null) interaction?.activateRow(normalizedRowId)
  }

  return (
    <tr
      data-slot='table-row'
      data-current-row={current ? 'true' : undefined}
      aria-current={current ? 'true' : undefined}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[current-row=true]:bg-muted/60 data-[current-row=true]:hover:bg-muted/80 data-[state=selected]:bg-muted data-[current-row=true]:[&>td]:bg-muted/60 data-[current-row=true]:hover:[&>td]:bg-muted/80 data-[current-row=true]:[&>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]',
        className
      )}
      onPointerDownCapture={(event) => {
        activate()
        onPointerDownCapture?.(event)
      }}
      onFocusCapture={(event) => {
        activate()
        onFocusCapture?.(event)
      }}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot='table-head'
      className={cn(
        'h-10 px-2 text-start align-middle font-medium whitespace-nowrap text-foreground *:[[role=checkbox]]:translate-y-0.5',
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot='table-cell'
      className={cn(
        'p-2 align-middle whitespace-nowrap *:[[role=checkbox]]:translate-y-0.5',
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot='table-caption'
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
