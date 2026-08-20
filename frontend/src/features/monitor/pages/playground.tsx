import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  Eraser,
  Image as ImageIcon,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ApiError,
  api,
  authorizationHeaders,
  isAuthenticationRequiredCode,
  notifyAuthenticationRequired,
  type ChatProvider,
  type ProbeProfile,
} from '@/lib/api'
import { getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ActionToolbar, ToolbarAction } from '@/components/action-toolbar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  ChatBubble,
  Composer,
  ConversationNavigation,
  EmptyPlayground,
  RequestConfiguration,
} from '@/features/monitor/components/playground-chat'
import { ProviderSettingsDialog } from '@/features/monitor/components/playground-providers'
import {
  appendStreamDelta,
  assistantVariants,
  createConversation,
  createIdentifier,
  createMessage,
  isJsonObject,
  markVariant,
  parseCompletionStreamEvent,
  readError,
  requestMessages,
  selectVariant,
  useIndexedState,
  useLocalState,
} from '@/features/monitor/components/playground-support'
import type {
  CompletionStreamDelta,
  Conversation,
  Message,
  PlaygroundSettings,
  Variant,
} from '@/features/monitor/components/playground-types'

const CONVERSATIONS_KEY = 'conversations-v1'
const SETTINGS_KEY = 'grokiq-playground-settings'
const ACTIVE_KEY = 'grokiq-playground-active'
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
    let pending: CompletionStreamDelta = { content: '', reasoning: '' }
    let animationFrame = 0
    const flushPending = () => {
      animationFrame = 0
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
    const cancelPendingFlush = () => {
      if (!animationFrame) return
      window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
    }
    const complete = () => {
      cancelPendingFlush()
      flushPending()
      markVariant(
        conversation.id,
        assistantId,
        variantIndex,
        'done',
        setConversations
      )
    }
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
      const scheduleFlush = () => {
        // Coalesce a burst into one render without slowing down SSE consumption.
        if (animationFrame) return
        animationFrame = window.requestAnimationFrame(flushPending)
      }
      const consumeEvent = (event: string) => {
        const parsed = parseCompletionStreamEvent(event)
        if (!parsed) return false
        if (parsed.done) {
          complete()
          return true
        }
        if (parsed.delta.content || parsed.delta.reasoning) {
          pending.content += parsed.delta.content
          pending.reasoning += parsed.delta.reasoning
          scheduleFlush()
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
      cancelPendingFlush()
      flushPending()
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
      id: createIdentifier(),
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
