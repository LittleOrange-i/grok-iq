import { createFileRoute } from '@tanstack/react-router'
import { SettingsRiskPage } from '@/features/monitor/pages/settings-sections'

export const Route = createFileRoute('/_authenticated/settings/risk')({
  component: SettingsRiskPage,
})
