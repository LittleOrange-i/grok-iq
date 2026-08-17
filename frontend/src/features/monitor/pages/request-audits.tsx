import {
  useDeferredValue,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  CalendarRange,
  CheckCircle2,
  Copy,
  Eye,
  ExternalLink,
  Gauge,
  Globe2,
  Info,
  Layers3,
  ListChecks,
  ListFilter,
  LockKeyhole,
  Play,
  RefreshCw,
  ScanSearch,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Timer,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import {
  api,
  type RequestAuditAccountRisk,
  type RequestAuditActivity,
  type RequestAuditActivityLevel,
  type RequestAuditConfig,
  type RequestAuditNodeRisk,
  type RequestAuditProbeContext,
  type RequestAuditRecord,
  type RequestAuditRiskLevel,
  type RequestAuditScanState,
  type RequestAuditStatus,
  type RequestAuditThresholds,
  type RequestAuditWindowInput,
  type RequestAuditWindowPreset,
  type RuntimeSettingsUpdate,
} from '@/lib/api'
import { StatusBadge } from '@/lib/status'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'
import { SelectionToolbar } from '@/components/selection-toolbar'
import { ServerPagination } from '@/components/server-pagination'
import { AccountSampleExplorer } from '@/features/monitor/components/account-sample-explorer'
import { AuthStatusIndicator } from '@/features/monitor/components/account-state-indicators'
import { buildEgressNodeNameMap } from '@/features/monitor/components/egress-node-names'
import { ProbeDialog } from '@/features/monitor/components/probe-dialog'

const riskVariant: Record<
  RequestAuditRiskLevel,
  'success' | 'warning' | 'destructive'
> = {
  normal: 'success',
  watch: 'warning',
  high: 'destructive',
}

const activityTone: Record<
  RequestAuditActivityLevel,
  { active: string; dot: string; text: string }
> = {
  busy: {
    active: 'border-amber-500/30 bg-amber-500/8',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
  },
  normal: {
    active: 'border-sky-500/30 bg-sky-500/8',
    dot: 'bg-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
  },
  idle: {
    active: 'border-emerald-500/30 bg-emerald-500/8',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
}

const waitingActivityTone = {
  active: 'border-border bg-muted/20',
  dot: 'bg-muted-foreground/45',
  text: 'text-muted-foreground',
}

const fallbackConfig: RequestAuditConfig = {
  enabled: true,
  autoScanEnabled: true,
  adaptiveScanEnabled: true,
  fixedScanIntervalMinutes: 5,
  busyScanIntervalSeconds: 30,
  normalScanIntervalSeconds: 120,
  idleScanIntervalSeconds: 300,
  busyRequestsPerMinute: 20,
  liveRefreshEnabled: true,
  liveRefreshSeconds: 30,
  riskEnabled: true,
  isolationEnabled: true,
  retentionDays: 90,
}

const windowOptions: Array<{
  value: RequestAuditWindowPreset
  label: string
}> = [
  { value: 'today', label: '当天' },
  { value: '6h', label: '最近 6 小时' },
  { value: '24h', label: '最近 24 小时' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: 'custom', label: '自定义时间' },
]

const REQUEST_AUDIT_WINDOW_STORAGE_KEY = 'grokiq.request-audits.window.v1'
const REQUEST_AUDIT_MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
const requestAuditWindowPresets = new Set<RequestAuditWindowPreset>(
  windowOptions.map((option) => option.value)
)

type WorkspaceRiskFilter = 'all' | 'risky' | RequestAuditRiskLevel
type AuditRiskFilter = 'all' | 'risky' | RequestAuditRiskLevel
type Perspective = 'accounts' | 'nodes'
type MainView = 'overview' | 'workspace' | 'ledger' | 'schedule'
type AuditBulkActionSource = 'risk' | 'ledger'

type AuditProbeSelection = {
  source: AuditBulkActionSource
  accountIds: number[]
  disabledAccountCount: number
  sourceRecordCount: number
}

type AuditConfigDraft = RequestAuditConfig & {
  watchTps: number
  highTps: number
}

function uniqueAccountIds(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      )
    )
  )
}

type UpstreamAccountSnapshot = Pick<
  RequestAuditAccountRisk,
  'upstreamAccountFound' | 'upstreamEnabled' | 'upstreamAuthStatus'
>

function upstreamAuthLabel(status: string) {
  if (status === 'active') return '鉴权有效'
  if (status === 'reauthRequired') return '需要授权'
  if (status === 'cooldown') return '冷却中'
  if (status === 'waitingReset') return '待重置'
  if (status === 'probing') return '检测中'
  return status ? status : '鉴权未知'
}

function upstreamAccountStatusText(account: UpstreamAccountSnapshot) {
  if (
    !account.upstreamAccountFound &&
    account.upstreamEnabled == null &&
    !account.upstreamAuthStatus
  ) {
    return '当前状态未获取'
  }
  const enabled =
    account.upstreamEnabled == null
      ? '启停未知'
      : account.upstreamEnabled
        ? '启用'
        : '停用'
  return `${enabled} · ${upstreamAuthLabel(account.upstreamAuthStatus)}`
}

function UpstreamAccountState({
  account,
  compact = false,
}: {
  account: UpstreamAccountSnapshot
  compact?: boolean
}) {
  const unavailable =
    !account.upstreamAccountFound &&
    account.upstreamEnabled == null &&
    !account.upstreamAuthStatus
  if (unavailable) {
    return (
      <Badge
        variant='outline'
        className={cn(compact && 'h-5 px-1.5 text-[10px]')}
        title='本次未取得该账号的上游快照；可能是账号已不存在或上游查询暂时异常。'
      >
        状态未获取
      </Badge>
    )
  }

  return (
    <div
      className='flex min-w-0 items-center gap-1.5 whitespace-nowrap'
      title={`当前上游快照：${upstreamAccountStatusText(account)}；不代表历史请求发生时的状态。`}
    >
      <Badge
        variant={
          account.upstreamEnabled == null
            ? 'outline'
            : account.upstreamEnabled
              ? 'success'
              : 'secondary'
        }
        className={cn(
          'gap-1.5',
          compact && 'h-5 px-1.5 text-[10px] [&>svg]:size-3'
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full',
            account.upstreamEnabled == null
              ? 'bg-muted-foreground/50'
              : account.upstreamEnabled
                ? 'bg-emerald-500'
                : 'bg-zinc-400'
          )}
        />
        {account.upstreamEnabled == null
          ? '启停未知'
          : account.upstreamEnabled
            ? '启用'
            : '停用'}
      </Badge>
      <AuthStatusIndicator
        status={account.upstreamAuthStatus}
        compact={compact}
      />
      <span className={cn('text-muted-foreground', compact && 'text-[10px]')}>
        {upstreamAuthLabel(account.upstreamAuthStatus)}
      </span>
    </div>
  )
}

function configDraft(
  config: RequestAuditConfig | undefined,
  thresholds: RequestAuditThresholds | undefined
): AuditConfigDraft {
  return {
    ...(config ?? fallbackConfig),
    watchTps: thresholds?.watch ?? 150,
    highTps: thresholds?.high ?? 500,
  }
}

function toDateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function defaultCustomWindow() {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return { start: toDateTimeLocal(start), end: toDateTimeLocal(end) }
}

function normalizeRequestAuditWindow(
  value: unknown
): RequestAuditWindowInput | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RequestAuditWindowInput>
  if (
    typeof candidate.window !== 'string' ||
    !requestAuditWindowPresets.has(candidate.window as RequestAuditWindowPreset)
  ) {
    return null
  }

  const preset = candidate.window as RequestAuditWindowPreset
  if (preset !== 'custom') return { window: preset }
  if (
    typeof candidate.startAt !== 'string' ||
    typeof candidate.endAt !== 'string'
  ) {
    return null
  }

  const start = new Date(candidate.startAt)
  const end = new Date(candidate.endAt)
  const now = Date.now()
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end ||
    end.getTime() - start.getTime() > REQUEST_AUDIT_MAX_WINDOW_MS ||
    start.getTime() < now - REQUEST_AUDIT_MAX_WINDOW_MS ||
    end.getTime() > now + 60_000
  ) {
    return null
  }

  return {
    window: 'custom',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  }
}

function readRememberedRequestAuditWindow(): RequestAuditWindowInput {
  if (typeof globalThis.window === 'undefined') return { window: 'today' }
  try {
    const raw = globalThis.window.localStorage.getItem(
      REQUEST_AUDIT_WINDOW_STORAGE_KEY
    )
    return raw
      ? (normalizeRequestAuditWindow(JSON.parse(raw)) ?? { window: 'today' })
      : { window: 'today' }
  } catch {
    return { window: 'today' }
  }
}

function rememberRequestAuditWindow(value: RequestAuditWindowInput) {
  try {
    globalThis.window.localStorage.setItem(
      REQUEST_AUDIT_WINDOW_STORAGE_KEY,
      JSON.stringify(value)
    )
  } catch {
    // 浏览器禁用本地存储时，当前页面内的选择仍然有效。
  }
}

function customRangeFromWindow(value: RequestAuditWindowInput) {
  if (value.window !== 'custom' || !value.startAt || !value.endAt) {
    return defaultCustomWindow()
  }
  return {
    start: toDateTimeLocal(new Date(value.startAt)),
    end: toDateTimeLocal(new Date(value.endAt)),
  }
}

function formatInterval(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function RiskBadge({
  value,
  thresholds,
}: {
  value: RequestAuditRiskLevel
  thresholds: RequestAuditThresholds
}) {
  const label =
    value === 'normal'
      ? '正常'
      : value === 'watch'
        ? `观察 ≥ ${formatNumber(thresholds.watch)} TPS`
        : `高风险 ≥ ${formatNumber(thresholds.high)} TPS`
  return <Badge variant={riskVariant[value]}>{label}</Badge>
}

function Tps({ value }: { value: number | null | undefined }) {
  return (
    <span className='font-mono tabular-nums'>
      {value == null ? '—' : `${formatNumber(value)} Token/s`}
    </span>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone?: 'default' | 'info' | 'warning' | 'danger'
}) {
  return (
    <Card className='group overflow-hidden py-0 transition-shadow hover:shadow-sm'>
      <CardContent className='relative flex items-start gap-3 p-4'>
        <div
          className={cn(
            'absolute inset-x-0 top-0 h-0.5 bg-primary/50',
            tone === 'info' && 'bg-sky-500',
            tone === 'warning' && 'bg-amber-500',
            tone === 'danger' && 'bg-destructive'
          )}
        />
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
            tone === 'info' && 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
            tone === 'warning' &&
              'bg-amber-500/12 text-amber-700 dark:text-amber-300',
            tone === 'danger' && 'bg-destructive/10 text-destructive'
          )}
        >
          <Icon className='size-4' />
        </div>
        <div className='min-w-0'>
          <div className='text-xs font-medium text-muted-foreground'>
            {label}
          </div>
          <div className='mt-1 text-xl font-semibold tabular-nums'>{value}</div>
          <div className='mt-1 truncate text-xs text-muted-foreground'>
            {detail}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function NodeText({
  row,
}: {
  row: RequestAuditRecord | RequestAuditAccountRisk
}) {
  const aggregate = 'egressNodeIds' in row
  const nodeIds = aggregate
    ? row.egressNodeIds
    : row.egressNodeId
      ? [row.egressNodeId]
      : []
  const nodes = aggregate
    ? row.egressNodes
    : row.egressNodeName
      ? [row.egressNodeName]
      : []
  const entryCount = Math.max(nodeIds.length, nodes.length)
  const entries = Array.from({ length: entryCount }, (_, index) => {
    const id = nodeIds[index]
    const name = String(nodes[index] ?? '').trim()
    return {
      id,
      label: name || (id ? `节点 #${id}` : ''),
    }
  }).filter((entry) => entry.label || entry.id)
  const visibleLimit = aggregate ? 2 : 1
  const visibleEntries = entries.slice(0, visibleLimit)
  const hiddenCount = Math.max(0, entries.length - visibleEntries.length)
  const allLabels = entries.map((entry) => entry.label).filter(Boolean)
  const allIds = entries
    .map((entry) => entry.id)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  return (
    <div className='max-w-64 min-w-32 whitespace-normal'>
      <div
        className='flex items-center gap-1 text-xs font-medium'
        title={allLabels.length ? allLabels.join('、') : '未映射代理节点'}
      >
        <span className='min-w-0 truncate'>
          {visibleEntries.length
            ? visibleEntries.map((entry) => entry.label).join('、')
            : '未映射代理节点'}
        </span>
        {hiddenCount > 0 && (
          <Badge variant='secondary' className='h-5 px-1.5 text-[10px]'>
            +{hiddenCount}
          </Badge>
        )}
      </div>
      <div
        className='font-mono text-[10px] text-muted-foreground'
        title={
          allIds.length ? `节点 ID ${allIds.join('、')}` : '审计未返回节点 ID'
        }
      >
        {visibleEntries.some((entry) => entry.id)
          ? `节点 ID ${visibleEntries
              .map((entry) => entry.id)
              .filter(Boolean)
              .join('、')}${hiddenCount ? ` · 另 ${hiddenCount} 个` : ''}`
          : '审计未返回节点 ID'}
      </div>
    </div>
  )
}

function accountNodeLabel(account: RequestAuditAccountRisk) {
  if (account.egressNodes.length) return account.egressNodes.join('、')
  if (account.egressNodeIds.length) {
    return account.egressNodeIds.map((id) => `节点 #${id}`).join('、')
  }
  return '未映射代理节点'
}

function ToggleSetting({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className='flex min-h-14 items-center justify-between gap-4 rounded-lg border bg-muted/15 px-3 py-2.5'>
      <div className='min-w-0'>
        <div className='text-sm font-medium'>{title}</div>
        <div className='mt-0.5 text-xs leading-5 text-muted-foreground'>
          {description}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function AuditConfigurationSheet({
  open,
  onOpenChange,
  draft,
  setDraft,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: AuditConfigDraft
  setDraft: Dispatch<SetStateAction<AuditConfigDraft>>
  saving: boolean
  onSave: () => void
}) {
  const update = <K extends keyof AuditConfigDraft>(
    key: K,
    value: AuditConfigDraft[K]
  ) => setDraft((current) => ({ ...current, [key]: value }))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-[min(94vw,42rem)] sm:max-w-2xl'>
        <SheetHeader className='border-b pb-4'>
          <SheetTitle className='flex items-center gap-2'>
            <SlidersHorizontal className='size-4 text-primary' />
            请求审计运行配置
          </SheetTitle>
          <SheetDescription>
            控制本地投影、自适应扫描、风险识别与页面后台刷新。设置保存后立即热应用。
          </SheetDescription>
        </SheetHeader>

        <div className='min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4'>
          <section className='space-y-3'>
            <div>
              <h3 className='text-sm font-semibold'>功能开关</h3>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                主开关关闭后保留历史投影，只停止新的审计拉取。
              </p>
            </div>
            <div className='grid gap-2 sm:grid-cols-2'>
              <ToggleSetting
                title='请求审计监控'
                description='允许手动和自动扫描 grok_build 请求审计。'
                checked={draft.enabled}
                onCheckedChange={(value) => update('enabled', value)}
              />
              <ToggleSetting
                title='自动增量扫描'
                description='由任务中心持续拉取最新游标页。'
                checked={draft.autoScanEnabled}
                disabled={!draft.enabled}
                onCheckedChange={(value) => update('autoScanEnabled', value)}
              />
              <ToggleSetting
                title='TPS 风险识别'
                description='按当前观察与高风险阈值标记账号和代理节点。'
                checked={draft.riskEnabled}
                disabled={!draft.enabled}
                onCheckedChange={(value) => update('riskEnabled', value)}
              />
              <ToggleSetting
                title='账号隔离操作'
                description='允许从账号或代理节点详情直接联动隔离。'
                checked={draft.isolationEnabled}
                disabled={!draft.riskEnabled}
                onCheckedChange={(value) => update('isolationEnabled', value)}
              />
              <ToggleSetting
                title='页面无感刷新'
                description='保留当前内容，在后台更新本地聚合结果。'
                checked={draft.liveRefreshEnabled}
                onCheckedChange={(value) => update('liveRefreshEnabled', value)}
              />
              <ToggleSetting
                title='自适应扫描节奏'
                description='根据流量、风险峰值和分页积压动态安排下次扫描。'
                checked={draft.adaptiveScanEnabled}
                disabled={!draft.autoScanEnabled}
                onCheckedChange={(value) =>
                  update('adaptiveScanEnabled', value)
                }
              />
            </div>
          </section>

          <Separator />

          <section className='space-y-3'>
            <div>
              <h3 className='text-sm font-semibold'>忙闲识别与扫描节奏</h3>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                忙时必须短于常态，常态必须短于闲时；最近风险请求也会进入忙时。
              </p>
            </div>
            {draft.adaptiveScanEnabled ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                <NumberField
                  label='忙时扫描间隔（秒）'
                  value={draft.busyScanIntervalSeconds}
                  min={15}
                  max={300}
                  onChange={(value) => update('busyScanIntervalSeconds', value)}
                />
                <NumberField
                  label='常态扫描间隔（秒）'
                  value={draft.normalScanIntervalSeconds}
                  min={30}
                  max={1800}
                  onChange={(value) =>
                    update('normalScanIntervalSeconds', value)
                  }
                />
                <NumberField
                  label='闲时扫描间隔（秒）'
                  value={draft.idleScanIntervalSeconds}
                  min={60}
                  max={3600}
                  onChange={(value) => update('idleScanIntervalSeconds', value)}
                />
                <NumberField
                  label='忙时请求阈值（次/分钟）'
                  value={draft.busyRequestsPerMinute}
                  min={1}
                  max={100000}
                  onChange={(value) => update('busyRequestsPerMinute', value)}
                />
              </div>
            ) : (
              <NumberField
                label='固定扫描间隔（分钟）'
                value={draft.fixedScanIntervalMinutes}
                min={1}
                max={1440}
                onChange={(value) => update('fixedScanIntervalMinutes', value)}
              />
            )}
            <div className='grid grid-cols-3 gap-2 rounded-lg border bg-muted/20 p-3 text-center'>
              <div>
                <div className='text-[11px] text-muted-foreground'>忙时</div>
                <div className='mt-1 font-mono text-sm font-medium text-amber-700 dark:text-amber-300'>
                  {formatInterval(draft.busyScanIntervalSeconds)}
                </div>
              </div>
              <div className='border-x'>
                <div className='text-[11px] text-muted-foreground'>常态</div>
                <div className='mt-1 font-mono text-sm font-medium text-sky-700 dark:text-sky-300'>
                  {formatInterval(draft.normalScanIntervalSeconds)}
                </div>
              </div>
              <div>
                <div className='text-[11px] text-muted-foreground'>闲时</div>
                <div className='mt-1 font-mono text-sm font-medium text-emerald-700 dark:text-emerald-300'>
                  {formatInterval(draft.idleScanIntervalSeconds)}
                </div>
              </div>
            </div>
          </section>

          <Separator />

          <section className='space-y-3'>
            <div>
              <h3 className='text-sm font-semibold'>风险阈值与本地投影</h3>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                TPS 阈值沿用系统实际配置，修改后现有记录会立即重新分类。
              </p>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <NumberField
                label='观察阈值（TPS）'
                value={draft.watchTps}
                min={1}
                onChange={(value) => update('watchTps', value)}
              />
              <NumberField
                label='高风险阈值（TPS）'
                value={draft.highTps}
                min={1}
                onChange={(value) => update('highTps', value)}
              />
              <NumberField
                label='页面刷新间隔（秒）'
                value={draft.liveRefreshSeconds}
                min={10}
                max={300}
                disabled={!draft.liveRefreshEnabled}
                onChange={(value) => update('liveRefreshSeconds', value)}
              />
              <NumberField
                label='本地保留天数'
                value={draft.retentionDays}
                min={1}
                max={90}
                onChange={(value) => update('retentionDays', value)}
              />
            </div>
          </section>
        </div>

        <SheetFooter className='border-t pt-4 sm:flex-row sm:justify-end'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <RefreshCw className='animate-spin' /> : <CheckCircle2 />}
            保存并应用
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className='space-y-1.5'>
      <Label className='text-xs'>{label}</Label>
      <Input
        type='number'
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        className='font-mono tabular-nums'
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function ScheduleStat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className='min-w-0 rounded-lg border bg-background px-3 py-3'>
      <div className='text-[11px] text-muted-foreground'>{label}</div>
      <div
        className='mt-1 truncate font-mono text-base font-semibold tabular-nums'
        title={value}
      >
        {value}
      </div>
      <div className='mt-1 truncate text-[11px] text-muted-foreground'>
        {detail}
      </div>
    </div>
  )
}

