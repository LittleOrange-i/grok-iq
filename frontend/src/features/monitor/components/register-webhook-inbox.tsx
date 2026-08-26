import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  CircleCheck,
  CircleX,
  Clock3,
  Eye,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  api,
  type RegisterPriorityHoldStatus,
  type RegisterWebhookEvent,
  type RegisterWebhookEventStatus,
} from '@/lib/api'
import { cn, formatDate, getErrorMessage } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useServerTableLoading } from '@/hooks/use-server-table-loading'
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
import { EmptyState, LoadingState } from '@/components/page'
import {
  ServerPagination,
  ServerTableLoadingOverlay,
} from '@/components/server-pagination'

const eventStatusMeta: Record<
  RegisterWebhookEventStatus,
  {
    label: string
    variant: 'warning' | 'info' | 'success' | 'destructive'
  }
> = {
  pending: { label: '等待处理', variant: 'warning' },
  processing: { label: '处理中', variant: 'info' },
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '已失败', variant: 'destructive' },
}

const priorityHoldMeta: Record<
  RegisterPriorityHoldStatus,
  {
    label: string
    variant: 'secondary' | 'warning' | 'info' | 'success' | 'destructive'
  }
> = {
  none: { label: '未降权', variant: 'secondary' },
  held: { label: '已降权', variant: 'warning' },
  restored: { label: '已恢复优先级', variant: 'success' },
  restore_failed: { label: '恢复失败，将重试', variant: 'destructive' },
  kept: { label: '保持低优先级', variant: 'info' },
}

