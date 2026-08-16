import { createFileRoute } from '@tanstack/react-router'
import { RequestAuditsPage } from '@/features/monitor/pages/request-audits'

export const Route = createFileRoute('/_authenticated/request-audits/')({
  component: RequestAuditsPage,
})
