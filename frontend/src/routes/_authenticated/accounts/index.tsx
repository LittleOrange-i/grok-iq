import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceRoutePlaceholder } from '@/components/layout/workspace-route-placeholder'

export const Route = createFileRoute('/_authenticated/accounts/')({
  component: WorkspaceRoutePlaceholder,
})
