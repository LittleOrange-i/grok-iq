import { describe, expect, it } from 'vitest'
import {
  chatCompletionUrl,
  parseCompletionStreamEvent,
} from './playground-support'

describe('parseCompletionStreamEvent', () => {
  it('finishes on Responses API terminal events', () => {
    expect(
      parseCompletionStreamEvent('data: {"type":"response.completed"}')
    ).toEqual({ done: true })
  })

  it('parses Responses output text deltas', () => {
    expect(
      parseCompletionStreamEvent(
        'data: {"type":"response.output_text.delta","delta":"pong"}'
      )
    ).toEqual({ done: false, delta: { content: 'pong', reasoning: '' } })
  })

  it('parses Responses reasoning deltas', () => {
    expect(
      parseCompletionStreamEvent(
        'data: {"type":"response.reasoning_text.delta","delta":"think"}'
      )
    ).toEqual({ done: false, delta: { content: '', reasoning: 'think' } })
  })

  it('parses reasoning summary text deltas', () => {
    expect(
      parseCompletionStreamEvent(
        'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}'
      )
    ).toEqual({ done: false, delta: { content: '', reasoning: 'think' } })
  })
})

describe('chatCompletionUrl', () => {
  it('defaults to the Responses endpoint', () => {
    expect(chatCompletionUrl('https://api.test')).toBe(
      'https://api.test/v1/responses'
    )
    expect(chatCompletionUrl('https://api.test/v1')).toBe(
      'https://api.test/v1/responses'
    )
  })

  it('keeps an explicit Chat Completions URL', () => {
    expect(chatCompletionUrl('https://api.test/v1/chat/completions')).toBe(
      'https://api.test/v1/chat/completions'
    )
  })
})
