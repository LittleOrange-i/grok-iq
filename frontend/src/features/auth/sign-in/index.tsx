import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  Activity,
  Check,
  Loader2,
  Radar,
  ShieldCheck,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { UserAuthForm } from './components/user-auth-form'

const highlights = [
  { icon: Radar, text: '多账号、多出口探针统一排队执行' },
  { icon: Activity, text: '任务证据、TPS 与降智信号集中查看' },
  { icon: ShieldCheck, text: '账号状态变更保留快照并支持恢复' },
]

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: api.authStatus,
    retry: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (!status.data?.authenticated || !status.data.user) return
    setUser(status.data.user)
    void navigate({ to: normalizedRedirect(redirect), replace: true })
  }, [navigate, redirect, setUser, status.data])

  if (status.isLoading) {
    return (
      <div className='flex min-h-svh items-center justify-center bg-muted/30'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (status.isError) {
    return (
      <div className='flex min-h-svh items-center justify-center bg-muted/30 p-4'>
        <Card className='w-full max-w-md'>
          <CardHeader>
            <CardTitle>连接服务失败</CardTitle>
            <CardDescription>
              登录状态读取失败，请确认后端服务已启动后重试。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className='w-full' onClick={() => void status.refetch()}>
              重新加载
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const setupRequired = status.data?.setupRequired === true

  return (
    <main className='grid min-h-svh bg-muted/30 lg:grid-cols-[minmax(23rem,.85fr)_minmax(32rem,1.15fr)]'>
      <section className='relative hidden overflow-hidden border-r bg-zinc-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14'>
        <div className='absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,.18),transparent_35%),radial-gradient(circle_at_80%_75%,rgba(16,185,129,.13),transparent_32%)]' />
        <div className='relative flex items-center gap-3'>
          <span className='flex size-10 items-center justify-center rounded-xl bg-white text-zinc-950 shadow-sm'>
            <ShieldCheck className='size-5' />
          </span>
          <div>
            <div className='font-semibold'>GrokIQ</div>
            <div className='text-xs text-zinc-400'>账号质量与风控探针</div>
          </div>
        </div>

        <div className='relative max-w-lg'>
          <p className='text-xs font-medium tracking-[0.18em] text-sky-300 uppercase'>
            Account intelligence
          </p>
          <h1 className='mt-4 text-4xl leading-tight font-semibold tracking-tight xl:text-[2.75rem]'>
            把账号探测、任务证据和风险处置放在一个清晰的工作台。
          </h1>
          <div className='mt-9 space-y-4 text-sm text-zinc-300'>
            {highlights.map(({ icon: Icon, text }) => (
              <div key={text} className='flex items-center gap-3'>
                <span className='flex size-6 items-center justify-center rounded-full bg-sky-500/15 text-sky-200'>
                  <Icon className='size-3.5' />
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>

        <div className='relative flex items-center gap-2 text-xs text-zinc-500'>
          <Check className='size-3.5' />
          Private administration console
        </div>
      </section>

      <section className='flex items-center justify-center px-4 py-8 sm:px-8'>
        <Card className='w-full max-w-[28rem] gap-5 border-border/80 shadow-[0_24px_70px_-45px_rgba(15,23,42,.55)]'>
          <CardHeader className='gap-3'>
            <div className='mb-2 flex items-center gap-3 lg:hidden'>
              <span className='flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground'>
                <ShieldCheck className='size-5' />
              </span>
              <div>
                <div className='font-semibold'>GrokIQ</div>
                <div className='text-xs text-muted-foreground'>
                  账号质量与风控探针
                </div>
              </div>
            </div>
            <p className='text-xs font-medium tracking-[0.14em] text-primary uppercase'>
              Administrator
            </p>
            <div>
              <CardTitle className='text-2xl tracking-tight'>
                {setupRequired ? '创建管理员' : '欢迎回来'}
              </CardTitle>
              <CardDescription className='mt-2 leading-6'>
                {setupRequired
                  ? '首次使用需要设置唯一管理员用户名和密码，完成后进入监控控制台。'
                  : '输入管理员用户名和密码继续使用监控控制台。'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <UserAuthForm
              key={setupRequired ? 'setup' : 'login'}
              setupRequired={setupRequired}
              redirectTo={redirect}
            />
            <p className='mt-6 text-center text-xs text-muted-foreground'>
              JWT 登录有效期至少 7 天，凭据仅保存在本系统数据库中
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function normalizedRedirect(value?: string): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}
