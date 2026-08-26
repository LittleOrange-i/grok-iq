import { Badge } from '@/components/ui/badge'

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

export function StatusBadge({ value }: { value?: string | null }) {
  const variant =
    value === 'healthy' || value === 'normal' || value === 'completed'
      ? 'success'
      : value === 'watch' ||
          value === 'queued' ||
          value === 'buffered_soft' ||
          value === 'elevated' ||
          value === 'reasoning_zero' ||
          value === 'reasoning_zero_observe' ||
          value === 'insufficient'
        ? 'warning'
        : value === 'running' || value === 'recovering'
          ? 'info'
          : value === 'cancelled'
            ? 'secondary'
            : 'destructive'
  return <Badge variant={variant}>{statusLabel(value)}</Badge>
}
