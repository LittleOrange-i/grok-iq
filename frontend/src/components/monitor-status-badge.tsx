import {
  Ban,
  CheckCircle2,
  CircleHelp,
  Eye,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const visuals: Record<
  string,
  {
    label: string
    variant:
      | 'success'
      | 'info'
      | 'warning'
      | 'destructive'
      | 'secondary'
      | 'outline'
    icon: typeof CheckCircle2
  }
> = {
  healthy: { label: '正常', variant: 'success', icon: CheckCircle2 },
  watch: { label: '观察', variant: 'info', icon: Eye },
  suspect: { label: '疑似降智', variant: 'warning', icon: TriangleAlert },
  high_risk: { label: '高风险', variant: 'destructive', icon: ShieldAlert },
  quarantined: { label: '已停用', variant: 'secondary', icon: Ban },
}

export function MonitorStatusBadge({
  status,
  className,
}: {
  status?: string | null
  className?: string
}) {
  const visual = visuals[status || '']
  const Icon = visual?.icon ?? CircleHelp
  const label = visual?.label ?? (status || '未知')

  return (
    <Badge
      variant={visual?.variant ?? 'outline'}
      className={cn('h-5 px-1.5 text-[11px] font-medium', className)}
    >
      <Icon />
      {label}
    </Badge>
  )
}

export function MonitorStatusCell({
  status,
  score,
  className,
}: {
  status?: string | null
  score?: number | null
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <MonitorStatusBadge status={status} />
      <span className='text-[11px] text-muted-foreground tabular-nums'>
        {formatNumber(score)} 分
      </span>
    </div>
  )
}