function AuditSchedulePanel({
  config,
  activity,
  scan,
  status,
  nextRunAt,
  nextRunError,
  backgroundRefreshing,
}: {
  config: RequestAuditConfig
  activity: RequestAuditActivity | undefined
  scan: RequestAuditScanState | undefined
  status: RequestAuditStatus | undefined
  nextRunAt?: string | null
  nextRunError: boolean
  backgroundRefreshing: boolean
}) {
  const level = activity?.level
  const meta = level ? activityTone[level] : waitingActivityTone
  const recommendedIntervalSeconds = config.adaptiveScanEnabled
    ? (activity?.recommendedIntervalSeconds ?? config.normalScanIntervalSeconds)
    : config.fixedScanIntervalMinutes * 60
  const cadenceOptions: Array<{
    level: RequestAuditActivityLevel
    label: string
    seconds: number
    description: string
  }> = [
    {
      level: 'busy',
      label: '忙时',
      seconds: config.busyScanIntervalSeconds,
      description: '有分页积压、高流量或风险峰值时快速追踪',
    },
    {
      level: 'normal',
      label: '常态',
      seconds: config.normalScanIntervalSeconds,
      description: '有持续请求但未达到忙时条件',
    },
    {
      level: 'idle',
      label: '闲时',
      seconds: config.idleScanIntervalSeconds,
      description: '近期低流量时降低上游查询频率',
    },
  ]

  return (
    <div className='space-y-4'>
      <section className='overflow-hidden rounded-lg border bg-card'>
        <div className='flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <span
                className={cn(
                  'size-2.5 rounded-full ring-4 ring-background',
                  meta.dot,
                  level === 'busy' && 'motion-safe:animate-pulse'
                )}
              />
              <h2 className='text-sm font-semibold'>自适应审计运行状态</h2>
            </div>
            <p className='mt-1 text-xs leading-5 text-muted-foreground'>
              {config.adaptiveScanEnabled
                ? (activity?.reasons[0] ?? '等待最近请求数据判断忙闲状态')
                : '当前使用固定频率，扫描完成后按配置间隔注册下一次任务。'}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Badge
              variant={
                status?.schedule.enabled && level
                  ? level === 'busy'
                    ? 'warning'
                    : level === 'normal'
                      ? 'info'
                      : 'success'
                  : 'secondary'
              }
            >
              {status?.schedule.enabled
                ? config.adaptiveScanEnabled
                  ? (activity?.label ?? '等待判断')
                  : '固定频率运行中'
                : '自动扫描已停用'}
            </Badge>
            {status?.configured === false && (
              <Badge variant='destructive'>管理凭据未配置</Badge>
            )}
          </div>
        </div>

        <div className='grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5'>
          <ScheduleStat
            label='下次执行时间'
            value={
              status?.schedule.enabled
                ? nextRunError
                  ? '读取失败'
                  : nextRunAt
                    ? formatDate(nextRunAt)
                    : '正在重新排程'
                : '未安排'
            }
            detail='任务中心实际排程时间'
          />
          <ScheduleStat
            label='当前扫描间隔'
            value={formatInterval(recommendedIntervalSeconds)}
            detail={config.adaptiveScanEnabled ? '动态判断结果' : '固定配置'}
          />
          <ScheduleStat
            label='最近请求速率'
            value={`${formatNumber(activity?.requestsPerMinute ?? 0)} 次/分钟`}
            detail={`统计最近 ${formatNumber(activity?.sampleMinutes ?? 5, 0)} 分钟`}
          />
          <ScheduleStat
            label='最近峰值 TPS'
            value={`${formatNumber(activity?.maxTps ?? 0)} TPS`}
            detail={`${formatNumber(activity?.requests ?? 0, 0)} 次请求参与判断`}
          />
          <ScheduleStat
            label='本地审计投影'
            value={`${formatNumber(status?.localRecords ?? 0, 0)} 条`}
            detail={`保留 ${formatNumber(config.retentionDays, 0)} 天`}
          />
        </div>

        <div
          className='flex flex-col gap-1.5 border-t bg-muted/10 px-4 py-2.5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between'
          aria-live='polite'
        >
          <span>
            {scan?.lastSuccessAt
              ? `上次成功 ${formatDate(scan.lastSuccessAt)} · ${scan.lastPages} 页 · 新增 ${scan.lastNewRecords} 条`
              : '尚未完成当前窗口首次扫描'}
          </span>
          <span className='inline-flex items-center gap-1.5'>
            {backgroundRefreshing ? (
              <>
                <RefreshCw className='size-3 animate-spin text-primary' />
                后台同步本地视图
              </>
            ) : config.liveRefreshEnabled ? (
              `页面每 ${formatInterval(config.liveRefreshSeconds)}无感更新`
            ) : (
              '页面无感刷新已关闭'
            )}
          </span>
        </div>
      </section>

      <section className='overflow-hidden rounded-lg border bg-card'>
        <div className='border-b px-4 py-3'>
          <div>
            <h2 className='text-sm font-semibold'>扫描节奏与风险优先级</h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              与 Cron
              调度一样，每次任务完成后按当前忙闲状态安排下一次执行；忙时优先降低风险识别延迟。
            </p>
          </div>
        </div>

        <div className='grid gap-3 p-4 lg:grid-cols-3'>
          {cadenceOptions.map((option) => {
            const optionMeta = activityTone[option.level]
            const active = config.adaptiveScanEnabled && level === option.level
            return (
              <div
                key={option.level}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  active ? optionMeta.active : 'bg-background'
                )}
              >
                <div className='flex items-center justify-between gap-3'>
                  <div className='flex items-center gap-2'>
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        active ? optionMeta.dot : 'bg-border'
                      )}
                    />
                    <span className='text-sm font-medium'>{option.label}</span>
                  </div>
                  {active && (
                    <span
                      className={cn('text-[11px] font-medium', optionMeta.text)}
                    >
                      当前节奏
                    </span>
                  )}
                </div>
                <div className='mt-3 font-mono text-xl font-semibold tabular-nums'>
                  {formatInterval(option.seconds)}
                </div>
                <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                  {option.description}
                </p>
              </div>
            )
          })}
        </div>

        {(!config.adaptiveScanEnabled ||
          !config.riskEnabled ||
          scan?.lastError) && (
          <div className='flex flex-wrap gap-2 border-t bg-muted/10 px-4 py-3'>
            {!config.adaptiveScanEnabled && (
              <Badge variant='secondary'>当前使用固定扫描间隔</Badge>
            )}
            {!config.riskEnabled && (
              <Badge variant='warning'>TPS 风险识别已关闭</Badge>
            )}
            {scan?.lastError && (
              <span className='text-xs text-destructive'>{scan.lastError}</span>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

export function RequestAuditsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [riskPage, setRiskPage] = useState(1)
  const [riskPageSize, setRiskPageSize] = useState(25)
  const [mainView, setMainView] = useState<MainView>('overview')
  const [perspective, setPerspective] = useState<Perspective>('accounts')
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [workspaceRisk, setWorkspaceRisk] =
    useState<WorkspaceRiskFilter>('risky')
  const [auditSearch, setAuditSearch] = useState('')
  const [auditRisk, setAuditRisk] = useState<AuditRiskFilter>('all')
  const [auditNode, setAuditNode] = useState('all')
  const [selectedRiskAccountIds, setSelectedRiskAccountIds] = useState<
    number[]
  >([])
  const [selectedAuditRows, setSelectedAuditRows] = useState<
    Record<string, RequestAuditRecord>
  >({})
  const [bulkAction, setBulkAction] = useState<{
    kind: 'sso' | 'quarantine'
    source: AuditBulkActionSource
    accountIds: number[]
  } | null>(null)
  const [probeSelection, setProbeSelection] =
    useState<AuditProbeSelection | null>(null)
  const [sampleAccount, setSampleAccount] =
    useState<RequestAuditAccountRisk | null>(null)
  const [samplePage, setSamplePage] = useState(1)
  const [samplePageSize, setSamplePageSize] = useState(25)
  const [selectedNodeKey, setSelectedNodeKey] = useState('')
  const [selectedWindow, setSelectedWindow] = useState<RequestAuditWindowInput>(
    readRememberedRequestAuditWindow
  )
  const [customOpen, setCustomOpen] = useState(false)
  const [customRange, setCustomRange] = useState(() =>
    customRangeFromWindow(selectedWindow)
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [auditDetailOpen, setAuditDetailOpen] = useState(false)
  const [selectedAuditRecord, setSelectedAuditRecord] =
    useState<RequestAuditRecord | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<AuditConfigDraft>(() =>
    configDraft(undefined, undefined)
  )

  const deferredWorkspaceSearch = useDeferredValue(workspaceSearch)
  const deferredAuditSearch = useDeferredValue(auditSearch)
  const windowKey = `${selectedWindow.window}:${selectedWindow.startAt ?? ''}:${selectedWindow.endAt ?? ''}`
  const windowParams = useMemo(
    () => ({
      window: selectedWindow.window,
      startAt: selectedWindow.startAt,
      endAt: selectedWindow.endAt,
    }),
    [selectedWindow]
  )

  const statusQuery = useQuery({
    queryKey: ['request-audits', 'status'],
    queryFn: api.requestAuditStatus,
    refetchInterval: (query) => {
      const config = query.state.data?.config
      return config?.liveRefreshEnabled
        ? Math.max(10_000, config.liveRefreshSeconds * 1000)
        : false
    },
    refetchIntervalInBackground: true,
  })
  const config = statusQuery.data?.config ?? fallbackConfig
  const liveRefreshInterval = config.liveRefreshEnabled
    ? Math.max(10_000, config.liveRefreshSeconds * 1000)
    : false
  const effectiveAuditRisk = config.riskEnabled ? auditRisk : 'all'
  const schedulerQuery = useQuery({
    queryKey: ['scheduler'],
    queryFn: api.scheduler,
    refetchInterval: liveRefreshInterval,
    refetchIntervalInBackground: true,
  })
  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: api.profiles,
    enabled: probeSelection != null,
    staleTime: 60_000,
  })
  const egressQuery = useQuery({
    queryKey: ['egress'],
    queryFn: () => api.egress({ pageSize: 500 }),
    enabled: probeSelection != null || sampleAccount != null,
    staleTime: 60_000,
  })
  const accountSamplesQuery = useQuery({
    queryKey: [
      'account-samples',
      sampleAccount?.accountId ?? null,
      samplePage,
      samplePageSize,
    ],
    queryFn: () =>
      api.accountSamples(sampleAccount!.accountId!, {
        page: samplePage,
        pageSize: samplePageSize,
      }),
    enabled: sampleAccount?.accountId != null,
  })
  const egressNodeNames = useMemo(
    () => buildEgressNodeNameMap(egressQuery.data?.items),
    [egressQuery.data?.items]
  )

  const summaryQuery = useQuery({
    queryKey: ['request-audits', 'summary', windowKey],
    queryFn: () => api.requestAuditSummary(windowParams),
    placeholderData: keepPreviousData,
    refetchInterval: liveRefreshInterval,
    refetchIntervalInBackground: true,
  })
  const recordsQuery = useQuery({
    queryKey: [
      'request-audits',
      'records',
      windowKey,
      page,
      pageSize,
      deferredAuditSearch,
      effectiveAuditRisk,
      auditNode,
    ],
    queryFn: () =>
      api.requestAudits({
        ...windowParams,
        page,
        pageSize,
        account: deferredAuditSearch.trim(),
        risk: effectiveAuditRisk === 'all' ? '' : effectiveAuditRisk,
        egressNodeId: auditNode === 'all' ? undefined : Number(auditNode),
      }),
    placeholderData: keepPreviousData,
    refetchInterval: liveRefreshInterval,
    refetchIntervalInBackground: true,
  })
  const probeContextQuery = useQuery({
    queryKey: [
      'request-audits',
      'probe-context',
      selectedAuditRecord?.id ?? '',
      selectedAuditRecord?.requestId ?? '',
    ],
    queryFn: () =>
      api.requestAuditProbeContext({
        requestId: selectedAuditRecord?.requestId,
        auditId: selectedAuditRecord?.id.match(/^\d+$/)
          ? Number(selectedAuditRecord.id)
          : undefined,
      }),
    enabled: auditDetailOpen && Boolean(selectedAuditRecord),
    staleTime: 60_000,
  })

  const scanMutation = useMutation({
    mutationFn: () => api.scanRequestAudits(selectedWindow),
    onSuccess: (result) => {
      if (result.skipped) {
        toast.info(result.error || '本次请求审计扫描已跳过')
      } else if (result.ok === false) {
        toast.error(String(result.error ?? '请求审计扫描失败'))
      } else {
        const count = Number(result.newRecords ?? 0)
        if (result.state && !result.state.initialComplete) {
          toast.success(`本批读取 ${count} 条，游标已保存并等待续传`)
        } else {
          toast.success(
            count ? `增量读取 ${count} 条请求审计` : '当前窗口没有新增审计'
          )
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['request-audits'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const isolateMutation = useMutation({
    mutationFn: (account: RequestAuditAccountRisk) =>
      api.accountAction(account.accountId!, {
        action: 'quarantine',
        note: `请求审计峰值 ${formatNumber(account.maxTps)} Token/s；代理节点 ${accountNodeLabel(account)}`,
        propagate: true,
      }),
    onSuccess: () => {
      toast.success('账号已进入隔离状态')
      void queryClient.invalidateQueries({ queryKey: ['request-audits'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const bulkSsoMutation = useMutation({
    mutationFn: ({
      accountIds,
      name,
    }: {
      accountIds: number[]
      source: AuditBulkActionSource
      name: string
    }) => api.createAccountSsoReport(accountIds, name),
    onSuccess: (result, variables) => {
      setBulkAction(null)
      if (variables.source === 'risk') {
        setSelectedRiskAccountIds([])
      } else {
        setSelectedAuditRows({})
      }
      const skipped = result.missingAccountIds.length
      const message = `已创建关联 SSO 检查，包含 ${result.included} 个账号`
      if (skipped) {
        toast.warning(`${message}；${skipped} 个账号缺少 SSO，已跳过`)
      } else {
        toast.success(message)
      }
      void queryClient.invalidateQueries({ queryKey: ['sso-reports'] })
      void navigate({ to: '/sso-reports' })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const bulkIsolationMutation = useMutation({
    mutationFn: ({
      accountIds,
      note,
    }: {
      accountIds: number[]
      source: AuditBulkActionSource
      note: string
    }) =>
      api.accountBatchAction({
        account_ids: accountIds,
        action: 'quarantine',
        note,
        propagate: true,
      }),
    onSuccess: (result, variables) => {
      setBulkAction(null)
      const retainedIds = new Set([
        ...(result.skippedAccountIds ?? []),
        ...(result.alreadyQuarantinedAccountIds ?? []),
        ...(result.failedAccountIds ?? []),
      ])
      if (variables.source === 'risk') {
        setSelectedRiskAccountIds((current) =>
          current.filter((accountId) => retainedIds.has(accountId))
        )
      } else {
        setSelectedAuditRows((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([, record]) =>
              retainedIds.has(Number(record.accountId))
            )
          )
        )
      }
      const details = [`已隔离 ${result.updated} 个账号`]
      if (result.alreadyQuarantinedAccountIds?.length) {
        details.push(
          `${result.alreadyQuarantinedAccountIds.length} 个原本已隔离`
        )
      }
      if (result.skippedAccountIds?.length) {
        details.push(`${result.skippedAccountIds.length} 个受探针任务保护`)
      }
      if (result.failedAccountIds?.length) {
        details.push(`${result.failedAccountIds.length} 个操作失败并保留选择`)
      }
      if (
        result.skippedAccountIds?.length ||
        result.failedAccountIds?.length ||
        result.alreadyQuarantinedAccountIds?.length
      ) {
        toast.warning(details.join('；'))
      } else {
        toast.success(details[0])
      }
      void queryClient.invalidateQueries({ queryKey: ['request-audits'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const settingsMutation = useMutation({
    mutationFn: (body: RuntimeSettingsUpdate) => api.updateSettings(body),
    onSuccess: () => {
      toast.success('请求审计配置已保存并热应用')
      setSettingsOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['request-audits'] })
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['scheduler'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const summary = summaryQuery.data?.summary
  const accounts = useMemo(
    () => summaryQuery.data?.accounts ?? [],
    [summaryQuery.data?.accounts]
  )
  const nodes = useMemo(
    () => summaryQuery.data?.nodes ?? [],
    [summaryQuery.data?.nodes]
  )
  const trend = useMemo(
    () => summaryQuery.data?.trend ?? [],
    [summaryQuery.data?.trend]
  )
  const thresholds = statusQuery.data?.thresholds ??
    summaryQuery.data?.thresholds ??
    recordsQuery.data?.thresholds ?? { watch: 150, high: 500 }
  const upstreamAccountSnapshotAt =
    summaryQuery.data?.upstreamAccountSnapshotAt ??
    recordsQuery.data?.upstreamAccountSnapshotAt ??
    null

  const visibleAccounts = useMemo(() => {
    const needle = deferredWorkspaceSearch.trim().toLowerCase()
    const effectiveRisk = config.riskEnabled ? workspaceRisk : 'all'
    return accounts.filter((item) => {
      const matchesSearch =
        !needle ||
        item.accountName.toLowerCase().includes(needle) ||
        String(item.accountId ?? '').includes(needle) ||
        item.egressNodes.some((node) => node.toLowerCase().includes(needle)) ||
        item.egressNodeIds.some((id) => String(id).includes(needle))
      const matchesRisk =
        effectiveRisk === 'all' ||
        (effectiveRisk === 'risky'
          ? item.riskLevel !== 'normal'
          : item.riskLevel === effectiveRisk)
      return matchesSearch && matchesRisk
    })
  }, [accounts, config.riskEnabled, deferredWorkspaceSearch, workspaceRisk])
  const riskPageCount = Math.max(
    1,
    Math.ceil(visibleAccounts.length / riskPageSize)
  )
  const effectiveRiskPage = Math.min(riskPage, riskPageCount)
  const pagedVisibleAccounts = useMemo(
    () =>
      visibleAccounts.slice(
        (effectiveRiskPage - 1) * riskPageSize,
        effectiveRiskPage * riskPageSize
      ),
    [effectiveRiskPage, riskPageSize, visibleAccounts]
  )

  const visibleNodes = useMemo(() => {
    const needle = deferredWorkspaceSearch.trim().toLowerCase()
    const effectiveRisk = config.riskEnabled ? workspaceRisk : 'all'
    return nodes.filter((item) => {
      const matchesSearch =
        !needle ||
        item.egressNodeName.toLowerCase().includes(needle) ||
        String(item.egressNodeId ?? '').includes(needle) ||
        item.latestProbeIp.toLowerCase().includes(needle) ||
        item.accounts.some(
          (account) =>
            account.accountName.toLowerCase().includes(needle) ||
            String(account.accountId ?? '').includes(needle)
        )
      const matchesRisk =
        effectiveRisk === 'all' ||
        (effectiveRisk === 'risky'
          ? item.riskLevel !== 'normal'
          : item.riskLevel === effectiveRisk)
      return matchesSearch && matchesRisk
    })
  }, [config.riskEnabled, deferredWorkspaceSearch, nodes, workspaceRisk])

  const selectedNode =
    visibleNodes.find((item) => item.key === selectedNodeKey) ??
    visibleNodes[0] ??
    null
  const accountsById = useMemo(
    () =>
      new Map(
        accounts
          .filter((account) => account.accountId)
          .map((account): [number, RequestAuditAccountRisk] => [
            account.accountId!,
            account,
          ])
      ),
    [accounts]
  )
  const selectableRiskAccounts = useMemo(
    () =>
      (perspective === 'accounts'
        ? pagedVisibleAccounts
        : (selectedNode?.accounts ?? [])
      ).filter((account) => account.accountId),
    [pagedVisibleAccounts, perspective, selectedNode]
  )
  const selectableRiskAccountIds = useMemo(
    () =>
      uniqueAccountIds(selectableRiskAccounts.map((item) => item.accountId)),
    [selectableRiskAccounts]
  )
  const allVisibleRiskAccountsSelected =
    selectableRiskAccountIds.length > 0 &&
    selectableRiskAccountIds.every((accountId) =>
      selectedRiskAccountIds.includes(accountId)
    )
  const someVisibleRiskAccountsSelected = selectableRiskAccountIds.some(
    (accountId) => selectedRiskAccountIds.includes(accountId)
  )
  const ledgerRecords = recordsQuery.data?.items ?? []
  const selectableLedgerRecords = ledgerRecords.filter((record) =>
    Boolean(record.accountId)
  )
  const selectedLedgerRecords = Object.values(selectedAuditRows)
  const selectedLedgerAccountIds = uniqueAccountIds(
    selectedLedgerRecords.map((record) => record.accountId)
  )
  const allVisibleLedgerRowsSelected =
    selectableLedgerRecords.length > 0 &&
    selectableLedgerRecords.every((record) =>
      Boolean(selectedAuditRows[record.id])
    )
  const someVisibleLedgerRowsSelected = selectableLedgerRecords.some((record) =>
    Boolean(selectedAuditRows[record.id])
  )
  const bulkSelectionPending =
    bulkSsoMutation.isPending || bulkIsolationMutation.isPending

  const initialLoading =
    statusQuery.isLoading || summaryQuery.isLoading || recordsQuery.isLoading
  if (initialLoading && !statusQuery.data && !summaryQuery.data) {
    return (
      <Page>
        <LoadingState label='正在读取本地请求审计投影' />
      </Page>
    )
  }

  const status = statusQuery.data
  const activity = status?.activity
  const nextAuditScanAt = schedulerQuery.data?.systemJobs.find(
    (job) => job.id === 'system:request-audit-scan'
  )?.nextRunAt
  const activityMeta = activity
    ? activityTone[activity.level]
    : waitingActivityTone
  const scan =
    selectedWindow.window === 'today'
      ? status?.scan
      : summaryQuery.isPlaceholderData
        ? undefined
        : summaryQuery.data?.scan
  const needsInitialScan = Boolean(
    status?.configured && config.enabled && scan && !scan.initialComplete
  )
  const activeWindow = !summaryQuery.isPlaceholderData
    ? summaryQuery.data?.window
    : !recordsQuery.isPlaceholderData
      ? recordsQuery.data?.window
      : undefined
  const selectedWindowLabel =
    windowOptions.find((item) => item.value === selectedWindow.window)?.label ??
    '当天'
  const backgroundRefreshing = Boolean(
    (statusQuery.isFetching && statusQuery.data) ||
    (summaryQuery.isFetching && summaryQuery.data) ||
    (recordsQuery.isFetching && recordsQuery.data) ||
    (schedulerQuery.isFetching && schedulerQuery.data)
  )
  const isolate = (account: RequestAuditAccountRisk) => {
    if (
      !config.isolationEnabled ||
      !account.accountId ||
      isolateMutation.isPending
    )
      return
    if (
      !globalThis.window.confirm(
        `确认隔离账号 ${account.accountName || account.accountId}？\n峰值 ${formatNumber(account.maxTps)} Token/s\n代理节点 ${accountNodeLabel(account)}`
      )
    )
      return
    isolateMutation.mutate(account)
  }

  const setRiskAccountSelected = (accountId: number, checked: boolean) => {
    setSelectedRiskAccountIds((current) =>
      checked
        ? Array.from(new Set([...current, accountId]))
        : current.filter((value) => value !== accountId)
    )
  }

  const toggleVisibleRiskAccounts = () => {
    setSelectedRiskAccountIds((current) =>
      allVisibleRiskAccountsSelected
        ? current.filter(
            (accountId) => !selectableRiskAccountIds.includes(accountId)
          )
        : Array.from(new Set([...current, ...selectableRiskAccountIds]))
    )
  }

  const setAuditRowSelected = (
    record: RequestAuditRecord,
    checked: boolean
  ) => {
    setSelectedAuditRows((current) => {
      if (!checked) {
        const next = { ...current }
        delete next[record.id]
        return next
      }
      return { ...current, [record.id]: record }
    })
  }

  const toggleVisibleLedgerRows = () => {
    setSelectedAuditRows((current) => {
      const next = { ...current }
      if (allVisibleLedgerRowsSelected) {
        for (const record of selectableLedgerRecords) delete next[record.id]
      } else {
        for (const record of selectableLedgerRecords) next[record.id] = record
      }
      return next
    })
  }

  const beginBulkAction = (
    kind: 'sso' | 'quarantine',
    source: AuditBulkActionSource,
    values: number[]
  ) => {
    let accountIds = uniqueAccountIds(values)
    if (!accountIds.length) {
      toast.warning('当前选择中没有可关联的账号')
      return
    }
    if (accountIds.length > 1000) {
      toast.error('单次最多处理 1000 个关联账号，请缩小选择范围')
      return
    }
    if (kind === 'quarantine') {
      if (!config.isolationEnabled) {
        toast.warning('请求审计账号隔离操作当前已关闭')
        return
      }
      const before = accountIds.length
      accountIds = accountIds.filter(
        (accountId) => !accountsById.get(accountId)?.quarantined
      )
      if (!accountIds.length) {
        toast.info('所选账号均已处于隔离状态')
        return
      }
      if (accountIds.length < before) {
        toast.info(`已排除 ${before - accountIds.length} 个已隔离账号`)
      }
    }
    setBulkAction({ kind, source, accountIds })
  }

  const beginProbeCreation = (source: AuditBulkActionSource) => {
    const selectedRecords =
      source === 'ledger' ? selectedLedgerRecords : ([] as RequestAuditRecord[])
    const requestedIds =
      source === 'risk'
        ? uniqueAccountIds(selectedRiskAccountIds)
        : uniqueAccountIds(selectedRecords.map((record) => record.accountId))
    if (!requestedIds.length) {
      toast.warning('当前选择中没有可创建探针任务的账号')
      return
    }
    if (requestedIds.length > 1000) {
      toast.error('单次最多为 1000 个账号创建探针任务，请缩小选择范围')
      return
    }

    const ledgerStateByAccount = new Map<number, RequestAuditRecord>()
    for (const record of selectedRecords) {
      if (record.accountId) ledgerStateByAccount.set(record.accountId, record)
    }
    const accountState = (accountId: number) =>
      accountsById.get(accountId) ?? ledgerStateByAccount.get(accountId)
    const blockedIds = requestedIds.filter((accountId) => {
      const authStatus = accountState(accountId)?.upstreamAuthStatus
      return Boolean(authStatus) && authStatus !== 'active'
    })
    const blockedIdSet = new Set(blockedIds)
    const eligibleIds = requestedIds.filter(
      (accountId) => !blockedIdSet.has(accountId)
    )
    if (!eligibleIds.length) {
      toast.warning('所选账号的当前上游鉴权状态均不适合创建探针任务')
      return
    }
    if (blockedIds.length) {
      toast.info(
        `已排除 ${blockedIds.length} 个当前上游鉴权异常账号，其余账号将进入探针配置`
      )
    }

    setProbeSelection({
      source,
      accountIds: eligibleIds,
      disabledAccountCount: eligibleIds.filter(
        (accountId) => accountState(accountId)?.upstreamEnabled === false
      ).length,
      sourceRecordCount: source === 'ledger' ? selectedLedgerRecords.length : 0,
    })
  }

  const clearBulkSelection = (source: AuditBulkActionSource) => {
    if (source === 'risk') setSelectedRiskAccountIds([])
    else setSelectedAuditRows({})
  }

  const viewAccountAudits = (account: RequestAuditAccountRisk) => {
    setAuditSearch(String(account.accountId ?? account.accountName))
    setAuditNode('all')
    setPage(1)
    setMainView('ledger')
  }

  const openAccountSamples = (account: RequestAuditAccountRisk) => {
    if (!account.accountId) {
      toast.warning('该审计聚合缺少账号 ID，暂时没有可关联的探针样本')
      return
    }
    setSamplePage(1)
    setSampleAccount(account)
  }

  const openSettings = () => {
    setSettingsDraft(configDraft(status?.config, thresholds))
    setSettingsOpen(true)
  }

  const saveSettings = () => {
    if (settingsDraft.watchTps >= settingsDraft.highTps) {
      toast.error('观察阈值必须小于高风险阈值')
      return
    }
    if (
      settingsDraft.busyScanIntervalSeconds >
        settingsDraft.normalScanIntervalSeconds ||
      settingsDraft.normalScanIntervalSeconds >
        settingsDraft.idleScanIntervalSeconds
    ) {
      toast.error('扫描间隔必须满足忙时 ≤ 常态 ≤ 闲时')
      return
    }
    settingsMutation.mutate({
      requestAuditEnabled: settingsDraft.enabled,
      requestAuditAutoScanEnabled: settingsDraft.autoScanEnabled,
      requestAuditAdaptiveScanEnabled: settingsDraft.adaptiveScanEnabled,
      requestAuditScanIntervalMinutes: settingsDraft.fixedScanIntervalMinutes,
      requestAuditBusyScanIntervalSeconds:
        settingsDraft.busyScanIntervalSeconds,
      requestAuditNormalScanIntervalSeconds:
        settingsDraft.normalScanIntervalSeconds,
      requestAuditIdleScanIntervalSeconds:
        settingsDraft.idleScanIntervalSeconds,
      requestAuditBusyRequestsPerMinute: settingsDraft.busyRequestsPerMinute,
      requestAuditLiveRefreshEnabled: settingsDraft.liveRefreshEnabled,
      requestAuditLiveRefreshSeconds: settingsDraft.liveRefreshSeconds,
      requestAuditRiskEnabled: settingsDraft.riskEnabled,
      requestAuditIsolationEnabled: settingsDraft.isolationEnabled,
      requestAuditRetentionDays: settingsDraft.retentionDays,
      degradationTps: settingsDraft.watchTps,
      strongDegradationTps: settingsDraft.highTps,
    })
  }

  const chooseWindow = (value: RequestAuditWindowPreset) => {
    if (value === 'custom') {
      setCustomOpen(true)
      return
    }
    const nextWindow: RequestAuditWindowInput = { window: value }
    setSelectedWindow(nextWindow)
    rememberRequestAuditWindow(nextWindow)
    setBulkAction(null)
    setSelectedRiskAccountIds([])
    setSelectedAuditRows({})
    setRiskPage(1)
    setPage(1)
  }

  const applyCustomWindow = () => {
    const start = new Date(customRange.start)
    const end = new Date(customRange.end)
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end
    ) {
      toast.error('请选择有效的开始和结束时间')
      return
    }
    if (end.getTime() - start.getTime() > REQUEST_AUDIT_MAX_WINDOW_MS) {
      toast.error('单次时间窗口最多 90 天')
      return
    }
    const now = Date.now()
    if (start.getTime() < now - REQUEST_AUDIT_MAX_WINDOW_MS) {
      toast.error('开始时间需位于最近 90 天内')
      return
    }
    if (end.getTime() > now + 60 * 1000) {
      toast.error('结束时间不能晚于当前时间')
      return
    }
    const nextWindow: RequestAuditWindowInput = {
      window: 'custom',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    }
    setSelectedWindow(nextWindow)
    rememberRequestAuditWindow(nextWindow)
    setBulkAction(null)
    setSelectedRiskAccountIds([])
    setSelectedAuditRows({})
    setRiskPage(1)
    setPage(1)
    setCustomOpen(false)
  }

  const refreshLocal = () => {
    void Promise.all([
      statusQuery.refetch(),
      summaryQuery.refetch(),
      recordsQuery.refetch(),
      schedulerQuery.refetch(),
    ])
  }

  const openAuditDetail = (record: RequestAuditRecord) => {
    setSelectedAuditRecord(record)
    setAuditDetailOpen(true)
  }

  return (
    <Page>
      <PageHeader
        title='请求审计风险'
        description='本地增量投影 grok_build 请求；动态出口按稳定代理节点归因，最近探测 IP 仅辅助调整代理池。'
        descriptionAsHint
        actions={
          <>
            <Button variant='outline' onClick={refreshLocal}>
              <RefreshCw
                className={cn(backgroundRefreshing && 'animate-spin')}
              />
              刷新本地视图
            </Button>
            {mainView === 'schedule' && (
              <Button variant='outline' onClick={openSettings}>
                <Settings2 />
                运行配置
              </Button>
            )}
            <Button
              onClick={() => scanMutation.mutate()}
              disabled={
                scanMutation.isPending ||
                !config.enabled ||
                status?.configured === false
              }
            >
              {scanMutation.isPending ? (
                <RefreshCw className='animate-spin' />
              ) : (
                <Zap />
              )}
              扫描当前窗口
            </Button>
          </>
        }
      />

      <Tabs
        value={mainView}
        onValueChange={(value) => setMainView(value as MainView)}
        className='gap-4'
      >
        <TabsList className='h-auto w-full justify-start overflow-x-auto sm:w-fit'>
          <TabsTrigger value='overview'>
            <Activity />
            风险总览
          </TabsTrigger>
          <TabsTrigger value='workspace'>
            <ShieldAlert />
            风险定位
            <Badge variant='secondary'>
              {formatNumber(summary?.watchAccounts ?? 0, 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value='ledger'>
            <ListFilter />
            请求流水
            <Badge variant='secondary'>
              {formatNumber(recordsQuery.data?.total ?? 0, 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value='schedule'>
            <Timer />
            审计调度
          </TabsTrigger>
        </TabsList>

        <div className='flex flex-col gap-3 rounded-lg border bg-card px-3 py-3 shadow-xs lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center'>
            <div className='flex shrink-0 items-center gap-2'>
              <CalendarRange className='size-4 text-muted-foreground' />
              <span className='text-xs font-medium'>分析窗口</span>
              <Select
                value={selectedWindow.window}
                onValueChange={(value) =>
                  chooseWindow(value as RequestAuditWindowPreset)
                }
              >
                <SelectTrigger
                  className='h-8 w-36 text-xs'
                  aria-label='选择请求审计分析窗口'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {windowOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWindow.window === 'custom' && (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setCustomOpen(true)}
                >
                  修改
                </Button>
              )}
            </div>
            <div className='min-w-0 border-t pt-2 text-[11px] text-muted-foreground sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3'>
              <div className='truncate font-medium text-foreground'>
                {activeWindow?.label ?? selectedWindowLabel} · grok_build
                <span className='ml-2 font-normal text-muted-foreground'>
                  刷新后沿用
                </span>
              </div>
              <div
                className='truncate'
                title={
                  activeWindow
                    ? `${formatDate(activeWindow.startAt)} — ${formatDate(activeWindow.endAt)}`
                    : undefined
                }
              >
                {activeWindow
                  ? `${formatDate(activeWindow.startAt)} — ${formatDate(activeWindow.endAt)}`
                  : selectedWindow.window === 'custom'
                    ? '正在切换到自定义窗口'
                    : '正在读取所选窗口'}
              </div>
            </div>
          </div>

          <div
            className='flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground lg:justify-end lg:border-t-0 lg:pt-0'
            aria-live='polite'
          >
            <span className='inline-flex items-center gap-1.5'>
              <span
                className={cn(
                  'size-2 rounded-full',
                  activityMeta.dot,
                  activity?.level === 'busy' && 'motion-safe:animate-pulse'
                )}
              />
              <span className={cn('font-medium', activityMeta.text)}>
                {config.adaptiveScanEnabled
                  ? (activity?.label ?? '等待判断')
                  : '固定频率'}
              </span>
            </span>
            <span>
              {scan?.lastSuccessAt
                ? `上次成功 ${formatDate(scan.lastSuccessAt)}`
                : '当前窗口尚未完成首次扫描'}
            </span>
            <span>
              {status?.schedule.enabled
                ? schedulerQuery.isError
                  ? '下次执行时间读取失败'
                  : nextAuditScanAt
                    ? `下次执行 ${formatDate(nextAuditScanAt)}`
                    : '下次执行时间正在排程'
                : '自动扫描未安排下次执行'}
            </span>
            {backgroundRefreshing && (
              <span className='inline-flex items-center gap-1 text-primary'>
                <RefreshCw className='size-3 animate-spin' />
                后台更新
              </span>
            )}
          </div>
        </div>

        {(summaryQuery.error || recordsQuery.error || statusQuery.error) && (
          <Card className='border-destructive/35 bg-destructive/5'>
            <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex items-start gap-3'>
                <AlertTriangle className='mt-0.5 size-4 shrink-0 text-destructive' />
                <div>
                  <div className='text-sm font-medium'>
                    本地审计视图更新异常
                  </div>
                  <div className='mt-0.5 text-xs text-muted-foreground'>
                    {getErrorMessage(
                      summaryQuery.error ??
                        recordsQuery.error ??
                        statusQuery.error
                    )}
                  </div>
                </div>
              </div>
              <Button variant='outline' size='sm' onClick={refreshLocal}>
                <RefreshCw />
                重试本地查询
              </Button>
            </CardContent>
          </Card>
        )}

        {needsInitialScan && (
          <Card className='border-primary/30 bg-primary/5'>
            <CardContent className='flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='flex items-center gap-2 font-medium'>
                  <ShieldAlert className='size-4 text-primary' />
                  {scan?.initialResumePending
                    ? '继续当前窗口首次扫描'
                    : selectedWindow.window === 'today'
                      ? '开始当天首次扫描'
                      : '扫描所选时间窗口'}
                </div>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {scan?.initialResumePending
                    ? '已完成的分页和游标都保存在本地，继续执行不会形成数据缺口。'
                    : '首次读取会按上游游标分页，本地保存后页面刷新只查询 SQLite 投影。'}
                </p>
              </div>
              <Button
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
              >
                {scanMutation.isPending ? (
                  <RefreshCw className='animate-spin' />
                ) : (
                  <Zap />
                )}
                {scan?.initialResumePending ? '继续扫描' : '执行首次扫描'}
              </Button>
            </CardContent>
          </Card>
        )}

        <TabsContent value='overview' className='mt-0 space-y-4'>
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
            <MetricCard
              icon={Activity}
              label='窗口内请求'
              value={formatNumber(summary?.requests ?? 0, 0)}
              detail={`已测 TPS ${formatNumber(summary?.measuredRequests ?? 0, 0)} 条`}
              tone='info'
            />
            <MetricCard
              icon={Gauge}
              label='平均速度'
              value={`${formatNumber(summary?.averageTps ?? 0)} TPS`}
              detail={`P95 ${formatNumber(summary?.p95Tps ?? 0)} Token/s`}
            />
            <MetricCard
              icon={ArrowDown}
              label='峰值速度'
              value={`${formatNumber(summary?.maxTps ?? 0)} TPS`}
              detail={`观察阈值 ${formatNumber(thresholds.watch)} TPS`}
              tone={
                (summary?.maxTps ?? 0) >= thresholds.high
                  ? 'danger'
                  : (summary?.maxTps ?? 0) >= thresholds.watch
                    ? 'warning'
                    : 'default'
              }
            />
            <MetricCard
              icon={AlertTriangle}
              label='异常账号'
              value={formatNumber(summary?.watchAccounts ?? 0, 0)}
              detail={`${formatNumber(summary?.accountCount ?? 0, 0)} 个账号参与统计`}
              tone={(summary?.watchAccounts ?? 0) > 0 ? 'warning' : 'default'}
            />
            <MetricCard
              icon={ShieldAlert}
              label='高风险账号'
              value={formatNumber(summary?.highRiskAccounts ?? 0, 0)}
              detail={`${nodes.filter((item) => item.riskLevel !== 'normal').length} 个异常代理节点`}
              tone={(summary?.highRiskAccounts ?? 0) > 0 ? 'danger' : 'default'}
            />
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)]'>
            <Card>
              <CardHeader className='gap-2 sm:flex-row sm:items-start sm:justify-between'>
                <div>
                  <CardTitle className='flex items-center gap-2'>
                    <Timer className='size-4 text-primary' />
                    TPS 趋势与异常带
                  </CardTitle>
                  <CardDescription>
                    实线为平均 TPS，面积为峰值；虚线对应当前观察与高风险阈值。
                  </CardDescription>
                </div>
                <div className='flex items-center gap-3 text-[11px] text-muted-foreground'>
                  <span className='inline-flex items-center gap-1'>
                    <span className='h-0.5 w-4 bg-primary' />
                    平均
                  </span>
                  <span className='inline-flex items-center gap-1'>
                    <span className='h-2 w-4 rounded-sm bg-primary/20' />
                    峰值
                  </span>
                </div>
              </CardHeader>
              <CardContent className='h-72 px-2 pb-3 sm:px-4'>
                {trend.length && (summary?.requests ?? 0) > 0 ? (
                  <ResponsiveContainer width='100%' height='100%'>
                    <ComposedChart
                      data={trend}
                      margin={{ top: 8, right: 14, bottom: 0, left: -12 }}
                    >
                      <defs>
                        <linearGradient
                          id='auditPeakFill'
                          x1='0'
                          y1='0'
                          x2='0'
                          y2='1'
                        >
                          <stop
                            offset='5%'
                            stopColor='var(--chart-1)'
                            stopOpacity={0.32}
                          />
                          <stop
                            offset='95%'
                            stopColor='var(--chart-1)'
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray='3 3'
                        vertical={false}
                        stroke='var(--border)'
                        opacity={0.6}
                      />
                      <XAxis
                        dataKey='label'
                        tickLine={false}
                        axisLine={false}
                        minTickGap={28}
                        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                        tickFormatter={(value) =>
                          formatNumber(Number(value), 0)
                        }
                      />
                      <ChartTooltip
                        contentStyle={{
                          borderRadius: 8,
                          borderColor: 'var(--border)',
                          background: 'var(--popover)',
                          color: 'var(--popover-foreground)',
                          fontSize: 12,
                        }}
                        formatter={(value, name) => [
                          `${formatNumber(Number(value))} Token/s`,
                          name === 'averageTps' ? '平均 TPS' : '峰值 TPS',
                        ]}
                      />
                      {config.riskEnabled && (
                        <>
                          <ReferenceLine
                            y={thresholds.watch}
                            stroke='var(--chart-4)'
                            strokeDasharray='4 4'
                          />
                          <ReferenceLine
                            y={thresholds.high}
                            stroke='var(--destructive)'
                            strokeDasharray='4 4'
                          />
                        </>
                      )}
                      <Area
                        type='monotone'
                        dataKey='maxTps'
                        stroke='var(--chart-1)'
                        strokeOpacity={0.35}
                        fill='url(#auditPeakFill)'
                        isAnimationActive={false}
                      />
                      <Line
                        type='monotone'
                        dataKey='averageTps'
                        stroke='var(--chart-1)'
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    compact
                    className='h-full'
                    title='当前窗口暂无趋势数据'
                    description='执行扫描后会根据窗口跨度自动选择小时、6 小时、天或周粒度。'
                    icon={Timer}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Globe2 className='size-4 text-primary' />
                  高风险代理节点
                </CardTitle>
                <CardDescription>
                  按稳定节点归因；IP 仅作为最近探测快照辅助调整代理池。
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-2'>
                {nodes
                  .filter((item) => item.riskLevel !== 'normal')
                  .slice(0, 5)
                  .map((node) => (
                    <button
                      key={node.key}
                      type='button'
                      className='flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                      onClick={() => {
                        setMainView('workspace')
                        setPerspective('nodes')
                        setWorkspaceRisk('risky')
                        setSelectedNodeKey(node.key)
                      }}
                    >
                      <div
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          node.riskLevel === 'high'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        )}
                      >
                        {node.riskAccountCount}
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-xs font-medium'>
                          {node.egressNodeName || '未映射代理节点'}
                        </div>
                        <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                          {node.egressNodeId
                            ? `节点 #${node.egressNodeId}`
                            : '审计未返回节点 ID'}
                          {node.latestProbeIp
                            ? ` · 最近探测 IP ${node.latestProbeIp}`
                            : ''}
                        </div>
                      </div>
                      <div className='text-right'>
                        <div className='font-mono text-xs font-semibold tabular-nums'>
                          {formatNumber(node.maxTps)} TPS
                        </div>
                        <div className='mt-0.5 text-[10px] text-muted-foreground'>
                          {node.riskLevel === 'high' ? '高风险' : '观察'}
                        </div>
                      </div>
                    </button>
                  ))}
                {!nodes.some((item) => item.riskLevel !== 'normal') && (
                  <EmptyState
                    compact
                    title='暂无异常代理节点'
                    description={
                      config.riskEnabled
                        ? '当前窗口内没有代理节点包含超过系统 TPS 阈值的账号。'
                        : '开启 TPS 风险识别后显示异常代理节点。'
                    }
                    icon={ShieldAlert}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value='workspace' className='mt-0'>
          <Card>
            <CardHeader className='border-b'>
              <CardTitle>风险定位工作台</CardTitle>
              <CardDescription>
                账号、代理节点、请求流水和本地探针证据使用同一时间窗口联动定位。
                <span className='mt-1 block text-[11px] leading-5'>
                  P95（95% 分位）表示窗口内 95% 请求的 TPS
                  不高于该值；账号视角可分页查看全部本地探针样本，节点视角只使用该节点请求重新计算账号风险。
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className='p-0'>
              <Tabs
                value={perspective}
                onValueChange={(value) => {
                  setPerspective(value as Perspective)
                  setRiskPage(1)
                }}
                className='gap-0'
              >
                <div className='space-y-3 border-b bg-muted/10 p-3'>
                  <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
                    <div className='flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center'>
                      <TabsList className='h-auto w-full justify-start sm:w-fit'>
                        <TabsTrigger value='accounts'>
                          <UsersRound />
                          账号视角
                          <Badge variant='secondary' className='ml-1'>
                            {visibleAccounts.length}
                          </Badge>
                        </TabsTrigger>
                        <TabsTrigger value='nodes'>
                          <Layers3 />
                          代理节点视角
                          <Badge variant='secondary' className='ml-1'>
                            {visibleNodes.length}
                          </Badge>
                        </TabsTrigger>
                      </TabsList>
                      <div className='flex min-w-0 flex-1 flex-col gap-2 sm:flex-row'>
                        <Input
                          className='h-9 min-w-0 flex-1 text-xs sm:max-w-72'
                          placeholder='搜索账号、节点或最近探测 IP'
                          aria-label='搜索风险账号或代理节点'
                          value={workspaceSearch}
                          onChange={(event) => {
                            setWorkspaceSearch(event.target.value)
                            setRiskPage(1)
                          }}
                        />
                        <Select
                          value={config.riskEnabled ? workspaceRisk : 'all'}
                          disabled={!config.riskEnabled}
                          onValueChange={(value) => {
                            setWorkspaceRisk(value as WorkspaceRiskFilter)
                            setRiskPage(1)
                          }}
                        >
                          <SelectTrigger
                            className='h-9 w-full text-xs sm:w-48'
                            aria-label='筛选风险定位等级'
                          >
                            <ListFilter className='size-3.5' />
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='risky'>
                              所有异常
                              {perspective === 'accounts' ? '账号' : '节点'}
                            </SelectItem>
                            <SelectItem value='high'>仅高风险</SelectItem>
                            <SelectItem value='watch'>仅观察</SelectItem>
                            <SelectItem value='normal'>仅正常</SelectItem>
                            <SelectItem value='all'>
                              所有{perspective === 'accounts' ? '账号' : '节点'}
                              （含正常）
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className='flex max-w-full flex-wrap items-center gap-2'>
                      <ActionToolbar label='风险定位表格操作'>
                        <ToolbarAction
                          label='刷新风险定位数据'
                          pending={summaryQuery.isFetching}
                          onClick={() => void summaryQuery.refetch()}
                        >
                          <RefreshCw />
                        </ToolbarAction>
                        <ToolbarAction
                          label={
                            allVisibleRiskAccountsSelected
                              ? '取消选择当前视图账号'
                              : '选择当前视图全部账号'
                          }
                          active={allVisibleRiskAccountsSelected}
                          disabled={!selectableRiskAccountIds.length}
                          onClick={toggleVisibleRiskAccounts}
                        >
                          <ListChecks />
                        </ToolbarAction>
                      </ActionToolbar>
                      <SelectionToolbar
                        selectedCount={selectedRiskAccountIds.length}
                        entityLabel='账号'
                        disabled={bulkSelectionPending}
                        onClear={() => clearBulkSelection('risk')}
                      >
                        <ToolbarAction
                          label={`为已选 ${selectedRiskAccountIds.length} 个账号创建探针任务`}
                          disabled={bulkSelectionPending}
                          onClick={() => beginProbeCreation('risk')}
                        >
                          <Play />
                        </ToolbarAction>
                        <ToolbarAction
                          label={`关联检查已选 ${selectedRiskAccountIds.length} 个账号的 SSO`}
                          pending={
                            bulkSsoMutation.isPending &&
                            bulkAction?.source === 'risk'
                          }
                          disabled={bulkSelectionPending}
                          onClick={() =>
                            beginBulkAction(
                              'sso',
                              'risk',
                              selectedRiskAccountIds
                            )
                          }
                        >
                          <ScanSearch />
                        </ToolbarAction>
                        <ToolbarAction
                          label={`批量隔离已选 ${selectedRiskAccountIds.length} 个账号`}
                          pending={
                            bulkIsolationMutation.isPending &&
                            bulkAction?.source === 'risk'
                          }
                          destructive
                          disabled={
                            bulkSelectionPending || !config.isolationEnabled
                          }
                          onClick={() =>
                            beginBulkAction(
                              'quarantine',
                              'risk',
                              selectedRiskAccountIds
                            )
                          }
                        >
                          <LockKeyhole />
                        </ToolbarAction>
                      </SelectionToolbar>
                    </div>
                  </div>
                  <div className='flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground'>
                    <Badge variant='outline'>
                      统一窗口：{selectedWindowLabel}
                    </Badge>
                    <span>
                      {perspective === 'accounts' ? '当前页' : '当前节点'}{' '}
                      {selectableRiskAccountIds.length} 个可操作账号
                    </span>
                    <span>SSO 缺失账号会在创建报告时自动标记并跳过</span>
                    <span>代理节点仅展示前 2 个有效项，悬停可查看完整列表</span>
                    <span>
                      上游状态快照{' '}
                      {upstreamAccountSnapshotAt
                        ? formatDate(upstreamAccountSnapshotAt)
                        : '本次未获取'}
                      ，不代表历史请求时状态
                    </span>
                  </div>
                </div>

                <TabsContent value='accounts' className='mt-0'>
                  <div className='overflow-x-auto'>
                    <Table
                      className='min-w-[1420px] text-xs leading-4 [&_td]:py-1.5 [&_th]:h-9'
                      rememberRowKey='request-audit-accounts'
                    >
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-10'>
                            <Checkbox
                              checked={
                                allVisibleRiskAccountsSelected
                                  ? true
                                  : someVisibleRiskAccountsSelected
                                    ? 'indeterminate'
                                    : false
                              }
                              disabled={!selectableRiskAccountIds.length}
                              onCheckedChange={() =>
                                toggleVisibleRiskAccounts()
                              }
                              aria-label='选择当前风险账号视图'
                            />
                          </TableHead>
                          <TableHead>账号</TableHead>
                          <TableHead>
                            <span
                              className='inline-flex items-center gap-1'
                              title='最近一次从 grok2api 查询到的账号启停与鉴权快照，不代表历史请求发生时的状态。'
                            >
                              当前上游
                              <Info className='size-3.5 text-muted-foreground' />
                            </span>
                          </TableHead>
                          <TableHead>代理节点（前 2）</TableHead>
                          <TableHead>请求量</TableHead>
                          <TableHead>周期样本 / 信号</TableHead>
                          <TableHead>
                            <span
                              className='inline-flex items-center gap-1'
                              title='P95（95% 分位）：窗口内 95% 请求的 TPS 不高于该值，剩余 5% 请求更快。'
                            >
                              平均 / P95
                              <Info className='size-3.5 text-muted-foreground' />
                            </span>
                          </TableHead>
                          <TableHead>峰值 TPS</TableHead>
                          <TableHead>风险证据</TableHead>
                          <TableHead>最近请求</TableHead>
                          <TableHead className='text-right'>操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedVisibleAccounts.map((account) => (
                          <AccountRiskRow
                            key={`${account.accountId ?? 'unknown'}-${account.accountName}`}
                            account={account}
                            thresholds={thresholds}
                            isolationEnabled={config.isolationEnabled}
                            onIsolate={isolate}
                            onViewAudits={viewAccountAudits}
                            onViewSamples={openAccountSamples}
                            selected={
                              account.accountId
                                ? selectedRiskAccountIds.includes(
                                    account.accountId
                                  )
                                : false
                            }
                            onSelectedChange={(checked) => {
                              if (account.accountId) {
                                setRiskAccountSelected(
                                  account.accountId,
                                  checked
                                )
                              }
                            }}
                            isolating={
                              isolateMutation.isPending &&
                              isolateMutation.variables?.accountId ===
                                account.accountId
                            }
                          />
                        ))}
                        {!visibleAccounts.length && (
                          <TableRow>
                            <TableCell colSpan={11}>
                              <EmptyState
                                compact
                                title='没有匹配的账号'
                                description='调整搜索或风险筛选，也可以扫描当前时间窗口补充本地投影。'
                                icon={Gauge}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {visibleAccounts.length > 0 && (
                    <div className='px-4 pb-4'>
                      <ServerPagination
                        page={effectiveRiskPage}
                        pageSize={riskPageSize}
                        total={visibleAccounts.length}
                        disabled={summaryQuery.isFetching}
                        loading={summaryQuery.isFetching}
                        itemLabel='账号'
                        pageSizeOptions={[25, 50, 100]}
                        onPageChange={setRiskPage}
                        onPageSizeChange={(value) => {
                          setRiskPageSize(value)
                          setRiskPage(1)
                        }}
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value='nodes' className='mt-0'>
                  <NodePerspective
                    nodes={visibleNodes}
                    selected={selectedNode}
                    thresholds={thresholds}
                    isolationEnabled={config.isolationEnabled}
                    isolatingAccountId={isolateMutation.variables?.accountId}
                    isolationPending={isolateMutation.isPending}
                    selectedAccountIds={selectedRiskAccountIds}
                    onSelectedChange={setRiskAccountSelected}
                    onSelect={(node) => setSelectedNodeKey(node.key)}
                    onIsolate={isolate}
                    onViewSamples={openAccountSamples}
                    onFilterAudits={(node) => {
                      if (!node.egressNodeId) return
                      setAuditNode(String(node.egressNodeId))
                      setPage(1)
                      setMainView('ledger')
                    }}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='ledger' className='mt-0'>
          <Card>
            <CardHeader className='border-b'>
              <CardTitle>请求审计流水</CardTitle>
              <CardDescription>
                本地增量投影原位刷新；选中请求后按关联账号发起 SSO
                检查或批量隔离，详情中可继续查看对应探针任务样本。
              </CardDescription>
            </CardHeader>
            <CardContent className='p-0'>
              <div className='space-y-3 border-b bg-muted/10 p-3'>
                <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
                  <div className='grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_13rem_14rem]'>
                    <Input
                      className='h-9 min-w-0 text-xs'
                      placeholder='搜索账号名、账号 ID 或请求 ID'
                      aria-label='搜索请求审计流水'
                      value={auditSearch}
                      onChange={(event) => {
                        setAuditSearch(event.target.value)
                        setPage(1)
                      }}
                    />
                    <Select
                      value={auditNode}
                      onValueChange={(value) => {
                        setAuditNode(value)
                        setPage(1)
                      }}
                    >
                      <SelectTrigger
                        className='h-9 w-full text-xs'
                        aria-label='按代理节点筛选请求流水'
                      >
                        <Layers3 className='size-3.5' />
                        <SelectValue placeholder='所有代理节点' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all'>所有代理节点</SelectItem>
                        {nodes
                          .filter((item) => item.egressNodeId)
                          .map((item) => (
                            <SelectItem
                              key={item.key}
                              value={String(item.egressNodeId)}
                            >
                              {item.egressNodeName ||
                                `节点 #${item.egressNodeId}`}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={effectiveAuditRisk}
                      disabled={!config.riskEnabled}
                      onValueChange={(value) => {
                        setAuditRisk(value as AuditRiskFilter)
                        setPage(1)
                      }}
                    >
                      <SelectTrigger
                        className='h-9 w-full text-xs'
                        aria-label='按风险范围筛选请求流水'
                      >
                        <ShieldAlert className='size-3.5' />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all'>所有记录（含正常）</SelectItem>
                        <SelectItem value='risky'>
                          所有异常（观察 + 高风险）
                        </SelectItem>
                        <SelectItem value='high'>仅高风险记录</SelectItem>
                        <SelectItem value='watch'>仅观察记录</SelectItem>
                        <SelectItem value='normal'>仅正常记录</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='flex max-w-full flex-wrap items-center gap-2'>
                    <ActionToolbar label='请求审计流水表格操作'>
                      <ToolbarAction
                        label='刷新请求流水'
                        pending={recordsQuery.isFetching}
                        onClick={() => void recordsQuery.refetch()}
                      >
                        <RefreshCw />
                      </ToolbarAction>
                      <ToolbarAction
                        label={
                          allVisibleLedgerRowsSelected
                            ? '取消选择当前页请求'
                            : '选择当前页可关联请求'
                        }
                        active={allVisibleLedgerRowsSelected}
                        disabled={!selectableLedgerRecords.length}
                        onClick={toggleVisibleLedgerRows}
                      >
                        <ListChecks />
                      </ToolbarAction>
                    </ActionToolbar>
                    <SelectionToolbar
                      selectedCount={selectedLedgerRecords.length}
                      entityLabel='条请求'
                      countLabel={`已选 ${selectedLedgerRecords.length} 条 · ${selectedLedgerAccountIds.length} 个账号`}
                      disabled={bulkSelectionPending}
                      onClear={() => clearBulkSelection('ledger')}
                    >
                      <ToolbarAction
                        label={`为 ${selectedLedgerAccountIds.length} 个关联账号创建探针任务`}
                        disabled={
                          bulkSelectionPending ||
                          selectedLedgerAccountIds.length === 0
                        }
                        onClick={() => beginProbeCreation('ledger')}
                      >
                        <Play />
                      </ToolbarAction>
                      <ToolbarAction
                        label={`关联检查 ${selectedLedgerAccountIds.length} 个账号的 SSO`}
                        pending={
                          bulkSsoMutation.isPending &&
                          bulkAction?.source === 'ledger'
                        }
                        disabled={
                          bulkSelectionPending ||
                          selectedLedgerAccountIds.length === 0
                        }
                        onClick={() =>
                          beginBulkAction(
                            'sso',
                            'ledger',
                            selectedLedgerAccountIds
                          )
                        }
                      >
                        <ScanSearch />
                      </ToolbarAction>
                      <ToolbarAction
                        label={`批量隔离 ${selectedLedgerAccountIds.length} 个关联账号`}
                        pending={
                          bulkIsolationMutation.isPending &&
                          bulkAction?.source === 'ledger'
                        }
                        destructive
                        disabled={
                          bulkSelectionPending ||
                          !config.isolationEnabled ||
                          selectedLedgerAccountIds.length === 0
                        }
                        onClick={() =>
                          beginBulkAction(
                            'quarantine',
                            'ledger',
                            selectedLedgerAccountIds
                          )
                        }
                      >
                        <LockKeyhole />
                      </ToolbarAction>
                    </SelectionToolbar>
                    {(auditSearch.trim() ||
                      auditNode !== 'all' ||
                      auditRisk !== 'all') && (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          setAuditSearch('')
                          setAuditNode('all')
                          setAuditRisk('all')
                          setPage(1)
                        }}
                      >
                        清除筛选
                      </Button>
                    )}
                  </div>
                </div>
                <div className='flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground'>
                  <Badge variant='outline'>
                    本页 {ledgerRecords.length} 条
                  </Badge>
                  <span>
                    风险筛选“所有记录”包含正常请求；“所有异常”只包含观察与高风险。
                  </span>
                  <span>同一账号的多条请求在批量操作时自动去重</span>
                  <span>
                    账号状态快照{' '}
                    {upstreamAccountSnapshotAt
                      ? formatDate(upstreamAccountSnapshotAt)
                      : '本次未获取'}
                    ，不是该请求发生时状态
                  </span>
                </div>
              </div>
              <div
                className={cn(
                  'overflow-x-auto transition-opacity',
                  recordsQuery.isPlaceholderData && 'opacity-70'
                )}
                aria-busy={recordsQuery.isFetching}
              >
                <Table
                  className='min-w-[1240px] text-xs leading-4 [&_td]:py-1.5 [&_th]:h-9'
                  rememberRowKey='request-audit-ledger'
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-10'>
                        <Checkbox
                          checked={
                            allVisibleLedgerRowsSelected
                              ? true
                              : someVisibleLedgerRowsSelected
                                ? 'indeterminate'
                                : false
                          }
                          disabled={!selectableLedgerRecords.length}
                          onCheckedChange={() => toggleVisibleLedgerRows()}
                          aria-label='选择当前页可关联请求'
                        />
                      </TableHead>
                      <TableHead>时间 / 请求</TableHead>
                      <TableHead>账号</TableHead>
                      <TableHead>代理节点</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>输出 Token</TableHead>
                      <TableHead>速度</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>风险</TableHead>
                      <TableHead className='text-right'>详情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(recordsQuery.data?.items ?? []).map((row) => (
                      <AuditRow
                        key={row.id}
                        row={row}
                        thresholds={thresholds}
                        selected={Boolean(selectedAuditRows[row.id])}
                        onSelectedChange={(checked) =>
                          setAuditRowSelected(row, checked)
                        }
                        onOpenDetail={openAuditDetail}
                      />
                    ))}
                    {!recordsQuery.data?.items.length && (
                      <TableRow>
                        <TableCell colSpan={10}>
                          <EmptyState
                            compact
                            title='当前条件暂无审计记录'
                            description='调整筛选条件或点击“扫描当前窗口”读取对应时间范围。'
                            icon={Globe2}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className='px-4 pb-4'>
                <ServerPagination
                  page={recordsQuery.data?.page ?? page}
                  pageSize={pageSize}
                  total={recordsQuery.data?.total ?? 0}
                  disabled={recordsQuery.isFetching}
                  loading={recordsQuery.isFetching}
                  itemLabel='请求'
                  pageSizeOptions={[25, 50, 100]}
                  onPageChange={setPage}
                  onPageSizeChange={(value) => {
                    setPageSize(value)
                    setPage(1)
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='schedule' className='mt-0'>
          <AuditSchedulePanel
            config={config}
            activity={activity}
            scan={scan}
            status={status}
            nextRunAt={nextAuditScanAt}
            nextRunError={schedulerQuery.isError}
            backgroundRefreshing={backgroundRefreshing}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <CalendarRange className='size-4 text-primary' />
              自定义审计时间窗口
            </DialogTitle>
            <DialogDescription>
              支持最近 90
              天内任意窗口。应用后页面先读取本地投影，点击扫描才访问上游审计接口。
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-2 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='audit-window-start'>开始时间</Label>
              <Input
                id='audit-window-start'
                type='datetime-local'
                value={customRange.start}
                onChange={(event) =>
                  setCustomRange((current) => ({
                    ...current,
                    start: event.target.value,
                  }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='audit-window-end'>结束时间</Label>
              <Input
                id='audit-window-end'
                type='datetime-local'
                value={customRange.end}
                onChange={(event) =>
                  setCustomRange((current) => ({
                    ...current,
                    end: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCustomOpen(false)}>
              取消
            </Button>
            <Button onClick={applyCustomWindow}>
              <CheckCircle2 />
              应用窗口
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={bulkAction?.kind === 'sso'}
        onOpenChange={(open) => {
          if (!open && !bulkSsoMutation.isPending) setBulkAction(null)
        }}
        title={`关联检查 ${bulkAction?.accountIds.length ?? 0} 个账号的 SSO？`}
        desc={
          <div className='space-y-2'>
            <p>
              将从
              {bulkAction?.source === 'risk' ? '风险定位' : '请求流水'}
              的当前选择创建 SSO 检查报告，并跳转到报告页面查看进度与结果。
            </p>
            <p className='text-muted-foreground'>
              账号会按 ID 去重；缺少注册联动 SSO 的账号会被标记并跳过。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          bulkSsoMutation.isPending ? (
            <>
              <RefreshCw className='animate-spin' />
              创建中…
            </>
          ) : (
            <>
              <ScanSearch />
              创建关联检查
            </>
          )
        }
        isLoading={bulkSsoMutation.isPending}
        disabled={!bulkAction?.accountIds.length}
        handleConfirm={() => {
          if (!bulkAction || bulkAction.kind !== 'sso') return
          bulkSsoMutation.mutate({
            accountIds: bulkAction.accountIds,
            source: bulkAction.source,
            name: `请求审计关联 SSO · ${selectedWindowLabel}`,
          })
        }}
      />

      <ConfirmDialog
        open={bulkAction?.kind === 'quarantine'}
        onOpenChange={(open) => {
          if (!open && !bulkIsolationMutation.isPending) setBulkAction(null)
        }}
        title={`批量隔离 ${bulkAction?.accountIds.length ?? 0} 个风险账号？`}
        desc={
          <div className='space-y-2'>
            <p>
              将同步停用所选账号，并写入请求审计风险处置记录；系统隔离恢复任务会按现有配置处理到期账号。
            </p>
            <p className='text-muted-foreground'>
              正在执行探针或等待设置恢复的账号会跳过并保留选择，避免任务恢复覆盖本次处置。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          bulkIsolationMutation.isPending ? (
            <>
              <RefreshCw className='animate-spin' />
              隔离中…
            </>
          ) : (
            <>
              <LockKeyhole />
              确认批量隔离
            </>
          )
        }
        destructive
        isLoading={bulkIsolationMutation.isPending}
        disabled={!bulkAction?.accountIds.length}
        handleConfirm={() => {
          if (!bulkAction || bulkAction.kind !== 'quarantine') return
          const maxTps = Math.max(
            0,
            ...bulkAction.accountIds.map(
              (accountId) => accountsById.get(accountId)?.maxTps ?? 0
            )
          )
          bulkIsolationMutation.mutate({
            accountIds: bulkAction.accountIds,
            source: bulkAction.source,
            note: `请求审计批量隔离；窗口 ${selectedWindowLabel}；所选账号峰值最高 ${formatNumber(maxTps)} Token/s`,
          })
        }}
      />

      <Dialog
        open={sampleAccount != null}
        onOpenChange={(open) => {
          if (!open) setSampleAccount(null)
        }}
      >
        <DialogContent
          size='wide'
          className='flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden'
        >
          <DialogHeader className='shrink-0'>
            <DialogTitle className='flex items-center gap-2'>
              <Activity className='size-5 text-primary' />
              账号全部探针样本
            </DialogTitle>
            <DialogDescription>
              {sampleAccount
                ? `${sampleAccount.accountName || `账号 ${sampleAccount.accountId}`} · ID ${sampleAccount.accountId}`
                : '按时间倒序分页查看该账号保存在 GrokIQ 的全部探针样本。'}
            </DialogDescription>
          </DialogHeader>

          {sampleAccount && (
            <div className='flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs'>
              <RiskBadge
                value={sampleAccount.riskLevel}
                thresholds={thresholds}
              />
              <Badge variant='outline'>
                周期样本 {sampleAccount.probeSampleCount} / 信号{' '}
                {sampleAccount.probeAnomalyCount}
              </Badge>
              <Badge variant='outline'>
                审计峰值 {formatNumber(sampleAccount.maxTps)} Token/s
              </Badge>
              <UpstreamAccountState account={sampleAccount} compact />
              <span className='text-muted-foreground'>
                “周期样本”用于当前监控判定；下方总数包含该账号全部本地历史样本。
              </span>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                className='ms-auto h-7 px-2 text-xs'
                disabled={accountSamplesQuery.isFetching}
                onClick={() => void accountSamplesQuery.refetch()}
              >
                <RefreshCw
                  className={
                    accountSamplesQuery.isFetching ? 'animate-spin' : undefined
                  }
                />
                刷新样本
              </Button>
            </div>
          )}

          <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain pe-1'>
            {accountSamplesQuery.isLoading ? (
              <LoadingState label='正在读取账号全部探针样本' />
            ) : accountSamplesQuery.isError ? (
              <div className='flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-6 text-center'>
                <AlertTriangle className='size-6 text-destructive' />
                <div>
                  <div className='text-sm font-medium'>探针样本读取异常</div>
                  <div className='mt-1 max-w-xl text-xs break-words text-muted-foreground'>
                    {getErrorMessage(accountSamplesQuery.error)}
                  </div>
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => void accountSamplesQuery.refetch()}
                >
                  <RefreshCw />
                  重试
                </Button>
              </div>
            ) : accountSamplesQuery.data?.items.length ? (
              <div className='space-y-3'>
                <AccountSampleExplorer
                  key={`${sampleAccount?.accountId}:${accountSamplesQuery.data.page}:${samplePageSize}`}
                  samples={accountSamplesQuery.data.items}
                  egressNodeNames={egressNodeNames}
                  countLabel={`本页 ${accountSamplesQuery.data.items.length} / 共 ${accountSamplesQuery.data.total}`}
                />
                <ServerPagination
                  page={accountSamplesQuery.data.page}
                  pageSize={accountSamplesQuery.data.pageSize}
                  total={accountSamplesQuery.data.total}
                  disabled={accountSamplesQuery.isFetching}
                  loading={accountSamplesQuery.isFetching}
                  itemLabel='样本'
                  pageSizeOptions={[25, 50, 100]}
                  onPageChange={setSamplePage}
                  onPageSizeChange={(value) => {
                    setSamplePageSize(value)
                    setSamplePage(1)
                  }}
                />
              </div>
            ) : (
              <EmptyState
                title='该账号暂无探针样本'
                description='可从当前选择创建探针任务；任务产生的所有本地样本会在这里按页展示。'
                icon={Activity}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProbeDialog
        open={probeSelection != null}
        onOpenChange={(open) => {
          if (!open) setProbeSelection(null)
        }}
        accountIds={probeSelection?.accountIds ?? []}
        disabledAccountCount={probeSelection?.disabledAccountCount ?? 0}
        sourceAuditCount={probeSelection?.sourceRecordCount ?? 0}
        profiles={profilesQuery.data ?? []}
        profilesLoading={profilesQuery.isFetching && !profilesQuery.data}
        profilesError={
          profilesQuery.isError ? getErrorMessage(profilesQuery.error) : ''
        }
        onRefreshProfiles={() => void profilesQuery.refetch()}
        egress={egressQuery.data?.items ?? []}
        egressLoading={egressQuery.isFetching}
        egressError={
          egressQuery.isError ? getErrorMessage(egressQuery.error) : ''
        }
        onRefreshEgress={() => void egressQuery.refetch()}
        onCreated={() => {
          if (probeSelection?.source === 'risk') {
            setSelectedRiskAccountIds([])
          } else {
            setSelectedAuditRows({})
          }
          void queryClient.invalidateQueries({ queryKey: ['runs'] })
          void queryClient.invalidateQueries({ queryKey: ['request-audits'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
      />

      <AuditRecordDetailDialog
        open={auditDetailOpen}
        record={selectedAuditRecord}
        thresholds={thresholds}
        probeSamples={
          probeContextQuery.data?.samples ??
          selectedAuditRecord?.probeSamples ??
          []
        }
        probeLoading={probeContextQuery.isLoading}
        probeError={
          probeContextQuery.error
            ? getErrorMessage(probeContextQuery.error)
            : ''
        }
        onProbeRetry={() => void probeContextQuery.refetch()}
        onOpenChange={(open) => {
          setAuditDetailOpen(open)
          if (!open) setSelectedAuditRecord(null)
        }}
      />

      <AuditConfigurationSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        draft={settingsDraft}
        setDraft={setSettingsDraft}
        saving={settingsMutation.isPending}
        onSave={saveSettings}
      />
    </Page>
  )
}

function AuditRecordDetailDialog({
  open,
  record,
  thresholds,
  probeSamples,
  probeLoading,
  probeError,
  onProbeRetry,
  onOpenChange,
}: {
  open: boolean
  record: RequestAuditRecord | null
  thresholds: RequestAuditThresholds
  probeSamples: RequestAuditProbeContext[]
  probeLoading: boolean
  probeError: string
  onProbeRetry: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='wide' className='overflow-hidden'>
        <DialogHeader className='shrink-0'>
          <DialogTitle className='flex items-center gap-2'>
            <Eye className='size-5 text-primary' />
            请求审计详情
          </DialogTitle>
          <DialogDescription className='break-all'>
            {record
              ? `${record.accountName || `账号 ${record.accountId ?? '未知'}`} · ${formatDate(record.createdAt)}`
              : '请求审计详情'}
          </DialogDescription>
        </DialogHeader>

        {record && (
          <div className='min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pe-1'>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <div className='rounded-lg border bg-muted/15 p-3'>
                <div className='text-[11px] text-muted-foreground'>速度</div>
                <div className='mt-1 font-mono text-lg font-semibold tabular-nums'>
                  <Tps value={record.tps} />
                </div>
              </div>
              <div className='rounded-lg border bg-muted/15 p-3'>
                <div className='text-[11px] text-muted-foreground'>
                  输出 Token
                </div>
                <div className='mt-1 font-mono text-lg font-semibold tabular-nums'>
                  {formatNumber(record.outputTokens, 0)}
                </div>
              </div>
              <div className='rounded-lg border bg-muted/15 p-3'>
                <div className='text-[11px] text-muted-foreground'>耗时</div>
                <div className='mt-1 font-mono text-lg font-semibold tabular-nums'>
                  {record.durationMs
                    ? `${formatNumber(record.durationMs, 0)} ms`
                    : '未测量'}
                </div>
              </div>
              <div className='rounded-lg border bg-muted/15 p-3'>
                <div className='text-[11px] text-muted-foreground'>风险</div>
                <div className='mt-1'>
                  <RiskBadge value={record.riskLevel} thresholds={thresholds} />
                </div>
              </div>
            </div>

            <dl className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              <AuditDetailField
                label='请求 ID'
                value={record.requestId || '—'}
                mono
              />
              <AuditDetailField label='审计 ID' value={record.id} mono />
              <AuditDetailField
                label='账号'
                value={`${record.accountName || `账号 ${record.accountId ?? '未知'}`} · ID ${record.accountId ?? '未知'}`}
              />
              <AuditDetailField
                label='当前上游状态'
                value={upstreamAccountStatusText(record)}
              />
              <AuditDetailField
                label='代理节点'
                value={`${record.egressNodeName || '未映射代理节点'} · ID ${record.egressNodeId ?? '未知'}`}
              />
              <AuditDetailField
                label='模型'
                value={record.modelPublicId || record.modelUpstreamModel || '—'}
              />
              <AuditDetailField
                label='操作'
                value={record.operation || 'responses'}
              />
              <AuditDetailField
                label='创建时间'
                value={formatDate(record.createdAt)}
              />
              <AuditDetailField
                label='首 Token 延迟'
                value={
                  record.firstTokenMs == null
                    ? '—'
                    : `${formatNumber(record.firstTokenMs, 0)} ms`
                }
              />
              <AuditDetailField
                label='状态码'
                value={String(record.statusCode || '—')}
                mono
              />
              <AuditDetailField
                label='输入 Token'
                value={formatNumber(record.inputTokens, 0)}
                mono
              />
              <AuditDetailField
                label='推理 Token'
                value={formatNumber(record.reasoningTokens, 0)}
                mono
              />
              <AuditDetailField
                label='总 Token'
                value={formatNumber(record.totalTokens, 0)}
                mono
              />
            </dl>

            <div className='rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 text-sm'>
              <div className='font-medium text-sky-800 dark:text-sky-200'>
                节点归因说明
              </div>
              <p className='mt-1 leading-5 text-muted-foreground'>
                历史请求保留代理节点标识；动态 IP
                只在节点视角显示最近探测快照，不代表本条请求当时使用的 IP。
                账号启停与鉴权同样来自最近的上游查询快照，不回写为历史状态。
              </p>
            </div>

            <div className='space-y-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <h3 className='text-sm font-semibold'>关联探针任务样本</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    这里展示 GrokIQ 本地探针任务与这条请求审计的交叉证据。
                  </p>
                </div>
                {probeLoading && (
                  <RefreshCw className='size-4 animate-spin text-primary' />
                )}
              </div>
              {probeError && (
                <div className='flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between'>
                  <span className='text-destructive'>
                    探针样本读取异常：{probeError}
                  </span>
                  <Button variant='outline' size='sm' onClick={onProbeRetry}>
                    <RefreshCw />
                    重试
                  </Button>
                </div>
              )}
              {!probeLoading && !probeError && !probeSamples.length && (
                <div className='rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground'>
                  未找到关联的本地探针样本
                </div>
              )}
              <div className='space-y-3'>
                {probeSamples.map((context) => (
                  <ProbeAuditSampleCard
                    key={context.sample.id}
                    context={context}
                  />
                ))}
              </div>
            </div>

            {record.riskReasons.length > 0 && (
              <div className='rounded-lg border border-amber-500/25 bg-amber-500/5 p-3'>
                <div className='text-sm font-medium text-amber-800 dark:text-amber-200'>
                  风险依据
                </div>
                <ul className='mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
                  {record.riskReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProbeAuditSampleCard({
  context,
}: {
  context: RequestAuditProbeContext
}) {
  const sample = context.sample
  const run = context.run
  const target =
    sample.target_kind === 'current'
      ? '账号当前节点'
      : sample.target_kind === 'direct'
        ? '上游调度诊断'
        : sample.egress_name || sample.target_key
  return (
    <div className='rounded-xl border bg-card'>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-3'>
        <span className='text-sm font-semibold'>
          {run.planName || '手动探针任务'}
        </span>
        <Badge variant='outline'>第 {sample.round_number} 轮</Badge>
        <Badge variant='secondary'>{target}</Badge>
        <StatusBadge value={sample.classification || sample.status} />
        <span className='ms-auto text-xs text-muted-foreground'>
          {formatDate(sample.created_at)}
        </span>
        <Button asChild variant='ghost' size='sm'>
          <Link to='/runs'>
            <ExternalLink />
            任务中心
          </Link>
        </Button>
      </div>
      <div className='grid gap-3 border-b bg-muted/15 p-4 sm:grid-cols-2 lg:grid-cols-5'>
        <AuditSampleMetric label='任务状态' value={run.status} />
        <AuditSampleMetric
          label='TPS'
          value={`${formatNumber(sample.tps)} Token/s`}
          mono
        />
        <AuditSampleMetric
          label='首 Token'
          value={`${formatNumber(sample.first_token_ms, 0)} ms`}
          mono
        />
        <AuditSampleMetric
          label='总耗时'
          value={`${formatNumber(sample.duration_ms, 0)} ms`}
          mono
        />
        <AuditSampleMetric
          label='输出 Token'
          value={formatNumber(sample.output_tokens, 0)}
          mono
        />
      </div>
      <div className='grid gap-3 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4'>
        <AuditSampleEvidence label='任务 ID' value={run.id} mono />
        <AuditSampleEvidence
          label='Profile'
          value={run.profileName || run.profileId}
        />
        <AuditSampleEvidence label='触发方式' value={run.trigger || 'manual'} />
        <AuditSampleEvidence
          label='Request ID'
          value={sample.request_id || '—'}
          mono
        />
        <AuditSampleEvidence
          label='审计 ID'
          value={sample.audit_id ?? '—'}
          mono
        />
        <AuditSampleEvidence
          label='核验账号'
          value={sample.verified_account_id ?? '—'}
          mono
        />
        <AuditSampleEvidence
          label='核验节点'
          value={sample.verified_egress_node_id ?? '—'}
          mono
        />
        <AuditSampleEvidence
          label='HTTP 状态'
          value={sample.status_code || '—'}
          mono
        />
      </div>
      {sample.error && (
        <div className='mx-4 mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
          {sample.error}
        </div>
      )}
      {(sample.responsePreview || sample.response_text) && (
        <details className='mx-4 mb-4 rounded-lg border bg-muted/10 p-3'>
          <summary className='cursor-pointer text-sm font-medium'>
            查看响应摘要
            {sample.responseLength
              ? ` · ${formatNumber(sample.responseLength, 0)} 字符`
              : ''}
          </summary>
          <pre className='mt-3 max-h-64 overflow-auto text-xs leading-5 break-words whitespace-pre-wrap text-muted-foreground'>
            {sample.response_text || sample.responsePreview}
          </pre>
        </details>
      )}
    </div>
  )
}

function AuditSampleMetric({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className='min-w-0'>
      <div className='text-[11px] text-muted-foreground'>{label}</div>
      <div
        className={cn(
          'mt-1 text-sm font-medium break-words',
          mono && 'font-mono tabular-nums'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function AuditSampleEvidence({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | number
  mono?: boolean
}) {
  return (
    <div className='min-w-0'>
      <div className='text-[11px] text-muted-foreground'>{label}</div>
      <div
        className={cn('mt-1 break-all text-foreground', mono && 'font-mono')}
      >
        {value}
      </div>
    </div>
  )
}

function AuditDetailField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className='min-w-0 rounded-lg border bg-background p-3'>
      <dt className='text-[11px] text-muted-foreground'>{label}</dt>
      <dd
        className={cn(
          'mt-1 text-sm break-words',
          mono && 'font-mono break-all tabular-nums'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function NodePerspective({
  nodes,
  selected,
  thresholds,
  isolationEnabled,
  isolatingAccountId,
  isolationPending,
  selectedAccountIds,
  onSelectedChange,
  onSelect,
  onIsolate,
  onViewSamples,
  onFilterAudits,
}: {
  nodes: RequestAuditNodeRisk[]
  selected: RequestAuditNodeRisk | null
  thresholds: RequestAuditThresholds
  isolationEnabled: boolean
  isolatingAccountId?: number | null
  isolationPending: boolean
  selectedAccountIds: number[]
  onSelectedChange: (accountId: number, checked: boolean) => void
  onSelect: (node: RequestAuditNodeRisk) => void
  onIsolate: (account: RequestAuditAccountRisk) => void
  onViewSamples: (account: RequestAuditAccountRisk) => void
  onFilterAudits: (node: RequestAuditNodeRisk) => void
}) {
  const copyLatestProbeIp = async () => {
    if (!selected?.latestProbeIp) return
    try {
      await navigator.clipboard.writeText(selected.latestProbeIp)
      toast.success('最近探测 IP 已复制')
    } catch {
      toast.error('复制最近探测 IP 失败')
    }
  }

  if (!nodes.length || !selected) {
    return (
      <div className='p-4'>
        <EmptyState
          title='没有匹配的代理节点'
          description='调整风险筛选或扫描当前时间窗口后，可按稳定节点下钻异常账号。'
          icon={Layers3}
        />
      </div>
    )
  }

  return (
    <div className='grid min-h-[30rem] lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]'>
      <div className='border-b p-3 lg:border-r lg:border-b-0'>
        <div className='mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground'>
          <span>{nodes.length} 个代理节点</span>
          <span>按风险与峰值排序</span>
        </div>
        <div className='max-h-[34rem] space-y-1.5 overflow-y-auto pr-1'>
          {nodes.map((node) => (
            <button
              key={node.key}
              type='button'
              className={cn(
                'flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selected.key === node.key &&
                  'border-primary/40 bg-primary/5 ring-1 ring-primary/15'
              )}
              onClick={() => onSelect(node)}
            >
              <div
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  node.riskLevel === 'high'
                    ? 'bg-destructive/10 text-destructive'
                    : node.riskLevel === 'watch'
                      ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                )}
              >
                <Layers3 className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-xs font-medium'>
                  {node.egressNodeName || '未映射代理节点'}
                </div>
                <div className='mt-1 truncate text-[11px] text-muted-foreground'>
                  {node.egressNodeId
                    ? `节点 #${node.egressNodeId}`
                    : '审计未返回节点 ID'}
                  {node.latestProbeIp ? ` · ${node.latestProbeIp}` : ''}
                </div>
              </div>
              <div className='text-right'>
                <div className='font-mono text-xs font-semibold tabular-nums'>
                  {formatNumber(node.maxTps)}
                </div>
                <div className='mt-1 text-[10px] text-muted-foreground'>
                  {node.riskAccountCount} 异常账号
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className='min-w-0'>
        <div className='flex flex-col gap-4 border-b bg-muted/10 p-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h3 className='text-base font-semibold'>
                {selected.egressNodeName || '未映射代理节点'}
              </h3>
              <RiskBadge value={selected.riskLevel} thresholds={thresholds} />
              {selected.proxyPool != null && (
                <Badge variant='secondary'>
                  {selected.proxyPool ? '动态代理池' : '固定代理'}
                </Badge>
              )}
              {selected.enabled != null && (
                <Badge variant={selected.enabled ? 'success' : 'secondary'}>
                  {selected.enabled ? '节点启用' : '节点停用'}
                </Badge>
              )}
            </div>
            <div className='mt-1 text-xs text-muted-foreground'>
              {selected.egressNodeId
                ? `稳定归因键：节点 #${selected.egressNodeId}`
                : '该批审计未返回稳定节点 ID，暂归入未映射分组'}
            </div>
            <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
              <span>{selected.requests} 次请求</span>
              <span>{selected.accountCount} 个账号</span>
              <span>{selected.riskAccountCount} 个异常账号</span>
              <span>最近 {formatDate(selected.lastSeenAt)}</span>
            </div>
          </div>
          <div className='flex items-center gap-1'>
            {selected.latestProbeIp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='复制最近探测 IP'
                    onClick={copyLatestProbeIp}
                  >
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制最近探测 IP</TooltipContent>
              </Tooltip>
            )}
            {selected.egressNodeId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='查看该节点请求'
                    onClick={() => onFilterAudits(selected)}
                  >
                    <ListFilter />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>查看该节点请求</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant='ghost' size='icon'>
                  <Link to='/egress-nodes' aria-label='调整代理池'>
                    <ExternalLink />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>调整代理池</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className='grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-4'>
          <div className='rounded-lg border bg-background p-3'>
            <div className='text-[11px] text-muted-foreground'>平均 TPS</div>
            <div className='mt-1 font-mono text-lg font-semibold tabular-nums'>
              {formatNumber(selected.averageTps)}
            </div>
          </div>
          <div className='rounded-lg border bg-background p-3'>
            <div className='text-[11px] text-muted-foreground'>P95 TPS</div>
            <div className='mt-1 font-mono text-lg font-semibold tabular-nums'>
              {formatNumber(selected.p95Tps)}
            </div>
          </div>
          <div className='rounded-lg border bg-background p-3'>
            <div className='text-[11px] text-muted-foreground'>峰值 TPS</div>
            <div
              className={cn(
                'mt-1 font-mono text-lg font-semibold tabular-nums',
                selected.riskLevel === 'high'
                  ? 'text-destructive'
                  : selected.riskLevel === 'watch' &&
                      'text-amber-700 dark:text-amber-300'
              )}
            >
              {formatNumber(selected.maxTps)}
            </div>
          </div>
          <div className='rounded-lg border bg-background p-3'>
            <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
              <Globe2 className='size-3' />
              最近探测 IP
            </div>
            <div
              className='mt-1 truncate font-mono text-sm font-semibold'
              title={selected.latestProbeIp || undefined}
            >
              {selected.latestProbeIp || '暂无探测快照'}
            </div>
            <div className='mt-1 text-[10px] text-muted-foreground'>
              当前节点快照，不代表历史请求 IP
            </div>
          </div>
        </div>

        <div className='p-4'>
          <div className='mb-3 flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-semibold'>该节点的异常账号</h4>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                峰值只使用当前节点上的请求计算；动态 IP
                变化不会拆散节点风险。账号状态显示最近上游快照。
              </p>
            </div>
          </div>
          <div className='max-h-[36rem] space-y-2 overflow-y-auto pr-1'>
            {selected.accounts.map((account) => (
              <div
                key={`${selected.key}-${account.accountId ?? account.accountName}`}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-2.5 sm:flex-row sm:items-center',
                  account.accountId &&
                    selectedAccountIds.includes(account.accountId) &&
                    'border-primary/30 bg-primary/[0.035]'
                )}
              >
                <div className='flex min-w-0 flex-1 items-center gap-2.5'>
                  <Checkbox
                    checked={
                      account.accountId
                        ? selectedAccountIds.includes(account.accountId)
                        : false
                    }
                    disabled={!account.accountId}
                    onCheckedChange={(value) => {
                      if (account.accountId) {
                        onSelectedChange(account.accountId, value === true)
                      }
                    }}
                    aria-label={`选择账号 ${account.accountName || account.accountId}`}
                  />
                  <div
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      account.riskLevel === 'high'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {account.accountName.slice(0, 1).toUpperCase() || '#'}
                  </div>
                  <div className='min-w-0'>
                    <div className='truncate text-xs font-medium'>
                      {account.accountName ||
                        `账号 ${account.accountId ?? '未知'}`}
                    </div>
                    <div className='text-[10px] text-muted-foreground'>
                      ID {account.accountId ?? '未知'} · {account.requests}{' '}
                      次请求 · 最近 {formatDate(account.lastSeenAt)}
                    </div>
                  </div>
                </div>
                <div className='grid grid-cols-3 gap-2 text-right text-xs sm:flex sm:min-w-[27rem] sm:items-center sm:justify-end'>
                  <div className='col-span-3 justify-self-end sm:col-span-1'>
                    <UpstreamAccountState account={account} compact />
                  </div>
                  <div>
                    <div className='text-[10px] text-muted-foreground'>
                      平均
                    </div>
                    <div className='mt-0.5 font-mono'>
                      {formatNumber(account.averageTps)}
                    </div>
                  </div>
                  <div>
                    <div className='text-[10px] text-muted-foreground'>P95</div>
                    <div className='mt-0.5 font-mono'>
                      {formatNumber(account.p95Tps)}
                    </div>
                  </div>
                  <div>
                    <div className='text-[10px] text-muted-foreground'>
                      峰值
                    </div>
                    <div className='mt-0.5 font-mono font-semibold'>
                      {formatNumber(account.maxTps)}
                    </div>
                  </div>
                  <div className='col-span-3 sm:ml-2'>
                    <div className='flex items-center justify-end gap-1'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='size-7'
                            disabled={!account.accountId}
                            aria-label='查看账号全部探针样本'
                            onClick={() => onViewSamples(account)}
                          >
                            <Activity />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          查看全部探针样本（{account.probeSampleCount} 条）
                        </TooltipContent>
                      </Tooltip>
                      {account.quarantined ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className='inline-flex'>
                              <Button
                                size='icon'
                                variant='ghost'
                                className='size-7 text-muted-foreground'
                                disabled
                                aria-label='账号已隔离'
                              >
                                <LockKeyhole />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>账号已隔离</TooltipContent>
                        </Tooltip>
                      ) : isolationEnabled && account.accountId ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size='icon'
                              variant='ghost'
                              className='size-7 text-destructive hover:bg-destructive/10 hover:text-destructive'
                              disabled={
                                isolationPending &&
                                isolatingAccountId === account.accountId
                              }
                              aria-label='隔离风险账号'
                              onClick={() => onIsolate(account)}
                            >
                              {isolationPending &&
                              isolatingAccountId === account.accountId ? (
                                <RefreshCw className='animate-spin' />
                              ) : (
                                <LockKeyhole />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>隔离风险账号</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className='inline-flex'>
                              <Button
                                size='icon'
                                variant='ghost'
                                className='size-7 text-muted-foreground'
                                disabled
                                aria-label='隔离操作已关闭'
                              >
                                <LockKeyhole />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>隔离操作已关闭</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!selected.accounts.length && (
              <EmptyState
                compact
                title='该节点暂无异常账号'
                description='当前节点内的账号峰值均未超过系统风险阈值。'
                icon={ShieldAlert}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountRiskRow({
  account,
  thresholds,
  isolationEnabled,
  onIsolate,
  onViewAudits,
  onViewSamples,
  selected,
  onSelectedChange,
  isolating,
}: {
  account: RequestAuditAccountRisk
  thresholds: RequestAuditThresholds
  isolationEnabled: boolean
  onIsolate: (account: RequestAuditAccountRisk) => void
  onViewAudits: (account: RequestAuditAccountRisk) => void
  onViewSamples: (account: RequestAuditAccountRisk) => void
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  isolating: boolean
}) {
  return (
    <TableRow
      rowId={account.accountId ?? account.accountName}
      className={cn(selected && 'bg-primary/[0.035]')}
    >
      <TableCell className='align-middle'>
        <Checkbox
          checked={selected}
          disabled={!account.accountId}
          onCheckedChange={(value) => onSelectedChange(value === true)}
          aria-label={`选择账号 ${account.accountName || account.accountId}`}
        />
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <div
          className='max-w-56 font-medium break-words'
          title={account.accountName || undefined}
        >
          {account.accountName || `账号 ${account.accountId ?? '未知'}`}
        </div>
        <div className='text-[10px] text-muted-foreground'>
          ID {account.accountId ?? '未知'}
        </div>
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <UpstreamAccountState account={account} compact />
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <NodeText row={account} />
      </TableCell>
      <TableCell className='align-middle tabular-nums'>
        {formatNumber(account.requests, 0)}
        <div className='text-[10px] text-muted-foreground'>
          {formatNumber(account.outputTokens, 0)} tokens
        </div>
      </TableCell>
      <TableCell className='align-middle'>
        <button
          type='button'
          className='cursor-pointer text-left hover:text-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
          disabled={!account.accountId}
          onClick={() => onViewSamples(account)}
          title='查看该账号可分页浏览的全部探针样本'
        >
          <span className='font-medium tabular-nums'>
            {formatNumber(account.probeSampleCount, 0)}
          </span>
          <span className='mx-1 text-muted-foreground'>/</span>
          <span className='text-amber-600 tabular-nums dark:text-amber-400'>
            {formatNumber(account.probeAnomalyCount, 0)}
          </span>
          <span className='block text-[10px] text-muted-foreground'>
            {account.latestProbeSampleAt
              ? formatDate(account.latestProbeSampleAt)
              : '暂无周期样本'}
          </span>
        </button>
      </TableCell>
      <TableCell className='align-middle'>
        <div
          className='text-[11px]'
          title='P95（95% 分位）：窗口内 95% 请求的 TPS 不高于该值，剩余 5% 请求更快。'
        >
          <Tps value={account.averageTps} />
        </div>
        <div className='text-[10px] text-muted-foreground'>
          P95 <Tps value={account.p95Tps} />
        </div>
      </TableCell>
      <TableCell className='align-middle'>
        <Tps value={account.maxTps} />
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <div className='flex max-w-64 flex-wrap items-center gap-1.5'>
          <RiskBadge value={account.riskLevel} thresholds={thresholds} />
          <span className='text-[10px] break-words text-muted-foreground'>
            {account.riskReasons[0] || '未超过阈值'}
          </span>
        </div>
        {account.riskLevel !== 'normal' && (
          <div className='text-[10px] break-words text-muted-foreground'>
            观察 {account.watchCount} 次 · 高风险 {account.highRiskCount} 次
          </div>
        )}
      </TableCell>
      <TableCell className='align-middle text-[11px] text-muted-foreground'>
        {formatDate(account.lastSeenAt)}
      </TableCell>
      <TableCell className='text-right align-middle'>
        <div className='flex items-center justify-end gap-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size='icon'
                variant='ghost'
                className='size-7'
                disabled={!account.accountId}
                aria-label='查看账号全部探针样本'
                onClick={() => onViewSamples(account)}
              >
                <Activity />
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看全部探针样本</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size='icon'
                variant='ghost'
                className='size-7'
                aria-label='查看账号请求流水'
                onClick={() => onViewAudits(account)}
              >
                <ListFilter />
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看该账号请求与探针证据</TooltipContent>
          </Tooltip>
          {account.quarantined ? (
            <Badge
              variant='secondary'
              title={
                account.quarantineUntil
                  ? `隔离至 ${formatDate(account.quarantineUntil)}`
                  : '账号已隔离'
              }
            >
              已隔离
            </Badge>
          ) : isolationEnabled &&
            account.accountId &&
            account.riskLevel !== 'normal' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  className='size-7 text-destructive hover:bg-destructive/10 hover:text-destructive'
                  disabled={isolating}
                  aria-label='隔离风险账号'
                  onClick={() => onIsolate(account)}
                >
                  {isolating ? (
                    <RefreshCw className='animate-spin' />
                  ) : (
                    <LockKeyhole />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>隔离风险账号</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function AuditRow({
  row,
  thresholds,
  selected,
  onSelectedChange,
  onOpenDetail,
}: {
  row: RequestAuditRecord
  thresholds: RequestAuditThresholds
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onOpenDetail: (row: RequestAuditRecord) => void
}) {
  return (
    <TableRow rowId={row.id} className={cn(selected && 'bg-primary/[0.035]')}>
      <TableCell className='align-middle'>
        <Checkbox
          checked={selected}
          disabled={!row.accountId}
          onCheckedChange={(value) => onSelectedChange(value === true)}
          aria-label={`选择请求 ${row.requestId || row.id}`}
        />
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-[11px] tabular-nums'>
            {formatDate(row.createdAt)}
          </span>
          {row.probeSampleCount > 0 && (
            <Badge variant='info' className='h-5 px-1.5 text-[10px]'>
              探针 {row.probeSampleCount}
            </Badge>
          )}
        </div>
        <div
          className='max-w-64 font-mono text-[10px] break-all text-muted-foreground'
          title={row.requestId}
        >
          {row.requestId || row.id}
        </div>
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <div
          className='max-w-48 text-xs font-medium break-words'
          title={row.accountName || undefined}
        >
          {row.accountName || `账号 ${row.accountId ?? '未知'}`}
        </div>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground'>
          <span>ID {row.accountId ?? '未知'}</span>
          <UpstreamAccountState account={row} compact />
        </div>
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <NodeText row={row} />
      </TableCell>
      <TableCell className='align-middle !whitespace-normal'>
        <div
          className='max-w-56 text-xs break-words'
          title={row.modelPublicId || undefined}
        >
          {row.modelPublicId || '—'}
        </div>
        <div
          className='max-w-56 text-[11px] break-words text-muted-foreground'
          title={row.modelUpstreamModel || row.operation || undefined}
        >
          {row.modelUpstreamModel || row.operation || 'responses'}
        </div>
      </TableCell>
      <TableCell className='align-middle font-mono text-xs tabular-nums'>
        {formatNumber(row.outputTokens, 0)}
        {row.reasoningTokens > 0 && (
          <div className='text-[10px] text-muted-foreground'>
            推理 {formatNumber(row.reasoningTokens, 0)}
          </div>
        )}
      </TableCell>
      <TableCell className='align-middle'>
        <Tps value={row.tps} />
        <div className='text-[10px] text-muted-foreground'>
          {row.durationMs ? `${formatNumber(row.durationMs, 0)} ms` : '未测量'}
        </div>
      </TableCell>
      <TableCell className='align-middle'>
        <Badge
          variant={
            row.statusCode >= 200 && row.statusCode < 300
              ? 'success'
              : 'destructive'
          }
        >
          {row.statusCode || '—'}
        </Badge>
      </TableCell>
      <TableCell className='align-middle'>
        <RiskBadge value={row.riskLevel} thresholds={thresholds} />
      </TableCell>
      <TableCell className='text-right align-middle'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size='icon'
              variant='ghost'
              className='size-7'
              aria-label='查看请求审计详情'
              onClick={() => onOpenDetail(row)}
            >
              <Eye />
            </Button>
          </TooltipTrigger>
          <TooltipContent>查看完整请求审计</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  )
}
