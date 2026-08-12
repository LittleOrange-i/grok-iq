import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SignOutDialog } from './sign-out-dialog'

const mocks = vi.hoisted(() => ({
  authLogout: vi.fn(),
  clear: vi.fn(),
  navigate: vi.fn(),
  reset: vi.fn(),
}))

const MOCK_HREF = '/runs?page=2'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, authLogout: mocks.authLogout },
  }
})

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { reset: mocks.reset } }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({ clear: mocks.clear }),
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ href: MOCK_HREF }),
  }
})

describe('SignOutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authLogout.mockResolvedValue({ loggedOut: true })
    mocks.navigate.mockResolvedValue(undefined)
  })

  it('revokes the backend session, clears local state, and redirects', async () => {
    const onOpenChange = vi.fn()
    const screen = await render(
      <SignOutDialog open onOpenChange={onOpenChange} />
    )

    await userEvent.click(
      screen.getByRole('button', { name: '退出登录' })
    )

    await vi.waitFor(() => expect(mocks.authLogout).toHaveBeenCalledOnce())
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: MOCK_HREF },
      replace: true,
    })
  })

  it('keeps the session when cancellation is selected', async () => {
    const screen = await render(
      <SignOutDialog open onOpenChange={vi.fn()} />
    )

    await userEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(mocks.authLogout).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
