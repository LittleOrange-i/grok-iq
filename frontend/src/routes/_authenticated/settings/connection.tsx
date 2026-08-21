import { createFileRoute } from '@tanstack/react-router'
import { SettingsConnectionPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/connection')({
  component: SettingsConnectionPage,
})
