import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, KeyRound, Network, Save, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type SecretSettingName } from '@/lib/api'
import { getErrorMessage } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'
import { StatusCard } from '@/features/monitor/components/settings-components'
import { SettingsConnectionTab } from '@/features/monitor/components/settings-connection-tab'
import { SettingsExecutionTab } from '@/features/monitor/components/settings-execution-tab'
import { SettingsIntegrationTab } from '@/features/monitor/components/settings-integration-tab'
import {
  RECOMMENDED_RISK_SCORING,
  buildSettingsPayload,
  mergeEditableSettings,
  registerWebhookUrl,
  toSettingsForm,
  validateSettings,
  type SettingsForm,
  type SettingsSetter,
} from '@/features/monitor/components/settings-model'
import { SettingsNotificationsTab } from '@/features/monitor/components/settings-notifications-tab'
import { SettingsRiskTab } from '@/features/monitor/components/settings-risk-tab'
import { SettingsVersionTab } from '@/features/monitor/components/settings-version-tab'

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
  const set: SettingsSetter = (key, value) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const restoreRecommendedRiskScoring = () => {
    setForm((current) =>
      current ? { ...current, ...RECOMMENDED_RISK_SCORING } : current
    )
    toast.success('已填入推荐风险评分参数，保存后生效')
  }

  const toggleSecretClear = (name: SecretSettingName) => {
    setClearSecrets((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
    const field = name as keyof Pick<
      SettingsForm,
      'grok2apiAdminPassword' | 'grokRegisterWebhookToken' | 'wechatAppSecret'
    >
    set(field, '' as SettingsForm[typeof field])
  }
  return (
    <Page>
      <PageHeader
        title='系统设置'
        description='除启动监听、数据库路径和 CORS 外，连接、队列及风险参数均可在此保存并热应用。'
        descriptionAsHint
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
          <TabsTrigger value='version'>版本更新</TabsTrigger>
        </TabsList>

        <TabsContent value='connection'>
          <SettingsConnectionTab
            form={form}
            settings={settingsValue}
            clearSecrets={clearSecrets}
            set={set}
            toggleSecretClear={toggleSecretClear}
          />
        </TabsContent>

        <TabsContent value='execution'>
          <SettingsExecutionTab form={form} set={set} />
        </TabsContent>

        <TabsContent value='risk'>
          <SettingsRiskTab
            form={form}
            set={set}
            restoreRecommendedRiskScoring={restoreRecommendedRiskScoring}
          />
        </TabsContent>

        <TabsContent value='notifications'>
          <SettingsNotificationsTab
            form={form}
            settings={settingsValue}
            clearSecrets={clearSecrets}
            busy={busy}
            testPending={wechatTestMutation.isPending}
            set={set}
            toggleSecretClear={toggleSecretClear}
            onTest={() => wechatTestMutation.mutate()}
          />
        </TabsContent>

        <TabsContent value='integration'>
          <SettingsIntegrationTab
            form={form}
            settings={settingsValue}
            clearSecrets={clearSecrets}
            profiles={profiles.data ?? []}
            profilesLoading={profiles.isLoading}
            registerTokenReady={registerTokenReady}
            webhookUrl={webhookUrl}
            set={set}
            toggleSecretClear={toggleSecretClear}
          />
        </TabsContent>

        <TabsContent value='version'>
          <SettingsVersionTab />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
