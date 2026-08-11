import { createFileRoute } from '@tanstack/react-router'
import { PlaygroundPage } from '@/features/monitor/pages/playground'

export const Route = createFileRoute('/_authenticated/playground/')({
  component: PlaygroundPage,
})
