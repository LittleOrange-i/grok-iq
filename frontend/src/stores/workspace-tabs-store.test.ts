import { beforeEach, describe, expect, it, vi } from 'vitest'

async function importStore() {
  const { useWorkspaceTabsStore } = await import('./workspace-tabs-store')
  return useWorkspaceTabsStore
}

describe('useWorkspaceTabsStore', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts with no mounted tabs', async () => {
    const store = await importStore()
    expect(store.getState().mounted).toEqual([])
  })

  it('mounts visited tabs and keeps the most recent last', async () => {
    const store = await importStore()
    store.getState().visit('accounts')
    store.getState().visit('runs')
    store.getState().visit('request-audits')
    store.getState().visit('accounts')
    expect(store.getState().mounted).toEqual([
      'runs',
      'request-audits',
      'accounts',
    ])
  })

  it('does not rewrite state when revisiting the current tab', async () => {
    const store = await importStore()
    store.getState().visit('accounts')
    const afterVisit = store.getState()
    store.getState().visit('accounts')
    expect(store.getState()).toBe(afterVisit)
  })

  it('closes a mounted tab without affecting the others', async () => {
    const store = await importStore()
    store.getState().visit('accounts')
    store.getState().visit('runs')
    store.getState().close('accounts')
    expect(store.getState().mounted).toEqual(['runs'])
  })

  it('resets all mounted tabs', async () => {
    const store = await importStore()
    store.getState().visit('accounts')
    store.getState().visit('runs')
    store.getState().reset()
    expect(store.getState().mounted).toEqual([])
  })
})
