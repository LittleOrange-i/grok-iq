import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Compass,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  TimerReset,
  UsersRound,
  Webhook,
} from 'lucide-react'
import {
  api,
  type PublicUpstreamAccountSummary,
  type PublicUpstreamProvider,
} from '@/lib/api'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeSwitch } from '@/components/theme-switch'

const providerMeta: Record<
  PublicUpstreamProvider,
  { label: string; hint: string; icon: typeof SquareTerminal }
> = {
  grok_build: {
    label: 'Build',
    hint: 'Grok Build 账号',
    icon: SquareTerminal,
  },
  grok_web: {
    label: 'Web',
    hint: 'Grok Web 账号',
    icon: Compass,
  },
  grok_console: {
    label: 'Console',
    hint: 'Grok Console 账号',
    icon: Webhook,
  },
}

const emptySummary: PublicUpstreamAccountSummary = {
  reachable: false,
  updatedAt: null,
  total: 0,
  available: 0,
  recovering: 0,
  attention: 0,
  risk: 0,
  providers: {
    grok_build: { total: 0, available: 0 },
    grok_web: { total: 0, available: 0 },
    grok_console: { total: 0, available: 0 },
  },
  recovery: { cooldown: 0, waitingReset: 0, probing: 0 },
  issues: { disabled: 0, reauthRequired: 0 },
}

export function PublicUpstreamStatusPage() {
  const query = useQuery({
    queryKey: ['public', 'upstream-accounts'],
    queryFn: api.publicUpstreamAccounts,
    refetchInterval: 15_000,
    retry: 1,
  })
  const data = query.data ?? emptySummary
  const errorMessage = query.isError ? getErrorMessage(query.error) : ''
  const hasData = query.data != null
  const ready = hasData && data.reachable && !query.isError

  return (
    <div className='min-h-svh bg-muted/30'>
      <header className='border-b bg-background/80 backdrop-blur-sm'>
        <div className='mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <span className='flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs'>
              <ShieldCheck className='size-4' />
            </span>
            <span className='min-w-0'>
              <span className='block truncate text-sm leading-4 font-semibold'>
                GrokIQ
              </span>
              <span className='block truncate text-[11px] text-muted-foreground'>
                上游账号状态
              </span>
            </span>
          </div>
          <ThemeSwitch />
        </div>
      </header>

      <main className='mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:py-8'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <p className='text-xs font-medium tracking-[0.16em] text-primary uppercase'>
              Public status
            </p>
            <h1 className='mt-1 text-2xl font-semibold tracking-tight'>
              上游账号情况
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              只展示 grok2api 聚合计数，不含账号明细、凭据或签名信息。
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge
              loading={query.isLoading && !query.data}
              reachable={data.reachable}
              error={Boolean(errorMessage)}
            />
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {query.isFetching ? (
                <Loader2 className='animate-spin' />
              ) : (
                <RefreshCw />
              )}
              刷新
            </Button>
          </div>
        </div>

        {errorMessage && (
          <Card className='border-destructive/30 bg-destructive/5'>
            <CardContent className='p-4 text-sm text-destructive'>
              状态读取失败：{errorMessage}
            </CardContent>
          </Card>
        )}

        {!errorMessage && !data.reachable && query.data && (
          <Card className='border-amber-500/30 bg-amber-500/5'>
            <CardContent className='p-4 text-sm text-amber-800 dark:text-amber-300'>
              上游暂时不可达，当前不展示账号计数。
            </CardContent>
          </Card>
        )}

        <section className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
          <MetricCard
            label='账号总数'
            value={ready ? data.total : '—'}
            detail={
              ready
                ? `${formatNumber(data.available, 0)} 个当前可调度`
                : '读取中'
            }
            icon={UsersRound}
            tone='text-sky-600 bg-sky-500/10'
            raw={!ready}
          />
          <MetricCard
            label='恢复中'
            value={ready ? data.recovering : '—'}
            detail='冷却、待重置或检测中'
            icon={TimerReset}
            tone='text-amber-600 bg-amber-500/10'
            raw={!ready}
          />
          <MetricCard
            label='需关注'
            value={ready ? data.attention : '—'}
            detail={
              ready
                ? `${formatNumber(data.issues.disabled, 0)} 停用 · ${formatNumber(data.issues.reauthRequired, 0)} 失效`
                : '读取中'
            }
            icon={AlertTriangle}
            tone='text-orange-600 bg-orange-500/10'
            raw={!ready}
          />
          <MetricCard
            label='风险标记'
            value={ready ? data.risk : '—'}
            detail='上游机器人风险账号'
            icon={ShieldAlert}
            tone='text-red-600 bg-red-500/10'
            raw={!ready}
          />
          <MetricCard
            label='可调度占比'
            value={ready ? percent(data.available, data.total) : '—'}
            detail='可调度 / 总数'
            icon={Activity}
            tone='text-emerald-600 bg-emerald-500/10'
            raw
          />
        </section>

        <section className='grid gap-4 lg:grid-cols-3'>
          {(Object.keys(providerMeta) as PublicUpstreamProvider[]).map(
            (provider) => (
              <ProviderCard
                key={provider}
                provider={provider}
                counts={data.providers[provider]}
                ready={ready}
              />
            )
          )}
        </section>

        <section className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <TimerReset className='size-4 text-primary' />
                恢复队列
              </CardTitle>
            </CardHeader>
            <CardContent className='grid gap-3 sm:grid-cols-3'>
              <CountTile
                label='冷却中'
                value={ready ? data.recovery.cooldown : null}
              />
              <CountTile
                label='待重置'
                value={ready ? data.recovery.waitingReset : null}
              />
              <CountTile
                label='检测中'
                value={ready ? data.recovery.probing : null}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <AlertTriangle className='size-4 text-primary' />
                账号问题
              </CardTitle>
            </CardHeader>
            <CardContent className='grid gap-3 sm:grid-cols-2'>
              <CountTile
                label='已停用'
                value={ready ? data.issues.disabled : null}
              />
              <CountTile
                label='需重新登录'
                value={ready ? data.issues.reauthRequired : null}
              />
            </CardContent>
          </Card>
        </section>

        <p className='text-xs text-muted-foreground'>
          最近更新：{hasData ? formatDate(data.updatedAt) : '—'} · 每 15
          秒自动刷新
        </p>
      </main>
    </div>
  )
}

