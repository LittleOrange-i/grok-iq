import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ListChecks,
  Loader2,
  Network,
  RefreshCw,
  Route,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type AccountOption, type EgressNode } from '@/lib/api'
import { cn, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ACCOUNT_UPSTREAM_STATUS_OPTIONS,
  type UpstreamStatusFilter,
} from '@/features/monitor/components/account-upstream-status'

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

type AccountMultiSelectProps = {
  value: number[]
  onChange: (value: number[]) => void
  egress?: EgressNode[]
  invalid?: boolean
}

export function AccountMultiSelect({
  value,
  onChange,
  egress = [],
  invalid = false,
}: AccountMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [upstreamStatus, setUpstreamStatus] =
    useState<UpstreamStatusFilter>('all')
  const [accountLabels, setAccountLabels] = useState(
    () => new Map<number, AccountOption>()
  )
  const selectedIds = useMemo(() => uniqueIds(value), [value])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const egressNames = useMemo(
    () => new Map(egress.map((node) => [String(node.id), node.name])),
    [egress]
  )

  useEffect(() => {
    const normalized = search.trim()
    if (normalized === debouncedSearch) return
    const timer = window.setTimeout(() => {
      setDebouncedSearch(normalized)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [debouncedSearch, search])

  const accountsQuery = useQuery({
    queryKey: ['plan-account-options', page, debouncedSearch, upstreamStatus],
    queryFn: ({ signal }) =>
      api.accountOptions(
        {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
          status: upstreamStatus === 'all' ? undefined : upstreamStatus,
        },
        signal
      ),
    enabled: open,
    staleTime: 10_000,
  })
  const searchPending = search.trim() !== debouncedSearch
  const accounts = useMemo(
    () => (searchPending ? [] : (accountsQuery.data?.items ?? [])),
    [accountsQuery.data?.items, searchPending]
  )
  const total = searchPending ? 0 : (accountsQuery.data?.total ?? 0)
  const responsePageSize = accountsQuery.data?.pageSize || PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / responsePageSize))
  const currentPage = Math.min(accountsQuery.data?.page ?? page, totalPages)
  const firstItem = total ? (currentPage - 1) * responsePageSize + 1 : 0
  const lastItem = total ? Math.min(currentPage * responsePageSize, total) : 0
  const loading = searchPending || accountsQuery.isFetching
  const currentPageSelectable = accounts.filter(isDetectableAccount).length

  useEffect(() => {
    if (!accounts.length) return
    // Query results populate labels for selected accounts across paginated pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountLabels((current) => {
      const next = new Map(current)
      let changed = false
      for (const account of accounts) {
        const id = Number(account.id)
        if (!Number.isInteger(id) || id <= 0) continue
        if (next.get(id) !== account) {
          next.set(id, account)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [accounts])

  useEffect(() => {
    // A filtered result can invalidate the previously selected page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accountsQuery.data && page > totalPages) setPage(totalPages)
  }, [accountsQuery.data, page, totalPages])

  const selectSearchResults = useMutation({
    mutationFn: () =>
      api.accountSelection({
        search: search.trim() || undefined,
        status: upstreamStatus === 'all' ? undefined : upstreamStatus,
      }),
    onSuccess: (result) => {
      const next = uniqueIds([...selectedIds, ...result.accountIds])
      const added = next.length - selectedIds.length
      onChange(next)
      toast.success(
        added > 0 ? `已加入 ${added} 个可检测账号` : '当前搜索结果已全部选中'
      )
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const toggle = (account: AccountOption) => {
    const id = Number(account.id)
    const selected = selectedIdSet.has(id)
    if (!selected && !isDetectableAccount(account)) return
    onChange(
      selected
        ? selectedIds.filter((current) => current !== id)
        : [...selectedIds, id]
    )
  }

  return (
    <div className='grid gap-2'>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            role='combobox'
            aria-label='选择 Cron 探针账号'
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            className={cn(
              'h-auto min-h-9 w-full justify-between px-3 py-2 font-normal',
              invalid && 'border-destructive focus-visible:ring-destructive/30'
            )}
          >
            <span className='flex min-w-0 items-center gap-2'>
              <UsersRound className='size-4 shrink-0 text-muted-foreground' />
              <span
                className={cn(
                  'truncate',
                  !selectedIds.length && 'text-muted-foreground'
                )}
              >
                {selectedIds.length
                  ? `已选 ${selectedIds.length} 个账号`
                  : '搜索并选择上游账号'}
              </span>
            </span>
            {loading ? (
              <Loader2 className='size-4 shrink-0 animate-spin text-muted-foreground' />
            ) : (
              <ChevronsUpDown className='size-4 shrink-0 text-muted-foreground' />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0 sm:min-w-[32rem]'
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder='搜索名称、邮箱或账号 ID'
            />
            <div className='border-b px-3 py-2'>
              <Select
                value={upstreamStatus}
                onValueChange={(value) => {
                  setUpstreamStatus(value as UpstreamStatusFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger
                  size='sm'
                  className='w-full'
                  aria-label='筛选 grok2api 账号状态'
                >
                  <Activity className='size-4 text-muted-foreground' />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_UPSTREAM_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
              <span className='text-xs text-muted-foreground'>
                已选 {selectedIds.length} · 匹配 {total} · 本页可检测{' '}
                {currentPageSelectable}
              </span>
              <div className='flex items-center gap-1'>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='size-7'
                  disabled={loading}
                  onClick={() => void accountsQuery.refetch()}
                  aria-label='刷新账号列表'
                  title='刷新账号列表'
                >
                  <RefreshCw className={loading ? 'animate-spin' : undefined} />
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='h-7 px-2 text-xs'
                  disabled={
                    loading || selectSearchResults.isPending || total === 0
                  }
                  onClick={() => selectSearchResults.mutate()}
                  title='将当前搜索命中的全部可检测账号加入选择'
                >
                  {selectSearchResults.isPending ? (
                    <Loader2 className='animate-spin' />
                  ) : (
                    <ListChecks />
                  )}
                  全选结果
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='h-7 px-2 text-xs'
                  disabled={!selectedIds.length}
                  onClick={() => onChange([])}
                >
                  清空
                </Button>
              </div>
            </div>
            {accountsQuery.isError && (
              <div className='border-b px-3 py-2 text-xs text-destructive'>
                {getErrorMessage(accountsQuery.error)}
              </div>
            )}
            <CommandList className='max-h-80'>
              {loading && !accounts.length ? (
                <div className='flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground'>
                  <Loader2 className='size-4 animate-spin' />
                  正在读取上游账号
                </div>
              ) : accounts.length ? (
                <CommandGroup>
                  {accounts.map((account) => {
                    const id = Number(account.id)
                    const selected = selectedIdSet.has(id)
                    const detectable = isDetectableAccount(account)
                    const title =
                      account.name || account.email || `账号 ${account.id}`
                    return (
                      <CommandItem
                        key={account.id}
                        value={String(account.id)}
                        disabled={!detectable && !selected}
                        onSelect={() => toggle(account)}
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/35'
                          )}
                          aria-hidden='true'
                        >
                          {selected && <Check className='size-3' />}
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate'>{title}</span>
                          <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
                            <span className='truncate'>
                              {account.email || `ID ${account.id}`}
                            </span>
                            <span aria-hidden='true'>·</span>
                            <AccountEgressLabel
                              account={account}
                              egressNames={egressNames}
                            />
                          </span>
                        </span>
                        {!account.enabled && (
                          <Badge variant='warning' className='shrink-0'>
                            停用
                          </Badge>
                        )}
                        {!detectable && (
                          <Badge variant='secondary' className='shrink-0'>
                            {account.authStatus || '鉴权异常'}
                          </Badge>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ) : (
                <CommandEmpty>未找到账号</CommandEmpty>
              )}
            </CommandList>
            <div className='flex items-center justify-between gap-3 border-t px-3 py-2'>
              <span className='text-xs text-muted-foreground tabular-nums'>
                {firstItem}–{lastItem} / {total}
              </span>
              <div className='flex items-center gap-1'>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='size-7'
                  disabled={loading || currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label='上一页账号'
                  title='上一页'
                >
                  <ChevronLeft />
                </Button>
                <span className='min-w-16 text-center text-xs text-muted-foreground tabular-nums'>
                  {currentPage} / {totalPages}
                </span>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='size-7'
                  disabled={loading || currentPage >= totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  aria-label='下一页账号'
                  title='下一页'
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedIds.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {selectedIds.slice(0, 4).map((id) => {
            const account = accountLabels.get(id)
            return (
              <Badge key={id} variant='outline' className='max-w-56'>
                <span className='truncate'>
                  {account?.name || account?.email || `账号 #${id}`}
                </span>
              </Badge>
            )
          })}
          {selectedIds.length > 4 && (
            <Badge variant='secondary'>+{selectedIds.length - 4}</Badge>
          )}
        </div>
      )}
    </div>
  )
}

function isDetectableAccount(account: AccountOption): boolean {
  return !account.authStatus || account.authStatus === 'active'
}

function AccountEgressLabel({
  account,
  egressNames,
}: {
  account: AccountOption
  egressNames: Map<string, string>
}) {
  const nodeId = account.egressNodeId ? String(account.egressNodeId) : ''
  if (!nodeId) {
    return (
      <span className='inline-flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400'>
        <Route className='size-3' />
        未绑定固定出口
      </span>
    )
  }
  const mode =
    account.egressAssignmentMode === 'auto'
      ? '自动'
      : account.egressAssignmentMode === 'manual'
        ? '手动'
        : '固定'
  return (
    <span className='inline-flex min-w-0 items-center gap-1'>
      <Network className='size-3 shrink-0' />
      <span className='max-w-36 truncate'>
        {egressNames.get(nodeId) || `出口节点 #${nodeId}`} · {mode}
      </span>
    </span>
  )
}

function uniqueIds(ids: number[]): number[] {
  return Array.from(
    new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))
  )
}
