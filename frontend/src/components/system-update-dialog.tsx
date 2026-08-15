import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Copy,
  ExternalLink,
  PackageOpen,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type SystemVersionInfo } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import {
  SYSTEM_UPDATE_COMMANDS,
  SYSTEM_UPDATE_DISMISS_KEY,
  SYSTEM_UPDATE_PREVIEW_EVENT,
  SYSTEM_VERSION_QUERY_KEY,
} from '@/lib/system-update'
import { getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarkdownView } from '@/components/formatted-content'

function dismissedUpdateVersion() {
  try {
    return window.sessionStorage.getItem(SYSTEM_UPDATE_DISMISS_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberDismissedVersion(version: string) {
  try {
    window.sessionStorage.setItem(SYSTEM_UPDATE_DISMISS_KEY, version)
  } catch {
    // The in-memory state below still closes the dialog for this page.
  }
}

export function SystemUpdateDialog() {
  const version = useQuery({
    queryKey: SYSTEM_VERSION_QUERY_KEY,
    queryFn: api.systemVersion,
    staleTime: 60_000,
    refetchInterval: (query) =>
      ['idle', 'checking'].includes(query.state.data?.status ?? '')
        ? 3_000
        : 5 * 60_000,
  })
  const [dismissedVersion, setDismissedVersion] = useState(
    dismissedUpdateVersion
  )
  const [preview, setPreview] = useState<SystemVersionInfo | null>(null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const showPreview = (event: Event) => {
      const detail = (event as CustomEvent<SystemVersionInfo>).detail
      if (detail?.updateAvailable) setPreview(detail)
    }
    window.addEventListener(SYSTEM_UPDATE_PREVIEW_EVENT, showPreview)
    return () =>
      window.removeEventListener(SYSTEM_UPDATE_PREVIEW_EVENT, showPreview)
  }, [])

  const info = preview ?? version.data
  const isPreview = preview !== null
  const latestVersion = info?.latestVersion ?? ''
  const open = Boolean(
    isPreview ||
    (info?.updateAvailable &&
      latestVersion &&
      dismissedVersion !== latestVersion)
  )

  const dismiss = () => {
    if (isPreview) {
      setPreview(null)
      return
    }
    if (!latestVersion) return
    rememberDismissedVersion(latestVersion)
    setDismissedVersion(latestVersion)
  }

  const copyCommands = () => {
    void copyText(SYSTEM_UPDATE_COMMANDS)
      .then(() => toast.success('更新命令已复制'))
      .catch((error) => toast.error(getErrorMessage(error)))
  }

  if (!info) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && dismiss()}>
      <DialogContent className='gap-0 overflow-hidden p-0 sm:max-w-2xl sm:p-0'>
        <div className='border-b bg-linear-to-br from-primary/12 via-primary/5 to-background px-5 py-5 pe-14 sm:px-6 sm:py-6 sm:pe-14'>
          <DialogHeader className='text-start'>
            <div className='mb-1 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm'>
              <PackageOpen className='size-5' />
            </div>
            <DialogTitle className='flex items-center gap-2 text-xl'>
              发现 GrokIQ 新版本
              {isPreview && <Badge variant='info'>开发预览</Badge>}
            </DialogTitle>
            <DialogDescription>
              {isPreview
                ? '本地模拟完整更新提醒；生产构建中不显示预览入口。'
                : 'GitHub Release 已发布，可以在宿主机拉取最新镜像并重建服务。'}
            </DialogDescription>
          </DialogHeader>
          <div className='mt-4 flex flex-wrap items-center gap-2'>
            <Badge variant='outline'>当前 {info.currentVersion}</Badge>
            <ArrowRight className='size-4 text-muted-foreground' />
            <Badge variant='success'>最新 {latestVersion}</Badge>
          </div>
        </div>

        <div className='max-h-[55dvh] space-y-4 overflow-y-auto p-5 sm:p-6'>
          <section>
            <div className='mb-2 flex items-center gap-2 text-sm font-medium'>
              <Terminal className='size-4 text-primary' />
              Docker Compose 更新命令
            </div>
            <div className='overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100'>
              <div className='flex items-center justify-between border-b border-white/10 px-3 py-2'>
                <span className='font-mono text-[11px] text-zinc-400'>
                  bash
                </span>
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
          </section>

          <section>
            <div className='mb-2 text-sm font-medium'>Release 说明</div>
            <div className='max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-4'>
              {info.releaseNotes.trim() ? (
                <MarkdownView content={info.releaseNotes} />
              ) : (
                <p className='text-sm text-muted-foreground'>
                  本次 Release 未填写说明。
                </p>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className='border-t bg-muted/15 p-4 sm:px-6'>
          <Button type='button' variant='outline' onClick={dismiss}>
            {isPreview ? '关闭预览' : '本次会话不再提示'}
          </Button>
          <Button asChild>
            <a href={info.releaseUrl} target='_blank' rel='noreferrer'>
              查看 GitHub Release
              <ExternalLink />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
