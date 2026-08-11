import { useAuthStore, type AuthUser } from '@/stores/auth-store'

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '/api').replace(
  /\/$/,
  ''
)

export type ExecutionMode = 'chat' | 'quality_test'

export type AuthStatus = {
  setupRequired: boolean
  authenticated: boolean
  user: AuthUser | null
}

export type AuthSession = {
  accessToken: string
  tokenType: 'bearer'
  expiresAt: string
  user: AuthUser
}

export type AuthenticationRequiredCode =
  | 'authentication_required'
  | 'setup_required'
export const AUTH_REQUIRED_EVENT = 'gam-auth-required'
const AUTH_REQUIRED_CODES = new Set<AuthenticationRequiredCode>([
  'authentication_required',
  'setup_required',
])

export class ApiError extends Error {
  status: number
  code?: string
  setupRequired?: boolean

  constructor(
    message: string,
    status: number,
    options: { code?: string; setupRequired?: boolean } = {}
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = options.code
    this.setupRequired = options.setupRequired
  }
}

export function authorizationHeaders(): Record<string, string> {
  const token = useAuthStore.getState().auth.accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function notifyAuthenticationRequired(setupRequired = false) {
  useAuthStore.getState().auth.reset()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { setupRequired } })
    )
  }
}

export function isAuthenticationRequiredCode(
  value: unknown
): value is AuthenticationRequiredCode {
  return (
    typeof value === 'string' &&
    AUTH_REQUIRED_CODES.has(value as AuthenticationRequiredCode)
  )
}

export type Assessment = {
  account_id: number
  monitor_status: string
  risk_score: number
  sample_count: number
  anomaly_count: number
  hard_anomaly_count?: number
  distinct_egress_count?: number
  avg_tps?: number
  max_tps?: number
  latest_tps?: number
  latest_classification?: string
  latest_sample_at?: string | null
  risk_reasons: string[]
  quarantine_until?: string | null
  recovery_guarded?: boolean
}

export type UpstreamAccount = {
  id: string
  name: string
  email?: string
  provider: string
  enabled: boolean
  authStatus?: string
  priority?: number
  maxConcurrent?: number
  failureCount?: number
  lastUsedAt?: string | null
  egressNodeId?: string | null
  egressAssignmentMode?: string
  buildBotFlagged?: boolean
  assessment: Assessment
}

export type AccountOption = {
  id: string
  name: string
  email?: string
  enabled: boolean
  authStatus?: string
}

export type AccountTargetSummary = {
  target_key: string
  target_kind: string
  egress_node_id?: number | null
  egress_name: string
  samples: number
  anomalies?: number | null
  avg_tps?: number | null
  max_tps?: number | null
}

export type AccountDetailResponse = {
  account: UpstreamAccount
  history: {
    samples: ProbeSample[]
    runs: ProbeRun[]
    byTarget: AccountTargetSummary[]
  }
}

export type EgressNode = {
  id: string
  name: string
  enabled: boolean
  proxyConfigured: boolean
  proxyPool?: boolean
  health?: number
  probeStatus?: string
  exitIp?: string
  assignedAccountCount?: number
}

