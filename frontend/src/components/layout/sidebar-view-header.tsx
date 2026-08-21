import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function SidebarViewHeader() {
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarHeader className='border-b px-2 py-2'>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            tooltip='返回监控台'
            className='gap-1.5 font-medium text-muted-foreground hover:text-foreground'
          >
            <Link to='/' onClick={() => setOpenMobile(false)}>
              <ChevronLeft className='size-4 shrink-0' />
              <span className='truncate'>返回监控台</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  )
}
