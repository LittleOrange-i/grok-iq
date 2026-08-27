import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  CircleHelp,
  Gauge,
  CircleX,
  Eye,
  Filter,
  KeyRound,
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
  ShieldBan,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatAccountSecondaryLabel } from '@/lib/account-label'
import {
  api,
  type AccountActionName,
  type AccountDetailResponse,
  type ProbeSample,
  type UpstreamAccount,
  type UpstreamQuota,
} from '@/lib/api'
import { StatusBadge } from '@/lib/status'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { formatDualTps, tpsOverridden } from '@/lib/tps'
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
  DialogFooter,
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
import { Page, PageHeader, LoadingState, EmptyState } from '@/components/page'
import { PersistedViewNotice } from '@/components/persisted-view-notice'
import { SelectionToolbar } from '@/components/selection-toolbar'
import {
  ServerPagination,
  ServerTableLoadingOverlay,
} from '@/components/server-pagination'
import {
  AccountSampleExplorer,
  sampleTargetText,
} from '@/features/monitor/components/account-sample-explorer'
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
import { DispositionBanner } from '@/features/monitor/components/disposition-summary'
import { DualTpsValue } from '@/features/monitor/components/tps-display'
import { FilterChip } from '@/features/monitor/components/filter-chip'
import { ProbeDialog } from '@/features/monitor/components/probe-dialog'

type AccountBatchAction = 'enable' | 'disable'
type RecoveryGuardFilter = 'all' | 'true' | 'false'
type SsoRiskFilter =
  | 'all'
  | 'missing'
  | 'unverified'
  | 'pending'
  | 'clean'
  | 'flagged'
  | 'failed'
  | 'change_egress'

const ACCOUNTS_VIEW_STORAGE_KEY = 'grokiq.monitor.accounts-view.v1'
const defaultAccountsView = {
  page: 1,
  pageSize: 50,
  search: '',
  status: 'all',
  upstreamStatus: 'all',
  recoveryGuarded: 'all',
  ssoRisk: 'all' as SsoRiskFilter,
  egressNodeId: 'all',
}

const accountMonitorStatusLabels: Record<string, string> = {
  all: '全部判定',
  healthy: '正常',
  watch: '观察',
  suspect: '疑似降智',
  high_risk: '高风险',
  quarantined: '已停用',
}

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

