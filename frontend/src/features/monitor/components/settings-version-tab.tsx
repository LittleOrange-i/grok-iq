import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  GitBranch,
  PackageCheck,
  PanelTopOpen,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type SystemVersionInfo } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import {
  SYSTEM_UPDATE_COMMANDS,
  SYSTEM_UPDATE_PREVIEW_EVENT,
  SYSTEM_VERSION_QUERY_KEY,
  buildSystemUpdatePreview,
} from '@/lib/system-update'
import { formatDate, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MarkdownView } from '@/components/formatted-content'
import { EmptyState, LoadingState } from '@/components/page'
import { SettingsCard } from './settings-components'

function versionStatus(info: SystemVersionInfo) {
  if (info.status === 'update_available') {
    return {
      label: '发现新版本',
      badge: '可更新',
      detail: `${info.currentVersion} → ${info.latestVersion}`,
      variant: 'warning' as const,
      icon: AlertTriangle,
    }
  }
  if (info.status === 'up_to_date') {
    return {
      label: '已是最新版本',
      badge: '最新',
      detail: info.currentVersion,
      variant: 'success' as const,
      icon: CheckCircle2,
    }
  }
  if (info.status === 'checking') {
    return {
      label: '正在检查',
      badge: '检查中',
      detail: '正在读取 GitHub 最新 Release',
      variant: 'info' as const,
      icon: RefreshCw,
    }
  }
  if (info.status === 'error') {
    return {
      label: '检查异常',
      badge: '异常',
      detail: info.error || 'GitHub Release 暂时不可用',
      variant: 'destructive' as const,
      icon: AlertTriangle,
    }
  }
  if (info.status === 'no_release') {
    return {
      label: '尚无公开 Release',
      badge: '未发布',
      detail: 'GitHub 仓库目前没有可用于版本比较的 Release',
      variant: 'secondary' as const,
      icon: GitBranch,
    }
  }
  return {
    label: '等待首次检查',
    badge: '等待',
    detail: info.currentVersion,
    variant: 'secondary' as const,
    icon: Clock3,
  }
}

