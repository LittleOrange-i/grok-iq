import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  Loader2,
  ShieldBan,
  UsersRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatAccountSecondaryLabel } from '@/lib/account-label'
import {
  api,
  type ProbeRun,
  type ProbeSample,
  type UpstreamAccount,
} from '@/lib/api'
import { extractHtmlPreviews } from '@/lib/formatted-content'
import { StatusBadge } from '@/lib/status'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { EnabledBadge } from '@/components/enabled-badge'
import { ContentPreviewCanvas } from '@/components/formatted-content'
import { MonitorStatusBadge } from '@/components/monitor-status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DualTpsValue } from '@/features/monitor/components/tps-display'

const PREVIEW_ISOLATE_NOTE = 'HTML 预览人工判定降智'

export type ResultPreviewItem = {
  id: string
  runId: string
  accountId: number
  accountName: string
  accountEmail?: string
  sampleId?: string
  profileName?: string
  expectedOutput?: string
  expectedImageUrl?: string
  content?: string
  sample?: ProbeSample
}

export function previewItemsFromRuns(runs: ProbeRun[]): ResultPreviewItem[] {
  return runs
    .filter((run) => run.completed_steps > 0)
    .map((run) => ({
      id: run.id,
      runId: run.id,
      accountId: run.account_id,
      accountName:
        run.account_name || run.account_email || `账号 ${run.account_id}`,
      accountEmail: run.account_email,
    }))
}

export function previewItemsFromSamples(
  samples: ProbeSample[],
  account: {
    id: number | string
    name?: string
    email?: string
  }
): ResultPreviewItem[] {
  const accountId = Number(account.id)
  const accountName =
    account.name || account.email || `账号 ${account.id}`
  return samples
    .filter((sample) => (sample.response_text || '').trim())
    .map((sample) => ({
      id: sample.id,
      runId: sample.run_id,
      accountId: sample.account_id || accountId,
      accountName,
      accountEmail: account.email,
      sampleId: sample.id,
      content: sample.response_text,
      sample,
    }))
}

export function pickPreviewSample(
  samples: ProbeSample[],
  preferredId?: string
): ProbeSample | null {
  if (preferredId) {
    const matched = samples.find((sample) => sample.id === preferredId)
    if (matched) return matched
  }
  const withText = samples.filter((sample) =>
    (sample.response_text || '').trim()
  )
  const newestFirst = [...withText].sort((left, right) => {
    const delta = Date.parse(right.created_at) - Date.parse(left.created_at)
    if (Number.isFinite(delta) && delta !== 0) return delta
    return right.id.localeCompare(left.id)
  })
  const withHtml = newestFirst.find(
    (sample) => extractHtmlPreviews(sample.response_text).length > 0
  )
  return withHtml || newestFirst[0] || samples[0] || null
}

