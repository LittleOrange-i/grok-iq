export const ACCOUNT_UPSTREAM_STATUS_OPTIONS = [
  { value: 'all', label: '全部上游状态' },
  { value: 'active', label: '正常' },
  { value: 'disabled', label: '停用' },
  { value: 'reauthRequired', label: '失效' },
  { value: 'cooldown', label: '冷却' },
  { value: 'waitingReset', label: '待重置' },
  { value: 'probing', label: '检测中' },
] as const

export type UpstreamStatusFilter =
  (typeof ACCOUNT_UPSTREAM_STATUS_OPTIONS)[number]['value']
