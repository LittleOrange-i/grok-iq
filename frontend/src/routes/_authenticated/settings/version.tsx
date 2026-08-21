import { createFileRoute } from '@tanstack/react-router'
import { SettingsVersionPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/version')({
  component: SettingsVersionPage,
})
