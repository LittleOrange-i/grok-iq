import { useEffect, useState, type FormEvent } from 'react'
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ServerCog,
  Settings2,
  Square,
  Trash2,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ChatProvider, ProbeProfile } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { cn, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { HtmlPreviewButton, MarkdownView } from '@/components/formatted-content'
import { PlaygroundField } from './playground-field'
import {
  assistantVariants,
  chatCompletionUrl,
  formatConversationActivity,
  isJsonObject,
} from './playground-support'
import type {
  Conversation,
  Message,
  PlaygroundSettings,
} from './playground-types'

export function ConversationNavigation({
  conversations,
  visibleConversations,
  activeId,
  selectedIds,
  search,
  streaming,
  allSelected,
  onSearchChange,
  onSelect,
  onSelectionChange,
  onSelectAll,
  onNew,
  onBulkDelete,
}: {
  conversations: Conversation[]
  visibleConversations: Conversation[]
  activeId?: string
  selectedIds: string[]
  search: string
  streaming: boolean
  allSelected: boolean
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  onSelectionChange: (ids: string[]) => void
  onSelectAll: () => void
  onNew: () => void
  onBulkDelete: () => void
}) {
  const [managing, setManaging] = useState(false)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-16 shrink-0 items-center justify-between gap-2 ps-3 pe-14'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <MessageSquareText className='size-4 text-primary' />
            <h1 className='truncate text-sm font-semibold'>聊天广场</h1>
          </div>
          <p className='mt-0.5 text-[11px] text-muted-foreground'>
            本地会话 {conversations.length}
          </p>
        </div>
        <ActionToolbar label='聊天会话操作'>
          <ToolbarAction
            label={managing ? '退出会话管理' : '管理会话'}
            active={managing}
            disabled={streaming}
            onClick={() => {
              setManaging((current) => !current)
              onSelectionChange([])
            }}
          >
            <ListChecks />
          </ToolbarAction>
          <ToolbarAction label='新建会话' disabled={streaming} onClick={onNew}>
            <MessageSquarePlus />
          </ToolbarAction>
        </ActionToolbar>
      </div>

      <div className='shrink-0 px-2 pb-2'>
        <div className='relative'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder='搜索会话'
            className='h-8 ps-8 text-xs'
          />
        </div>
      </div>

      {managing && (
        <div className='mx-2 mb-2 flex h-9 items-center gap-2 rounded-md bg-muted px-2 text-xs'>
          <button
            type='button'
            className='font-medium hover:text-primary'
            disabled={streaming || conversations.length === 0}
            onClick={onSelectAll}
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <span className='min-w-0 flex-1 text-muted-foreground'>
            已选 {selectedIds.length}
          </span>
          <ToolbarAction
            label={`删除 ${selectedIds.length} 个会话`}
            destructive
            disabled={streaming || selectedIds.length === 0}
            onClick={onBulkDelete}
          >
            <Trash2 />
          </ToolbarAction>
        </div>
      )}

      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-1 px-2 pb-3'>
          {visibleConversations.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group relative flex items-center rounded-md transition-colors hover:bg-muted/70',
                item.id === activeId && 'bg-accent'
              )}
            >
              {item.id === activeId && (
                <span className='absolute inset-y-2 start-0 w-0.5 rounded-full bg-primary' />
              )}
              {managing && (
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  disabled={streaming}
                  onCheckedChange={(value) =>
                    onSelectionChange(
                      value === true
                        ? selectedIds.includes(item.id)
                          ? selectedIds
                          : [...selectedIds, item.id]
                        : selectedIds.filter((id) => id !== item.id)
                    )
                  }
                  aria-label={`选择会话 ${item.title}`}
                  className='ms-3 shrink-0'
                />
              )}
              <button
                type='button'
                className='min-w-0 flex-1 px-3 py-2.5 text-left'
                onClick={() => {
                  if (!managing) {
                    onSelect(item.id)
                    return
                  }
                  onSelectionChange(
                    selectedIds.includes(item.id)
                      ? selectedIds.filter((id) => id !== item.id)
                      : [...selectedIds, item.id]
                  )
                }}
              >
                <div className='truncate text-sm font-medium'>{item.title}</div>
                <div className='mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <span className='min-w-0 flex-1 truncate font-mono'>
                    {item.model || '未选择模型'}
                  </span>
                  <span className='shrink-0'>
                    {formatConversationActivity(item.updatedAt)}
                  </span>
                </div>
              </button>
            </div>
          ))}
          {!visibleConversations.length && (
            <div className='px-3 py-10 text-center text-xs text-muted-foreground'>
              没有匹配的会话
            </div>
          )}
        </div>
      </ScrollArea>
      <div className='shrink-0 px-3 py-2 text-[10px] text-muted-foreground'>
        历史仅保存在当前浏览器
      </div>
    </div>
  )
}

