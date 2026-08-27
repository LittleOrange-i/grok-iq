import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Eye,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldBan,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatAccountSecondaryLabel } from '@/lib/account-label'
import { api, type ProbeSample, type UpstreamAccount } from '@/lib/api'
import { StatusBadge } from '@/lib/status'
import { formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePaintDeferredValue } from '@/hooks/use-paint-deferred-value'
import { usePersistedViewState } from '@/hooks/use-persisted-view-state'
import { useServerTableLoading } from '@/hooks/use-server-table-loading'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'
import { PersistedViewNotice } from '@/components/persisted-view-notice'
import { SelectionToolbar } from '@/components/selection-toolbar'
import {
  ServerPagination,
  ServerTableLoadingOverlay,
} from '@/components/server-pagination'
import { AccountSampleExplorer } from '@/features/monitor/components/account-sample-explorer'
import {
  ACCOUNT_UPSTREAM_STATUS_OPTIONS,
  type UpstreamStatusFilter,
} from '@/features/monitor/components/account-upstream-status'
import {
  buildEgressNodeNameMap,
  getEgressNodeName,
  type EgressNodeNameMap,
} from '@/features/monitor/components/egress-node-names'
import { FilterChip } from '@/features/monitor/components/filter-chip'

type SsoRiskFilter =
  | 'all'
  | 'missing'
  | 'unverified'
  | 'pending'
  | 'clean'
  | 'flagged'
  | 'failed'
  | 'change_egress'

type IsolationUpstreamStatusFilter = UpstreamStatusFilter | 'missing'

const QUARANTINE_VIEW_STORAGE_KEY = 'grokiq.monitor.quarantine-view.v1'
const defaultQuarantineView = {
  page: 1,
  pageSize: 50,
  search: '',
  upstreamStatus: 'all' as IsolationUpstreamStatusFilter,
  ssoRisk: 'all' as SsoRiskFilter,
  egressNodeId: 'all',
}

const isolationUpstreamStatusOptions: {
  value: IsolationUpstreamStatusFilter
  label: string
}[] = [
  ...ACCOUNT_UPSTREAM_STATUS_OPTIONS,
  { value: 'missing', label: '上游缺失' },
]

const ssoRiskLabels: Record<SsoRiskFilter, string> = {
  all: '全部 SSO 风控状态',
  missing: '缺少 SSO',
  unverified: 'SSO 未复检',
  pending: 'SSO 待复检',
  clean: 'SSO 正常',
  flagged: 'SSO 已标记',
  failed: 'SSO 复检失败',
  change_egress: '建议更换出口',
}

