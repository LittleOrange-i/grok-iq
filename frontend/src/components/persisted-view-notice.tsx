import { History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PersistedViewNotice({
  restored,
  summary,
  onClear,
}: {
  restored: boolean
  summary: string
  onClear: () => void
}) {
  return (
    <div className='mb-4 flex flex-col gap-3 rounded-md border border-primary/20 bg-primary/[0.035] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex min-w-0 items-center gap-2.5'>
        <History className='size-4 shrink-0 text-primary' />
        <div className='min-w-0 text-xs'>
          <div className='font-medium text-foreground'>
            {restored ? '已恢复上次查看视图' : '当前为自定义视图'}
          </div>
          <div className='mt-0.5 truncate text-muted-foreground' title={summary}>
            {summary}
          </div>
        </div>
      </div>
      <Button
        type='button'
        size='sm'
        variant='outline'
        className='shrink-0'
        onClick={onClear}
      >
        <RotateCcw />
        清除视图
      </Button>
    </div>
  )
}
