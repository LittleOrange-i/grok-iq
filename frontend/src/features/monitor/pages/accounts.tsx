import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  CircleHelp,
  Eye,
  Filter,
  ListChecks,
  Loader2,
  Network,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatAccountSecondaryLabel } from '@/lib/account-label'
import {
  api,
  type AccountDetailResponse,
  type ProbeSample,
  type UpstreamQuota,
} from '@/lib/api'
import { StatusBadge } from '@/lib/status'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useServerTableLoading } from '@/hooks/use-server-table-loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormattedContentPreviewButton } from '@/components/formatted-content'
import { Page, PageHeader, LoadingState, EmptyState } from '@/components/page'
import { SelectionToolbar } from '@/components/selection-toolbar'
import {
  ServerPagination,
  ServerTableLoadingOverlay,
} from '@/components/server-pagination'
import {
  AuthStatusIndicator,
  EgressBindingIndicator,
} from '@/features/monitor/components/account-state-indicators'
import {
  ACCOUNT_UPSTREAM_STATUS_OPTIONS,
  type UpstreamStatusFilter,
} from '@/features/monitor/components/account-upstream-status'
import {
  buildEgressNodeNameMap,
  getEgressNodeName,
  type EgressNodeNameMap,
} from '@/features/monitor/components/egress-node-names'
import { ProbeDialog } from '@/features/monitor/components/probe-dialog'

type AccountBatchAction = 'enable' | 'disable'
type RecoveryGuardFilter = 'all' | 'true' | 'false'

