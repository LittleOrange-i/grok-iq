import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Gauge,
  RefreshCw,
  ShieldAlert,
  TimerReset,
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
import { formatDate, formatNumber } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Page, PageHeader, LoadingState } from '@/components/page'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { InfoTooltip } from '@/components/info-tooltip'

export function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(168),
    refetchInterval: 15_000,
  })
  if (query.isLoading)
    return (
      <Page>
        <LoadingState />
      </Page>
    )
  const data = query.data ?? {}
  const upstream = data.upstream ?? {}
  const assessments = data.assessments ?? {}
  const samples = data.samples ?? {}
  const queue = data.queue ?? {}

  const cards = [
    {
      label: '上游账号',
      value: upstream.total ?? 0,
      detail: `${upstream.available ?? 0} 个当前可调度`,
      icon: UsersRound,
      tone: 'text-blue-600 bg-blue-500/10',
    },
    {
      label: '风险账号',
      value: assessments.risky ?? 0,
      detail: `${assessments.quarantined ?? 0} 个已暂时停用`,
      icon: ShieldAlert,
      tone: 'text-red-600 bg-red-500/10',
    },
    {
      label: '七日探针样本',
      value: samples.total ?? 0,
      detail: `${samples.anomalies ?? 0} 个降智信号`,
      icon: Activity,
      tone: 'text-violet-600 bg-violet-500/10',
    },
    {
      label: '最高输出 TPS',
      value: formatNumber(samples.maxTps ?? 0),
      detail: `平均 ${formatNumber(samples.avgTps ?? 0)} TPS`,
      icon: Zap,
      tone: 'text-amber-600 bg-amber-500/10',
    },
    {
      label: '排队 / 执行',
      value: `${queue.queued ?? 0} / ${queue.running ?? 0}`,
      detail: '持久队列限制任务堆积',
      icon: TimerReset,
      tone: 'text-cyan-600 bg-cyan-500/10',
    },
  ]

  return (
    <Page>
      <PageHeader
        title='监控概览'
        description='直接读取 grok2api 当前账号状态，本地聚合当前固定出口的多轮探针结果。'
        descriptionAsHint
        actions={
          <ActionToolbar label='监控概览操作'>
            <ToolbarAction
              label='刷新监控概览'
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw />
            </ToolbarAction>
          </ActionToolbar>
        }
      />
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
        {cards.map((item) => (
          <Card key={item.label}>
            <CardContent className='flex items-start gap-3 p-5'>
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${item.tone}`}
              >
                <item.icon className='size-5' />
              </div>
              <div className='min-w-0'>
                <p className='text-xs text-muted-foreground'>{item.label}</p>
                <p className='number mt-1 text-2xl font-semibold'>
                  {item.value}
                </p>
                <p className='mt-1 truncate text-xs text-muted-foreground'>
                  {item.detail}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-1.5'>
              <Gauge className='size-4 text-primary' />
              TPS 趋势
              <InfoTooltip
                label='TPS 趋势'
                content='最近七天实际探针流的平均与最高输出速度。'
              />
            </CardTitle>
          </CardHeader>
          <CardContent className='h-80'>
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
                    borderRadius: 10,
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-1.5'>
              风险排行
              <InfoTooltip
                label='风险排行'
                content='仅展示本地已有探针判定的账号。'
              />
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {(data.riskyAccounts ?? []).map((account: UpstreamAccount) => (
              <div
                key={account.id}
                className='flex items-center gap-3 rounded-lg border p-3'
              >
                <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold'>
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
                  <StatusBadge value={account.assessment?.monitor_status} />
                  <div className='mt-1 text-xs text-muted-foreground tabular-nums'>
                    {formatNumber(account.assessment?.risk_score)} 分
                  </div>
                </div>
              </div>
            ))}
            {!data.riskyAccounts?.length && (
              <div className='flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed px-5 text-center'>
                <ShieldAlert className='mb-2 size-6 text-muted-foreground' />
                <div className='text-sm font-medium'>暂无已评估账号</div>
                <div className='mt-1 text-xs text-muted-foreground'>
                  完成账号探针后会在这里显示风险排序
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-1.5'>
            最近任务
            <InfoTooltip
              label='最近任务'
              content='手动、注册联动与 Cron 触发的任务使用同一持久队列。'
            />
          </CardTitle>
        </CardHeader>
        <CardContent className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          {(data.recentRuns ?? []).map((run: ProbeRun) => (
            <div key={run.id} className='rounded-lg border p-3'>
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
              <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-muted'>
                <div
                  className='h-full rounded-full bg-primary transition-all'
                  style={{
                    width: `${run.total_steps ? (run.completed_steps / run.total_steps) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {!data.recentRuns?.length && (
            <div className='flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-5 text-center md:col-span-2 xl:col-span-4'>
              <TimerReset className='mb-2 size-6 text-muted-foreground' />
              <div className='text-sm font-medium'>暂无最近任务</div>
              <div className='mt-1 text-xs text-muted-foreground'>
                手动测试或 Cron 调度后会显示执行进度
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}
