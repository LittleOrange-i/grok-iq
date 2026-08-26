import { createFileRoute } from '@tanstack/react-router'
import { SettingsBootstrapPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/bootstrap')({
  component: SettingsBootstrapPage,
})
