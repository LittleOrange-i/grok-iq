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
import { Switch } from '@/components/ui/switch'
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
  IntegrationPanel,
  NumberField,
  SecretField,
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
  return (
    <>
      <section className='overflow-hidden rounded-xl border bg-card shadow-sm'>
        <div className='grid gap-5 border-b bg-muted/15 p-5 md:p-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-center'>
          <div className='flex min-w-0 items-start gap-4'>
            <div className='flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-primary shadow-xs'>
              <Webhook className='size-5' />
            </div>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='text-base font-semibold'>
                  grok-register 自动联动
                </h2>
                <Badge
                  variant={
                    !registerTokenReady
                      ? 'warning'
                      : form.initialProbeOnRegister
                        ? 'success'
                        : 'secondary'
                  }
                >
                  <Power />
                  {!registerTokenReady
                    ? '等待配置令牌'
                    : form.initialProbeOnRegister
                      ? '自动探针已开启'
                      : '仅接收事件'}
                </Badge>
              </div>
              <p className='mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground'>
                注册完成后自动投递账号导入事件，由监控端完成持久接收、账号匹配与首次探针调度。
              </p>
            </div>
          </div>

          <div className='grid gap-2'>
            <a
              href={GROK_REGISTER_REPOSITORY_URL}
              target='_blank'
              rel='noopener noreferrer'
              className='group flex min-w-0 items-center gap-3 rounded-xl border bg-background p-3.5 shadow-xs transition-colors hover:border-primary/30 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
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
        </div>

        <IntegrationFlow
          tokenConfigured={registerTokenReady}
          automaticProbe={form.initialProbeOnRegister}
        />

        <div className='space-y-4 p-4 md:p-5'>
          <IntegrationPanel
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
                onToggleClear={() =>
                  toggleSecretClear('grokRegisterWebhookToken')
                }
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
                            .then(() =>
                              toast.success('已复制完整 Webhook 地址')
                            )
                            .catch((error) =>
                              toast.error(getErrorMessage(error))
                            )
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

            <div className='mt-4 max-w-xs'>
              <NumberField
                label='新账号稳定等待'
                hint='Webhook 接收后延迟创建首次探针，用于等待模型权限传播；设为 0 可关闭。账号实际冷却时间仍会优先。'
                value={form.registerProbeStabilizationSeconds}
                min={0}
                max={300}
                step={1}
                suffix='秒'
                onChange={(value) =>
                  set('registerProbeStabilizationSeconds', value)
                }
              />
            </div>

            <div
              className={cn(
                'mt-4 flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
                form.initialProbeOnRegister
                  ? 'border-primary/25 bg-primary/[0.035]'
                  : 'bg-muted/20'
              )}
            >
              <div className='flex min-w-0 items-start gap-3'>
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg',
                    form.initialProbeOnRegister
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Workflow className='size-4' />
                </div>
                <div className='min-w-0'>
                  <div className='text-sm font-medium'>注册后创建探针</div>
                  <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                    匹配账号后按上方稳定窗口等待，再补齐稳定出口并加入持久队列。
                  </p>
                  <div className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        form.initialProbeOnRegister
                          ? 'bg-emerald-500'
                          : 'bg-muted-foreground/50'
                      )}
                    />
                    {form.initialProbeOnRegister
                      ? '自动处理新导入账号'
                      : '仅持久接收导入事件'}
                  </div>
                </div>
              </div>
              <Switch
                checked={form.initialProbeOnRegister}
                onCheckedChange={(value) =>
                  set('initialProbeOnRegister', value)
                }
                aria-label='注册后创建探针'
              />
            </div>
          </IntegrationPanel>

          <IntegrationPanel
            icon={Layers3}
            title='首次探针策略'
            description='选择新账号导入后使用的探针方案，其他执行参数保持固定。'
          >
            <Field label='探针方案' hint='可多选；每个方案分别生成一个持久任务'>
              <ProfileMultiSelect
                profiles={profiles}
                value={form.registerProbeProfileIds}
                onChange={(value) => set('registerProbeProfileIds', value)}
                enabledOnly
                disabled={profilesLoading}
                invalid={
                  form.initialProbeOnRegister &&
                  !form.registerProbeProfileIds.length
                }
              />
            </Field>

            <div className='mt-4 grid divide-y overflow-hidden rounded-lg border sm:grid-cols-3 sm:divide-x sm:divide-y-0'>
              <FixedProbeSetting
                icon={MessageSquareText}
                label='执行方式'
                value='完整对话'
              />
              <FixedProbeSetting
                icon={Layers3}
                label='执行轮数'
                value='每个方案 3 轮'
              />
              <FixedProbeSetting
                icon={ShieldCheck}
                label='出口策略'
                value='账号当前绑定出口'
              />
            </div>
          </IntegrationPanel>
        </div>
      </section>

      <section className='rounded-xl border bg-card p-4 shadow-sm md:p-5'>
        <div className='mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-3'>
            <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
              <ServerCog className='size-4' />
            </div>
            <div>
              <h2 className='text-sm font-semibold'>启动级参数</h2>
              <p className='mt-1 text-xs text-muted-foreground'>
                由容器或环境变量提供，只读展示当前进程实际值。
              </p>
            </div>
          </div>
          <Badge variant='warning'>修改后重启生效</Badge>
        </div>
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
      </section>
    </>
  )
}
