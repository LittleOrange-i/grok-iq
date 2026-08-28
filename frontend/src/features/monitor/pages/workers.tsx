import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowDownToLine,
  Ban,
  CircleCheck,
  CircleX,
  Clock3,
  Cpu,
  ExternalLink,
  History,
  ListChecks,
  MemoryStick,
  RefreshCw,
  Server,
  Square,
} from 'lucide-react'
import {
  api,
  type ProbeWorker,
  type ProbeWorkerLogsResponse,
  type ProbeWorkersResponse,
} from '@/lib/api'
import { cn, formatDate, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { CopyButton } from '@/components/copy-button'
import { SourceCodeView } from '@/components/formatted-content'
import { InfoTooltip } from '@/components/info-tooltip'
import {
  EmptyState,
  LoadingState,
  Page,
  PageHeader,
  PageSkeleton,
} from '@/components/page'
import {
  buildEgressNodeNameMap,
  getEgressNodeName,
  type EgressNodeNameMap,
} from '@/features/monitor/components/egress-node-names'
import { runsSearchFromAccount } from '@/features/monitor/pages/runs-search'
import { EgressNodeReference } from '@/features/monitor/components/egress-node-reference'
import { RegisterWebhookInbox } from '@/features/monitor/components/register-webhook-inbox'

const workerStatusMeta: Record<
  string,
  { label: string; icon: ComponentType<{ className?: string }>; tone: string }
> = {
  starting: { label: '启动中', icon: RefreshCw, tone: 'text-sky-600' },
  idle: { label: '空闲', icon: CircleCheck, tone: 'text-emerald-600' },
  running: { label: '执行中', icon: RefreshCw, tone: 'text-sky-600' },
  blocked: { label: '等待同账号任务', icon: Clock3, tone: 'text-amber-600' },
  stopping: { label: '停止中', icon: Square, tone: 'text-amber-600' },
  stopped: { label: '已停止', icon: Ban, tone: 'text-muted-foreground' },
  restarting: { label: '自动重启中', icon: RefreshCw, tone: 'text-amber-600' },
  error: { label: '异常', icon: CircleX, tone: 'text-destructive' },
}

export function WorkersPage() {
  const [logsOpen, setLogsOpen] = useState(false)
  const [logLimit, setLogLimit] = useState(300)
  const workerQuery = useQuery({
    queryKey: ['probe-workers'],
    queryFn: api.probeWorkers,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  })
  const workerLogs = useQuery({
    queryKey: ['probe-worker-logs', logLimit],
    queryFn: () => api.probeWorkerLogs(logLimit),
    enabled: logsOpen,
    refetchInterval:
      logsOpen && (workerQuery.data?.busyWorkers ?? 0) > 0 ? 2_000 : false,
    refetchIntervalInBackground: false,
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

  return (
    <Page>
      <PageHeader
        title='Worker 运行状态'
        description='查看探针执行进程、并发 Worker、队列阻塞与最近两天的轮转日志。'
        descriptionAsHint
        actions={
          <ActionToolbar label='Worker 状态操作'>
            <ToolbarAction
              label='查看 Worker 执行日志'
              onClick={() => setLogsOpen(true)}
            >
              <History />
            </ToolbarAction>
            <ToolbarAction
              label='刷新 Worker 状态'
              pending={workerQuery.isFetching}
              onClick={() => void workerQuery.refetch()}
            >
              <RefreshCw />
            </ToolbarAction>
          </ActionToolbar>
        }
      />

      {workerQuery.error ? (
        <Card className='border-destructive/30'>
          <CardContent className='p-6 text-sm text-destructive'>
            Worker 状态读取失败：{getErrorMessage(workerQuery.error)}
          </CardContent>
        </Card>
      ) : workerQuery.isLoading || !workerQuery.data ? (
        <PageSkeleton />
      ) : (
        <WorkerDashboard
          data={workerQuery.data}
          egressNodeNames={egressNodeNames}
        />
      )}

      <RegisterWebhookInbox />

      <WorkerLogsDialog
        open={logsOpen}
        onOpenChange={setLogsOpen}
        limit={logLimit}
        onLimitChange={setLogLimit}
        data={workerLogs.data}
        loading={workerLogs.isLoading}
        fetching={workerLogs.isFetching}
        error={workerLogs.error}
        onRefresh={() => void workerLogs.refetch()}
      />
    </Page>
  )
}

function WorkerDashboard({
  data,
  egressNodeNames,
}: {
  data: ProbeWorkersResponse
  egressNodeNames: EgressNodeNameMap
}) {
  return (
    <>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <OverviewCard
          icon={Server}
          label='后端进程'
          value={`PID ${data.process.pid}`}
          detail={data.process.hostname}
        />
        <OverviewCard
          icon={Cpu}
          label='Worker 存活'
          value={`${data.liveWorkers} / ${data.desiredConcurrency}`}
          detail={`${data.busyWorkers} 忙碌 · ${data.idleWorkers} 空闲`}
          warning={data.liveWorkers !== data.desiredConcurrency}
        />
        <OverviewCard
          icon={ListChecks}
          label='持久队列'
          value={data.queue.queued}
          detail={`${data.queue.eligible} 个当前可领取`}
          warning={data.queue.blockedRestore > 0}
        />
        <OverviewCard
          icon={Clock3}
          label='进程运行时间'
          value={formatUptime(data.process.uptimeSeconds)}
          detail={formatDate(data.process.startedAt)}
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-2'>
        <LiveMetricsCard
          icon={MemoryStick}
          title='进程资源'
          description='当前监控后端进程占用，不代表整台主机资源。'
          items={[
            {
              label: 'CPU',
              value: formatPercentValue(data.process.resources.cpuPercent),
            },
            {
              label: '内存',
              value: formatOptionalBytes(data.process.resources.rssBytes),
            },
            {
              label: '线程',
              value: formatOptionalNumber(data.process.resources.threads),
            },
            {
              label: '文件句柄',
              value: formatOptionalNumber(data.process.resources.openFiles),
            },
            {
              label: '事件循环延迟',
              value: formatMilliseconds(data.process.resources.eventLoopLagMs),
              warning: (data.process.resources.eventLoopLagMs ?? 0) >= 100,
            },
          ]}
        />
        <LiveMetricsCard
          icon={Activity}
          title='实时运行'
          description={`最近 ${data.activity.windowSeconds} 秒完成情况与当前队列压力。`}
          items={[
            { label: '活跃请求', value: data.activity.activeCalls },
            { label: '完成任务', value: data.activity.completed },
            {
              label: '失败率',
              value: `${(data.activity.failureRate * 100).toFixed(1)}%`,
              warning: data.activity.failureRate > 0,
            },
            {
              label: '平均耗时',
              value: formatDuration(data.activity.averageDurationSeconds),
            },
            {
              label: '最长排队',
              value: formatDuration(data.activity.oldestQueueWaitSeconds),
              warning: data.activity.oldestQueueWaitSeconds >= 60,
            },
          ]}
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]'>
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <CardTitle className='flex items-center gap-1.5'>
                执行实例
                <InfoTooltip
                  label='执行实例'
                  content='不同账号可并行；同一账号始终由一个 Worker 顺序处理。'
                />
              </CardTitle>
              <Badge
                variant={data.started && !data.stopping ? 'success' : 'outline'}
              >
                {data.stopping
                  ? '进程停止中'
                  : data.started
                    ? '运行中'
                    : '未启动'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className='grid gap-3 lg:grid-cols-2'>
              {data.workers.map((worker) => (
                <WorkerCard
                  key={worker.id}
                  worker={worker}
                  egressNodeNames={egressNodeNames}
                />
              ))}
              {!data.workers.length && (
                <div className='lg:col-span-2'>
                  <EmptyState
                    title='暂无 Worker 实例'
                    description='后端启动探针管理器后，这里会显示每个 Worker 的存活和任务信息。'
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-1.5'>
                队列分布
                <InfoTooltip
                  label='队列分布'
                  content='仅可领取任务会分配给当前空闲 Worker。'
                />
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <QueueRow label='全部排队' value={data.queue.queued} />
              <QueueRow label='当前可领取' value={data.queue.eligible} />
              <QueueRow label='正在执行' value={data.queue.running} />
              <QueueRow
                label='同账号阻塞'
                value={data.queue.blockedSameAccount}
                warning={data.queue.blockedSameAccount > 0}
              />
              <QueueRow
                label='等待账号恢复'
                value={data.queue.blockedRestore}
                warning={data.queue.blockedRestore > 0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-1.5'>
                运行策略
                <InfoTooltip
                  label='运行策略'
                  content='展示账号共享状态的并发边界和日志轮转策略。'
                />
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-muted-foreground'>同账号任务</span>
                <Badge variant='outline'>串行</Badge>
              </div>
              <div className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2'>
                <span className='flex min-w-0 items-center gap-1.5 text-muted-foreground'>
                  并发原因
                  <InfoTooltip label='并发原因' content={data.policy.reason} />
                </span>
                <Badge variant='secondary'>账号锁</Badge>
              </div>
              <div className='rounded-lg border px-3 py-2'>
                <div className='flex items-center justify-between gap-3 text-xs'>
                  <span className='flex min-w-0 items-center gap-1 text-muted-foreground'>
                    日志文件
                    <InfoTooltip
                      label='日志轮转'
                      content={`UTC 每日轮转，保留 ${data.log.retentionDays} 天。`}
                    />
                  </span>
                  <span className='shrink-0 font-medium tabular-nums'>
                    {formatBytes(data.log.sizeBytes)}
                  </span>
                </div>
                <div
                  className='mt-1 truncate font-mono text-[11px] text-muted-foreground'
                  title={data.log.fileName}
                >
                  {data.log.fileName}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  detail,
  warning = false,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: ReactNode
  detail: ReactNode
  warning?: boolean
}) {
  return (
    <Card className={cn(warning && 'border-amber-500/30')}>
      <CardContent className='flex items-start gap-4 p-5'>
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
            warning && 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          )}
        >
          <Icon className='size-5' />
        </div>
        <div className='min-w-0'>
          <div className='text-xs text-muted-foreground'>{label}</div>
          <div className='mt-1 truncate text-xl font-semibold tabular-nums'>
            {value}
          </div>
          <div className='mt-1 truncate text-xs text-muted-foreground'>
            {detail}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function LiveMetricsCard({
  icon: Icon,
  title,
  description,
  items,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  items: { label: string; value: ReactNode; warning?: boolean }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icon className='size-4 text-primary' />
          {title}
          <InfoTooltip label={title} content={description} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5'>
          {items.map((item) => (
            <div key={item.label} className='min-w-0 bg-background px-3 py-3'>
              <div className='truncate text-[11px] text-muted-foreground'>
                {item.label}
              </div>
              <div
                className={cn(
                  'mt-1 truncate text-sm font-semibold tabular-nums',
                  item.warning && 'text-amber-600 dark:text-amber-400'
                )}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function WorkerCard({
  worker,
  egressNodeNames,
}: {
  worker: ProbeWorker
  egressNodeNames: EgressNodeNameMap
}) {
  const meta = workerStatusMeta[worker.status] ?? workerStatusMeta.error
  const Icon = meta.icon
  return (
    <div className='min-w-0 rounded-xl border bg-background p-4'>
      <div className='flex items-start gap-3'>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20',
                meta.tone
              )}
              tabIndex={0}
            >
              <Icon
                className={cn(
                  'size-4',
                  ['running', 'starting', 'restarting'].includes(
                    worker.status
                  ) && 'animate-spin'
                )}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{meta.label}</TooltipContent>
        </Tooltip>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='flex min-w-0 items-center gap-1'>
              <span className='font-mono text-sm font-semibold'>
                {worker.id}
              </span>
              <CopyButton value={worker.id} className='size-6' />
            </span>
            <span className={cn('text-xs', meta.tone)}>{meta.label}</span>
            {!worker.desired && <Badge variant='outline'>已移出</Badge>}
            {!worker.taskAlive && <Badge variant='destructive'>离线</Badge>}
          </div>
          <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
            <span className='tabular-nums'>已完成 {worker.completedRuns}</span>
            <span className='tabular-nums'>异常 {worker.failedRuns}</span>
            <span className='flex items-center gap-1'>
              心跳
              <InfoTooltip
                label={`${worker.id} 最近心跳`}
                content={formatDate(worker.lastHeartbeatAt)}
              />
            </span>
          </div>
        </div>
      </div>

      {worker.currentRun ? (
        <div className='mt-4 rounded-lg bg-muted/45 p-3'>
          <div className='flex min-w-0 items-start justify-between gap-3'>
            <div className='min-w-0'>
              <div className='truncate text-sm font-medium'>
                {worker.currentRun.accountName ||
                  `账号 ${worker.currentRun.accountId ?? '—'}`}
              </div>
              <div className='mt-1 truncate text-xs text-muted-foreground'>
                {worker.currentRun.profileName || worker.currentRun.profileId}
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size='icon' variant='ghost'>
                  <Link
                    to='/runs'
                    search={
                      runsSearchFromAccount(
                        worker.currentRun.accountId,
                        worker.currentRun.id
                      ) as never
                    }
                    aria-label='前往任务中心'
                  >
                    <ExternalLink />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>前往任务中心查看详情</TooltipContent>
            </Tooltip>
          </div>
          <div className='mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
            <Badge variant='outline'>
              {formatExecutionMode(worker.currentRun.executionMode)}
            </Badge>
            <span>
              {worker.currentRun.round
                ? `第 ${worker.currentRun.round} 轮`
                : '准备中'}
            </span>
            <span>·</span>
            <WorkerTargetLabel
              value={worker.currentRun.targetKey}
              egressNodeNames={egressNodeNames}
            />
            <span>·</span>
            <span className='tabular-nums'>
              已运行 {formatDuration(worker.currentRun.elapsedSeconds)}
            </span>
          </div>
          <div className='mt-2 flex min-w-0 items-center gap-1'>
            <div
              className='min-w-0 truncate font-mono text-[11px] text-muted-foreground'
              title={worker.currentRun.id}
            >
              {worker.currentRun.id}
            </div>
            <CopyButton value={worker.currentRun.id} className='size-6' />
          </div>
        </div>
      ) : (
        <div className='mt-4 flex min-h-16 items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
          <Clock3 className='size-4 shrink-0' />
          <span>
            {worker.status === 'blocked' ? '当前无可领取任务' : '当前空闲'}
          </span>
          {worker.status === 'blocked' && (
            <InfoTooltip
              label='当前无可领取任务'
              content='队列中仅剩同账号串行阻塞或等待账号设置恢复的任务。'
            />
          )}
        </div>
      )}

      {worker.lastError && (
        <div
          className='mt-3 line-clamp-2 text-xs leading-5 text-destructive'
          title={worker.lastError}
        >
          {worker.lastError}
        </div>
      )}
    </div>
  )
}

function QueueRow({
  label,
  value,
  warning = false,
}: {
  label: string
  value: number
  warning?: boolean
}) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2'>
      <span className='text-sm text-muted-foreground'>{label}</span>
      <span
        className={cn(
          'font-medium tabular-nums',
          warning && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function WorkerTargetLabel({
  value,
  egressNodeNames,
}: {
  value?: string | null
  egressNodeNames: EgressNodeNameMap
}) {
  if (!value) return <span>等待步骤</span>
  if (value === 'current') return <span>账号当前出口</span>
  if (value === 'direct') return <span>上游调度（诊断）</span>
  if (!value.startsWith('egress:')) return <span>{value}</span>
  const nodeId = value.slice(7)
  return (
    <EgressNodeReference
      nodeId={nodeId}
      nodeName={getEgressNodeName(egressNodeNames, nodeId)}
      prefix='Node '
    />
  )
}

function WorkerLogsDialog({
  open,
  onOpenChange,
  limit,
  onLimitChange,
  data,
  loading,
  fetching,
  error,
  onRefresh,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  limit: number
  onLimitChange: (limit: number) => void
  data?: ProbeWorkerLogsResponse
  loading: boolean
  fetching: boolean
  error: unknown
  onRefresh: () => void
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const logContent = data?.items.join('\n') ?? ''

  const updateFollowing = useCallback((value: boolean) => {
    followingRef.current = value
    setFollowing(value)
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
    updateFollowing(true)
  }, [updateFollowing])

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    const atBottom = distanceFromBottom <= 24
    if (atBottom !== followingRef.current) updateFollowing(atBottom)
  }, [updateFollowing])

  useEffect(() => {
    if (!open || !followingRef.current) return
    const frame = window.requestAnimationFrame(scrollToBottom)
    return () => window.cancelAnimationFrame(frame)
  }, [logContent, open, scrollToBottom])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) updateFollowing(true)
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        size='wide'
        className='h-[min(52rem,calc(100dvh-2rem))] overflow-hidden'
      >
        <DialogHeader className='shrink-0'>
          <DialogTitle>Worker 执行日志</DialogTitle>
          <DialogDescription>
            日志按 UTC 每日轮转并保留 {data?.retentionDays ?? 2}{' '}
            天；页面只读取最新日志，最多展示 1500 行。
          </DialogDescription>
        </DialogHeader>
        <div className='flex shrink-0 flex-wrap items-center gap-2'>
          {[300, 800, 1500].map((value) => (
            <Button
              key={value}
              type='button'
              size='sm'
              variant={limit === value ? 'default' : 'outline'}
              onClick={() => onLimitChange(value)}
            >
              最近 {value} 行
            </Button>
          ))}
          <ActionToolbar label='Worker 日志操作' className='ms-auto'>
            <ToolbarAction
              label='滚动到底并恢复自动滚动'
              disabled={!logContent}
              onClick={scrollToBottom}
            >
              <ArrowDownToLine />
            </ToolbarAction>
            <ToolbarAction
              label='刷新执行日志'
              pending={fetching}
              onClick={onRefresh}
            >
              <RefreshCw />
            </ToolbarAction>
          </ActionToolbar>
        </div>
        <div
          ref={scrollContainerRef}
          className='min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border bg-background'
          onScroll={handleScroll}
        >
          {loading ? (
            <LoadingState label='正在读取 Worker 日志' />
          ) : error ? (
            <div className='p-4 text-sm text-destructive'>
              日志读取失败：{getErrorMessage(error)}
            </div>
          ) : data?.items.length ? (
            <SourceCodeView
              content={logContent}
              className='min-h-full bg-background text-foreground'
            />
          ) : (
            <EmptyState
              title='暂无执行日志'
              description='后端执行探针任务后，这里会显示领取、步骤、结果和恢复记录。'
            />
          )}
        </div>
        <div className='flex shrink-0 items-center justify-between gap-3 text-xs text-muted-foreground'>
          <span className='min-w-0 truncate'>
            {data
              ? `${data.fileName} · ${formatBytes(data.sizeBytes)} · 其余较早日志不加载到页面`
              : '其余较早日志保留在轮转文件中，不加载到页面。'}
          </span>
          {logContent && (
            <Badge variant={following ? 'success' : 'secondary'}>
              {following ? '自动滚动' : '已暂停'}
            </Badge>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatExecutionMode(value: string): string {
  if (value === 'chat') return '完整对话'
  if (value === 'quality_test') return '快速出口'
  return value || '未知模式'
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`
  return `${Math.floor(seconds / 86400)} 天`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒'
  if (seconds < 10) return `${seconds.toFixed(1)} 秒`
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainder = Math.round(seconds % 60)
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}

function formatOptionalNumber(value: number | null): string {
  return value == null ? '—' : String(value)
}

function formatOptionalBytes(value: number | null): string {
  return value == null ? '—' : formatBytes(value)
}

function formatPercentValue(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

function formatMilliseconds(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)} ms`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