export function RequestConfiguration({
  settings,
  setSettings,
  providers,
  providersLoading,
  selectedProvider,
  selectedProviderId,
  selectedModel,
  modelNames,
  modelsLoading,
  onProviderChange,
  onModelChange,
  onManageProviders,
}: {
  settings: PlaygroundSettings
  setSettings: (
    value:
      PlaygroundSettings | ((current: PlaygroundSettings) => PlaygroundSettings)
  ) => void
  providers: ChatProvider[]
  providersLoading: boolean
  selectedProvider?: ChatProvider
  selectedProviderId: string
  selectedModel: string
  modelNames: string[]
  modelsLoading: boolean
  onProviderChange: (providerId: string) => void
  onModelChange: (model: string) => void
  onManageProviders: () => void
}) {
  const enabledProviders = providers.filter((provider) => provider.enabled)
  const extraBodyValid = isJsonObject(settings.extraBody)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-14 shrink-0 items-center justify-between gap-2 border-b ps-4 pe-14'>
        <div className='flex items-center gap-2'>
          <Settings2 className='size-4 text-primary' />
          <h2 className='text-sm font-semibold'>请求配置</h2>
        </div>
        <ToolbarAction label='管理模型提供商' onClick={onManageProviders}>
          <ServerCog />
        </ToolbarAction>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-5 p-4'>
          <section className='space-y-3'>
            <ConfigurationHeading title='模型' />
            <PlaygroundField label='提供商'>
              <Select
                value={selectedProviderId}
                onValueChange={onProviderChange}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue
                    placeholder={
                      providersLoading ? '读取提供商中' : '选择提供商'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {enabledProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.isDefault ? ' · 默认' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PlaygroundField>
            <PlaygroundField label='模型'>
              <Select
                value={selectedModel}
                onValueChange={onModelChange}
                disabled={!selectedProviderId || modelsLoading}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue
                    placeholder={modelsLoading ? '读取模型中' : '选择模型'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {modelNames.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PlaygroundField>
          </section>

          {selectedProvider && (
            <section className='space-y-3'>
              <ConfigurationHeading title='请求目标' />
              <div className='space-y-2 text-xs'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground'>状态</span>
                  <Badge
                    variant={
                      selectedProvider.apiKeyConfigured
                        ? 'success'
                        : 'secondary'
                    }
                  >
                    {selectedProvider.apiKeyConfigured
                      ? 'API Key 已配置'
                      : '无 API Key'}
                  </Badge>
                </div>
                <div>
                  <div className='text-muted-foreground'>Chat Completions</div>
                  <div className='mt-1 font-mono text-[10px] leading-4 break-all'>
                    {chatCompletionUrl(selectedProvider.baseUrl)}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className='space-y-3'>
            <ConfigurationHeading title='上下文' />
            <PlaygroundField label='系统提示'>
              <Textarea
                value={settings.systemPrompt}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    systemPrompt: event.target.value,
                  }))
                }
                className='min-h-32 resize-y text-xs'
                placeholder='可选'
              />
            </PlaygroundField>
          </section>

          <section className='space-y-3'>
            <div className='flex items-center justify-between gap-2'>
              <ConfigurationHeading title='附加参数' />
              <Badge variant={extraBodyValid ? 'success' : 'destructive'}>
                {extraBodyValid ? <Check className='size-3' /> : null}
                {extraBodyValid ? 'JSON 有效' : 'JSON 无效'}
              </Badge>
            </div>
            <Textarea
              value={settings.extraBody}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  extraBody: event.target.value,
                }))
              }
              className='min-h-40 resize-y font-mono text-[11px] leading-5'
              spellCheck={false}
            />
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function ConfigurationHeading({ title }: { title: string }) {
  return (
    <h3 className='text-[11px] font-semibold text-muted-foreground uppercase'>
      {title}
    </h3>
  )
}

