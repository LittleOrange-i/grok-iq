import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function EgressNodeReference({
  nodeId,
  nodeName,
  prefix = '#',
  className,
}: {
  nodeId: string | number
  nodeName?: string | null
  prefix?: string
  className?: string
}) {
  const id = String(nodeId)
  const name = nodeName?.trim()
  const label = name ? `${name}，Node ${id}` : `Node ${id}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'cursor-help underline decoration-dotted underline-offset-2',
            className
          )}
          tabIndex={0}
          aria-label={label}
        >
          {prefix}
          {id}
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-72'>
        <div className='font-medium'>{name || `出口节点 ${id}`}</div>
        <div className='mt-0.5 text-background/75'>
          Node ID：{id}
          {!name ? ' · 节点名称暂未获取' : ''}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
