import { createFileRoute } from '@tanstack/react-router'
import { SettingsIntegrationsPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/integrations')({
  component: SettingsIntegrationsPage,
})
