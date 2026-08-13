import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudCog,
  Copy,
  Eraser,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  ListChecks,
  MessageSquarePlus,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ServerCog,
  Settings2,
  Star,
  Square,
  Trash2,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ApiError,
  api,
  authorizationHeaders,
  isAuthenticationRequiredCode,
  notifyAuthenticationRequired,
  type ChatProvider,
  type ChatProviderInput,
  type ProbeProfile,
} from '@/lib/api'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  extractHtmlPreviews,
  HtmlPreviewButton,
  MarkdownView,
} from '@/components/formatted-content'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SelectionToolbar } from '@/components/selection-toolbar'

type Role = 'user' | 'assistant'
type Variant = {
  id: string
  content: string
  reasoning?: string
  status: 'streaming' | 'done' | 'error'
  createdAt: number
}

type CompletionStreamDelta = {
  content: string
  reasoning: string
}
type Message = {
  id: string
  role: Role
  content: string
  variants?: Variant[]
  activeVariant?: number
  createdAt: number
}
type Conversation = {
  id: string
  title: string
  providerId?: string
  model: string
  expectedImageUrl?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}
type PlaygroundSettings = {
  providerId: string
  model: string
  systemPrompt: string
  extraBody: string
}

const DB_NAME = 'gam-playground'
const STORE = 'state'
const CONVERSATIONS_KEY = 'conversations-v1'
const SETTINGS_KEY = 'gam-playground-settings'
const ACTIVE_KEY = 'gam-playground-active'
const AUTO_SCROLL_BOTTOM_THRESHOLD = 48

const defaultSettings: PlaygroundSettings = {
  providerId: '',
  model: '',
  systemPrompt: '',
  extraBody: '{}',
}

function isScrolledToBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_BOTTOM_THRESHOLD
  )
}

