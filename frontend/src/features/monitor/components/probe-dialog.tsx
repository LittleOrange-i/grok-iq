import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CircleHelp,
  Layers3,
  ListChecks,
  Play,
  RefreshCw,
  Route,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  type EgressNode,
  type ExecutionMode,
  type ProbeProfile,
} from '@/lib/api'
import { getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ProfileMultiSelect } from '@/features/monitor/components/profile-multi-select'

type ProbeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountIds: number[]
  disabledAccountCount?: number
  sourceTaskCount?: number
  profiles: ProbeProfile[]
  egress: EgressNode[]
  egressLoading: boolean
  egressError: string
  onRefreshEgress: () => void
  onCreated: () => void
}

export function ProbeDialog({
  open,
  onOpenChange,
  accountIds,
  disabledAccountCount = 0,
  sourceTaskCount = 0,
  profiles,
  egress,
  egressLoading,
  egressError,
  onRefreshEgress,
  onCreated,
}: ProbeDialogProps) {
  const [profileIds, setProfileIds] = useState<string[]>(['quality-marker'])
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('chat')
  const [rounds, setRounds] = useState(3)
  const [direct, setDirect] = useState(true)
  const [nodes, setNodes] = useState<number[]>([])
  const selectableEgress = egress.filter(
    (node) => node.enabled && node.proxyConfigured
  )
  const selectableNodeIds = new Set(
    selectableEgress.map((node) => Number(node.id))
  )
  const selectedNodes = nodes.filter((id) => selectableNodeIds.has(id))
  const enabledProfiles = profiles.filter((profile) => profile.enabled)
  const enabledProfileIdSet = new Set(
    enabledProfiles.map((profile) => profile.id)
  )
  const selectedProfileIds = profileIds.filter((id) =>
    enabledProfileIdSet.has(id)
  )
  const quickProfile =
    enabledProfiles.find((profile) => profile.id === 'quality-marker') ??
    enabledProfiles[0]
  const effectiveProfileIds =
    executionMode === 'quality_test'
      ? quickProfile
        ? [quickProfile.id]
        : []
      : selectedProfileIds
  const qualityTestAvailable =
    selectableEgress.length > 0 && quickProfile != null

  useEffect(() => {
    if (!open) return
    const availableProfiles = profiles.filter((profile) => profile.enabled)
    const availableProfileIdSet = new Set(
      availableProfiles.map((profile) => profile.id)
    )
    // Opening the dialog reconciles the draft against the latest profile query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileIds((current) => {
      const valid = current.filter((id) => availableProfileIdSet.has(id))
      if (valid.length) return valid
      const fallback =
        availableProfiles.find(
          (profile) => profile.id === 'quality-marker'
        ) ?? availableProfiles[0]
      return fallback ? [fallback.id] : []
    })
  }, [open, profiles])

  const mutation = useMutation({
    mutationFn: async () => {
      const proxyTargets = [
        ...(executionMode === 'chat' && direct
          ? [{ kind: 'direct', id: null }]
          : []),
        ...selectedNodes.map((id) => ({ kind: 'egress', id })),
      ]
      if (!proxyTargets.length) {
        throw new Error(
          executionMode === 'quality_test'
            ? '快速出口质量探针至少选择一个出口节点'
            : '至少选择一个上游调度或固定出口目标'
        )
      }
      if (!effectiveProfileIds.length) {
        throw new Error(
          executionMode === 'quality_test'
            ? '当前没有已启用的快速质量基线'
            : '至少选择一个已启用的探针方案'
        )
      }
      return api.createRunsBatch({
        account_ids: accountIds,
        profile_id: effectiveProfileIds[0],
        profile_ids: effectiveProfileIds,
        execution_mode: executionMode,
        rounds,
        proxy_targets: proxyTargets,
      })
    },
    onSuccess: (result) => {
      const skipped = result.skipped
        ? `，跳过 ${result.skipped} 个账号`
        : ''
      if (result.created) {
        toast.success(`已批量创建 ${result.created} 个探针任务${skipped}`)
      } else {
        toast.info(`本次未创建新任务${skipped}`)
      }
      onCreated()
      onOpenChange(false)
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const targetCount =
    (executionMode === 'chat' && direct ? 1 : 0) + selectedNodes.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size='wide'
        className='flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden'
      >
        <DialogHeader className='shrink-0'>
          <DialogTitle>创建多轮代理探针</DialogTitle>
          <DialogDescription>
            每个“账号 × 方案”生成一个持久任务；相同账号串行执行，并持久记录账号原设置用于自动或人工恢复。
          </DialogDescription>
        </DialogHeader>
        <div className='grid min-h-0 gap-5 overflow-y-auto py-2 pr-1'>
          <div className='grid gap-2'>
            <label className='text-sm font-medium'>执行模式</label>
            <Select
              value={executionMode}
              onValueChange={(value: ExecutionMode) => {
                setExecutionMode(value)
                if (value === 'chat') {
                  setDirect(true)
                } else if (!selectedNodes.length) {
                  setNodes(selectableEgress.map((node) => Number(node.id)))
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='chat'>完整对话探针</SelectItem>
                <SelectItem
                  value='quality_test'
                  disabled={!qualityTestAvailable}
                >
                  快速出口质量探针
                  {!qualityTestAvailable ? '（缺少出口或内置基线）' : ''}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className='text-xs leading-5 text-muted-foreground'>
              {executionMode === 'chat'
                ? '临时固定账号与出口后调用 /v1/chat/completions，保存可预览的完整回复和流式指标。'
                : '通过 grok2api 出口 quality-test 接口获取哈希和指标，并使用审计记录核验实际账号与出口。'}
            </p>
          </div>
          {executionMode === 'chat' ? (
            <div className='grid gap-2'>
              <label className='text-sm font-medium'>
                探针方案
                <span className='ms-1 text-destructive' aria-hidden='true'>
                  *
                </span>
              </label>
              <ProfileMultiSelect
                profiles={profiles}
                value={selectedProfileIds}
                onChange={setProfileIds}
                enabledOnly
                invalid={!selectedProfileIds.length}
              />
              <p className='text-xs leading-5 text-muted-foreground'>
                多选后按账号与方案组合拆分为独立任务，检测结果仍分别归属到具体方案。
              </p>
            </div>
          ) : (
            <div className='flex items-start gap-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3'>
              <Layers3 className='mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400' />
              <div className='min-w-0'>
                <div className='text-sm font-medium'>自动使用快速质量基线</div>
                <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                  {quickProfile
                    ? `${quickProfile.name} · ${quickProfile.model}`
                    : '当前没有已启用的内置质量基线'}
                </p>
              </div>
            </div>
          )}
          <div className='grid gap-2'>
            <label className='text-sm font-medium'>轮数</label>
            <Input
              type='number'
              min={1}
              max={20}
              value={rounds}
              onChange={(event) =>
                setRounds(Math.max(1, Math.min(20, Number(event.target.value))))
              }
            />
          </div>
          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2'>
                <label className='text-sm font-medium'>出口目标</label>
                {!egressLoading && (
                  <span className='text-xs text-muted-foreground'>
                    {selectableEgress.length} 个可用
                  </span>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    disabled={egressLoading}
                    onClick={onRefreshEgress}
                    aria-label='刷新出口节点'
                  >
                    <RefreshCw
                      className={egressLoading ? 'animate-spin' : undefined}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>刷新 grok2api 出口节点</TooltipContent>
              </Tooltip>
            </div>
            {egressError && (
              <div className='flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive'>
                <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                <span>{egressError}</span>
              </div>
            )}
            {executionMode === 'chat' ? (
              <label className='flex items-center gap-2 rounded-lg border p-3 text-sm'>
                <Checkbox
                  checked={direct}
                  onCheckedChange={(value) => setDirect(value === true)}
                />
                <Route className='size-4 text-muted-foreground' />
                <span className='font-medium'>上游调度</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className='inline-flex size-6 cursor-help items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground'
                      tabIndex={0}
                      aria-label='上游调度说明'
                    >
                      <CircleHelp className='size-3.5' />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className='max-w-80'>
                    临时解除账号的固定出口绑定，由 grok2api
                    从可用出口池或回退策略选择；任务会从审计记录保存实际出口。
                  </TooltipContent>
                </Tooltip>
              </label>
            ) : (
              <div className='rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-5 text-muted-foreground'>
                快速模式由 grok2api 的出口节点接口执行，仅支持已配置代理的
                grok_build 出口，不包含上游调度目标。
              </div>
            )}
            {selectableEgress.length ? (
              <div className='grid max-h-56 gap-2 overflow-auto sm:grid-cols-2'>
                {selectableEgress.map((node) => {
                  const id = Number(node.id)
                  return (
                    <label
                      key={node.id}
                      className='flex items-center gap-2 rounded-lg border p-3 text-sm'
                    >
                      <Checkbox
                        checked={nodes.includes(id)}
                        onCheckedChange={(value) =>
                          setNodes((current) =>
                            value
                              ? [...current, id]
                              : current.filter((item) => item !== id)
                          )
                        }
                      />
                      <span className='min-w-0 flex-1 truncate'>
                        {node.name}
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {node.exitIp || `#${id}`}
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className='flex items-start gap-3 rounded-lg border border-dashed p-3'>
                {egressLoading ? (
                  <RefreshCw className='mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground' />
                ) : (
                  <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-500' />
                )}
                <div className='min-w-0 flex-1'>
                  <div className='text-sm font-medium'>
                    {egressLoading ? '正在读取出口节点' : '暂无可选固定出口'}
                  </div>
                  <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                    {egressLoading
                      ? '正在从 grok2api 同步最新的出口节点配置。'
                      : 'grok2api 当前没有已启用且已配置代理的 grok_build 出口节点。完整对话探针仍可使用上游调度。'}
                  </p>
                  {executionMode === 'quality_test' && (
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='mt-2'
                      onClick={() => {
                        setExecutionMode('chat')
                        setDirect(true)
                      }}
                    >
                      <Route />
                      使用上游调度
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className='flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3'>
            {sourceTaskCount > 0 && (
              <ProbeSummaryFact
                icon={ListChecks}
                value={sourceTaskCount}
                tooltip='已选任务数；其中重复账号已按账号 ID 合并'
              />
            )}
            <ProbeSummaryFact
              icon={UsersRound}
              value={accountIds.length}
              tooltip='去重后的账号数'
            />
            {executionMode === 'chat' && (
              <ProbeSummaryFact
                icon={Layers3}
                value={selectedProfileIds.length}
                tooltip='每个账号使用的探针方案数'
              />
            )}
            <ProbeSummaryFact
              icon={RefreshCw}
              value={rounds}
              tooltip='每个账号的测试轮数'
            />
            <ProbeSummaryFact
              icon={Route}
              value={targetCount}
              tooltip='每轮出口目标数'
            />
            <ProbeSummaryFact
              icon={Play}
              value={
                accountIds.length *
                effectiveProfileIds.length *
                rounds *
                targetCount
              }
              tooltip={
                executionMode === 'chat'
                  ? '/v1/chat/completions 请求总数'
                  : '出口质量请求总数'
              }
            />
            {disabledAccountCount > 0 && (
              <ProbeSummaryFact
                icon={ShieldAlert}
                value={disabledAccountCount}
                tooltip='停用账号数；请求前使用负优先级和单并发短时激活，请求后恢复原设置'
                warning
              />
            )}
          </div>
          {accountIds.length === 1 &&
            (effectiveProfileIds.length > 1 || targetCount > 1) && (
              <div className='flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3'>
                <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400' />
                <div className='min-w-0 text-xs leading-5 text-muted-foreground'>
                  <div className='font-medium text-foreground'>
                    单账号任务按顺序执行
                  </div>
                  多个方案会拆成 {effectiveProfileIds.length}{' '}
                  个任务，每个任务中的出口也按轮次依次切换。账号出口和原设置属于共享状态，因此即使配置多个
                  Worker，也不会同时接管同一个账号；选择多个账号后才会并行。
                </div>
              </div>
            )}
        </div>
        <DialogFooter className='shrink-0'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !accountIds.length ||
              !effectiveProfileIds.length ||
              targetCount === 0
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '创建中…' : '加入队列'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProbeSummaryFact({
  icon: Icon,
  value,
  tooltip,
  warning = false,
}: {
  icon: LucideIcon
  value: ReactNode
  tooltip: string
  warning?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium tabular-nums ${warning ? 'border-amber-500/30 text-amber-700 dark:text-amber-300' : ''}`}
          tabIndex={0}
        >
          <Icon className='size-3.5' />
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-72'>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
