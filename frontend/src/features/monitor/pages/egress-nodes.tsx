import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  CircleHelp,
  FlaskConical,
  Loader2,
  Network,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type EgressNode } from '@/lib/api'
import { cn, formatDate, formatNumber, getErrorMessage } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState, LoadingState, Page, PageHeader } from '@/components/page'
import { SelectionToolbar } from '@/components/selection-toolbar'
import { ServerPagination } from '@/components/server-pagination'
import { Switch } from '@/components/ui/switch'

type NodeAction = {
  kind: 'enable' | 'disable' | 'delete'
  nodes: EgressNode[]
}

const emptyCreateForm = {
  name: '',
  proxyUrl: '',
  proxyPool: true,
  accountCapacity: 0,
  enabled: true,
}

export function EgressNodesPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [deferredSearch] = useDebouncedValue(search.trim())
  const [enabled, setEnabled] = useState('all')
  const [probe, setProbe] = useState('all')
  const [selected, setSelected] = useState<number[]>([])
  const [action, setAction] = useState<NodeAction | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreateForm)

  const query = useQuery({
    queryKey: ['egress-nodes', page, pageSize, deferredSearch, enabled, probe],
    queryFn: () =>
      api.egress({
        page,
        pageSize,
        search: deferredSearch,
        enabled:
          enabled === 'all' ? '' : enabled === 'true' ? 'enabled' : 'disabled',
        probe: probe === 'all' ? '' : probe,
      }),
    placeholderData: (previous) => previous,
  })
  const nodes = query.data?.items ?? []
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedNodes = nodes.filter((node) => selectedSet.has(Number(node.id)))
  const allChecked =
    nodes.length > 0 &&
    nodes.every((node) => selectedSet.has(Number(node.id)))

  const createMutation = useMutation({
    mutationFn: () =>
      api.createEgressNode({
        name: createForm.name.trim(),
        proxy_url: createForm.proxyUrl.trim(),
        proxy_pool: createForm.proxyPool,
        account_capacity: createForm.accountCapacity,
        enabled: createForm.enabled,
      }),
    onSuccess: (node) => {
      setCreateOpen(false)
      setCreateForm(emptyCreateForm)
      toast.success(`已新增上游节点 ${node.name}`)
      void queryClient.invalidateQueries({ queryKey: ['egress-nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['egress'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ nodeIds, value }: { nodeIds: number[]; value: boolean }) =>
      api.updateEgressNodes(nodeIds, value),
    onSuccess: (result, variables) => {
      const skipped = result.skippedNodeIds ?? []
      setAction(null)
      setSelected(skipped)
      const verb = variables.value ? '启用' : '停用'
      if (skipped.length) {
        toast.warning(
          `已${verb} ${result.updated} 个节点；${skipped.length} 个被探针引用的节点已跳过并保留选择`
        )
      } else {
        toast.success(`已${verb} ${result.updated} 个上游节点`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['egress-nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['egress'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (nodeIds: number[]) => api.deleteEgressNodes(nodeIds),
    onSuccess: (result) => {
      const skipped = result.skippedNodeIds ?? []
      setAction(null)
      setSelected(skipped)
      if (page > 1 && result.deleted >= nodes.length) setPage(page - 1)
      if (skipped.length) {
        toast.warning(
          `已删除 ${result.deleted} 个节点；${skipped.length} 个被探针引用的节点已跳过并保留选择`
        )
      } else {
        toast.success(`已删除 ${result.deleted} 个上游节点`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['egress-nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['egress'] })
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  const testMutation = useMutation({
    mutationFn: (node: EgressNode) =>
      api.testEgressNode(Number(node.id)).then((result) => ({ node, result })),
    onSuccess: ({ node, result }) => {
      if (result.status === 'healthy') {
        toast.success(
          `${node.name} 探测正常${result.latencyMs ? `，${result.latencyMs} ms` : ''}${result.exitIp ? `，出口 ${result.exitIp}` : ''}`
        )
      } else {
        toast.warning(`${node.name} 探测异常：${result.error || '未返回错误明细'}`)
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['egress-nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['egress'] })
    },
  })

  const actionPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending
  const assignedAccounts = action?.nodes.reduce(
    (total, node) => total + (node.assignedAccountCount ?? 0),
    0
  )

  return (
    <Page>
      <PageHeader
        title='上游节点'
        description='管理 grok2api 的 Grok Build 出口节点与网络探测状态。'
        actions={
          <ActionToolbar label='上游节点操作'>
            <ToolbarAction
              label='新增 Grok Build 节点'
              disabled={actionPending}
              onClick={() => {
                setCreateForm(emptyCreateForm)
                setCreateOpen(true)
              }}
            >
              <Plus />
            </ToolbarAction>
            <ToolbarAction
              label='刷新上游节点'
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw />
            </ToolbarAction>
          </ActionToolbar>
        }
      />

      <SelectionToolbar
        selectedCount={selected.length}
        entityLabel='节点'
        disabled={actionPending}
        onClear={() => setSelected([])}
      >
        <ToolbarAction
          label={`启用 ${selected.length} 个已选节点`}
          disabled={actionPending}
          onClick={() => setAction({ kind: 'enable', nodes: selectedNodes })}
        >
          <Power />
        </ToolbarAction>
        <ToolbarAction
          label={`停用 ${selected.length} 个已选节点`}
          disabled={actionPending}
          onClick={() => setAction({ kind: 'disable', nodes: selectedNodes })}
        >
          <PowerOff />
        </ToolbarAction>
        <ToolbarAction
          label={`删除 ${selected.length} 个已选节点`}
          destructive
          disabled={actionPending}
          onClick={() => setAction({ kind: 'delete', nodes: selectedNodes })}
        >
          <Trash2 />
        </ToolbarAction>
      </SelectionToolbar>

      <Card>
        <CardContent className='p-4'>
          <div className='mb-4 flex flex-col gap-3 md:flex-row'>
            <div className='relative flex-1'>
              <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                  setSelected([])
                }}
                placeholder='搜索节点名称或出口 IP'
                className='pl-9'
              />
            </div>
            <Select
              value={enabled}
              onValueChange={(value) => {
                setEnabled(value)
                setPage(1)
                setSelected([])
              }}
            >
              <SelectTrigger className='w-full md:w-40'>
                <Power className='size-4 text-muted-foreground' />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部启停状态</SelectItem>
                <SelectItem value='true'>已启用</SelectItem>
                <SelectItem value='false'>已停用</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={probe}
              onValueChange={(value) => {
                setProbe(value)
                setPage(1)
                setSelected([])
              }}
            >
              <SelectTrigger className='w-full md:w-40'>
                <Activity className='size-4 text-muted-foreground' />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部探测状态</SelectItem>
                <SelectItem value='healthy'>健康</SelectItem>
                <SelectItem value='unhealthy'>异常</SelectItem>
                <SelectItem value='unknown'>未探测</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {query.isLoading && !query.data ? (
            <LoadingState />
          ) : query.isError ? (
            <EmptyState
              title='节点读取失败'
              description={getErrorMessage(query.error)}
            />
          ) : nodes.length ? (
            <>
              <Table rememberRowKey='monitor-egress-nodes'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-10'>
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={(value) =>
                          setSelected(
                            value === true
                              ? nodes.map((node) => Number(node.id))
                              : []
                          )
                        }
                        aria-label='选择当前页节点'
                      />
                    </TableHead>
                    <TableHead>节点</TableHead>
                    <TableHead>启停</TableHead>
                    <TableHead>健康度</TableHead>
                    <TableHead>网络探测</TableHead>
                    <TableHead>出口 IP</TableHead>
                    <TableHead>账号负载</TableHead>
                    <TableHead className='text-right'>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => {
                    const id = Number(node.id)
                    const testing =
                      testMutation.isPending &&
                      testMutation.variables?.id === node.id
                    return (
                      <TableRow key={node.id} rowId={node.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedSet.has(id)}
                            onCheckedChange={(value) =>
                              setSelected((current) =>
                                value === true
                                  ? Array.from(new Set([...current, id]))
                                  : current.filter((item) => item !== id)
                              )
                            }
                            aria-label={`选择节点 ${node.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className='flex items-center gap-2 font-medium'>
                            <Network className='size-4 text-muted-foreground' />
                            {node.name}
                          </div>
                          <div className='mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'>
                            <span>ID {node.id}</span>
                            {node.proxyPool && (
                              <Badge variant='outline'>代理池</Badge>
                            )}
                            {node.accountBoundProxy && (
                              <Badge variant='outline'>账号粘性</Badge>
                            )}
                            {node.sourceId && (
                              <Badge variant='outline'>订阅</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <NodeEnabledBadge enabled={node.enabled} />
                        </TableCell>
                        <TableCell>
                          <HealthIndicator node={node} />
                        </TableCell>
                        <TableCell>
                          <ProbeIndicator node={node} />
                        </TableCell>
                        <TableCell>
                          <div
                            className='max-w-56 truncate font-mono text-xs'
                            title={node.exitIp}
                          >
                            {node.exitIp || '—'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='font-medium tabular-nums'>
                            {node.assignedAccountCount ?? 0}
                            <span className='font-normal text-muted-foreground'>
                              {' '}/ {node.accountCapacity || '不限'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='inline-flex items-center gap-1'>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  disabled={testing || actionPending}
                                  onClick={() => testMutation.mutate(node)}
                                  aria-label={`探测节点 ${node.name}`}
                                >
                                  {testing ? (
                                    <Loader2 className='animate-spin' />
                                  ) : (
                                    <FlaskConical />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>执行网络探测</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  disabled={actionPending}
                                  onClick={() =>
                                    setAction({
                                      kind: node.enabled ? 'disable' : 'enable',
                                      nodes: [node],
                                    })
                                  }
                                  aria-label={`${node.enabled ? '停用' : '启用'}节点 ${node.name}`}
                                >
                                  {node.enabled ? <PowerOff /> : <Power />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {node.enabled ? '停用节点' : '启用节点'}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                                  disabled={actionPending}
                                  onClick={() =>
                                    setAction({ kind: 'delete', nodes: [node] })
                                  }
                                  aria-label={`删除节点 ${node.name}`}
                                >
                                  <Trash2 />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>删除节点</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <ServerPagination
                page={page}
                pageSize={pageSize}
                total={query.data?.total ?? 0}
                disabled={query.isFetching}
                loading={query.isFetching}
                itemLabel='节点'
                onPageChange={(value) => {
                  setPage(value)
                  setSelected([])
                }}
                onPageSizeChange={(value) => {
                  setPageSize(value)
                  setPage(1)
                  setSelected([])
                }}
              />
            </>
          ) : (
            <EmptyState
              title='未找到节点'
              description='请调整筛选条件或检查 grok2api 连接。'
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (createMutation.isPending) return
          setCreateOpen(open)
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>新增 Grok Build 节点</DialogTitle>
            <DialogDescription>
              代理凭据只发送给 grok2api，不在 Monitor 数据库保存或回显。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='egress-node-name'>节点名称</Label>
              <Input
                id='egress-node-name'
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder='例如 Resin Pool A'
                maxLength={160}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='egress-node-proxy'>代理地址</Label>
              <Input
                id='egress-node-proxy'
                type='password'
                autoComplete='new-password'
                value={createForm.proxyUrl}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    proxyUrl: event.target.value,
                  }))
                }
                placeholder='socks5h://pool.{account}:token@resin:2260'
              />
              <p className='text-xs text-muted-foreground'>
                使用 {'{account}'} 可让 grok2api 按账号生成稳定的 Resin 粘性身份。
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='egress-node-capacity'>账号容量</Label>
              <Input
                id='egress-node-capacity'
                type='number'
                min={0}
                max={100000}
                value={createForm.accountCapacity || ''}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    accountCapacity: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                placeholder='0 表示不限'
              />
            </div>
            <div className='divide-y rounded-md border'>
              <CreateSwitchRow
                label='代理池节点'
                description='同一逻辑节点可按账号映射到不同实际出口。'
                checked={createForm.proxyPool}
                onCheckedChange={(proxyPool) =>
                  setCreateForm((current) => ({ ...current, proxyPool }))
                }
              />
              <CreateSwitchRow
                label='创建后立即启用'
                description='启用后可参与新请求调度和账号绑定。'
                checked={createForm.enabled}
                onCheckedChange={(value) =>
                  setCreateForm((current) => ({ ...current, enabled: value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={createMutation.isPending}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              type='button'
              disabled={
                createMutation.isPending ||
                !createForm.name.trim() ||
                !createForm.proxyUrl.trim()
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className='animate-spin' />
              ) : (
                <Plus />
              )}
              新增节点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={action != null}
        onOpenChange={(open) => {
          if (!open && !actionPending) setAction(null)
        }}
        title={
          action?.kind === 'delete'
            ? `删除 ${action.nodes.length} 个上游节点？`
            : `${action?.kind === 'enable' ? '启用' : '停用'} ${action?.nodes.length ?? 0} 个上游节点？`
        }
        desc={
          action?.kind === 'delete' ? (
            <div className='space-y-2'>
              <p>删除后，grok2api 会解除这些节点上的账号绑定。</p>
              <p>
                当前共绑定 {assignedAccounts ?? 0}
                个账号；订阅导入的节点可能在后续同步时重新出现。
              </p>
              <p className='text-muted-foreground'>
                运行中或排队探针引用的节点会自动跳过。
              </p>
            </div>
          ) : (
            <div className='space-y-2'>
              <p>
                {action?.kind === 'enable'
                  ? '启用后，节点会重新参与 grok2api 调度。'
                  : '停用后，节点不再参与新请求调度，现有账号绑定会保留。'}
              </p>
              {action?.kind === 'disable' && (
                <p className='text-muted-foreground'>
                  运行中或排队探针引用的节点会自动跳过。
                </p>
              )}
            </div>
          )
        }
        destructive={action?.kind === 'delete'}
        isLoading={actionPending}
        cancelBtnText='取消'
        confirmText={
          actionPending
            ? '正在处理…'
            : action?.kind === 'delete'
              ? '确认删除'
              : '确认设置'
        }
        handleConfirm={() => {
          if (!action) return
          const nodeIds = action.nodes.map((node) => Number(node.id))
          if (action.kind === 'delete') {
            deleteMutation.mutate(nodeIds)
          } else {
            updateMutation.mutate({ nodeIds, value: action.kind === 'enable' })
          }
        }}
      />
    </Page>
  )
}

function CreateSwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-4 p-3'>
      <div>
        <div className='text-sm font-medium'>{label}</div>
        <div className='mt-1 text-xs text-muted-foreground'>{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function NodeEnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge
      variant='outline'
      className={cn(
        'gap-1.5',
        enabled
          ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          : 'border-zinc-500/30 text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          enabled ? 'bg-emerald-500' : 'bg-zinc-400'
        )}
      />
      {enabled ? '启用' : '停用'}
    </Badge>
  )
}

function HealthIndicator({ node }: { node: EgressNode }) {
  const unknown =
    (node.probeStatus || 'unknown') === 'unknown' &&
    !node.lastProbedAt &&
    !(node.failureCount ?? 0)
  if (unknown) {
    return (
      <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
        <CircleHelp className='size-3.5' />
        未评估
      </span>
    )
  }

  const health = Math.max(0, Math.min(1, node.health ?? 0))
  const percent = health * 100
  const tone =
    percent >= 80
      ? 'bg-emerald-500'
      : percent >= 50
        ? 'bg-amber-500'
        : 'bg-destructive'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex w-24 items-center gap-2' tabIndex={0}>
          <span className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
            <span
              className={cn('block h-full', tone)}
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className='w-8 text-right text-xs tabular-nums'>
            {formatNumber(percent, 0)}%
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-72 space-y-1'>
        <div>健康度 {formatNumber(percent, 0)}%</div>
        <div className='text-muted-foreground'>
          累计失败 {node.failureCount ?? 0} 次
        </div>
        {node.cooldownUntil && (
          <div className='text-muted-foreground'>
            冷却至 {formatDate(node.cooldownUntil)}
          </div>
        )}
        {node.lastError && (
          <div className='max-w-64 break-words'>{node.lastError}</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function ProbeIndicator({ node }: { node: EgressNode }) {
  const status = node.probeStatus || 'unknown'
  const label =
    status === 'healthy' ? '健康' : status === 'unhealthy' ? '异常' : '未探测'
  const tone =
    status === 'healthy'
      ? 'text-emerald-600 dark:text-emerald-400'
      : status === 'unhealthy'
        ? 'text-destructive'
        : 'text-muted-foreground'
  const Icon = status === 'unknown' ? CircleHelp : Activity
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('inline-flex items-center gap-1.5 text-xs', tone)}
          tabIndex={0}
        >
          <Icon className='size-3.5' />
          {label}
          {node.probeLatencyMs ? ` · ${node.probeLatencyMs} ms` : ''}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-72 space-y-1'>
        <div>
          {node.lastProbedAt
            ? `探测于 ${formatDate(node.lastProbedAt)}`
            : '尚未执行网络探测'}
        </div>
        {node.probeProvider && (
          <div className='text-muted-foreground'>来源 {node.probeProvider}</div>
        )}
        {node.probeError && (
          <div className='max-w-64 break-words'>{node.probeError}</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
