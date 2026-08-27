import { Link, Outlet } from '@tanstack/react-router'
import { Bot, CircleCheckBig, ShieldCheck } from 'lucide-react'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { Badge } from '@/components/ui/badge'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ConfigDrawer } from '@/components/config-drawer'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { WorkspaceShell } from '@/components/layout/workspace-shell'
import { Header } from '@/components/layout/header'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { SkipToMain } from '@/components/skip-to-main'
import { SystemUpdateDialog } from '@/components/system-update-dialog'
import { ThemeSwitch } from '@/components/theme-switch'

export function AuthenticatedLayout({
  children,
}: {
  children?: React.ReactNode
}) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  return (
    <LayoutProvider>
      <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
        <SkipToMain />
        <Header>
          <Link to='/' className='flex min-w-0 items-center gap-2.5'>
            <span className='flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs'>
              <ShieldCheck className='size-4' />
            </span>
            <span className='hidden min-w-0 sm:block'>
              <span className='block truncate text-sm leading-4 font-semibold'>
                GrokIQ
              </span>
              <span className='block truncate text-[11px] text-muted-foreground'>
                Account intelligence
              </span>
            </span>
          </Link>
          <div className='ms-auto flex items-center gap-1 sm:gap-2'>
            <Badge
              variant='outline'
              className='hidden gap-1.5 rounded-full font-normal sm:inline-flex'
            >
              <CircleCheckBig className='text-emerald-500' /> 独立监控服务
            </Badge>
            <span className='hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex'>
              <Bot className='size-3.5' /> API-only
            </span>
            <ThemeSwitch />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </Header>
        <div className='flex min-h-0 w-full flex-1'>
          <AppSidebar />
          <SidebarInset
            className={cn(
              '@container/content h-[calc(100svh-var(--app-header-height,3.5rem))] min-h-0 overflow-hidden',
              'peer-data-[variant=inset]:h-[calc(100svh-var(--app-header-height,3.5rem)-(var(--spacing)*4))]'
            )}
          >
            <WorkspaceShell>{children ?? <Outlet />}</WorkspaceShell>
          </SidebarInset>
        </div>
        <SystemUpdateDialog />
      </SidebarProvider>
    </LayoutProvider>
  )
}
