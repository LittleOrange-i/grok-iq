import type {
  EditableRuntimeSettings,
  ExecutionMode,
  ProxyTarget,
  RuntimeSettings,
  RuntimeSettingsUpdate,
  SecretSettingName,
} from '@/lib/api'

export type SettingsForm = {
  grok2apiBaseUrl: string
  grok2apiAdminUsername: string
  grok2apiAdminPassword: string
  grok2apiHttpImpersonate: string
  grokRegisterWebhookToken: string
  initialProbeOnRegister: boolean
  registerProbeStabilizationSeconds: number
  registerProbeProfileIds: string[]
  registerProbeExecutionMode: ExecutionMode
  registerProbeRounds: number
  registerProbeProxyTargets: ProxyTarget[]
  registerProbeSwitchOnDegradation: boolean
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
  cumulativeAnomalyRate: number
  highRiskHardCount: number
  riskAnomalyRateWeight: number
  riskHardWeight: number
  riskHardCap: number
  riskFastWeight: number
  riskFastCap: number
  riskMarkerMissWeight: number
  riskMarkerMissCap: number
  riskStreakWeight: number
  riskStreakCap: number
  riskScoreCap: number
  riskWatchFloor: number
  riskSuspectFloor: number
  riskHighFloor: number
  bufferFirstTokenShare: number
  minGenerationMs: number
  minimumOutputTokens: number
  autoQuarantine: boolean
  autoQuarantineRecoveryEnabled: boolean
  quarantineMinutes: number
}

export type SettingsSetter = <K extends keyof SettingsForm>(
  key: K,
  value: SettingsForm[K]
) => void

export const secretMetadata: Record<
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

export const RECOMMENDED_RISK_SCORING = {
  riskAnomalyRateWeight: 30,
  riskHardWeight: 6,
  riskHardCap: 24,
  riskFastWeight: 12,
  riskFastCap: 30,
  riskMarkerMissWeight: 16,
  riskMarkerMissCap: 32,
  riskStreakWeight: 3,
  riskStreakCap: 15,
} as const

export const REGISTER_WEBHOOK_PATH =
  '/api/integrations/grok-register/account-imported'
export const GROK_REGISTER_REPOSITORY_URL =
  'https://github.com/kaibush/grok-register'
export const REGISTER_PROBE_EXECUTION_MODE: ExecutionMode = 'chat'
export const REGISTER_PROBE_ROUNDS = 3
export const REGISTER_PROBE_PROXY_TARGETS: ProxyTarget[] = [
  { kind: 'current', id: null },
]
export const REGISTER_WEBHOOK_MINIMAL_BODY = `{
  "email": "user@example.com"
}`
export const REGISTER_WEBHOOK_RECOMMENDED_BODY = `{
  "event_id": "registration:123:grok2api-imported",
  "email": "user@example.com"
}`
export const WECHAT_TEMPLATE_BODY = `{{first.DATA}}
账号：{{account.DATA}}
状态：{{status.DATA}}
风险分：{{score.DATA}}
TPS：{{tps.DATA}}
原因：{{reason.DATA}}
时间：{{time.DATA}}
{{remark.DATA}}`

export function registerWebhookUrl() {
  if (typeof window === 'undefined') return REGISTER_WEBHOOK_PATH
  return new URL(REGISTER_WEBHOOK_PATH, window.location.origin).toString()
}

export function toSettingsForm(
  settings: EditableRuntimeSettings
): SettingsForm {
  return {
    grok2apiBaseUrl: settings.grok2apiBaseUrl,
    grok2apiAdminUsername: settings.grok2apiAdminUsername,
    grok2apiAdminPassword: settings.grok2apiAdminPassword,
    grok2apiHttpImpersonate: settings.grok2apiHttpImpersonate,
    grokRegisterWebhookToken: settings.grokRegisterWebhookToken,
    initialProbeOnRegister: settings.initialProbeOnRegister,
    registerProbeStabilizationSeconds:
      settings.registerProbeStabilizationSeconds ?? 15,
    registerProbeProfileIds: settings.registerProbeProfileIds,
    registerProbeExecutionMode: REGISTER_PROBE_EXECUTION_MODE,
    registerProbeRounds: REGISTER_PROBE_ROUNDS,
    registerProbeProxyTargets: REGISTER_PROBE_PROXY_TARGETS,
    registerProbeSwitchOnDegradation:
      settings.registerProbeSwitchOnDegradation ?? true,
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
    cumulativeAnomalyRate: settings.cumulativeAnomalyRate,
    highRiskHardCount: settings.highRiskHardCount,
    riskAnomalyRateWeight: settings.riskAnomalyRateWeight,
    riskHardWeight: settings.riskHardWeight,
    riskHardCap: settings.riskHardCap,
    riskFastWeight: settings.riskFastWeight,
    riskFastCap: settings.riskFastCap,
    riskMarkerMissWeight: settings.riskMarkerMissWeight,
    riskMarkerMissCap: settings.riskMarkerMissCap,
    riskStreakWeight: settings.riskStreakWeight,
    riskStreakCap: settings.riskStreakCap,
    riskScoreCap: settings.riskScoreCap,
    riskWatchFloor: settings.riskWatchFloor,
    riskSuspectFloor: settings.riskSuspectFloor,
    riskHighFloor: settings.riskHighFloor,
    bufferFirstTokenShare: settings.bufferFirstTokenShare,
    minGenerationMs: settings.minGenerationMs,
    minimumOutputTokens: settings.minimumOutputTokens,
    autoQuarantine: settings.autoQuarantine,
    autoQuarantineRecoveryEnabled:
      settings.autoQuarantineRecoveryEnabled ?? true,
    quarantineMinutes: settings.quarantineMinutes,
  }
}

