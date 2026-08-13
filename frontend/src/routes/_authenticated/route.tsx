import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    const auth = useAuthStore.getState().auth
    if (!auth.accessToken) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }
    try {
      const result = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'me'],
        queryFn: api.authMe,
        staleTime: 60_000,
      })
      auth.setUser(result.user)
    } catch {
      auth.reset()
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }
  },
  component: AuthenticatedLayout,
})