export type ProbeProfile = {
  id: string
  built_in: boolean
  name: string
  description: string
  model: string
  system_prompt: string
  prompt: string
  expected_text: string
  expected_output: string
  expected_image_url: string
  max_output_tokens: number
  temperature: number | null
  extra_body: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export type ProxyTarget = {
  kind: 'direct' | 'egress'
  id: number | null
  name?: string
}

export type ProbePlan = {
  id: string
  name: string
  description: string
  profile_id: string
  profile_ids: string[]
  account_ids: number[]
  proxy_targets: ProxyTarget[]
  execution_mode: ExecutionMode
  rounds: number
  cron_expression: string
  timezone: string
  enabled: boolean
  overlap_policy: 'skip' | 'fill'
  priority: number
  created_at: string
  updated_at: string
  job?: { id: string; name: string; nextRunAt?: string | null } | null
}

export type BulkDeleteResult = {
  requested: number
  deleted: number
  skipped: number
  protected?: number
  active?: number
  running?: number
  missing: number
  protectedIds?: string[]
  activeIds?: string[]
  runningIds?: string[]
  missingIds: string[]
}

export type PlanBulkRunResult = {
  requested: number
  processed: number
  created: number
  skipped: number
  failed: number
  restoreBlocked: number
  failures: { id: string; message: string }[]
}

export type ProbeRun = {
  id: string
  account_id: number
  account_name: string
  account_email: string
  profile_id: string
  plan_id?: string | null
  status: string
  trigger: string
  execution_mode: ExecutionMode
  rounds: number
  proxy_targets: ProxyTarget[]
  total_steps: number
  completed_steps: number
  error_count: number
  current_round?: number | null
  current_target_key?: string | null
  queue_blocked_reason?: string
  worker_id?: string | null
  summary: Record<string, unknown>
  error: string
  original_egress_node_id?: number | null
  original_egress_assignment_mode?: string
  original_account_enabled?: boolean | null
  original_account_priority?: number | null
  original_account_max_concurrent?: number | null
  account_settings_snapshot_at?: string | null
  diagnostic_priority?: number | null
  diagnostic_max_concurrent?: number | null
  diagnostic_activation_active?: boolean
  account_restore_status?: string
  account_restore_source?: string
  account_restore_attempts?: number
  account_restore_error?: string
  account_restore_attempted_at?: string | null
  account_restored_at?: string | null
  created_at: string
  started_at?: string | null
  heartbeat_at?: string | null
  completed_at?: string | null
  duration_estimate?: ProbeDurationEstimate | null
}

export type ProbeDurationEstimate = {
  average_sample_ms: number
  estimated_total_ms: number
  estimated_remaining_ms: number
  sample_count: number
  updated_at: string
}

export type ProbeWorkerCurrentRun = {
  id: string
  accountId: number | null
  accountName: string
  profileId: string
  profileName: string
  executionMode: ExecutionMode | string
  round?: number | null
  targetKey: string
  startedAt?: string | null
}

export type ProbeWorker = {
  id: string
  index: number
  status: string
  desired: boolean
  taskAlive: boolean
  startedAt: string
  stateChangedAt: string
  lastHeartbeatAt: string
  completedRuns: number
  failedRuns: number
  lastError: string
  currentRun?: ProbeWorkerCurrentRun | null
}

export type ProbeWorkersResponse = {
  process: {
    pid: number
    hostname: string
    startedAt: string
    uptimeSeconds: number
    model: string
  }
  started: boolean
  stopping: boolean
  configuredConcurrency: number
  desiredConcurrency: number
  liveWorkers: number
  busyWorkers: number
  idleWorkers: number
  queue: {
    queued: number
    running: number
    eligible: number
    blockedSameAccount: number
    blockedRestore: number
  }
  workers: ProbeWorker[]
  policy: {
    sameAccountSerial: boolean
    reason: string
  }
  log: {
    fileName: string
    retentionDays: number
    sizeBytes: number
  }
}

export type ProbeWorkerLogsResponse = {
  items: string[]
  limit: number
  fileName: string
  retentionDays: number
  sizeBytes: number
}

export type ProbeSample = {
  id: string
  run_id: string
  account_id: number
  round_number: number
  target_key: string
  target_kind: string
  egress_node_id?: number | null
  egress_name: string
  request_id: string
  audit_id?: number | null
  verified_account_id?: number | null
  verified_egress_node_id?: number | null
  status: string
  status_code: number
  error_code?: string
  retry_count?: number
  retry_after_seconds?: number
  output_tokens: number
  reasoning_tokens: number
  visible_tokens?: number
  chunk_count?: number
  first_token_ms: number
  duration_ms: number
  generation_ms: number
  first_token_share: number
  tps: number
  expected_matched?: boolean | null
  response_sha256?: string
  response_text: string
  classification: string
  error: string
  created_at: string
}

export type RuntimeSettings = {
  grok2apiBaseUrl: string
  grok2apiAdminUsername: string
  grok2apiAdminPasswordConfigured: boolean
  grok2apiHttpImpersonate: string
  grokRegisterWebhookTokenConfigured: boolean
  initialProbeOnRegister: boolean
  registerProbeProfileIds: string[]
  registerProbeExecutionMode: ExecutionMode
  registerProbeRounds: number
  registerProbeProxyTargets: ProxyTarget[]
  schedulerEnabled: boolean
  schedulerTimezone: string
  schedulerMisfireGraceSeconds: number
  recoveryCron: string
  probeWorkerConcurrency: number
  probeQueueLimit: number
  probeStepDelaySeconds: number
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
  bootstrap: {
    host: string
    port: number
    databasePath: string
    corsOrigins: string[]
  }
  changed?: string[]
}

export type EditableRuntimeSettings = RuntimeSettings & {
  grok2apiAdminPassword: string
  grokRegisterWebhookToken: string
}

export type SecretSettingName =
  | 'grok2apiAdminPassword'
  | 'grokRegisterWebhookToken'

export type RuntimeSettingsUpdate = Partial<
  Pick<
    RuntimeSettings,
    | 'grok2apiBaseUrl'
    | 'grok2apiAdminUsername'
    | 'grok2apiHttpImpersonate'
    | 'initialProbeOnRegister'
    | 'registerProbeProfileIds'
    | 'registerProbeExecutionMode'
    | 'registerProbeRounds'
    | 'registerProbeProxyTargets'
    | 'schedulerEnabled'
    | 'schedulerTimezone'
    | 'schedulerMisfireGraceSeconds'
    | 'recoveryCron'
    | 'probeWorkerConcurrency'
    | 'probeQueueLimit'
    | 'probeStepDelaySeconds'
    | 'probeTransientRetryAttempts'
    | 'probeTransientRetryBaseSeconds'
    | 'probeTransientRetryMaxSeconds'
    | 'probeRoutePrefix'
    | 'probeDiagnosticPriority'
    | 'analysisWindowHours'
    | 'degradationTps'
    | 'strongDegradationTps'
    | 'consecutiveAnomalies'
    | 'crossEgressMin'
    | 'bufferFirstTokenShare'
    | 'minGenerationMs'
    | 'minimumOutputTokens'
    | 'autoQuarantine'
    | 'quarantineMinutes'
  >
> & {
  grok2apiAdminPassword?: string
  grokRegisterWebhookToken?: string
  clearSecrets?: SecretSettingName[]
}

type RuntimeSettingsWire = Omit<
  RuntimeSettings,
  'degradationTps' | 'strongDegradationTps'
> & {
  degradationTps?: number
  strongDegradationTps?: number
  softTps?: number
  hardTps?: number
}

function normalizeRuntimeSettings(value: RuntimeSettingsWire): RuntimeSettings {
  return {
    ...value,
    registerProbeProfileIds:
      value.registerProbeProfileIds ?? ['quality-marker'],
    registerProbeExecutionMode:
      value.registerProbeExecutionMode ?? 'chat',
    registerProbeRounds: value.registerProbeRounds ?? 3,
    registerProbeProxyTargets:
      value.registerProbeProxyTargets ?? [{ kind: 'direct', id: null }],
    degradationTps: value.degradationTps ?? value.softTps ?? 150,
    strongDegradationTps: value.strongDegradationTps ?? value.hardTps ?? 500,
  }
}

async function loadEditableRuntimeSettings(): Promise<EditableRuntimeSettings> {
  const settings = normalizeRuntimeSettings(
    await request<RuntimeSettingsWire>('/settings')
  )
  const [adminPassword, registerToken] = await Promise.all([
    settings.grok2apiAdminPasswordConfigured
      ? request<{ value: string }>(
          '/settings/secrets/grok2apiAdminPassword',
          { cache: 'no-store' }
        )
      : Promise.resolve({ value: '' }),
    settings.grokRegisterWebhookTokenConfigured
      ? request<{ value: string }>(
          '/settings/secrets/grokRegisterWebhookToken',
          { cache: 'no-store' }
        )
      : Promise.resolve({ value: '' }),
  ])
  return {
    ...settings,
    grok2apiAdminPassword: adminPassword.value,
    grokRegisterWebhookToken: registerToken.value,
  }
}

export type Page<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  activeCount?: number
}

