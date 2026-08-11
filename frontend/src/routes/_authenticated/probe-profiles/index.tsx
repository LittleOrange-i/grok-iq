import { createFileRoute } from '@tanstack/react-router'
import { ProbeProfilesPage } from '@/features/monitor/pages/profiles'

export const Route = createFileRoute('/_authenticated/probe-profiles/')({
  component: ProbeProfilesPage,
})
