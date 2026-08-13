import { BellRing, Copy, Send } from 'lucide-react'
import { toast } from 'sonner'
import type { RuntimeSettings, SecretSettingName } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field,
  SecretField,
  SettingsCard,
  SwitchRow,
} from './settings-components'
import { WECHAT_TEMPLATE_BODY } from './settings-model'
import type { SettingsForm, SettingsSetter } from './settings-model'

export function SettingsNotificationsTab({
  form,
  settings,
  clearSecrets,
  busy,
  testPending,
  set,
  toggleSecretClear,
  onTest,
}: {
  form: SettingsForm
  settings: RuntimeSettings
  clearSecrets: SecretSettingName[]
  busy: boolean
  testPending: boolean
  set: SettingsSetter
  toggleSecretClear: (name: SecretSettingName) => void
  onTest: () => void
}) {
  return (
    <SettingsCard
      icon={BellRing}
      title='微信测试公众号异常推送'
      description='接入微信测试公众号模板消息；关闭开关时，自动探针和测试按钮都不会发消息。'
    >
      <div className='space-y-5'>
        <SwitchRow
          label='开启异常账号推送'
          description='账号首次进入观察、疑似异常、高风险或隔离状态时推送；同一状态不会重复刷屏，风险升级会再次推送。'
          checked={form.wechatNotificationEnabled}
          onCheckedChange={(value) => set('wechatNotificationEnabled', value)}
        />

        <div className='grid gap-4 lg:grid-cols-2'>
          <Field label='测试公众号 AppID' hint='微信测试公众号后台的 appID'>
            <Input
              value={form.wechatAppId}
              onChange={(event) => set('wechatAppId', event.target.value)}
              placeholder='wxxxxxxxxxxxxxxxxxxxxxxxx'
              autoComplete='off'
            />
          </Field>
          <SecretField
            name='wechatAppSecret'
            value={form.wechatAppSecret}
            settings={settings}
            clearing={clearSecrets.includes('wechatAppSecret')}
            onChange={(value) => set('wechatAppSecret', value)}
            onToggleClear={() => toggleSecretClear('wechatAppSecret')}
          />
          <Field label='接收人 OpenID' hint='微信测试公众号用户列表中的 OpenID'>
            <Input
              value={form.wechatOpenid}
              onChange={(event) => set('wechatOpenid', event.target.value)}
              placeholder='oAxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
              autoComplete='off'
            />
          </Field>
          <Field
            label='模板 ID'
            hint='在测试公众号“模板消息”里新建模板后复制 ID'
          >
            <Input
              value={form.wechatTemplateId}
              onChange={(event) => set('wechatTemplateId', event.target.value)}
              placeholder='模板 ID'
              autoComplete='off'
            />
          </Field>
        </div>

        <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]'>
          <div className='rounded-xl border bg-muted/15 p-4'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <div className='text-sm font-medium'>模板内容</div>
                <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                  在微信测试公众号创建模板时，字段名按下面的 key 填写。
                </p>
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() =>
                  void copyText(WECHAT_TEMPLATE_BODY)
                    .then(() => toast.success('已复制微信模板内容'))
                    .catch((error) => toast.error(getErrorMessage(error)))
                }
              >
                <Copy />
                复制
              </Button>
            </div>
            <pre className='mt-3 overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs leading-6 whitespace-pre-wrap'>
              {WECHAT_TEMPLATE_BODY}
            </pre>
          </div>
          <div className='rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs leading-5 text-muted-foreground'>
            <div className='font-medium text-foreground'>推荐模板标题</div>
            <p className='mt-1'>账号异常提醒</p>
            <div className='mt-3 font-medium text-foreground'>字段说明</div>
            <p className='mt-1'>
              first、account、status、score、tps、reason、time、remark
              会由系统自动填充。
            </p>
            <p className='mt-3'>
              保存并开启后，可点击下方按钮向该 OpenID 发一条测试消息。
            </p>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-3 border-t pt-4'>
          <Button
            type='button'
            variant='outline'
            disabled={busy || !form.wechatNotificationEnabled}
            onClick={() => onTest()}
          >
            <Send />
            {testPending ? '正在发送测试消息…' : '保存并发送测试消息'}
          </Button>
          {!form.wechatNotificationEnabled && (
            <span className='text-xs text-muted-foreground'>
              先开启推送开关并保存，系统才会发送消息。
            </span>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