export type AccountSelection = {
  accountIds: number[]
  disabledAccountIds: number[]
  matched: number
  selectable: number
  excluded: number
}

export type AccountBatchUpdateResult = {
  requested: number
  eligible: number
  updated: number
  enabled: boolean
  skippedAccountIds: number[]
  failedAccountIds: number[]
  failures: { id: number; error: string }[]
}

export type ProbeRunBatchResult = {
  requested: number
  requestedTasks?: number
  profileIds?: string[]
  created: number
  skipped: number
  missingAccountIds: number[]
  invalidAccounts: { id: number; reason: string }[]
  activeAccountIds: number[]
  restoreBlockedAccountIds: number[]
  diagnosticAccountIds: number[]
  runIds: string[]
}

export type DashboardResponse = {
  upstream?: { total?: number; available?: number }
  assessments?: { risky?: number; quarantined?: number }
  samples?: {
    total?: number
    anomalies?: number
    maxTps?: number
    avgTps?: number
  }
  queue?: { queued?: number; running?: number }
  trend?: Record<string, string | number | null>[]
  riskyAccounts?: UpstreamAccount[]
  recentRuns?: ProbeRun[]
}

export type HealthResponse = {
  upstream?: Record<string, unknown>
  integration?: Record<string, unknown>
  [key: string]: unknown
}

