export function formatPercent(value: number) {
  return `${formatNumber(value * 100)}%`
}

export function formatDurationHours(value: number) {
  const hours = Math.max(0, Number(value) || 0)
  if (hours % 168 === 0) return `${formatNumber(hours / 168)} 周`
  if (hours % 24 === 0) return `${formatNumber(hours / 24)} 天`
  return `${formatNumber(hours)} 小时`
}

export function formatFactorLimit(weight: number, cap: number) {
  if (weight <= 0 || cap <= 0) return '0'
  return formatNumber(Math.ceil(cap / weight))
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(value)
}
