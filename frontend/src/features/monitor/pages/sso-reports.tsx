import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  Eye,
  FileSearch2,
  Gauge,
  ListChecks,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Timer,
  Trash2,
  UsersRound,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  type SsoCheckResult,
  type SsoReportDetail,
  type SsoReportItem,
  type SsoReportStatus,
} from '@/lib/api'
import { formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ProgressBar } from '@/components/ui/progress'
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
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'
import { SelectionToolbar } from '@/components/selection-toolbar'
import { ServerPagination } from '@/components/server-pagination'
import { SsoDirectConnectRiskNotice } from '@/features/monitor/components/sso-direct-connect-risk'

const REPORT_PAGE_SIZES = [20, 50, 100]
const ACTIVE_REPORT_STATUSES = new Set<SsoReportStatus>(['queued', 'running'])

export function SsoReportsPage() {
  const client = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: 60_000,
  })
  const reports = useQuery({
    queryKey: ['sso-reports'],
    queryFn: api.ssoReports,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((report) => isActiveReport(report))
        ? 2_000
        : false,
    refetchIntervalInBackground: false,
  })
  const detail = useQuery({
    queryKey: ['sso-report', viewingId],
    queryFn: () => api.ssoReport(viewingId ?? ''),
    enabled: Boolean(viewingId),
    refetchInterval: (query) =>
      query.state.data && isActiveReport(query.state.data) ? 1_500 : false,
    refetchIntervalInBackground: false,
  })
  const createMutation = useMutation({
    mutationFn: (body: {
      name: string
      ssoContent: string
      proxy: string
      concurrency: number
      requestTimeoutSeconds: number
    }) => {
      const request = api.createSsoReport({ ...body })
      body.ssoContent = ''
      body.proxy = ''
      return request
    },
    onSuccess: (report) => {
      toast.success('检测任务已创建，共 ' + report.total + ' 个 SSO')
      setCreateOpen(false)
      setViewingId(report.id)
      void client.invalidateQueries({ queryKey: ['sso-reports'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const deleteMutation = useMutation({
    mutationFn: api.deleteSsoReports,
    onSuccess: (result) => {
      const skippedText = result.skipped
        ? '，' + result.skipped + ' 份执行中报告已保留'
        : ''
      toast.success('已删除 ' + result.deleted + ' 份报告' + skippedText)
      setSelectedIds(result.skipped_ids ?? [])
      setDeleteOpen(false)
      void client.invalidateQueries({ queryKey: ['sso-reports'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const items = reports.data ?? []
  const selectableItems = items.filter((item) => !isActiveReport(item))
  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selectedIds.includes(item.id))
  const busy = createMutation.isPending || deleteMutation.isPending

  if (reports.isLoading) {
    return (
      <Page>
        <LoadingState label='正在加载 SSO 报告' />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title='SSO 检测'
        description='SSO 任务在本页独立配置和跟踪，用来确认保存的 SSO 是否仍可登录。上游已不再下发 bot 标记，这里不能判断风控；请求审计自动停用也不再依赖这次检测。'
        descriptionAsHint
        actions={
          <>
            <ActionToolbar label='SSO 报告操作'>
              <ToolbarAction
                label='刷新报告'
                pending={reports.isFetching}
                onClick={() => void reports.refetch()}
              >
                <RefreshCw />
              </ToolbarAction>
              <ToolbarAction
                label={allSelected ? '取消全选报告' : '全选可删除报告'}
                active={allSelected}
                disabled={selectableItems.length === 0 || busy}
                onClick={() =>
                  setSelectedIds(
                    allSelected ? [] : selectableItems.map((item) => item.id)
                  )
                }
              >
                <ListChecks />
              </ToolbarAction>
              <ToolbarAction
                label='新建 SSO 检测'
                disabled={busy}
                onClick={() => setCreateOpen(true)}
              >
                <Plus />
              </ToolbarAction>
            </ActionToolbar>
            <SelectionToolbar
              selectedCount={selectedIds.length}
              entityLabel='报告'
              disabled={busy}
              onClear={() => setSelectedIds([])}
            >
              <ToolbarAction
                label={'删除 ' + selectedIds.length + ' 份报告'}
                destructive
                pending={deleteMutation.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
              </ToolbarAction>
            </SelectionToolbar>
          </>
        }
      />

      {items.length ? (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {items.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              selected={selectedIds.includes(report.id)}
              disabled={busy || isActiveReport(report)}
              onSelectedChange={(checked) =>
                setSelectedIds((current) =>
                  checked
                    ? [...new Set([...current, report.id])]
                    : current.filter((id) => id !== report.id)
                )
              }
              onView={() => setViewingId(report.id)}
              onDelete={() => {
                setSelectedIds([report.id])
                setDeleteOpen(true)
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileSearch2}
          title='暂无 SSO 检测报告'
          description='新建一次检测，每行输入一个 SSO；任务会在后台执行，并生成一份可查看、筛选和删除的报告。'
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> 新建检测
            </Button>
          }
        />
      )}

      {createOpen && (
        <CreateReportDialog
          open
          pending={createMutation.isPending}
          ssoProxyConfigured={Boolean(settings.data?.ssoProxyConfigured)}
          onOpenChange={(open) =>
            !createMutation.isPending && setCreateOpen(open)
          }
          onSubmit={(body) => createMutation.mutate(body)}
        />
      )}
      <ReportDetailDialog
        key={viewingId ?? 'closed'}
        open={Boolean(viewingId)}
        report={detail.data}
        loading={detail.isLoading}
        error={detail.error}
        onOpenChange={(open) => !open && setViewingId(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) =>
          !deleteMutation.isPending && setDeleteOpen(open)
        }
        title={'删除 ' + selectedIds.length + ' 份 SSO 报告？'}
        desc='报告汇总和明细会一并删除。排队中或检测中的报告会自动跳过。'
        confirmText={
          <>
            <Trash2 /> 删除报告
          </>
        }
        cancelBtnText='取消'
        destructive
        isLoading={deleteMutation.isPending}
        disabled={selectedIds.length === 0}
        handleConfirm={() => deleteMutation.mutate(selectedIds)}
      />
    </Page>
  )
}

function ReportCard({
  report,
  selected,
  disabled,
  onSelectedChange,
  onView,
  onDelete,
}: {
  report: SsoReportItem
  selected: boolean
  disabled: boolean
  onSelectedChange: (checked: boolean) => void
  onView: () => void
  onDelete: () => void
}) {
  const active = isActiveReport(report)
  const failed = report.status === 'failed'
  return (
    <Card className='gap-0 overflow-hidden py-0'>
      <CardContent className='p-0'>
        <div className='flex items-start gap-3 border-b bg-muted/15 p-4'>
          <Checkbox
            checked={selected}
            disabled={disabled}
            onCheckedChange={(value) => onSelectedChange(value === true)}
            aria-label={'选择报告 ' + report.name}
          />
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <div className='truncate font-medium'>{report.name}</div>
              {report.proxy_used && (
                <Network className='size-3.5 shrink-0 text-muted-foreground' />
              )}
            </div>
            <div className='mt-1 text-xs text-muted-foreground'>
              {formatDate(report.created_at)}
              {report.elapsed_seconds > 0
                ? ' · ' + formatNumber(report.elapsed_seconds) + ' 秒'
                : ''}
            </div>
            <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground'>
              <span className='inline-flex items-center gap-1'>
                <Cpu className='size-3' /> 并发 {report.concurrency}
              </span>
              <span className='inline-flex items-center gap-1'>
                <Timer className='size-3' /> 超时{' '}
                {report.request_timeout_seconds} 秒
              </span>
            </div>
          </div>
          <ReportStatusBadge report={report} />
        </div>
        {active && (
          <div className='border-b px-4 py-3'>
            <div className='mb-2 flex items-center justify-between gap-3 text-xs'>
              <span className='text-muted-foreground'>
                {report.status === 'queued'
                  ? report.queue_position && report.queue_position > 1
                    ? '队列第 ' + report.queue_position + ' 位'
                    : '等待执行'
                  : '检测进度'}
              </span>
              <span className='font-medium tabular-nums'>
                {report.completed_count} / {report.total}
              </span>
            </div>
            <ProgressBar className='h-2' value={report.progress_percent} active />
          </div>
        )}
        {failed && report.error && (
          <div className='border-b bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive'>
            {report.error}
          </div>
        )}
        <div className='grid grid-cols-4 divide-x border-b'>
          <Metric label='总数' value={report.total} />
          <Metric label='正常' value={report.clean} tone='text-emerald-600' />
          <Metric label='风控' value={report.flagged} tone='text-amber-600' />
          <Metric
            label='异常'
            value={report.mismatched + report.invalid + report.errors}
            tone='text-destructive'
          />
        </div>
        <div className='flex justify-end gap-2 p-3'>
          <Button size='sm' variant='outline' onClick={onView}>
            <Eye /> {active ? '查看进度' : '查看报告'}
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground hover:text-destructive'
            disabled={active}
            onClick={onDelete}
            aria-label={'删除报告 ' + report.name}
          >
            <Trash2 />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ReportStatusBadge({ report }: { report: SsoReportItem }) {
  if (report.status === 'queued') {
    return (
      <Badge variant='secondary'>
        <Clock3 /> 排队中
      </Badge>
    )
  }
  if (report.status === 'running') {
    return (
      <Badge variant='info'>
        <Loader2 className='animate-spin' /> {report.progress_percent}%
      </Badge>
    )
  }
  if (report.status === 'failed') {
    return (
      <Badge variant='destructive'>
        <XCircle /> 执行失败
      </Badge>
    )
  }
  if (report.flagged) {
    return <Badge variant='warning'>{report.flagged} 个标记</Badge>
  }
  const abnormal = report.mismatched + report.invalid + report.errors
  if (abnormal) return <Badge variant='destructive'>{abnormal} 个异常</Badge>
  return <Badge variant='success'>全部正常</Badge>
}

function Metric({
  label,
  value,
  tone = '',
}: {
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className='px-3 py-3 text-center'>
      <div className={'text-lg font-semibold tabular-nums ' + tone}>
        {value}
      </div>
      <div className='mt-0.5 text-[11px] text-muted-foreground'>{label}</div>
    </div>
  )
}

function CreateReportDialog({
  open,
  pending,
  ssoProxyConfigured,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  pending: boolean
  ssoProxyConfigured: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: {
    name: string
    ssoContent: string
    proxy: string
    concurrency: number
    requestTimeoutSeconds: number
  }) => void
}) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [proxy, setProxy] = useState('')
  const [riskOpen, setRiskOpen] = useState(false)
  const [concurrencyInput, setConcurrencyInput] = useState('8')
  const [timeoutInput, setTimeoutInput] = useState('20')
  const concurrency = Number(concurrencyInput)
  const requestTimeoutSeconds = Number(timeoutInput)
  const lineCount = useMemo(
    () => content.split(/\r?\n/).filter((line) => line.trim()).length,
    [content]
  )
  const directConnect = !ssoProxyConfigured && !proxy.trim()
  const submitBody = () => {
    if (lineCount <= 0) return
    const body = {
      name,
      ssoContent: content,
      proxy,
      concurrency,
      requestTimeoutSeconds,
    }
    if (directConnect) {
      setRiskOpen(true)
      return
    }
    onSubmit(body)
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRiskOpen(false)
          onOpenChange(nextOpen)
        }}
      >
        <DialogContent
          size='wide'
          onInteractOutside={(event) => pending && event.preventDefault()}
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>新建 SSO 检测</DialogTitle>
            <DialogDescription>
              在本页配置并跟踪独立 SSO
              任务；提交后立即进入后台队列，不会进入探针任务中心。
            </DialogDescription>
          </DialogHeader>
          <form
            id='create-sso-report-form'
            className='grid min-h-0 gap-4'
            onSubmit={(event) => {
              event.preventDefault()
              submitBody()
            }}
          >
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='sso-report-name'>报告名称</Label>
                <Input
                  id='sso-report-name'
                  value={name}
                  maxLength={160}
                  placeholder='例如：8 月新账号 SSO 检测'
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='sso-report-proxy'>代理（选填）</Label>
                <Input
                  id='sso-report-proxy'
                  value={proxy}
                  maxLength={8000}
                  placeholder='host:port 或 username:password@host:port'
                  autoComplete='off'
                  spellCheck={false}
                  disabled={pending}
                  onChange={(event) => setProxy(event.target.value)}
                />
                <p className='text-xs text-muted-foreground'>
                  也兼容 host:port:username:password 和带 http://
                  的地址。留空则使用系统全局代理
                  {ssoProxyConfigured ? '（已配置）' : '（当前未配置）'}
                  ；代理凭据不会写入报告。
                </p>
              </div>
            </div>
            {directConnect ? <SsoDirectConnectRiskNotice /> : null}
            <div className='grid gap-4 rounded-xl border bg-muted/15 p-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='sso-report-concurrency'>任务并发数</Label>
                <Input
                  id='sso-report-concurrency'
                  type='number'
                  value={concurrencyInput}
                  min={1}
                  max={32}
                  step={1}
                  disabled={pending}
                  onChange={(event) => setConcurrencyInput(event.target.value)}
                />
                <p className='text-xs leading-5 text-muted-foreground'>
                  同一批次同时检测的 SSO 数量，范围 1–32，推荐
                  8。数值越高完成越快，但代理和上游压力也越高。
                </p>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='sso-report-timeout'>单请求超时（秒）</Label>
                <Input
                  id='sso-report-timeout'
                  type='number'
                  value={timeoutInput}
                  min={5}
                  max={120}
                  step={1}
                  disabled={pending}
                  onChange={(event) => setTimeoutInput(event.target.value)}
                />
                <p className='text-xs leading-5 text-muted-foreground'>
                  每个 SSO 请求最长等待时间，范围 5–120 秒，推荐
                  20。代理较慢时可适当提高。
                </p>
              </div>
            </div>
            <div className='min-h-0 space-y-2'>
              <div className='flex items-center justify-between gap-3'>
                <Label htmlFor='sso-report-content'>SSO 列表</Label>
                <Badge variant='secondary'>{lineCount} 行</Badge>
              </div>
              <Textarea
                id='sso-report-content'
                className='min-h-[20rem] resize-y font-mono text-xs leading-5'
                value={content}
                placeholder={'SSO_TOKEN_1\naccount@example.com----SSO_TOKEN_2'}
                spellCheck={false}
                disabled={pending}
                onChange={(event) => setContent(event.target.value)}
              />
              <p className='text-xs text-muted-foreground'>
                每行一个账号；支持原始 SSO、sso=TOKEN、email----sso 和
                email----password----sso。SSO 仅保存在任务内存中。
              </p>
            </div>
          </form>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type='submit'
              form='create-sso-report-form'
              disabled={
                pending ||
                lineCount === 0 ||
                lineCount > 1000 ||
                !Number.isInteger(concurrency) ||
                concurrency < 1 ||
                concurrency > 32 ||
                !Number.isInteger(requestTimeoutSeconds) ||
                requestTimeoutSeconds < 5 ||
                requestTimeoutSeconds > 120
              }
            >
              {pending ? <Loader2 className='animate-spin' /> : <FileSearch2 />}
              {pending ? '正在创建任务' : '提交 ' + lineCount + ' 个 SSO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={riskOpen}
        onOpenChange={(nextOpen) => {
          if (!pending) setRiskOpen(nextOpen)
        }}
        title='未配置 SSO 检测代理，仍要直连检测？'
        desc={<SsoDirectConnectRiskNotice />}
        cancelBtnText='返回填写'
        confirmText={pending ? '正在创建任务' : '仍要直连检测'}
        destructive
        isLoading={pending}
        handleConfirm={() => {
          setRiskOpen(false)
          onSubmit({
            name,
            ssoContent: content,
            proxy,
            concurrency,
            requestTimeoutSeconds,
          })
        }}
      />
    </>
  )
}

function ReportDetailDialog({
  open,
  report,
  loading,
  error,
  onOpenChange,
}: {
  open: boolean
  report?: SsoReportDetail
  loading: boolean
  error: unknown
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<
    'all' | 'clean' | 'flagged' | 'mismatch' | 'invalid'
  >('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (report?.results ?? []).filter((item) => {
      const verdictMatch =
        filter === 'all' ||
        (filter === 'clean' && item.verdict === 'clean') ||
        (filter === 'flagged' && item.verdict.startsWith('flagged')) ||
        (filter === 'mismatch' && item.email_match === false) ||
        (filter === 'invalid' &&
          ['invalid_or_unknown', 'error'].includes(item.verdict))
      if (!verdictMatch) return false
      if (!query) return true
      return [
        item.label,
        item.expected_email,
        item.account.email,
        item.account.display_name,
        item.account.user_id,
        item.account.region,
        item.account.region_code,
        item.bot_flag.details,
        item.error,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [filter, report?.results, search])
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize)
  const active = report ? isActiveReport(report) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size='wide'
        className='max-h-[calc(100dvh-1rem)] overflow-hidden p-0 sm:p-0'
      >
        {loading ? (
          <LoadingState label='正在读取 SSO 报告' />
        ) : error || !report ? (
          <div className='p-8 text-center text-sm text-destructive'>
            {getErrorMessage(error)}
          </div>
        ) : (
          <>
            <DialogHeader className='border-b bg-muted/15 px-5 py-4 pe-14 sm:px-6 sm:py-5 sm:pe-14'>
              <div className='flex flex-wrap items-center gap-2'>
                <DialogTitle>{report.name}</DialogTitle>
                <ReportStatusBadge report={report} />
                {report.proxy_used && (
                  <Badge variant='outline'>
                    <Network /> 使用代理
                  </Badge>
                )}
              </div>
              <DialogDescription>
                {formatDate(report.created_at)} · {report.total} 个 SSO
                {report.elapsed_seconds > 0
                  ? ' · 已用时 ' + formatNumber(report.elapsed_seconds) + ' 秒'
                  : ''}
              </DialogDescription>
              <div className='flex flex-wrap gap-2 pt-1'>
                <Badge variant='secondary'>
                  <Cpu /> 并发 {report.concurrency}
                </Badge>
                <Badge variant='secondary'>
                  <Timer /> 单请求超时 {report.request_timeout_seconds} 秒
                </Badge>
                <Badge variant={report.proxy_used ? 'outline' : 'secondary'}>
                  <Network /> {report.proxy_used ? '代理出口' : '本机直连'}
                </Badge>
              </div>
            </DialogHeader>
            <div className='min-h-0 flex-1 overflow-y-auto p-4 sm:p-6'>
              {active && (
                <Card className='mb-4'>
                  <CardContent className='p-5'>
                    <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
                      <div>
                        <div className='font-medium'>
                          {report.status === 'queued'
                            ? report.queue_position && report.queue_position > 1
                              ? '任务正在排队，当前第 ' +
                                report.queue_position +
                                ' 位'
                              : '任务正在等待执行'
                            : '任务正在后台检测'}
                        </div>
                        <div className='mt-1 text-sm text-muted-foreground'>
                          可以关闭此窗口，报告列表会自动刷新进度。
                        </div>
                      </div>
                      <div className='text-sm font-medium tabular-nums'>
                        {report.completed_count} / {report.total}（
                        {report.progress_percent}%）
                      </div>
                    </div>
                    <ProgressBar className='h-2' value={report.progress_percent} active />
                  </CardContent>
                </Card>
              )}
              {report.status === 'failed' && (
                <div className='mb-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive'>
                  <div className='flex items-center gap-2 font-medium'>
                    <XCircle className='size-4' /> 检测任务执行失败
                  </div>
                  <div className='mt-2 leading-6'>
                    {report.error || '未知错误'}
                  </div>
                </div>
              )}

              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
                <SummaryCard
                  icon={UsersRound}
                  label='全部 SSO'
                  value={report.total}
                />
                <SummaryCard
                  icon={CheckCircle2}
                  label='正常'
                  value={report.clean}
                  tone='text-emerald-600 bg-emerald-500/10'
                />
                <SummaryCard
                  icon={ShieldAlert}
                  label='风控标记'
                  value={report.flagged}
                  tone='text-amber-600 bg-amber-500/10'
                />
                <SummaryCard
                  icon={AlertTriangle}
                  label='邮箱不一致'
                  value={report.mismatched}
                  tone='text-violet-600 bg-violet-500/10'
                />
                <SummaryCard
                  icon={AlertTriangle}
                  label='无效 / 异常'
                  value={report.invalid + report.errors}
                  tone='text-destructive bg-destructive/10'
                />
                <SummaryCard
                  icon={Gauge}
                  label='响应中位数'
                  value={(report.summary.median_response_ms ?? 0) + ' ms'}
                />
              </div>

              {!active && report.status !== 'failed' && (
                <div className='mt-4 rounded-xl border'>
                  <div className='flex flex-col gap-3 border-b bg-muted/15 p-3 lg:flex-row lg:items-center lg:justify-between'>
                    <div className='relative min-w-0 flex-1 lg:max-w-md'>
                      <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                      <Input
                        className='pl-9'
                        value={search}
                        placeholder='搜索邮箱、姓名、User ID、地区或详情'
                        onChange={(event) => {
                          setSearch(event.target.value)
                          setPage(1)
                        }}
                      />
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      {(
                        [
                          ['all', '全部'],
                          ['clean', '正常'],
                          ['flagged', '风控'],
                          ['mismatch', '邮箱不一致'],
                          ['invalid', '异常'],
                        ] as const
                      ).map(([value, label]) => (
                        <Button
                          key={value}
                          size='sm'
                          variant={filter === value ? 'secondary' : 'outline'}
                          onClick={() => {
                            setFilter(value)
                            setPage(1)
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Table rememberRowKey={'sso-report-' + report.id}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>账号</TableHead>
                        <TableHead>判定</TableHead>
                        <TableHead>账号处置</TableHead>
                        <TableHead>Bot</TableHead>
                        <TableHead>地区</TableHead>
                        <TableHead>响应</TableHead>
                        <TableHead className='min-w-72'>详情</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageItems.map((item, index) => (
                        <ResultRow
                          key={item.label + '-' + index}
                          item={item}
                          index={(page - 1) * pageSize + index + 1}
                        />
                      ))}
                    </TableBody>
                  </Table>
                  {!pageItems.length && (
                    <div className='p-10 text-center text-sm text-muted-foreground'>
                      没有符合当前条件的记录
                    </div>
                  )}
                  <div className='px-4 pb-4'>
                    <ServerPagination
                      page={page}
                      pageSize={pageSize}
                      total={filtered.length}
                      itemLabel='结果'
                      disabled={false}
                      loading={false}
                      pageSizeOptions={REPORT_PAGE_SIZES}
                      onPageChange={setPage}
                      onPageSizeChange={(value) => {
                        setPageSize(value)
                        setPage(1)
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = 'text-primary bg-primary/10',
}: {
  icon: typeof Clock3
  label: string
  value: number | string
  tone?: string
}) {
  return (
    <Card>
      <CardContent className='flex items-center gap-3 p-4'>
        <div
          className={
            'flex size-9 items-center justify-center rounded-lg ' + tone
          }
        >
          <Icon className='size-4' />
        </div>
        <div>
          <div className='text-xs text-muted-foreground'>{label}</div>
          <div className='mt-1 text-lg font-semibold tabular-nums'>{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ResultRow({ item, index }: { item: SsoCheckResult; index: number }) {
  const flagged = item.verdict.startsWith('flagged')
  const clean = item.verdict === 'clean'
  return (
    <TableRow rowId={index + '-' + (item.account.email ?? item.label)}>
      <TableCell className='text-muted-foreground tabular-nums'>
        {index}
      </TableCell>
      <TableCell>
        <div className='max-w-72 truncate font-medium'>
          {item.account.email || item.expected_email || item.label}
        </div>
        <div className='mt-0.5 max-w-72 truncate text-xs text-muted-foreground'>
          {[item.account.display_name, item.account.user_id]
            .filter(Boolean)
            .join(' · ') || '—'}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant={clean ? 'success' : flagged ? 'warning' : 'destructive'}
        >
          {clean ? '正常' : flagged ? '风控标记' : verdictLabel(item.verdict)}
        </Badge>
      </TableCell>
      <TableCell>
        {item.account_id ? (
          <Badge
            variant={
              ['disabled', 'already_disabled', 'already_quarantined'].includes(
                item.account_action?.status ?? ''
              )
                ? 'destructive'
                : item.account_action?.status === 'task_protected'
                  ? 'warning'
                  : 'outline'
            }
            title={item.account_action?.error || ''}
          >
            {ssoAccountActionLabel(item.account_action?.status)}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>未关联账号</span>
        )}
      </TableCell>
      <TableCell className='font-mono'>
        {item.bot_flag.source == null ? '—' : item.bot_flag.source}
      </TableCell>
      <TableCell>
        {[item.account.country_code, item.account.region_code]
          .filter(Boolean)
          .join(' / ') || '—'}
      </TableCell>
      <TableCell className='tabular-nums'>{item.response_ms} ms</TableCell>
      <TableCell className='max-w-md text-xs leading-5 whitespace-normal text-muted-foreground'>
        {item.bot_flag.details ||
          item.error ||
          (item.email_match === false ? '输入邮箱与服务端邮箱不一致' : '—')}
      </TableCell>
    </TableRow>
  )
}

function isActiveReport(report: SsoReportItem) {
  return ACTIVE_REPORT_STATUSES.has(report.status)
}

function verdictLabel(value: string) {
  if (value === 'email_mismatch') return '邮箱不一致'
  if (value === 'invalid_or_unknown') return '无效 / 未知'
  if (value === 'error') return '请求异常'
  return value
}

function ssoAccountActionLabel(value?: string) {
  if (value === 'disabled') return '已立即停用'
  if (value === 'already_disabled') return '已处于停用'
  if (value === 'already_quarantined') return '已隔离'
  if (value === 'task_protected') return '任务结束后重试'
  if (value === 'action_failed') return '停用失败'
  if (value) return value
  return '无需处置'
}
