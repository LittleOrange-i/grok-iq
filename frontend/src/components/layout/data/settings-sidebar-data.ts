import type { NavGroup } from '../types'
import { settingsSections } from './settings-navigation'

export const settingsSidebarGroups: NavGroup[] = [
  {
    title: '配置分区',
    items: settingsSections.map((section) => ({
      title: section.title,
      url: section.href,
      icon: section.icon,
    })),
  },
]