export function RegisterWebhookInbox() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedEvent, setSelectedEvent] =
    useState<RegisterWebhookEvent | null>(null)
  const [deferredSearch, searchPending] = useDebouncedValue(search.trim())
  const query = useQuery({
    queryKey: [
      'register-webhook-events',
      page,
      pageSize,
      status,
      deferredSearch,
    ],
    queryFn: ({ signal }) =>
      api.registerWebhookEvents(
        {
          page,
          pageSize,
          status: status === 'all' ? '' : status,
          search: deferredSearch,
        },
        signal
      ),
    placeholderData: (previous) => previous,
    refetchInterval: (current) =>
      current.state.data?.statusCounts.pending ||
      current.state.data?.statusCounts.processing
        ? 2_000
        : false,
  })
  const { beginTableInteraction, tableLoading } = useServerTableLoading({
    isFetching: query.isFetching,
    inputPending: searchPending,
  })
  const events = query.data?.items ?? []
  const counts = query.data?.statusCounts ?? {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <div>
              <CardTitle className='flex items-center gap-2'>
                <Inbox className='size-4 text-primary' />
                Webhook 持久收件箱
              </CardTitle>
              <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                Webhook 返回 202
                后先保存在这里；完成账号匹配与稳定等待后，生成的探针任务会进入任务中心。
              </p>
            </div>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? (
                <Loader2 className='animate-spin' />
              ) : (
                <RefreshCw />
              )}
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          {query.error && !query.data ? (
            <div className='rounded-lg border border-destructive/30 p-4 text-sm text-destructive'>
              收件箱读取失败：{getErrorMessage(query.error)}
            </div>
          ) : query.isLoading && !query.data ? (
            <LoadingState label='正在读取 Webhook 收件箱' />
          ) : (
            <>
              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
                <InboxMetric
                  icon={Clock3}
                  label='等待处理'
                  value={counts.pending}
                  detail={`${query.data?.dueCount ?? 0} 个已到处理时间`}
                  tone='warning'
                />
                <InboxMetric
                  icon={RefreshCw}
                  label='处理中'
                  value={counts.processing}
                  detail='后台 Worker 正在处理'
                  tone='info'
                />
                <InboxMetric
                  icon={CircleCheck}
                  label='已完成'
                  value={counts.completed}
                  detail='账号已匹配并完成联动'
                  tone='success'
                />
                <InboxMetric
                  icon={CircleX}
                  label='已失败'
                  value={counts.failed}
                  detail='达到最大重试次数'
                  tone='destructive'
                />
                <InboxMetric
                  icon={RefreshCw}
                  label='重试中'
                  value={query.data?.retryingCount ?? 0}
                  detail='至少已处理过一次'
                  tone='warning'
                />
              </div>

              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div className='relative w-full sm:max-w-md'>
                  <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                  <Input
                    value={search}
                    onChange={(event) => {
                      beginTableInteraction()
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                    placeholder='搜索邮箱、事件 ID、注册 ID 或账号 ID'
                    className='pr-9 pl-9'
                  />
                  {tableLoading && (
                    <Loader2 className='absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary' />
                  )}
                </div>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    beginTableInteraction()
                    setStatus(value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className='w-full sm:w-44'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>全部状态</SelectItem>
                    <SelectItem value='pending'>等待处理</SelectItem>
                    <SelectItem value='processing'>处理中</SelectItem>
                    <SelectItem value='completed'>已完成</SelectItem>
                    <SelectItem value='failed'>已失败</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='relative min-h-48' aria-busy={tableLoading}>
                {events.length ? (
                  <Table rememberRowKey='register-webhook-inbox'>
                    <TableHeader>
                      <TableRow>
                        <TableHead>接收时间</TableHead>
                        <TableHead>账号</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>处理次数</TableHead>
                        <TableHead>关联结果</TableHead>
                        <TableHead>最近结果</TableHead>
                        <TableHead className='text-right'>详情</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((event) => (
                        <RegisterEventRow
                          key={event.event_id}
                          event={event}
                          onDetail={() => setSelectedEvent(event)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title={
                      deferredSearch || status !== 'all'
                        ? '未找到匹配事件'
                        : '尚未收到 Webhook'
                    }
                    description={
                      deferredSearch || status !== 'all'
                        ? '请调整搜索词或状态筛选条件。'
                        : 'grok-register 成功调用 Webhook 后，事件会立即显示在这里。'
                    }
                    icon={Inbox}
                  />
                )}
                {tableLoading && (
                  <ServerTableLoadingOverlay
                    page={page}
                    itemLabel='Webhook 事件'
                    message='正在更新收件箱筛选结果…'
                  />
                )}
              </div>

              {query.data && (
                <ServerPagination
                  page={page}
                  pageSize={pageSize}
                  total={query.data.total}
                  disabled={tableLoading}
                  loading={tableLoading}
                  itemLabel='事件'
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
              )}
            </>
          )}
        </CardContent>
      </Card>

      <RegisterEventDetailDialog
        event={selectedEvent}
        open={selectedEvent != null}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null)
        }}
      />
    </>
  )
}

function priorityHoldLabel(event: RegisterWebhookEvent): string {
  const status = event.priority_hold_status ?? 'none'
  const meta = priorityHoldMeta[status] ?? priorityHoldMeta.none
  const original =
    event.original_priority == null ? '—' : String(event.original_priority)
  const held =
    event.held_priority == null ? '—' : String(event.held_priority)
  if (status === 'none') return '未调整'
  if (status === 'held') return `${meta.label}：${original} → ${held}`
  if (status === 'restored') return `${meta.label}：已回到 ${original}`
  if (status === 'restore_failed') {
    return `${meta.label}：目标 ${original}`
  }
  return `${meta.label}：保持 ${held}`
}

function InboxMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Inbox
  label: string
  value: number
  detail: string
  tone: 'warning' | 'info' | 'success' | 'destructive'
}) {
  return (
    <div className='rounded-lg border bg-background p-3'>
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <Icon
          className={cn(
            'size-3.5',
            tone === 'warning' && 'text-amber-600 dark:text-amber-400',
            tone === 'info' && 'text-sky-600 dark:text-sky-400',
            tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
            tone === 'destructive' && 'text-destructive'
          )}
        />
        {label}
      </div>
      <div className='mt-1 text-xl font-semibold tabular-nums'>{value}</div>
      <div className='mt-1 truncate text-[11px] text-muted-foreground'>
        {detail}
      </div>
    </div>
  )
}

