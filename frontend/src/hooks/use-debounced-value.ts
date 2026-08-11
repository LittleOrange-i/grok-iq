import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(
  value: T,
  delayMs = 300
): readonly [T, boolean] {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    if (Object.is(value, debouncedValue)) return
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [debouncedValue, delayMs, value])

  return [debouncedValue, !Object.is(value, debouncedValue)] as const
}
