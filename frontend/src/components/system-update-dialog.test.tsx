import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { api, type SystemVersionInfo } from '@/lib/api'
import {
  localDateKey,
  SYSTEM_UPDATE_DISMISS_KEY,
  SYSTEM_UPDATE_PREVIEW_EVENT,
} from '@/lib/system-update'
import { SystemUpdateDialog } from './system-update-dialog'

const update: SystemVersionInfo = {
  status: 'update_available',
  updateAvailable: true,
  currentVersion: 'v1.0.0',
  latestVersion: 'v1.1.0',
  releaseUrl: 'https://github.com/kaibush/grok-iq/releases/tag/v1.1.0',
  releaseNotes: 'Release notes',
  publishedAt: '2026-08-14T00:00:00Z',
  checkedAt: '2026-08-14T08:00:00+08:00',
  error: '',
}

async function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SystemUpdateDialog />
    </QueryClientProvider>
  )
}

describe('SystemUpdateDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
    vi.spyOn(api, 'systemVersion').mockResolvedValue(update)
  })

  it('shows a newer GitHub Release and can be dismissed for today', async () => {
    const screen = await renderDialog()

    await expect
      .element(screen.getByRole('dialog', { name: '发现 GrokIQ 新版本' }))
      .toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '今日不再提醒' }))

    expect(window.localStorage.getItem(SYSTEM_UPDATE_DISMISS_KEY)).toBe(
      JSON.stringify({ version: 'v1.1.0', date: localDateKey() })
    )
    await expect
      .element(screen.getByRole('dialog', { name: '发现 GrokIQ 新版本' }))
      .not.toBeInTheDocument()
  })

  it('keeps a same-day dismissal closed after remounting', async () => {
    window.localStorage.setItem(
      SYSTEM_UPDATE_DISMISS_KEY,
      JSON.stringify({ version: 'v1.1.0', date: localDateKey() })
    )
    const screen = await renderDialog()

    await vi.waitFor(() => expect(api.systemVersion).toHaveBeenCalledOnce())
    await expect
      .element(screen.getByRole('dialog', { name: '发现 GrokIQ 新版本' }))
      .not.toBeInTheDocument()
  })

  it('shows the same version again on the next day', async () => {
    window.localStorage.setItem(
      SYSTEM_UPDATE_DISMISS_KEY,
      JSON.stringify({ version: 'v1.1.0', date: '1999-01-01' })
    )
    const screen = await renderDialog()

    await expect
      .element(screen.getByRole('dialog', { name: '发现 GrokIQ 新版本' }))
      .toBeInTheDocument()
  })

  it('shows a development-only preview without dismissing a real version', async () => {
    vi.mocked(api.systemVersion).mockResolvedValue({
      ...update,
      status: 'up_to_date',
      updateAvailable: false,
      latestVersion: 'v1.0.0',
    })
    const screen = await renderDialog()
    await vi.waitFor(() => expect(api.systemVersion).toHaveBeenCalledOnce())

    window.dispatchEvent(
      new CustomEvent(SYSTEM_UPDATE_PREVIEW_EVENT, { detail: update })
    )

    await expect.element(screen.getByText('开发预览')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(window.localStorage.getItem(SYSTEM_UPDATE_DISMISS_KEY)).toBeNull()
  })
})
