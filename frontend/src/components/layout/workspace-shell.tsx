import { lazy, Suspense, useLayoutEffect, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Activity, Loader2, ShieldAlert, UsersRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspaceTabsStore } from '@/stores/workspace-tabs-store'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  isWorkspaceTabPath,
  matchWorkspaceTabId,
  WORKSPACE_TAB_IDS,
  WORKSPACE_TAB_PATHS,
  WORKSPACE_TAB_TITLES,
  type WorkspaceTabId,
} from './workspace-tabs'

const workspacePages = {
  accounts: lazy(() =>
    import('@/features/monitor/pages/accounts').then((mod) => ({
      default: mod.AccountsPage,
    }))
  ),
  runs: lazy(() =>
    import('@/features/monitor/pages/runs').then((mod) => ({
      default: mod.RunsPage,
    }))
  ),
  'request-audits': lazy(() =>
    import('@/features/monitor/pages/request-audits').then((mod) => ({
      default: mod.RequestAuditsPage,
    }))
  ),
} as const

const workspaceIcons = {
  accounts: UsersRound,
  runs: Activity,
  'request-audits': ShieldAlert,
} as const

const workspaceAccents: Record<WorkspaceTabId, string> = {
  accounts: 'text-sky-600 dark:text-sky-400',
  runs: 'text-violet-600 dark:text-violet-400',
  'request-audits': 'text-amber-600 dark:text-amber-400',
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const showRouteOutlet = !isWorkspaceTabPath(pathname)

  return (
    <div className='relative min-h-0 flex-1 overflow-hidden'>
      <WorkspaceKeepAlive />
      {showRouteOutlet ? (
        <div className='h-full min-h-0 pb-16'>{children}</div>
      ) : null}
      <WorkspaceDock />
    </div>
  )
}

function WorkspaceKeepAlive() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const currentId = matchWorkspaceTabId(pathname)
  const mounted = useWorkspaceTabsStore((state) => state.mounted)
  const visit = useWorkspaceTabsStore((state) => state.visit)
  const renderMounted =
    currentId && !mounted.includes(currentId)
      ? [...mounted, currentId]
      : mounted

  useLayoutEffect(() => {
    if (currentId) visit(currentId)
  }, [currentId, visit])

  return (
    <>
      {WORKSPACE_TAB_IDS.map((id) => {
        if (!renderMounted.includes(id)) return null
        const Page = workspacePages[id]
        return (
          <WorkspacePageFrame key={id} id={id} active={id === currentId}>
            <Suspense fallback={<WorkspacePageFallback />}>
              <Page />
            </Suspense>
          </WorkspacePageFrame>
        )
      })}
    </>
  )
}

function WorkspacePageFrame({
  id,
  active,
  children,
}: {
  id: WorkspaceTabId
  active: boolean
  children: ReactNode
}) {
  useLayoutEffect(() => {
    if (!active) return
    window.dispatchEvent(new Event('resize'))
  }, [active])

  return (
    <div
      data-workspace-tab={id}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'absolute inset-0 min-h-0 overflow-hidden pb-16',
        active ? 'z-10' : 'invisible pointer-events-none z-0'
      )}
      aria-hidden={!active}
      inert={!active ? true : undefined}
    >
      {children}
    </div>
  )
}

function WorkspacePageFallback() {
  return (
    <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
      <Loader2 className='size-4 animate-spin' />
      正在打开工作区
    </div>
  )
}

function WorkspaceDock() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const currentId = matchWorkspaceTabId(pathname)
  const mounted = useWorkspaceTabsStore((state) => state.mounted)

  const closeTab = async (id: WorkspaceTabId) => {
    const remaining = useWorkspaceTabsStore
      .getState()
      .mounted.filter((item) => item !== id)
    if (currentId === id) {
      const nextId = remaining[remaining.length - 1]
      await navigate({
        to: nextId ? WORKSPACE_TAB_PATHS[nextId] : '/',
      })
    }
    useWorkspaceTabsStore.getState().close(id)
  }

  return (
    <nav
      aria-label='工作区页面'
      className='pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3'
    >
      <div className='pointer-events-auto inline-flex items-center gap-0.5 rounded-full border bg-muted/80 p-1 shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:bg-background/80 dark:shadow-black/40 dark:ring-white/10'>
        {WORKSPACE_TAB_IDS.map((id) => (
          <WorkspaceDockItem
            key={id}
            id={id}
            active={id === currentId}
            mounted={mounted.includes(id)}
            onClose={() => void closeTab(id)}
          />
        ))}
      </div>
    </nav>
  )
}

function WorkspaceDockItem({
  id,
  active,
  mounted,
  onClose,
}: {
  id: WorkspaceTabId
  active: boolean
  mounted: boolean
  onClose: () => void
}) {
  const title = WORKSPACE_TAB_TITLES[id]
  const Icon = workspaceIcons[id]
  const tooltip = active
    ? `${title}（当前页，已保持挂载）`
    : mounted
      ? `${title}（已挂载，切换时保留筛选和选择）`
      : `打开${title}并保持在工作区`

  return (
    <div className='group/dock-item relative inline-flex'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={WORKSPACE_TAB_PATHS[id]}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              mounted ? 'pl-2.5 pr-7' : 'px-2.5',
              active &&
                'bg-background text-foreground shadow-sm dark:bg-input/50',
              !active &&
                mounted &&
                'text-foreground/80 hover:bg-background/70 hover:text-foreground',
              !mounted &&
                'text-muted-foreground hover:bg-background/70 hover:text-foreground'
            )}
          >
            <Icon
              className={cn(
                'size-3.5 shrink-0',
                active || mounted
                  ? workspaceAccents[id]
                  : 'text-muted-foreground'
              )}
            />
            {title}
          </Link>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltip}</TooltipContent>
      </Tooltip>
      {mounted && (
        <div className='absolute top-1/2 right-1 size-5 -translate-y-1/2'>
          <span
            aria-hidden
            className='pointer-events-none absolute inset-0 hidden items-center justify-center md:flex group-hover/dock-item:opacity-0 group-focus-within/dock-item:opacity-0'
          >
            <span className='size-1.5 rounded-full bg-emerald-500' />
          </span>
          <button
            type='button'
            aria-label={`关闭${title}并重置页面状态`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }}
            className='absolute inset-0 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground md:pointer-events-none md:opacity-0 md:group-hover/dock-item:pointer-events-auto md:group-hover/dock-item:opacity-100 md:group-focus-within/dock-item:pointer-events-auto md:group-focus-within/dock-item:opacity-100'
          >
            <X className='size-3' />
          </button>
        </div>
      )}
    </div>
  )
}
