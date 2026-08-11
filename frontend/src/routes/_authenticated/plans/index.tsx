import { createFileRoute } from '@tanstack/react-router'
import { PlansPage } from '@/features/monitor/pages/plans'

export const Route = createFileRoute('/_authenticated/plans/')({
  component: PlansPage,
})
