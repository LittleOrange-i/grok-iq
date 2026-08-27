import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceTabsStore } from './workspace-tabs-store'

describe('useWorkspaceTabsStore', () => {
  beforeEach(() => {
    useWorkspaceTabsStore.getState().reset()
  })

  it('starts with no mounted tabs', () => {
    expect(useWorkspaceTabsStore.getState().mounted).toEqual([])
  })

  it('mounts visited tabs and keeps the most recent last', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('accounts')
    store.visit('quarantine')
    store.visit('runs')
    store.visit('request-audits')
    store.visit('accounts')
    expect(useWorkspaceTabsStore.getState().mounted).toEqual([
      'quarantine',
      'runs',
      'request-audits',
      'accounts',
    ])
  })

  it('does not rewrite state when revisiting the current tab', () => {
    useWorkspaceTabsStore.getState().visit('accounts')
    const afterVisit = useWorkspaceTabsStore.getState()
    useWorkspaceTabsStore.getState().visit('accounts')
    expect(useWorkspaceTabsStore.getState()).toBe(afterVisit)
  })

  it('closes a mounted tab without affecting the others', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('accounts')
    store.visit('quarantine')
    store.visit('runs')
    store.close('accounts')
    expect(useWorkspaceTabsStore.getState().mounted).toEqual([
      'quarantine',
      'runs',
    ])
  })

  it('resets all mounted tabs', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('accounts')
    store.visit('runs')
    store.reset()
    expect(useWorkspaceTabsStore.getState().mounted).toEqual([])
  })
})
