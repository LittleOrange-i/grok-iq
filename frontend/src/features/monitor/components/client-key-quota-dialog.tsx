import { useRef, useState, type FormEvent } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import {
  api,
  type PublicClientKeyQuota,
  type PublicClientKeyQuotaLookup,
} from '@/lib/api'
import { formatDate, getErrorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProgressBar } from '@/components/ui/progress'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function formatUsd(value: number) {
  return usdFormatter.format(value)
}

export function ClientKeyQuotaDialog() {
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<PublicClientKeyQuotaLookup | null>(null)
  const lookupGenerationRef = useRef(0)
  const pendingRef = useRef(false)
  const canSubmit = apiKey.trim().length > 0 && !pending

  function resetLookupState() {
    lookupGenerationRef.current += 1
    pendingRef.current = false
    setApiKey('')
    setPending(false)
    setErrorMessage('')
    setResult(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) resetLookupState()
  }

  async function lookupQuota() {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey || pendingRef.current) return
    const lookupGeneration = lookupGenerationRef.current + 1
    lookupGenerationRef.current = lookupGeneration
    pendingRef.current = true
    setPending(true)
    setErrorMessage('')
    setResult(null)
    try {
      const lookupResult = await api.lookupPublicClientKeyQuota(trimmedKey)
      if (lookupGenerationRef.current !== lookupGeneration) return
      setResult(lookupResult)
    } catch (error) {
      if (lookupGenerationRef.current !== lookupGeneration) return
      setErrorMessage(getErrorMessage(error))
    } finally {
      if (lookupGenerationRef.current === lookupGeneration) {
        pendingRef.current = false
        setPending(false)
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void lookupQuota()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type='button' size='sm' variant='outline'>
          <KeyRound />
          查询密钥额度
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>查询密钥额度</DialogTitle>
          <DialogDescription>
            输入 grok2api Client Key，查看剩余额度。
          </DialogDescription>
        </DialogHeader>
        <form className='space-y-3' onSubmit={handleSubmit}>
          <div className='space-y-1.5'>
            <Label htmlFor='public-client-key-quota'>Client Key</Label>
            <Input
              id='public-client-key-quota'
              type='password'
              autoComplete='off'
              spellCheck={false}
              placeholder='g2a_********'
              className='font-mono'
              maxLength={256}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          {errorMessage ? (
            <p className='text-sm text-destructive'>{errorMessage}</p>
          ) : null}
          {result && !result.found ? (
            <p className='text-sm text-muted-foreground'>
              未找到该密钥，或密钥无效
            </p>
          ) : null}
          {result && result.found ? <QuotaResult quota={result} /> : null}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button type='submit' disabled={!canSubmit}>
              {pending ? <Loader2 className='animate-spin' /> : null}
              查询
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QuotaResult({ quota }: { quota: PublicClientKeyQuota }) {
  return (
    <div className='space-y-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='truncate font-medium'>{quota.name}</div>
          {quota.prefix ? (
            <div
              className='mt-0.5 truncate font-mono text-xs text-muted-foreground'
            >
              {quota.prefix}
            </div>
          ) : null}
        </div>
        <div className='flex shrink-0 flex-wrap justify-end gap-1.5'>
          <Badge variant={quota.enabled ? 'success' : 'outline'}>
            {quota.enabled ? '已启用' : '已停用'}
          </Badge>
          {quota.expired ? <Badge variant='destructive'>已过期</Badge> : null}
        </div>
      </div>
      <div className='rounded-lg border bg-muted/20 px-3 py-3'>
        <div className='text-xs text-muted-foreground'>剩余额度</div>
        <div className='mt-1 text-xl font-semibold tabular-nums'>
          {quota.unlimited
            ? '不限额度'
            : formatUsd(quota.remainingUsd)}
        </div>
        {quota.unlimited ? (
          <p className='mt-1 text-sm text-muted-foreground tabular-nums'>
            已用 {formatUsd(quota.billedUsageUsd)}
          </p>
        ) : (
          <div className='mt-3 space-y-2'>
            <ProgressBar className='h-2' value={quota.usagePercent} />
            <p className='text-sm text-muted-foreground tabular-nums'>
              已用 {formatUsd(quota.billedUsageUsd)} / 总量{' '}
              {formatUsd(quota.billingLimitUsd)}
            </p>
          </div>
        )}
      </div>
      <div className='grid gap-2 sm:grid-cols-2'>
        <div className='rounded-lg border bg-muted/20 px-3 py-2'>
          <div className='text-xs text-muted-foreground'>最近使用</div>
          <div className='mt-1 text-sm tabular-nums'>
            {formatDate(quota.lastUsedAt)}
          </div>
        </div>
        <div className='rounded-lg border bg-muted/20 px-3 py-2'>
          <div className='text-xs text-muted-foreground'>过期时间</div>
          <div className='mt-1 text-sm tabular-nums'>
            {formatDate(quota.expiresAt)}
          </div>
        </div>
      </div>
    </div>
  )
}
