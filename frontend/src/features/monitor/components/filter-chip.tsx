import { CircleX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export function FilterChip({
  label,
  onClear,
}: {
  label: string
  onClear: () => void
}) {
  return (
    <Badge variant='secondary' className='gap-1 rounded-full pr-1 font-normal'>
      <span className='max-w-56 truncate'>{label}</span>
      <button
        type='button'
        className='rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground'
        aria-label={`移除${label}`}
        onClick={onClear}
      >
        <CircleX className='size-3' />
      </button>
    </Badge>
  )
}
