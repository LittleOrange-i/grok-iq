import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const mocks = vi.hoisted(() => ({
  authLogin: vi.fn(),
  authSetup: vi.fn(),
  navigate: vi.fn(),
  setQueryData: vi.fn(),
  setSession: vi.fn(),
}))

const session = {
  accessToken: 'admin-jwt',
  tokenType: 'bearer' as const,
  expiresAt: '2026-08-17T12:00:00Z',
  user: { id: 1, username: 'admin', role: 'admin' },
}

vi.mock('@/lib/api', () => ({
  api: {
    authLogin: mocks.authLogin,
    authSetup: mocks.authSetup,
  },
}))

vi.mock('@/stores/auth-store', () => {
  const auth = { setSession: mocks.setSession }
  return {
    useAuthStore: (selector?: (state: { auth: typeof auth }) => unknown) =>
      selector ? selector({ auth }) : { auth },
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authLogin.mockResolvedValue(session)
    mocks.authSetup.mockResolvedValue(session)
    mocks.navigate.mockResolvedValue(undefined)
  })

  it('validates and submits an administrator login', async () => {
    const screen = await render(<UserAuthForm setupRequired={false} />)
    const username = screen.getByRole('textbox', {
      name: '管理员用户名',
    })
    const password = screen.getByLabelText('密码')
    const submit = screen.getByRole('button', { name: '登录控制台' })

    await userEvent.click(submit)
    await expect.element(screen.getByText('请输入用户名')).toBeInTheDocument()
    await expect.element(screen.getByText('请输入密码')).toBeInTheDocument()

    await userEvent.fill(username, 'admin')
    await userEvent.fill(password, 'password123')
    await userEvent.click(submit)

    await vi.waitFor(() =>
      expect(mocks.authLogin).toHaveBeenCalledWith({
        username: 'admin',
        password: 'password123',
      })
    )
    expect(mocks.setSession).toHaveBeenCalledWith(
      session.accessToken,
      session.user,
      session.expiresAt
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/',
      replace: true,
    })
  })

  it('creates the first administrator and preserves a safe redirect', async () => {
    const screen = await render(
      <UserAuthForm setupRequired redirectTo='/settings' />
    )

    await userEvent.fill(
      screen.getByRole('textbox', { name: '管理员用户名' }),
      'monitor-admin'
    )
    await userEvent.fill(
      screen.getByRole('textbox', { name: '密码', exact: true }),
      'password123'
    )
    await userEvent.fill(screen.getByLabelText('确认密码'), 'password123')
    await userEvent.click(
      screen.getByRole('button', { name: '创建账号并初始化' })
    )

    await vi.waitFor(() =>
      expect(mocks.authSetup).toHaveBeenCalledWith({
        username: 'monitor-admin',
        password: 'password123',
        confirm_password: 'password123',
      })
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/onboarding',
      search: { redirect: '/settings' },
      replace: true,
    })
  })
})
