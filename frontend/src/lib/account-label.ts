export function formatAccountCreatedAt(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatAccountSecondaryLabel({
  id,
  email,
  createdAt,
  accountLabel,
}: {
  id: string | number
  email?: string | null
  createdAt?: string | null
  accountLabel: string
}) {
  const trimmedEmail = email?.trim() ?? ''
  const parts = [
    trimmedEmail &&
    trimmedEmail.toLowerCase() !== accountLabel.trim().toLowerCase()
      ? trimmedEmail
      : null,
    `ID ${id}`,
    formatAccountCreatedAt(createdAt),
  ].filter(Boolean)
  return parts.join(' · ')
}
