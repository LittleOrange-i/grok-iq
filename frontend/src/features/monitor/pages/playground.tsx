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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudCog,
  Copy,
  Eraser,
  Eye,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  ListChecks,
  MessageSquarePlus,
  MessageSquareText,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ServerCog,
  Settings2,
  Search,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  extractHtmlPreviews,
  HtmlPreviewButton,
  MarkdownView,
} from '@/components/formatted-content'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'

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
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [requestSettingsOpen, setRequestSettingsOpen] = useState(false)
  const [conversationSearch, setConversationSearch] = useState('')
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
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
  const visibleConversations = useMemo(() => {
    const query = conversationSearch.trim().toLocaleLowerCase()
    if (!query) return conversations
    return conversations.filter((conversation) =>
      [conversation.title, conversation.model]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    )
  }, [conversationSearch, conversations])
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
  const extraBodyValid = useMemo(
    () => isJsonObject(settings.extraBody),
    [settings.extraBody]
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
    setShowJumpToLatest(false)
  }
  const handleMessagesScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const atBottom = isScrolledToBottom(element)
    stickToBottomRef.current = atBottom
    setShowJumpToLatest(!atBottom)
  }
  const jumpToLatestMessage = () => {
    followLatestMessage()
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'smooth',
    })
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
      const appendDelta = (delta: CompletionStreamDelta) => {
        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id
              ? appendStreamDelta(item, assistantId, variantIndex, delta)
              : item
          )
        )
      }
      const complete = () => {
        markVariant(
          conversation.id,
          assistantId,
          variantIndex,
          'done',
          setConversations
        )
      }
      const consumeEvent = async (event: string) => {
        const parsed = parseCompletionStreamEvent(event)
        if (!parsed) return false
        if (parsed.done) {
          complete()
          return true
        }
        if (parsed.delta.content || parsed.delta.reasoning) {
          appendDelta(parsed.delta)
          if (document.visibilityState === 'visible') {
            await nextRenderFrame()
          }
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
          if (await consumeEvent(event)) return
        }
      }
      buffer += decoder.decode()
      buffer = buffer.replace(/\r\n/g, '\n')
      if (buffer.trim() && (await consumeEvent(buffer))) return
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
    if (!extraBodyValid) {
      toast.error('附加参数必须是有效的 JSON 对象')
      return
    }
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

  const clearActiveConversation = () =>
    updateActive((value) => ({
      ...value,
      title: '新的对话',
      messages: [],
      expectedImageUrl: undefined,
    }))

  const conversationNavigation = (
    <ConversationNavigation
      conversations={conversations}
      visibleConversations={visibleConversations}
      activeId={active?.id}
      selectedIds={selectedConversationIds}
      search={conversationSearch}
      streaming={streaming}
      allSelected={allConversationsSelected}
      onSearchChange={setConversationSearch}
      onSelect={(id) => {
        selectConversation(id)
        setMobileHistoryOpen(false)
      }}
      onSelectionChange={setSelectedConversationIds}
      onSelectAll={() =>
        setSelectedConversationIds(
          allConversationsSelected
            ? []
            : conversations.map((conversation) => conversation.id)
        )
      }
      onNew={() => {
        newConversation()
        setMobileHistoryOpen(false)
      }}
      onBulkDelete={() => setBulkDeleteConversationsOpen(true)}
    />
  )

  const requestConfiguration = (
    <RequestConfiguration
      settings={settings}
      setSettings={setSettings}
      providers={providers.data ?? []}
      providersLoading={providers.isLoading}
      selectedProvider={activeProvider}
      selectedProviderId={activeProviderId}
      selectedModel={active?.model || settings.model}
      modelNames={modelNames}
      modelsLoading={models.isLoading}
      onProviderChange={handleProviderChange}
      onModelChange={handleModelChange}
      onManageProviders={() => {
        setRequestSettingsOpen(false)
        window.requestAnimationFrame(() => setSettingsOpen(true))
      }}
    />
  )

  return (
    <div className='h-full min-h-0 bg-background'>
      <section className='flex h-full min-h-0 min-w-0 flex-col'>
        <header className='flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <h1 className='truncate text-sm font-semibold'>
                {active?.title || '新的对话'}
              </h1>
              {active?.expectedImageUrl && (
                <Badge variant='info' className='hidden sm:inline-flex'>
                  <ImageIcon className='size-3' />
                  预期图
                </Badge>
              )}
            </div>
            <p className='truncate text-[11px] text-muted-foreground'>
              {activeProvider?.name || '未选择提供商'} ·{' '}
              {active?.model || settings.model || '未选择模型'} ·{' '}
              {active?.messages.length ?? 0} 条消息
            </p>
          </div>
          <ActionToolbar label='当前会话操作'>
            <ToolbarAction
              label='打开会话列表'
              onClick={() => setMobileHistoryOpen(true)}
            >
              <PanelLeftOpen />
            </ToolbarAction>
            <ToolbarAction
              label='打开请求配置'
              onClick={() => setRequestSettingsOpen(true)}
            >
              <PanelRightOpen />
            </ToolbarAction>
            <ToolbarAction
              label='新建会话'
              disabled={streaming}
              onClick={newConversation}
            >
              <Plus />
            </ToolbarAction>
            <ToolbarAction
              label='清空当前会话'
              disabled={streaming || !active?.messages.length}
              onClick={clearActiveConversation}
            >
              <Eraser />
            </ToolbarAction>
          </ActionToolbar>
        </header>

        <div className='relative min-h-0 flex-1'>
          <div
            ref={scrollRef}
            onScroll={handleMessagesScroll}
            className='absolute inset-0 overflow-y-auto overscroll-contain'
          >
            {!active?.messages.length ? (
              <EmptyPlayground
                profiles={profiles.data ?? []}
                onPick={pickProfile}
              />
            ) : (
              <div className='mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8'>
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
          {showJumpToLatest && (
            <Button
              type='button'
              size='sm'
              variant='secondary'
              className='absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md'
              onClick={jumpToLatestMessage}
            >
              <ChevronDown />
              回到底部
            </Button>
          )}
        </div>

        <Composer
          input={input}
          streaming={streaming}
          providers={enabledProviders}
          providersLoading={providers.isLoading}
          providerId={activeProviderId}
          model={active?.model || settings.model}
          modelNames={modelNames}
          modelsLoading={models.isLoading}
          requestValid={extraBodyValid}
          onInputChange={setInput}
          onProviderChange={handleProviderChange}
          onModelChange={handleModelChange}
          onSubmit={handleSubmit}
          onStop={() => abortRef.current?.abort()}
        />
      </section>

      <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
        <SheetContent
          side='left'
          className='w-[min(28rem,94vw)] max-w-none p-0 sm:max-w-none'
        >
          <SheetHeader className='sr-only'>
            <SheetTitle>本地会话</SheetTitle>
            <SheetDescription>切换和管理当前浏览器中的会话</SheetDescription>
          </SheetHeader>
          {conversationNavigation}
        </SheetContent>
      </Sheet>

      <Sheet open={requestSettingsOpen} onOpenChange={setRequestSettingsOpen}>
        <SheetContent
          side='right'
          className='w-[min(32rem,96vw)] max-w-none p-0 sm:max-w-none'
        >
          <SheetHeader className='sr-only'>
            <SheetTitle>请求配置</SheetTitle>
            <SheetDescription>选择模型并配置当前对话请求</SheetDescription>
          </SheetHeader>
          {requestConfiguration}
        </SheetContent>
      </Sheet>

      <ProviderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        providers={providers.data ?? []}
        selectedProviderId={activeProviderId}
        onProviderChange={handleProviderChange}
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

function ConversationNavigation({
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
      <div className='flex h-16 shrink-0 items-center justify-between gap-2 ps-3 pe-14 lg:pe-3'>
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
          <ToolbarAction
            label='新建会话'
            disabled={streaming}
            onClick={onNew}
          >
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

function RequestConfiguration({
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
      | PlaygroundSettings
      | ((current: PlaygroundSettings) => PlaygroundSettings)
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
            <Field label='提供商'>
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
            </Field>
            <Field label='模型'>
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
            </Field>
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
                  <div className='mt-1 break-all font-mono text-[10px] leading-4'>
                    {chatCompletionUrl(selectedProvider.baseUrl)}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className='space-y-3'>
            <ConfigurationHeading title='上下文' />
            <Field label='系统提示'>
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
            </Field>
          </section>

          <section className='space-y-3'>
            <div className='flex items-center justify-between gap-2'>
              <ConfigurationHeading title='附加参数' />
              <Badge variant={extraBodyValid ? 'success' : 'destructive'}>
                {extraBodyValid ? (
                  <Check className='size-3' />
                ) : null}
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

function Composer({
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
      <div className='mx-auto w-full max-w-5xl overflow-hidden rounded-lg border bg-card shadow-xs'>
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
                className='max-w-44 border-0 bg-muted/60 px-2 shadow-none sm:max-w-56'
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
                className='min-w-0 max-w-56 border-0 bg-muted/60 px-2 font-mono shadow-none sm:max-w-80'
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
            <Button type='button' size='sm' variant='outline' onClick={onStop}>
              <Square />
              停止
            </Button>
          ) : (
            <Button
              type='submit'
              size='sm'
              disabled={
                !input.trim() || !providerId || !model || !requestValid
              }
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

function EmptyPlayground({
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
    <article className={cn('flex w-full gap-3 sm:gap-4', user && 'justify-end')}>
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
            ? 'max-w-[90%] items-end sm:max-w-[78%] lg:max-w-[70%]'
            : 'w-[calc(100%_-_3.25rem)] sm:w-[88%] lg:w-[82%]'
        )}
      >
        <div
          className={cn(
            'min-w-0 max-w-full overflow-hidden rounded-lg px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere] sm:px-5 sm:py-4',
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
              <div className='whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]'>
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
    <div className='min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]'>
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

function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => resolve())
  )
}

function ProviderSettingsDialog({
  open,
  onOpenChange,
  providers,
  selectedProviderId,
  onProviderChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: ChatProvider[]
  selectedProviderId: string
  onProviderChange: (
    providerId: string,
    providerOverride?: ChatProvider
  ) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='wide' className='overflow-hidden'>
        <DialogHeader className='shrink-0'>
          <DialogTitle className='flex items-center gap-2'>
            <ServerCog className='size-5 text-primary' />
            模型提供商
          </DialogTitle>
          <DialogDescription>
            管理聊天请求使用的接口、API Key 和模型列表。
          </DialogDescription>
        </DialogHeader>
        <div className='min-h-0 flex-1 overflow-y-auto pe-1'>
          <ProviderSettingsPanel
            providers={providers}
            selectedProviderId={selectedProviderId}
            onProviderChange={onProviderChange}
          />
        </div>
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
  const [detailProviderId, setDetailProviderId] = useState<string | null>(
    null
  )
  const [draft, setDraft] = useState<ProviderDraft>(() => emptyProviderDraft())
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [revealingApiKey, setRevealingApiKey] = useState(false)
  const editingProvider =
    editingId && editingId !== 'new'
      ? providers.find((provider) => provider.id === editingId)
      : undefined
  const detailProvider = providers.find(
    (provider) => provider.id === detailProviderId
  )
  const deleteTarget = providers.find((provider) => provider.id === deleteId)

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
      if (detailProviderId === providerId) setDetailProviderId(null)
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
    <div className='space-y-3 py-1'>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-sm text-muted-foreground'>
          共 {providers.length} 个提供商
        </span>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => refreshProviderQueries()}
          >
            <RefreshCw />
            刷新
          </Button>
          <Button type='button' size='sm' onClick={startCreate}>
            <Plus />
            新建
          </Button>
        </div>
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <Table rememberRowKey='chat-providers'>
          <TableHeader>
            <TableRow>
              <TableHead>提供商</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead>模型</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((provider) => {
              const selected = selectedProviderId === provider.id
              const syncing =
                syncModels.isPending && syncModels.variables === provider.id
              return (
                <TableRow key={provider.id} rowId={provider.id}>
                  <TableCell className='min-w-64 whitespace-normal'>
                    <button
                      type='button'
                      className='block max-w-full text-left'
                      onClick={() => setDetailProviderId(provider.id)}
                    >
                      <span className='flex flex-wrap items-center gap-1.5 font-medium'>
                        {provider.name}
                        {provider.isDefault && (
                          <Badge variant='info'>
                            <Star className='size-3' />
                            默认
                          </Badge>
                        )}
                        {selected && <Badge variant='success'>当前</Badge>}
                      </span>
                      <span className='mt-1 block break-all font-mono text-[11px] text-muted-foreground'>
                        {provider.baseUrl}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={provider.enabled ? 'success' : 'secondary'}>
                      {provider.enabled ? '启用' : '停用'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
                      <KeyRound className='size-3.5' />
                      {provider.apiKeyConfigured ? '已配置' : '未配置'}
                    </span>
                  </TableCell>
                  <TableCell>{provider.models.length}</TableCell>
                  <TableCell>
                    <div className='flex justify-end'>
                      <ActionToolbar label={`${provider.name} 操作`}>
                        <ToolbarAction
                          label={`查看 ${provider.name}`}
                          onClick={() => setDetailProviderId(provider.id)}
                        >
                          <Eye />
                        </ToolbarAction>
                        <ToolbarAction
                          label={selected ? '当前使用中' : `使用 ${provider.name}`}
                          active={selected}
                          disabled={!provider.enabled || selected}
                          onClick={() => onProviderChange(provider.id, provider)}
                        >
                          <Check />
                        </ToolbarAction>
                        <ToolbarAction
                          label={`同步 ${provider.name} 的模型`}
                          disabled={syncModels.isPending || !provider.enabled}
                          onClick={() => syncModels.mutate(provider.id)}
                        >
                          <RefreshCw className={cn(syncing && 'animate-spin')} />
                        </ToolbarAction>
                        <ToolbarAction
                          label={`编辑 ${provider.name}`}
                          onClick={() => startEdit(provider)}
                        >
                          <Pencil />
                        </ToolbarAction>
                        <ToolbarAction
                          label={`删除 ${provider.name}`}
                          destructive
                          onClick={() => setDeleteId(provider.id)}
                        >
                          <Trash2 />
                        </ToolbarAction>
                      </ActionToolbar>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {!providers.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className='h-28 text-center text-muted-foreground'
                >
                  尚未配置模型提供商
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ProviderEditorDialog
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingId(null)
            setApiKeyVisible(false)
          }
        }}
        editingProvider={editingProvider}
        draft={draft}
        setDraft={setDraft}
        apiKeyVisible={apiKeyVisible}
        revealingApiKey={revealingApiKey}
        onApiKeyVisibleChange={changeApiKeyVisibility}
        pending={saveProvider.isPending}
        onSave={() => saveProvider.mutate()}
      />
      <ProviderDetailDialog
        provider={detailProvider}
        selected={detailProvider?.id === selectedProviderId}
        open={Boolean(detailProvider)}
        onOpenChange={(open) => !open && setDetailProviderId(null)}
        onUse={() => {
          if (!detailProvider?.enabled) return
          onProviderChange(detailProvider.id, detailProvider)
          setDetailProviderId(null)
        }}
        onEdit={() => {
          if (!detailProvider) return
          const provider = detailProvider
          setDetailProviderId(null)
          window.requestAnimationFrame(() => startEdit(provider))
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title={`删除 ${deleteTarget?.name ?? '模型提供商'}？`}
        desc='删除后无法用于新请求，已保存在浏览器中的历史对话不会被移除。'
        confirmText={
          <>
            <Trash2 />
            删除
          </>
        }
        cancelBtnText='取消'
        destructive
        disabled={deleteProvider.isPending}
        handleConfirm={() =>
          deleteTarget && deleteProvider.mutate(deleteTarget.id)
        }
      />
    </div>
  )
}

function ProviderEditorDialog({
  open,
  onOpenChange,
  editingProvider,
  draft,
  setDraft,
  apiKeyVisible,
  revealingApiKey,
  onApiKeyVisibleChange,
  pending,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProvider?: ChatProvider
  draft: ProviderDraft
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>
  apiKeyVisible: boolean
  revealingApiKey: boolean
  onApiKeyVisibleChange: (visible: boolean) => void
  pending: boolean
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <CloudCog className='size-5 text-primary' />
            {editingProvider ? '编辑模型提供商' : '新建模型提供商'}
          </DialogTitle>
          <DialogDescription>
            Base URL 可填写服务根地址或以 /v1 结尾。
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field label='名称'>
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
          <Field label='Base URL'>
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
              onVisibleChange={onApiKeyVisibleChange}
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
              留空时实时读取 /v1/models，也可在列表中手动同步。
            </p>
          </Field>
          <div className='flex items-center justify-between py-1 text-sm'>
            <span>
              <span className='font-medium'>启用</span>
              <span className='block text-xs text-muted-foreground'>
                可在请求配置中选择
              </span>
            </span>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(enabled) =>
                setDraft((current) => ({ ...current, enabled }))
              }
            />
          </div>
          <div className='flex items-center justify-between py-1 text-sm'>
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
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type='button' disabled={pending} onClick={onSave}>
            {pending && <Loader2 className='animate-spin' />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ProviderDetailDialog({
  provider,
  selected,
  open,
  onOpenChange,
  onEdit,
  onUse,
}: {
  provider?: ChatProvider
  selected: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onUse: () => void
}) {
  if (!provider) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            <CloudCog className='size-5 text-primary' />
            {provider.name}
            {provider.isDefault && <Badge variant='info'>默认</Badge>}
            {!provider.enabled && <Badge variant='secondary'>停用</Badge>}
            {selected && <Badge variant='success'>当前</Badge>}
          </DialogTitle>
          <DialogDescription>模型提供商配置详情</DialogDescription>
        </DialogHeader>
        <dl className='grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]'>
          <dt className='text-muted-foreground'>Base URL</dt>
          <dd className='break-all font-mono text-xs'>{provider.baseUrl}</dd>
          <dt className='text-muted-foreground'>Chat Completions</dt>
          <dd className='break-all font-mono text-xs'>
            {chatCompletionUrl(provider.baseUrl)}
          </dd>
          <dt className='text-muted-foreground'>API Key</dt>
          <dd>{provider.apiKeyConfigured ? '已配置并加密保存' : '未配置'}</dd>
          <dt className='text-muted-foreground'>可用状态</dt>
          <dd>{provider.enabled ? '已启用' : '已停用'}</dd>
        </dl>
        <div>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <span className='text-sm font-medium'>模型列表</span>
            <Badge variant='outline'>{provider.models.length} 个</Badge>
          </div>
          {provider.models.length ? (
            <div className='flex max-h-52 flex-wrap gap-2 overflow-y-auto'>
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
            <p className='text-xs leading-5 text-muted-foreground'>
              未保存模型列表，可从 /v1/models 同步。
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onEdit}>
            <Pencil />
            编辑
          </Button>
          <Button
            type='button'
            disabled={!provider.enabled || selected}
            onClick={onUse}
          >
            <Check />
            {selected ? '当前使用中' : '设为当前'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function chatCompletionUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`
}

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value || '{}')
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

function formatConversationActivity(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
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