function StatusBadge({
  loading,
  reachable,
  error,
}: {
  loading: boolean
  reachable: boolean
  error: boolean
}) {
  if (loading) {
    return (
      <Badge variant='outline' className='gap-1.5'>
        <Loader2 className='size-3 animate-spin' />
        读取中
      </Badge>
    )
  }
  if (error) {
    return <Badge variant='destructive'>读取失败</Badge>
  }
  if (!reachable) {
    return <Badge variant='warning'>上游不可达</Badge>
  }
  return <Badge variant='success'>上游正常</Badge>
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  raw = false,
}: {
  label: string
  value: number | string
  detail: string
  icon: typeof UsersRound
  tone: string
  raw?: boolean
}) {
  return (
    <Card>
      <CardContent className='flex items-start gap-3 p-5'>
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            tone
          )}
        >
          <Icon className='size-5' />
        </div>
        <div className='min-w-0'>
          <p className='text-xs text-muted-foreground'>{label}</p>
          <p className='number mt-1 text-2xl font-semibold'>
            {raw ? value : formatNumber(Number(value), 0)}
          </p>
          <p className='mt-1 truncate text-xs text-muted-foreground'>{detail}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderCard({
  provider,
  counts,
  ready,
}: {
  provider: PublicUpstreamProvider
  counts: { total: number; available: number }
  ready: boolean
}) {
  const meta = providerMeta[provider]
  const Icon = meta.icon
  const ratio = counts.total > 0 ? counts.available / counts.total : 0
  return (
    <Card>
      <CardContent className='space-y-4 p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <div className='flex items-center gap-2'>
              <Icon className='size-4 text-primary' />
              <h2 className='font-medium'>{meta.label}</h2>
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>{meta.hint}</p>
          </div>
          <Badge variant='outline'>
            {ready ? percent(counts.available, counts.total) : '—'}
          </Badge>
        </div>
        <div className='h-2 overflow-hidden rounded-full bg-muted'>
          <div
            className='h-full rounded-full bg-primary'
            style={{ width: ready ? `${Math.round(ratio * 100)}%` : '0%' }}
          />
        </div>
        <div className='flex items-center justify-between text-sm'>
          <span className='text-muted-foreground'>可调度</span>
          <span className='tabular-nums'>
            {ready
              ? `${formatNumber(counts.available, 0)} / ${formatNumber(counts.total, 0)}`
              : '—'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function CountTile({
  label,
  value,
}: {
  label: string
  value: number | null
}) {
  return (
    <div className='rounded-lg border bg-muted/20 px-3 py-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='mt-1 text-xl font-semibold tabular-nums'>
        {value == null ? '—' : formatNumber(value, 0)}
      </div>
    </div>
  )
}

function percent(part: number, total: number) {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}
