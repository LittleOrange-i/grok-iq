import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  Clock3,
  ShieldBan,
  TimerReset,
  UserPlus,
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
import { api, type IsolationStatsResponse } from '@/lib/api'
import { cn, formatNumber, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InfoTooltip } from '@/components/info-tooltip'
import { usePersistedViewState } from '@/hooks/use-persisted-view-state'

type StatsPreset = 'today' | '24h' | '7d' | '30d' | 'custom'

const STATS_VIEW_KEY = 'grokiq.monitor.quarantine-stats.v1'
const defaultStatsView = {
  preset: 'today' as StatsPreset,
  from: '',
  to: '',
}

const PRESETS: Array<{ value: StatsPreset; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

export function QuarantineStatsBoard() {
  const view = usePersistedViewState(STATS_VIEW_KEY, defaultStatsView)
  const { preset, from, to } = view.value
  const range = useMemo(
    () => rangeForPreset(preset, from, to),
    [from, preset, to]
  )
  const fromIso = toIsoDateTime(range.from)
  const toIso = toIsoDateTime(range.to)
  const query = useQuery({
    queryKey: ['accounts', 'quarantine-stats', fromIso, toIso],
    queryFn: ({ signal }) =>
      api.quarantineStats({ from: fromIso, to: toIso }, signal),
    enabled: Boolean(fromIso && toIso && fromIso <= toIso),
  })
  const data = query.data
  const invalidRange = Boolean(fromIso && toIso && fromIso > toIso)

  return (
    <Card>
      <CardHeader className='gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(20rem,auto)]'>
        <div className='min-w-0'>
          <CardTitle className='flex items-center gap-1.5 text-base'>
            <ShieldBan className='size-4 text-primary' />
            隔离看板
            <InfoTooltip
              label='隔离看板'
              content='按所选时间统计注册联动入库，以及当前隔离区里的进入时间。恢复出隔离区的账号不会再计入库存；注册数来自本系统收到的注册联动事件，不是 grok2api 全部账号。'
            />
          </CardTitle>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            看今天注册了多少账号、其中多少已被隔离，以及隔离区现有库存。
          </p>
        </div>
        <div className='flex min-w-0 flex-col gap-2 sm:items-end'>
          <div className='flex flex-wrap gap-2'>
            {PRESETS.map((item) => (
              <Button
                key={item.value}
                type='button'
                size='sm'
                variant={preset === item.value ? 'secondary' : 'outline'}
                className='h-8'
                onClick={() => {
                  const next = rangeForPreset(item.value, '', '')
                  view.setValue({
                    preset: item.value,
                    from: next.from,
                    to: next.to,
                  })
                }}
              >
                {item.value === 'today' ? <CalendarDays /> : null}
                {item.label}
              </Button>
            ))}
          </div>
          <div className='grid w-full gap-2 sm:w-auto sm:grid-cols-2'>
            <label className='grid gap-1'>
              <span className='text-[11px] text-muted-foreground'>开始</span>
              <Input
                type='datetime-local'
                value={range.from}
                max={range.to || undefined}
                onChange={(event) =>
                  view.setValue({
                    preset: 'custom',
                    from: event.target.value,
                    to: range.to,
                  })
                }
                className='h-9 text-xs'
                aria-label='统计开始时间'
              />
            </label>
            <label className='grid gap-1'>
              <span className='text-[11px] text-muted-foreground'>结束</span>
              <Input
                type='datetime-local'
                value={range.to}
                min={range.from || undefined}
                onChange={(event) =>
                  view.setValue({
                    preset: 'custom',
                    from: range.from,
                    to: event.target.value,
                  })
                }
                className='h-9 text-xs'
                aria-label='统计结束时间'
              />
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {invalidRange ? (
          <p className='text-sm text-destructive'>结束时间不能早于开始时间</p>
        ) : query.isError ? (
          <p className='text-sm text-destructive'>
            {getErrorMessage(query.error)}
          </p>
        ) : (
          <>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <MetricCard
                icon={ShieldBan}
                tone='text-red-600 bg-red-500/10'
                label='当前隔离'
                value={data?.zone.total}
                detail={`区间内新隔离 ${formatNumber(data?.zone.isolatedInRange ?? 0, 0)}`}
                hint='当前还在隔离区的账号。区间内新隔离只统计进入时间落在所选范围内、且现在仍在隔离区的账号。'
                loading={query.isLoading}
              />
              <MetricCard
                icon={UserPlus}
                tone='text-sky-600 bg-sky-500/10'
                label='区间注册'
                value={data?.registered.total}
                detail={`完成 ${formatNumber(data?.registered.completed ?? 0, 0)} · 失败 ${formatNumber(data?.registered.failed ?? 0, 0)}`}
                hint='本系统在该时间范围内收到的注册联动账号，按邮箱或上游账号去重。'
                loading={query.isLoading}
              />
              <MetricCard
                icon={TimerReset}
                tone='text-amber-600 bg-amber-500/10'
                label='注册后隔离'
                value={data?.registered.isolated}
                detail={`隔离率 ${formatPercent(data?.registered.isolationRate)} · 同期隔离 ${formatNumber(data?.registered.isolatedInRange ?? 0, 0)}`}
                hint='区间内注册、现在仍在隔离区的账号。同期隔离表示注册和进入隔离区都发生在该范围内。'
                loading={query.isLoading}
              />
              <MetricCard
                icon={Clock3}
                tone='text-violet-600 bg-violet-500/10'
                label='入隔耗时'
                value={formatDurationHours(data?.timing.medianHours)}
                raw
                detail={`平均 ${formatDurationHours(data?.timing.avgHours)} · ${formatNumber(data?.timing.sampleCount ?? 0, 0)} 个样本`}
                hint='从注册联动入库到进入隔离区的中位耗时，只统计两边时间都有的账号。'
                loading={query.isLoading}
              />
            </div>
            <SourceRow
              label='当前隔离来源'
              items={data?.zone.bySource ?? []}
              loading={query.isLoading}
            />
            {(data?.trend.length ?? 0) > 1 ? (
              <TrendChart data={data?.trend ?? []} />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MetricCard({
  icon: Icon,
  tone,
  label,
  value,
  detail,
  hint,
  loading,
  raw = false,
}: {
  icon: typeof ShieldBan
  tone: string
  label: string
  value: string | number | null | undefined
  detail: string
  hint: string
  loading: boolean
  raw?: boolean
}) {
  return (
    <div className='rounded-xl border bg-muted/15 p-4'>
      <div className='flex items-start gap-3'>
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            tone
          )}
        >
          <Icon className='size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <InfoTooltip label={label} content={hint} />
          </div>
          <p className='number mt-1 text-2xl font-semibold'>
            {loading ? '…' : raw ? (value ?? '—') : formatNumber(Number(value ?? 0), 0)}
          </p>
          <p className='mt-1 truncate text-xs text-muted-foreground'>{detail}</p>
        </div>
      </div>
    </div>
  )
}

function SourceRow({
  label,
  items,
  loading,
}: {
  label: string
  items: IsolationStatsResponse['zone']['bySource']
  loading: boolean
}) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      {loading ? (
        <span className='text-xs text-muted-foreground'>统计中…</span>
      ) : items.length === 0 ? (
        <span className='text-xs text-muted-foreground'>暂无</span>
      ) : (
        items.map((item) => (
          <Badge key={item.source} variant='outline' className='gap-1.5'>
            {item.label}
            <span className='tabular-nums text-foreground'>{item.count}</span>
          </Badge>
        ))
      )}
    </div>
  )
}

function TrendChart({
  data,
}: {
  data: IsolationStatsResponse['trend']
}) {
  return (
    <div className='h-56'>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
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
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--popover)',
              fontSize: 12,
            }}
          />
          <Area
            type='monotone'
            dataKey='registered'
            name='注册'
            stroke='var(--chart-1)'
            fill='var(--chart-1)'
            fillOpacity={0.12}
            strokeWidth={2}
          />
          <Area
            type='monotone'
            dataKey='isolated'
            name='新隔离'
            stroke='var(--chart-5)'
            fill='transparent'
            strokeWidth={1.5}
          />
          <Area
            type='monotone'
            dataKey='registeredIsolated'
            name='注册后隔离'
            stroke='var(--chart-3)'
            fill='transparent'
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function rangeForPreset(preset: StatsPreset, from: string, to: string) {
  if (preset === 'today') return localDayRange(new Date())
  if (preset === '24h') return recentHoursRange(24)
  if (preset === '7d') return recentHoursRange(24 * 7)
  if (preset === '30d') return recentHoursRange(24 * 30)
  return { from, to }
}

function localDayRange(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const prefix = `${year}-${month}-${day}`
  return { from: `${prefix}T00:00`, to: `${prefix}T23:59` }
}

function toDateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function recentHoursRange(hours: number) {
  const end = new Date()
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000)
  return { from: toDateTimeLocal(start), to: toDateTimeLocal(end) }
}

function toIsoDateTime(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function formatPercent(rate: number | null | undefined) {
  if (rate == null || Number.isNaN(rate)) return '—'
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`
}

function formatDurationHours(hours: number | null | undefined) {
  if (hours == null || Number.isNaN(hours)) return '—'
  if (hours <= 0) return '刚刚'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟`
  if (hours < 48) return `${hours.toFixed(1)} 小时`
  return `${(hours / 24).toFixed(1)} 天`
}
