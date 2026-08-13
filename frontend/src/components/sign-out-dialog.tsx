import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api, ApiError } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    let revokeError: unknown
    try {
      await api.authLogout()
    } catch (error) {
      revokeError = error
    } finally {
      const currentPath = location.href
      auth.reset()
      queryClient.clear()
      onOpenChange(false)
      setIsLoading(false)
      await navigate({
        to: '/sign-in',
        search: { redirect: currentPath },
        replace: true,
      })
    }
    if (
      revokeError &&
      !(revokeError instanceof ApiError && revokeError.status === 401)
    ) {
      toast.warning('本地已退出，但服务端会话撤销状态未确认')
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='退出登录？'
      desc='退出后需要重新输入管理员用户名和密码。'
      confirmText='退出登录'
      cancelBtnText='取消'
      destructive
      isLoading={isLoading}
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
