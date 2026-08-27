import { createFileRoute } from '@tanstack/react-router'
import { QuarantinePage } from '@/features/monitor/pages/quarantine'

export const Route = createFileRoute('/_authenticated/quarantine/')({
  component: QuarantinePage,
})
