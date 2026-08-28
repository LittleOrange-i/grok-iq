import { cn } from '@/lib/utils'

const labels: Record<string, string> = {
  healthy: '正常',
  watch: '观察',
  suspect: '疑似降智',
  high_risk: '高风险',
  quarantined: '已停用',
  queued: '任务排队中',
  running: '任务执行中',
  cancel_requested: '任务取消中',
  recovering: '任务恢复中',
  cancelled: '任务已取消',
  completed: '任务已完成',
  completed_with_errors: '任务部分异常',
  failed: '任务失败',
  normal: '正常',
  elevated: '降智信号',
  buffered_soft: '缓冲降智信号',
  buffered_hard: '强缓冲降智',
  fast_risk: '强降智信号',
  marker_miss: '预期缺失',
  reasoning_zero: '思考输出为 0',
  reasoning_zero_observe: '思考输出为 0（观察）',
  error: '错误',
  unmeasurable: '无法测量',
  insufficient: '样本不足',
}

function statusLabel(value?: string | null) {
  return labels[value || ''] || value || '未知'
}

function statusTone(value?: string | null) {
  if (
    value === 'healthy' ||
    value === 'normal' ||
    value === 'completed'
  ) {
    return 'success'
  }
  if (
    value === 'watch' ||
    value === 'queued' ||
    value === 'buffered_soft' ||
    value === 'elevated' ||
    value === 'reasoning_zero' ||
    value === 'reasoning_zero_observe' ||
    value === 'insufficient'
  ) {
    return 'warning'
  }
  if (value === 'running' || value === 'recovering') {
    return 'info'
  }
  if (value === 'cancelled') {
    return 'neutral'
  }
  return 'danger'
}

const toneClass: Record<string, { dot: string; text: string }> = {
  success: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
  },
  info: { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
  neutral: { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
  danger: { dot: 'bg-destructive', text: 'text-destructive' },
}

export function StatusBadge({
  value,
  className,
}: {
  value?: string | null
  className?: string
}) {
  const tone = statusTone(value)
  const styles = toneClass[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        styles.text,
        className
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', styles.dot)} />
      {statusLabel(value)}
    </span>
  )
}