export function PlaygroundPage() {
  const [conversations, setConversations, hydrated] = useIndexedState<
    Conversation[]
  >(CONVERSATIONS_KEY, [createConversation()])
  const [activeId, setActiveId] = useLocalState(
    ACTIVE_KEY,
    conversations[0]?.id ?? ''
  )
  const [settings, setSettings] = useLocalState<PlaygroundSettings>(
    SETTINGS_KEY,
    defaultSettings
  )
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    string[]
  >([])
  const [bulkDeleteConversationsOpen, setBulkDeleteConversationsOpen] =
    useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles })
  const providers = useQuery({
    queryKey: ['chat-providers'],
    queryFn: api.chatProviders,
  })
  const active =
    conversations.find((item) => item.id === activeId) ?? conversations[0]
  const conversationIdSet = useMemo(
    () => new Set(conversations.map((conversation) => conversation.id)),
    [conversations]
  )
  const selectedConversations = conversations.filter((conversation) =>
    selectedConversationIds.includes(conversation.id)
  )
  const allConversationsSelected =
    conversations.length > 0 &&
    selectedConversations.length === conversations.length
  const enabledProviders = useMemo(
    () => (providers.data ?? []).filter((provider) => provider.enabled),
    [providers.data]
  )
  const activeProvider =
    enabledProviders.find((provider) => provider.id === active?.providerId) ??
    enabledProviders.find((provider) => provider.id === settings.providerId) ??
    enabledProviders.find((provider) => provider.isDefault) ??
    enabledProviders[0]
  const activeProviderId = activeProvider?.id || ''
  const models = useQuery({
    queryKey: ['chat-models', activeProviderId],
    queryFn: () => api.chatModels(activeProviderId),
    enabled: Boolean(activeProviderId),
  })
  const modelNames = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(activeProvider?.models ?? []),
            ...(models.data ?? []).map((item) =>
              String(item.id || item.name || '')
            ),
            active?.model || settings.model,
          ].filter(Boolean)
        )
      ),
    [active?.model, activeProvider?.models, models.data, settings.model]
  )

  useEffect(() => {
    if (
      hydrated &&
      !conversations.some((item) => item.id === activeId) &&
      conversations[0]
    )
      setActiveId(conversations[0].id)
  }, [activeId, conversations, hydrated, setActiveId])
  useEffect(() => {
    // Persisted conversations can change independently while this view is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedConversationIds((current) => {
      const next = current.filter((id) => conversationIdSet.has(id))
      return next.length === current.length ? current : next
    })
  }, [conversationIdSet])
  useEffect(() => {
    if (!enabledProviders.length) return
    if (
      settings.providerId &&
      enabledProviders.some((provider) => provider.id === settings.providerId)
    )
      return
    const fallback =
      enabledProviders.find((provider) => provider.isDefault) ??
      enabledProviders[0]
    setSettings((current) => ({
      ...current,
      providerId: fallback.id,
      model: fallback.models.includes(current.model)
        ? current.model
        : fallback.models[0] || '',
    }))
  }, [enabledProviders, setSettings, settings.providerId])
  useEffect(() => {
    if (!settings.model && modelNames[0])
      setSettings((current) => ({ ...current, model: modelNames[0] }))
  }, [modelNames, setSettings, settings.model])
  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stickToBottomRef.current) return
    element.scrollTo({
      top: element.scrollHeight,
      behavior: streaming ? 'auto' : 'smooth',
    })
  }, [active?.id, active?.messages, streaming])

  const followLatestMessage = () => {
    stickToBottomRef.current = true
  }
  const handleMessagesScroll = () => {
    const element = scrollRef.current
    if (!element) return
    stickToBottomRef.current = isScrolledToBottom(element)
  }

  const updateActive = (updater: (value: Conversation) => Conversation) => {
    if (!active) return
    setConversations((current) =>
      current.map((item) => (item.id === active.id ? updater(item) : item))
    )
  }
  const handleProviderChange = (
    providerId: string,
    providerOverride?: ChatProvider
  ) => {
    const provider =
      providerOverride ??
      enabledProviders.find((item) => item.id === providerId)
    const model = provider?.models[0] || ''
    setSettings((current) => ({ ...current, providerId, model }))
    if (active)
      updateActive((value) => ({
        ...value,
        providerId,
        model,
        updatedAt: Date.now(),
      }))
  }
  const handleModelChange = (model: string) => {
    setSettings((current) => ({ ...current, model }))
    if (active)
      updateActive((value) => ({ ...value, model, updatedAt: Date.now() }))
  }
  const newConversation = () => {
    const value = createConversation(settings.model, settings.providerId)
    followLatestMessage()
    setConversations((current) => [value, ...current])
    setActiveId(value.id)
    setInput('')
  }
  const selectConversation = (id: string) => {
    if (id === activeId) return
    followLatestMessage()
    setActiveId(id)
  }
  const deleteConversations = (ids: string[]) => {
    if (streaming || !ids.length) return
    const deletedIds = new Set(ids)
    const next = conversations.filter((item) => !deletedIds.has(item.id))
    const values = next.length
      ? next
      : [createConversation(settings.model, settings.providerId)]
    setConversations(values)
    setSelectedConversationIds((current) =>
      current.filter((id) => !deletedIds.has(id))
    )
    if (deletedIds.has(activeId)) {
      followLatestMessage()
      setActiveId(values[0].id)
    }
  }
  const deleteConversation = (id: string) => deleteConversations([id])

  const streamResponse = async (
    conversation: Conversation,
    assistantId: string,
    variantIndex: number
  ) => {
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    try {
      const extra = JSON.parse(settings.extraBody || '{}') as Record<
        string,
        unknown
      >
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Thread-ID': conversation.id,
        'X-Chat-Provider-ID':
          conversation.providerId || settings.providerId || '',
        ...authorizationHeaders(),
      }
      const response = await fetch(api.chatUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          ...extra,
          model: conversation.model || settings.model,
          stream: true,
          messages: requestMessages(
            conversation.messages,
            settings.systemPrompt
          ),
        }),
      })
      if (response.status === 401) {
        const authPayload = await response
          .clone()
          .json()
          .catch(() => null)
        if (isAuthenticationRequiredCode(authPayload?.code)) {
          notifyAuthenticationRequired(Boolean(authPayload.setupRequired))
          throw new ApiError(
            typeof authPayload.detail === 'string'
              ? authPayload.detail
              : '登录已失效',
            401,
            {
              code: authPayload.code,
              setupRequired: Boolean(authPayload.setupRequired),
            }
          )
        }
      }
      if (!response.ok) throw new Error(await readError(response))
      if (!response.body) throw new Error('响应不支持流式读取')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let pending: CompletionStreamDelta = { content: '', reasoning: '' }
      let raf = 0
      const flush = () => {
        raf = 0
        if (!pending.content && !pending.reasoning) return
        const delta = pending
        pending = { content: '', reasoning: '' }
        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id
              ? appendStreamDelta(item, assistantId, variantIndex, delta)
              : item
          )
        )
      }
      const complete = () => {
        if (raf) cancelAnimationFrame(raf)
        flush()
        markVariant(
          conversation.id,
          assistantId,
          variantIndex,
          'done',
          setConversations
        )
      }
      const consumeEvent = (event: string) => {
        const parsed = parseCompletionStreamEvent(event)
        if (!parsed) return false
        if (parsed.done) {
          complete()
          return true
        }
        pending.content += parsed.delta.content
        pending.reasoning += parsed.delta.reasoning
        if ((parsed.delta.content || parsed.delta.reasoning) && !raf) {
          raf = requestAnimationFrame(flush)
        }
        return false
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          if (consumeEvent(event)) return
        }
      }
      buffer += decoder.decode()
      buffer = buffer.replace(/\r\n/g, '\n')
      if (buffer.trim() && consumeEvent(buffer)) return
      complete()
    } catch (error) {
      const aborted =
        error instanceof DOMException && error.name === 'AbortError'
      const authenticationFailure =
        error instanceof ApiError && isAuthenticationRequiredCode(error.code)
      markVariant(
        conversation.id,
        assistantId,
        variantIndex,
        aborted ? 'done' : 'error',
        setConversations,
        aborted ? '' : `\n\n> ${getErrorMessage(error)}`
      )
      if (!aborted && !authenticationFailure) {
        toast.error(getErrorMessage(error))
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  const submit = async (value: string, clear = true) => {
    const content = value.trim()
    if (!content || !active || streaming) return
    const providerId = activeProviderId
    if (!providerId) {
      setSettingsOpen(true)
      toast.error('请先配置并选择模型提供商')
      return
    }
    const model = active.model || settings.model
    if (!model) {
      toast.error('请选择模型')
      return
    }
    const user = createMessage('user', content)
    const assistant = createMessage('assistant', '', 'streaming')
    const conversation: Conversation = {
      ...active,
      providerId,
      model,
      title: active.messages.length
        ? active.title
        : content.replace(/\s+/g, ' ').slice(0, 28),
      // This timestamp is created only when the user submits a message.
      // eslint-disable-next-line react-hooks/purity
      updatedAt: Date.now(),
      messages: [...active.messages, user],
    }
    followLatestMessage()
    setConversations((current) =>
      current.map((item) =>
        item.id === active.id
          ? { ...conversation, messages: [...conversation.messages, assistant] }
          : item
      )
    )
    if (clear) setInput('')
    await streamResponse(conversation, assistant.id, 0)
  }

  const regenerate = async (message: Message) => {
    if (!active || streaming || message.role !== 'assistant') return
    const index = active.messages.findIndex((item) => item.id === message.id)
    if (index < 0) return
    const variants = assistantVariants(message)
    const next: Variant = {
      id: id(),
      content: '',
      reasoning: '',
      status: 'streaming',
      // This timestamp is created only when the user requests regeneration.
      // eslint-disable-next-line react-hooks/purity
      createdAt: Date.now(),
    }
    const nextMessages = active.messages.map((item) =>
      item.id === message.id
        ? {
            ...item,
            variants: [...variants, next],
            activeVariant: variants.length,
            content: '',
          }
        : item
    )
    const conversation = {
      ...active,
      providerId: activeProviderId,
      messages: nextMessages.slice(0, index),
      // This timestamp is created only when the user requests regeneration.
      // eslint-disable-next-line react-hooks/purity
      updatedAt: Date.now(),
    }
    followLatestMessage()
    setConversations((current) =>
      current.map((item) =>
        item.id === active.id
          ? { ...active, providerId: activeProviderId, messages: nextMessages }
          : item
      )
    )
    await streamResponse(conversation, message.id, variants.length)
  }

  const pickProfile = (profile: ProbeProfile) => {
    setInput(profile.prompt)
    setSettings((current) => ({
      ...current,
      model: profile.model,
      systemPrompt: profile.system_prompt,
    }))
    if (active)
      updateActive((value) => ({
        ...value,
        model: profile.model,
        expectedImageUrl: profile.expected_image_url,
        updatedAt: Date.now(),
      }))
  }
  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault()
    void submit(input)
  }

  return (
    <div className='grid h-[calc(100dvh-4rem)] min-h-0 grid-cols-1 bg-background lg:grid-cols-[18rem_minmax(0,1fr)]'>
      <aside className='hidden min-h-0 flex-col border-r bg-muted/20 lg:flex'>
        <div className='flex items-center justify-between gap-2 p-4'>
          <div>
            <h1 className='text-base font-semibold'>聊天广场</h1>
            <p className='text-xs text-muted-foreground'>
              历史仅保存在当前浏览器
            </p>
          </div>
          <ActionToolbar label='聊天会话操作'>
            <ToolbarAction
              label={
                allConversationsSelected ? '取消全选会话' : '全选全部会话'
              }
              active={allConversationsSelected}
              disabled={streaming || conversations.length === 0}
              onClick={() =>
                setSelectedConversationIds(
                  allConversationsSelected
                    ? []
                    : conversations.map((conversation) => conversation.id)
                )
              }
            >
              <ListChecks />
            </ToolbarAction>
            <ToolbarAction
              label='新建会话'
              disabled={streaming}
              onClick={newConversation}
            >
              <MessageSquarePlus />
            </ToolbarAction>
          </ActionToolbar>
        </div>
        <SelectionToolbar
          selectedCount={selectedConversationIds.length}
          entityLabel='会话'
          disabled={streaming}
          className='mx-2 mb-2'
          onClear={() => setSelectedConversationIds([])}
        >
          <ToolbarAction
            label={`删除 ${selectedConversationIds.length} 个会话`}
            destructive
            disabled={streaming}
            onClick={() => setBulkDeleteConversationsOpen(true)}
          >
            <Trash2 />
          </ToolbarAction>
        </SelectionToolbar>
        <ScrollArea className='min-h-0 flex-1'>
          <div className='space-y-1 p-2'>
            {conversations.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'group flex items-center rounded-lg',
                  item.id === active?.id && 'bg-accent'
                )}
              >
                <Checkbox
                  checked={selectedConversationIds.includes(item.id)}
                  disabled={streaming}
                  onCheckedChange={(value) =>
                    setSelectedConversationIds((current) =>
                      value === true
                        ? current.includes(item.id)
                          ? current
                          : [...current, item.id]
                        : current.filter((id) => id !== item.id)
                    )
                  }
                  aria-label={`选择会话 ${item.title}`}
                  className='ms-2 shrink-0'
                />
                <button
                  className='min-w-0 flex-1 px-3 py-2 text-left'
                  onClick={() => selectConversation(item.id)}
                >
                  <div className='truncate text-sm font-medium'>
                    {item.title}
                  </div>
                  <div className='mt-1 truncate font-mono text-xs text-muted-foreground'>
                    {item.model || '未选择模型'}
                  </div>
                </button>
                <ToolbarAction
                  label={`删除会话 ${item.title}`}
                  destructive
                  disabled={streaming}
                  className='me-1 size-7 opacity-0 group-hover:opacity-100'
                  onClick={() => deleteConversation(item.id)}
                >
                  <Trash2 className='size-3.5' />
                </ToolbarAction>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>
      <section className='flex min-h-0 min-w-0 flex-col'>
        <div className='flex items-center gap-3 border-b px-4 py-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h2 className='truncate font-semibold'>
                {active?.title || '新的对话'}
              </h2>
              <Badge variant='secondary'>local</Badge>
              {active?.expectedImageUrl && (
                <Badge variant='info'>
                  <ImageIcon className='size-3' />
                  预期图
                </Badge>
              )}
            </div>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              {activeProvider?.name || '未选择提供商'} ·{' '}
              {active?.model || settings.model || '未选择模型'} ·{' '}
              {active?.messages.length ?? 0} 条消息
            </p>
          </div>
          <ActionToolbar label='当前会话操作' className='ms-auto'>
            <ToolbarAction label='新建会话' onClick={newConversation}>
              <Plus />
            </ToolbarAction>
            <ToolbarAction
              label='清空当前会话'
              disabled={streaming || !active?.messages.length}
              onClick={() =>
                updateActive((value) => ({
                  ...value,
                  title: '新的对话',
                  messages: [],
                  expectedImageUrl: undefined,
                }))
              }
            >
              <Eraser />
            </ToolbarAction>
          </ActionToolbar>
        </div>
        <div
          ref={scrollRef}
          onScroll={handleMessagesScroll}
          className='min-h-0 flex-1 overflow-y-auto'
        >
          {!active?.messages.length ? (
            <EmptyPlayground
              profiles={profiles.data ?? []}
              onPick={pickProfile}
            />
          ) : (
            <div className='mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6'>
              {active.messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  disabled={streaming}
                  expectedImageUrl={active.expectedImageUrl}
                  onRegenerate={() => void regenerate(message)}
                  onDelete={() =>
                    updateActive((value) => ({
                      ...value,
                      messages: value.messages.filter(
                        (item) => item.id !== message.id
                      ),
                      updatedAt: Date.now(),
                    }))
                  }
                  onSelectVariant={(index) =>
                    updateActive((value) => ({
                      ...value,
                      messages: value.messages.map((item) =>
                        item.id === message.id
                          ? selectVariant(item, index)
                          : item
                      ),
                      updatedAt: Date.now(),
                    }))
                  }
                />
              ))}
            </div>
          )}
        </div>
        <form
          onSubmit={handleSubmit}
          className='shrink-0 border-t bg-background/95 p-3 backdrop-blur'
        >
          <div className='mx-auto w-full max-w-5xl rounded-xl border bg-card'>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.ctrlKey &&
                  !event.metaKey
                ) {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder='输入内容，Shift + Enter 换行'
              disabled={streaming}
              className='max-h-40 min-h-24 resize-none border-0 shadow-none focus-visible:ring-0'
            />
            <div className='flex flex-wrap items-center gap-2 px-3 pb-3'>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => setSettingsOpen(true)}
              >
                <PanelRightOpen />
                请求参数
              </Button>
              <Select
                value={activeProviderId}
                onValueChange={handleProviderChange}
              >
                <SelectTrigger className='max-w-52'>
                  <SelectValue placeholder='选择提供商' />
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
              <Select
                value={active?.model || settings.model}
                onValueChange={handleModelChange}
                disabled={!activeProviderId || models.isLoading}
              >
                <SelectTrigger className='max-w-64'>
                  <SelectValue
                    placeholder={models.isLoading ? '读取模型中' : '选择模型'}
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
              <div className='ms-auto'>
                {streaming ? (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Square />
                    停止
                  </Button>
                ) : (
                  <Button type='submit' disabled={!input.trim()}>
                    <Send />
                    发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
      </section>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        setSettings={setSettings}
        providers={providers.data ?? []}
        providersLoading={providers.isLoading}
        selectedProviderId={activeProviderId}
        onProviderChange={handleProviderChange}
        selectedModel={active?.model || settings.model}
        modelNames={modelNames}
        onModelChange={handleModelChange}
      />
      <ConfirmDialog
        open={bulkDeleteConversationsOpen}
        onOpenChange={(open) =>
          !streaming && setBulkDeleteConversationsOpen(open)
        }
        title={`删除 ${selectedConversationIds.length} 个本地会话？`}
        desc='会话仅保存在当前浏览器；删除后对应消息和回复版本会一并移除。'
        confirmText={
          <>
            <Trash2 />
            删除会话
          </>
        }
        cancelBtnText='取消'
        destructive
        disabled={streaming || selectedConversationIds.length === 0}
        handleConfirm={() => {
          deleteConversations(selectedConversationIds)
          setBulkDeleteConversationsOpen(false)
        }}
      />
    </div>
  )
}

