import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { OnboardingPage } from '@/features/onboarding'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/onboarding')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, location, search }) => {
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
    const onboarding = await context.queryClient.ensureQueryData({
      queryKey: ['onboarding'],
      queryFn: api.onboarding,
      staleTime: 0,
    })
    if (onboarding.completed) {
      throw redirect({
        to: normalizedRedirect(search.redirect),
        replace: true,
      })
    }
  },
  component: OnboardingPage,
})

function normalizedRedirect(value?: string): string {
  return value?.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/onboarding')
    ? value
    : '/'
}
