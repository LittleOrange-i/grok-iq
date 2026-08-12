import { createFileRoute } from '@tanstack/react-router'
import { EgressNodesPage } from '@/features/monitor/pages/egress-nodes'

export const Route = createFileRoute('/_authenticated/egress-nodes/')({
  component: EgressNodesPage,
})
