import {
  type ReactNode,
  type ComponentType,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowUp,
  Ban,
  ChevronDown,
  ChevronUp,
  Clock3,
  CircleAlert,
  CircleCheck,
  CircleX,
  Eye,
  Gauge,
  History,
  Loader2,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  type ExecutionMode,
  type ProbeProfile,
  type ProbeRun,
  type ProbeSample,
} from '@/lib/api'
import { StatusBadge } from '@/lib/status'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useServerTableLoading } from '@/hooks/use-server-table-loading'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  extractHtmlPreviews,
  FormattedContentPreviewButton,
  HtmlPreviewButton,
  MarkdownView,
  SourceCodeView,
} from '@/components/formatted-content'
import { Page, PageHeader, LoadingState, EmptyState } from '@/components/page'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { SelectionToolbar } from '@/components/selection-toolbar'
import {
  ServerPagination,
  ServerTableLoadingOverlay,
} from '@/components/server-pagination'
import {
  AccountRestoreIndicator,
  EgressBindingIndicator,
} from '@/features/monitor/components/account-state-indicators'
import {
  buildEgressNodeNameMap,
  formatEgressNodeText,
  getEgressNodeName,
  type EgressNodeNameMap,
} from '@/features/monitor/components/egress-node-names'
import { EgressNodeReference } from '@/features/monitor/components/egress-node-reference'
import { ProbeDialog } from '@/features/monitor/components/probe-dialog'

const terminal = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
])

const activeRunStatuses = new Set([
  'queued',
  'running',
  'cancel_requested',
  'recovering',
])

const cancellableRunStatuses = new Set(['queued', 'running', 'recovering'])

const runStatusMeta: Record<
  string,
  { label: string; icon: ComponentType<{ className?: string }>; tone: string }
> = {
  queued: {
    label: '任务排队中',
    icon: Clock3,
    tone: 'text-muted-foreground',
  },
  running: { label: '任务执行中', icon: RefreshCw, tone: 'text-sky-600' },
  cancel_requested: {
    label: '任务取消中',
    icon: Square,
    tone: 'text-amber-600',
  },
  recovering: { label: '任务恢复中', icon: Undo2, tone: 'text-amber-600' },
  completed: {
    label: '任务已完成',
    icon: CircleCheck,
    tone: 'text-emerald-600',
  },
  completed_with_errors: {
    label: '任务部分异常',
    icon: CircleAlert,
    tone: 'text-amber-600',
  },
  failed: { label: '任务失败', icon: CircleX, tone: 'text-destructive' },
  cancelled: { label: '任务已取消', icon: Ban, tone: 'text-muted-foreground' },
}

const degradationClassifications = new Set([
  'elevated',
  'buffered_soft',
  'buffered_hard',
  'fast_risk',
  'marker_miss',
])