export function Composer({
  input,
  streaming,
  providers,
  providersLoading,
  providerId,
  model,
  modelNames,
  modelsLoading,
  requestValid,
  onInputChange,
  onProviderChange,
  onModelChange,
  onSubmit,
  onStop,
}: {
  input: string
  streaming: boolean
  providers: ChatProvider[]
  providersLoading: boolean
  providerId: string
  model: string
  modelNames: string[]
  modelsLoading: boolean
  requestValid: boolean
  onInputChange: (value: string) => void
  onProviderChange: (providerId: string) => void
  onModelChange: (model: string) => void
  onSubmit: (event?: FormEvent) => void
  onStop: () => void
}) {
  return (
    <form
      onSubmit={onSubmit}
      className='shrink-0 border-t bg-background/95 p-3 backdrop-blur'
    >
      <div className='mx-auto w-full max-w-4xl overflow-hidden rounded-lg border bg-card shadow-xs'>
        <Textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey
            ) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder='发送消息...'
          disabled={streaming}
          className='max-h-44 min-h-24 resize-none border-0 shadow-none focus-visible:ring-0'
        />
        <div className='flex items-center gap-2 border-t px-2.5 py-2'>
          <div className='flex min-w-0 flex-1 items-center gap-1.5'>
            <Select
              value={providerId}
              onValueChange={onProviderChange}
              disabled={streaming}
            >
              <SelectTrigger
                size='sm'
                aria-label='快速切换模型提供商'
                className='w-[min(8rem,28vw)] border-0 bg-muted/60 px-2 shadow-none sm:w-44'
              >
                <SelectValue
                  placeholder={providersLoading ? '读取提供商中' : '提供商'}
                />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className='text-xs text-muted-foreground'>/</span>
            <Select
              value={model}
              onValueChange={onModelChange}
              disabled={streaming || !providerId || modelsLoading}
            >
              <SelectTrigger
                size='sm'
                aria-label='快速切换模型'
                className='w-[min(10rem,34vw)] min-w-0 border-0 bg-muted/60 px-2 font-mono shadow-none sm:w-56'
              >
                <SelectValue
                  placeholder={modelsLoading ? '读取模型中' : '模型'}
                />
              </SelectTrigger>
              <SelectContent>
                {modelNames.map((modelName) => (
                  <SelectItem key={modelName} value={modelName}>
                    {modelName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {streaming ? (
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='shrink-0'
              onClick={onStop}
            >
              <Square />
              停止
            </Button>
          ) : (
            <Button
              type='submit'
              size='sm'
              className='shrink-0'
              disabled={!input.trim() || !providerId || !model || !requestValid}
            >
              <Send />
              发送
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

export function EmptyPlayground({
  profiles,
  onPick,
}: {
  profiles: ProbeProfile[]
  onPick: (profile: ProbeProfile) => void
}) {
  return (
    <div className='flex min-h-full items-center justify-center p-6 sm:p-8'>
      <div className='w-full max-w-3xl text-center'>
        <div className='mx-auto flex size-10 items-center justify-center rounded-lg border bg-background'>
          <MessageSquarePlus className='size-5 text-muted-foreground' />
        </div>
        <h2 className='mt-4 text-lg font-semibold'>新建对话</h2>
        <p className='mt-2 text-sm text-muted-foreground'>
          选择探针方案填充请求，或直接输入消息。
        </p>
        <div className='mt-6 grid gap-3 sm:grid-cols-2'>
          {profiles
            .filter((item) => item.enabled)
            .map((profile) => (
              <button
                type='button'
                key={profile.id}
                onClick={() => onPick(profile)}
                className='rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent'
              >
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-medium'>{profile.name}</span>
                  {profile.expected_image_url && (
                    <ImageIcon className='size-4 text-primary' />
                  )}
                </div>
                <p className='mt-2 line-clamp-2 text-sm text-muted-foreground'>
                  {profile.prompt}
                </p>
                <div className='mt-3 font-mono text-xs text-primary'>
                  {profile.model}
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

export function ChatBubble({
  message,
  disabled,
  expectedImageUrl,
  onRegenerate,
  onDelete,
  onSelectVariant,
}: {
  message: Message
  disabled: boolean
  expectedImageUrl?: string
  onRegenerate: () => void
  onDelete: () => void
  onSelectVariant: (index: number) => void
}) {
  const user = message.role === 'user'
  const variants = assistantVariants(message)
  const activeIndex = Math.min(message.activeVariant ?? 0, variants.length - 1)
  const variant = user ? null : variants[activeIndex]
  const content = user ? message.content : (variant?.content ?? '')
  const reasoning = user ? '' : (variant?.reasoning ?? '')
  const status = user ? 'done' : variant?.status
  return (
    <article
      className={cn('flex w-full gap-3 sm:gap-4', user && 'justify-end')}
    >
      <div
        className={cn(
          'mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted sm:size-10',
          user && 'order-2'
        )}
      >
        {user ? (
          <UserRound className='size-4.5 text-muted-foreground' />
        ) : (
          <Bot className='size-4.5 text-muted-foreground' />
        )}
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-col',
          user
            ? 'max-w-[88%] items-end sm:max-w-[74%] lg:max-w-[64%]'
            : 'w-fit max-w-[calc(100%_-_3.25rem)] sm:max-w-[90%] lg:max-w-[86%]'
        )}
      >
        <div
          className={cn(
            'max-w-full min-w-0 overflow-hidden rounded-lg px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere] sm:px-5 sm:py-4',
            user ? 'bg-primary text-primary-foreground' : 'bg-card',
            status === 'error' && 'ring-1 ring-destructive/50'
          )}
        >
          {!user && reasoning && (
            <ReasoningPanel
              content={reasoning}
              streaming={status === 'streaming'}
            />
          )}
          {content ? (
            !user && status === 'streaming' ? (
              <StreamingText content={content} />
            ) : (
              <MarkdownView
                content={content}
                className='max-w-full [overflow-wrap:anywhere] [&_code]:break-all [&_pre]:max-w-full [&_pre_code]:break-normal [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto'
              />
            )
          ) : (
            !user &&
            status !== 'streaming' && (
              <span className='text-sm text-muted-foreground'>
                本次响应没有可见正文
              </span>
            )
          )}
          {status === 'streaming' && (
            <span className='mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground'>
              <Loader2 className='size-3 animate-spin' />
              {content
                ? '正在流式输出'
                : reasoning
                  ? '正在组织回答'
                  : '等待响应'}
            </span>
          )}
        </div>
        <div className='mt-1 flex items-center gap-1'>
          <Button
            size='icon'
            variant='ghost'
            className='size-7'
            disabled={!content}
            onClick={() => {
              void copyText(content)
                .then(() => toast.success('已复制'))
                .catch((error) => toast.error(getErrorMessage(error)))
            }}
            aria-label='复制消息'
            title='复制'
          >
            <Copy className='size-3.5' />
          </Button>
          {!user && (
            <Button
              size='icon'
              variant='ghost'
              className='size-7'
              disabled={disabled}
              onClick={onRegenerate}
              aria-label='重新生成回复'
              title='重新生成'
            >
              <RefreshCw className='size-3.5' />
            </Button>
          )}
          <HtmlPreviewButton
            content={content}
            expectedImageUrl={expectedImageUrl}
          />
          <Button
            size='icon'
            variant='ghost'
            className='size-7 text-destructive'
            disabled={disabled}
            onClick={onDelete}
            aria-label='删除消息'
            title='删除'
          >
            <Trash2 className='size-3.5' />
          </Button>
          {!user && variants.length > 1 && (
            <div className='ms-1 flex items-center rounded-md border text-xs'>
              <Button
                size='icon'
                variant='ghost'
                className='size-7'
                disabled={activeIndex <= 0 || disabled}
                onClick={() => onSelectVariant(activeIndex - 1)}
                aria-label='查看上一个回复版本'
              >
                <ChevronLeft />
              </Button>
              <span className='px-1 tabular-nums'>
                {activeIndex + 1}/{variants.length}
              </span>
              <Button
                size='icon'
                variant='ghost'
                className='size-7'
                disabled={activeIndex >= variants.length - 1 || disabled}
                onClick={() => onSelectVariant(activeIndex + 1)}
                aria-label='查看下一个回复版本'
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function ReasoningPanel({
  content,
  streaming,
}: {
  content: string
  streaming: boolean
}) {
  const [open, setOpen] = useState(streaming)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(streaming)
  }, [streaming])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='mb-3'>
      <div className='overflow-hidden rounded-md bg-muted/35'>
        <CollapsibleTrigger asChild>
          <button
            type='button'
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground'
          >
            <BrainCircuit className='size-3.5 text-primary' />
            <span>思考过程</span>
            {streaming && (
              <span className='ms-auto inline-flex items-center gap-1 text-primary'>
                <Loader2 className='size-3 animate-spin' />
                接收中
              </span>
            )}
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform',
                open && 'rotate-180',
                !streaming && 'ms-auto'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className='max-h-80 overflow-y-auto overscroll-contain px-3 pb-2.5 text-xs leading-5'>
            {content ? (
              <div className='[overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground'>
                {content}
                {streaming && <StreamingCursor />}
              </div>
            ) : (
              <span className='text-muted-foreground'>正在等待思考片段…</span>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function StreamingText({ content }: { content: string }) {
  return (
    <div className='min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap'>
      {content}
      <StreamingCursor />
    </div>
  )
}

function StreamingCursor() {
  return (
    <span
      className='ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle'
      aria-hidden='true'
    />
  )
}
