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
import { Link } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  CalendarRange,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gauge,
  Globe2,
  Layers3,
  ListFilter,
  LockKeyhole,
  RefreshCw,
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
  type RequestAuditEgressRisk,
  type RequestAuditRecord,
  type RequestAuditRiskLevel,
  type RequestAuditScanState,
  type RequestAuditStatus,
  type RequestAuditThresholds,
  type RequestAuditWindowInput,
  type RequestAuditWindowPreset,
  type RuntimeSettingsUpdate,
} from '@/lib/api'
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
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'

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
type Perspective = 'accounts' | 'egresses'
type MainView = 'overview' | 'workspace' | 'ledger' | 'schedule'

type AuditConfigDraft = RequestAuditConfig & {
  watchTps: number
  highTps: number
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

function EgressText({
  row,
}: {
  row: RequestAuditRecord | RequestAuditAccountRisk
}) {
  const ips =
    'egressIps' in row ? row.egressIps : row.egressIp ? [row.egressIp] : []
  const nodes =
    'egressNodes' in row
      ? row.egressNodes
      : row.egressNodeName
        ? [row.egressNodeName]
        : []
  return (
    <div className='max-w-56 min-w-32'>
      <div className='truncate font-mono text-xs'>
        {ips.length ? ips.join('、') : '未知出口 IP'}
      </div>
      <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
        {nodes.length ? nodes.join('、') : '节点未返回'}
      </div>
    </div>
  )
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
                description='按当前观察与高风险阈值标记账号和出口。'
                checked={draft.riskEnabled}
                disabled={!draft.enabled}
                onCheckedChange={(value) => update('riskEnabled', value)}
              />
              <ToggleSetting
                title='账号隔离操作'
                description='允许从账号或出口详情直接联动隔离。'
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
      <div className='mt-1 truncate font-mono text-base font-semibold tabular-nums'>
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
  backgroundRefreshing,
}: {
  config: RequestAuditConfig
  activity: RequestAuditActivity | undefined
  scan: RequestAuditScanState | undefined
  status: RequestAuditStatus | undefined
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

        <div className='grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4'>
          <ScheduleStat
            label='建议下次扫描'
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [mainView, setMainView] = useState<MainView>('overview')
  const [perspective, setPerspective] = useState<Perspective>('accounts')
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [workspaceRisk, setWorkspaceRisk] =
    useState<WorkspaceRiskFilter>('risky')
  const [auditSearch, setAuditSearch] = useState('')
  const [auditRisk, setAuditRisk] = useState('all')
  const [auditEgress, setAuditEgress] = useState('all')
  const [selectedEgressKey, setSelectedEgressKey] = useState('')
  const [selectedWindow, setSelectedWindow] = useState<RequestAuditWindowInput>(
    readRememberedRequestAuditWindow
  )
  const [customOpen, setCustomOpen] = useState(false)
  const [customRange, setCustomRange] = useState(() =>
    customRangeFromWindow(selectedWindow)
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      auditEgress,
    ],
    queryFn: () =>
      api.requestAudits({
        ...windowParams,
        page,
        pageSize,
        account: deferredAuditSearch.trim(),
        risk: effectiveAuditRisk === 'all' ? '' : effectiveAuditRisk,
        egressIp: auditEgress === 'all' ? '' : auditEgress,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: liveRefreshInterval,
    refetchIntervalInBackground: true,
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
        note: `请求审计峰值 ${formatNumber(account.maxTps)} Token/s；出口 ${account.egressIps.join('、') || '未知'}`,
        propagate: true,
      }),
    onSuccess: () => {
      toast.success('账号已进入隔离状态')
      void queryClient.invalidateQueries({ queryKey: ['request-audits'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
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
  const egresses = useMemo(
    () => summaryQuery.data?.egresses ?? [],
    [summaryQuery.data?.egresses]
  )
  const trend = useMemo(
    () => summaryQuery.data?.trend ?? [],
    [summaryQuery.data?.trend]
  )
  const thresholds = statusQuery.data?.thresholds ??
    summaryQuery.data?.thresholds ??
    recordsQuery.data?.thresholds ?? { watch: 150, high: 500 }

  const visibleAccounts = useMemo(() => {
    const needle = deferredWorkspaceSearch.trim().toLowerCase()
    const effectiveRisk = config.riskEnabled ? workspaceRisk : 'all'
    return accounts.filter((item) => {
      const matchesSearch =
        !needle ||
        item.accountName.toLowerCase().includes(needle) ||
        String(item.accountId ?? '').includes(needle) ||
        item.egressIps.some((ip) => ip.toLowerCase().includes(needle))
      const matchesRisk =
        effectiveRisk === 'all' ||
        (effectiveRisk === 'risky'
          ? item.riskLevel !== 'normal'
          : item.riskLevel === effectiveRisk)
      return matchesSearch && matchesRisk
    })
  }, [accounts, config.riskEnabled, deferredWorkspaceSearch, workspaceRisk])

  const visibleEgresses = useMemo(() => {
    const needle = deferredWorkspaceSearch.trim().toLowerCase()
    const effectiveRisk = config.riskEnabled ? workspaceRisk : 'all'
    return egresses.filter((item) => {
      const matchesSearch =
        !needle ||
        item.egressIp.toLowerCase().includes(needle) ||
        item.egressNodes.some((node) => node.toLowerCase().includes(needle)) ||
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
  }, [config.riskEnabled, deferredWorkspaceSearch, egresses, workspaceRisk])

  const selectedEgress =
    visibleEgresses.find((item) => item.key === selectedEgressKey) ??
    visibleEgresses[0] ??
    null

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
    (recordsQuery.isFetching && recordsQuery.data)
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
        `确认隔离账号 ${account.accountName || account.accountId}？\n峰值 ${formatNumber(account.maxTps)} Token/s\n出口 ${account.egressIps.join('、') || '未知'}`
      )
    )
      return
    isolateMutation.mutate(account)
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
    setPage(1)
    setCustomOpen(false)
  }

  const refreshLocal = () => {
    void Promise.all([
      statusQuery.refetch(),
      summaryQuery.refetch(),
      recordsQuery.refetch(),
    ])
  }

  return (
    <Page>
      <PageHeader
        title='请求审计风险'
        description='本地增量投影 grok_build 请求，按总览、风险定位、请求流水和审计调度分组管理。'
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
              detail={`${egresses.filter((item) => item.riskLevel !== 'normal').length} 个异常出口`}
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
                  高风险出口雷达
                </CardTitle>
                <CardDescription>
                  按实际出口 IP 排序，点击可直接切换到出口详情。
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-2'>
                {egresses
                  .filter((item) => item.riskLevel !== 'normal')
                  .slice(0, 5)
                  .map((egress) => (
                    <button
                      key={egress.key}
                      type='button'
                      className='flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                      onClick={() => {
                        setMainView('workspace')
                        setPerspective('egresses')
                        setWorkspaceRisk('risky')
                        setSelectedEgressKey(egress.key)
                      }}
                    >
                      <div
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          egress.riskLevel === 'high'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        )}
                      >
                        {egress.riskAccountCount}
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate font-mono text-xs font-medium'>
                          {egress.egressIp || '未知出口 IP'}
                        </div>
                        <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                          {egress.egressNodes.join('、') || '节点未返回'} ·{' '}
                          {egress.requests} 次请求
                        </div>
                      </div>
                      <div className='text-right'>
                        <div className='font-mono text-xs font-semibold tabular-nums'>
                          {formatNumber(egress.maxTps)} TPS
                        </div>
                        <div className='mt-0.5 text-[10px] text-muted-foreground'>
                          {egress.riskLevel === 'high' ? '高风险' : '观察'}
                        </div>
                      </div>
                    </button>
                  ))}
                {!egresses.some((item) => item.riskLevel !== 'normal') && (
                  <EmptyState
                    compact
                    title='暂无异常出口'
                    description={
                      config.riskEnabled
                        ? '当前窗口内没有出口超过系统 TPS 阈值。'
                        : '开启 TPS 风险识别后显示异常出口。'
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
            <CardHeader className='gap-4 border-b sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <CardTitle>风险定位工作台</CardTitle>
                <CardDescription>
                  在账号与出口两个视角间切换；出口视角只使用该出口上的请求重新计算账号峰值。
                </CardDescription>
              </div>
              <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
                <Input
                  className='h-9 w-full text-xs sm:w-52'
                  placeholder='账号 / ID / 出口 IP / 节点'
                  aria-label='搜索风险账号或出口'
                  value={workspaceSearch}
                  onChange={(event) => setWorkspaceSearch(event.target.value)}
                />
                <Select
                  value={config.riskEnabled ? workspaceRisk : 'all'}
                  disabled={!config.riskEnabled}
                  onValueChange={(value) =>
                    setWorkspaceRisk(value as WorkspaceRiskFilter)
                  }
                >
                  <SelectTrigger
                    className='h-9 w-full text-xs sm:w-36'
                    aria-label='筛选风险等级'
                  >
                    <ListFilter className='size-3.5' />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='risky'>仅异常</SelectItem>
                    <SelectItem value='high'>仅高风险</SelectItem>
                    <SelectItem value='watch'>仅观察</SelectItem>
                    <SelectItem value='normal'>仅正常</SelectItem>
                    <SelectItem value='all'>全部</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className='p-0'>
              <Tabs
                value={perspective}
                onValueChange={(value) => setPerspective(value as Perspective)}
                className='gap-0'
              >
                <div className='border-b px-4 py-3'>
                  <TabsList>
                    <TabsTrigger value='accounts'>
                      <UsersRound />
                      账号视角
                      <Badge variant='secondary' className='ml-1'>
                        {visibleAccounts.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value='egresses'>
                      <Layers3 />
                      出口视角
                      <Badge variant='secondary' className='ml-1'>
                        {visibleEgresses.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value='accounts' className='mt-0'>
                  <div className='overflow-x-auto'>
                    <Table className='min-w-[1020px]'>
                      <TableHeader>
                        <TableRow>
                          <TableHead>账号</TableHead>
                          <TableHead>出口 IP / 节点</TableHead>
                          <TableHead>请求量</TableHead>
                          <TableHead>平均 / P95</TableHead>
                          <TableHead>峰值 TPS</TableHead>
                          <TableHead>风险证据</TableHead>
                          <TableHead>最近请求</TableHead>
                          <TableHead className='text-right'>处置</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleAccounts.map((account) => (
                          <AccountRiskRow
                            key={`${account.accountId ?? 'unknown'}-${account.accountName}`}
                            account={account}
                            thresholds={thresholds}
                            isolationEnabled={config.isolationEnabled}
                            onIsolate={isolate}
                            isolating={
                              isolateMutation.isPending &&
                              isolateMutation.variables?.accountId ===
                                account.accountId
                            }
                          />
                        ))}
                        {!visibleAccounts.length && (
                          <TableRow>
                            <TableCell colSpan={8}>
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
                </TabsContent>

                <TabsContent value='egresses' className='mt-0'>
                  <EgressPerspective
                    egresses={visibleEgresses}
                    selected={selectedEgress}
                    thresholds={thresholds}
                    isolationEnabled={config.isolationEnabled}
                    isolatingAccountId={isolateMutation.variables?.accountId}
                    isolationPending={isolateMutation.isPending}
                    onSelect={(egress) => setSelectedEgressKey(egress.key)}
                    onIsolate={isolate}
                    onFilterAudits={(egress) => {
                      if (!egress.egressIp) return
                      setAuditEgress(egress.egressIp)
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
            <CardHeader className='gap-4 border-b lg:flex-row lg:items-center lg:justify-between'>
              <div>
                <CardTitle>请求审计流水</CardTitle>
                <CardDescription>
                  只查询本地投影；切换分页、筛选或后台刷新时保留现有表格，数据到达后原位更新。
                </CardDescription>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <Input
                  className='h-8 w-44 text-xs'
                  placeholder='账号名 / ID / 请求 ID'
                  aria-label='搜索请求审计流水'
                  value={auditSearch}
                  onChange={(event) => {
                    setAuditSearch(event.target.value)
                    setPage(1)
                  }}
                />
                <Select
                  value={auditEgress}
                  onValueChange={(value) => {
                    setAuditEgress(value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger
                    className='h-8 w-44 text-xs'
                    aria-label='按出口 IP 筛选请求流水'
                  >
                    <SelectValue placeholder='全部出口' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>全部出口</SelectItem>
                    {egresses
                      .filter((item) => item.egressIp)
                      .map((item) => (
                        <SelectItem key={item.key} value={item.egressIp}>
                          {item.egressIp}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={effectiveAuditRisk}
                  disabled={!config.riskEnabled}
                  onValueChange={(value) => {
                    setAuditRisk(value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger
                    className='h-8 w-32 text-xs'
                    aria-label='按风险等级筛选请求流水'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>全部风险</SelectItem>
                    <SelectItem value='high'>高风险</SelectItem>
                    <SelectItem value='watch'>观察</SelectItem>
                    <SelectItem value='normal'>正常</SelectItem>
                  </SelectContent>
                </Select>
                {(auditSearch.trim() ||
                  auditEgress !== 'all' ||
                  auditRisk !== 'all') && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      setAuditSearch('')
                      setAuditEgress('all')
                      setAuditRisk('all')
                      setPage(1)
                    }}
                  >
                    清除筛选
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className='p-0'>
              <div
                className={cn(
                  'overflow-x-auto transition-opacity',
                  recordsQuery.isPlaceholderData && 'opacity-70'
                )}
                aria-busy={recordsQuery.isFetching}
              >
                <Table className='min-w-[1120px]'>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间 / 请求</TableHead>
                      <TableHead>账号</TableHead>
                      <TableHead>出口</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>输出 Token</TableHead>
                      <TableHead>速度</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>风险</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(recordsQuery.data?.items ?? []).map((row) => (
                      <AuditRow
                        key={row.id}
                        row={row}
                        thresholds={thresholds}
                      />
                    ))}
                    {!recordsQuery.data?.items.length && (
                      <TableRow>
                        <TableCell colSpan={8}>
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
              <div className='flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
                <div className='text-xs text-muted-foreground'>
                  第 {recordsQuery.data?.page ?? page} 页 · 共{' '}
                  {formatNumber(recordsQuery.data?.total ?? 0, 0)} 条
                  {recordsQuery.isPlaceholderData ? ' · 正在无感切换数据' : ''}
                </div>
                <div className='flex items-center justify-end gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={
                      page * pageSize >= (recordsQuery.data?.total ?? 0)
                    }
                    onClick={() => setPage((value) => value + 1)}
                  >
                    下一页
                  </Button>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value))
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-8 w-20 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='25'>25 条</SelectItem>
                      <SelectItem value='50'>50 条</SelectItem>
                      <SelectItem value='100'>100 条</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

function EgressPerspective({
  egresses,
  selected,
  thresholds,
  isolationEnabled,
  isolatingAccountId,
  isolationPending,
  onSelect,
  onIsolate,
  onFilterAudits,
}: {
  egresses: RequestAuditEgressRisk[]
  selected: RequestAuditEgressRisk | null
  thresholds: RequestAuditThresholds
  isolationEnabled: boolean
  isolatingAccountId?: number | null
  isolationPending: boolean
  onSelect: (egress: RequestAuditEgressRisk) => void
  onIsolate: (account: RequestAuditAccountRisk) => void
  onFilterAudits: (egress: RequestAuditEgressRisk) => void
}) {
  const copyIp = async () => {
    if (!selected?.egressIp) return
    try {
      await navigator.clipboard.writeText(selected.egressIp)
      toast.success('出口 IP 已复制')
    } catch {
      toast.error('复制出口 IP 失败')
    }
  }

  if (!egresses.length || !selected) {
    return (
      <div className='p-4'>
        <EmptyState
          title='没有匹配的出口'
          description='调整风险筛选或扫描当前时间窗口后，可按出口下钻异常账号。'
          icon={Globe2}
        />
      </div>
    )
  }

  return (
    <div className='grid min-h-[30rem] lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]'>
      <div className='border-b p-3 lg:border-r lg:border-b-0'>
        <div className='mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground'>
          <span>{egresses.length} 个出口</span>
          <span>按风险与峰值排序</span>
        </div>
        <div className='max-h-[34rem] space-y-1.5 overflow-y-auto pr-1'>
          {egresses.map((egress) => (
            <button
              key={egress.key}
              type='button'
              className={cn(
                'flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selected.key === egress.key &&
                  'border-primary/40 bg-primary/5 ring-1 ring-primary/15'
              )}
              onClick={() => onSelect(egress)}
            >
              <div
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  egress.riskLevel === 'high'
                    ? 'bg-destructive/10 text-destructive'
                    : egress.riskLevel === 'watch'
                      ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                )}
              >
                <Globe2 className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-mono text-xs font-medium'>
                  {egress.egressIp || '未知出口 IP'}
                </div>
                <div className='mt-1 truncate text-[11px] text-muted-foreground'>
                  {egress.egressNodes.join('、') || '节点未返回'}
                </div>
              </div>
              <div className='text-right'>
                <div className='font-mono text-xs font-semibold tabular-nums'>
                  {formatNumber(egress.maxTps)}
                </div>
                <div className='mt-1 text-[10px] text-muted-foreground'>
                  {egress.riskAccountCount} 异常账号
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
              <h3 className='font-mono text-base font-semibold'>
                {selected.egressIp || '未知出口 IP'}
              </h3>
              <RiskBadge value={selected.riskLevel} thresholds={thresholds} />
            </div>
            <div className='mt-1 text-xs text-muted-foreground'>
              {selected.egressNodes.join('、') || '节点未返回'}
              {selected.egressNodeIds.length
                ? ` · 节点 ID ${selected.egressNodeIds.join('、')}`
                : ''}
            </div>
            <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
              <span>{selected.requests} 次请求</span>
              <span>{selected.accountCount} 个账号</span>
              <span>{selected.riskAccountCount} 个异常账号</span>
              <span>最近 {formatDate(selected.lastSeenAt)}</span>
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            {selected.egressIp && (
              <Button variant='outline' size='sm' onClick={copyIp}>
                <Copy />
                复制 IP
              </Button>
            )}
            {selected.egressIp && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => onFilterAudits(selected)}
              >
                <ListFilter />
                查看请求
              </Button>
            )}
            <Button asChild size='sm'>
              <Link to='/egress-nodes'>
                <ExternalLink />
                调整代理池
              </Link>
            </Button>
          </div>
        </div>

        <div className='grid gap-3 border-b p-4 sm:grid-cols-3'>
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
        </div>

        <div className='p-4'>
          <div className='mb-3 flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-semibold'>该出口的异常账号</h4>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                峰值只使用当前出口上的请求计算，避免被账号的其他出口误归因。
              </p>
            </div>
          </div>
          <div className='space-y-2'>
            {selected.accounts.map((account) => (
              <div
                key={`${selected.key}-${account.accountId ?? account.accountName}`}
                className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center'
              >
                <div className='flex min-w-0 flex-1 items-center gap-3'>
                  <div
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      account.riskLevel === 'high'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {account.accountName.slice(0, 1).toUpperCase() || '#'}
                  </div>
                  <div className='min-w-0'>
                    <div className='truncate text-sm font-medium'>
                      {account.accountName ||
                        `账号 ${account.accountId ?? '未知'}`}
                    </div>
                    <div className='mt-0.5 text-[11px] text-muted-foreground'>
                      ID {account.accountId ?? '未知'} · {account.requests}{' '}
                      次请求 · 最近 {formatDate(account.lastSeenAt)}
                    </div>
                  </div>
                </div>
                <div className='grid grid-cols-3 gap-3 text-right text-xs sm:flex sm:min-w-[19rem] sm:items-center sm:justify-end'>
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
                    {account.quarantined ? (
                      <Badge variant='secondary'>已隔离</Badge>
                    ) : isolationEnabled && account.accountId ? (
                      <Button
                        size='sm'
                        variant='outline'
                        className='text-destructive hover:text-destructive'
                        disabled={
                          isolationPending &&
                          isolatingAccountId === account.accountId
                        }
                        onClick={() => onIsolate(account)}
                      >
                        {isolationPending &&
                        isolatingAccountId === account.accountId ? (
                          <RefreshCw className='animate-spin' />
                        ) : (
                          <LockKeyhole />
                        )}
                        隔离账号
                      </Button>
                    ) : (
                      <Badge variant='secondary'>隔离操作关闭</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!selected.accounts.length && (
              <EmptyState
                compact
                title='该出口暂无异常账号'
                description='当前出口的账号峰值均未超过系统风险阈值。'
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
  isolating,
}: {
  account: RequestAuditAccountRisk
  thresholds: RequestAuditThresholds
  isolationEnabled: boolean
  onIsolate: (account: RequestAuditAccountRisk) => void
  isolating: boolean
}) {
  return (
    <TableRow>
      <TableCell>
        <div className='max-w-44 truncate font-medium'>
          {account.accountName || `账号 ${account.accountId ?? '未知'}`}
        </div>
        <div className='text-xs text-muted-foreground'>
          ID {account.accountId ?? '未知'}
        </div>
      </TableCell>
      <TableCell>
        <EgressText row={account} />
      </TableCell>
      <TableCell className='tabular-nums'>
        {formatNumber(account.requests, 0)}
        <div className='text-xs text-muted-foreground'>
          {formatNumber(account.outputTokens, 0)} tokens
        </div>
      </TableCell>
      <TableCell>
        <div className='text-xs'>
          <Tps value={account.averageTps} />
        </div>
        <div className='text-xs text-muted-foreground'>
          P95 <Tps value={account.p95Tps} />
        </div>
      </TableCell>
      <TableCell>
        <Tps value={account.maxTps} />
      </TableCell>
      <TableCell>
        <RiskBadge value={account.riskLevel} thresholds={thresholds} />
        <div className='mt-1 text-[11px] text-muted-foreground'>
          {account.riskReasons[0] || '未超过阈值'}
        </div>
        {account.riskLevel !== 'normal' && (
          <div className='text-[11px] text-muted-foreground'>
            观察 {account.watchCount} 次 · 高风险 {account.highRiskCount} 次
          </div>
        )}
      </TableCell>
      <TableCell className='text-xs text-muted-foreground'>
        {formatDate(account.lastSeenAt)}
      </TableCell>
      <TableCell className='text-right'>
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
          <Button
            size='sm'
            variant='outline'
            className='gap-1 text-destructive hover:text-destructive'
            disabled={isolating}
            onClick={() => onIsolate(account)}
          >
            {isolating ? (
              <RefreshCw className='animate-spin' />
            ) : (
              <LockKeyhole />
            )}
            隔离
          </Button>
        ) : (
          <span className='text-xs text-muted-foreground'>—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function AuditRow({
  row,
  thresholds,
}: {
  row: RequestAuditRecord
  thresholds: RequestAuditThresholds
}) {
  return (
    <TableRow>
      <TableCell>
        <div className='text-xs tabular-nums'>{formatDate(row.createdAt)}</div>
        <div
          className='mt-0.5 max-w-44 truncate font-mono text-[10px] text-muted-foreground'
          title={row.requestId}
        >
          {row.requestId || row.id}
        </div>
      </TableCell>
      <TableCell>
        <div className='max-w-36 truncate text-xs font-medium'>
          {row.accountName || `账号 ${row.accountId ?? '未知'}`}
        </div>
        <div className='text-[11px] text-muted-foreground'>
          ID {row.accountId ?? '未知'}
        </div>
      </TableCell>
      <TableCell>
        <EgressText row={row} />
      </TableCell>
      <TableCell>
        <div className='max-w-40 truncate text-xs'>
          {row.modelPublicId || '—'}
        </div>
        <div className='max-w-40 truncate text-[11px] text-muted-foreground'>
          {row.modelUpstreamModel || row.operation || 'responses'}
        </div>
      </TableCell>
      <TableCell className='font-mono text-xs tabular-nums'>
        {formatNumber(row.outputTokens, 0)}
        <div className='text-[11px] text-muted-foreground'>
          {row.reasoningTokens
            ? `推理 ${formatNumber(row.reasoningTokens, 0)}`
            : ''}
        </div>
      </TableCell>
      <TableCell>
        <Tps value={row.tps} />
        <div className='text-[11px] text-muted-foreground'>
          {row.durationMs ? `${formatNumber(row.durationMs, 0)} ms` : '未测量'}
        </div>
      </TableCell>
      <TableCell>
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
      <TableCell>
        <RiskBadge value={row.riskLevel} thresholds={thresholds} />
      </TableCell>
    </TableRow>
  )
}
