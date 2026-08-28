import { type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  CalendarDays,
  CircleCheck,
  Gauge,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldBan,
  TimerReset,
  UserPlus,
  UsersRound,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type ProbeRun, type UpstreamAccount } from '@/lib/api'
import { StatusBadge } from '@/lib/status'
import { MonitorStatusBadge } from '@/components/monitor-status-badge'
import { formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { usePersistedViewState } from '@/hooks/use-persisted-view-state'
import { Badge } from '@/components/ui/badge'
import { ProgressBar } from '@/components/ui/progress'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { EmptyState, Page, PageHeader } from '@/components/page'
import { SegmentedControl } from '@/components/segmented-control'
import { StatCard, type StatTone } from '@/components/stat-card'
import { TitledCard } from '@/components/titled-card'

type DashboardRange = 'today' | '24h' | '7d' | '30d'
type DashboardPath = '/accounts' | '/quarantine' | '/runs' | '/workers'

const DASHBOARD_RANGE_KEY = 'grokiq.monitor.dashboard-range.v1'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const defaultRange = { preset: 'today' as DashboardRange }
const RANGE_PRESETS: Array<{
  value: DashboardRange
  label: string
  icon?: typeof CalendarDays
}> = [
  { value: 'today', label: '今天', icon: CalendarDays },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

export function DashboardPage() {
  const view = usePersistedViewState(DASHBOARD_RANGE_KEY, defaultRange)
  const preset = isDashboardRange(view.value.preset)
    ? view.value.preset
    : 'today'
  const rangeLabel =
    RANGE_PRESETS.find((item) => item.value === preset)?.label ?? '今天'
  const query = useQuery({
    queryKey: ['dashboard', preset],
    queryFn: () => api.dashboard(hoursForPreset(preset)),
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
  })
  const loading = query.isLoading && !query.data
  const data = query.data ?? {}
  const upstream = data.upstream ?? {}
  const assessments = data.assessments ?? {}
  const samples = data.samples ?? {}
  const queue = data.queue ?? {}
  const registered = data.registered ?? {}
  const isolated = data.isolated ?? {}
  const probeRuns = data.probeRuns ?? {}
  const workers = data.workers ?? {}
  const queued = workers.queued ?? queue.queued ?? 0
  const running = workers.running ?? queue.running ?? 0
  const failedRuns =
    (probeRuns.failed ?? 0) + (probeRuns.completedWithErrors ?? 0)
  const finishedRuns = (probeRuns.completed ?? 0) + failedRuns
  const sampleSeries = seriesFromTrend(data.trend, 'samples')
  const tpsSeries = seriesFromTrend(data.trend, 'max_tps')
  const hardSeries = seriesFromTrend(data.trend, 'hard')

  const cards: Array<{
    label: string
    value: string
    detail: string
    icon: typeof UsersRound
    tone: StatTone
    to?: DashboardPath
    sparkline?: number[]
    sparklineVariant?: 'line'
    details?: Array<{ label: string; value: string }>
  }> = [
    {
      label: '上游账号',
      value: formatNumber(upstream.total ?? 0, 0),
      detail: `${formatNumber(upstream.available ?? 0, 0)} 个当前可调度`,
      icon: UsersRound,
      tone: 'blue',
      to: '/accounts',
      details: [
        {
          label: '可调度',
          value: formatNumber(upstream.available ?? 0, 0),
        },
        {
          label: '已评估',
          value: formatNumber(assessments.total ?? 0, 0),
        },
      ],
    },
    {
      label: '风险账号',
      value: formatNumber(assessments.risky ?? 0, 0),
      detail: `平均风险 ${formatNumber(assessments.avgRisk ?? 0)} 分`,
      icon: ShieldAlert,
      tone: 'red',
      to: '/accounts',
      sparkline: hardSeries,
      sparklineVariant: 'line',
    },
    {
      label: '区间新隔离',
      value: formatNumber(isolated.inRange ?? 0, 0),
      detail: `当前隔离 ${formatNumber(isolated.zoneTotal ?? 0, 0)} 个`,
      icon: ShieldBan,
      tone: 'rose',
      to: '/quarantine',
      details: [
        {
          label: '当前隔离',
          value: formatNumber(isolated.zoneTotal ?? 0, 0),
        },
        {
          label: '区间新隔离',
          value: formatNumber(isolated.inRange ?? 0, 0),
        },
      ],
    },
    {
      label: '区间注册',
      value: formatNumber(registered.total ?? 0, 0),
      detail: `完成 ${formatNumber(registered.completed ?? 0, 0)} · 失败 ${formatNumber(registered.failed ?? 0, 0)}`,
      icon: UserPlus,
      tone: 'sky',
      to: '/quarantine',
      details: [
        {
          label: '完成',
          value: formatNumber(registered.completed ?? 0, 0),
        },
        {
          label: '失败',
          value: formatNumber(registered.failed ?? 0, 0),
        },
      ],
    },
    {
      label: `${rangeLabel}探针样本`,
      value: formatNumber(samples.total ?? 0, 0),
      detail: `${formatNumber(samples.anomalies ?? 0, 0)} 个降智信号`,
      icon: Activity,
      tone: 'violet',
      to: '/runs',
      sparkline: sampleSeries,
      sparklineVariant: 'line',
    },
    {
      label: '最高 TPS',
      value: formatNumber(samples.maxTps ?? 0),
      detail: `平均 ${formatNumber(samples.avgTps ?? 0)}；上游最高 ${formatNumber(samples.maxUpstreamTps ?? 0)}`,
      icon: Zap,
      tone: 'amber',
      sparkline: tpsSeries,
      sparklineVariant: 'line',
    },
    {
      label: '排队 / 执行',
      value: `${queued} / ${running}`,
      detail: '持久队列限制任务堆积',
      icon: TimerReset,
      tone: 'cyan',
      to: '/runs',
      details: [
        { label: '排队', value: formatNumber(queued, 0) },
        { label: '执行中', value: formatNumber(running, 0) },
      ],
    },
    {
      label: '探针任务',
      value: finishedRuns ? formatPercent(probeRuns.successRate) : '—',
      detail: finishedRuns
        ? `成功 ${formatNumber(probeRuns.completed ?? 0, 0)} · 失败 ${formatNumber(failedRuns, 0)}`
        : '所选区间暂无完成任务',
      icon: CircleCheck,
      tone: 'emerald',
      to: '/runs',
      details: [
        {
          label: '成功',
          value: formatNumber(probeRuns.completed ?? 0, 0),
        },
        { label: '失败', value: formatNumber(failedRuns, 0) },
      ],
    },
    {
      label: 'Worker / 队列',
      value:
        (workers.stale ?? 0) > 0
          ? `${formatNumber(workers.stale, 0)} 超时`
          : `${formatNumber(running, 0)} 执行`,
      detail: workerHealthDetail(workers, queued),
      icon: Server,
      tone: (workers.stale ?? 0) > 0 ? 'red' : 'indigo',
      to: '/workers',
      details: [
        {
          label: '可领取',
          value: formatNumber(workers.eligible ?? 0, 0),
        },
        {
          label: '心跳超时',
          value: formatNumber(workers.stale ?? 0, 0),
        },
      ],
    },
  ]

  return (
    <Page>
      <PageHeader
        title='监控概览'
        description='直接读取 grok2api 当前账号状态，本地聚合风险周期内固定出口和临时切换出口的多轮探针结果。'
        descriptionAsHint
        actions={
          <div className='flex flex-wrap items-center justify-end gap-2'>
            <SegmentedControl
              ariaLabel='监控概览时间范围'
              value={preset}
              onChange={(next) => view.setValue({ preset: next })}
              options={RANGE_PRESETS}
            />
            <ActionToolbar label='监控概览操作'>
              <ToolbarAction
                label='刷新监控概览'
                pending={query.isFetching}
                onClick={() => void query.refetch()}
              >
                <RefreshCw />
              </ToolbarAction>
            </ActionToolbar>
          </div>
        }
      />
      {query.isError && !query.data ? (
        <Card className='border-destructive/30'>
          <CardContent className='p-5 text-sm text-destructive'>
            监控概览读取失败：{getErrorMessage(query.error)}
          </CardContent>
        </Card>
      ) : null}
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {cards.map((item, index) => (
          <StatCard key={item.label} {...item} loading={loading} index={index} />
        ))}
      </div>

      <div className='grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]'>
        <TitledCard
          icon={<Gauge />}
          iconTone='amber'
          title='TPS 趋势'
          hint={`${rangeLabel}实际探针流的平均与最高输出速度。`}
          contentClassName='h-80'
        >
            {loading ? (
              <Skeleton className='h-full w-full rounded-xl' />
            ) : (data.trend ?? []).length ? (
              <ResponsiveContainer width='100%' height='100%'>
                <AreaChart
                  data={data.trend ?? []}
                  margin={{ left: -20, right: 8 }}
                >
                  <defs>
                    <linearGradient id='avgFill' x1='0' y1='0' x2='0' y2='1'>
                      <stop
                        offset='5%'
                        stopColor='var(--chart-1)'
                        stopOpacity={0.35}
                      />
                      <stop
                        offset='95%'
                        stopColor='var(--chart-1)'
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray='3 3'
                    vertical={false}
                    stroke='var(--border)'
                  />
                  <XAxis
                    dataKey='day'
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      background: 'var(--popover)',
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type='monotone'
                    dataKey='max_tps'
                    name='最高 TPS'
                    stroke='var(--chart-5)'
                    fill='transparent'
                    strokeWidth={1.5}
                  />
                  <Area
                    type='monotone'
                    dataKey='avg_tps'
                    name='平均 TPS'
                    stroke='var(--chart-1)'
                    fill='url(#avgFill)'
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                compact
                icon={Gauge}
                title='暂无 TPS 趋势'
                description='所选区间还没有探针样本，完成探测后会显示速度曲线。'
                className='h-full border-0 bg-transparent'
              />
            )}
        </TitledCard>
        <TitledCard
          icon={<ShieldAlert />}
          iconTone='rose'
          title='风险排行'
          contentClassName='space-y-2'
        >
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className='flex items-center justify-between rounded-xl border p-3'
                >
                  <Skeleton className='h-4 w-36' />
                  <Skeleton className='h-5 w-16' />
                </div>
              ))
            ) : data.riskyAccounts?.length ? (
              data.riskyAccounts.map((account: UpstreamAccount) => (
                <Link
                  key={account.id}
                  to='/accounts'
                  className='flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                >
                  <div className='flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-xs font-semibold text-rose-700 dark:text-rose-300'>
                    {String(account.name || account.id)
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium'>
                      {account.name || `账号 ${account.id}`}
                    </div>
                    <div className='truncate text-xs text-muted-foreground'>
                      {account.email || `ID ${account.id}`}
                    </div>
                  </div>
                  <div className='text-right'>
                    <MonitorStatusBadge status={account.assessment?.monitor_status} />
                    {account.ssoRiskStatus === 'flagged' && (
                      <Badge variant='destructive' className='mt-1 ml-1'>
                        SSO 已标记
                      </Badge>
                    )}
                    {account.egressRecommendation?.type === 'change_egress' && (
                      <Badge variant='warning' className='mt-1 ml-1'>
                        建议换出口
                      </Badge>
                    )}
                    <div className='mt-1 text-xs text-muted-foreground tabular-nums'>
                      {formatNumber(account.assessment?.risk_score)} 分
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState
                compact
                icon={ShieldAlert}
                title='暂无已评估账号'
                description='完成账号探针后会在这里显示风险排序'
                className='min-h-44 border-0 bg-transparent'
              />
            )}
        </TitledCard>
      </div>

      <TitledCard
        icon={<TimerReset />}
        iconTone='cyan'
        title='最近任务'
        hint='手动、注册联动与 Cron 触发的任务使用同一持久队列。'
        contentClassName='grid gap-3 md:grid-cols-2 xl:grid-cols-4'
      >
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div key={index} className='rounded-xl border p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <Skeleton className='h-4 w-28' />
                  <Skeleton className='h-5 w-14' />
                </div>
                <div className='mt-3 flex items-center justify-between'>
                  <Skeleton className='h-3 w-16' />
                  <Skeleton className='h-3 w-20' />
                </div>
                <Skeleton className='mt-2 h-1.5 w-full rounded-full' />
              </div>
            ))
          ) : data.recentRuns?.length ? (
            data.recentRuns.map((run: ProbeRun, index) => (
              <Link
                key={run.id}
                to='/runs'
                style={{ '--stagger': String(index) } as CSSProperties}
                className='animate-rise rounded-xl border p-3 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
              >
                <div className='flex items-center justify-between gap-2'>
                  <div className='truncate text-sm font-medium'>
                    {run.account_name || `账号 ${run.account_id}`}
                  </div>
                  <StatusBadge value={run.status} />
                </div>
                <div className='mt-3 flex items-center justify-between text-xs text-muted-foreground'>
                  <span>
                    {run.completed_steps}/{run.total_steps} 步
                  </span>
                  <span>{formatDate(run.created_at)}</span>
                </div>
                <ProgressBar
                  className='mt-2'
                  value={
                    run.total_steps
                      ? (run.completed_steps / run.total_steps) * 100
                      : 0
                  }
                />
              </Link>
            ))
          ) : (
            <EmptyState
              compact
              icon={TimerReset}
              title='暂无最近任务'
              description='手动测试或 Cron 调度后会显示执行进度'
              className='md:col-span-2 xl:col-span-4'
            />
          )}
      </TitledCard>
    </Page>
  )
}

