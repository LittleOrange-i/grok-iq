import { createFileRoute } from '@tanstack/react-router'
import { SettingsNotificationsPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/notifications')({
  component: SettingsNotificationsPage,
})