export function SettingsVersionTab() {
  const queryClient = useQueryClient()
  const versionQuery = useQuery({
    queryKey: SYSTEM_VERSION_QUERY_KEY,
    queryFn: api.systemVersion,
    staleTime: 60_000,
  })
  const checkMutation = useMutation({
    mutationFn: api.checkSystemUpdate,
    onSuccess: (value) => {
      queryClient.setQueryData(SYSTEM_VERSION_QUERY_KEY, value)
      if (value.status === 'error') {
        toast.error(value.error || 'GitHub Release 检查异常')
      } else if (value.status === 'no_release') {
        toast.info('GitHub 仓库尚未发布 Release')
      } else if (value.updateAvailable) {
        toast.success(`发现新版本 ${value.latestVersion}`)
      } else {
        toast.success('当前已是最新版本')
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  if (versionQuery.isLoading) {
    return <LoadingState label='正在读取 GrokIQ 版本信息' />
  }
  if (versionQuery.isError || !versionQuery.data) {
    return (
      <EmptyState
        title='版本信息加载失败'
        description={getErrorMessage(versionQuery.error)}
      />
    )
  }

  const info = versionQuery.data
  const status = versionStatus(info)
  const StatusIcon = status.icon
  const copyCommands = () => {
    void copyText(SYSTEM_UPDATE_COMMANDS)
      .then(() => toast.success('更新命令已复制'))
      .catch((error) => toast.error(getErrorMessage(error)))
  }
  const previewUpdateDialog = () => {
    if (!import.meta.env.DEV) return
    window.dispatchEvent(
      new CustomEvent(SYSTEM_UPDATE_PREVIEW_EVENT, {
        detail: buildSystemUpdatePreview(info),
      })
    )
  }

  return (
    <div className='space-y-4'>
      <SettingsCard
        icon={PackageCheck}
        title='GrokIQ 版本更新'
        description='后端启动后立即读取 GitHub 最新 Release，之后每 1 小时自动检查一次。'
      >
        <div className='grid gap-3 md:grid-cols-3'>
          <Card className='bg-muted/15 shadow-none'>
            <CardContent className='flex items-start gap-3 p-4'>
              <GitBranch className='mt-0.5 size-4 text-primary' />
              <div>
                <div className='text-xs text-muted-foreground'>当前版本</div>
                <div className='mt-1 font-mono text-sm font-semibold'>
                  {info.currentVersion}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className='bg-muted/15 shadow-none'>
            <CardContent className='flex items-start gap-3 p-4'>
              <PackageCheck className='mt-0.5 size-4 text-primary' />
              <div>
                <div className='text-xs text-muted-foreground'>
                  最新 Release
                </div>
                <div className='mt-1 font-mono text-sm font-semibold'>
                  {info.latestVersion || '—'}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className='bg-muted/15 shadow-none'>
            <CardContent className='flex items-start gap-3 p-4'>
              <Clock3 className='mt-0.5 size-4 text-primary' />
              <div>
                <div className='text-xs text-muted-foreground'>最近检查</div>
                <div className='mt-1 text-sm font-semibold'>
                  {formatDate(info.checkedAt)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className='mt-4 flex flex-col gap-3 rounded-lg border bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex min-w-0 items-start gap-3'>
            <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-background'>
              <StatusIcon className='size-4' />
            </div>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-sm font-medium'>{status.label}</span>
                <Badge variant={status.variant}>{status.badge}</Badge>
              </div>
              <p className='mt-1 text-xs break-words text-muted-foreground'>
                {status.detail}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            {import.meta.env.DEV && (
              <Button
                type='button'
                variant='outline'
                onClick={previewUpdateDialog}
              >
                <PanelTopOpen />
                预览提醒
              </Button>
            )}
            <Button
              type='button'
              variant='outline'
              disabled={checkMutation.isPending}
              onClick={() => checkMutation.mutate()}
            >
              <RefreshCw
                className={checkMutation.isPending ? 'animate-spin' : ''}
              />
              立即检查
            </Button>
          </div>
        </div>
      </SettingsCard>

      <div className='grid gap-4 xl:grid-cols-2'>
        <SettingsCard
          icon={Terminal}
          title='容器更新命令'
          description='在部署 GrokIQ 的目录执行；数据库卷和运行时配置保持不变。'
        >
          <div className='overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100'>
            <div className='flex items-center justify-between border-b border-white/10 px-3 py-2'>
              <span className='font-mono text-[11px] text-zinc-400'>bash</span>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                className='h-7 text-zinc-300 hover:bg-white/10 hover:text-white'
                onClick={copyCommands}
              >
                <Copy />
                复制
              </Button>
            </div>
            <pre className='overflow-x-auto p-4 font-mono text-xs leading-6'>
              <code>{SYSTEM_UPDATE_COMMANDS}</code>
            </pre>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={PackageCheck}
          title='Release 说明'
          description='内容来自 GitHub Releases；后端最多保留 4096 个字符。'
        >
          <div className='max-h-72 min-h-32 overflow-y-auto rounded-lg border bg-muted/15 p-4'>
            {info.releaseNotes.trim() ? (
              <MarkdownView content={info.releaseNotes} />
            ) : (
              <p className='text-sm text-muted-foreground'>
                暂无 Release 说明。
              </p>
            )}
          </div>
          <div className='mt-3 flex justify-end'>
            <Button asChild variant='outline' disabled={!info.releaseUrl}>
              <a href={info.releaseUrl} target='_blank' rel='noreferrer'>
                查看 GitHub Releases
                <ExternalLink />
              </a>
            </Button>
          </div>
        </SettingsCard>
      </div>
    </div>
  )
}
