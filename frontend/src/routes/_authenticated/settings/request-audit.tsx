import { createFileRoute } from '@tanstack/react-router'
import { SettingsRequestAuditPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute(
  '/_authenticated/settings/request-audit'
)({
  component: SettingsRequestAuditPage,
})
