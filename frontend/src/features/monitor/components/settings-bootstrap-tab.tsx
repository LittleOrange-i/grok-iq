import { ServerCog } from 'lucide-react'
import type { RuntimeSettings } from '@/lib/api'
import { BootstrapSetting, SettingsCard } from './settings-components'

export function SettingsBootstrapTab({
  settings,
}: {
  settings: RuntimeSettings
}) {
  return (
    <SettingsCard
      icon={ServerCog}
      title='启动级参数'
      description='由容器或环境变量提供，只读展示当前进程实际值；修改后需要重启。'
    >
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <BootstrapSetting label='监听地址' value={settings.bootstrap.host} />
        <BootstrapSetting
          label='监听端口'
          value={String(settings.bootstrap.port)}
        />
        <BootstrapSetting
          label='数据库路径'
          value={settings.bootstrap.databasePath}
          mono
        />
        <BootstrapSetting
          label='CORS Origins'
          value={settings.bootstrap.corsOrigins.join(', ') || '—'}
          mono
        />
      </div>
    </SettingsCard>
  )
}
