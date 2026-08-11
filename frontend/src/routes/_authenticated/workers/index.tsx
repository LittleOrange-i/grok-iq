import { createFileRoute } from '@tanstack/react-router'
import { WorkersPage } from '@/features/monitor/pages/workers'

export const Route = createFileRoute('/_authenticated/workers/')({
  component: WorkersPage,
})
