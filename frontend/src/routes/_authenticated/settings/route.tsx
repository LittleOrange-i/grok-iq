import { createFileRoute } from '@tanstack/react-router'
import { SettingsLayout } from '@/features/monitor/pages/settings'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})
