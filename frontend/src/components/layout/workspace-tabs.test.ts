import { describe, expect, it } from 'vitest'
import {
  isWorkspaceTabPath,
  matchWorkspaceTabId,
  normalizePathname,
} from './workspace-tabs'

describe('workspace tabs', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizePathname('/accounts/')).toBe('/accounts')
    expect(normalizePathname('/')).toBe('/')
    expect(normalizePathname('')).toBe('/')
  })

  it('matches the three workspace pages', () => {
    expect(matchWorkspaceTabId('/accounts')).toBe('accounts')
    expect(matchWorkspaceTabId('/runs/')).toBe('runs')
    expect(matchWorkspaceTabId('/request-audits/')).toBe('request-audits')
    expect(matchWorkspaceTabId('/settings/risk')).toBeNull()
  })

  it('detects workspace paths', () => {
    expect(isWorkspaceTabPath('/runs')).toBe(true)
    expect(isWorkspaceTabPath('/playground')).toBe(false)
  })
})
