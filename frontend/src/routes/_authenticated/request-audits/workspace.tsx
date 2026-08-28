import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceRoutePlaceholder } from '@/components/layout/workspace-route-placeholder'
import { requestAuditsSearchSchema } from '@/features/monitor/pages/request-audits-search'

export const Route = createFileRoute('/_authenticated/request-audits/workspace')({
  validateSearch: requestAuditsSearchSchema,
  component: WorkspaceRoutePlaceholder,
})
