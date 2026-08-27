import { cn } from '@/lib/utils'

type LogoProps = {
  className?: string
  variant?: 'auto' | 'on-light' | 'on-dark'
  alt?: string
}

const DARK_MARK = '/images/favicon.svg?v=2'
const LIGHT_MARK = '/images/favicon_light.svg?v=2'

export function Logo({
  className,
  variant = 'auto',
  alt = 'GrokIQ',
}: LogoProps) {
  if (variant === 'on-light') {
    return (
      <img
        src={DARK_MARK}
        alt={alt}
        className={cn('size-8 shrink-0', className)}
      />
    )
  }

  if (variant === 'on-dark') {
    return (
      <img
        src={LIGHT_MARK}
        alt={alt}
        className={cn('size-8 shrink-0', className)}
      />
    )
  }

  return (
    <span className={cn('inline-flex size-8 shrink-0', className)}>
      <img src={DARK_MARK} alt={alt} className='size-full dark:hidden' />
      <img src={LIGHT_MARK} alt='' className='hidden size-full dark:block' />
    </span>
  )
}
