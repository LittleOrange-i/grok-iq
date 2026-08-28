import { describe, expect, it } from 'vitest'
import {
  isRunsPath,
  pinnedAccountIdFromRunsSearch,
  readRunsSearch,
  runsSearchFromAccount,
} from './runs-search'

describe('runs search', () => {
  it('detects the task center path', () => {
    expect(isRunsPath('/runs')).toBe(true)
    expect(isRunsPath('/runs/')).toBe(true)
    expect(isRunsPath('/accounts')).toBe(false)
    expect(isRunsPath('/request-audits')).toBe(false)
  })

  it('reads account and run from search', () => {
    expect(
      readRunsSearch({ account: ' 42 ', run: ' run-1 ', extra: 1 })
    ).toEqual({ account: '42', run: 'run-1' })
    expect(readRunsSearch({ account: '' })).toEqual({})
    expect(readRunsSearch({ run: '  ' })).toEqual({})
    expect(readRunsSearch({ view: 'nodes' })).toEqual({})
  })

  it('treats numeric account search as a pinned account id', () => {
    expect(pinnedAccountIdFromRunsSearch({ account: '42' })).toBe(42)
    expect(pinnedAccountIdFromRunsSearch({ account: ' 7 ' })).toBe(7)
    expect(pinnedAccountIdFromRunsSearch({ account: 'alice' })).toBeNull()
    expect(pinnedAccountIdFromRunsSearch({})).toBeNull()
  })

  it('builds jump search from account and run ids', () => {
    expect(runsSearchFromAccount(12, 'run-1')).toEqual({
      account: '12',
      run: 'run-1',
    })
    expect(runsSearchFromAccount(12)).toEqual({ account: '12' })
    expect(runsSearchFromAccount(null, 'run-1')).toEqual({ run: 'run-1' })
    expect(runsSearchFromAccount(0, '')).toBeUndefined()
  })
})