export function RunsPage() {
  const client = useQueryClient()
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [deferredSearch, searchPending] = useDebouncedValue(search.trim())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [probeSelection, setProbeSelection] = useState<{
    accountIds: number[]
    taskCount: number
  } | null>(null)
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailScrollRef = useRef<HTMLDivElement | null>(null)
  const detailScrollTopRef = useRef(0)
  const openDetail = (id: string) => {
    detailScrollTopRef.current = 0
    setDetailId(id)
  }
  const query = useQuery({
    queryKey: ['runs', status, deferredSearch, page, pageSize],
    queryFn: ({ signal }) =>
      api.runs(
        {
          page,
          pageSize,
          status: status === 'all' ? '' : status,
          search: deferredSearch,
        },
        signal
      ),
    placeholderData: (previous) => previous,
    refetchInterval: (value) => {
      const activeCount = value.state.data?.activeCount
      if (typeof activeCount === 'number') {
        return activeCount > 0 ? 2_000 : false
      }
      return (value.state.data?.items ?? []).some((run) =>
        activeRunStatuses.has(run.status)
      )
        ? 2_000
        : false
    },
    refetchIntervalInBackground: false,
  })
  const egress = useQuery({
    queryKey: ['egress'],
    queryFn: () => api.egress({ pageSize: 500 }),
    staleTime: 60_000,
  })
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: api.profiles,
    staleTime: 60_000,
  })
  const egressNodeNames = useMemo(
    () => buildEgressNodeNameMap(egress.data?.items),
    [egress.data?.items]
  )
  const detail = useQuery({
    queryKey: ['run', detailId],
    queryFn: () => api.run(detailId!),
    enabled: detailId != null,
    refetchInterval: (value) =>
      value.state.data && terminal.has(value.state.data.run.status)
        ? false
        : 1_500,
  })
  const {
    beginTableInteraction,
    tableLoading: showTableLoading,
  } = useServerTableLoading({
    isFetching: query.isFetching,
    inputPending: searchPending,
  })
  const currentPageRuns = useMemo(
    () => query.data?.items ?? [],
    [query.data?.items]
  )
  const currentPageRunIdSet = useMemo(
    () => new Set(currentPageRuns.map((run) => run.id)),
    [currentPageRuns]
  )
  const selectedRunIdSet = useMemo(
    () => new Set(selectedRunIds),
    [selectedRunIds]
  )
  const selectedRuns = useMemo(
    () => currentPageRuns.filter((run) => selectedRunIdSet.has(run.id)),
    [currentPageRuns, selectedRunIdSet]
  )
  const selectedAccountIds = useMemo(
    () =>
      Array.from(
        new Set(
          selectedRuns
            .map((run) => Number(run.account_id))
            .filter((accountId) => accountId > 0)
        )
      ),
    [selectedRuns]
  )
  const selectedCancellableRuns = selectedRuns.filter(isRunCancellable)
  const selectedDeletableRuns = selectedRuns.filter(isRunDeletable)
  const selectedCurrentPageCount = selectedRuns.length
  const allCurrentPageSelected =
    currentPageRuns.length > 0 &&
    selectedCurrentPageCount === currentPageRuns.length
  const selectAllChecked = allCurrentPageSelected
    ? true
    : selectedCurrentPageCount > 0
      ? 'indeterminate'
      : false
  useEffect(() => {
    // Keep selection scoped to the current server-side result page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedRunIds((current) => {
      const next = current.filter((id) => currentPageRunIdSet.has(id))
      return next.length === current.length ? current : next
    })
  }, [currentPageRunIdSet])
  useLayoutEffect(() => {
    const element = detailScrollRef.current
    if (!element || detailId == null) return
    element.scrollTop = Math.min(
      detailScrollTopRef.current,
      Math.max(0, element.scrollHeight - element.clientHeight)
    )
  }, [detail.data, detailId])
  const mutate = useMutation({
    mutationFn: async ({
      action,
      id,
    }: {
      action: 'cancel' | 'retry' | 'delete' | 'restore'
      id: string
    }) => {
      if (action === 'cancel') await api.cancelRun(id)
      else if (action === 'retry') await api.retryRun(id)
      else if (action === 'restore') await api.restoreRunAccountSettings(id)
      else await api.deleteRun(id)
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.action === 'delete'
          ? '任务已删除'
          : variables.action === 'restore'
            ? '已按任务记录同步账号原设置'
            : variables.action === 'retry'
              ? '已重新加入队列'
              : '已请求取消'
      )
      if (variables.action === 'delete') {
        detailScrollTopRef.current = 0
        setDetailId(null)
        setSelectedRunIds((current) =>
          current.filter((id) => id !== variables.id)
        )
      }
      void client.invalidateQueries({ queryKey: ['runs'] })
      void client.invalidateQueries({ queryKey: ['run'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const bulkDelete = useMutation({
    mutationFn: api.deleteRuns,
    onSuccess: (result, deletedIds) => {
      toast.success(`已删除 ${result.deleted} 个任务及其历史样本`)
      const deletedIdSet = new Set(deletedIds)
      setSelectedRunIds((current) =>
        current.filter((id) => !deletedIdSet.has(id))
      )
      setBulkDeleteOpen(false)
      if (detailId && deletedIdSet.has(detailId)) {
        detailScrollTopRef.current = 0
        setDetailId(null)
      }
      void client.invalidateQueries({ queryKey: ['runs'] })
      void client.invalidateQueries({ queryKey: ['run'] })
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['account'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const bulkCancel = useMutation({
    mutationFn: api.cancelRuns,
    onSuccess: (result) => {
      const messages = []
      if (result.cancelled) messages.push(`${result.cancelled} 个排队任务已取消`)
      if (result.cancelRequested) {
        messages.push(`${result.cancelRequested} 个执行任务正在停止`)
      }
      if (result.alreadyStopping) {
        messages.push(`${result.alreadyStopping} 个任务已在停止中`)
      }
      if (result.skipped) messages.push(`${result.skipped} 个终态任务已跳过`)
      if (result.alreadyStopping || result.skipped) {
        toast.warning(messages.join('，') || '所选任务状态未发生变化')
      } else {
        toast.success(messages.join('，') || '所选任务已进入停止流程')
      }
      setBulkCancelOpen(false)
      void client.invalidateQueries({ queryKey: ['runs'] })
      void client.invalidateQueries({ queryKey: ['run'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const toggleRunSelection = (id: string, checked: boolean) => {
    setSelectedRunIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id)
    )
  }

  const toggleCurrentPageSelection = (checked: boolean) => {
    setSelectedRunIds(checked ? currentPageRuns.map((run) => run.id) : [])
  }

  const bulkPending = bulkCancel.isPending || bulkDelete.isPending

  return (
    <Page>
      <PageHeader
        title='任务中心'
        description='Cron 和手动探针共用持久队列；支持进度查看、批量重测、取消、重试与删除。'
        actions={
          <ActionToolbar label='任务列表操作'>
            <ToolbarAction
              label='刷新任务列表'
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw />
            </ToolbarAction>
          </ActionToolbar>
        }
      />
      <Card>
        <CardContent className='p-4'>
          <div
            className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'
            aria-busy={showTableLoading}
          >
            <div className='relative w-full sm:max-w-md'>
              <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={search}
                onChange={(event) => {
                  beginTableInteraction()
                  setSearch(event.target.value)
                  setPage(1)
                  setSelectedRunIds([])
                }}
                placeholder='搜索账号名称、邮箱或账号 ID'
                className='pr-9 pl-9'
              />
              {showTableLoading && (
                <Loader2 className='absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary' />
              )}
            </div>
            <div className='flex flex-wrap items-center justify-end gap-2'>
              <SelectionToolbar
                selectedCount={selectedRunIds.length}
                entityLabel='任务'
                disabled={bulkPending}
                onClear={() => setSelectedRunIds([])}
              >
                <ToolbarAction
                  label={
                    selectedAccountIds.length
                      ? `测试已选任务中的 ${selectedAccountIds.length} 个账号`
                      : '所选任务中没有可测试账号'
                  }
                  disabled={selectedAccountIds.length === 0 || bulkPending}
                  onClick={() => {
                    setProbeSelection({
                      accountIds: selectedAccountIds,
                      taskCount: selectedRuns.length,
                    })
                    void egress.refetch()
                    void profiles.refetch()
                  }}
                >
                  <Play />
                </ToolbarAction>
                <ToolbarAction
                  label={
                    selectedCancellableRuns.length
                      ? `停止 ${selectedCancellableRuns.length} 个可取消任务`
                      : '所选任务中没有可停止任务'
                  }
                  disabled={
                    selectedCancellableRuns.length === 0 || bulkPending
                  }
                  pending={bulkCancel.isPending}
                  onClick={() => setBulkCancelOpen(true)}
                >
                  <Square />
                </ToolbarAction>
                <ToolbarAction
                  label={
                    selectedDeletableRuns.length
                      ? `删除 ${selectedDeletableRuns.length} 个可删除任务`
                      : '所选任务尚未结束或账号设置待恢复'
                  }
                  destructive
                  disabled={selectedDeletableRuns.length === 0 || bulkPending}
                  pending={bulkDelete.isPending}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 />
                </ToolbarAction>
              </SelectionToolbar>
              <Select
                value={status}
                onValueChange={(value) => {
                  beginTableInteraction()
                  setStatus(value)
                  setPage(1)
                  setSelectedRunIds([])
                }}
              >
                <SelectTrigger className='w-48'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>全部状态</SelectItem>
                  <SelectItem value='queued'>任务排队中</SelectItem>
                  <SelectItem value='running'>任务执行中</SelectItem>
                  <SelectItem value='cancel_requested'>任务取消中</SelectItem>
                  <SelectItem value='completed'>任务已完成</SelectItem>
                  <SelectItem value='completed_with_errors'>
                    任务部分异常
                  </SelectItem>
                  <SelectItem value='failed'>任务失败</SelectItem>
                  <SelectItem value='cancelled'>任务已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {query.isLoading && !query.data ? (
            <LoadingState />
          ) : (
            <>
              <div
                className='relative min-h-48'
                aria-busy={showTableLoading}
              >
                {currentPageRuns.length ? (
                  <Table rememberRowKey='monitor-runs'>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-10'>
                          <Checkbox
                            checked={selectAllChecked}
                            onCheckedChange={(value) =>
                              toggleCurrentPageSelection(value === true)
                            }
                            disabled={
                              currentPageRuns.length === 0 || bulkPending
                            }
                            aria-label='选择当前页全部任务'
                          />
                        </TableHead>
                        <TableHead>账号</TableHead>
                        <TableHead>来源</TableHead>
                        <TableHead>模式</TableHead>
                        <TableHead>任务状态</TableHead>
                        <TableHead>探针统计</TableHead>
                        <TableHead>进度 / 预计耗时</TableHead>
                        <TableHead>当前步骤</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentPageRuns.map((run) => (
                        <RunRow
                          key={run.id}
                          run={run}
                          egressNodeNames={egressNodeNames}
                          selected={selectedRunIdSet.has(run.id)}
                          onSelectedChange={(checked) =>
                            toggleRunSelection(run.id, checked)
                          }
                          onDetail={() => openDetail(run.id)}
                          onAction={(action) =>
                            mutate.mutate({ action, id: run.id })
                          }
                          pending={mutate.isPending || bulkPending}
                        />
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title={
                      deferredSearch || status !== 'all'
                        ? '未找到匹配任务'
                        : '暂无探针任务'
                    }
                    description={
                      deferredSearch || status !== 'all'
                        ? '请调整账号搜索词或任务状态筛选条件。'
                        : '从账号页面手动选择账号，或配置一个 Cron 计划。'
                    }
                  />
                )}
                {showTableLoading && (
                  <ServerTableLoadingOverlay
                    page={page}
                    itemLabel='任务'
                    message='正在更新任务筛选结果…'
                  />
                )}
              </div>
              {query.data && (
                <ServerPagination
                  page={page}
                  pageSize={pageSize}
                  total={query.data.total}
                  disabled={showTableLoading}
                  loading={showTableLoading}
                  itemLabel='任务'
                  onPageChange={(value) => {
                    beginTableInteraction()
                    setSelectedRunIds([])
                    setPage(value)
                  }}
                  onPageSizeChange={(value) => {
                    beginTableInteraction()
                    setPageSize(value)
                    setPage(1)
                    setSelectedRunIds([])
                  }}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
      <ProbeDialog
        open={probeSelection != null}
        onOpenChange={(open) => {
          if (!open) setProbeSelection(null)
        }}
        accountIds={probeSelection?.accountIds ?? []}
        sourceTaskCount={probeSelection?.taskCount ?? 0}
        profiles={profiles.data ?? []}
        egress={egress.data?.items ?? []}
        egressLoading={egress.isFetching}
        egressError={egress.isError ? getErrorMessage(egress.error) : ''}
        onRefreshEgress={() => void egress.refetch()}
        onCreated={() => {
          setSelectedRunIds([])
          setProbeSelection(null)
          void client.invalidateQueries({ queryKey: ['runs'] })
          void client.invalidateQueries({ queryKey: ['dashboard'] })
        }}
      />
      <AlertDialog
        open={bulkCancelOpen}
        onOpenChange={(open) => {
          if (!bulkCancel.isPending) setBulkCancelOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              停止 {selectedCancellableRuns.length} 个探针任务？
            </AlertDialogTitle>
            <AlertDialogDescription className='space-y-2'>
              <span className='block'>
                排队任务会立即取消；执行中的任务会中止当前请求，并在恢复账号原设置后结束。
              </span>
              <span className='block'>
                任务、已产生的样本和历史记录仍会保留，进入终态后可继续使用批量删除。
              </span>
              {selectedRuns.length > selectedCancellableRuns.length && (
                <span className='block'>
                  另外{' '}
                  {selectedRuns.length - selectedCancellableRuns.length}{' '}
                  个已结束或已在停止的任务保持不变。
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkCancel.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                bulkCancel.isPending || selectedCancellableRuns.length === 0
              }
              onClick={() =>
                bulkCancel.mutate(selectedCancellableRuns.map((run) => run.id))
              }
            >
              <Square />
              停止任务
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!bulkDelete.isPending) setBulkDeleteOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除 {selectedDeletableRuns.length} 个探针任务？
            </AlertDialogTitle>
            <AlertDialogDescription className='space-y-2'>
              <span className='block'>
                任务详情和该任务产生的探针样本会一并删除，账号页的对应历史、出口统计和
                TPS 统计也会减少。
              </span>
              <span className='block'>
                grok2api
                中的账号及其当前设置不会被删除；账号设置尚未恢复的任务不可删除。
              </span>
              {selectedRuns.length > selectedDeletableRuns.length && (
                <span className='block'>
                  另外 {selectedRuns.length - selectedDeletableRuns.length}{' '}
                  个未结束或账号设置待恢复的任务保持不变。
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-white hover:bg-destructive/90'
              disabled={
                bulkDelete.isPending || selectedDeletableRuns.length === 0
              }
              onClick={() =>
                bulkDelete.mutate(selectedDeletableRuns.map((run) => run.id))
              }
            >
              <Trash2 />
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={detailId != null}
        onOpenChange={(open) => {
          if (!open) {
            detailScrollTopRef.current = 0
            setDetailId(null)
          }
        }}
      >
        <DialogContent
          size='wide'
          className='max-h-[calc(100dvh-2rem)] overflow-hidden data-[state=closed]:animate-none data-[state=closed]:duration-0'
        >
          <DialogHeader className='shrink-0'>
            <DialogTitle>探针任务详情</DialogTitle>
            <DialogDescription className='font-mono'>
              {detailId}
            </DialogDescription>
          </DialogHeader>
          <div
            ref={detailScrollRef}
            className='min-h-0 flex-1 overflow-y-auto overscroll-contain pe-1'
            onScroll={(event) => {
              detailScrollTopRef.current = event.currentTarget.scrollTop
            }}
          >
            {detail.isLoading ? (
              <LoadingState />
            ) : (
              detail.data && (
                <RunDetail
                  data={detail.data}
                  egressNodeNames={egressNodeNames}
                  onAction={(action) =>
                    mutate.mutate({ action, id: detail.data.run.id })
                  }
                />
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function RunRow({
  run,
  egressNodeNames,
  selected,
  onSelectedChange,
  onDetail,
  onAction,
  pending,
}: {
  run: ProbeRun
  egressNodeNames: EgressNodeNameMap
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onDetail: () => void
  onAction: (action: 'cancel' | 'retry' | 'delete' | 'restore') => void
  pending: boolean
}) {
  const progress = run.total_steps
    ? Math.round((run.completed_steps / run.total_steps) * 100)
    : 0
  const restoreBlocked = accountRestoreNeedsAttention(run)
  return (
    <TableRow rowId={run.id}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onSelectedChange(value === true)}
          disabled={pending}
          aria-label={`选择任务 ${run.id}`}
        />
      </TableCell>
      <TableCell>
        <div className='font-medium'>
          {run.account_name || `账号 ${run.account_id}`}
        </div>
        <div className='max-w-64 truncate text-xs text-muted-foreground'>
          {run.account_email ? `${run.account_email} · ` : ''}ID{' '}
          {run.account_id}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={run.trigger === 'cron' ? 'info' : 'secondary'}>
          {run.trigger === 'cron'
            ? 'Cron'
            : run.trigger === 'retry'
              ? '重试'
              : '手动'}
        </Badge>
      </TableCell>
      <TableCell>
        <ExecutionModeBadge mode={run.execution_mode} />
      </TableCell>
      <TableCell>
        <div className='flex items-center gap-2'>
          <RunStatusIndicator value={run.status} />
          <QueueWaitIndicator reason={run.queue_blocked_reason} />
          <WorkerAssignmentIndicator workerId={run.worker_id} />
          <AccountRestoreIndicator run={run} />
        </div>
        {run.error && (
          <div
            className='mt-1 max-w-52 truncate text-xs text-destructive'
            title={run.error}
          >
            {run.error}
          </div>
        )}
      </TableCell>
      <TableCell>
        <RunProbeStats run={run} />
      </TableCell>
      <TableCell className='min-w-40'>
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>
            {run.completed_steps}/{run.total_steps}
          </span>
          <span>{progress}%</span>
        </div>
        <div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted'>
          <div
            className='h-full rounded-full bg-primary'
            style={{ width: `${progress}%` }}
          />
        </div>
        <RunDurationEstimate run={run} className='mt-1.5' />
      </TableCell>
      <TableCell>
        <div className='text-sm'>
          {run.current_round ? `第 ${run.current_round} 轮` : '—'}
        </div>
        <div className='text-xs text-muted-foreground'>
          <TargetKeyLabel
            value={run.current_target_key}
            egressNodeNames={egressNodeNames}
          />
        </div>
      </TableCell>
      <TableCell>{formatDate(run.created_at)}</TableCell>
      <TableCell>
        <div className='flex justify-end gap-1'>
          <RunActionIcon label='查看详情' onClick={onDetail}>
            <Eye />
          </RunActionIcon>
          {!terminal.has(run.status) ? (
            <RunActionIcon
              label='取消任务'
              disabled={pending}
              onClick={() => onAction('cancel')}
            >
              <Square />
            </RunActionIcon>
          ) : restoreBlocked ? (
            <RunActionIcon
              label='同步账号原设置'
              variant='outline'
              className='text-destructive'
              disabled={pending}
              onClick={() => onAction('restore')}
            >
              <Undo2 />
            </RunActionIcon>
          ) : (
            <>
              <RunActionIcon
                label='重新加入队列'
                disabled={pending}
                onClick={() => onAction('retry')}
              >
                <RotateCcw />
              </RunActionIcon>
              <RunActionIcon
                label='删除任务'
                className='text-destructive'
                disabled={pending}
                onClick={() => onAction('delete')}
              >
                <Trash2 />
              </RunActionIcon>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function RunStatusIndicator({
  value,
  showLabel = false,
}: {
  value?: string | null
  showLabel?: boolean
}) {
  const meta = runStatusMeta[value || ''] || {
    label: '未知任务状态',
    icon: CircleAlert,
    tone: 'text-muted-foreground',
  }
  const Icon = meta.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium',
            showLabel ? 'max-w-full' : 'size-7 justify-center px-0',
            meta.tone
          )}
          tabIndex={0}
          aria-label={meta.label}
        >
          <Icon
            className={cn(
              'size-4 shrink-0',
              value === 'running' && 'animate-spin'
            )}
          />
          {showLabel && <span className='truncate'>{meta.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{meta.label}（任务状态）</TooltipContent>
    </Tooltip>
  )
}

function QueueWaitIndicator({ reason }: { reason?: string }) {
  if (!reason) return null
  const labels: Record<string, string> = {
    same_account_running:
      '同一账号已有任务执行中；为避免出口绑定和账号原设置互相覆盖，本任务保持排队。',
    account_restore_blocked:
      '该账号原设置尚在恢复或需要人工同步，本任务暂缓领取。',
    worker_capacity: '任务可执行，正在等待空闲 Worker。',
  }
  const label = labels[reason] || '任务正在等待 Worker 领取。'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md border bg-background',
            reason === 'worker_capacity'
              ? 'text-muted-foreground'
              : 'text-amber-600 dark:text-amber-400'
          )}
          tabIndex={0}
          aria-label={label}
        >
          <Clock3 className='size-4' />
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-96'>{label}</TooltipContent>
    </Tooltip>
  )
}

function WorkerAssignmentIndicator({ workerId }: { workerId?: string | null }) {
  if (!workerId) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className='inline-flex size-7 items-center justify-center rounded-md border bg-background text-sky-600'
          tabIndex={0}
          aria-label={`执行 Worker：${workerId}`}
        >
          <Activity className='size-4' />
        </span>
      </TooltipTrigger>
      <TooltipContent>执行 Worker：{workerId}</TooltipContent>
    </Tooltip>
  )
}

function RunProbeStats({ run }: { run: ProbeRun }) {
  const stats = getRunProbeStats(run)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='flex items-center gap-2 text-xs tabular-nums'>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              stats.anomalies > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            )}
          >
            <TriangleAlert className='size-3.5' />
            {stats.anomalies}
          </span>
          <span className='inline-flex items-center gap-1 text-muted-foreground'>
            <Activity className='size-3.5' />
            {stats.samples}
          </span>
          {stats.maxTps != null && (
            <span className='inline-flex items-center gap-1 text-muted-foreground'>
              <Gauge className='size-3.5' />
              {formatNumber(stats.maxTps)}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className='max-w-96'>
        本任务探针统计：{stats.anomalies} 个降智信号 / {stats.samples} 个样本
        {stats.maxTps != null
          ? `，最高 ${formatNumber(stats.maxTps)} TPS，平均 ${formatNumber(stats.avgTps)}`
          : ''}
        。这些数字只代表本任务，不等同账号最终监控判定。
      </TooltipContent>
    </Tooltip>
  )
}

function RunDurationEstimate({
  run,
  className,
}: {
  run: ProbeRun
  className?: string
}) {
  if (run.status !== 'queued' && run.status !== 'running') return null
  const estimate = run.duration_estimate
  if (!estimate?.sample_count || estimate.estimated_total_ms <= 0) {
    return (
      <span className={cn('block text-xs text-muted-foreground', className)}>
        暂无历史样本
      </span>
    )
  }
  const label =
    run.status === 'queued'
      ? `预计 ${formatDuration(estimate.estimated_total_ms)}`
      : estimate.estimated_remaining_ms > 0
        ? `约剩 ${formatDuration(estimate.estimated_remaining_ms)}`
        : '正在收尾'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'flex w-fit items-center gap-1 text-xs text-sky-600 dark:text-sky-400',
            className
          )}
          tabIndex={0}
        >
          <Clock3 className='size-3.5 shrink-0' />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-96'>
        基于同一探针方案和执行模式的 {estimate.sample_count}{' '}
        个有效样本，平均每个样本{' '}
        {formatDuration(estimate.average_sample_ms)}，预计总执行时间{' '}
        {formatDuration(estimate.estimated_total_ms)}
        。排队、步骤间隔、重试等待和任务收尾可能产生额外耗时。
      </TooltipContent>
    </Tooltip>
  )
}

function getRunProbeStats(run: ProbeRun) {
  const summary =
    run.summary && typeof run.summary === 'object' ? run.summary : {}
  const classifications =
    summary.classifications && typeof summary.classifications === 'object'
      ? (summary.classifications as Record<string, unknown>)
      : {}
  const classificationAnomalies = Object.entries(classifications).reduce(
    (total, [name, value]) =>
      total +
      (degradationClassifications.has(name) ? toFiniteNumber(value) || 0 : 0),
    0
  )
  return {
    samples:
      toFiniteNumber(summary.sample_count) ??
      toFiniteNumber(summary.completed) ??
      run.completed_steps,
    anomalies: toFiniteNumber(summary.anomaly_count) ?? classificationAnomalies,
    maxTps: toFiniteNumber(summary.max_tps),
    avgTps: toFiniteNumber(summary.avg_tps),
  }
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0 秒'
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) {
    return seconds
      ? `${totalMinutes} 分钟 ${seconds} 秒`
      : `${totalMinutes} 分钟`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function RunDetail({
  data,
  egressNodeNames,
  onAction,
}: {
  data: { run: ProbeRun; profile: ProbeProfile; samples: ProbeSample[] }
  egressNodeNames: EgressNodeNameMap
  onAction: (action: 'cancel' | 'retry' | 'delete' | 'restore') => void
}) {
  const run = data.run
  const profile = data.profile
  const restoreBlocked = accountRestoreNeedsAttention(run)
  return (
    <div className='space-y-5'>
      <div className='grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))]'>
        <Metric
          label='账号'
          value={run.account_name || run.account_id}
          valueClassName='break-all'
        />
        <Metric
          label='模式'
          value={<ExecutionModeBadge mode={run.execution_mode} />}
        />
        <Metric
          label='任务状态'
          value={<RunStatusIndicator value={run.status} showLabel />}
        />
        <Metric
          label='Worker'
          value={run.worker_id || (run.status === 'queued' ? '等待领取' : '—')}
          valueClassName='font-mono text-xs'
        />
        <Metric
          label='进度'
          value={`${run.completed_steps} / ${run.total_steps}`}
        />
        <Metric label='错误' value={run.error_count} />
        <Metric
          label={
            run.status === 'queued' || run.status === 'running'
              ? '预计耗时'
              : '耗时'
          }
          value={
            run.started_at && run.completed_at
              ? formatDuration(
                  Math.max(
                    0,
                    new Date(run.completed_at).getTime() -
                      new Date(run.started_at).getTime()
                  )
                )
              : run.status === 'queued' || run.status === 'running'
                ? <RunDurationEstimate run={run} />
                : '—'
          }
        />
      </div>
      <AccountRestoreCard
        run={run}
        egressNodeNames={egressNodeNames}
        onRestore={() => onAction('restore')}
      />
      <div className='rounded-lg border bg-muted/20 p-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='text-sm font-medium'>{profile.name}</div>
            <div className='mt-1 text-xs text-muted-foreground'>
              {profile.model} · 自动校验标记 {profile.expected_text || '未设置'}
            </div>
          </div>
          {profile.expected_output && (
            <FormattedContentPreviewButton
              content={profile.expected_output}
              expectedImageUrl={profile.expected_image_url}
              label='预览预期结果'
              title={`${profile.name} · 预期结果`}
            />
          )}
        </div>
        <div className='mt-3 text-sm whitespace-pre-wrap'>{profile.prompt}</div>
        {profile.expected_image_url && (
          <a
            href={profile.expected_image_url}
            target='_blank'
            rel='noreferrer'
            className='mt-2 inline-block text-xs text-primary hover:underline'
          >
            查看预期效果图
          </a>
        )}
      </div>
      <div className='space-y-3'>
        {data.samples.map((sample) => (
          <SampleCard
            key={sample.id}
            sample={sample}
            expectedImageUrl={profile.expected_image_url}
            executionMode={run.execution_mode}
            egressNodeNames={egressNodeNames}
          />
        ))}
        {!data.samples.length && (
          <EmptyState
            title='尚无样本'
            description='任务排队中，或当前步骤仍在等待上游流式响应。'
          />
        )}
      </div>
      <div className='flex justify-end gap-2'>
        {terminal.has(run.status) && !restoreBlocked ? (
          <>
            <RunActionIcon
              label='重新加入队列'
              variant='outline'
              onClick={() => onAction('retry')}
            >
              <RotateCcw />
            </RunActionIcon>
            <RunActionIcon
              label='删除任务'
              variant='destructive'
              onClick={() => onAction('delete')}
            >
              <Trash2 />
            </RunActionIcon>
          </>
        ) : !terminal.has(run.status) ? (
          <RunActionIcon
            label='取消任务'
            variant='outline'
            onClick={() => onAction('cancel')}
          >
            <Square />
          </RunActionIcon>
        ) : null}
      </div>
    </div>
  )
}

function AccountRestoreCard({
  run,
  egressNodeNames,
  onRestore,
}: {
  run: ProbeRun
  egressNodeNames: EgressNodeNameMap
  onRestore: () => void
}) {
  if (!run.account_settings_snapshot_at) return null
  const status = run.account_restore_status || 'pending'
  const restored = isAccountRestored(status)
  return (
    <div className='rounded-lg border bg-muted/15 p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='text-sm font-semibold'>账号原设置</span>
            <AccountRestoreIndicator run={run} />
          </div>
          <div className='mt-3 flex flex-wrap items-center gap-2'>
            <RestoreFact
              icon={Power}
              value={run.original_account_enabled ? '启' : '停'}
              tooltip={`原启用状态：${run.original_account_enabled ? '启用' : '停用'}`}
            />
            <RestoreFact
              icon={ArrowUp}
              value={run.original_account_priority ?? '—'}
              tooltip={`原优先级：${run.original_account_priority ?? '未记录'}`}
            />
            <RestoreFact
              icon={Gauge}
              value={run.original_account_max_concurrent ?? '—'}
              tooltip={`原最大并发：${run.original_account_max_concurrent ?? '未记录'}`}
            />
            <EgressBindingIndicator
              nodeId={run.original_egress_node_id}
              nodeName={getEgressNodeName(
                egressNodeNames,
                run.original_egress_node_id
              )}
              assignmentMode={run.original_egress_assignment_mode}
            />
            <RestoreFact
              icon={Activity}
              value={`${run.diagnostic_priority ?? '—'} / ${run.diagnostic_max_concurrent ?? '—'}`}
              tooltip='诊断短时设置：优先级 / 最大并发'
            />
            <RestoreFact
              icon={History}
              value={run.account_restore_attempts ?? 0}
              tooltip={`恢复尝试次数${run.account_restored_at ? `；最近完成于 ${formatDate(run.account_restored_at)}` : ''}`}
            />
          </div>
        </div>
        <RunActionIcon
          label={restored ? '重新同步原设置' : '同步原设置'}
          variant={status === 'restore_failed' ? 'default' : 'outline'}
          disabled={!terminal.has(run.status) || status === 'restoring'}
          onClick={onRestore}
        >
          <Undo2 />
        </RunActionIcon>
      </div>
    </div>
  )
}

function isAccountRestored(status: string) {
  return ['automatic_restored', 'startup_restored', 'manual_restored'].includes(
    status
  )
}

function accountRestoreNeedsAttention(run: ProbeRun) {
  return (
    run.account_restore_status === 'restore_failed' ||
    run.diagnostic_activation_active === true
  )
}

function isRunCancellable(run: ProbeRun) {
  return cancellableRunStatuses.has(run.status)
}

function isRunDeletable(run: ProbeRun) {
  return terminal.has(run.status) && !accountRestoreNeedsAttention(run)
}

function TargetKeyLabel({
  value,
  egressNodeNames,
}: {
  value?: string | null
  egressNodeNames: EgressNodeNameMap
}) {
  if (!value) return null
  if (value === 'direct') return '上游调度'
  if (!value.startsWith('egress:')) return value
  const nodeId = value.slice(7)
  return (
    <EgressNodeReference
      nodeId={nodeId}
      nodeName={getEgressNodeName(egressNodeNames, nodeId)}
      prefix='Node '
    />
  )
}

function RestoreFact({
  icon: Icon,
  value,
  tooltip,
}: {
  icon: typeof Power
  value: ReactNode
  tooltip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className='inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs tabular-nums'
          tabIndex={0}
        >
          <Icon className='size-3.5 text-muted-foreground' />
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function RunActionIcon({
  label,
  children,
  onClick,
  disabled = false,
  variant = 'ghost',
  className,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: React.ComponentProps<typeof Button>['variant']
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          size='icon'
          variant={variant}
          className={className}
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

function SampleCard({
  sample,
  expectedImageUrl,
  executionMode,
  egressNodeNames,
}: {
  sample: ProbeSample
  expectedImageUrl?: string
  executionMode: ExecutionMode
  egressNodeNames: EgressNodeNameMap
}) {
  const responseText = sample.response_text || '（空响应）'
  const isLongResponse = responseText.length > 4_000
  const hasHtmlPreview = useMemo(
    () => extractHtmlPreviews(responseText).length > 0,
    [responseText]
  )
  const responseCollapsible = isLongResponse || hasHtmlPreview
  const [responseDisplay, setResponseDisplay] = useState<
    'auto' | 'expanded' | 'collapsed'
  >('auto')
  const responseScrollRef = useRef<HTMLDivElement | null>(null)
  const responseScrollTopRef = useRef(0)
  const responseExpanded =
    responseDisplay === 'expanded' ||
    (responseDisplay === 'auto' && !responseCollapsible)
  useLayoutEffect(() => {
    const element = responseScrollRef.current
    if (!element || !responseExpanded) return
    element.scrollTop = Math.min(
      responseScrollTopRef.current,
      Math.max(0, element.scrollHeight - element.clientHeight)
    )
  }, [responseExpanded, responseText])
  const responsePreview = responseText.slice(0, 240).replace(/\s+/g, ' ').trim()
  const targetEgressMismatch =
    sample.target_kind === 'egress' &&
    sample.egress_node_id != null &&
    sample.verified_egress_node_id != null &&
    Number(sample.egress_node_id) !== Number(sample.verified_egress_node_id)
  return (
    <div className='rounded-xl border bg-card'>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-3'>
        <span className='text-sm font-semibold'>
          第 {sample.round_number} 轮 ·{' '}
          {sample.target_kind === 'direct' ? (
            sample.verified_egress_node_id ? (
              <>
                上游调度 ·{' '}
                <EgressNodeReference
                  nodeId={sample.verified_egress_node_id}
                  nodeName={getEgressNodeName(
                    egressNodeNames,
                    sample.verified_egress_node_id
                  )}
                />
              </>
            ) : (
              '上游调度 · 本地出口'
            )
          ) : (
            sample.egress_name
          )}
        </span>
        <StatusBadge value={sample.classification} />
        {sample.error_code && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className='inline-flex size-6 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400'
                tabIndex={0}
                aria-label='上游暂时不可调度'
              >
                <Clock3 className='size-3.5' />
              </span>
            </TooltipTrigger>
            <TooltipContent className='max-w-96'>
              上游暂时不可调度：{sample.error_code}
              {sample.retry_count ? `，已重试 ${sample.retry_count} 次` : ''}
              {sample.retry_after_seconds
                ? `，建议等待 ${formatNumber(sample.retry_after_seconds)} 秒`
                : ''}
            </TooltipContent>
          </Tooltip>
        )}
        {targetEgressMismatch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className='inline-flex size-6 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400'
                tabIndex={0}
                aria-label='目标出口与实际出口不同'
              >
                <TriangleAlert className='size-3.5' />
              </span>
            </TooltipTrigger>
            <TooltipContent className='max-w-80'>
              目标出口{' '}
              {formatEgressNodeText(egressNodeNames, sample.egress_node_id)}
              ，实际出口{' '}
              {formatEgressNodeText(
                egressNodeNames,
                sample.verified_egress_node_id
              )}
              ；流式结果有效，已继续计算 TPS 与分类。
            </TooltipContent>
          </Tooltip>
        )}
        <span className='ms-auto text-xs text-muted-foreground'>
          {formatDate(sample.created_at)}
        </span>
        {responseCollapsible && (
          <RunActionIcon
            label={responseExpanded ? '收起响应' : '展开响应'}
            onClick={() =>
              setResponseDisplay(responseExpanded ? 'collapsed' : 'expanded')
            }
          >
            {responseExpanded ? <ChevronUp /> : <ChevronDown />}
          </RunActionIcon>
        )}
      </div>
      <div className='grid gap-3 border-b bg-muted/15 p-4 sm:grid-cols-3 lg:grid-cols-6'>
        <Metric label='TPS' value={formatNumber(sample.tps)} />
        <Metric label='首 Token' value={`${sample.first_token_ms} ms`} />
        <Metric label='总耗时' value={`${sample.duration_ms} ms`} />
        <Metric label='生成窗口' value={`${sample.generation_ms} ms`} />
        <Metric label='输出 Token' value={sample.output_tokens} />
        <Metric
          label='预期匹配'
          value={
            sample.expected_matched == null
              ? '—'
              : sample.expected_matched
                ? '是'
                : '否'
          }
        />
      </div>
      <div className='p-4'>
        {sample.error ? (
          <div className='space-y-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
            <div>{sample.error}</div>
            {sample.error_code && (
              <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                <Badge variant='outline'>{sample.error_code}</Badge>
                {sample.status_code > 0 && (
                  <span>HTTP {sample.status_code}</span>
                )}
                {sample.retry_count ? (
                  <span>重试 {sample.retry_count} 次</span>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <>
            {executionMode === 'quality_test' && !sample.response_text ? (
              <div className='rounded-lg border border-sky-500/20 bg-sky-500/5 p-4'>
                <div className='text-sm font-medium'>上游仅返回哈希和指标</div>
                <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                  快速出口质量探针不会返回可渲染正文；账号与出口由 grok2api
                  审计记录交叉核验。
                </p>
                <div className='mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4'>
                  <Evidence label='响应哈希' value={sample.response_sha256} />
                  <Evidence label='Request ID' value={sample.request_id} />
                  <Evidence
                    label='核验账号'
                    value={sample.verified_account_id}
                  />
                  <Evidence
                    label='核验出口'
                    value={
                      sample.verified_egress_node_id ? (
                        <EgressNodeReference
                          nodeId={sample.verified_egress_node_id}
                          nodeName={getEgressNodeName(
                            egressNodeNames,
                            sample.verified_egress_node_id
                          )}
                        />
                      ) : (
                        '—'
                      )
                    }
                  />
                </div>
              </div>
            ) : (
              <>
                {responseExpanded ? (
                  <div
                    ref={responseScrollRef}
                    className='max-h-[32rem] min-w-0 overflow-auto overscroll-contain rounded-lg'
                    onScroll={(event) => {
                      responseScrollTopRef.current =
                        event.currentTarget.scrollTop
                    }}
                  >
                    {hasHtmlPreview ? (
                      <SourceCodeView
                        content={responseText}
                        className='min-h-full rounded-lg'
                      />
                    ) : (
                      <MarkdownView
                        content={responseText}
                        codeBlockClassName='max-h-none overflow-visible overscroll-auto'
                      />
                    )}
                  </div>
                ) : (
                  <button
                    type='button'
                    className='flex w-full items-center gap-3 rounded-lg border border-dashed bg-muted/20 p-3 text-start transition-colors hover:bg-muted/40'
                    onClick={() => setResponseDisplay('expanded')}
                  >
                    <ChevronDown className='size-4 shrink-0 text-muted-foreground' />
                    <span className='min-w-0 flex-1'>
                      <span className='block text-sm font-medium'>
                        {hasHtmlPreview ? 'HTML 响应已折叠' : '长响应已折叠'}
                      </span>
                      <span className='mt-1 line-clamp-2 block font-mono text-xs text-muted-foreground'>
                        {responsePreview || '点击展开完整响应'}
                      </span>
                    </span>
                    <Badge variant='outline' className='shrink-0 tabular-nums'>
                      {formatNumber(responseText.length, 0)} 字符
                    </Badge>
                  </button>
                )}
                <div className='mt-3 flex items-center gap-2'>
                  <HtmlPreviewButton
                    content={responseText}
                    expectedImageUrl={expectedImageUrl}
                  />
                  {responseCollapsible && responseExpanded && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setResponseDisplay('collapsed')}
                    >
                      <ChevronUp />
                      收起响应
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ExecutionModeBadge({ mode }: { mode?: ExecutionMode }) {
  return (
    <Badge variant={mode === 'quality_test' ? 'info' : 'outline'}>
      {mode === 'quality_test' ? '快速质量' : '完整对话'}
    </Badge>
  )
}

function Evidence({ label, value }: { label: string; value: ReactNode }) {
  const title =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined
  return (
    <div className='min-w-0 rounded-md border bg-background px-2.5 py-2'>
      <div className='text-muted-foreground'>{label}</div>
      <div className='mt-1 truncate font-mono' title={title}>
        {value ?? '—'}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  return (
    <div className='min-w-0'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div
        className={cn(
          'mt-1 min-w-0 text-sm font-semibold tabular-nums',
          valueClassName
        )}
      >
        {value}
      </div>
    </div>
  )
}
