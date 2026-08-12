import { Fragment, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  BellRing,
  Check,
  CheckCheck,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  Gauge,
  Inbox,
  KeyRound,
  Layers3,
  Link2,
  MessageSquareText,
  Network,
  Power,
  RefreshCw,
  Route,
  Save,
  Send,
  ServerCog,
  ShieldCheck,
  TestTube2,
  TriangleAlert,
  Webhook,
  Workflow,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  type EditableRuntimeSettings,
  type RuntimeSettings,
  type RuntimeSettingsUpdate,
  type SecretSettingName,
  type ExecutionMode,
  type ProxyTarget,
} from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { cn, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'
import { ProfileMultiSelect } from '@/features/monitor/components/profile-multi-select'

type SettingsForm = {
  grok2apiBaseUrl: string
  grok2apiAdminUsername: string
  grok2apiAdminPassword: string
  grok2apiHttpImpersonate: string
  grokRegisterWebhookToken: string
  initialProbeOnRegister: boolean
  registerProbeProfileIds: string[]
  registerProbeExecutionMode: ExecutionMode
  registerProbeRounds: number
  registerProbeProxyTargets: ProxyTarget[]
  wechatNotificationEnabled: boolean
  wechatAppId: string
  wechatAppSecret: string
  wechatOpenid: string
  wechatTemplateId: string
  probeWorkerConcurrency: number
  probeQueueLimit: number
  probeStepDelaySeconds: number
  probeCurrentEgressIntervalSeconds: number
  probeTransientRetryAttempts: number
  probeTransientRetryBaseSeconds: number
  probeTransientRetryMaxSeconds: number
  probeRoutePrefix: string
  probeDiagnosticPriority: number
  analysisWindowHours: number
  degradationTps: number
  strongDegradationTps: number
  consecutiveAnomalies: number
  crossEgressMin: number
  bufferFirstTokenShare: number
  minGenerationMs: number
  minimumOutputTokens: number
  autoQuarantine: boolean
  quarantineMinutes: number
}

const secretMetadata: Record<
  SecretSettingName,
  { label: string; placeholder: string; configuredKey: keyof RuntimeSettings }
> = {
  grok2apiAdminPassword: {
    label: '管理员密码',
    placeholder: '留空保持当前密码',
    configuredKey: 'grok2apiAdminPasswordConfigured',
  },
  grokRegisterWebhookToken: {
    label: 'grok-register 联动令牌',
    placeholder: '留空保持当前令牌',
    configuredKey: 'grokRegisterWebhookTokenConfigured',
  },
  wechatAppSecret: {
    label: '微信 AppSecret',
    placeholder: '留空保持当前 AppSecret',
    configuredKey: 'wechatAppSecretConfigured',
  },
}

const REGISTER_WEBHOOK_PATH = '/api/integrations/grok-register/account-imported'
const REGISTER_WEBHOOK_MINIMAL_BODY = `{
  "email": "user@example.com"
}`
const REGISTER_WEBHOOK_RECOMMENDED_BODY = `{
  "event_id": "registration:123:grok2api-imported",
  "email": "user@example.com"
}`
const WECHAT_TEMPLATE_BODY = `{{first.DATA}}
账号：{{account.DATA}}
状态：{{status.DATA}}
风险分：{{score.DATA}}
TPS：{{tps.DATA}}
原因：{{reason.DATA}}
时间：{{time.DATA}}
{{remark.DATA}}`

function registerWebhookUrl() {
  if (typeof window === 'undefined') return REGISTER_WEBHOOK_PATH
  return new URL(REGISTER_WEBHOOK_PATH, window.location.origin).toString()
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['settings', 'editor'],
    queryFn: api.editableSettings,
  })
  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 15_000,
  })
  const profiles = useQuery({
    queryKey: ['probe-profiles'],
    queryFn: api.profiles,
  })
  const egress = useQuery({
    queryKey: ['egress-nodes', 'register-policy'],
    queryFn: () => api.egress({ pageSize: 500 }),
  })
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [clearSecrets, setClearSecrets] = useState<SecretSettingName[]>([])

  useEffect(() => {
    if (!settings.data) return
    // The query result is the external source for this editable draft. A refetch
    // intentionally replaces unsaved fields so the page never edits stale runtime settings.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(toSettingsForm(settings.data))
    setClearSecrets([])
  }, [settings.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form || !settings.data) throw new Error('设置尚未加载')
      const submittedForm = form
      const submittedClearSecrets = [...clearSecrets]
      validateSettings(submittedForm)
      const value = await api.updateSettings(
        buildSettingsPayload(
          submittedForm,
          submittedClearSecrets,
          settings.data
        )
      )
      return { value, submittedForm, submittedClearSecrets }
    },
    onSuccess: ({ value, submittedForm, submittedClearSecrets }) => {
      const editableValue = mergeEditableSettings(
        value,
        submittedForm,
        submittedClearSecrets
      )
      queryClient.setQueryData(['settings'], value)
      queryClient.setQueryData(['settings', 'editor'], editableValue)
      setForm(toSettingsForm(editableValue))
      setClearSecrets([])
      toast.success('运行时设置已保存并热应用')
      void queryClient.invalidateQueries({ queryKey: ['health'] })
      void queryClient.invalidateQueries({ queryKey: ['scheduler'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!form || !settings.data) throw new Error('设置尚未加载')
      validateSettings(form)
      const value = await api.updateSettings(
        buildSettingsPayload(form, clearSecrets, settings.data)
      )
      queryClient.setQueryData(['settings'], value)
      return api.testGrok2api()
    },
    onSuccess: (result) => {
      setClearSecrets([])
      toast.success(`连接测试通过：${result.baseUrl}`)
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['health'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const wechatTestMutation = useMutation({
    mutationFn: async () => {
      if (!form || !settings.data) throw new Error('设置尚未加载')
      const submittedForm = form
      const submittedClearSecrets = [...clearSecrets]
      validateSettings(submittedForm)
      const value = await api.updateSettings(
        buildSettingsPayload(
          submittedForm,
          submittedClearSecrets,
          settings.data
        )
      )
      queryClient.setQueryData(['settings'], value)
      const result = await api.testWechat()
      return { value, submittedForm, submittedClearSecrets, result }
    },
    onSuccess: ({ value, submittedForm, submittedClearSecrets, result }) => {
      const editableValue = mergeEditableSettings(
        value,
        submittedForm,
        submittedClearSecrets
      )
      queryClient.setQueryData(['settings', 'editor'], editableValue)
      setForm(toSettingsForm(editableValue))
      setClearSecrets([])
      toast.success(`微信测试消息已发送给 ${result.sent} 个接收人`)
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  if (settings.isError) {
    return (
      <Page>
        <EmptyState
          title='设置加载失败'
          description={getErrorMessage(settings.error)}
        />
      </Page>
    )
  }

  if (settings.isLoading || !settings.data || !form) {
    return (
      <Page>
        <LoadingState label='正在加载运行时配置' />
      </Page>
    )
  }

  const settingsValue = settings.data
  const webhookUrl = registerWebhookUrl()
  const upstream = (health.data?.upstream ?? {}) as Record<string, unknown>
  const integration = (health.data?.integration ?? {}) as Record<
    string,
    unknown
  >
  const registerTokenReady =
    !clearSecrets.includes('grokRegisterWebhookToken') &&
    (Boolean(form.grokRegisterWebhookToken.trim()) ||
      settingsValue.grokRegisterWebhookTokenConfigured)
  const busy =
    saveMutation.isPending ||
    testMutation.isPending ||
    wechatTestMutation.isPending
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const toggleSecretClear = (name: SecretSettingName) => {
    setClearSecrets((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
    const field = name as keyof Pick<
      SettingsForm,
      | 'grok2apiAdminPassword'
      | 'grokRegisterWebhookToken'
      | 'wechatAppSecret'
    >
    set(field, '' as SettingsForm[typeof field])
  }
  const availableEgress = (egress.data?.items ?? []).filter(
    (node) => node.enabled && node.proxyConfigured
  )
  const enabledProfiles = (profiles.data ?? []).filter(
    (profile) => profile.enabled
  )
  const quickProfile =
    enabledProfiles.find((profile) => profile.id === 'quality-marker') ??
    enabledProfiles[0]
  const availableEgressIdSet = new Set(
    availableEgress.map((node) => Number(node.id))
  )
  const currentSelected = form.registerProbeProxyTargets.some(
    (target) => target.kind === 'current'
  )
  const directSelected = form.registerProbeProxyTargets.some(
    (target) => target.kind === 'direct'
  )
  const selectedEgressIds = new Set(
    form.registerProbeProxyTargets
      .filter((target) => target.kind === 'egress' && target.id != null)
      .map((target) => Number(target.id))
  )
  const unavailableSelectedEgressIds = Array.from(selectedEgressIds).filter(
    (id) => !availableEgressIdSet.has(id)
  )
  const allAvailableEgressSelected =
    availableEgress.length > 0 &&
    availableEgress.every((node) => selectedEgressIds.has(Number(node.id)))
  const setCurrentTarget = () => {
    set('registerProbeProxyTargets', [{ kind: 'current', id: null }])
  }
  const setDirectTarget = (checked: boolean) => {
    const diagnosticTargets = form.registerProbeProxyTargets.filter(
      (target) => target.kind === 'egress'
    )
    set(
      'registerProbeProxyTargets',
      checked
        ? [{ kind: 'direct', id: null }, ...diagnosticTargets]
        : diagnosticTargets
    )
  }
  const toggleEgressTarget = (id: number, checked: boolean) => {
    const remaining = form.registerProbeProxyTargets.filter(
      (target) =>
        target.kind !== 'current' &&
        !(target.kind === 'egress' && Number(target.id) === id)
    )
    set(
      'registerProbeProxyTargets',
      checked ? [...remaining, { kind: 'egress', id }] : remaining
    )
  }
  const toggleAllEgressTargets = () => {
    const diagnosticDirectTargets = form.registerProbeProxyTargets.filter(
      (target) => target.kind === 'direct'
    )
    set(
      'registerProbeProxyTargets',
      allAvailableEgressSelected
        ? diagnosticDirectTargets
        : [
            ...diagnosticDirectTargets,
            ...availableEgress.map((node) => ({
              kind: 'egress' as const,
              id: Number(node.id),
            })),
          ]
    )
  }
  const removeUnavailableEgressTargets = () => {
    set(
      'registerProbeProxyTargets',
      form.registerProbeProxyTargets.filter(
        (target) =>
          target.kind !== 'egress' ||
          (target.id != null && availableEgressIdSet.has(Number(target.id)))
      )
    )
  }
  const setRegisterExecutionMode = (value: ExecutionMode) => {
    setForm((current) => {
      if (!current) return current
      const currentEgress = current.registerProbeProxyTargets.filter(
        (target) => target.kind === 'egress'
      )
      if (value === 'quality_test') {
        return {
          ...current,
          registerProbeExecutionMode: value,
          registerProbeProfileIds: quickProfile
            ? [quickProfile.id]
            : current.registerProbeProfileIds,
          registerProbeProxyTargets: currentEgress.length
            ? currentEgress
            : availableEgress.map((node) => ({
                kind: 'egress' as const,
                id: Number(node.id),
              })),
        }
      }
      return {
        ...current,
        registerProbeExecutionMode: value,
        registerProbeProxyTargets: [{ kind: 'current', id: null }],
      }
    })
  }

  return (
    <Page>
      <PageHeader
        title='系统设置'
        description='除启动监听、数据库路径和 CORS 外，连接、队列及风险参数均可在此保存并热应用。'
        actions={
          <ActionToolbar label='系统设置操作'>
            <ToolbarAction
              label='保存设置并测试 grok2api 连接'
              disabled={busy}
              pending={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              <TestTube2 />
            </ToolbarAction>
            <ToolbarAction
              label='保存并热应用设置'
              disabled={busy}
              pending={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save />
            </ToolbarAction>
          </ActionToolbar>
        }
      />

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        <StatusCard
          icon={Network}
          label='grok2api'
          value={upstream.available ? '连接正常' : '连接异常'}
          detail={form.grok2apiBaseUrl}
          healthy={upstream.available === true}
        />
        <StatusCard
          icon={KeyRound}
          label='管理鉴权'
          value={integration.adminConfigured ? '已配置' : '待配置'}
          detail='管理员用户名和密码 · 会话自动刷新'
          healthy={integration.adminConfigured === true}
        />
        <StatusCard
          icon={Activity}
          label='任务 Worker'
          value={`${form.probeWorkerConcurrency} 个`}
          detail={`不同账号并行 · 队列容量 ${form.probeQueueLimit}`}
          healthy
        />
      </div>

      <Tabs defaultValue='connection' className='space-y-4'>
        <TabsList className='h-auto w-full justify-start overflow-x-auto bg-muted/60 p-1'>
          <TabsTrigger value='connection'>连接与凭据</TabsTrigger>
          <TabsTrigger value='execution'>任务队列</TabsTrigger>
          <TabsTrigger value='risk'>风险与隔离</TabsTrigger>
          <TabsTrigger value='notifications'>通知推送</TabsTrigger>
          <TabsTrigger value='integration'>联动与启动项</TabsTrigger>
        </TabsList>

        <TabsContent value='connection' className='space-y-4'>
          <SettingsCard
            icon={Network}
            title='grok2api 连接'
            description='账号和出口始终实时读取上游；本项目仅持有访问上游所需的连接参数。'
          >
            <div className='grid gap-4 lg:grid-cols-2'>
              <Field label='服务地址' hint='包含协议与端口，不需要末尾斜杠'>
                <Input
                  value={form.grok2apiBaseUrl}
                  onChange={(event) =>
                    set('grok2apiBaseUrl', event.target.value)
                  }
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
                settings={settingsValue}
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
        </TabsContent>

        <TabsContent value='execution'>
          <SettingsCard
            icon={Workflow}
            title='持久任务队列'
            description='短周期 Cron 只创建受容量限制的持久任务，由固定 Worker 拉取；同账号始终串行。'
          >
            <div className='grid gap-4 sm:grid-cols-2'>
              <NumberField
                label='Worker 并发数'
                hint='表示可同时处理的不同账号数；同一账号的任务保持串行'
                value={form.probeWorkerConcurrency}
                min={1}
                max={32}
                onChange={(value) => set('probeWorkerConcurrency', value)}
              />
              <NumberField
                label='全局队列上限'
                hint='批量入队超过剩余容量时整批保持不变'
                value={form.probeQueueLimit}
                min={1}
                max={100000}
                onChange={(value) => set('probeQueueLimit', value)}
              />
              <NumberField
                label='步骤间隔（秒）'
                value={form.probeStepDelaySeconds}
                min={0}
                max={60}
                step={0.1}
                onChange={(value) => set('probeStepDelaySeconds', value)}
              />
              <NumberField
                label='正常定检启动间隔（秒）'
                hint='跨全部 Worker 生效；只限制账号当前出口 Chat，0 表示关闭'
                value={form.probeCurrentEgressIntervalSeconds}
                min={0}
                max={300}
                step={0.5}
                onChange={(value) =>
                  set('probeCurrentEgressIntervalSeconds', value)
                }
              />
              <NumberField
                label='暂时不可调度重试次数'
                hint='仅对冷却、网络和容量类错误重试；不把它们算作降智'
                value={form.probeTransientRetryAttempts}
                min={0}
                max={5}
                onChange={(value) => set('probeTransientRetryAttempts', value)}
              />
              <NumberField
                label='重试基础等待（秒）'
                value={form.probeTransientRetryBaseSeconds}
                min={0.1}
                max={60}
                step={0.1}
                onChange={(value) =>
                  set('probeTransientRetryBaseSeconds', value)
                }
              />
              <NumberField
                label='重试最大等待（秒）'
                value={form.probeTransientRetryMaxSeconds}
                min={0.1}
                max={300}
                step={0.1}
                onChange={(value) =>
                  set('probeTransientRetryMaxSeconds', value)
                }
              />
              <Field
                label='临时资源前缀'
                hint='2-48 位字母、数字、下划线或连字符'
              >
                <Input
                  value={form.probeRoutePrefix}
                  onChange={(event) =>
                    set('probeRoutePrefix', event.target.value)
                  }
                />
              </Field>
              <NumberField
                label='诊断优先级'
                hint='停用账号短时激活时使用；保持低于普通账号'
                value={form.probeDiagnosticPriority}
                min={-2000000000}
                max={0}
                onChange={(value) => set('probeDiagnosticPriority', value)}
              />
            </div>
            <div className='mt-4 rounded-lg border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground'>
              账号级并发固定为
              1。正常定检启动间隔在所有 Worker 之间共享，用于降低短时间账号扩散；Monitor
              无法获知 Resin 最终物理 IP，因此该间隔不等同于每 IP 精确限流。
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value='risk' className='grid gap-4 xl:grid-cols-2'>
          <SettingsCard
            icon={Activity}
            title='降智信号判定'
            description='结合 TPS、首 Token 占比、生成窗口、输出量和自动校验标记，判断每轮是否记录降智信号。'
          >
            <div className='grid gap-4 sm:grid-cols-2'>
              <NumberField
                label='分析窗口（小时）'
                value={form.analysisWindowHours}
                min={1}
                max={8760}
                onChange={(value) => set('analysisWindowHours', value)}
              />
              <NumberField
                label='最低输出 Token'
                value={form.minimumOutputTokens}
                min={1}
                max={4096}
                onChange={(value) => set('minimumOutputTokens', value)}
              />
              <NumberField
                label='降智信号 TPS 下限'
                hint='某轮达到或超过该值，即记录 1 次疑似降智'
                value={form.degradationTps}
                min={0.1}
                step={0.1}
                onChange={(value) => set('degradationTps', value)}
              />
              <NumberField
                label='强降智信号 TPS 下限'
                hint='某轮达到或超过该值，即记录 1 次强降智信号'
                value={form.strongDegradationTps}
                min={0.1}
                step={0.1}
                onChange={(value) => set('strongDegradationTps', value)}
              />
              <NumberField
                label='首 Token 占比'
                value={form.bufferFirstTokenShare}
                min={0.5}
                max={0.99}
                step={0.01}
                onChange={(value) => set('bufferFirstTokenShare', value)}
              />
              <NumberField
                label='最短生成窗口（ms）'
                value={form.minGenerationMs}
                min={1}
                max={60000}
                onChange={(value) => set('minGenerationMs', value)}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            icon={ShieldCheck}
            title='跨出口风险与自动隔离'
            description='同一账号的降智信号在多个出口重复出现后提升风险，可选择同步暂时停用上游账号。'
          >
            <div className='grid gap-4 sm:grid-cols-2'>
              <NumberField
                label='连续降智信号次数'
                value={form.consecutiveAnomalies}
                min={2}
                max={20}
                onChange={(value) => set('consecutiveAnomalies', value)}
              />
              <NumberField
                label='最少不同出口数'
                value={form.crossEgressMin}
                min={1}
                max={20}
                onChange={(value) => set('crossEgressMin', value)}
              />
              <div className='sm:col-span-2'>
                <SwitchRow
                  label='自动暂时停用高风险账号'
                  description='达到跨出口判定条件后，通过 grok2api 管理 API 传播停用状态'
                  checked={form.autoQuarantine}
                  onCheckedChange={(value) => set('autoQuarantine', value)}
                />
              </div>
              <NumberField
                label='停用时长（分钟）'
                hint='自动隔离和账号详情中的“暂时停用”共用；到期后自动启用并降至最低优先级'
                value={form.quarantineMinutes}
                min={1}
                max={10080}
                disabled={!form.autoQuarantine}
                onChange={(value) => set('quarantineMinutes', value)}
              />
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value='notifications' className='space-y-4'>
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
                onCheckedChange={(value) =>
                  set('wechatNotificationEnabled', value)
                }
              />

              <div className='grid gap-4 lg:grid-cols-2'>
                <Field
                  label='测试公众号 AppID'
                  hint='微信测试公众号后台的 appID'
                >
                  <Input
                    value={form.wechatAppId}
                    onChange={(event) =>
                      set('wechatAppId', event.target.value)
                    }
                    placeholder='wxxxxxxxxxxxxxxxxxxxxxxxx'
                    autoComplete='off'
                  />
                </Field>
                <SecretField
                  name='wechatAppSecret'
                  value={form.wechatAppSecret}
                  settings={settingsValue}
                  clearing={clearSecrets.includes('wechatAppSecret')}
                  onChange={(value) => set('wechatAppSecret', value)}
                  onToggleClear={() => toggleSecretClear('wechatAppSecret')}
                />
                <Field
                  label='接收人 OpenID'
                  hint='微信测试公众号用户列表中的 OpenID'
                >
                  <Input
                    value={form.wechatOpenid}
                    onChange={(event) =>
                      set('wechatOpenid', event.target.value)
                    }
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
                    onChange={(event) =>
                      set('wechatTemplateId', event.target.value)
                    }
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
                          .catch((error) =>
                            toast.error(getErrorMessage(error))
                          )
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
                  onClick={() => wechatTestMutation.mutate()}
                >
                  <Send />
                  {wechatTestMutation.isPending
                    ? '正在发送测试消息…'
                    : '保存并发送测试消息'}
                </Button>
                {!form.wechatNotificationEnabled && (
                  <span className='text-xs text-muted-foreground'>
                    先开启推送开关并保存，系统才会发送消息。
                  </span>
                )}
              </div>
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value='integration' className='space-y-4'>
          <Card className='gap-0 overflow-hidden py-0 shadow-none'>
            <CardHeader className='border-b bg-muted/15 px-5 py-5 md:px-6'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                <div className='flex min-w-0 items-start gap-3'>
                  <div className='flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary shadow-xs'>
                    <Webhook className='size-5' />
                  </div>
                  <div className='min-w-0'>
                    <CardTitle className='text-base'>
                      grok-register 自动联动
                    </CardTitle>
                    <CardDescription className='mt-1 max-w-3xl leading-5'>
                      注册机只投递账号导入事件；监控端负责账号匹配、持久接收和后续探针调度。
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant={
                    !registerTokenReady
                      ? 'warning'
                      : form.initialProbeOnRegister
                        ? 'success'
                        : 'secondary'
                  }
                  className='h-6 self-start'
                >
                  <Power />
                  {!registerTokenReady
                    ? '等待配置令牌'
                    : form.initialProbeOnRegister
                      ? '自动探针已开启'
                      : '仅接收事件'}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className='p-0'>
              <IntegrationFlow
                tokenConfigured={registerTokenReady}
                automaticProbe={form.initialProbeOnRegister}
              />

              <IntegrationSection
                icon={KeyRound}
                eyebrow='接入配置'
                title='Webhook 与自动处理'
                description='令牌在两个项目中保持一致即可建立接入；关闭自动探针时仍会持久记录导入事件。'
              >
                <div className='grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]'>
                  <div className='grid content-start gap-4 lg:grid-cols-2'>
                    <SecretField
                      name='grokRegisterWebhookToken'
                      value={form.grokRegisterWebhookToken}
                      settings={settingsValue}
                      clearing={clearSecrets.includes(
                        'grokRegisterWebhookToken'
                      )}
                      onChange={(value) =>
                        set('grokRegisterWebhookToken', value)
                      }
                      onToggleClear={() =>
                        toggleSecretClear('grokRegisterWebhookToken')
                      }
                    />
                    <Field
                      label='Webhook 接收地址'
                      hint='复制完整地址到注册机；请求头：x-monitor-token'
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

                  <div
                    className={cn(
                      'flex min-h-36 flex-col justify-between rounded-xl border p-4 transition-colors',
                      form.initialProbeOnRegister
                        ? 'border-primary/25 bg-primary/[0.035]'
                        : 'bg-muted/20'
                    )}
                  >
                    <div className='flex items-start justify-between gap-4'>
                      <div className='flex items-start gap-3'>
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
                        <div>
                          <div className='text-sm font-medium'>
                            注册后创建探针
                          </div>
                          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                            匹配上游账号后，按默认策略自动加入持久队列。
                          </p>
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
                    <div className='mt-4 flex items-center gap-2 text-xs text-muted-foreground'>
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          form.initialProbeOnRegister
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/50'
                        )}
                      />
                      {form.initialProbeOnRegister
                        ? '新账号匹配成功后自动入队'
                        : '事件入库后结束，不创建探针任务'}
                    </div>
                  </div>
                </div>

                <WebhookContract />
              </IntegrationSection>

              <IntegrationSection
                icon={Layers3}
                eyebrow='默认策略'
                title='新账号首次探针'
                description='该策略只由监控端维护，注册机无需了解方案、轮次或出口节点。'
                className='border-t'
              >
                <div className='space-y-5'>
                  <div className='grid gap-3 lg:grid-cols-2'>
                    <ModeOption
                      icon={MessageSquareText}
                      title='完整对话探针'
                      description='调用聊天接口；默认保持账号当前出口，诊断时才临时切换。'
                      meta='多方案 · 完整响应'
                      selected={form.registerProbeExecutionMode === 'chat'}
                      onSelect={() => setRegisterExecutionMode('chat')}
                    />
                    <ModeOption
                      icon={Gauge}
                      title='快速出口质量'
                      description='使用质量基线快速验证固定出口，适合首次筛查。'
                      meta={
                        !availableEgress.length || !quickProfile
                          ? '缺少可用出口或基线'
                          : '固定出口 · 快速筛查'
                      }
                      selected={
                        form.registerProbeExecutionMode === 'quality_test'
                      }
                      disabled={!availableEgress.length || !quickProfile}
                      onSelect={() => setRegisterExecutionMode('quality_test')}
                    />
                  </div>

                  <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_12rem]'>
                    {form.registerProbeExecutionMode === 'chat' ? (
                      <Field
                        label='探针方案'
                        hint='可多选；每个方案分别生成一个持久任务'
                      >
                        <ProfileMultiSelect
                          profiles={profiles.data ?? []}
                          value={form.registerProbeProfileIds}
                          onChange={(value) =>
                            set('registerProbeProfileIds', value)
                          }
                          enabledOnly
                          disabled={profiles.isLoading}
                          invalid={
                            form.initialProbeOnRegister &&
                            !form.registerProbeProfileIds.length
                          }
                        />
                      </Field>
                    ) : (
                      <Field
                        label='快速质量基线'
                        hint='快速模式自动使用当前已启用基线'
                      >
                        <div className='flex h-9 min-w-0 items-center gap-3 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 shadow-xs'>
                          <Gauge className='size-4 shrink-0 text-sky-600 dark:text-sky-400' />
                          <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                            {quickProfile?.name ?? '暂无可用基线'}
                          </span>
                          {quickProfile && (
                            <span className='shrink-0 text-xs text-muted-foreground'>
                              {quickProfile.model}
                            </span>
                          )}
                        </div>
                      </Field>
                    )}
                    <NumberField
                      label='每个出口轮数'
                      hint='1–20 轮'
                      value={form.registerProbeRounds}
                      min={1}
                      max={20}
                      onChange={(value) => set('registerProbeRounds', value)}
                    />
                  </div>

                  <div className='overflow-hidden rounded-xl border'>
                    <div className='flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
                      <div className='flex min-w-0 items-center gap-3'>
                        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-xs ring-1 ring-border'>
                          <Route className='size-4' />
                        </div>
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='text-sm font-medium'>
                              出口目标
                            </span>
                            {currentSelected &&
                              form.registerProbeExecutionMode === 'chat' && (
                                <Badge variant='success'>正常定检</Badge>
                              )}
                            {directSelected &&
                              form.registerProbeExecutionMode === 'chat' && (
                                <Badge variant='warning'>上游调度诊断</Badge>
                              )}
                            <Badge variant='outline'>
                              {selectedEgressIds.size} 个固定出口
                            </Badge>
                          </div>
                          <p className='mt-0.5 text-xs text-muted-foreground'>
                            账号当前出口与诊断出口互斥；自动首次探针推荐使用正常定检。
                          </p>
                        </div>
                      </div>
                      <div className='flex shrink-0 items-center gap-1 self-end sm:self-auto'>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type='button'
                              size='icon'
                              variant='ghost'
                              className='size-8'
                              disabled={egress.isFetching}
                              onClick={() => void egress.refetch()}
                              aria-label='刷新出口节点'
                            >
                              <RefreshCw
                                className={cn(
                                  'size-4',
                                  egress.isFetching && 'animate-spin'
                                )}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>刷新出口节点</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type='button'
                              size='icon'
                              variant='ghost'
                              className='size-8'
                              disabled={!availableEgress.length}
                              onClick={toggleAllEgressTargets}
                              aria-label={
                                allAvailableEgressSelected
                                  ? '清空固定出口'
                                  : '全选固定出口'
                              }
                            >
                              {allAvailableEgressSelected ? (
                                <X className='size-4' />
                              ) : (
                                <CheckCheck className='size-4' />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {allAvailableEgressSelected
                              ? '清空固定出口'
                              : '全选固定出口'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {egress.isError && (
                      <div className='mx-3 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive'>
                        <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                        <span>{getErrorMessage(egress.error)}</span>
                      </div>
                    )}
                    {unavailableSelectedEgressIds.length > 0 && (
                      <div className='mx-3 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300'>
                        <div className='flex min-w-0 items-start gap-2'>
                          <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                          <span className='break-all'>
                            节点 {unavailableSelectedEgressIds.join(', ')}
                            当前不可用
                          </span>
                        </div>
                        <Button
                          type='button'
                          size='sm'
                          variant='ghost'
                          className='h-7 shrink-0 px-2 text-xs'
                          onClick={removeUnavailableEgressTargets}
                        >
                          <X />
                          移除
                        </Button>
                      </div>
                    )}

                    <div className='grid max-h-72 gap-2 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3'>
                      {form.registerProbeExecutionMode === 'chat' && (
                        <EgressOption
                          icon={ShieldCheck}
                          title='账号当前出口'
                          detail='正常定检，不修改账号绑定'
                          selected={currentSelected}
                          onToggle={setCurrentTarget}
                        />
                      )}
                      {form.registerProbeExecutionMode === 'chat' && (
                        <EgressOption
                          icon={Route}
                          title='上游调度（诊断）'
                          detail='临时解除账号固定绑定'
                          selected={directSelected}
                          onToggle={() => setDirectTarget(!directSelected)}
                        />
                      )}
                      {availableEgress.map((node) => {
                        const id = Number(node.id)
                        return (
                          <EgressOption
                            key={node.id}
                            icon={Network}
                            title={node.name}
                            detail={`诊断出口 · ${node.exitIp || `节点 #${id}`}`}
                            selected={selectedEgressIds.has(id)}
                            onToggle={() =>
                              toggleEgressTarget(id, !selectedEgressIds.has(id))
                            }
                          />
                        )
                      })}
                    </div>

                    {!egress.isLoading && !availableEgress.length && (
                      <div className='m-3 flex items-start gap-3 rounded-lg border border-dashed p-3'>
                        <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-500' />
                        <p className='text-xs leading-5 text-muted-foreground'>
                          当前没有已启用且已配置代理的 grok_build
                          诊断出口；正常定检仍可使用账号当前绑定。
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </IntegrationSection>
            </CardContent>
          </Card>

          <Card className='gap-0 overflow-hidden py-0 shadow-none'>
            <CardHeader className='border-b px-5 py-4 md:px-6'>
              <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
                    <ServerCog className='size-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm'>启动级参数</CardTitle>
                    <CardDescription className='mt-1 text-xs'>
                      由容器或环境变量提供，只读展示当前进程实际值。
                    </CardDescription>
                  </div>
                </div>
                <Badge variant='warning'>修改后重启生效</Badge>
              </div>
            </CardHeader>
            <CardContent className='p-4 md:p-5'>
              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                <BootstrapSetting
                  label='监听地址'
                  value={settingsValue.bootstrap.host}
                />
                <BootstrapSetting
                  label='监听端口'
                  value={String(settingsValue.bootstrap.port)}
                />
                <BootstrapSetting
                  label='数据库路径'
                  value={settingsValue.bootstrap.databasePath}
                  mono
                />
                <BootstrapSetting
                  label='CORS Origins'
                  value={settingsValue.bootstrap.corsOrigins.join(', ') || '—'}
                  mono
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  )
}

function toSettingsForm(settings: EditableRuntimeSettings): SettingsForm {
  return {
    grok2apiBaseUrl: settings.grok2apiBaseUrl,
    grok2apiAdminUsername: settings.grok2apiAdminUsername,
    grok2apiAdminPassword: settings.grok2apiAdminPassword,
    grok2apiHttpImpersonate: settings.grok2apiHttpImpersonate,
    grokRegisterWebhookToken: settings.grokRegisterWebhookToken,
    initialProbeOnRegister: settings.initialProbeOnRegister,
    registerProbeProfileIds: settings.registerProbeProfileIds,
    registerProbeExecutionMode: settings.registerProbeExecutionMode,
    registerProbeRounds: settings.registerProbeRounds,
    registerProbeProxyTargets: settings.registerProbeProxyTargets,
    wechatNotificationEnabled: settings.wechatNotificationEnabled,
    wechatAppId: settings.wechatAppId,
    wechatAppSecret: settings.wechatAppSecret,
    wechatOpenid: settings.wechatOpenid,
    wechatTemplateId: settings.wechatTemplateId,
    probeWorkerConcurrency: settings.probeWorkerConcurrency,
    probeQueueLimit: settings.probeQueueLimit,
    probeStepDelaySeconds: settings.probeStepDelaySeconds,
    probeCurrentEgressIntervalSeconds:
      settings.probeCurrentEgressIntervalSeconds ?? 10,
    probeTransientRetryAttempts: settings.probeTransientRetryAttempts ?? 2,
    probeTransientRetryBaseSeconds:
      settings.probeTransientRetryBaseSeconds ?? 5,
    probeTransientRetryMaxSeconds: settings.probeTransientRetryMaxSeconds ?? 30,
    probeRoutePrefix: settings.probeRoutePrefix,
    probeDiagnosticPriority: settings.probeDiagnosticPriority,
    analysisWindowHours: settings.analysisWindowHours,
    degradationTps: settings.degradationTps,
    strongDegradationTps: settings.strongDegradationTps,
    consecutiveAnomalies: settings.consecutiveAnomalies,
    crossEgressMin: settings.crossEgressMin,
    bufferFirstTokenShare: settings.bufferFirstTokenShare,
    minGenerationMs: settings.minGenerationMs,
    minimumOutputTokens: settings.minimumOutputTokens,
    autoQuarantine: settings.autoQuarantine,
    quarantineMinutes: settings.quarantineMinutes,
  }
}

function buildSettingsPayload(
  form: SettingsForm,
  clearSecrets: SecretSettingName[],
  original: EditableRuntimeSettings
): RuntimeSettingsUpdate {
  const payload: RuntimeSettingsUpdate = {
    grok2apiBaseUrl: form.grok2apiBaseUrl.trim(),
    grok2apiAdminUsername: form.grok2apiAdminUsername.trim(),
    grok2apiHttpImpersonate: form.grok2apiHttpImpersonate.trim(),
    initialProbeOnRegister: form.initialProbeOnRegister,
    registerProbeProfileIds: form.registerProbeProfileIds,
    registerProbeExecutionMode: form.registerProbeExecutionMode,
    registerProbeRounds: form.registerProbeRounds,
    registerProbeProxyTargets: form.registerProbeProxyTargets,
    wechatNotificationEnabled: form.wechatNotificationEnabled,
    wechatAppId: form.wechatAppId.trim(),
    wechatOpenid: form.wechatOpenid.trim(),
    wechatTemplateId: form.wechatTemplateId.trim(),
    probeWorkerConcurrency: form.probeWorkerConcurrency,
    probeQueueLimit: form.probeQueueLimit,
    probeStepDelaySeconds: form.probeStepDelaySeconds,
    probeCurrentEgressIntervalSeconds:
      form.probeCurrentEgressIntervalSeconds,
    probeTransientRetryAttempts: form.probeTransientRetryAttempts,
    probeTransientRetryBaseSeconds: form.probeTransientRetryBaseSeconds,
    probeTransientRetryMaxSeconds: form.probeTransientRetryMaxSeconds,
    probeRoutePrefix: form.probeRoutePrefix.trim(),
    probeDiagnosticPriority: form.probeDiagnosticPriority,
    analysisWindowHours: form.analysisWindowHours,
    degradationTps: form.degradationTps,
    strongDegradationTps: form.strongDegradationTps,
    consecutiveAnomalies: form.consecutiveAnomalies,
    crossEgressMin: form.crossEgressMin,
    bufferFirstTokenShare: form.bufferFirstTokenShare,
    minGenerationMs: form.minGenerationMs,
    minimumOutputTokens: form.minimumOutputTokens,
    autoQuarantine: form.autoQuarantine,
    quarantineMinutes: form.quarantineMinutes,
    clearSecrets,
  }
  if (
    !clearSecrets.includes('grok2apiAdminPassword') &&
    form.grok2apiAdminPassword.trim() &&
    form.grok2apiAdminPassword !== original.grok2apiAdminPassword
  ) {
    payload.grok2apiAdminPassword = form.grok2apiAdminPassword
  }
  if (
    !clearSecrets.includes('grokRegisterWebhookToken') &&
    form.grokRegisterWebhookToken.trim() &&
    form.grokRegisterWebhookToken !== original.grokRegisterWebhookToken
  ) {
    payload.grokRegisterWebhookToken = form.grokRegisterWebhookToken
  }
  if (
    !clearSecrets.includes('wechatAppSecret') &&
    form.wechatAppSecret.trim() &&
    form.wechatAppSecret !== original.wechatAppSecret
  ) {
    payload.wechatAppSecret = form.wechatAppSecret
  }
  return payload
}

function mergeEditableSettings(
  settings: RuntimeSettings,
  form: SettingsForm,
  clearSecrets: SecretSettingName[]
): EditableRuntimeSettings {
  return {
    ...settings,
    grok2apiAdminPassword: clearSecrets.includes('grok2apiAdminPassword')
      ? ''
      : form.grok2apiAdminPassword,
    grokRegisterWebhookToken: clearSecrets.includes(
      'grokRegisterWebhookToken'
    )
      ? ''
      : form.grokRegisterWebhookToken,
    wechatAppSecret: clearSecrets.includes('wechatAppSecret')
      ? ''
      : form.wechatAppSecret,
  }
}

function validateSettings(form: SettingsForm) {
  if (form.degradationTps >= form.strongDegradationTps) {
    throw new Error('降智信号 TPS 下限必须小于强降智信号 TPS 下限')
  }
  if (
    form.probeTransientRetryBaseSeconds > form.probeTransientRetryMaxSeconds
  ) {
    throw new Error('探针重试基础等待不能大于最大等待')
  }
  if (!form.grok2apiBaseUrl.trim()) {
    throw new Error('请填写 grok2api 服务地址')
  }
  if (
    form.wechatNotificationEnabled &&
    (!form.wechatAppId.trim() ||
      !form.wechatAppSecret.trim() ||
      !form.wechatOpenid.trim() ||
      !form.wechatTemplateId.trim())
  ) {
    throw new Error('开启微信异常推送前请填写 AppID、AppSecret、OpenID 和模板 ID')
  }
  if (form.initialProbeOnRegister && !form.registerProbeProfileIds.length) {
    throw new Error('注册后探针至少选择一个探针方案')
  }
  if (form.initialProbeOnRegister && !form.registerProbeProxyTargets.length) {
    throw new Error('注册后探针至少选择一个出口目标')
  }
  const hasCurrentTarget = form.registerProbeProxyTargets.some(
    (target) => target.kind === 'current'
  )
  const hasDiagnosticTarget = form.registerProbeProxyTargets.some(
    (target) => target.kind !== 'current'
  )
  if (hasCurrentTarget && hasDiagnosticTarget) {
    throw new Error('账号当前出口不能与诊断出口混用')
  }
  if (
    form.registerProbeExecutionMode === 'quality_test' &&
    form.registerProbeProxyTargets.some((target) => target.kind !== 'egress')
  ) {
    throw new Error('快速出口质量探针仅支持固定出口节点')
  }
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: typeof Network
  title: string
  description: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Icon className='size-4 text-primary' />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function IntegrationFlow({
  tokenConfigured,
  automaticProbe,
}: {
  tokenConfigured: boolean
  automaticProbe: boolean
}) {
  const steps = [
    {
      icon: Webhook,
      label: 'grok-register',
      detail: '导入成功事件',
      active: true,
    },
    {
      icon: KeyRound,
      label: '安全 Webhook',
      detail: '令牌校验',
      active: tokenConfigured,
    },
    {
      icon: Inbox,
      label: '持久收件箱',
      detail: '去重与重试',
      active: tokenConfigured,
    },
    {
      icon: Workflow,
      label: '探针队列',
      detail: automaticProbe ? '自动创建任务' : '按需启用',
      active: tokenConfigured && automaticProbe,
    },
  ]

  return (
    <div className='border-b bg-muted/[0.08] px-5 py-4 md:px-6'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div className='text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase'>
          事件链路
        </div>
        <span className='text-xs text-muted-foreground'>
          接收成功即与注册机解耦
        </span>
      </div>
      <div className='flex items-stretch gap-2 overflow-x-auto pb-1'>
        {steps.map((step, index) => {
          const Icon = step.icon
          return (
            <Fragment key={step.label}>
              <div
                className={cn(
                  'flex min-w-40 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5',
                  step.active
                    ? 'border-primary/20 bg-background'
                    : 'border-border/70 bg-muted/20'
                )}
              >
                <div
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                    step.active
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className='size-4' />
                </div>
                <div className='min-w-0'>
                  <div className='truncate text-xs font-medium'>
                    {step.label}
                  </div>
                  <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                    {step.detail}
                  </div>
                </div>
              </div>
              {index < steps.length - 1 && (
                <ArrowRight className='my-auto size-4 shrink-0 text-muted-foreground/50' />
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function WebhookContract() {
  const copyBody = (body: string, label: string) =>
    void copyText(body)
      .then(() => toast.success(`已复制${label}`))
      .catch((error) => toast.error(getErrorMessage(error)))

  const optionalFields = [
    {
      name: 'event_id',
      type: 'string',
      description: '推荐传入；重试时保持不变，用于幂等去重。省略时按邮箱生成。',
    },
    {
      name: 'event_type',
      type: 'string',
      description: '事件类型，默认 grok2api.account_imported。',
    },
    {
      name: 'registration_id',
      type: 'string',
      description: '调用方自己的注册记录 ID。',
    },
    {
      name: 'grok2api_account_id',
      type: 'integer',
      description: '已知时可传；未知时监控端按邮箱精确匹配。',
    },
    {
      name: 'bot_risk',
      type: 'boolean',
      description: '注册阶段是否发现风控，默认 false。',
    },
    {
      name: 'bfs',
      type: 'string | integer',
      description: '注册阶段的 bfs 风控值。',
    },
    {
      name: 'occurred_at',
      type: 'string',
      description: '事件发生时间，建议使用 ISO 8601。',
    },
  ]

  return (
    <div className='mt-5 overflow-hidden rounded-xl border'>
      <div className='flex flex-col gap-2 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <div className='text-sm font-medium'>请求协议</div>
          <p className='mt-0.5 text-xs leading-5 text-muted-foreground'>
            POST JSON；必填字段只有 email，探针策略由本页面统一维护。
          </p>
        </div>
        <div className='flex flex-wrap gap-2 text-xs'>
          <Badge variant='outline'>POST</Badge>
          <Badge variant='outline'>Content-Type: application/json</Badge>
          <Badge variant='outline'>x-monitor-token: 联动令牌</Badge>
        </div>
      </div>

      <div className='grid gap-0 lg:grid-cols-2 lg:divide-x'>
        <WebhookBodyExample
          title='最小请求体'
          description='适合简单调用方，监控端自动生成事件 ID。'
          body={REGISTER_WEBHOOK_MINIMAL_BODY}
          onCopy={() => copyBody(REGISTER_WEBHOOK_MINIMAL_BODY, '最小请求体')}
        />
        <WebhookBodyExample
          title='推荐请求体'
          description='调用方会重试时传 event_id，避免重复创建任务。'
          body={REGISTER_WEBHOOK_RECOMMENDED_BODY}
          onCopy={() =>
            copyBody(REGISTER_WEBHOOK_RECOMMENDED_BODY, '推荐请求体')
          }
        />
      </div>

      <div className='border-t px-4 py-3'>
        <div className='mb-2 text-xs font-medium'>可选字段</div>
        <div className='grid gap-x-5 gap-y-2 md:grid-cols-2'>
          {optionalFields.map((field) => (
            <div
              key={field.name}
              className='grid min-w-0 grid-cols-[minmax(7rem,auto)_1fr] gap-3 text-xs leading-5'
            >
              <div className='min-w-0'>
                <code className='break-all font-mono text-foreground'>
                  {field.name}
                </code>
                <div className='text-[11px] text-muted-foreground'>
                  {field.type}
                </div>
              </div>
              <p className='text-muted-foreground'>{field.description}</p>
            </div>
          ))}
        </div>
        <p className='mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground'>
          返回 HTTP 202 表示事件已持久接收；账号匹配、重试和探针执行随后在后台完成。
        </p>
      </div>
    </div>
  )
}

function WebhookBodyExample({
  title,
  description,
  body,
  onCopy,
}: {
  title: string
  description: string
  body: string
  onCopy: () => void
}) {
  return (
    <div className='min-w-0 p-4'>
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div>
          <div className='text-xs font-medium'>{title}</div>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            {description}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='size-8 shrink-0'
              onClick={onCopy}
              aria-label={`复制${title}`}
            >
              <Copy />
            </Button>
          </TooltipTrigger>
          <TooltipContent>复制请求体</TooltipContent>
        </Tooltip>
      </div>
      <pre className='max-w-full overflow-x-auto rounded-lg bg-muted/45 p-3 font-mono text-xs leading-5 text-foreground'>
        <code>{body}</code>
      </pre>
    </div>
  )
}

function IntegrationSection({
  icon: Icon,
  eyebrow,
  title,
  description,
  className,
  children,
}: {
  icon: typeof Network
  eyebrow: string
  title: string
  description: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('px-5 py-5 md:px-6 md:py-6', className)}>
      <div className='grid gap-5 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8'>
        <div>
          <div className='flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase'>
            <Icon className='size-3.5' />
            {eyebrow}
          </div>
          <h3 className='mt-2 text-sm font-semibold'>{title}</h3>
          <p className='mt-1.5 text-xs leading-5 text-muted-foreground'>
            {description}
          </p>
        </div>
        <div className='min-w-0'>{children}</div>
      </div>
    </section>
  )
}

function ModeOption({
  icon: Icon,
  title,
  description,
  meta,
  selected,
  disabled = false,
  onSelect,
}: {
  icon: typeof MessageSquareText
  title: string
  description: string
  meta: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type='button'
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group flex min-h-28 w-full items-start gap-3 rounded-xl border p-4 text-left transition-[border-color,background-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
        selected
          ? 'border-primary/40 bg-primary/[0.045] shadow-xs'
          : 'border-border bg-background hover:border-primary/25 hover:bg-muted/20',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
          selected
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground group-hover:text-foreground'
        )}
      >
        <Icon className='size-4' />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-medium'>{title}</div>
        <p className='mt-1 text-xs leading-5 text-muted-foreground'>
          {description}
        </p>
        <div className='mt-2 text-[11px] text-muted-foreground'>{meta}</div>
      </div>
      <div
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/30 bg-background'
        )}
      >
        {selected && <Check className='size-3' />}
      </div>
    </button>
  )
}

function EgressOption({
  icon: Icon,
  title,
  detail,
  selected,
  onToggle,
}: {
  icon: typeof Network
  title: string
  detail: string
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type='button'
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        'flex min-h-16 min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
        selected
          ? 'border-primary/35 bg-primary/[0.04]'
          : 'border-border/80 bg-background hover:border-primary/20 hover:bg-muted/20'
      )}
    >
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          selected
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className='size-4' />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='text-xs font-medium break-words' title={title}>
          {title}
        </div>
        <div className='mt-1 text-[11px] leading-4 break-all text-muted-foreground'>
          {detail}
        </div>
      </div>
      <div
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md border',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/30'
        )}
      >
        {selected && <Check className='size-3' />}
      </div>
    </button>
  )
}

function BootstrapSetting({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className='min-w-0 rounded-lg border bg-muted/[0.12] px-3 py-3'>
      <div className='text-[11px] font-medium text-muted-foreground'>
        {label}
      </div>
      <div
        className={cn(
          'mt-1.5 text-sm font-medium break-all',
          mono && 'font-mono text-xs leading-5'
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div>
        <Label>{label}</Label>
        {hint && <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type='number'
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}

function SecretField({
  name,
  value,
  settings,
  clearing,
  onChange,
  onToggleClear,
}: {
  name: SecretSettingName
  value: string
  settings: RuntimeSettings
  clearing: boolean
  onChange: (value: string) => void
  onToggleClear: () => void
}) {
  const metadata = secretMetadata[name]
  const configured = Boolean(settings[metadata.configuredKey])
  const [visible, setVisible] = useState(false)
  const [revealing, setRevealing] = useState(false)

  const toggleVisibility = async () => {
    if (visible) {
      setVisible(false)
      return
    }
    if (value || !configured) {
      setVisible(true)
      return
    }
    setRevealing(true)
    try {
      const secret = await api.revealSettingSecret(name)
      onChange(secret.value)
      setVisible(true)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setRevealing(false)
    }
  }

  return (
    <Field
      label={metadata.label}
      hint='已保存值会以密码形式载入；点击显示图标查看，留空会保留当前值'
    >
      <div className='flex gap-2'>
        <div className='relative min-w-0 flex-1'>
          <Input
            type={visible ? 'text' : 'password'}
            value={value}
            disabled={clearing}
            onChange={(event) => onChange(event.target.value)}
            placeholder={clearing ? '保存后清除当前值' : metadata.placeholder}
            autoComplete='new-password'
            className='pr-10'
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                disabled={clearing || revealing}
                className='absolute inset-e-1 top-1/2 size-7 -translate-y-1/2 rounded-md text-muted-foreground'
                onClick={() => void toggleVisibility()}
                aria-label={visible ? '隐藏当前输入内容' : '显示当前输入内容'}
              >
                {visible ? <EyeOff /> : <Eye />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {visible ? '隐藏当前输入内容' : '显示当前输入内容'}
            </TooltipContent>
          </Tooltip>
        </div>
        <Button
          type='button'
          variant={clearing ? 'destructive' : 'outline'}
          className='shrink-0'
          onClick={onToggleClear}
        >
          {clearing ? '撤销清除' : '清除'}
        </Button>
      </div>
      <Badge
        variant={
          clearing ? 'destructive' : configured ? 'success' : 'secondary'
        }
      >
        {clearing ? '待清除' : configured ? '已配置' : '未配置'}
      </Badge>
    </Field>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
      <div>
        <div className='text-sm font-medium'>{label}</div>
        <p className='mt-1 text-xs leading-5 text-muted-foreground'>
          {description}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function StatusCard({
  icon: Icon,
  label,
  value,
  detail,
  healthy,
}: {
  icon: typeof Network
  label: string
  value: string
  detail: string
  healthy: boolean
}) {
  return (
    <Card>
      <CardContent className='flex items-start gap-3 p-4'>
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            healthy
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}
        >
          <Icon className='size-4' />
        </div>
        <div className='min-w-0'>
          <div className='text-xs text-muted-foreground'>{label}</div>
          <div className='mt-0.5 text-sm font-semibold'>{value}</div>
          <div
            className='mt-1 truncate text-xs text-muted-foreground'
            title={detail}
          >
            {detail}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Boundary({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Database
  title: string
  text: string
}) {
  return (
    <div className='rounded-lg border bg-background p-3'>
      <Icon className='size-4 text-primary' />
      <div className='mt-2 text-sm font-semibold'>{title}</div>
      <p className='mt-1 text-xs leading-5 text-muted-foreground'>{text}</p>
    </div>
  )
}
