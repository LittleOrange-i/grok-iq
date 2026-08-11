import { createFileRoute } from '@tanstack/react-router'
import { AccountsPage } from '@/features/monitor/pages/accounts'

export const Route = createFileRoute('/_authenticated/accounts/')({
  component: AccountsPage,
})