function EmptyPlayground({
  profiles,
  onPick,
}: {
  profiles: ProbeProfile[]
  onPick: (profile: ProbeProfile) => void
}) {
  return (
    <div className='flex min-h-full items-center justify-center p-8'>
      <div className='w-full max-w-3xl text-center'>
        <div className='mx-auto flex size-12 items-center justify-center rounded-full border bg-background'>
          <MessageSquarePlus className='size-5 text-muted-foreground' />
        </div>
        <h2 className='mt-5 text-2xl font-semibold'>开始一场游乐场对话</h2>
        <p className='mt-2 text-sm text-muted-foreground'>
          可直接聊天，也可载入探针方案，对照参考输出和效果图。
        </p>
        <div className='mt-8 grid gap-3 sm:grid-cols-2'>
          {profiles
            .filter((item) => item.enabled)
            .map((profile) => (
              <button
                key={profile.id}
                onClick={() => onPick(profile)}
                className='rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent'
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

function ChatBubble({
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
  const completedHtml =
    !user && status !== 'streaming' && extractHtmlPreviews(content).length > 0
  return (
    <article className={cn('flex gap-3', user && 'justify-end')}>
      <div
        className={cn(
          'mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background',
          user && 'order-2'
        )}
      >
        {user ? (
          <UserRound className='size-4 text-muted-foreground' />
        ) : (
          <Bot className='size-4 text-muted-foreground' />
        )}
      </div>
      <div
        className={cn('flex max-w-[88%] min-w-0 flex-col', user && 'items-end')}
      >
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm leading-6',
            user ? 'bg-primary text-primary-foreground' : 'bg-card',
            status === 'error' && 'border-destructive/50'
          )}
        >
          {!user && reasoning && (
            <ReasoningPanel
              content={reasoning}
              streaming={status === 'streaming' && !content}
            />
          )}
          {content ? (
            !user && status === 'streaming' ? (
              <StreamingText content={content} />
            ) : (
              <MarkdownView
                content={content}
                codeBlockClassName={
                  completedHtml
                    ? 'border-0 bg-transparent p-0 text-foreground shadow-none dark:bg-transparent dark:text-foreground'
                    : undefined
                }
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
              {content ? '正在流式输出' : reasoning ? '正在组织回答' : '等待响应'}
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
  const [open, setOpen] = useState(true)

  useEffect(() => {
    // A new streaming response reopens a panel the user may have collapsed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (streaming) setOpen(true)
  }, [streaming])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='mb-3'>
      <div className='overflow-hidden rounded-lg border bg-muted/25'>
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
          <div className='max-h-80 overflow-y-auto overscroll-contain border-t px-3 py-2.5 text-xs leading-5'>
            {content ? (
              <div className='break-words whitespace-pre-wrap text-muted-foreground'>
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
    <div className='min-w-0 break-words whitespace-pre-wrap'>
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

function SettingsDialog({
  open,
  onOpenChange,
  settings,
  setSettings,
  providers,
  providersLoading,
  selectedProviderId,
  onProviderChange,
  selectedModel,
  modelNames,
  onModelChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: PlaygroundSettings
  setSettings: (
    value:
      PlaygroundSettings | ((current: PlaygroundSettings) => PlaygroundSettings)
  ) => void
  providers: ChatProvider[]
  providersLoading: boolean
  selectedProviderId: string
  onProviderChange: (
    providerId: string,
    providerOverride?: ChatProvider
  ) => void
  selectedModel: string
  modelNames: string[]
  onModelChange: (model: string) => void
}) {
  const selectedProvider = providers.find(
    (provider) => provider.id === selectedProviderId
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='wide' className='overflow-hidden'>
        <DialogHeader className='shrink-0'>
          <DialogTitle className='flex items-center gap-2'>
            <Settings2 className='size-5 text-primary' />
            请求参数
          </DialogTitle>
          <DialogDescription>
            对话参数保存在当前浏览器；模型提供商和加密 API Key 保存在后端数据库。
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue='request' className='min-h-0 flex-1'>
          <TabsList className='shrink-0'>
            <TabsTrigger value='request'>
              <Settings2 />
              请求设置
            </TabsTrigger>
            <TabsTrigger value='providers'>
              <ServerCog />
              模型提供商
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value='request'
            className='min-h-0 overflow-y-auto pe-1'
          >
            <div className='grid gap-4 py-2 sm:grid-cols-2'>
              <Field label='模型提供商'>
                <Select
                  value={selectedProviderId}
                  onValueChange={onProviderChange}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        providersLoading ? '读取提供商中' : '选择提供商'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {providers
                      .filter((provider) => provider.enabled)
                      .map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                          {provider.isDefault ? ' · 默认' : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label='模型'>
                <Select
                  value={selectedModel}
                  onValueChange={onModelChange}
                  disabled={!selectedProviderId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='选择模型' />
                  </SelectTrigger>
                  <SelectContent>
                    {modelNames.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {selectedProvider && (
                <ProviderRequestPreview
                  provider={selectedProvider}
                  model={selectedModel}
                />
              )}
              <Field label='系统提示' className='sm:col-span-2'>
                <Textarea
                  value={settings.systemPrompt}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      systemPrompt: event.target.value,
                    }))
                  }
                  className='min-h-32'
                  placeholder='可选'
                />
              </Field>
              <Field
                label='请求体附加字段 JSON'
                className='sm:col-span-2'
              >
                <Textarea
                  value={settings.extraBody}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      extraBody: event.target.value,
                    }))
                  }
                  className='min-h-44 font-mono text-xs'
                  spellCheck={false}
                />
              </Field>
            </div>
          </TabsContent>
          <TabsContent
            value='providers'
            className='min-h-0 overflow-y-auto pe-1'
          >
            <ProviderSettingsPanel
              providers={providers}
              selectedProviderId={selectedProviderId}
              onProviderChange={onProviderChange}
            />
          </TabsContent>
        </Tabs>
        <DialogFooter className='shrink-0'>
          <Button onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
  modelsText: string
  enabled: boolean
  isDefault: boolean
  clearApiKey: boolean
}

function ProviderSettingsPanel({
  providers,
  selectedProviderId,
  onProviderChange,
}: {
  providers: ChatProvider[]
  selectedProviderId: string
  onProviderChange: (
    providerId: string,
    providerOverride?: ChatProvider
  ) => void
}) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(
    null
  )
  const [draft, setDraft] = useState<ProviderDraft>(() => emptyProviderDraft())
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [revealingApiKey, setRevealingApiKey] = useState(false)
  const editingProvider =
    editingId && editingId !== 'new'
      ? providers.find((provider) => provider.id === editingId)
      : undefined
  const previewProvider =
    providers.find((provider) => provider.id === previewProviderId) ??
    providers.find((provider) => provider.id === selectedProviderId) ??
    providers[0]

  const updateProviderCache = (provider: ChatProvider) => {
    queryClient.setQueryData<ChatProvider[]>(['chat-providers'], (current) =>
      sortChatProviders(
        [
          ...(current ?? []).filter((item) => item.id !== provider.id),
          provider,
        ].map((item) =>
          provider.isDefault && item.id !== provider.id
            ? { ...item, isDefault: false }
            : item
        )
      )
    )
  }

  const refreshProviderQueries = (providerId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['chat-providers'] })
    if (providerId)
      void queryClient.invalidateQueries({
        queryKey: ['chat-models', providerId],
      })
  }

  const saveProvider = useMutation({
    mutationFn: async () => {
      const name = draft.name.trim()
      const baseUrl = draft.baseUrl.trim()
      if (!name || !baseUrl) throw new Error('名称和 Base URL 为必填项')
      const body: ChatProviderInput = {
        name,
        baseUrl,
        apiKey: draft.apiKey.trim() || undefined,
        clearApiKey: draft.clearApiKey,
        models: parseModelNames(draft.modelsText),
        enabled: draft.enabled,
        isDefault: draft.isDefault,
      }
      return editingId === 'new'
        ? api.createChatProvider(body)
        : api.updateChatProvider(String(editingId), body)
    },
    onSuccess: (provider) => {
      const wasNew = editingId === 'new'
      updateProviderCache(provider)
      refreshProviderQueries(provider.id)
      setPreviewProviderId(provider.id)
      if (
        provider.enabled &&
        (wasNew || provider.isDefault || provider.id === selectedProviderId)
      )
        onProviderChange(provider.id, provider)
      setEditingId(null)
      setDraft(emptyProviderDraft())
      setApiKeyVisible(false)
      toast.success(wasNew ? '模型提供商已创建' : '模型提供商已更新')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const syncModels = useMutation({
    mutationFn: api.syncChatProviderModels,
    onSuccess: (provider) => {
      updateProviderCache(provider)
      refreshProviderQueries(provider.id)
      setPreviewProviderId(provider.id)
      toast.success(`已同步 ${provider.models.length} 个模型`)
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const deleteProvider = useMutation({
    mutationFn: api.deleteChatProvider,
    onSuccess: (_value, providerId) => {
      queryClient.setQueryData<ChatProvider[]>(
        ['chat-providers'],
        (current) => current?.filter((provider) => provider.id !== providerId)
      )
      refreshProviderQueries(providerId)
      setDeleteId(null)
      if (editingId === providerId) setEditingId(null)
      if (previewProviderId === providerId) setPreviewProviderId(null)
      toast.success('模型提供商已删除')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const startCreate = () => {
    setEditingId('new')
    setDeleteId(null)
    setDraft(emptyProviderDraft())
    setApiKeyVisible(false)
  }
  const startEdit = (provider: ChatProvider) => {
    setEditingId(provider.id)
    setDeleteId(null)
    setPreviewProviderId(provider.id)
    setDraft(providerDraft(provider))
    setApiKeyVisible(false)
  }

  const changeApiKeyVisibility = (visible: boolean) => {
    if (!visible) {
      setApiKeyVisible(false)
      return
    }
    if (draft.apiKey) {
      setApiKeyVisible(true)
      return
    }
    const providerId = editingProvider?.id
    if (!providerId || !editingProvider.apiKeyConfigured) {
      setApiKeyVisible(true)
      return
    }
    setRevealingApiKey(true)
    void api
      .revealChatProviderApiKey(providerId)
      .then((result) => {
        setDraft((current) => ({
          ...current,
          apiKey: result.value,
          clearApiKey: false,
        }))
        setApiKeyVisible(true)
      })
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => setRevealingApiKey(false))
  }

  return (
    <div className='grid min-h-0 gap-4 py-2 lg:grid-cols-[22rem_minmax(0,1fr)]'>
      <section className='min-w-0 rounded-xl border bg-muted/10'>
        <div className='flex items-center justify-between gap-2 border-b px-3 py-2.5'>
          <div>
            <div className='text-sm font-semibold'>提供商列表</div>
            <div className='text-xs text-muted-foreground'>
              {providers.length} 套配置
            </div>
          </div>
          <ActionToolbar label='模型提供商操作'>
            <ToolbarAction
              label='刷新模型提供商配置'
              onClick={() => refreshProviderQueries()}
            >
              <RefreshCw />
            </ToolbarAction>
            <ToolbarAction label='新建模型提供商' onClick={startCreate}>
              <Plus />
            </ToolbarAction>
          </ActionToolbar>
        </div>
        <div className='max-h-[52dvh] space-y-2 overflow-y-auto p-2'>
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={cn(
                'rounded-lg border bg-background p-3',
                selectedProviderId === provider.id && 'border-primary/50'
              )}
            >
              <div className='flex min-w-0 items-start gap-2'>
                <button
                  type='button'
                  className='min-w-0 flex-1 text-left'
                  onClick={() => {
                    setPreviewProviderId(provider.id)
                    if (provider.enabled)
                      onProviderChange(provider.id, provider)
                  }}
                  title={
                    provider.enabled
                      ? '预览并设为当前提供商'
                      : '预览已停用的提供商'
                  }
                >
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <span className='truncate text-sm font-medium'>
                      {provider.name}
                    </span>
                    {provider.isDefault && (
                      <Badge variant='info'>
                        <Star className='size-3' />
                        默认
                      </Badge>
                    )}
                    {!provider.enabled && (
                      <Badge variant='secondary'>停用</Badge>
                    )}
                    {selectedProviderId === provider.id && (
                      <Badge variant='success'>当前</Badge>
                    )}
                  </div>
                  <div className='mt-1 break-all text-xs text-muted-foreground'>
                    {provider.baseUrl}
                  </div>
                  <div className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
                    <span>{provider.models.length} 个模型</span>
                    <span>·</span>
                    <span className='inline-flex items-center gap-1'>
                      <KeyRound className='size-3' />
                      {provider.apiKeyConfigured ? '已配置' : '未配置'}
                    </span>
                  </div>
                </button>
                <div className='flex shrink-0 items-center gap-0.5'>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    disabled={syncModels.isPending || !provider.enabled}
                    onClick={() => syncModels.mutate(provider.id)}
                    aria-label={`同步 ${provider.name} 的模型`}
                    title='从 /v1/models 同步'
                  >
                    <RefreshCw
                      className={cn(
                        'size-3.5',
                        syncModels.isPending &&
                          syncModels.variables === provider.id &&
                          'animate-spin'
                      )}
                    />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    onClick={() => startEdit(provider)}
                    aria-label={`编辑 ${provider.name}`}
                    title='编辑'
                  >
                    <Pencil className='size-3.5' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-7 text-destructive'
                    onClick={() => setDeleteId(provider.id)}
                    aria-label={`删除 ${provider.name}`}
                    title='删除'
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                </div>
              </div>
              {deleteId === provider.id && (
                <div className='mt-3 flex items-center justify-between gap-2 rounded-md bg-destructive/5 px-2 py-1.5 text-xs'>
                  <span className='text-destructive'>确认删除此配置？</span>
                  <div className='flex gap-1'>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      className='h-7 px-2 text-xs'
                      onClick={() => setDeleteId(null)}
                    >
                      取消
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='destructive'
                      className='h-7 px-2 text-xs'
                      disabled={deleteProvider.isPending}
                      onClick={() => deleteProvider.mutate(provider.id)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!providers.length && (
            <div className='px-4 py-10 text-center text-sm text-muted-foreground'>
              尚未配置模型提供商
            </div>
          )}
        </div>
      </section>

      <section className='min-w-0 rounded-xl border p-4'>
        {editingId ? (
          <div className='space-y-4'>
            <div>
              <div className='flex items-center gap-2 text-sm font-semibold'>
                <CloudCog className='size-4 text-primary' />
                {editingId === 'new' ? '新建模型提供商' : '编辑模型提供商'}
              </div>
              <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                支持 OpenAI 兼容的 Base URL；可填写到服务根地址或以 /v1 结尾。
              </p>
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field label='名称' className='sm:col-span-1'>
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder='例如：生产模型网关'
                />
              </Field>
              <Field label='Base URL' className='sm:col-span-1'>
                <Input
                  value={draft.baseUrl}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder='https://HOST/v1'
                />
              </Field>
              <Field label='API Key' className='sm:col-span-2'>
                <PasswordInput
                  value={draft.apiKey}
                  visible={apiKeyVisible}
                  onVisibleChange={changeApiKeyVisibility}
                  disabled={revealingApiKey}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                      clearApiKey: false,
                    }))
                  }
                  placeholder={
                    editingProvider?.apiKeyConfigured
                      ? '已配置；留空保持原值'
                      : '可选'
                  }
                />
                {editingProvider?.apiKeyConfigured && (
                  <label className='flex items-center gap-2 text-xs text-muted-foreground'>
                    <Checkbox
                      checked={draft.clearApiKey}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          apiKey: '',
                          clearApiKey: checked === true,
                        }))
                      }
                    />
                    清除已保存的 API Key
                  </label>
                )}
              </Field>
              <Field label='模型列表' className='sm:col-span-2'>
                <Textarea
                  value={draft.modelsText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      modelsText: event.target.value,
                    }))
                  }
                  className='min-h-36 font-mono text-xs'
                  placeholder={'每行一个模型，也支持逗号分隔\nmodel-a\nmodel-b'}
                  spellCheck={false}
                />
                <p className='text-xs text-muted-foreground'>
                  留空时聊天广场会实时读取 /v1/models；列表卡片的同步按钮可保存读取结果。
                </p>
              </Field>
            </div>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='flex items-center justify-between rounded-lg border p-3 text-sm'>
                <span>
                  <span className='font-medium'>启用</span>
                  <span className='block text-xs text-muted-foreground'>
                    可在聊天广场中选择
                  </span>
                </span>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) =>
                    setDraft((current) => ({ ...current, enabled }))
                  }
                />
              </label>
              <label className='flex items-center justify-between rounded-lg border p-3 text-sm'>
                <span>
                  <span className='font-medium'>设为默认</span>
                  <span className='block text-xs text-muted-foreground'>
                    新会话优先使用
                  </span>
                </span>
                <Switch
                  checked={draft.isDefault}
                  onCheckedChange={(isDefault) =>
                    setDraft((current) => ({
                      ...current,
                      isDefault,
                      enabled: isDefault ? true : current.enabled,
                    }))
                  }
                />
              </label>
            </div>
            <div className='flex justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setEditingId(null)}
              >
                取消
              </Button>
              <Button
                type='button'
                disabled={saveProvider.isPending}
                onClick={() => saveProvider.mutate()}
              >
                {saveProvider.isPending && <Loader2 className='animate-spin' />}
                保存提供商
              </Button>
            </div>
          </div>
        ) : previewProvider ? (
          <ProviderPreview
            provider={previewProvider}
            selected={selectedProviderId === previewProvider.id}
            onEdit={() => startEdit(previewProvider)}
            onUse={
              previewProvider.enabled
                ? () => onProviderChange(previewProvider.id, previewProvider)
                : undefined
            }
          />
        ) : (
          <div className='flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center'>
            <ServerCog className='size-8 text-muted-foreground' />
            <div className='mt-3 text-sm font-medium'>选择或新建提供商</div>
            <p className='mt-1 max-w-sm text-xs leading-5 text-muted-foreground'>
              配置 Base URL、API Key 和模型列表后，聊天请求由后端代理到对应的
              /v1/chat/completions。
            </p>
            <Button type='button' size='sm' className='mt-4' onClick={startCreate}>
              <Plus />
              新建提供商
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function emptyProviderDraft(): ProviderDraft {
  return {
    name: '',
    baseUrl: '',
    apiKey: '',
    modelsText: '',
    enabled: true,
    isDefault: false,
    clearApiKey: false,
  }
}

function providerDraft(provider: ChatProvider): ProviderDraft {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: '',
    modelsText: provider.models.join('\n'),
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    clearApiKey: false,
  }
}

function parseModelNames(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function sortChatProviders(providers: ChatProvider[]): ChatProvider[] {
  return [...providers].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
    return left.createdAt.localeCompare(right.createdAt)
  })
}

function ProviderRequestPreview({
  provider,
  model,
}: {
  provider: ChatProvider
  model: string
}) {
  return (
    <div className='rounded-lg border bg-muted/20 p-3 sm:col-span-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm font-medium'>当前请求预览</span>
        {provider.isDefault && <Badge variant='info'>默认</Badge>}
        <Badge variant={provider.apiKeyConfigured ? 'success' : 'secondary'}>
          API Key {provider.apiKeyConfigured ? '已配置' : '未配置'}
        </Badge>
      </div>
      <dl className='mt-3 grid gap-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]'>
        <dt className='text-muted-foreground'>提供商</dt>
        <dd className='font-medium'>{provider.name}</dd>
        <dt className='text-muted-foreground'>接口</dt>
        <dd className='break-all font-mono'>
          {chatCompletionUrl(provider.baseUrl)}
        </dd>
        <dt className='text-muted-foreground'>模型</dt>
        <dd className='break-all font-mono'>{model || '尚未选择'}</dd>
      </dl>
    </div>
  )
}

function ProviderPreview({
  provider,
  selected,
  onEdit,
  onUse,
}: {
  provider: ChatProvider
  selected: boolean
  onEdit: () => void
  onUse?: () => void
}) {
  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <CloudCog className='size-4 text-primary' />
            <h3 className='text-sm font-semibold'>{provider.name}</h3>
            {provider.isDefault && <Badge variant='info'>默认</Badge>}
            {!provider.enabled && <Badge variant='secondary'>停用</Badge>}
            {selected && <Badge variant='success'>当前请求</Badge>}
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            保存后的模型提供商配置预览
          </p>
        </div>
        <div className='flex gap-2'>
          {onUse && !selected && (
            <Button type='button' size='sm' variant='outline' onClick={onUse}>
              设为当前
            </Button>
          )}
          <Button type='button' size='sm' onClick={onEdit}>
            <Pencil />
            编辑
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        <PreviewValue label='Base URL' value={provider.baseUrl} mono />
        <PreviewValue
          label='Chat Completions'
          value={chatCompletionUrl(provider.baseUrl)}
          mono
        />
        <PreviewValue
          label='API Key'
          value={provider.apiKeyConfigured ? '已配置并加密保存' : '未配置'}
        />
        <PreviewValue
          label='可用状态'
          value={provider.enabled ? '已启用' : '已停用'}
        />
      </div>

      <div>
        <div className='mb-2 flex items-center justify-between gap-2'>
          <span className='text-sm font-medium'>模型列表</span>
          <Badge variant='outline'>{provider.models.length} 个</Badge>
        </div>
        {provider.models.length ? (
          <div className='flex max-h-52 flex-wrap gap-2 overflow-y-auto rounded-lg border bg-muted/10 p-3'>
            {provider.models.map((model) => (
              <Badge
                key={model}
                variant='secondary'
                className='max-w-full font-mono font-normal'
              >
                <span className='truncate'>{model}</span>
              </Badge>
            ))}
          </div>
        ) : (
          <div className='rounded-lg border border-dashed p-4 text-xs leading-5 text-muted-foreground'>
            未保存模型列表。请求设置选择该提供商时会尝试实时读取
            <span className='mx-1 font-mono'>/v1/models</span>
            ；也可点击左侧同步按钮后再预览。
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewValue({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className='min-w-0 rounded-lg border bg-muted/10 p-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div
        className={cn(
          'mt-1 break-all text-sm',
          mono && 'font-mono text-xs leading-5'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function chatCompletionUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <label className='text-sm font-medium'>{label}</label>
      {children}
    </div>
  )
}
function id() {
  return Math.random().toString(36).slice(2, 10)
}
function createConversation(model = '', providerId = ''): Conversation {
  const now = Date.now()
  return {
    id: id(),
    title: '新的对话',
    providerId,
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}
function createMessage(
  role: Role,
  content: string,
  status: Variant['status'] = 'done'
): Message {
  const now = Date.now()
  if (role === 'user') return { id: id(), role, content, createdAt: now }
  const variant = { id: id(), content, reasoning: '', status, createdAt: now }
  return {
    id: id(),
    role,
    content,
    variants: [variant],
    activeVariant: 0,
    createdAt: now,
  }
}
function assistantVariants(message: Message): Variant[] {
  return message.variants?.length
    ? message.variants
    : [
        {
          id: message.id,
          content: message.content,
          reasoning: '',
          status: 'done',
          createdAt: message.createdAt,
        },
      ]
}
function selectVariant(message: Message, index: number): Message {
  const variants = assistantVariants(message)
  const active = Math.max(0, Math.min(index, variants.length - 1))
  return {
    ...message,
    activeVariant: active,
    content: variants[active]?.content ?? '',
  }
}

function parseCompletionStreamEvent(
  event: string
): { done: true } | { done: false; delta: CompletionStreamDelta } | null {
  const dataLines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  const fallback = event.trim()
  const data = dataLines.length
    ? dataLines.join('\n')
    : fallback.startsWith('{')
      ? fallback
      : ''
  if (!data) return null
  if (data === '[DONE]') return { done: true }

  const payload = JSON.parse(data) as {
    type?: string
    delta?: unknown
    error?: unknown
    choices?: Array<{
      delta?: Record<string, unknown>
      message?: Record<string, unknown>
    }>
  }
  if (payload.error) throw new Error(completionStreamError(payload.error))

  if (
    payload.type === 'response.reasoning_summary_text.delta' ||
    payload.type === 'response.reasoning_text.delta'
  ) {
    return {
      done: false,
      delta: { content: '', reasoning: completionStreamText(payload.delta) },
    }
  }
  if (payload.type === 'response.output_text.delta') {
    return {
      done: false,
      delta: { content: completionStreamText(payload.delta), reasoning: '' },
    }
  }

  const choice = payload.choices?.[0]
  const delta = choice?.delta ?? choice?.message ?? {}
  return {
    done: false,
    delta: {
      content:
        completionStreamText(delta.content) ||
        completionStreamText(delta.refusal),
      reasoning:
        completionStreamText(delta.reasoning_content) ||
        completionStreamText(delta.reasoning),
    },
  }
}

function completionStreamText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return completionStreamText(record.text ?? record.content)
    })
    .join('')
}

function completionStreamError(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const message = (value as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  try {
    return JSON.stringify(value) || '请求失败'
  } catch {
    return String(value || '请求失败')
  }
}

function appendStreamDelta(
  conversation: Conversation,
  messageId: string,
  variantIndex: number,
  delta: CompletionStreamDelta
): Conversation {
  return {
    ...conversation,
    updatedAt: Date.now(),
    messages: conversation.messages.map((message) => {
      if (message.id !== messageId) return message
      const variants = assistantVariants(message).map((variant, index) =>
        index === variantIndex
          ? {
              ...variant,
              content: variant.content + delta.content,
              reasoning: (variant.reasoning ?? '') + delta.reasoning,
            }
          : variant
      )
      return {
        ...message,
        variants,
        activeVariant: variantIndex,
        content: variants[variantIndex]?.content ?? '',
      }
    }),
  }
}
function markVariant(
  conversationId: string,
  messageId: string,
  variantIndex: number,
  status: Variant['status'],
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>,
  suffix = ''
) {
  setConversations((current) =>
    current.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((message) => {
              if (message.id !== messageId) return message
              const variants = assistantVariants(message).map(
                (variant, index) =>
                  index === variantIndex
                    ? { ...variant, content: variant.content + suffix, status }
                    : variant
              )
              return {
                ...message,
                variants,
                activeVariant: variantIndex,
                content: variants[variantIndex]?.content ?? '',
              }
            }),
          }
        : conversation
    )
  )
}
function requestMessages(messages: Message[], systemPrompt: string) {
  const values = messages
    .map((message) => ({
      role: message.role,
      content:
        message.role === 'assistant'
          ? (assistantVariants(message)[message.activeVariant ?? 0]?.content ??
            '')
          : message.content,
    }))
    .filter((message) => message.content.trim())
  return systemPrompt.trim()
    ? [{ role: 'system', content: systemPrompt.trim() }, ...values]
    : values
}
async function readError(response: Response) {
  const text = await response.text()
  try {
    const value = JSON.parse(text)
    return value.detail || value.error?.message || text
  } catch {
    return text || `HTTP ${response.status}`
  }
}

function useLocalState<T>(
  key: string,
  fallback: T
): [T, (value: T | ((current: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  })
  const set = (value: T | ((current: T) => T)) =>
    setState((current) => {
      const next =
        typeof value === 'function'
          ? (value as (current: T) => T)(current)
          : value
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* storage full */
      }
      return next
    })
  return [state, set]
}
function useIndexedState<T>(
  key: string,
  fallback: T
): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [state, setState] = useState(fallback)
  const [hydrated, setHydrated] = useState(false)
  const latest = useRef(state)
  const hydratedRef = useRef(false)
  const dirtyRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!hydratedRef.current) return

    const value = latest.current
    void idbWrite(key, value)
      .then(() => {
        try {
          localStorage.removeItem(key)
        } catch {
          /* IndexedDB already contains the durable copy. */
        }
      })
      .catch(() => {
        try {
          localStorage.setItem(key, JSON.stringify(value))
        } catch {
          /* Browser storage is unavailable or full. */
        }
      })
  }, [key])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      let value: T | undefined
      let restoreFromLocalStorage = false
      try {
        value = await idbRead<T>(key)
      } catch {
        value = readLocalStorageValue<T>(key)
        restoreFromLocalStorage = value !== undefined
      }
      if (value === undefined) {
        value = readLocalStorageValue<T>(key)
        restoreFromLocalStorage = value !== undefined
      }
      if (cancelled) return

      // A user action made before IndexedDB finished loading is newer than the
      // stored snapshot and must not be replaced by hydration.
      if (!dirtyRef.current && value !== undefined) {
        latest.current = value
        setState(value)
      }
      hydratedRef.current = true
      setHydrated(true)

      // Persist early edits, or migrate the localStorage fallback back into
      // IndexedDB after storage becomes available again.
      if (dirtyRef.current || restoreFromLocalStorage) persist()
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [key, persist])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      persist()
    }
  }, [persist])

  const set: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (value) =>
      setState((current) => {
        const next =
          typeof value === 'function'
            ? (value as (current: T) => T)(current)
            : value
        latest.current = next
        dirtyRef.current = true
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(persist, 400)
        return next
      }),
    [persist]
  )

  return [state, set, hydrated]
}

function readLocalStorageValue<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
let dbPromise: Promise<IDBDatabase> | null = null
function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error)
    }
  })
  return dbPromise
}
async function idbRead<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE, 'readonly')
      .objectStore(STORE)
      .get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}
async function idbWrite<T>(key: string, value: T) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
