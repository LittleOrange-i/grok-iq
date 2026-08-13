import { Link } from '@tanstack/react-router'
import { LogOut, Settings2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import useDialogState from '@/hooks/use-dialog-state'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutDialog } from '@/components/sign-out-dialog'

export function ProfileDropdown() {
  const [open, setOpen] = useDialogState()
  const user = useAuthStore((state) => state.auth.user)
  const username = user?.username || '管理员'
  const initials = username.slice(0, 2).toUpperCase()

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            className='relative size-8 rounded-full'
            aria-label='管理员菜单'
          >
            <Avatar className='size-8'>
              <AvatarFallback className='bg-primary/10 text-xs font-semibold text-primary'>
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56' align='end' forceMount>
          <DropdownMenuLabel className='font-normal'>
            <div className='flex flex-col gap-1.5'>
              <p className='truncate text-sm leading-none font-medium'>
                {username}
              </p>
              <p className='text-xs leading-none text-muted-foreground'>
                系统管理员
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to='/settings'>
              <Settings2 />
              系统设置
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            <LogOut />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}
