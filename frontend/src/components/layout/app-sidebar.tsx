import { useLocation } from '@tanstack/react-router'
import { useLayout } from '@/context/layout-provider'
import { Sidebar, SidebarContent, SidebarRail } from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { settingsSidebarGroups } from './data/settings-sidebar-data'
import { NavGroup } from './nav-group'
import { SidebarViewHeader } from './sidebar-view-header'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const pathname = useLocation({ select: (location) => location.pathname })
  const settingsView =
    pathname === '/settings' || pathname.startsWith('/settings/')
  const navGroups = settingsView
    ? settingsSidebarGroups
    : sidebarData.navGroups

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      {settingsView && <SidebarViewHeader />}
      <SidebarContent className='py-2'>
        <div
          key={settingsView ? 'settings' : 'root'}
          className='animate-in fade-in-0 slide-in-from-start-1 duration-150 motion-reduce:animate-none'
        >
          {navGroups.map((props) => (
            <NavGroup key={props.title} {...props} />
          ))}
        </div>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
