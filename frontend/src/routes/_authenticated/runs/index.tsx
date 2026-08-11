import { createFileRoute } from '@tanstack/react-router'
import { RunsPage } from '@/features/monitor/pages/runs'

export const Route = createFileRoute('/_authenticated/runs/')({
  component: RunsPage,
})
