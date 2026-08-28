import { beforeEach, describe, expect, it } from 'vitest'
import { workspaceTabLink } from '@/components/layout/workspace-tabs'
import { useWorkspaceTabsStore } from './workspace-tabs-store'

describe('useWorkspaceTabsStore', () => {
  beforeEach(() => {
    useWorkspaceTabsStore.getState().reset()
  })

  it('starts with no mounted tabs', () => {
    expect(useWorkspaceTabsStore.getState().mounted).toEqual([])
    expect(useWorkspaceTabsStore.getState().lastLocations).toEqual({})
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

  it('remembers nested request-audit locations across tab switches', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('request-audits', {
      pathname: '/request-audits/ledger',
      search: { account: '42' },
    })
    store.visit('accounts', { pathname: '/accounts', search: {} })
    const last = useWorkspaceTabsStore.getState().lastLocations['request-audits']
    expect(last).toEqual({
      pathname: '/request-audits/ledger',
      search: { account: '42' },
    })
    expect(workspaceTabLink('request-audits', last)).toEqual({
      to: '/request-audits/ledger',
      search: { account: '42' },
    })
  })

  it('updates the last nested path without remounting the tab', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('request-audits', {
      pathname: '/request-audits',
      search: {},
    })
    store.visit('request-audits', {
      pathname: '/request-audits/ledger',
      search: { account: '9' },
    })
    expect(useWorkspaceTabsStore.getState().mounted).toEqual(['request-audits'])
    expect(
      useWorkspaceTabsStore.getState().lastLocations['request-audits']
    ).toEqual({
      pathname: '/request-audits/ledger',
      search: { account: '9' },
    })
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

  it('clears the remembered path when a tab is closed', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('request-audits', {
      pathname: '/request-audits/workspace',
      search: { view: 'nodes' },
    })
    store.close('request-audits')
    expect(
      useWorkspaceTabsStore.getState().lastLocations['request-audits']
    ).toBeUndefined()
    expect(workspaceTabLink('request-audits')).toEqual({
      to: '/request-audits',
    })
  })

  it('resets all mounted tabs', () => {
    const store = useWorkspaceTabsStore.getState()
    store.visit('accounts')
    store.visit('runs')
    store.reset()
    expect(useWorkspaceTabsStore.getState().mounted).toEqual([])
    expect(useWorkspaceTabsStore.getState().lastLocations).toEqual({})
  })
})
