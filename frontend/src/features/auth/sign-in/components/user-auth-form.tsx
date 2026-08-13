import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, LockKeyhole } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

type AuthFormValues = {
  username: string
  password: string
  confirmPassword: string
}

type UserAuthFormProps = {
  setupRequired: boolean
  redirectTo?: string
}

export function UserAuthForm({ setupRequired, redirectTo }: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = useAuthStore((state) => state.auth)
  const schema = useMemo(
    () =>
      z
        .object({
          username: z
            .string()
            .trim()
            .min(
              setupRequired ? 3 : 1,
              setupRequired ? '用户名至少需要 3 个字符' : '请输入用户名'
            )
            .max(64, '用户名最多 64 个字符'),
          password: z
            .string()
            .min(
              setupRequired ? 8 : 1,
              setupRequired ? '密码至少需要 8 个字符' : '请输入密码'
            )
            .max(256, '密码最多 256 个字符'),
          confirmPassword: z.string(),
        })
        .superRefine((value, context) => {
          if (setupRequired && value.password !== value.confirmPassword) {
            context.addIssue({
              code: 'custom',
              path: ['confirmPassword'],
              message: '两次输入的密码不一致',
            })
          }
        }),
    [setupRequired]
  )

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: '',
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (values: AuthFormValues) => {
    setIsLoading(true)
    form.clearErrors('root')
    try {
      const session = setupRequired
        ? await api.authSetup({
            username: values.username.trim(),
            password: values.password,
            confirm_password: values.confirmPassword,
          })
        : await api.authLogin({
            username: values.username.trim(),
            password: values.password,
          })
      auth.setSession(session.accessToken, session.user, session.expiresAt)
      queryClient.setQueryData(['auth', 'status'], {
        setupRequired: false,
        authenticated: true,
        user: session.user,
      })
      queryClient.setQueryData(['auth', 'me'], { user: session.user })
      toast.success(setupRequired ? '管理员创建成功' : '登录成功')
      if (setupRequired) {
        await navigate({
          to: '/onboarding',
          search: { redirect: normalizedRedirect(redirectTo) },
          replace: true,
        })
      } else {
        await navigate({
          to: normalizedRedirect(redirectTo),
          replace: true,
        })
      }
    } catch (error) {
      form.setError('root', { message: getErrorMessage(error) })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-4'>
        <FormField
          control={form.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>管理员用户名</FormLabel>
              <FormControl>
                <Input
                  autoComplete='username'
                  placeholder='输入用户名'
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>密码</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete={
                    setupRequired ? 'new-password' : 'current-password'
                  }
                  placeholder='输入密码'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {setupRequired && (
          <FormField
            control={form.control}
            name='confirmPassword'
            render={({ field }) => (
              <FormItem>
                <FormLabel>确认密码</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete='new-password'
                    placeholder='再次输入密码'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {form.formState.errors.root?.message && (
          <div
            role='alert'
            className='rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive'
          >
            {form.formState.errors.root.message}
          </div>
        )}
        <Button type='submit' className='mt-1 w-full' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LockKeyhole />}
          {setupRequired ? '创建账号并初始化' : '登录控制台'}
        </Button>
      </form>
    </Form>
  )
}

function normalizedRedirect(value?: string): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}