export function AccountsPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const accountsView = usePersistedViewState(
    ACCOUNTS_VIEW_STORAGE_KEY,
    defaultAccountsView
  )
  const {
    page,
    pageSize,
    search,
    status,
    upstreamStatus,
    recoveryGuarded,
    ssoRisk,
    egressNodeId = 'all',
  } = accountsView.value
  const updateAccountsView = (patch: Partial<typeof defaultAccountsView>) =>
    accountsView.setValue((current) => ({ ...current, ...patch }))
  const [deferredSearch] = useDebouncedValue(search.trim())
  const committedQuery = useMemo(
    () => ({
      page,
      pageSize,
      search: deferredSearch,
      status,
      upstreamStatus,
      recoveryGuarded,
      ssoRisk,
      egressNodeId,
    }),
    [
      deferredSearch,
      page,
      pageSize,
      recoveryGuarded,
      ssoRisk,
      status,
      upstreamStatus,
      egressNodeId,
    ]
  )
  // Apply filter/page query after the overlay and select close have painted.
  const tableQuery = usePaintDeferredValue(committedQuery)
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
  const [isolateConfirmOpen, setIsolateConfirmOpen] = useState(false)
  const [detailIsolateOpen, setDetailIsolateOpen] = useState(false)
  const [ssoConfirmOpen, setSsoConfirmOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [sampleToDelete, setSampleToDelete] = useState<ProbeSample | null>(null)
  const tableQueryPending =
    tableQuery.page !== committedQuery.page ||
    tableQuery.pageSize !== committedQuery.pageSize ||
    tableQuery.search !== committedQuery.search ||
    tableQuery.status !== committedQuery.status ||
    tableQuery.upstreamStatus !== committedQuery.upstreamStatus ||
    tableQuery.recoveryGuarded !== committedQuery.recoveryGuarded ||
    tableQuery.ssoRisk !== committedQuery.ssoRisk ||
    tableQuery.egressNodeId !== committedQuery.egressNodeId
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: 60_000,
  })
  const ssoProxyConfigured = Boolean(settings.data?.ssoProxyConfigured)
  const query = useQuery({
    queryKey: [
      'accounts',
      tableQuery.page,
      tableQuery.pageSize,
      tableQuery.search,
      tableQuery.status,
      tableQuery.upstreamStatus,
      tableQuery.recoveryGuarded,
      tableQuery.ssoRisk,
      tableQuery.egressNodeId,
    ],
    queryFn: ({ signal }) =>
      api.accounts(
        {
          page: tableQuery.page,
          pageSize: tableQuery.pageSize,
          search: tableQuery.search,
          monitorStatus: tableQuery.status === 'all' ? '' : tableQuery.status,
          status:
            tableQuery.upstreamStatus === 'all'
              ? ''
              : tableQuery.upstreamStatus,
          recoveryGuarded:
            tableQuery.recoveryGuarded === 'all'
              ? ''
              : tableQuery.recoveryGuarded,
          ssoRisk: tableQuery.ssoRisk === 'all' ? '' : tableQuery.ssoRisk,
          egressNodeId:
            tableQuery.egressNodeId === 'all' ? '' : tableQuery.egressNodeId,
        },
        signal
      ),
    placeholderData: (previous) => previous,
  })
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: api.profiles,
    enabled: probeOpen,
    staleTime: 60_000,
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
  const detail = useQuery({
    queryKey: ['account', detailId],
    queryFn: () => api.account(detailId!),
    enabled: detailOpen && detailId != null,
  })
  const accounts = useMemo(() => query.data?.items ?? [], [query.data?.items])
  const selectableAccounts = useMemo(
    () =>
      accounts.filter(
        (item) => !item.authStatus || item.authStatus === 'active'
      ),
    [accounts]
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
      inputPending: tableQueryPending,
    })
  const tableFilterKey = [
    tableQuery.search,
    tableQuery.status,
    tableQuery.upstreamStatus,
    tableQuery.recoveryGuarded,
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
    // Wait until the overlay has painted before dropping checkboxes, so the
    // first filter frame only updates the controls and loading state.
    setSelected((current) => (current.length === 0 ? current : []))
    setSelectedDisabled((current) => (current.length === 0 ? current : []))
    setAllFilteredSelected(false)
  }, [beginTableInteraction, tableFilterKey, tableQueryPending])
  const openAccountDetail = useCallback((id: number) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const actionMutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: number
      action: AccountActionName
    }) => api.accountAction(id, { action, propagate: true }),
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
        search: tableQuery.search,
        monitorStatus: tableQuery.status === 'all' ? '' : tableQuery.status,
        status:
          tableQuery.upstreamStatus === 'all' ? '' : tableQuery.upstreamStatus,
        recoveryGuarded:
          tableQuery.recoveryGuarded === 'all'
            ? ''
            : tableQuery.recoveryGuarded,
        ssoRisk: tableQuery.ssoRisk === 'all' ? '' : tableQuery.ssoRisk,
        egressNodeId:
          tableQuery.egressNodeId === 'all' ? '' : tableQuery.egressNodeId,
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
    mutationFn: (accountIds: number[]) =>
      api.createAccountSsoReport(accountIds),
    onSuccess: (result) => {
      setSsoConfirmOpen(false)
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

  const isolateBatchMutation = useMutation({
    mutationFn: (accountIds: number[]) =>
      api.accountBatchAction({
        account_ids: accountIds,
        action: 'isolate',
        note: '账号探针人工移入隔离区',
        propagate: true,
      }),
    onSuccess: (result) => {
      const skippedAccountIds = result.skippedAccountIds ?? []
      const failedAccountIds = result.failedAccountIds ?? []
      const alreadyIsolatedIds = result.alreadyIsolatedAccountIds ?? []
      const retainedAccountIds = Array.from(
        new Set([...skippedAccountIds, ...failedAccountIds])
      )
      setIsolateConfirmOpen(false)
      setSelected(retainedAccountIds)
      setSelectedDisabled(
        selectedDisabledIds.filter((id) => retainedAccountIds.includes(id))
      )
      setAllFilteredSelected(false)
      if (
        failedAccountIds.length > 0 ||
        skippedAccountIds.length > 0 ||
        alreadyIsolatedIds.length > 0
      ) {
        const details = [`已移入隔离区 ${result.updated} 个账号`]
        if (failedAccountIds.length) {
          details.push(`${failedAccountIds.length} 个操作失败并保留选择`)
        }
        if (skippedAccountIds.length) {
          details.push(`${skippedAccountIds.length} 个设置受任务保护并跳过`)
        }
        if (alreadyIsolatedIds.length) {
          details.push(`${alreadyIsolatedIds.length} 个原本已在隔离区`)
        }
        toast.warning(details.join('；'))
      } else {
        toast.success(`已移入隔离区 ${result.updated} 个账号`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const isolateAccountMutation = useMutation({
    mutationFn: (id: number) =>
      api.accountAction(id, {
        action: 'isolate',
        note: '账号探针人工移入隔离区',
        propagate: true,
      }),
    onSuccess: () => {
      setDetailIsolateOpen(false)
      toast.success('已移入隔离区')
      void client.invalidateQueries({ queryKey: ['accounts'] })
      void client.invalidateQueries({ queryKey: ['account', detailId] })
      void client.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
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
  const isolatePending = isolateBatchMutation.isPending
  const ssoReportPending = accountSsoReportMutation.isPending
  const selectionActionPending =
    batchActionPending ||
    egressBindingPending ||
    deletePending ||
    isolatePending ||
    ssoReportPending
  const bindableEgress = (egress.data?.items ?? []).filter(
    (node) => node.enabled && node.proxyConfigured
  )
  const clearAccountsView = () => {
    beginTableInteraction()
    accountsView.clear()
  }

  const toggleCurrentPageSelection = useCallback(
    (checked: boolean) => {
      setAllFilteredSelected(false)
      setSelected((current) =>
        checked
          ? Array.from(
              new Set([
                ...current,
                ...selectableAccounts.map((item) => Number(item.id)),
              ])
            )
          : current.filter(
              (id) => !selectableAccounts.some((item) => Number(item.id) === id)
            )
      )
      const disabledIds = selectableAccounts
        .filter((item) => !item.enabled)
        .map((item) => Number(item.id))
      setSelectedDisabled((current) =>
        checked
          ? Array.from(new Set([...current, ...disabledIds]))
          : current.filter(
              (id) => !selectableAccounts.some((item) => Number(item.id) === id)
            )
      )
    },
    [selectableAccounts]
  )

  const toggleAccountSelection = useCallback(
    (id: number, enabled: boolean, checked: boolean) => {
      setAllFilteredSelected(false)
      setSelected((current) =>
        checked
          ? [...new Set([...current, id])]
          : current.filter((item) => item !== id)
      )
      setSelectedDisabled((current) =>
        checked && !enabled
          ? [...new Set([...current, id])]
          : current.filter((item) => item !== id)
      )
    },
    []
  )
  const upstreamStatusLabel =
    ACCOUNT_UPSTREAM_STATUS_OPTIONS.find(
      (option) => option.value === upstreamStatus
    )?.label ?? '全部上游状态'
  const accountsViewSummary = [
    search.trim() ? `搜索“${search.trim()}”` : '',
    accountMonitorStatusLabels[status] ?? `判定 ${status}`,
    upstreamStatusLabel,
    recoveryGuarded === 'all'
      ? '全部恢复状态'
      : recoveryGuarded === 'true'
        ? '恢复保护'
        : '未标记恢复保护',
    ssoRiskLabels[ssoRisk],
    egressNodeId === 'all' ? '全部出口绑定' : `出口节点 ${egressNodeId}`,
    `第 ${page} 页 · 每页 ${pageSize} 条`,
  ].join(' · ')
  const activeFilterCount = [
    status !== 'all',
    upstreamStatus !== 'all',
    recoveryGuarded !== 'all',
    ssoRisk !== 'all',
    egressNodeId !== 'all',
  ].filter(Boolean).length
  const egressFilterLabel =
    egressNodeId === 'unbound'
      ? '未绑定'
      : getEgressNodeName(egressNodeNames, egressNodeId) ?? `节点 #${egressNodeId}`

  return (
    <Page>
      <PageHeader
        title='账号探针'
        description={
          <div className='space-y-2'>
            <p>
              账号列表实时来自 grok2api；监控判定来自探针样本累计，并保存注册机联动提供的
              SSO 用于检测。
            </p>
            <p>
              这里的观察 / 疑似降智 / 高风险，和请求审计页面的「高风险」不是同一套规则。请求审计看当前窗口请求，一条高速
              TPS 就会显示高风险；探针高风险要重复异常且强信号达到次数。
            </p>
          </div>
        }
        hintContentClassName='max-w-[28rem]'
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
                onClick={() => {
                  if (selected.length > 1000) {
                    toast.error(
                      `单次最多检测 1000 个账号，当前已选 ${selected.length} 个；请缩小筛选范围后重试`
                    )
                    return
                  }
                  setSsoConfirmOpen(true)
                }}
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
                label={`将已选 ${selected.length} 个账号移入隔离区`}
                pending={isolatePending}
                disabled={selectionActionPending || selected.length === 0}
                onClick={() => setIsolateConfirmOpen(true)}
              >
                <ShieldBan />
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
          <div className='mb-4 space-y-3' aria-busy={showTableLoading}>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              <div className='relative min-w-0 flex-1'>
                <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={search}
                  onChange={(event) => updateAccountsView({ search: event.target.value, page: 1 })}
                  placeholder='搜索名称、邮箱或账号 ID'
                  className='h-10 pr-9 pl-9'
                />
                {showTableLoading && <Loader2 className='absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary' />}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant='outline' className='h-10 shrink-0 gap-2 px-3'>
                    <SlidersHorizontal className='size-4' />
                    筛选条件
                    {activeFilterCount > 0 && <Badge variant='secondary' className='min-w-5 justify-center px-1.5'>{activeFilterCount}</Badge>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' className='w-[min(25rem,calc(100vw-2rem))] p-0'>
                  <div className='border-b px-4 py-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <div>
                        <div className='text-sm font-semibold'>账号筛选</div>
                        <div className='mt-0.5 text-xs text-muted-foreground'>组合条件，快速缩小探针范围</div>
                      </div>
                      {activeFilterCount > 0 && <Button variant='ghost' size='sm' className='h-8' onClick={() => updateAccountsView({ status: 'all', upstreamStatus: 'all', recoveryGuarded: 'all', ssoRisk: 'all', egressNodeId: 'all', page: 1 })}>清除全部</Button>}
                    </div>
                  </div>
                  <div className='space-y-4 p-4'>
                    <div className='space-y-2'>
                      <div className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>账号状态</div>
                      <div className='grid gap-2 sm:grid-cols-2'>
                        <Select value={status} onValueChange={(value) => updateAccountsView({ status: value, page: 1 })}>
                          <SelectTrigger><Filter className='size-4 text-muted-foreground' /><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value='all'>全部判定</SelectItem><SelectItem value='healthy'>正常</SelectItem><SelectItem value='watch'>观察</SelectItem><SelectItem value='suspect'>疑似降智</SelectItem><SelectItem value='high_risk'>高风险</SelectItem><SelectItem value='quarantined'>已停用</SelectItem></SelectContent>
                        </Select>
                        <Select value={upstreamStatus} onValueChange={(value) => updateAccountsView({ upstreamStatus: value as UpstreamStatusFilter, page: 1 })}>
                          <SelectTrigger><Activity className='size-4 text-muted-foreground' /><SelectValue /></SelectTrigger>
                          <SelectContent>{ACCOUNT_UPSTREAM_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className='space-y-2'>
                      <div className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>检测与出口</div>
                      <div className='grid gap-2 sm:grid-cols-2'>
                        <Select value={recoveryGuarded} onValueChange={(value) => updateAccountsView({ recoveryGuarded: value as RecoveryGuardFilter, page: 1 })}>
                          <SelectTrigger><ShieldCheck className='size-4 text-muted-foreground' /><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value='all'>全部恢复状态</SelectItem><SelectItem value='true'>恢复保护</SelectItem><SelectItem value='false'>未标记恢复保护</SelectItem></SelectContent>
                        </Select>
                        <Select value={egressNodeId} onValueChange={(value) => updateAccountsView({ egressNodeId: value, page: 1 })}>
                          <SelectTrigger><Network className='size-4 text-muted-foreground' /><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value='all'>全部出口绑定</SelectItem><SelectItem value='unbound'>未绑定出口</SelectItem>{(egress.data?.items ?? []).map((node) => <SelectItem key={node.id} value={String(node.id)}>{node.name || `节点 #${node.id}`}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className='space-y-2'>
                      <div className='text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>SSO 风控</div>
                      <Select value={ssoRisk} onValueChange={(value) => updateAccountsView({ ssoRisk: value as SsoRiskFilter, page: 1 })}>
                        <SelectTrigger><ShieldAlert className='size-4 text-muted-foreground' /><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(ssoRiskLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {(activeFilterCount > 0 || search.trim()) && (
              <div className='flex flex-wrap items-center gap-1.5 border-t pt-3'>
                <span className='mr-1 text-xs text-muted-foreground'>当前条件</span>
                {search.trim() && <FilterChip label={`搜索：${search.trim()}`} onClear={() => updateAccountsView({ search: '', page: 1 })} />}
                {status !== 'all' && <FilterChip label={`判定：${accountMonitorStatusLabels[status]}`} onClear={() => updateAccountsView({ status: 'all', page: 1 })} />}
                {upstreamStatus !== 'all' && <FilterChip label={`上游：${upstreamStatusLabel}`} onClear={() => updateAccountsView({ upstreamStatus: 'all', page: 1 })} />}
                {recoveryGuarded !== 'all' && <FilterChip label={`恢复：${recoveryGuarded === 'true' ? '保护' : '未标记'}`} onClear={() => updateAccountsView({ recoveryGuarded: 'all', page: 1 })} />}
                {ssoRisk !== 'all' && <FilterChip label={`SSO：${ssoRiskLabels[ssoRisk]}`} onClear={() => updateAccountsView({ ssoRisk: 'all', page: 1 })} />}
                {egressNodeId !== 'all' && <FilterChip label={`出口：${egressFilterLabel}`} onClear={() => updateAccountsView({ egressNodeId: 'all', page: 1 })} />}
              </div>
            )}
          </div>
          {accountsView.active && (
            <PersistedViewNotice
              restored={accountsView.restored}
              summary={accountsViewSummary}
              onClear={clearAccountsView}
            />
          )}
          {query.isLoading && !query.data ? (
            <LoadingState />
          ) : accounts.length ? (
            <>
              <div className='relative min-h-40' aria-busy={showTableLoading}>
                <AccountsTable
                  accounts={accounts}
                  egressNodeNames={egressNodeNames}
                  selected={selected}
                  allChecked={allChecked}
                  onToggleCurrentPage={toggleCurrentPageSelection}
                  onToggleAccount={toggleAccountSelection}
                  onDetail={openAccountDetail}
                />
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
                  updateAccountsView({ page: value })
                }}
                onPageSizeChange={(value) => {
                  beginTableInteraction()
                  updateAccountsView({ pageSize: value, page: 1 })
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
        profilesLoading={profiles.isFetching && !profiles.data}
        profilesError={profiles.isError ? getErrorMessage(profiles.error) : ''}
        onRefreshProfiles={() => void profiles.refetch()}
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
        open={ssoConfirmOpen}
        onOpenChange={(open) => {
          if (!ssoReportPending) setSsoConfirmOpen(open)
        }}
        title={`检测 ${selected.length} 个账号的 SSO？`}
        desc={
          <div className='space-y-3'>
            <p>
              将使用注册联动保存的 SSO，并强制通过系统配置代理创建检测报告。
            </p>
            <p className='text-muted-foreground'>
              缺少 SSO 或存储值解析失败的账号会被跳过，并在创建结果中显示数量。
            </p>
            {!ssoProxyConfigured && (
              <p className='text-destructive'>
                尚未配置 SSO 检测代理，请先到系统设置的连接与凭据中配置。
              </p>
            )}
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          ssoReportPending ? (
            <>
              <Loader2 className='animate-spin' />
              创建中…
            </>
          ) : (
            <>
              <ScanSearch />
              {ssoProxyConfigured ? '确认检测' : '请先配置代理'}
            </>
          )
        }
        isLoading={ssoReportPending}
        disabled={
          !ssoProxyConfigured || selected.length === 0 || selected.length > 1000
        }
        handleConfirm={() => accountSsoReportMutation.mutate(selected)}
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
      <ConfirmDialog
        open={isolateConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !isolatePending) setIsolateConfirmOpen(false)
        }}
        title={`将 ${selected.length} 个账号移入隔离区？`}
        desc={
          <div className='space-y-2'>
            <p>将停用上游并把账号移入隔离区，不会删除账号。</p>
            <p className='font-medium text-foreground'>
              隔离区是长期隔离（不自动到期恢复）并停用上游；暂时停用仍走原来的停用时长逻辑。
            </p>
            <p className='text-muted-foreground'>
              正在执行探针或等待账号设置恢复的账号会被跳过并保留选择。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          isolatePending ? (
            <>
              <Loader2 className='animate-spin' />
              移入中…
            </>
          ) : (
            <>
              <ShieldBan />
              确认移入隔离区
            </>
          )
        }
        isLoading={isolatePending}
        disabled={selected.length === 0}
        handleConfirm={() => isolateBatchMutation.mutate(selected)}
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
              “暂时停用”使用系统设置中的停用时长，到期后可自动恢复；“移入隔离区”是长期隔离并停用上游，不会自动到期恢复，也不删除 grok2api 账号。
            </p>
            <DialogFooter className='mt-3'>
              <Button
                variant='outline'
                disabled={
                  actionMutation.isPending || isolateAccountMutation.isPending
                }
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
                disabled={
                  actionMutation.isPending || isolateAccountMutation.isPending
                }
                onClick={() =>
                  detailId &&
                  actionMutation.mutate({ id: detailId, action: 'quarantine' })
                }
              >
                <ShieldAlert />
                暂时停用
              </Button>
              <Button
                variant='outline'
                disabled={
                  actionMutation.isPending ||
                  isolateAccountMutation.isPending ||
                  (detail.data?.account.assessment.monitor_status ===
                    'quarantined' &&
                    !detail.data?.account.assessment.quarantine_until)
                }
                onClick={() => setDetailIsolateOpen(true)}
              >
                <ShieldBan />
                移入隔离区
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={detailIsolateOpen}
        onOpenChange={(open) => {
          if (!open && !isolateAccountMutation.isPending) {
            setDetailIsolateOpen(false)
          }
        }}
        title='将账号移入隔离区？'
        desc={
          <div className='space-y-2'>
            <p>将停用上游并把账号移入隔离区，不会删除账号。</p>
            <p className='font-medium text-foreground'>
              隔离区是长期隔离（不自动到期恢复）并停用上游；暂时停用仍走原来的停用时长逻辑。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          isolateAccountMutation.isPending ? (
            <>
              <Loader2 className='animate-spin' />
              移入中…
            </>
          ) : (
            <>
              <ShieldBan />
              确认移入隔离区
            </>
          )
        }
        isLoading={isolateAccountMutation.isPending}
        disabled={detailId == null}
        handleConfirm={() => {
          if (detailId != null) isolateAccountMutation.mutate(detailId)
        }}
      />
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

type AccountsTableProps = {
  accounts: UpstreamAccount[]
  egressNodeNames: EgressNodeNameMap
  selected: number[]
  allChecked: boolean
  onToggleCurrentPage: (checked: boolean) => void
  onToggleAccount: (id: number, enabled: boolean, checked: boolean) => void
  onDetail: (id: number) => void
}

const AccountsTable = memo(function AccountsTable({
  accounts,
  egressNodeNames,
  selected,
  allChecked,
  onToggleCurrentPage,
  onToggleAccount,
  onDetail,
}: AccountsTableProps) {
  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  return (
    <Table rememberRowKey='monitor-accounts'>
      <TableHeader>
        <TableRow>
          <TableHead className='w-10'>
            <Checkbox
              checked={allChecked}
              onCheckedChange={(value) => onToggleCurrentPage(value === true)}
              aria-label='选择当前页可检测账号'
            />
          </TableHead>
          <TableHead>账号</TableHead>
          <TableHead className='w-16 text-center'>SSO</TableHead>
          <TableHead>上游状态</TableHead>
          <TableHead>监控判定</TableHead>
          <TableHead>周期样本 / 信号</TableHead>
          <TableHead className='w-24'>额度</TableHead>
          <TableHead>出口绑定</TableHead>
          <TableHead className='text-right'>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => {
          const id = Number(account.id)
          return (
            <AccountRow
              key={account.id}
              account={account}
              egressNodeNames={egressNodeNames}
              selected={selectedIdSet.has(id)}
              onSelectedChange={(checked) =>
                onToggleAccount(id, account.enabled, checked)
              }
              onDetail={() => onDetail(id)}
            />
          )
        })}
      </TableBody>
    </Table>
  )
})

type AccountRowProps = {
  account: UpstreamAccount
  egressNodeNames: EgressNodeNameMap
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onDetail: () => void
}

function AccountPeriodStats({
  assessment,
}: {
  assessment: UpstreamAccount['assessment']
}) {
  const samples = assessment.sample_count ?? 0
  const anomalies = assessment.anomaly_count ?? 0
  const latestTps = assessment.latest_tps ?? 0
  const latestUpstream = assessment.latest_upstream_tps
  const overridden = tpsOverridden(latestTps, latestUpstream)
  const hasTps = latestTps > 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='flex items-center gap-2 text-xs tabular-nums'>
          <span className='inline-flex items-center gap-1 text-muted-foreground'>
            <Activity className='size-3.5' />
            {samples}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              anomalies > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            )}
          >
            <TriangleAlert className='size-3.5' />
            {anomalies}
          </span>
          {hasTps ? (
            <span className='inline-flex items-center gap-1 text-muted-foreground'>
              <Gauge className='size-3.5' />
              <DualTpsValue
                tps={latestTps}
                upstreamTps={latestUpstream}
                compact
              />
            </span>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent className='max-w-80'>
        风险周期内 {samples} 个样本，{anomalies} 个降智信号。
        {hasTps
          ? ` TPS 显示最新一条可计量样本${
              overridden
                ? '：紫色为按生成窗口重算，灰色为上游被压低的原值'
                : ''
            }。周期最高 ${formatDualTps(
              assessment.max_tps,
              assessment.max_upstream_tps
            )}，平均 ${formatDualTps(
              assessment.avg_tps,
              assessment.avg_upstream_tps
            )}。`
          : ' 当前周期还没有可计量 TPS。'}
      </TooltipContent>
    </Tooltip>
  )
}

const AccountRow = memo(function AccountRow({
  account,
  egressNodeNames,
  selected,
  onSelectedChange,
  onDetail,
}: AccountRowProps) {
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
          disabled={
            Boolean(account.authStatus) && account.authStatus !== 'active'
          }
          onCheckedChange={(value) => onSelectedChange(value === true)}
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
      <TableCell className='text-center'>
        <div className='flex flex-col items-center gap-1'>
          <SsoAvailabilityIndicator available={account.ssoAvailable} />
          <AccountSsoRiskBadge account={account} />
        </div>
      </TableCell>
      <TableCell>
        <div className='flex items-center gap-2'>
          <span
            className={`size-2 rounded-full ${account.enabled ? 'bg-emerald-500' : 'bg-zinc-400'}`}
          />
          {account.enabled ? '启用' : '停用'}
          <AuthStatusIndicator status={account.authStatus} />
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
        <AccountPeriodStats assessment={assessment} />
      </TableCell>
      <TableCell>
        <QuotaRemainingIndicator quota={account.quota} />
      </TableCell>
      <TableCell>
        <EgressBindingIndicator
          nodeId={account.egressNodeId}
          nodeName={getEgressNodeName(egressNodeNames, account.egressNodeId)}
          assignmentMode={account.egressAssignmentMode}
        />
      </TableCell>
      <TableCell className='text-right'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size='icon'
              variant='ghost'
              onClick={onDetail}
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
}, areAccountRowPropsEqual)

function areAccountRowPropsEqual(
  previous: AccountRowProps,
  next: AccountRowProps
) {
  return (
    previous.account === next.account &&
    previous.egressNodeNames === next.egressNodeNames &&
    previous.selected === next.selected
  )
}

function SsoAvailabilityIndicator({ available }: { available: boolean }) {
  const Icon = available ? KeyRound : CircleX
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-md',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            available
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground'
          )}
          tabIndex={0}
          aria-label={available ? '已保存 SSO' : '缺失 SSO'}
        >
          <Icon className='size-4' />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {available
          ? '已保存 SSO，可执行 SSO 检测'
          : '缺失 SSO，执行检测时将跳过'}
      </TooltipContent>
    </Tooltip>
  )
}

function AccountSsoRiskBadge({ account }: { account: UpstreamAccount }) {
  const status =
    account.ssoRiskStatus || (account.ssoAvailable ? 'unverified' : 'missing')
  const recommendation = account.egressRecommendation
  if (recommendation?.type === 'change_egress') {
    return (
      <Badge
        variant='warning'
        className='gap-1'
        title={`${recommendation.reason}${recommendation.priority != null ? `；当前降级优先级 ${recommendation.priority}` : ''}`}
      >
        <Network className='size-3' />
        换出口
      </Badge>
    )
  }
  const meta =
    status === 'flagged'
      ? { label: 'SSO 已标记', variant: 'destructive' as const }
      : status === 'clean'
        ? {
            label:
              account.ssoPreDisableAction === 'deprioritize_disabled'
                ? 'SSO 正常 · 待降级'
                : 'SSO 正常',
            variant: 'success' as const,
          }
        : status === 'pending'
          ? { label: 'SSO 复检中', variant: 'secondary' as const }
          : status === 'failed'
            ? { label: 'SSO 复检失败', variant: 'warning' as const }
            : status === 'missing'
              ? { label: '缺少 SSO', variant: 'outline' as const }
              : status === 'skipped'
                ? { label: '已跳过 SSO 复检', variant: 'outline' as const }
                : { label: 'SSO 未复检', variant: 'outline' as const }
  return (
    <Badge
      variant={meta.variant}
      title={
        account.ssoRiskCheckedAt
          ? `${meta.label} · ${formatDate(account.ssoRiskCheckedAt)}`
          : meta.label
      }
    >
      {meta.label}
    </Badge>
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
          label='SSO 风控'
          value={<AccountSsoRiskBadge account={account} />}
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
      {account.egressRecommendation?.type === 'change_egress' && (
        <div className='rounded-lg border border-amber-500/30 bg-amber-500/8 p-3'>
          <div className='flex flex-wrap items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300'>
            <Network className='size-4' />
            {account.egressRecommendation.label || '建议更换出口节点'}
          </div>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            {account.egressRecommendation.reason}
            {account.egressRecommendation.priority != null
              ? `；账号已降至优先级 ${account.egressRecommendation.priority}`
              : ''}
          </p>
        </div>
      )}
      <DispositionBanner
        disposition={assessment.disposition}
        sampleReasons={reasons}
      />
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
                <span className='inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums sm:text-right'>
                  <DualTpsValue
                    tps={item.max_tps ?? 0}
                    upstreamTps={item.max_upstream_tps}
                    compact
                  />
                  <span className='text-xs font-normal text-muted-foreground'>
                    max
                  </span>
                </span>
              </div>
              <div className='mt-1 text-xs text-muted-foreground'>
                {item.samples} 个样本 · {item.anomalies ?? 0} 个降智信号 · 平均{' '}
                <DualTpsValue
                  tps={item.avg_tps ?? 0}
                  upstreamTps={item.avg_upstream_tps}
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className='mb-2 text-sm font-semibold'>最近样本</h3>
        <AccountSampleExplorer
          samples={history.samples.slice(0, 30)}
          egressNodeNames={egressNodeNames}
          deletingSampleId={deletingSampleId}
          onDeleteSample={onDeleteSample}
        />
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

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='mt-1 text-sm font-semibold'>{value}</div>
    </div>
  )
}
