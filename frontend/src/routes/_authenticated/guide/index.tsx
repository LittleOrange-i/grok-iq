import { createFileRoute } from '@tanstack/react-router'
import { DecisionGuidePage } from '@/features/monitor/pages/decision-guide'

export const Route = createFileRoute('/_authenticated/guide/')({
  component: DecisionGuidePage,
})
