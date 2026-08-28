import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceRoutePlaceholder } from '@/components/layout/workspace-route-placeholder'
import { runsSearchSchema } from '@/features/monitor/pages/runs-search'

export const Route = createFileRoute('/_authenticated/runs/')({
  validateSearch: runsSearchSchema,
  component: WorkspaceRoutePlaceholder,
})
