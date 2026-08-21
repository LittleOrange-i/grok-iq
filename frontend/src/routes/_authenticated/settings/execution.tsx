import { createFileRoute } from '@tanstack/react-router'
import { SettingsExecutionPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/execution')({
  component: SettingsExecutionPage,
})