export type SchedulerJob = {
  id: string
  name: string
  nextRunAt?: string | null
}

export type ScheduleExecution = {
  id: string
  schedule_key: string
  status: string
  message: string
  detail: Record<string, unknown>
  started_at: string
  completed_at?: string | null
}

export type SchedulerResponse = {
  enabled: boolean
  running: boolean
  plans: ProbePlan[]
  systemJobs: SchedulerJob[]
  executions: ScheduleExecution[]
}

export type ChatModel = {
  id?: string
  name?: string
  owned_by?: string
  [key: string]: unknown
}

export type ChatProvider = {
  id: string
  name: string
  baseUrl: string
  models: string[]
  enabled: boolean
  isDefault: boolean
  apiKeyConfigured: boolean
  createdAt: string
  updatedAt: string
}

export type ChatProviderInput = {
  name: string
  baseUrl: string
  apiKey?: string
  clearApiKey?: boolean
  models: string[]
  enabled: boolean
  isDefault: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
      ...authorizationHeaders(),
    },
  })
  if (!response.ok) {
    const text = await response.text()
    let payload: {
      detail?: unknown
      error?: { message?: unknown } | unknown
      code?: string
      setupRequired?: boolean
    } = {}
    try {
      payload = JSON.parse(text) as typeof payload
    } catch {
      payload = {}
    }
    const detail =
      payload.detail ??
      (typeof payload.error === 'object' && payload.error
        ? (payload.error as { message?: unknown }).message
        : payload.error)
    const message =
      typeof detail === 'string'
        ? detail
        : detail == null
          ? text || `HTTP ${response.status}`
          : JSON.stringify(detail)
    const isAuthEndpoint = path.startsWith('/auth/')
    if (
      response.status === 401 &&
      !isAuthEndpoint &&
      isAuthenticationRequiredCode(payload.code)
    ) {
      notifyAuthenticationRequired(Boolean(payload.setupRequired))
    }
    throw new ApiError(message, response.status, {
      code: payload.code,
      setupRequired: payload.setupRequired,
    })
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const ACCOUNT_BATCH_REQUEST_SIZE = 100
const ACCOUNT_BATCH_NETWORK_ATTEMPTS = 3
const ACCOUNT_BATCH_RETRYABLE_STATUSES = new Set([502, 503, 504])

async function updateAccountsEnabled(
  accountIds: number[],
  enabled: boolean
): Promise<AccountBatchUpdateResult> {
  const uniqueIds = Array.from(
    new Set(
      accountIds.filter(
        (accountId) => Number.isSafeInteger(accountId) && accountId > 0
      )
    )
  )
  const result: AccountBatchUpdateResult = {
    requested: 0,
    eligible: 0,
    updated: 0,
    enabled,
    skippedAccountIds: [],
    failedAccountIds: [],
    failures: [],
  }

  for (
    let start = 0;
    start < uniqueIds.length;
    start += ACCOUNT_BATCH_REQUEST_SIZE
  ) {
    const accountBatch = uniqueIds.slice(
      start,
      start + ACCOUNT_BATCH_REQUEST_SIZE
    )
    const batchResult = await requestAccountBatchWithRetry(
      accountBatch,
      enabled
    )
    result.requested += batchResult.requested
    result.eligible += batchResult.eligible
    result.updated += batchResult.updated
    result.skippedAccountIds.push(...(batchResult.skippedAccountIds ?? []))
    result.failedAccountIds.push(...(batchResult.failedAccountIds ?? []))
    result.failures.push(...(batchResult.failures ?? []))
  }

  result.skippedAccountIds = Array.from(new Set(result.skippedAccountIds))
  result.failedAccountIds = Array.from(new Set(result.failedAccountIds))
  return result
}

async function requestAccountBatchWithRetry(
  accountIds: number[],
  enabled: boolean
): Promise<AccountBatchUpdateResult> {
  for (let attempt = 1; attempt <= ACCOUNT_BATCH_NETWORK_ATTEMPTS; attempt += 1) {
    try {
      return await request<AccountBatchUpdateResult>('/accounts/batch', {
        method: 'PUT',
        body: JSON.stringify({ account_ids: accountIds, enabled }),
      })
    } catch (error) {
      const retrying =
        isRetryableAccountBatchError(error) &&
        attempt < ACCOUNT_BATCH_NETWORK_ATTEMPTS
      if (!retrying) throw error
      await new Promise<void>((resolve) =>
        globalThis.setTimeout(resolve, attempt * 250)
      )
    }
  }
  throw new Error('批量更新请求异常结束')
}

function isRetryableAccountBatchError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof ApiError &&
      ACCOUNT_BATCH_RETRYABLE_STATUSES.has(error.status))
  )
}

