import {
  Copy,
  ExternalLink,
  KeyRound,
  Layers3,
  MessageSquareText,
  Power,
  ServerCog,
  ShieldCheck,
  Webhook,
  Workflow,
} from 'lucide-react'
import { toast } from 'sonner'
import { IconGithub } from '@/assets/brand-icons'
import type {
  ProbeProfile,
  RuntimeSettings,
  SecretSettingName,
} from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { cn, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ProfileMultiSelect } from '@/features/monitor/components/profile-multi-select'
import {
  BootstrapSetting,
  Field,
  FixedProbeSetting,
  IntegrationFlow,
  NumberField,
  SecretField,
  SettingList,
  SettingListItem,
  SettingsCard,
  WebhookContractDialog,
} from './settings-components'
import {
  GROK_REGISTER_REPOSITORY_URL,
  type SettingsForm,
  type SettingsSetter,
} from './settings-model'

export function SettingsIntegrationTab({
  form,
  settings,
  clearSecrets,
  profiles,
  profilesLoading,
  registerTokenReady,
  webhookUrl,
  set,
  toggleSecretClear,
}: {
  form: SettingsForm
  settings: RuntimeSettings
  clearSecrets: SecretSettingName[]
  profiles: ProbeProfile[]
  profilesLoading: boolean
  registerTokenReady: boolean
  webhookUrl: string
  set: SettingsSetter
  toggleSecretClear: (name: SecretSettingName) => void
}) {
  const automaticProbe = form.initialProbeOnRegister
  const priorityHold = automaticProbe && form.registerPriorityHoldEnabled
  const statusLabel = !registerTokenReady
    ? '等待配置令牌'
    : automaticProbe
      ? '自动探针已开启'
      : '仅接收事件'
  const statusVariant = !registerTokenReady
    ? 'warning'
    : automaticProbe
      ? 'success'
      : 'secondary'

  return (
    <div className='space-y-4'>
      <SettingsCard
        icon={Webhook}
        title='grok-register 自动联动'
        description='注册完成后自动投递账号导入事件，由监控端完成持久接收、账号匹配与首次探针调度。'
      >
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <Badge variant={statusVariant}>
              <Power />
              {statusLabel}
            </Badge>
            {priorityHold ? (
              <Badge variant='info'>导入后先降权</Badge>
            ) : null}
          </div>

          <div className='grid gap-2 md:grid-cols-2'>
            <a
              href={GROK_REGISTER_REPOSITORY_URL}
              target='_blank'
              rel='noopener noreferrer'
              className='group flex min-w-0 items-center gap-3 rounded-xl border bg-muted/15 p-3.5 shadow-xs transition-colors hover:border-primary/30 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
              aria-label='在 GitHub 新标签页打开 grok-register 项目'
            >
              <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background'>
                <IconGithub className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='text-sm font-medium'>查看配套注册项目</div>
                <div className='mt-0.5 truncate text-xs text-muted-foreground'>
                  github.com/kaibush/grok-register
                </div>
              </div>
              <ExternalLink className='size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground' />
            </a>
            <WebhookContractDialog />
          </div>

          <IntegrationFlow
            tokenConfigured={registerTokenReady}
            automaticProbe={automaticProbe}
            priorityHold={form.registerPriorityHoldEnabled}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={KeyRound}
        title='接入配置'
        description='令牌与 Webhook 地址用于建立两个项目之间的安全连接。'
      >
        <div className='grid gap-4 lg:grid-cols-2'>
          <SecretField
            name='grokRegisterWebhookToken'
            value={form.grokRegisterWebhookToken}
            settings={settings}
            clearing={clearSecrets.includes('grokRegisterWebhookToken')}
            onChange={(value) => set('grokRegisterWebhookToken', value)}
            onToggleClear={() => toggleSecretClear('grokRegisterWebhookToken')}
          />
          <Field
            label='Webhook 接收地址'
            hint='复制完整地址到注册机；请求头：x-grokiq-token'
          >
            <div className='flex h-9 min-w-0 items-center rounded-md border bg-muted/25 pl-3 shadow-xs'>
              <code
                className='min-w-0 flex-1 truncate text-xs text-muted-foreground'
                title={webhookUrl}
              >
                {webhookUrl}
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-8 shrink-0 rounded-sm'
                    onClick={() =>
                      void copyText(webhookUrl)
                        .then(() => toast.success('已复制完整 Webhook 地址'))
                        .catch((error) => toast.error(getErrorMessage(error)))
                    }
                    aria-label='复制完整 Webhook 地址'
                  >
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制完整地址</TooltipContent>
              </Tooltip>
            </div>
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Workflow}
        title='导入后处理'
        description='匹配到 grok2api 账号后，按顺序执行降权、稳定等待、首次探针和通过后恢复。'
      >
        <SettingList>
          <SettingListItem
            label='注册后创建探针'
            description='匹配账号后按稳定窗口等待，再补齐出口并加入持久队列。关闭后只接收导入事件。'
            checked={form.initialProbeOnRegister}
            onCheckedChange={(value) => set('initialProbeOnRegister', value)}
          >
            <div className='max-w-xs'>
              <NumberField
                label='新账号稳定等待'
                hint='Webhook 接收后延迟创建首次探针，用于等待模型权限传播；设为 0 可关闭。账号实际冷却时间仍会优先。'
                value={form.registerProbeStabilizationSeconds}
                min={0}
                max={300}
                step={1}
                suffix='秒'
                disabled={!automaticProbe}
                onChange={(value) =>
                  set('registerProbeStabilizationSeconds', value)
                }
              />
            </div>
          </SettingListItem>
          <SettingListItem
            label='注册后降低 grok2api 优先级'
            description='匹配到新账号后立即降低上游路由优先级，避免未验证账号进入生产流量。全部注册探针通过后恢复原值；恢复失败由联动后台定时重试，探针未通过则保持低优先级。'
            checked={form.registerPriorityHoldEnabled}
            disabled={!automaticProbe}
            onCheckedChange={(value) =>
              set('registerPriorityHoldEnabled', value)
            }
          >
            {priorityHold ? (
              <div className='max-w-xs'>
                <NumberField
                  label='注册账号临时优先级'
                  hint='需低于普通账号，默认 -1000000。探针通过后恢复为导入时记录的原值。'
                  value={form.registerPriorityHold}
                  min={-2000000000}
                  max={0}
                  step={1}
                  onChange={(value) => set('registerPriorityHold', value)}
                />
              </div>
            ) : null}
          </SettingListItem>
          <SettingListItem
            label='降智后换出口再测'
            description='注册探针出现降智信号后，自动改绑到另一个健康出口并再创建一个任务；已用过的出口不会重复选择。有可用替代出口时，自动隔离会延后到续测链结束。'
            checked={form.registerProbeSwitchOnDegradation}
            disabled={!automaticProbe}
            onCheckedChange={(value) =>
              set('registerProbeSwitchOnDegradation', value)
            }
          />
        </SettingList>
      </SettingsCard>

      <SettingsCard
        icon={Layers3}
        title='首次探针策略'
        description='选择新账号导入后使用的探针方案；执行方式和出口策略保持固定。'
        className={cn(!automaticProbe && 'opacity-70')}
      >
        <div className='space-y-4'>
          <Field label='探针方案' hint='可多选；每个方案分别生成一个持久任务'>
            <ProfileMultiSelect
              profiles={profiles}
              value={form.registerProbeProfileIds}
              onChange={(value) => set('registerProbeProfileIds', value)}
              enabledOnly
              disabled={profilesLoading || !automaticProbe}
              invalid={automaticProbe && !form.registerProbeProfileIds.length}
            />
          </Field>
          <div className='max-w-xs'>
            <NumberField
              label='每个方案执行轮数'
              hint='每个选中的探针方案都会按此次数执行；默认 3 轮，可设置 1–20 轮。'
              value={form.registerProbeRounds}
              min={1}
              max={20}
              step={1}
              suffix='轮'
              disabled={!automaticProbe}
              onChange={(value) => set('registerProbeRounds', value)}
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-3'>
            <FixedProbeSetting
              icon={MessageSquareText}
              label='执行方式'
              value='完整对话'
            />
            <FixedProbeSetting
              icon={Layers3}
              label='执行轮数'
              value={`每个方案 ${form.registerProbeRounds} 轮`}
            />
            <FixedProbeSetting
              icon={ShieldCheck}
              label='出口策略'
              value='账号当前绑定出口'
            />
          </div>
        </div>
      </SettingsCard>

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
    </div>
  )
}
