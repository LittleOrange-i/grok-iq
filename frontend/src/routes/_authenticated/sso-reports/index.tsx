import { createFileRoute } from '@tanstack/react-router'
import { SsoReportsPage } from '@/features/monitor/pages/sso-reports'

export const Route = createFileRoute('/_authenticated/sso-reports/')({
  component: SsoReportsPage,
})
