import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const SSO_DIRECT_CONNECT_RISK_TEXT =
  '未配置 SSO 检测代理时，将使用本机直连 IP 出口，容易导致账号被风控。建议先到「系统设置 → 连接与凭据」填写代理后再执行。'

export function SsoDirectConnectRiskNotice({
  description = SSO_DIRECT_CONNECT_RISK_TEXT,
}: {
  description?: string
}) {
  return (
    <Alert variant='destructive'>
      <AlertTriangle />
      <AlertTitle>直连检测有风控风险</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}
