import { createFileRoute } from '@tanstack/react-router'
import { PublicUpstreamStatusPage } from '@/features/monitor/pages/public-upstream-status'

export const Route = createFileRoute('/status')({
  component: PublicUpstreamStatusPage,
})