function query(
  params: Record<string, string | number | boolean | null | undefined>
) {
  const value = new URLSearchParams()
  for (const [key, item] of Object.entries(params)) {
    if (item !== '' && item != null) value.set(key, String(item))
  }
  const suffix = value.toString()
  return suffix ? `?${suffix}` : ''
}

export const api = {
  authStatus: () => request<AuthStatus>('/auth/status'),
  authSetup: (body: {
    username: string
    password: string
    confirm_password: string
  }) =>
    request<AuthSession>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  authLogin: (body: { username: string; password: string }) =>
    request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  authMe: () => request<{ user: AuthUser }>('/auth/me'),
  authLogout: () =>
    request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),
  health: () => request<HealthResponse>('/health'),
  dashboard: (hours = 168) =>
    request<DashboardResponse>(`/dashboard?hours=${hours}`),
  accounts: (
    params: Record<string, string | number | undefined>,
    signal?: AbortSignal
  ) => request<Page<UpstreamAccount>>(`/accounts${query(params)}`, { signal }),
  accountSelection: (
    params: Record<string, string | number | undefined> = {}
  ) => request<AccountSelection>(`/accounts/selection${query(params)}`),
  accountOptions: (
    params: Record<string, string | number | undefined> = {},
    signal?: AbortSignal
  ) =>
    request<Page<AccountOption>>(`/accounts/options${query(params)}`, {
      signal,
    }),
  account: (id: number, limit = 30) =>
    request<AccountDetailResponse>(`/accounts/${id}${query({ limit })}`),
  accountAction: (id: number, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/accounts/${id}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAccountsEnabled,
  deleteAccount: (id: number) =>
    request<{ deleted: boolean; accountId: number }>(`/accounts/${id}`, {
      method: 'DELETE',
    }),
  egress: (params: Record<string, string | number | undefined> = {}) =>
    request<Page<EgressNode>>(`/egress-nodes${query(params)}`),
  profiles: () => request<ProbeProfile[]>('/probe-profiles'),
  createProfile: (body: Record<string, unknown>) =>
    request<{ id: string }>('/probe-profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProfile: (id: string, body: Record<string, unknown>) =>
    request<ProbeProfile>(`/probe-profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProfile: (id: string) =>
    request<void>(`/probe-profiles/${id}`, { method: 'DELETE' }),
  deleteProfiles: (ids: string[]) =>
    request<BulkDeleteResult>('/probe-profiles', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),
  plans: () => request<ProbePlan[]>('/probe-plans'),
  createPlan: (body: Record<string, unknown>) =>
    request<{ id: string }>('/probe-plans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePlan: (id: string, body: Record<string, unknown>) =>
    request<ProbePlan>(`/probe-plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  setPlanEnabled: (id: string, enabled: boolean) =>
    request<ProbePlan>(`/probe-plans/${id}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  deletePlan: (id: string) =>
    request<void>(`/probe-plans/${id}`, { method: 'DELETE' }),
  runPlan: (id: string) =>
    request<Record<string, unknown>>(`/probe-plans/${id}/run`, {
      method: 'POST',
    }),
  runPlans: (ids: string[]) =>
    request<PlanBulkRunResult>('/probe-plans/batch/run', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  deletePlans: (ids: string[]) =>
    request<BulkDeleteResult>('/probe-plans', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),
  createRun: (body: Record<string, unknown>) =>
    request<{ id: string; status: string }>('/probe-runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createRunsBatch: (body: Record<string, unknown>) =>
    request<ProbeRunBatchResult>('/probe-runs/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runs: (
    params: Record<string, string | number | undefined> = {},
    signal?: AbortSignal
  ) => request<Page<ProbeRun>>(`/probe-runs${query(params)}`, { signal }),
  probeWorkers: () => request<ProbeWorkersResponse>('/probe-workers'),
  probeWorkerLogs: (limit = 300) =>
    request<ProbeWorkerLogsResponse>(
      `/probe-workers/logs${query({ limit: Math.min(1500, limit) })}`
    ),
  run: (id: string) =>
    request<{
      run: ProbeRun
      profile: ProbeProfile
      samples: ProbeSample[]
    }>(`/probe-runs/${id}`),
  cancelRun: (id: string) =>
    request<Record<string, unknown>>(`/probe-runs/${id}/cancel`, {
      method: 'POST',
    }),
  cancelRuns: (ids: string[]) =>
    request<{
      requested: number
      cancelled: number
      cancelRequested: number
      alreadyStopping: number
      skipped: number
    }>('/probe-runs/batch/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  retryRun: (id: string) =>
    request<Record<string, unknown>>(`/probe-runs/${id}/retry`, {
      method: 'POST',
    }),
  restoreRunAccountSettings: (id: string) =>
    request<ProbeRun>(`/probe-runs/${id}/restore-account-settings`, {
      method: 'POST',
    }),
  deleteRun: (id: string) =>
    request<void>(`/probe-runs/${id}`, { method: 'DELETE' }),
  deleteSample: (id: string) =>
    request<void>(`/probe-samples/${id}`, { method: 'DELETE' }),
  deleteRuns: (ids: string[]) =>
    request<{ deleted: number }>('/probe-runs', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),
  scheduler: () => request<SchedulerResponse>('/scheduler'),
  deleteSchedulerExecution: (id: string) =>
    request<void>(`/scheduler/executions/${id}`, { method: 'DELETE' }),
  deleteSchedulerExecutions: (ids: string[]) =>
    request<BulkDeleteResult>('/scheduler/executions', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),
  settings: () =>
    request<RuntimeSettingsWire>('/settings').then(normalizeRuntimeSettings),
  editableSettings: loadEditableRuntimeSettings,
  revealSettingSecret: (name: SecretSettingName) =>
    request<{ value: string }>(`/settings/secrets/${name}`, {
      cache: 'no-store',
    }),
  updateSettings: (body: RuntimeSettingsUpdate) =>
    request<RuntimeSettingsWire>('/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }).then(normalizeRuntimeSettings),
  testGrok2api: () =>
    request<{
      ok: boolean
      baseUrl: string
      grokBuild: Record<string, unknown>
    }>('/settings/test-grok2api', { method: 'POST' }),
  chatProviders: () => request<ChatProvider[]>('/chat/providers'),
  revealChatProviderApiKey: (id: string) =>
    request<{ value: string }>(`/chat/providers/${id}/api-key`),
  createChatProvider: (body: ChatProviderInput) =>
    request<ChatProvider>('/chat/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateChatProvider: (id: string, body: Partial<ChatProviderInput>) =>
    request<ChatProvider>(`/chat/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteChatProvider: (id: string) =>
    request<void>(`/chat/providers/${id}`, { method: 'DELETE' }),
  syncChatProviderModels: (id: string) =>
    request<ChatProvider>(`/chat/providers/${id}/sync-models`, {
      method: 'POST',
    }),
  chatModels: (providerId = '') =>
    request<ChatModel[]>(`/chat/models${query({ providerId })}`),
  chatUrl: `${API_BASE}/chat/completions`,
}