export function AccountsPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [deferredSearch, searchPending] = useDebouncedValue(search.trim())
  const [status, setStatus] = useState('all')
  const [upstreamStatus, setUpstreamStatus] =
    useState<UpstreamStatusFilter>('all')
  const [recoveryGuarded, setRecoveryGuarded] =
    useState<RecoveryGuardFilter>('all')
  const [selected, setSelected] = useState<number[]>([])
  const [selectedDisabled, setSelectedDisabled] = useState<number[]>([])
  const [allFilteredSelected, setAllFilteredSelected] = useState(false)
  const [probeOpen, setProbeOpen] = useState(false)
  const [batchAction, setBatchAction] = useState<AccountBatchAction | null>(
    null
  )
  const [egressBindingOpen, setEgressBindingOpen] = useState(false)
  const [egressBindingTarget, setEgressBindingTarget] = useState<string>()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [sampleToDelete, setSampleToDelete] = useState<ProbeSample | null>(null)
  const query = useQuery({
    queryKey: [
      'accounts',
      page,
      pageSize,
      deferredSearch,
      status,
      upstreamStatus,
      recoveryGuarded,
    ],
    queryFn: ({ signal }) =>
      api.accounts(
        {
          page,
          pageSize,
          search: deferredSearch,
          monitorStatus: status === 'all' ? '' : status,
          status: upstreamStatus === 'all' ? '' : upstreamStatus,
          recoveryGuarded: recoveryGuarded === 'all' ? '' : recoveryGuarded,
        },
        signal
      ),
    placeholderData: (previous) => previous,
  })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles })
  const egress = useQuery({
    queryKey: ['egress'],
    queryFn: () => api.egress({ pageSize: 500 }),
  })
  const egressNodeNames = useMemo(
    () => buildEgressNodeNameMap(egress.data?.items),
    [egress.data?.items]
  )
  const detail = useQuery({
    queryKey: ['account', detailId],
    queryFn: () => api.account(detailId!),
    enabled: detailOpen && detailId != null,
  })
  const accounts = query.data?.items ?? []
  const selectableAccounts = accounts.filter(
    (item) => !item.authStatus || item.authStatus === 'active'
  )
  const selectedDisabledIdSet = useMemo(
    () => new Set(selectedDisabled),
    [selectedDisabled]
  )
  const selectedEnabledIds = useMemo(
    () => selected.filter((id) => !selectedDisabledIdSet.has(id)),
    [selected, selectedDisabledIdSet]
  )
  const selectedDisabledIds = useMemo(
    () => selected.filter((id) => selectedDisabledIdSet.has(id)),
    [selected, selectedDisabledIdSet]
  )
  const selectedDisabledCount = selectedDisabledIds.length
  const allChecked =
    selectableAccounts.length > 0 &&
    selectableAccounts.every((item) => selected.includes(Number(item.id)))
  const { beginTableInteraction, tableLoading: showTableLoading } =
    useServerTableLoading({
      isFetching: query.isFetching,
      inputPending: searchPending,
    })
  const openAccountDetail = (id: number) => {
    setDetailId(id)
    setDetailOpen(true)
  }

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      api.accountAction(id, { action, propagate: true }),
    onSuccess: () => {
      toast.success('账号状态已更新')
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['account', detailId] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const selectionMutation = useMutation({
    mutationFn: () =>
      api.accountSelection({
        search: deferredSearch,
        monitorStatus: status === 'all' ? '' : status,
        status: upstreamStatus === 'all' ? '' : upstreamStatus,
        recoveryGuarded: recoveryGuarded === 'all' ? '' : recoveryGuarded,
      }),
    onSuccess: (result) => {
      setSelected(result.accountIds)
      setSelectedDisabled(result.disabledAccountIds)
      setAllFilteredSelected(result.selectable > 0)
      if (!result.selectable) {
        toast.warning('当前筛选下没有可检测账号')
        return
      }
      toast.success(
        `已选择全部 ${result.selectable} 个可检测账号${result.excluded ? `，跳过 ${result.excluded} 个鉴权异常账号` : ''}`
      )
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const accountSsoReportMutation = useMutation({
    mutationFn: (accountIds: number[]) => api.createAccountSsoReport(accountIds),
    onSuccess: (result) => {
      const skipped = result.missingAccountIds.length
      const message = `已创建 SSO 检测报告，包含 ${result.included} 个账号`
      if (skipped) {
        toast.warning(`${message}；${skipped} 个账号缺少 SSO，已跳过`)
      } else {
        toast.success(message)
      }
      void client.invalidateQueries({ queryKey: ['sso-reports'] })
      void navigate({ to: '/sso-reports' })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const deleteSampleMutation = useMutation({
    mutationFn: (sample: ProbeSample) => api.deleteSample(sample.id),
    onSuccess: (_result, sample) => {
      setSampleToDelete(null)
      toast.success('样本已删除，相关判定和统计已重新计算')
      void client.invalidateQueries({
        queryKey: ['account', sample.account_id],
      })
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['runs'] })
      void client.invalidateQueries({ queryKey: ['run', sample.run_id] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const batchAccountMutation = useMutation({
    mutationFn: ({
      accountIds,
      enabled,
    }: {
      accountIds: number[]
      enabled: boolean
    }) => api.updateAccountsEnabled(accountIds, enabled),
    onSuccess: (result, variables) => {
      const skippedAccountIds = result.skippedAccountIds ?? []
      const failedAccountIds = result.failedAccountIds ?? []
      const retainedAccountIds = Array.from(
        new Set([...skippedAccountIds, ...failedAccountIds])
      )
      const actionLabel = variables.enabled ? '启用' : '停用'
      setBatchAction(null)
      setSelected(retainedAccountIds)
      setSelectedDisabled(variables.enabled ? retainedAccountIds : [])
      setAllFilteredSelected(false)
      if (failedAccountIds.length > 0 || skippedAccountIds.length > 0) {
        const details = [`已${actionLabel} ${result.updated} 个账号`]
        if (failedAccountIds.length) {
          details.push(`${failedAccountIds.length} 个更新失败并保留选择`)
        }
        if (skippedAccountIds.length) {
          details.push(`${skippedAccountIds.length} 个设置受任务保护并跳过`)
        }
        toast.warning(details.join('；'))
      } else if (result.updated !== result.eligible) {
        toast.warning(
          `批量${actionLabel}完成：上游更新 ${result.updated} / ${result.eligible} 个账号`
        )
      } else {
        toast.success(`已${actionLabel} ${result.updated} 个账号`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const deleteAccountsMutation = useMutation({
    mutationFn: (accountIds: number[]) => api.deleteAccounts(accountIds),
    onSuccess: (result) => {
      const skippedAccountIds = result.skippedAccountIds ?? []
      const failedAccountIds = result.failedAccountIds ?? []
      const retainedAccountIds = Array.from(
        new Set([...skippedAccountIds, ...failedAccountIds])
      )
      setDeleteConfirmOpen(false)
      setSelected(retainedAccountIds)
      setSelectedDisabled(
        selectedDisabledIds.filter((id) => retainedAccountIds.includes(id))
      )
      setAllFilteredSelected(false)
      if (failedAccountIds.length > 0 || skippedAccountIds.length > 0) {
        const details = [`已删除 ${result.deleted} 个账号`]
        if (failedAccountIds.length) {
          details.push(`${failedAccountIds.length} 个删除失败并保留选择`)
        }
        if (skippedAccountIds.length) {
          details.push(`${skippedAccountIds.length} 个设置受任务保护并跳过`)
        }
        toast.warning(details.join('；'))
      } else {
        toast.success(`已删除 ${result.deleted} 个账号`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const egressBindingMutation = useMutation({
    mutationFn: ({
      accountIds,
      egressNodeId,
    }: {
      accountIds: number[]
      egressNodeId: number | null
    }) => api.updateAccountsEgress(accountIds, egressNodeId),
    onSuccess: (result, variables) => {
      const skippedAccountIds = result.skippedAccountIds ?? []
      const failedAccountIds = result.failedAccountIds ?? []
      const retainedAccountIds = Array.from(
        new Set([...skippedAccountIds, ...failedAccountIds])
      )
      const actionLabel = variables.egressNodeId == null ? '解绑' : '绑定'
      setEgressBindingOpen(false)
      setEgressBindingTarget(undefined)
      setSelected(retainedAccountIds)
      setSelectedDisabled(
        selectedDisabledIds.filter((id) => retainedAccountIds.includes(id))
      )
      setAllFilteredSelected(false)
      if (failedAccountIds.length > 0 || skippedAccountIds.length > 0) {
        const details = [`已${actionLabel} ${result.updated} 个账号`]
        if (failedAccountIds.length) {
          details.push(`${failedAccountIds.length} 个操作失败并保留选择`)
        }
        if (skippedAccountIds.length) {
          details.push(`${skippedAccountIds.length} 个设置受任务保护并跳过`)
        }
        toast.warning(details.join('；'))
      } else {
        toast.success(`已${actionLabel} ${result.updated} 个账号出口`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['account'] })
      void client.invalidateQueries({ queryKey: ['plan-account-options'] })
      void client.invalidateQueries({ queryKey: ['egress'] })
    },
  })

  const batchTargetIds =
    batchAction === 'enable'
      ? selectedDisabledIds
      : batchAction === 'disable'
        ? selectedEnabledIds
        : []
  const batchActionLabel = batchAction === 'enable' ? '启用' : '停用'
  const batchActionPending = batchAccountMutation.isPending
  const egressBindingPending = egressBindingMutation.isPending
  const deletePending = deleteAccountsMutation.isPending
  const ssoReportPending = accountSsoReportMutation.isPending
  const selectionActionPending =
    batchActionPending || egressBindingPending || deletePending || ssoReportPending
  const bindableEgress = (egress.data?.items ?? []).filter(
    (node) => node.enabled && node.proxyConfigured
  )

  return (
    <Page>
      <PageHeader
        title='账号探针'
        description='账号列表实时来自 grok2api；本地叠加风险判定，并保存注册机联动提供的 SSO 用于检测。'
        descriptionAsHint
        actions={
          <>
            <ActionToolbar label='账号列表操作'>
              <ToolbarAction
                label='刷新上游账号'
                pending={query.isFetching}
                onClick={() => void query.refetch()}
              >
                <RefreshCw />
              </ToolbarAction>
              <ToolbarAction
                label={
                  allFilteredSelected
                    ? '清除当前筛选的全选'
                    : '全选当前筛选下的所有可检测账号'
                }
                active={allFilteredSelected}
                pending={selectionMutation.isPending}
                disabled={showTableLoading || (query.data?.total ?? 0) === 0}
                onClick={() => {
                  if (allFilteredSelected) {
                    setSelected([])
                    setSelectedDisabled([])
                    setAllFilteredSelected(false)
                    toast.success('已清除当前筛选的全选')
                    return
                  }
                  selectionMutation.mutate()
                }}
              >
                <ListChecks />
              </ToolbarAction>
            </ActionToolbar>
            <SelectionToolbar
              selectedCount={selected.length}
              entityLabel='账号'
              disabled={selectionActionPending}
              onClear={() => {
                setSelected([])
                setSelectedDisabled([])
                setAllFilteredSelected(false)
              }}
            >
              <ToolbarAction
                label={`测试已选 ${selected.length} 个账号`}
                disabled={selectionActionPending}
                onClick={() => {
                  setProbeOpen(true)
                  void egress.refetch()
                }}
              >
                <Play />
              </ToolbarAction>
              <ToolbarAction
                label={`检测已选 ${selected.length} 个账号的 SSO`}
                pending={ssoReportPending}
                disabled={selectionActionPending || selected.length === 0}
                onClick={() => accountSsoReportMutation.mutate(selected)}
              >
                <ScanSearch />
              </ToolbarAction>
              <ToolbarAction
                label={`批量设置 ${selected.length} 个已选账号的出口`}
                pending={egressBindingPending}
                disabled={selectionActionPending || selected.length === 0}
                onClick={() => {
                  setEgressBindingTarget(undefined)
                  setEgressBindingOpen(true)
                  void egress.refetch()
                }}
              >
                <Network />
              </ToolbarAction>
              <ToolbarAction
                label={
                  selectedDisabledIds.length
                    ? `批量启用 ${selectedDisabledIds.length} 个已选账号`
                    : '已选账号均处于启用状态'
                }
                pending={batchActionPending && batchAction === 'enable'}
                disabled={
                  selectionActionPending || selectedDisabledIds.length === 0
                }
                onClick={() => setBatchAction('enable')}
              >
                <Power />
              </ToolbarAction>
              <ToolbarAction
                label={
                  selectedEnabledIds.length
                    ? `批量停用 ${selectedEnabledIds.length} 个已选账号`
                    : '已选账号均处于停用状态'
                }
                destructive
                pending={batchActionPending && batchAction === 'disable'}
                disabled={
                  selectionActionPending || selectedEnabledIds.length === 0
                }
                onClick={() => setBatchAction('disable')}
              >
                <PowerOff />
              </ToolbarAction>
              <ToolbarAction
                label={`批量删除 ${selected.length} 个已选账号`}
                destructive
                pending={deletePending}
                disabled={selectionActionPending || selected.length === 0}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 />
              </ToolbarAction>
            </SelectionToolbar>
          </>
        }
      />
      <Card>
        <CardContent className='p-4'>
          <div
            className='mb-4 flex flex-col gap-3 md:flex-row'
            aria-busy={showTableLoading}
          >
            <div className='relative flex-1'>
              <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={search}
                onChange={(event) => {
                  beginTableInteraction()
                  setSearch(event.target.value)
                  setPage(1)
                  setSelected([])
                  setSelectedDisabled([])
                  setAllFilteredSelected(false)
                }}
                placeholder='搜索名称、邮箱或账号 ID'
                className='pr-9 pl-9'
              />
              {showTableLoading && (
                <Loader2 className='absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary' />
              )}
            </div>
            <Select
              value={status}
              onValueChange={(value) => {
                beginTableInteraction()
                setStatus(value)
                setPage(1)
                setSelected([])
                setSelectedDisabled([])
                setAllFilteredSelected(false)
              }}
            >
              <SelectTrigger className='w-full md:w-44'>
                <Filter className='size-4 text-muted-foreground' />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部判定</SelectItem>
                <SelectItem value='healthy'>正常</SelectItem>
                <SelectItem value='watch'>观察</SelectItem>
                <SelectItem value='suspect'>疑似降智</SelectItem>
                <SelectItem value='high_risk'>高风险</SelectItem>
                <SelectItem value='quarantined'>已停用</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={upstreamStatus}
              onValueChange={(value) => {
                beginTableInteraction()
                setUpstreamStatus(value as UpstreamStatusFilter)
                setPage(1)
                setSelected([])
                setSelectedDisabled([])
                setAllFilteredSelected(false)
              }}
            >
              <SelectTrigger className='w-full md:w-44'>
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
            <Select
              value={recoveryGuarded}
              onValueChange={(value) => {
                beginTableInteraction()
                setRecoveryGuarded(value as RecoveryGuardFilter)
                setPage(1)
                setSelected([])
                setSelectedDisabled([])
                setAllFilteredSelected(false)
              }}
            >
              <SelectTrigger className='w-full md:w-44'>
                <ShieldCheck className='size-4 text-muted-foreground' />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部恢复状态</SelectItem>
                <SelectItem value='true'>恢复保护</SelectItem>
                <SelectItem value='false'>未标记</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {query.isLoading && !query.data ? (
            <LoadingState />
          ) : accounts.length ? (
            <>
              <div className='relative min-h-40' aria-busy={showTableLoading}>
                <Table rememberRowKey='monitor-accounts'>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-10'>
                        <Checkbox
                          checked={allChecked}
                          onCheckedChange={(value) => {
                            const checked = value === true
                            setAllFilteredSelected(false)
                            setSelected(
                              checked
                                ? Array.from(
                                    new Set([
                                      ...selected,
                                      ...selectableAccounts.map((item) =>
                                        Number(item.id)
                                      ),
                                    ])
                                  )
                                : selected.filter(
                                    (id) =>
                                      !selectableAccounts.some(
                                        (item) => Number(item.id) === id
                                      )
                                  )
                            )
                            const disabledIds = selectableAccounts
                              .filter((item) => !item.enabled)
                              .map((item) => Number(item.id))
                            setSelectedDisabled((current) =>
                              checked
                                ? Array.from(
                                    new Set([...current, ...disabledIds])
                                  )
                                : current.filter(
                                    (id) =>
                                      !selectableAccounts.some(
                                        (item) => Number(item.id) === id
                                      )
                                  )
                            )
                          }}
                          aria-label='选择当前页可检测账号'
                        />
                      </TableHead>
                      <TableHead>账号</TableHead>
                      <TableHead>上游状态</TableHead>
                      <TableHead>监控判定</TableHead>
                      <TableHead>周期样本 / 信号</TableHead>
                      <TableHead>TPS</TableHead>
                      <TableHead className='w-24'>额度</TableHead>
                      <TableHead>出口绑定</TableHead>
                      <TableHead className='text-right'>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => {
                      const id = Number(account.id)
                      const assessment = account.assessment
                      const accountLabel =
                        account.name || account.email || `账号 ${id}`
                      const secondaryAccountLabel = formatAccountSecondaryLabel(
                        {
                          id: account.id,
                          email: account.email,
                          createdAt: account.createdAt,
                          accountLabel,
                        }
                      )
                      return (
                        <TableRow key={account.id} rowId={id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.includes(id)}
                              disabled={
                                Boolean(account.authStatus) &&
                                account.authStatus !== 'active'
                              }
                              onCheckedChange={(value) => {
                                const checked = value === true
                                setAllFilteredSelected(false)
                                setSelected((current) =>
                                  checked
                                    ? [...new Set([...current, id])]
                                    : current.filter((item) => item !== id)
                                )
                                setSelectedDisabled((current) =>
                                  checked && !account.enabled
                                    ? [...new Set([...current, id])]
                                    : current.filter((item) => item !== id)
                                )
                              }}
                              aria-label={`选择账号 ${account.name}`}
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
                            <div className='flex items-center gap-2'>
                              <span
                                className={`size-2 rounded-full ${account.enabled ? 'bg-emerald-500' : 'bg-zinc-400'}`}
                              />
                              {account.enabled ? '启用' : '停用'}
                              <AuthStatusIndicator
                                status={account.authStatus}
                              />
                              {assessment.recovery_guarded && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant='outline'
                                      className='gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                    >
                                      <ShieldCheck className='size-3' />
                                      恢复保护
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className='max-w-72'>
                                    隔离到期后由系统恢复，恢复时已降至最低优先级；当前优先级为{' '}
                                    {account.priority ?? '未知'}。
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {!account.enabled && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className='inline-flex size-6 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                      tabIndex={0}
                                      aria-label='探针诊断激活'
                                    >
                                      <RefreshCw className='size-3.5' />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className='max-w-72'>
                                    探针请求前短时激活，单次请求后及任务结束时恢复原设置。
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className='flex items-center gap-2 whitespace-nowrap'>
                              <StatusBadge value={assessment.monitor_status} />
                              <span className='text-xs text-muted-foreground tabular-nums'>
                                {formatNumber(assessment.risk_score)} 分
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className='tabular-nums'>
                              {assessment.sample_count ?? 0}
                            </span>
                            <span className='mx-1 text-muted-foreground'>
                              /
                            </span>
                            <span className='text-amber-600 tabular-nums'>
                              {assessment.anomaly_count ?? 0}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className='tabular-nums'>
                              {formatNumber(assessment.latest_tps)}
                            </div>
                            <div className='text-xs text-muted-foreground'>
                              max {formatNumber(assessment.max_tps)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <QuotaRemainingIndicator quota={account.quota} />
                          </TableCell>
                          <TableCell>
                            <EgressBindingIndicator
                              nodeId={account.egressNodeId}
                              nodeName={getEgressNodeName(
                                egressNodeNames,
                                account.egressNodeId
                              )}
                              assignmentMode={account.egressAssignmentMode}
                            />
                          </TableCell>
                          <TableCell className='text-right'>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  onClick={() => openAccountDetail(id)}
                                  aria-label='查看账号详情'
                                >
                                  <Eye />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>查看详情</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {showTableLoading && (
                  <ServerTableLoadingOverlay
                    page={page}
                    itemLabel='账号'
                    message='正在更新账号筛选结果…'
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
                  setPage(value)
                }}
                onPageSizeChange={(value) => {
                  beginTableInteraction()
                  setPageSize(value)
                  setPage(1)
                }}
              />
            </>
          ) : (
            <div className='relative min-h-48' aria-busy={showTableLoading}>
              <EmptyState
                title='未找到账号'
                description='请检查 grok2api 管理 API 配置或调整筛选条件。'
              />
              {showTableLoading && (
                <ServerTableLoadingOverlay
                  page={page}
                  itemLabel='账号'
                  message='正在更新账号筛选结果…'
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ProbeDialog
        open={probeOpen}
        onOpenChange={setProbeOpen}
        accountIds={selected}
        disabledAccountCount={selectedDisabledCount}
        profiles={profiles.data ?? []}
        egress={egress.data?.items ?? []}
        egressLoading={egress.isFetching}
        egressError={egress.isError ? getErrorMessage(egress.error) : ''}
        onRefreshEgress={() => void egress.refetch()}
        onCreated={() => {
          setSelected([])
          setSelectedDisabled([])
          setAllFilteredSelected(false)
          void client.invalidateQueries({ queryKey: ['runs'] })
        }}
      />
      <Dialog
        open={egressBindingOpen}
        onOpenChange={(open) => {
          if (egressBindingPending) return
          setEgressBindingOpen(open)
          if (!open) setEgressBindingTarget(undefined)
        }}
      >
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>批量设置账号出口</DialogTitle>
            <DialogDescription>
              为已选 {selected.length} 个账号设置固定出口，或解除现有绑定。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <Select
              value={egressBindingTarget}
              onValueChange={setEgressBindingTarget}
              disabled={egressBindingPending || egress.isFetching}
            >
              <SelectTrigger className='w-full'>
                <SelectValue
                  placeholder={
                    egress.isFetching ? '正在读取出口…' : '选择出口操作'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {bindableEgress.map((node) => (
                  <SelectItem key={node.id} value={`node:${node.id}`}>
                    {node.name} · {node.assignedAccountCount ?? 0}
                    {node.accountCapacity
                      ? ` / ${node.accountCapacity}`
                      : ' / 不限容量'}
                    {node.probeStatus && node.probeStatus !== 'healthy'
                      ? ` · ${node.probeStatus}`
                      : ''}
                  </SelectItem>
                ))}
                <SelectItem value='unbound'>解除出口绑定</SelectItem>
              </SelectContent>
            </Select>
            {!egress.isFetching && !bindableEgress.length && (
              <p className='text-sm text-amber-600 dark:text-amber-400'>
                当前没有已启用且配置了代理的 grok_build 出口；仍可选择解除绑定。
              </p>
            )}
            <div className='rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground'>
              绑定操作写入 manual，后续 grok2api
              自动均衡不会迁移这些账号。正在执行探针或等待设置恢复的账号会跳过并保留选择。
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={egressBindingPending}
              onClick={() => setEgressBindingOpen(false)}
            >
              取消
            </Button>
            <Button
              type='button'
              disabled={!egressBindingTarget || egressBindingPending}
              onClick={() => {
                const nodeId = egressBindingTarget?.startsWith('node:')
                  ? Number(egressBindingTarget.slice(5))
                  : null
                egressBindingMutation.mutate({
                  accountIds: selected,
                  egressNodeId: nodeId,
                })
              }}
            >
              {egressBindingPending ? (
                <Loader2 className='animate-spin' />
              ) : (
                <Network />
              )}
              确认设置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={batchAction != null}
        onOpenChange={(open) => {
          if (!open && !batchActionPending) setBatchAction(null)
        }}
        title={`${batchActionLabel} ${batchTargetIds.length} 个账号？`}
        desc={
          <div className='space-y-2'>
            <p>
              将通过 grok2api 批量接口{batchActionLabel}当前选择中的
              {batchAction === 'enable' ? '停用' : '启用'}账号；
              {batchAction === 'enable'
                ? '启用后，这些账号会重新参与上游正常调度。'
                : '停用后，这些账号不再参与上游正常调度。'}
            </p>
            {(batchAction === 'enable'
              ? selectedEnabledIds.length
              : selectedDisabledCount) > 0 && (
              <p className='text-muted-foreground'>
                另外{' '}
                {batchAction === 'enable'
                  ? selectedEnabledIds.length
                  : selectedDisabledCount}{' '}
                个已{batchAction === 'enable' ? '启用' : '停用'}账号会自动跳过。
              </p>
            )}
            <p className='text-muted-foreground'>
              探针样本、历史任务和本地监控判定保持不变。
            </p>
            {batchAction === 'disable' && (
              <p className='font-medium text-foreground'>
                这是人工长期停用，不使用系统设置中的“停用时长”，也不会被隔离恢复任务自动启用。
              </p>
            )}
            <p className='text-muted-foreground'>
              正在执行探针或等待账号设置恢复的账号会被跳过并保留选择，避免任务结束时的设置恢复覆盖本次
              {batchActionLabel}。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          batchActionPending ? (
            <>
              <Loader2 className='animate-spin' />
              {batchActionLabel}中…
            </>
          ) : (
            <>
              {batchAction === 'enable' ? <Power /> : <PowerOff />}
              确认{batchActionLabel}
            </>
          )
        }
        destructive={batchAction === 'disable'}
        isLoading={batchActionPending}
        disabled={batchTargetIds.length === 0}
        handleConfirm={() =>
          batchAccountMutation.mutate({
            accountIds: batchTargetIds,
            enabled: batchAction === 'enable',
          })
        }
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleteConfirmOpen(false)
        }}
        title={`删除 ${selected.length} 个账号？`}
        desc={
          <div className='space-y-2'>
            <p>
              将通过 grok2api API 永久删除当前选择的 {selected.length}{' '}
              个账号，此操作不可撤销。
            </p>
            <p className='font-medium text-foreground'>
              账号删除后无法通过本页面恢复，请谨慎操作。
            </p>
            <p className='text-muted-foreground'>
              正在执行探针或等待账号设置恢复的账号会被跳过并保留选择，避免删除正在使用的账号。
            </p>
            <p className='text-muted-foreground'>
              已产生的探针样本、历史任务和本地监控判定不会随账号删除。
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
              确认删除
            </>
          )
        }
        destructive
        isLoading={deletePending}
        disabled={selected.length === 0}
        handleConfirm={() => deleteAccountsMutation.mutate(selected)}
      />
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent size='wide' className='overflow-hidden'>
          <DialogHeader className='shrink-0'>
            <DialogTitle className='flex items-center gap-2'>
              <UsersRound className='size-5 text-primary' />
              {detail.data?.account?.name || `账号 ${detailId}`}
            </DialogTitle>
            <DialogDescription>
              {detail.data?.account
                ? formatAccountSecondaryLabel({
                    id: detail.data.account.id,
                    email: detail.data.account.email,
                    createdAt: detail.data.account.createdAt,
                    accountLabel:
                      detail.data.account.name ||
                      detail.data.account.email ||
                      `账号 ${detailId}`,
                  })
                : '账号探针详情'}
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain pe-1'>
            {detail.isLoading ? (
              <LoadingState />
            ) : (
              detail.data && (
                <AccountDetail
                  key={detail.data.account.id}
                  data={detail.data}
                  egressNodeNames={egressNodeNames}
                  deletingSampleId={
                    deleteSampleMutation.isPending
                      ? (sampleToDelete?.id ?? null)
                      : null
                  }
                  onDeleteSample={setSampleToDelete}
                />
              )
            )}
          </div>
          <div className='shrink-0 border-t pt-3'>
            <p className='text-xs leading-5 text-muted-foreground'>
              “暂时停用”使用系统设置中的停用时长；到期后系统自动启用账号、降至最低优先级，并标记为“恢复保护”。
            </p>
            <DialogFooter className='mt-3'>
              <Button
                variant='outline'
                disabled={actionMutation.isPending}
                onClick={() =>
                  detailId &&
                  actionMutation.mutate({ id: detailId, action: 'restore' })
                }
              >
                <Undo2 />
                立即恢复
              </Button>
              <Button
                variant='destructive'
                disabled={actionMutation.isPending}
                onClick={() =>
                  detailId &&
                  actionMutation.mutate({ id: detailId, action: 'quarantine' })
                }
              >
                <ShieldAlert />
                暂时停用
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={sampleToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteSampleMutation.isPending) {
            setSampleToDelete(null)
          }
        }}
        title='删除这条探针样本？'
        desc={
          <div className='space-y-2'>
            {sampleToDelete && (
              <div className='rounded-md border bg-muted/40 px-3 py-2 text-foreground'>
                <div className='font-medium break-all'>
                  {sampleTargetText(sampleToDelete, egressNodeNames)}
                </div>
                <div className='mt-1 text-xs text-muted-foreground'>
                  第 {sampleToDelete.round_number} 轮 ·{' '}
                  {formatDate(sampleToDelete.created_at)}
                </div>
              </div>
            )}
            <p>该样本会被永久删除，并重新计算账号判定与所属任务的样本统计。</p>
            <p className='text-muted-foreground'>
              此操作只删除本地监控证据，不会修改上游账号。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          deleteSampleMutation.isPending ? (
            <>
              <Loader2 className='animate-spin' />
              删除中…
            </>
          ) : (
            <>
              <Trash2 />
              删除样本
            </>
          )
        }
        destructive
        isLoading={deleteSampleMutation.isPending}
        handleConfirm={() => {
          if (sampleToDelete) deleteSampleMutation.mutate(sampleToDelete)
        }}
      />
    </Page>
  )
}

function AccountDetail({
  data,
  egressNodeNames,
  deletingSampleId,
  onDeleteSample,
}: {
  data: AccountDetailResponse
  egressNodeNames: EgressNodeNameMap
  deletingSampleId: string | null
  onDeleteSample: (sample: ProbeSample) => void
}) {
  const account = data.account
  const assessment = account.assessment
  const history = data.history
  const reasons: string[] = assessment.risk_reasons ?? []
  const byTarget = history.byTarget ?? []
  return (
    <div className='space-y-5'>
      <div className='grid gap-3 sm:grid-cols-3 lg:grid-cols-6'>
        <Metric label='上游' value={account.enabled ? '启用' : '停用'} />
        <Metric
          label='鉴权'
          value={<AuthStatusIndicator status={account.authStatus} />}
        />
        <Metric
          label='出口绑定'
          value={
            <EgressBindingIndicator
              nodeId={account.egressNodeId}
              nodeName={getEgressNodeName(
                egressNodeNames,
                account.egressNodeId
              )}
              assignmentMode={account.egressAssignmentMode}
              compact
            />
          }
        />
        <Metric
          label='判定'
          value={<StatusBadge value={assessment.monitor_status} />}
        />
        <Metric
          label='恢复保护'
          value={assessment.recovery_guarded ? '已标记' : '未标记'}
        />
        <Metric label='风险分' value={formatNumber(assessment.risk_score)} />
        <Metric
          label='周期样本 / 信号'
          value={`${assessment.sample_count ?? 0} / ${assessment.anomaly_count ?? 0}`}
        />
        <Metric
          label='最后样本'
          value={formatDate(assessment.latest_sample_at)}
        />
      </div>
      {reasons.length > 0 && (
        <div className='rounded-lg border border-amber-500/25 bg-amber-500/5 p-3'>
          <div className='text-sm font-medium text-amber-700 dark:text-amber-300'>
            判定依据
          </div>
          <ul className='mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className='mb-2 text-sm font-semibold'>出口对比</h3>
        <div className='grid gap-2 sm:grid-cols-2'>
          {byTarget.map((item) => (
            <div key={item.target_key} className='rounded-lg border p-3'>
              <div className='grid min-w-0 gap-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
                <span
                  className='min-w-0 leading-5 font-medium break-all'
                  title={
                    item.target_kind === 'current'
                      ? '账号当前出口'
                      : item.target_kind === 'direct'
                        ? '上游调度（诊断）'
                        : item.egress_name
                  }
                >
                  {item.target_kind === 'current'
                    ? '账号当前出口'
                    : item.target_kind === 'direct'
                      ? '上游调度（诊断）'
                      : item.egress_name}
                </span>
                <span className='whitespace-nowrap tabular-nums sm:text-right'>
                  {formatNumber(item.max_tps)} TPS max
                </span>
              </div>
              <div className='mt-1 text-xs text-muted-foreground'>
                {item.samples} 个样本 · {item.anomalies ?? 0} 个降智信号 · 平均{' '}
                {formatNumber(item.avg_tps)} TPS
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className='mb-2 text-sm font-semibold'>最近样本</h3>
        <RecentSamplesPanel
          samples={history.samples.slice(0, 30)}
          egressNodeNames={egressNodeNames}
          deletingSampleId={deletingSampleId}
          onDeleteSample={onDeleteSample}
        />
      </div>
    </div>
  )
}

function RecentSamplesPanel({
  samples,
  egressNodeNames,
  deletingSampleId,
  onDeleteSample,
}: {
  samples: ProbeSample[]
  egressNodeNames: EgressNodeNameMap
  deletingSampleId: string | null
  onDeleteSample: (sample: ProbeSample) => void
}) {
  const [selectedId, setSelectedId] = useState(samples[0]?.id ?? '')
  const selected =
    samples.find((sample) => sample.id === selectedId) ?? samples[0]
  if (!selected) {
    return (
      <div className='rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground'>
        暂无探针样本
      </div>
    )
  }
  return (
    <div className='grid min-h-0 overflow-hidden rounded-xl border bg-muted/10 lg:grid-cols-[21rem_minmax(0,1fr)]'>
      <div className='border-b bg-background lg:border-e lg:border-b-0'>
        <div className='flex items-center justify-between border-b px-3 py-2.5'>
          <span className='text-sm font-medium'>选择样本</span>
          <Badge variant='secondary'>{samples.length} 条</Badge>
        </div>
        <div className='max-h-64 space-y-1 overflow-y-auto p-2 lg:max-h-[38rem]'>
          {samples.map((sample) => {
            const active = sample.id === selected.id
            const target = sampleTargetText(sample, egressNodeNames)
            return (
              <button
                key={sample.id}
                type='button'
                aria-pressed={active}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  active
                    ? 'border-primary/45 bg-primary/5'
                    : 'border-transparent hover:border-border hover:bg-muted/40'
                )}
                onClick={() => setSelectedId(sample.id)}
              >
                <div className='flex items-center justify-between gap-2'>
                  <StatusBadge value={sample.classification} />
                  <span className='shrink-0 text-xs text-muted-foreground'>
                    {formatDate(sample.created_at)}
                  </span>
                </div>
                <div
                  className='mt-2 truncate text-sm font-medium'
                  title={target}
                >
                  {target}
                </div>
                <div className='mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums'>
                  <SampleListMetric
                    label='TPS'
                    value={formatNumber(sample.tps)}
                  />
                  <SampleListMetric
                    label='首 Token'
                    value={`${sample.first_token_ms} ms`}
                  />
                  <SampleListMetric
                    label='输出'
                    value={formatNumber(sample.output_tokens, 0)}
                  />
                </div>
                {sample.error_code && (
                  <div className='mt-2 truncate font-mono text-xs text-destructive'>
                    {sample.error_code}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <SampleDetail
        sample={selected}
        egressNodeNames={egressNodeNames}
        deleting={deletingSampleId === selected.id}
        onDelete={() => onDeleteSample(selected)}
      />
    </div>
  )
}

function SampleDetail({
  sample,
  egressNodeNames,
  deleting,
  onDelete,
}: {
  sample: ProbeSample
  egressNodeNames: EgressNodeNameMap
  deleting: boolean
  onDelete: () => void
}) {
  const responseText = sample.response_text || ''
  return (
    <div className='min-w-0 bg-background'>
      <div className='flex flex-wrap items-start gap-2 border-b px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <div className='text-sm font-semibold break-all'>
            {sampleTargetText(sample, egressNodeNames)}
          </div>
          <div className='mt-1 text-xs text-muted-foreground'>
            第 {sample.round_number} 轮 · {formatDate(sample.created_at)}
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <StatusBadge value={sample.classification} />
          {sample.error_code && (
            <Badge variant='outline' className='font-mono'>
              {sample.error_code}
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                disabled={deleting}
                onClick={onDelete}
                aria-label='删除当前样本'
              >
                {deleting ? <Loader2 className='animate-spin' /> : <Trash2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>删除样本</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className='space-y-4 p-4'>
        <div className='grid gap-2 sm:grid-cols-3 xl:grid-cols-6'>
          <SampleFact label='TPS' value={formatNumber(sample.tps)} />
          <SampleFact label='首 Token' value={`${sample.first_token_ms} ms`} />
          <SampleFact label='总耗时' value={`${sample.duration_ms} ms`} />
          <SampleFact label='生成窗口' value={`${sample.generation_ms} ms`} />
          <SampleFact label='输出 Token' value={sample.output_tokens} />
          <SampleFact
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
        <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
          <SampleEvidence label='HTTP' value={sample.status_code || '—'} />
          <SampleEvidence label='Request ID' value={sample.request_id} />
          <SampleEvidence label='响应哈希' value={sample.response_sha256} />
          <SampleEvidence label='核验账号' value={sample.verified_account_id} />
          <SampleEvidence
            label='目标出口'
            value={
              sample.egress_node_id
                ? getEgressNodeName(egressNodeNames, sample.egress_node_id) ||
                  `Node ${sample.egress_node_id}`
                : sample.target_kind === 'direct'
                  ? '上游调度（诊断）'
                  : sample.egress_name
            }
          />
          <SampleEvidence
            label='实际出口'
            value={
              sample.verified_egress_node_id
                ? getEgressNodeName(
                    egressNodeNames,
                    sample.verified_egress_node_id
                  ) || `Node ${sample.verified_egress_node_id}`
                : sample.target_kind === 'direct'
                  ? '本地出口'
                  : '未核验'
            }
          />
          <SampleEvidence label='审计 ID' value={sample.audit_id} />
          <SampleEvidence
            label='重试'
            value={sample.retry_count ? `${sample.retry_count} 次` : '0 次'}
          />
        </div>
        {sample.error && (
          <div className='rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm break-words whitespace-pre-wrap text-destructive'>
            {sample.error}
          </div>
        )}
        {responseText ? (
          <div className='flex items-center justify-between gap-3 rounded-lg border bg-muted/15 px-3 py-2.5'>
            <div className='min-w-0'>
              <div className='text-sm font-medium'>响应内容</div>
              <div className='text-xs text-muted-foreground'>
                正文已收起 · {formatNumber(responseText.length, 0)} 个字符
              </div>
            </div>
            <FormattedContentPreviewButton
              content={responseText}
              label='预览响应'
              title={`样本响应 · 第 ${sample.round_number} 轮`}
              className='shrink-0'
            />
          </div>
        ) : (
          <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
            此样本未保存响应正文，可通过请求 ID、响应哈希和审计核验字段定位。
          </div>
        )}
      </div>
    </div>
  )
}

function QuotaRemainingIndicator({ quota }: { quota?: UpstreamQuota }) {
  if (!quota || quota.type === 'unknown') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className='inline-flex h-7 w-20 items-center gap-1.5 text-xs text-muted-foreground'
            tabIndex={0}
            aria-label='额度尚未同步'
          >
            <CircleHelp className='size-4 shrink-0' />
            待同步
          </span>
        </TooltipTrigger>
        <TooltipContent>grok2api 尚未提供可用的额度数据。</TooltipContent>
      </Tooltip>
    )
  }

  const usagePercent = Math.min(100, Math.max(0, quota.usagePercent || 0))
  const hasQuotaRange =
    quota.limitKnown ||
    quota.limit > 0 ||
    quota.unit === 'percent' ||
    quota.status !== 'active'

  if (!hasQuotaRange) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className='inline-flex h-7 w-20 items-center gap-1.5 text-xs text-muted-foreground'
            tabIndex={0}
            aria-label='额度总量未知'
          >
            <CircleHelp className='size-4 shrink-0' />
            未估算
          </span>
        </TooltipTrigger>
        <TooltipContent className='max-w-72'>
          已观测使用 {formatQuotaAmount(quota.used, quota.unit)}
          ，但上游未提供额度总量。
        </TooltipContent>
      </Tooltip>
    )
  }

  const remainingPercent =
    quota.status === 'waitingReset' ? 0 : Math.max(0, 100 - usagePercent)
  const approximate = !quota.limitKnown && quota.type === 'free'
  const displayValue = `${approximate ? '≈' : ''}${formatNumber(remainingPercent, 0)}%`
  const Icon =
    remainingPercent <= 0
      ? BatteryWarning
      : remainingPercent <= 25
        ? BatteryLow
        : remainingPercent <= 60
          ? BatteryMedium
          : BatteryFull
  const tone =
    remainingPercent <= 0
      ? 'text-destructive'
      : remainingPercent <= 25
        ? 'text-amber-600 dark:text-amber-400'
        : remainingPercent <= 60
          ? 'text-sky-600 dark:text-sky-400'
          : 'text-emerald-600 dark:text-emerald-400'
  const recoveryAt = quota.nextProbeAt || quota.periodEnd

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex h-7 w-20 items-center gap-1.5 text-xs font-medium tabular-nums',
            tone
          )}
          tabIndex={0}
          aria-label={`额度剩余 ${displayValue}`}
        >
          <Icon className='size-4 shrink-0' />
          {displayValue}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-72 space-y-1'>
        <div>额度剩余 {displayValue}</div>
        {quota.limit > 0 && quota.unit !== 'percent' && (
          <div className='text-muted-foreground'>
            {approximate ? '估算剩余' : '剩余'}{' '}
            {formatQuotaAmount(quota.remaining, quota.unit)} / 总量{' '}
            {formatQuotaAmount(quota.limit, quota.unit)}
          </div>
        )}
        <div className='text-muted-foreground'>
          已使用 {formatNumber(usagePercent)}%
          {quota.confirmed
            ? ' · 上游确认'
            : quota.observed
              ? ' · 本地观测'
              : approximate
                ? ' · 估算'
                : ''}
        </div>
        {recoveryAt && (
          <div className='text-muted-foreground'>
            {quota.status === 'waitingReset' ? '预计恢复' : '周期结束'}{' '}
            {formatDate(recoveryAt)}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function formatQuotaAmount(value: number, unit: UpstreamQuota['unit']): string {
  const digits = unit === 'credits' ? 2 : 0
  const suffix =
    unit === 'credits' ? ' credits' : unit === 'tokens' ? ' Token' : ''
  return `${formatNumber(value, digits)}${suffix}`
}

function SampleListMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <div className='truncate text-[10px] text-muted-foreground'>{label}</div>
      <div className='truncate font-medium' title={value}>
        {value}
      </div>
    </div>
  )
}

function sampleTargetText(
  sample: ProbeSample,
  egressNodeNames: EgressNodeNameMap
): string {
  if (sample.target_kind === 'current') {
    const node =
      sample.verified_egress_node_id ?? sample.egress_node_id ?? undefined
    return `账号当前出口 · ${
      getEgressNodeName(egressNodeNames, node) || `Node ${node ?? '未核验'}`
    }`
  }
  if (sample.target_kind !== 'direct') {
    return sample.egress_name || `出口 ${sample.egress_node_id ?? '—'}`
  }
  if (!sample.verified_egress_node_id) return '上游调度诊断 · 本地出口'
  return `上游调度诊断 · ${
    getEgressNodeName(egressNodeNames, sample.verified_egress_node_id) ||
    `Node ${sample.verified_egress_node_id}`
  }`
}

function SampleFact({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className='rounded-md border bg-background px-2.5 py-2'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='mt-1 text-sm font-semibold tabular-nums'>{value}</div>
    </div>
  )
}

function SampleEvidence({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  const title =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined
  return (
    <div className='min-w-0 rounded-md border bg-background px-2.5 py-2 text-xs'>
      <div className='text-muted-foreground'>{label}</div>
      <div className='mt-1 truncate font-mono' title={title}>
        {value || '—'}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='mt-1 text-sm font-semibold'>{value}</div>
    </div>
  )
}