export function buildSettingsPayload(
  form: SettingsForm,
  clearSecrets: SecretSettingName[],
  original: EditableRuntimeSettings
): RuntimeSettingsUpdate {
  const payload: RuntimeSettingsUpdate = {
    grok2apiBaseUrl: form.grok2apiBaseUrl.trim(),
    grok2apiAdminUsername: form.grok2apiAdminUsername.trim(),
    grok2apiHttpImpersonate: form.grok2apiHttpImpersonate.trim(),
    initialProbeOnRegister: form.initialProbeOnRegister,
    registerProbeStabilizationSeconds: form.registerProbeStabilizationSeconds,
    registerProbeProfileIds: form.registerProbeProfileIds,
    registerProbeExecutionMode: REGISTER_PROBE_EXECUTION_MODE,
    registerProbeRounds: REGISTER_PROBE_ROUNDS,
    registerProbeProxyTargets: REGISTER_PROBE_PROXY_TARGETS,
    registerProbeSwitchOnDegradation: form.registerProbeSwitchOnDegradation,
    wechatNotificationEnabled: form.wechatNotificationEnabled,
    wechatAppId: form.wechatAppId.trim(),
    wechatOpenid: form.wechatOpenid.trim(),
    wechatTemplateId: form.wechatTemplateId.trim(),
    probeWorkerConcurrency: form.probeWorkerConcurrency,
    probeQueueLimit: form.probeQueueLimit,
    probeStepDelaySeconds: form.probeStepDelaySeconds,
    probeCurrentEgressIntervalSeconds: form.probeCurrentEgressIntervalSeconds,
    probeTransientRetryAttempts: form.probeTransientRetryAttempts,
    probeTransientRetryBaseSeconds: form.probeTransientRetryBaseSeconds,
    probeTransientRetryMaxSeconds: form.probeTransientRetryMaxSeconds,
    probeRoutePrefix: form.probeRoutePrefix.trim(),
    probeDiagnosticPriority: form.probeDiagnosticPriority,
    analysisWindowHours: form.analysisWindowHours,
    degradationTps: form.degradationTps,
    strongDegradationTps: form.strongDegradationTps,
    consecutiveAnomalies: form.consecutiveAnomalies,
    cumulativeAnomalyRate: form.cumulativeAnomalyRate,
    highRiskHardCount: form.highRiskHardCount,
    riskAnomalyRateWeight: form.riskAnomalyRateWeight,
    riskHardWeight: form.riskHardWeight,
    riskHardCap: form.riskHardCap,
    riskFastWeight: form.riskFastWeight,
    riskFastCap: form.riskFastCap,
    riskMarkerMissWeight: form.riskMarkerMissWeight,
    riskMarkerMissCap: form.riskMarkerMissCap,
    riskStreakWeight: form.riskStreakWeight,
    riskStreakCap: form.riskStreakCap,
    riskScoreCap: form.riskScoreCap,
    riskWatchFloor: form.riskWatchFloor,
    riskSuspectFloor: form.riskSuspectFloor,
    riskHighFloor: form.riskHighFloor,
    bufferFirstTokenShare: form.bufferFirstTokenShare,
    minGenerationMs: form.minGenerationMs,
    minimumOutputTokens: form.minimumOutputTokens,
    autoQuarantine: form.autoQuarantine,
    autoQuarantineRecoveryEnabled: form.autoQuarantineRecoveryEnabled,
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

export function mergeEditableSettings(
  currentSettings: RuntimeSettings,
  form: SettingsForm,
  clearSecrets: SecretSettingName[]
): EditableRuntimeSettings {
  return {
    ...currentSettings,
    grok2apiAdminPassword: clearSecrets.includes('grok2apiAdminPassword')
      ? ''
      : form.grok2apiAdminPassword,
    grokRegisterWebhookToken: clearSecrets.includes('grokRegisterWebhookToken')
      ? ''
      : form.grokRegisterWebhookToken,
    wechatAppSecret: clearSecrets.includes('wechatAppSecret')
      ? ''
      : form.wechatAppSecret,
  }
}

export function validateSettings(form: SettingsForm) {
  if (form.degradationTps >= form.strongDegradationTps) {
    throw new Error('降智信号 TPS 下限必须小于强降智信号 TPS 下限')
  }
  if (!(
    form.riskWatchFloor <= form.riskSuspectFloor &&
    form.riskSuspectFloor <= form.riskHighFloor &&
    form.riskHighFloor <= form.riskScoreCap
  )) {
    throw new Error('风险状态保底分必须满足观察 ≤ 疑似 ≤ 高风险 ≤ 总分上限')
  }
  const scoreFactors = [
    ['强信号', form.riskHardWeight, form.riskHardCap],
    ['持续高速', form.riskFastWeight, form.riskFastCap],
    ['标记缺失', form.riskMarkerMissWeight, form.riskMarkerMissCap],
    ['连续信号', form.riskStreakWeight, form.riskStreakCap],
  ] as const
  for (const [label, weight, cap] of scoreFactors) {
    if (weight > 0 && cap <= 0) {
      throw new Error(`${label}权重大于 0 时封顶分必须大于 0`)
    }
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
    throw new Error(
      '开启微信异常推送前请填写 AppID、AppSecret、OpenID 和模板 ID'
    )
  }
  if (form.initialProbeOnRegister && !form.registerProbeProfileIds.length) {
    throw new Error('注册后探针至少选择一个探针方案')
  }
  if (
    !Number.isFinite(form.registerProbeStabilizationSeconds) ||
    form.registerProbeStabilizationSeconds < 0 ||
    form.registerProbeStabilizationSeconds > 300
  ) {
    throw new Error('新账号稳定等待需在 0–300 秒之间')
  }
}