function RegisterEventRow({
  event,
  onDetail,
}: {
  event: RegisterWebhookEvent
  onDetail: () => void
}) {
  const status = eventStatusMeta[event.status] ?? eventStatusMeta.failed
  const linkedAccountId =
    event.resolved_account_id ?? event.grok2api_account_id ?? null
  const recentResult = event.last_error
    ? event.last_error
    : event.status === 'completed'
      ? event.run_ids.length
        ? `已创建 ${event.run_ids.length} 个探针任务`
        : '联动完成，未创建探针任务'
      : event.status === 'processing'
        ? '后台正在匹配账号并创建任务'
        : '等待后台处理'

  return (
    <TableRow rowId={event.event_id}>
      <TableCell>
        <div className='tabular-nums'>{formatDate(event.created_at)}</div>
        <div
          className='max-w-48 truncate font-mono text-[11px] text-muted-foreground'
          title={event.event_id}
        >
          {event.event_id}
        </div>
      </TableCell>
      <TableCell>
        <div className='max-w-64 truncate font-medium' title={event.email}>
          {event.email}
        </div>
        <div className='text-xs text-muted-foreground'>
          {linkedAccountId ? `账号 ID ${linkedAccountId}` : '等待账号匹配'}
        </div>
      </TableCell>
      <TableCell>
        <div className='flex flex-col items-start gap-1'>
          <Badge variant={status.variant}>{status.label}</Badge>
          {event.priority_hold_status &&
          event.priority_hold_status !== 'none' ? (
            <Badge
              variant={
                priorityHoldMeta[event.priority_hold_status]?.variant ??
                'secondary'
              }
            >
              {priorityHoldMeta[event.priority_hold_status]?.label ??
                event.priority_hold_status}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span className='tabular-nums'>{event.attempts}</span>
        {event.status === 'pending' && event.attempts > 0 && (
          <div className='text-xs text-muted-foreground'>
            下次 {formatDate(event.next_attempt_at)}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div>{event.run_ids.length} 个任务</div>
        {event.bot_risk && (
          <div className='mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400'>
            <Bot className='size-3' />
            注册风控{event.bfs ? ` · bfs ${event.bfs}` : ''}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div
          className={cn(
            'max-w-80 truncate text-xs',
            event.last_error ? 'text-destructive' : 'text-muted-foreground'
          )}
          title={recentResult}
        >
          {recentResult}
        </div>
      </TableCell>
      <TableCell className='text-right'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              onClick={onDetail}
              aria-label={`查看 Webhook 事件 ${event.event_id}`}
            >
              <Eye />
            </Button>
          </TooltipTrigger>
          <TooltipContent>查看事件详情</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  )
}

function RegisterEventDetailDialog({
  event,
  open,
  onOpenChange,
}: {
  event: RegisterWebhookEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!event) return null
  const status = eventStatusMeta[event.status] ?? eventStatusMeta.failed
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='wide'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            Webhook 事件详情
            <Badge variant={status.variant}>{status.label}</Badge>
          </DialogTitle>
          <DialogDescription>
            收件箱记录为只读视图，后台仍按既有重试和幂等规则处理。
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          <DetailItem label='邮箱' value={event.email} />
          <DetailItem
            label='关联账号'
            value={
              event.resolved_account_id
                ? `已匹配账号 ${event.resolved_account_id}`
                : event.grok2api_account_id
                  ? `上报账号 ${event.grok2api_account_id}`
                  : '等待按邮箱匹配'
            }
          />
          <DetailItem label='处理次数' value={String(event.attempts)} />
          <DetailItem label='接收时间' value={formatDate(event.created_at)} />
          <DetailItem label='更新时间' value={formatDate(event.updated_at)} />
          <DetailItem
            label={event.status === 'pending' ? '下次处理' : '完成时间'}
            value={formatDate(
              event.status === 'pending'
                ? event.next_attempt_at
                : event.completed_at
            )}
          />
          <DetailItem label='事件类型' value={event.event_type || '—'} />
          <DetailItem
            label='注册记录 ID'
            value={event.registration_id || '—'}
          />
          <DetailItem
            label='注册风控'
            value={
              event.bot_risk
                ? `是${event.bfs ? ` · bfs ${event.bfs}` : ''}`
                : '否'
            }
          />
          <DetailItem
            label='grok2api 优先级'
            value={priorityHoldLabel(event)}
          />
        </div>
        <DetailBlock label='事件 ID' value={event.event_id} mono />
        <DetailBlock
          label={`关联探针任务（${event.run_ids.length}）`}
          value={
            event.run_ids.length ? event.run_ids.join('\n') : '尚未创建探针任务'
          }
          mono={event.run_ids.length > 0}
        />
        {event.last_error && (
          <DetailBlock label='最近处理结果' value={event.last_error} error />
        )}
        {event.priority_hold_error ? (
          <DetailBlock
            label='优先级处理结果'
            value={event.priority_hold_error}
            error={event.priority_hold_status === 'restore_failed'}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0 rounded-lg border bg-muted/15 px-3 py-2'>
      <div className='text-[11px] text-muted-foreground'>{label}</div>
      <div className='mt-1 truncate text-sm font-medium' title={value}>
        {value}
      </div>
    </div>
  )
}

function DetailBlock({
  label,
  value,
  mono = false,
  error = false,
}: {
  label: string
  value: string
  mono?: boolean
  error?: boolean
}) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='text-xs font-medium'>{label}</div>
      <pre
        className={cn(
          'mt-2 max-h-48 overflow-auto text-xs leading-5 break-all whitespace-pre-wrap text-muted-foreground',
          mono && 'font-mono',
          error && 'text-destructive'
        )}
      >
        {value}
      </pre>
    </div>
  )
}