export function ResultPreviewGallery({
  open,
  onOpenChange,
  items,
  index,
  onIndexChange,
  onOpenAccount,
  onOpenRun,
  onOpenQuarantine,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ResultPreviewItem[]
  index: number
  onIndexChange: (index: number) => void
  onOpenAccount?: (accountId: number) => void
  onOpenRun?: (runId: string) => void
  onOpenQuarantine?: () => void
}) {
  const client = useQueryClient()
  const [isolateOpen, setIsolateOpen] = useState(false)
  const [compareExpected, setCompareExpected] = useState(false)
  const safeIndex = items.length
    ? Math.min(Math.max(index, 0), items.length - 1)
    : 0
  const item = items[safeIndex]
  const neighborRunIds = useMemo(() => {
    if (!item) return []
    const ids = [item.runId]
    const previous = items[safeIndex - 1]
    const next = items[safeIndex + 1]
    if (previous?.runId) ids.push(previous.runId)
    if (next?.runId) ids.push(next.runId)
    return Array.from(new Set(ids.filter(Boolean)))
  }, [item, items, safeIndex])

  useQueries({
    queries: neighborRunIds.map((runId) => ({
      queryKey: ['run', runId],
      queryFn: () => api.run(runId),
      enabled:
        open &&
        Boolean(runId) &&
        !items.some(
          (entry) =>
            entry.runId === runId && Boolean(entry.content || entry.sample)
        ),
      staleTime: 30_000,
    })),
  })

  const needsRunFetch = Boolean(item && !item.content && !item.sample && item.runId)
  const runQuery = useQuery({
    queryKey: ['run', item?.runId],
    queryFn: () => api.run(item!.runId),
    enabled: open && Boolean(item?.runId),
    staleTime: 30_000,
  })
  const accountQuery = useQuery({
    queryKey: ['account', item?.accountId],
    queryFn: () => api.account(item!.accountId, 1),
    enabled: open && Boolean(item?.accountId),
  })
  const account = accountQuery.data?.account
  const sample = useMemo(() => {
    if (!item) return null
    if (item.sample) return item.sample
    return pickPreviewSample(runQuery.data?.samples ?? [], item.sampleId)
  }, [item, runQuery.data?.samples])
  const content = item?.content || sample?.response_text || ''
  const expectedOutput =
    item?.expectedOutput || runQuery.data?.profile?.expected_output || ''
  const expectedImageUrl =
    item?.expectedImageUrl || runQuery.data?.profile?.expected_image_url || ''
  const profileName = item?.profileName || runQuery.data?.profile?.name || ''
  const canCompare = Boolean(expectedOutput || expectedImageUrl)
  const alreadyIsolated = isIsolatedAccount(account)
  const isolateMutation = useMutation({
    mutationFn: (accountId: number) =>
      api.accountAction(accountId, {
        action: 'isolate',
        note: PREVIEW_ISOLATE_NOTE,
        propagate: true,
      }),
    onSuccess: () => {
      setIsolateOpen(false)
      toast.success('已移入隔离区')
      if (item?.accountId) {
        void client.invalidateQueries({ queryKey: ['account', item.accountId] })
        void client.invalidateQueries({ queryKey: ['accounts'] })
        void client.invalidateQueries({ queryKey: ['runs'] })
        void client.invalidateQueries({ queryKey: ['dashboard'] })
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  useEffect(() => {
    setCompareExpected(false)
    setIsolateOpen(false)
  }, [item?.id])

  useEffect(() => {
    if (!open) return
    const active = document.querySelector<HTMLElement>(
      `[data-preview-index="${safeIndex}"]`
    )
    active?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [open, safeIndex])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (isolateOpen) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (safeIndex > 0) onIndexChange(safeIndex - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (safeIndex < items.length - 1) onIndexChange(safeIndex + 1)
      } else if (event.key === 'i' || event.key === 'I') {
        event.preventDefault()
        if (item && !alreadyIsolated) setIsolateOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    alreadyIsolated,
    isolateOpen,
    item,
    items.length,
    onIndexChange,
    open,
    safeIndex,
  ])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className='top-0 left-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none sm:p-0'
        >
          <div className='flex h-full min-h-0 flex-col'>
            <header className='flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2'>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                disabled={safeIndex <= 0}
                onClick={() => onIndexChange(safeIndex - 1)}
                aria-label='上一个账号'
              >
                <ChevronLeft />
              </Button>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                disabled={safeIndex >= items.length - 1}
                onClick={() => onIndexChange(safeIndex + 1)}
                aria-label='下一个账号'
              >
                <ChevronRight />
              </Button>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium'>
                  {item?.accountName || '账号结果预览'}
                </div>
                <div className='truncate text-xs text-muted-foreground'>
                  {item
                    ? `${safeIndex + 1} / ${items.length}${
                        profileName ? ` · ${profileName}` : ''
                      }`
                    : '当前筛选没有可预览样本'}
                </div>
              </div>
              {canCompare ? (
                <Button
                  type='button'
                  size='sm'
                  variant={compareExpected ? 'secondary' : 'outline'}
                  onClick={() => setCompareExpected((current) => !current)}
                >
                  <Columns2 />
                  对照预期
                </Button>
              ) : null}
              {alreadyIsolated ? (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    onOpenChange(false)
                    onOpenQuarantine?.()
                  }}
                >
                  <ShieldBan />
                  查看隔离区
                </Button>
              ) : (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={!item}
                  onClick={() => setIsolateOpen(true)}
                >
                  <ShieldBan />
                  移入隔离区
                </Button>
              )}
              <Button
                type='button'
                size='icon'
                variant='ghost'
                onClick={() => onOpenChange(false)}
                aria-label='关闭预览'
              >
                <X />
              </Button>
            </header>
            {item ? (
              <div className='grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]'>
                <div className='min-h-0'>
                  {needsRunFetch && runQuery.isLoading ? (
                    <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
                      <Loader2 className='size-4 animate-spin' />
                      正在读取样本
                    </div>
                  ) : needsRunFetch && runQuery.isError ? (
                    <div className='flex h-full items-center justify-center p-6 text-sm text-destructive'>
                      {getErrorMessage(runQuery.error)}
                    </div>
                  ) : (
                    <ContentPreviewCanvas
                      key={item.id}
                      content={content}
                      expectedImageUrl={expectedImageUrl}
                      expectedContent={expectedOutput}
                      compareExpected={compareExpected}
                      className='h-full'
                    />
                  )}
                </div>
                <aside className='min-h-0 overflow-y-auto border-t bg-muted/15 p-4 lg:border-t-0 lg:border-s'>
                  <PreviewAccountPane
                    item={item}
                    account={account}
                    sample={sample}
                    loading={accountQuery.isLoading}
                    onOpenAccount={
                      onOpenAccount
                        ? () => {
                            onOpenChange(false)
                            onOpenAccount(item.accountId)
                          }
                        : undefined
                    }
                    onOpenRun={
                      onOpenRun
                        ? () => {
                            onOpenChange(false)
                            onOpenRun(item.runId)
                          }
                        : undefined
                    }
                  />
                </aside>
              </div>
            ) : (
              <div className='flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground'>
                当前筛选没有可预览的任务样本
              </div>
            )}
            {items.length > 1 ? (
              <div className='shrink-0 border-t bg-background px-2 py-2'>
                <div className='mb-1.5 px-1 text-[11px] text-muted-foreground'>
                  ← → 翻页 · I 隔离 · Esc 关闭
                </div>
                <div className='flex min-w-max gap-1.5 overflow-x-auto'>
                  {items.map((entry, itemIndex) => {
                    const active = itemIndex === safeIndex
                    return (
                      <button
                        key={entry.id}
                        type='button'
                        data-preview-index={itemIndex}
                        className={cn(
                          'max-w-40 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                          active
                            ? 'border-primary/50 bg-primary/10'
                            : 'hover:bg-muted/60'
                        )}
                        onClick={() => onIndexChange(itemIndex)}
                      >
                        <div className='truncate text-xs font-medium'>
                          {entry.accountName}
                        </div>
                        <div className='truncate text-[11px] text-muted-foreground'>
                          {entry.accountEmail || `账号 ${entry.accountId}`}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={isolateOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isolateMutation.isPending) setIsolateOpen(false)
        }}
        title='将账号移入隔离区？'
        desc={
          <div className='space-y-2'>
            <p>
              当前预览看起来像降智时，可以把账号长期隔离并停用上游，不会删除账号。
            </p>
            <p className='font-medium text-foreground'>
              隔离区不会自动到期恢复。备注会写成「{PREVIEW_ISOLATE_NOTE}」。
            </p>
          </div>
        }
        cancelBtnText='取消'
        confirmText={
          isolateMutation.isPending ? (
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
        isLoading={isolateMutation.isPending}
        disabled={!item}
        handleConfirm={() => {
          if (item) isolateMutation.mutate(item.accountId)
        }}
      />
    </>
  )
}

function PreviewAccountPane({
  item,
  account,
  sample,
  loading,
  onOpenAccount,
  onOpenRun,
}: {
  item: ResultPreviewItem
  account?: UpstreamAccount
  sample: ProbeSample | null
  loading: boolean
  onOpenAccount?: () => void
  onOpenRun?: () => void
}) {
  const assessment = account?.assessment
  return (
    <div className='space-y-4'>
      <div>
        <div className='flex items-start gap-1'>
          <div className='min-w-0 flex-1'>
            <div className='font-medium break-all'>{item.accountName}</div>
            <div className='mt-1 text-xs text-muted-foreground'>
              {formatAccountSecondaryLabel({
                id: String(item.accountId),
                email: item.accountEmail || account?.email,
                createdAt: account?.createdAt,
                accountLabel: item.accountName,
              })}
            </div>
          </div>
          <CopyButton
            value={item.accountEmail?.trim() || String(item.accountId)}
            className='size-6'
          />
        </div>
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {loading ? (
            <Badge variant='outline'>读取账号中</Badge>
          ) : (
            <>
              <MonitorStatusBadge status={assessment?.monitor_status} />
              {account?.missingUpstream ? (
                <Badge variant='outline'>上游缺失</Badge>
              ) : (
                <EnabledBadge enabled={account?.enabled} prefix='上游' />
              )}
              {isIsolatedAccount(account) ? (
                <Badge variant='secondary'>已隔离</Badge>
              ) : null}
            </>
          )}
        </div>
      </div>
      {sample ? (
        <div className='space-y-2 rounded-lg border bg-background p-3'>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-xs text-muted-foreground'>本条样本</span>
            <StatusBadge value={sample.classification} />
          </div>
          <div className='grid grid-cols-2 gap-2 text-sm'>
            <PreviewMetric
              label='TPS'
              value={
                <DualTpsValue
                  tps={sample.tps}
                  upstreamTps={sample.upstream_tps}
                  compact
                />
              }
            />
            <PreviewMetric
              label='首 Token'
              value={`${formatNumber(sample.first_token_ms, 0)} ms`}
            />
            <PreviewMetric
              label='耗时'
              value={`${formatNumber(sample.duration_ms, 0)} ms`}
            />
            <PreviewMetric
              label='轮次'
              value={`第 ${sample.round_number || 1} 轮`}
            />
          </div>
          <div className='text-xs text-muted-foreground'>
            {formatDate(sample.created_at)}
          </div>
        </div>
      ) : (
        <div className='rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
          还没有可展示的样本正文
        </div>
      )}
      <div className='flex flex-col gap-2'>
        {onOpenAccount ? (
          <Button type='button' variant='outline' onClick={onOpenAccount}>
            <UsersRound />
            打开探针详情
          </Button>
        ) : null}
        {onOpenRun ? (
          <Button type='button' variant='outline' onClick={onOpenRun}>
            <ExternalLink />
            打开任务详情
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function PreviewMetric({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div>
      <div className='text-[11px] text-muted-foreground'>{label}</div>
      <div className='mt-0.5 tabular-nums'>{value}</div>
    </div>
  )
}

function isIsolatedAccount(account?: UpstreamAccount) {
  return (
    account?.assessment.monitor_status === 'quarantined' &&
    !account.assessment.quarantine_until
  )
}
