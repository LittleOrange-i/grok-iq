import {
  Activity,
  BookOpenCheck,
  CalendarClock,
  Cpu,
  LayoutDashboard,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  TestTube2,
  UsersRound,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: 'Monitor', email: 'API-only integration', avatar: '' },
  teams: [
    { name: 'Grok Monitor', logo: ShieldCheck, plan: 'Account intelligence' },
  ],
  navGroups: [
    {
      title: '运行监控',
      items: [
        { title: '监控概览', url: '/', icon: LayoutDashboard },
        { title: '账号探针', url: '/accounts', icon: UsersRound },
        { title: '任务中心', url: '/runs', icon: Activity },
        { title: 'Worker 运行状态', url: '/workers', icon: Cpu },
      ],
    },
    {
      title: '策略与调度',
      items: [
        { title: '探针方案', url: '/probe-profiles', icon: TestTube2 },
        { title: 'Cron 调度', url: '/plans', icon: CalendarClock },
      ],
    },
    {
      title: '工作台',
      items: [
        { title: '聊天广场', url: '/playground', icon: MessageSquareText },
      ],
    },
    {
      title: '系统',
      items: [
        { title: '判定说明', url: '/guide', icon: BookOpenCheck },
        { title: '系统设置', url: '/settings', icon: Settings2 },
      ],
    },
  ],
}
