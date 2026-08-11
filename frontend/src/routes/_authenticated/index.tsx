import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '@/features/monitor/pages/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
})
