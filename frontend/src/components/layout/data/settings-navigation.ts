import {
  Activity,
  Bell,
  BrainCircuit,
  PackageCheck,
  PlugZap,
  ScanSearch,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export type SettingsSection = {
  value:
    | 'connection'
    | 'execution'
    | 'request-audit'
    | 'risk'
    | 'notifications'
    | 'integrations'
    | 'version'
  href:
    | '/settings/connection'
    | '/settings/execution'
    | '/settings/request-audit'
    | '/settings/risk'
    | '/settings/notifications'
    | '/settings/integrations'
    | '/settings/version'
  title: string
  description: string
  icon: LucideIcon
}

export const settingsSections = [
  {
    value: 'connection',
    href: '/settings/connection',
    title: '连接与凭据',
    description: '上游地址、管理鉴权、HTTP 指纹和 SSO 检测代理。',
    icon: PlugZap,
  },
  {
    value: 'execution',
    href: '/settings/execution',
    title: '任务与执行',
    description: 'Worker 并发、队列容量、探针节奏和重试策略。',
    icon: Activity,
  },
  {
    value: 'request-audit',
    href: '/settings/request-audit',
    title: '请求审计',
    description: '审计采集、自适应扫描、页面刷新和本地保留周期。',
    icon: ScanSearch,
  },
  {
    value: 'risk',
    href: '/settings/risk',
    title: '风险与隔离',
    description: '模型能力、风险规则、评分、连续信号与账号处置。',
    icon: BrainCircuit,
  },
  {
    value: 'notifications',
    href: '/settings/notifications',
    title: '通知推送',
    description: '微信通知凭据、接收目标和测试消息。',
    icon: Bell,
  },
  {
    value: 'integrations',
    href: '/settings/integrations',
    title: '联动与启动项',
    description: '注册 Webhook、导入后探针和外部服务联动。',
    icon: Workflow,
  },
  {
    value: 'version',
    href: '/settings/version',
    title: '版本更新',
    description: '版本来源、更新检查和部署信息。',
    icon: PackageCheck,
  },
] as const satisfies readonly SettingsSection[]