function RiskReasonCell({ account }: { account: UpstreamAccount }) {
  const assessment = account.assessment
  const reasons = assessment?.risk_reasons ?? []
  const sampleCount = assessment?.sample_count ?? 0
  const anomalyCount = assessment?.anomaly_count ?? 0
  const hardCount = assessment?.hard_anomaly_count ?? 0
  const score = assessment?.risk_score ?? 0
  if (!reasons.length && anomalyCount === 0 && hardCount === 0) {
    return <span className='text-muted-foreground'>—</span>
  }
  const summary =
    hardCount > 0
      ? `硬信号 ${hardCount}`
      : anomalyCount > 0
        ? `异常 ${anomalyCount}`
        : `${reasons.length} 条原因`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-8 max-w-52 gap-1.5 px-2.5 text-xs font-normal'
        >
          <span className='truncate'>{summary}</span>
          {reasons.length > 0 ? (
            <span className='shrink-0 text-muted-foreground'>
              {reasons.length} 项
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 p-0'>
        <div className='border-b px-3 py-2.5'>
          <div className='text-sm font-medium'>风险原因</div>
          <div className='mt-1 text-[11px] leading-5 text-muted-foreground'>
            样本 {sampleCount} · 异常 {anomalyCount} · 硬信号 {hardCount}
            {score ? ` · ${formatNumber(score)} 分` : ''}
          </div>
        </div>
        {reasons.length > 0 ? (
          <ul className='max-h-72 space-y-0.5 overflow-y-auto p-2'>
            {reasons.map((reason) => (
              <li
                key={reason}
                className='rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-5'
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className='px-3 py-2.5 text-xs text-muted-foreground'>
            暂无规则说明
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function QuarantinePage() {
  const client = useQueryClient()
  const view = usePersistedViewState(
    QUARANTINE_VIEW_STORAGE_KEY,
    defaultQuarantineView
  )
  const {
    page,
    pageSize,
    search,
    upstreamStatus = 'all',
    ssoRisk = 'all',
    egressNodeId = 'all',
  } = view.value
  const updateView = (patch: Partial<typeof defaultQuarantineView>) =>
    view.setValue((current) => ({ ...current, ...patch }))
  const [deferredSearch] = useDebouncedValue(search.trim())
  const committedQuery = useMemo(
    () => ({
      page,
      pageSize,
      search: deferredSearch,
      upstreamStatus,
      ssoRisk,
      egressNodeId,
    }),
    [deferredSearch, egressNodeId, page, pageSize, ssoRisk, upstreamStatus]
  )
  const tableQuery = usePaintDeferredValue(committedQuery)
  const [selected, setSelected] = useState<number[]>([])
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const tableQueryPending =
    tableQuery.page !== committedQuery.page ||
    tableQuery.pageSize !== committedQuery.pageSize ||
    tableQuery.search !== committedQuery.search ||
    tableQuery.upstreamStatus !== committedQuery.upstreamStatus ||
    tableQuery.ssoRisk !== committedQuery.ssoRisk ||
    tableQuery.egressNodeId !== committedQuery.egressNodeId
  const query = useQuery({
    queryKey: [
      'accounts',
      'quarantine',
      tableQuery.page,
      tableQuery.pageSize,
      tableQuery.search,
      tableQuery.upstreamStatus,
      tableQuery.ssoRisk,
      tableQuery.egressNodeId,
    ],
    queryFn: ({ signal }) =>
      api.quarantineAccounts(
        {
          page: tableQuery.page,
          pageSize: tableQuery.pageSize,
          search: tableQuery.search,
          status:
            tableQuery.upstreamStatus === 'all'
              ? ''
              : tableQuery.upstreamStatus,
          ssoRisk: tableQuery.ssoRisk === 'all' ? '' : tableQuery.ssoRisk,
          egressNodeId:
            tableQuery.egressNodeId === 'all' ? '' : tableQuery.egressNodeId,
        },
        signal
      ),
    placeholderData: (previous) => previous,
  })
  const accounts = useMemo(() => query.data?.items ?? [], [query.data?.items])
  const { beginTableInteraction, tableLoading: showTableLoading } =
    useServerTableLoading({
      isFetching: query.isFetching,
      inputPending: tableQueryPending,
    })
  const tableFilterKey = [
    tableQuery.search,
    tableQuery.upstreamStatus,
    tableQuery.ssoRisk,
    tableQuery.egressNodeId,
  ].join('|')
  const appliedFilterKeyRef = useRef(tableFilterKey)
  useEffect(() => {
    if (tableQueryPending) {
      beginTableInteraction()
      return
    }
    if (appliedFilterKeyRef.current === tableFilterKey) return
    appliedFilterKeyRef.current = tableFilterKey
    setSelected((current) => (current.length === 0 ? current : []))
  }, [beginTableInteraction, tableFilterKey, tableQueryPending])

  const detail = useQuery({
    queryKey: ['account', detailId],
    queryFn: () => api.account(detailId!),
    enabled: detailOpen && detailId != null,
  })
  const samplesQuery = useQuery({
    queryKey: ['account-samples', detailId],
    queryFn: () => api.accountSamples(detailId!, { page: 1, pageSize: 50 }),
    enabled: detailOpen && detailId != null,
  })
  const egress = useQuery({
    queryKey: ['egress'],
    queryFn: () => api.egress({ pageSize: 500 }),
    staleTime: 60_000,
  })
  const egressNodeNames = useMemo(
    () => buildEgressNodeNameMap(egress.data?.items),
    [egress.data?.items]
  )
  const detailAccount =
    detail.data?.account ??
    accounts.find((item) => Number(item.id) === detailId) ??
    null
  const samples: ProbeSample[] =
    samplesQuery.data?.items ?? detail.data?.history.samples ?? []

  const openAccountSamples = useCallback((id: number) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const allChecked =
    accounts.length > 0 &&
    accounts.every((item) => selected.includes(Number(item.id)))

  const toggleCurrentPageSelection = useCallback(
    (checked: boolean) => {
      const pageIds = accounts.map((item) => Number(item.id))
      setSelected((current) =>
        checked
          ? Array.from(new Set([...current, ...pageIds]))
          : current.filter((id) => !pageIds.includes(id))
      )
    },
    [accounts]
  )
  const toggleAccountSelection = useCallback(
    (id: number, checked: boolean) => {
      setSelected((current) =>
        checked
          ? [...new Set([...current, id])]
          : current.filter((item) => item !== id)
      )
    },
    []
  )

  const restoreMutation = useMutation({
    mutationFn: (accountIds: number[]) =>
      api.accountBatchAction({
        account_ids: accountIds,
        action: 'restore',
        note: '隔离区恢复上游',
        propagate: true,
      }),
    onSuccess: (result) => {
      const skippedAccountIds = result.skippedAccountIds ?? []
      const failedAccountIds = result.failedAccountIds ?? []
      const retainedAccountIds = Array.from(
        new Set([...skippedAccountIds, ...failedAccountIds])
      )
      setRestoreOpen(false)
      setSelected(retainedAccountIds)
      if (detailId != null && !retainedAccountIds.includes(detailId)) {
        setDetailOpen(false)
      }
      if (failedAccountIds.length > 0 || skippedAccountIds.length > 0) {
        const details = [`已恢复上游 ${result.updated} 个账号`]
        if (failedAccountIds.length) {
          details.push(`${failedAccountIds.length} 个恢复失败并保留选择`)
        }
        if (skippedAccountIds.length) {
          details.push(`${skippedAccountIds.length} 个账号已跳过`)
        }
        toast.warning(details.join('；'))
      } else {
        toast.success(`已恢复上游 ${result.updated} 个账号`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (accountIds: number[]) => api.deleteQuarantineLocal(accountIds),
    onSuccess: (result) => {
      const skippedAccountIds = result.skippedAccountIds ?? []
      const failedAccountIds = result.failedAccountIds ?? []
      const retainedAccountIds = Array.from(
        new Set([...skippedAccountIds, ...failedAccountIds])
      )
      setDeleteOpen(false)
      setSelected(retainedAccountIds)
      if (detailId != null && !retainedAccountIds.includes(detailId)) {
        setDetailOpen(false)
      }
      if (failedAccountIds.length > 0 || skippedAccountIds.length > 0) {
        const details = [`已删除 ${result.deleted} 条本系统记录`]
        if (failedAccountIds.length) {
          details.push(`${failedAccountIds.length} 个删除失败并保留选择`)
        }
        if (skippedAccountIds.length) {
          details.push(`${skippedAccountIds.length} 个账号已跳过`)
        }
        toast.warning(details.join('；'))
      } else {
        toast.success(`已删除 ${result.deleted} 条本系统记录`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const restorePending = restoreMutation.isPending
  const deletePending = deleteMutation.isPending
  const selectionActionPending = restorePending || deletePending
  const upstreamStatusLabel =
    isolationUpstreamStatusOptions.find(
      (option) => option.value === upstreamStatus
    )?.label ?? '全部上游状态'
  const viewSummary = [
    search.trim() ? `搜索“${search.trim()}”` : '',
    upstreamStatusLabel,
    ssoRiskLabels[ssoRisk],
    egressNodeId === 'all' ? '全部出口绑定' : `出口节点 ${egressNodeId}`,
    `第 ${page} 页 · 每页 ${pageSize} 条`,
  ]
    .filter(Boolean)
    .join(' · ')
  const activeFilterCount = [
    upstreamStatus !== 'all',
    ssoRisk !== 'all',
    egressNodeId !== 'all',
  ].filter(Boolean).length
  const egressFilterLabel =
    egressNodeId === 'unbound'
      ? '未绑定'
      : getEgressNodeName(egressNodeNames, egressNodeId) ??
        `节点 #${egressNodeId}`
  const hasActiveFilters = activeFilterCount > 0 || Boolean(search.trim())

  return (
    <Page>
      <PageHeader
        title='隔离区'
        description={
          <div className='space-y-2'>
            <p>
              隔离后账号保留在本地并停用上游，不删除 grok2api
              账号。可查看样本，恢复上游需确认，也可只删除本系统记录。
            </p>
            <p>
              来源包括人工移入、请求审计永久停用，以及探针按监控判定自动隔离。请求审计页面的「高风险」不会直接把账号送进这里，要达到停用次数后才会进来。
            </p>
            <p>
              探针到期停用是另一条可恢复链路；隔离区账号不会走到期自动恢复。
            </p>
          </div>
        }
        hintContentClassName='max-w-[28rem]'
        descriptionAsHint
        actions={
          <>
            <ActionToolbar label='隔离区操作'>
              <ToolbarAction
                label='刷新隔离账号'
                pending={query.isFetching}
                onClick={() => void query.refetch()}
              >
                <RefreshCw />
              </ToolbarAction>
            </ActionToolbar>
            <SelectionToolbar
              selectedCount={selected.length}
              entityLabel='账号'
              disabled={selectionActionPending}
              onClear={() => setSelected([])}
            >
              <ToolbarAction
                label={`恢复已选 ${selected.length} 个账号的上游`}
                pending={restorePending}
                disabled={selectionActionPending || selected.length === 0}
                onClick={() => setRestoreOpen(true)}
              >
                <Undo2 />
              </ToolbarAction>
              <ToolbarAction
                label={`删除已选 ${selected.length} 个账号的本系统记录`}
                destructive
                pending={deletePending}
                disabled={selectionActionPending || selected.length === 0}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
              </ToolbarAction>
            </SelectionToolbar>
          </>
        }
      />
      <Card>
        <CardContent className='p-4'>
          <div className='mb-4 space-y-3' aria-busy={showTableLoading}>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              <div className='relative min-w-0 flex-1'>
                <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={search}
                  onChange={(event) =>
                    updateView({ search: event.target.value, page: 1 })
                  }
                  placeholder='搜索名称、邮箱或账号 ID'
                  className='h-10 pr-9 pl-9'
                />
                {showTableLoading && (
                  <Loader2 className='absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary' />
                )}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    className='h-10 shrink-0 gap-2 px-3'
                  >
                    <SlidersHorizontal className='size-4' />
                    筛选条件
                    {activeFilterCount > 0 && (
                      <Badge
                        variant='secondary'
                        className='min-w-5 justify-center px-1.5'
                      >
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align='end'
                  className='w-[min(25rem,calc(100vw-2rem))] p-0'
                >
                  <div className='border-b px-4 py-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <div>
                        <div className='text-sm font-semibold'>隔离筛选</div>
                        <div className='mt-0.5 text-xs text-muted-foreground'>
                          组合条件，快速缩小隔离账号范围
                        </div>
                      </div>
                      {activeFilterCount > 0 && (
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-8'
                          onClick={() =>
                            updateView({
                              upstreamStatus: 'all',
                              ssoRisk: 'all',
                              egressNodeId: 'all',
                              page: 1,
                            })
                          }
                        >
                          清除全部
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className='space-y-4 p-4'>
                    <div className='space-y-2'>
                      <div className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
                        上游状态
                      </div>
                      <Select
                        value={upstreamStatus}
                        onValueChange={(value) =>
                          updateView({
                            upstreamStatus:
                              value as IsolationUpstreamStatusFilter,
                            page: 1,
                          })
                        }
                      >
                        <SelectTrigger>
                          <Activity className='size-4 text-muted-foreground' />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {isolationUpstreamStatusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <div className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
                        检测与出口
                      </div>
                      <Select
                        value={egressNodeId}
                        onValueChange={(value) =>
                          updateView({ egressNodeId: value, page: 1 })
                        }
                      >
                        <SelectTrigger>
                          <Network className='size-4 text-muted-foreground' />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='all'>全部出口绑定</SelectItem>
                          <SelectItem value='unbound'>未绑定出口</SelectItem>
                          {(egress.data?.items ?? []).map((node) => (
                            <SelectItem key={node.id} value={String(node.id)}>
                              {node.name || `节点 #${node.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <div className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
                        SSO 风控
                      </div>
                      <Select
                        value={ssoRisk}
                        onValueChange={(value) =>
                          updateView({
                            ssoRisk: value as SsoRiskFilter,
                            page: 1,
                          })
                        }
                      >
                        <SelectTrigger>
                          <ShieldAlert className='size-4 text-muted-foreground' />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ssoRiskLabels).map(
                            ([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {(activeFilterCount > 0 || search.trim()) && (
              <div className='flex flex-wrap items-center gap-1.5 border-t pt-3'>
                <span className='mr-1 text-xs text-muted-foreground'>
                  当前条件
                </span>
                {search.trim() && (
                  <FilterChip
                    label={`搜索：${search.trim()}`}
                    onClear={() => updateView({ search: '', page: 1 })}
                  />
                )}
                {upstreamStatus !== 'all' && (
                  <FilterChip
                    label={`上游：${upstreamStatusLabel}`}
                    onClear={() =>
                      updateView({ upstreamStatus: 'all', page: 1 })
                    }
                  />
                )}
                {ssoRisk !== 'all' && (
                  <FilterChip
                    label={`SSO：${ssoRiskLabels[ssoRisk]}`}
                    onClear={() => updateView({ ssoRisk: 'all', page: 1 })}
                  />
                )}
                {egressNodeId !== 'all' && (
                  <FilterChip
                    label={`出口：${egressFilterLabel}`}
                    onClear={() =>
                      updateView({ egressNodeId: 'all', page: 1 })
                    }
                  />
                )}
              </div>
            )}
          </div>
          {view.active && (
            <PersistedViewNotice
              restored={view.restored}
              summary={viewSummary}
              onClear={() => {
                beginTableInteraction()
                view.clear()
              }}
            />
          )}
          {query.isLoading && !query.data ? (
            <LoadingState />
          ) : query.isError && !query.data ? (
            <EmptyState
              icon={ShieldBan}
              title='无法加载隔离账号'
              description={getErrorMessage(query.error)}
            />
          ) : accounts.length ? (
            <>
              <div className='relative min-h-40' aria-busy={showTableLoading}>
                <QuarantineTable
                  accounts={accounts}
                  selected={selected}
                  allChecked={allChecked}
                  onToggleCurrentPage={toggleCurrentPageSelection}
                  onToggleAccount={toggleAccountSelection}
                  onOpenSamples={openAccountSamples}
                />
                {showTableLoading && (
                  <ServerTableLoadingOverlay
                    page={page}
                    itemLabel='账号'
                    message='正在更新隔离筛选结果…'
                  />
                )}
              </div>
              <ServerPagination
                page={page}
                pageSize={pageSize}
                total={query.data?.total ?? 0}
                disabled={showTableLoading}
                loading={showTableLoading}
                itemLabel='账号'
                onPageChange={(value) => {
                  beginTableInteraction()
                  updateView({ page: value })
                }}
                onPageSizeChange={(value) => {
                  beginTableInteraction()
                  updateView({ pageSize: value, page: 1 })
                }}
              />
            </>
          ) : (
            <div className='relative min-h-48' aria-busy={showTableLoading}>
              <EmptyState
                icon={ShieldBan}
                title={hasActiveFilters ? '没有匹配的隔离账号' : '当前没有隔离账号'}
                description={
                  hasActiveFilters
                    ? '没有匹配当前筛选的隔离账号，请调整条件后重试。'
                    : '隔离后账号会保留在本地并停用上游；可从账号探针人工移入。'
                }
              />
              {showTableLoading && (
                <ServerTableLoadingOverlay
                  page={page}
                  itemLabel='账号'
                  message='正在更新隔离筛选结果…'
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={(open) => {
          if (!open && !restorePending) setRestoreOpen(false)
        }}
        title={`恢复 ${selected.length} 个账号的上游？`}
        desc={
          <div className='space-y-2'>
            <p>
              恢复会按隔离前状态重新启用上游，降智/高风险账号回到调度池可能继续被风控。
            </p>
            <p className='text-muted-foreground'>
              这不会删除 grok2api 账号，也不会清除本系统已保存的评估和样本。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          restorePending ? (
            <>
              <Loader2 className='animate-spin' />
              恢复中…
            </>
          ) : (
            <>
              <Undo2 />
              确认恢复上游
            </>
          )
        }
        isLoading={restorePending}
        disabled={selected.length === 0}
        handleConfirm={() => restoreMutation.mutate(selected)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleteOpen(false)
        }}
        title={`删除 ${selected.length} 个账号的本系统记录？`}
        desc={
          <div className='space-y-2'>
            <p>
              只删除 GrokIQ 本地评估/样本/告警，不会删除 grok2api
              账号；上游若仍停用会保持停用。
            </p>
            <p className='font-medium text-foreground'>
              删除后这些账号会离开隔离区列表，本地证据不可恢复。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          deletePending ? (
            <>
              <Loader2 className='animate-spin' />
              删除中…
            </>
          ) : (
            <>
              <Trash2 />
              确认删除本系统记录
            </>
          )
        }
        destructive
        isLoading={deletePending}
        disabled={selected.length === 0}
        handleConfirm={() => deleteMutation.mutate(selected)}
      />
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent size='wide' className='overflow-hidden'>
          <DialogHeader className='shrink-0'>
            <DialogTitle className='flex items-center gap-2'>
              <ShieldBan className='size-5 text-primary' />
              {detailAccount?.name ||
                detailAccount?.email ||
                `账号 ${detailId}`}
            </DialogTitle>
            <DialogDescription>
              {detailAccount
                ? formatAccountSecondaryLabel({
                    id: detailAccount.id,
                    email: detailAccount.email,
                    createdAt: detailAccount.createdAt,
                    accountLabel:
                      detailAccount.name ||
                      detailAccount.email ||
                      `账号 ${detailId}`,
                  })
                : '查看隔离账号的探针样本'}
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain pe-1'>
            {samplesQuery.isLoading && !samplesQuery.data ? (
              <LoadingState />
            ) : (
              <QuarantineSampleDetail
                account={detailAccount}
                samples={samples}
                egressNodeNames={egressNodeNames}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function QuarantineTable({
  accounts,
  selected,
  allChecked,
  onToggleCurrentPage,
  onToggleAccount,
  onOpenSamples,
}: {
  accounts: UpstreamAccount[]
  selected: number[]
  allChecked: boolean
  onToggleCurrentPage: (checked: boolean) => void
  onToggleAccount: (id: number, checked: boolean) => void
  onOpenSamples: (id: number) => void
}) {
  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  return (
    <Table rememberRowKey='monitor-quarantine'>
      <TableHeader>
        <TableRow>
          <TableHead className='w-10'>
            <Checkbox
              checked={allChecked}
              onCheckedChange={(value) => onToggleCurrentPage(value === true)}
              aria-label='选择当前页隔离账号'
            />
          </TableHead>
          <TableHead>账号</TableHead>
          <TableHead>判定</TableHead>
          <TableHead>上游启用状态</TableHead>
          <TableHead>样本数</TableHead>
          <TableHead>最近样本时间</TableHead>
          <TableHead>风险原因</TableHead>
          <TableHead className='text-right'>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => {
          const id = Number(account.id)
          return (
            <QuarantineRow
              key={account.id}
              account={account}
              selected={selectedIdSet.has(id)}
              onSelectedChange={(checked) => onToggleAccount(id, checked)}
              onOpenSamples={() => onOpenSamples(id)}
            />
          )
        })}
      </TableBody>
    </Table>
  )
}

function QuarantineRow({
  account,
  selected,
  onSelectedChange,
  onOpenSamples,
}: {
  account: UpstreamAccount
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onOpenSamples: () => void
}) {
  const id = Number(account.id)
  const assessment = account.assessment
  const accountLabel = account.name || account.email || `账号 ${id}`
  const secondaryAccountLabel = formatAccountSecondaryLabel({
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    accountLabel,
  })
  return (
    <TableRow rowId={id}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onSelectedChange(value === true)}
          aria-label={`选择账号 ${accountLabel}`}
        />
      </TableCell>
      <TableCell>
        <div className='font-medium'>{accountLabel}</div>
        <div
          className='max-w-80 text-xs text-muted-foreground'
          title={secondaryAccountLabel}
        >
          {secondaryAccountLabel}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge value={assessment?.monitor_status} />
      </TableCell>
      <TableCell>
        {account.missingUpstream ? (
          <Badge variant='outline'>上游缺失</Badge>
        ) : (
          <div className='flex items-center gap-2'>
            <span
              className={`size-2 rounded-full ${account.enabled ? 'bg-emerald-500' : 'bg-zinc-400'}`}
            />
            {account.enabled ? '启用' : '停用'}
          </div>
        )}
      </TableCell>
      <TableCell>
        <span className='tabular-nums'>{assessment?.sample_count ?? 0}</span>
      </TableCell>
      <TableCell className='whitespace-nowrap tabular-nums'>
        {formatDate(assessment?.latest_sample_at)}
      </TableCell>
      <TableCell>
        <RiskReasonCell account={account} />
      </TableCell>
      <TableCell className='text-right'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size='icon'
              variant='ghost'
              onClick={onOpenSamples}
              aria-label={`查看 ${accountLabel} 的样本`}
            >
              <Eye />
            </Button>
          </TooltipTrigger>
          <TooltipContent>查看样本</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  )
}

function QuarantineSampleDetail({
  account,
  samples,
  egressNodeNames,
}: {
  account: UpstreamAccount | null
  samples: ProbeSample[]
  egressNodeNames: EgressNodeNameMap
}) {
  const reasons = account?.assessment?.risk_reasons ?? []
  return (
    <div className='space-y-4'>
      {account && (
        <div className='flex flex-wrap items-center gap-2'>
          <StatusBadge value={account.assessment?.monitor_status} />
          {account.missingUpstream ? (
            <Badge variant='outline'>上游缺失</Badge>
          ) : (
            <Badge variant={account.enabled ? 'success' : 'secondary'}>
              上游{account.enabled ? '启用' : '停用'}
            </Badge>
          )}
          <span className='text-xs text-muted-foreground'>
            {account.assessment?.sample_count ?? samples.length} 条样本
          </span>
        </div>
      )}
      {reasons.length > 0 && (
        <div className='rounded-lg border border-amber-500/25 bg-amber-500/5 p-3'>
          <div className='text-sm font-medium text-amber-700 dark:text-amber-300'>
            风险原因
          </div>
          <ul className='mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <AccountSampleExplorer
        key={account?.id ?? 'quarantine-samples'}
        samples={samples}
        egressNodeNames={egressNodeNames}
      />
    </div>
  )
}
