export type Role = 'user' | 'assistant'

export type Variant = {
  id: string
  content: string
  reasoning?: string
  status: 'streaming' | 'done' | 'error'
  createdAt: number
}

export type CompletionStreamDelta = {
  content: string
  reasoning: string
}

export type Message = {
  id: string
  role: Role
  content: string
  variants?: Variant[]
  activeVariant?: number
  createdAt: number
}

export type Conversation = {
  id: string
  title: string
  providerId?: string
  model: string
  expectedImageUrl?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export type PlaygroundSettings = {
  providerId: string
  model: string
  systemPrompt: string
  extraBody: string
}
