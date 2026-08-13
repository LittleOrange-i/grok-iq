import { CheckCircle2, Database, Link2, Network } from 'lucide-react'
import type { RuntimeSettings, SecretSettingName } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Boundary,
  Field,
  SecretField,
  SettingsCard,
} from './settings-components'
import type { SettingsForm, SettingsSetter } from './settings-model'

export function SettingsConnectionTab({
  form,
  settings,
  clearSecrets,
  set,
  toggleSecretClear,
}: {
  form: SettingsForm
  settings: RuntimeSettings
  clearSecrets: SecretSettingName[]
  set: SettingsSetter
  toggleSecretClear: (name: SecretSettingName) => void
}) {
  return (
    <div className='space-y-4'>
      <SettingsCard
        icon={Network}
        title='grok2api 连接'
        description='账号和出口始终实时读取上游；本项目仅持有访问上游所需的连接参数。'
      >
        <div className='grid gap-4 lg:grid-cols-2'>
          <Field label='服务地址' hint='包含协议与端口，不需要末尾斜杠'>
            <Input
              value={form.grok2apiBaseUrl}
              onChange={(event) => set('grok2apiBaseUrl', event.target.value)}
              placeholder='http://127.0.0.1:8000'
            />
          </Field>
          <Field label='HTTP 指纹' hint='curl_cffi impersonate 参数'>
            <Input
              value={form.grok2apiHttpImpersonate}
              onChange={(event) =>
                set('grok2apiHttpImpersonate', event.target.value)
              }
              placeholder='chrome'
            />
          </Field>
          <Field label='管理员用户名'>
            <Input
              value={form.grok2apiAdminUsername}
              onChange={(event) =>
                set('grok2apiAdminUsername', event.target.value)
              }
              autoComplete='username'
            />
          </Field>
          <SecretField
            name='grok2apiAdminPassword'
            value={form.grok2apiAdminPassword}
            settings={settings}
            clearing={clearSecrets.includes('grok2apiAdminPassword')}
            onChange={(value) => set('grok2apiAdminPassword', value)}
            onToggleClear={() => toggleSecretClear('grok2apiAdminPassword')}
          />
        </div>
      </SettingsCard>

      <Card className='border-dashed bg-muted/20'>
        <CardContent className='grid gap-3 p-4 md:grid-cols-3'>
          <Boundary
            icon={Database}
            title='上游事实数据'
            text='账号、OAuth、额度、出口绑定和启停状态全部保留在 grok2api。'
          />
          <Boundary
            icon={CheckCircle2}
            title='本地监控数据'
            text='仅保存探针方案、任务、指标、完整回复、风险判断和操作记录。'
          />
          <Boundary
            icon={Link2}
            title='API-only 集成'
            text='不复制账号表或出口表，页面每次查询均通过 grok2api 管理 API。'
          />
        </CardContent>
      </Card>
    </div>
  )
}