function isDashboardRange(value: string): value is DashboardRange {
  return (
    value === 'today' || value === '24h' || value === '7d' || value === '30d'
  )
}

function hoursForPreset(preset: DashboardRange) {
  if (preset === 'today') return hoursSinceShanghaiMidnight()
  if (preset === '24h') return 24
  if (preset === '7d') return 168
  return 720
}

function hoursSinceShanghaiMidnight(now = Date.now()) {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS)
  const midnightUtc =
    Date.UTC(
      shanghai.getUTCFullYear(),
      shanghai.getUTCMonth(),
      shanghai.getUTCDate()
    ) - SHANGHAI_OFFSET_MS
  const hours = (now - midnightUtc) / 3_600_000
  return Math.min(24, Math.max(1, Math.ceil(hours)))
}

function formatPercent(rate: number | null | undefined) {
  if (rate == null || Number.isNaN(rate)) return '—'
  const percent = rate * 100
  return `${percent.toFixed(percent > 0 && percent < 10 ? 1 : 0)}%`
}

function formatWaitSeconds(value: number | null | undefined) {
  const seconds = Math.max(0, Math.floor(Number(value ?? 0)))
  if (seconds <= 0) return '无排队等待'
  if (seconds < 60) return `最长等待 ${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `最长等待 ${minutes} 分钟`
  return `最长等待 ${(minutes / 60).toFixed(1)} 小时`
}

function workerHealthDetail(
  workers: {
    stale?: number
    eligible?: number
    blockedRestore?: number
    oldestQueueWaitSeconds?: number
  },
  queued: number
) {
  if ((workers.stale ?? 0) > 0) return `${queued} 排队 · 执行心跳超时`
  if ((workers.blockedRestore ?? 0) > 0) {
    return `${workers.blockedRestore} 个恢复阻塞 · ${formatWaitSeconds(workers.oldestQueueWaitSeconds)}`
  }
  if (workers.eligible != null) {
    return `${formatNumber(workers.eligible, 0)} 个可领取 · ${formatWaitSeconds(workers.oldestQueueWaitSeconds)}`
  }
  return formatWaitSeconds(workers.oldestQueueWaitSeconds)
}

function seriesFromTrend(
  trend: Array<Record<string, string | number | null>> | undefined,
  key: string
) {
  const values = (trend ?? []).map((row) => Number(row[key] ?? 0))
  return values.some((value) => value > 0) ? values : undefined
}
