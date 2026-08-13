import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type {
  CompletionStreamDelta,
  Conversation,
  Message,
  Role,
  Variant,
} from './playground-types'

const DB_NAME = 'grokiq-playground'
const STORE = 'state'

export function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

export function chatCompletionUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`
}

export function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value || '{}')
    return Boolean(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    )
  } catch {
    return false
  }
}

export function formatConversationActivity(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

export function createIdentifier() {
  return Math.random().toString(36).slice(2, 10)
}
export function createConversation(model = '', providerId = ''): Conversation {
  const now = Date.now()
  return {
    id: createIdentifier(),
    title: '新的对话',
    providerId,
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}
export function createMessage(
  role: Role,
  content: string,
  status: Variant['status'] = 'done'
): Message {
  const now = Date.now()
  if (role === 'user')
    return { id: createIdentifier(), role, content, createdAt: now }
  const variant = {
    id: createIdentifier(),
    content,
    reasoning: '',
    status,
    createdAt: now,
  }
  return {
    id: createIdentifier(),
    role,
    content,
    variants: [variant],
    activeVariant: 0,
    createdAt: now,
  }
}
export function assistantVariants(message: Message): Variant[] {
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
export function selectVariant(message: Message, index: number): Message {
  const variants = assistantVariants(message)
  const active = Math.max(0, Math.min(index, variants.length - 1))
  return {
    ...message,
    activeVariant: active,
    content: variants[active]?.content ?? '',
  }
}

export function parseCompletionStreamEvent(
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

export function appendStreamDelta(
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
export function markVariant(
  conversationId: string,
  messageId: string,
  variantIndex: number,
  status: Variant['status'],
  setConversations: Dispatch<SetStateAction<Conversation[]>>,
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
export function requestMessages(messages: Message[], systemPrompt: string) {
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
export async function readError(response: Response) {
  const text = await response.text()
  try {
    const value = JSON.parse(text)
    return value.detail || value.error?.message || text
  } catch {
    return text || `HTTP ${response.status}`
  }
}

export function useLocalState<T>(
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
export function useIndexedState<T>(
  key: string,
  fallback: T
): [T, Dispatch<SetStateAction<T>>, boolean] {
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

  const set: Dispatch<SetStateAction<T>> = useCallback(
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
