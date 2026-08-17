import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

type ViewStateRecord = Record<string, string | number | boolean>

function writeStoredView<T extends ViewStateRecord>(
  key: string,
  initialValue: T,
  value: T
) {
  try {
    if (JSON.stringify(value) !== JSON.stringify(initialValue)) {
      window.localStorage.setItem(key, JSON.stringify(value))
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // View-state persistence is optional and must not affect the table.
  }
}

function readStoredView<T extends ViewStateRecord>(
  key: string,
  initialValue: T
): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return null
    }
    const value = stored as Record<string, unknown>
    const next = { ...initialValue }
    const writable = next as ViewStateRecord
    for (const [field, fallback] of Object.entries(initialValue)) {
      const candidate = value[field]
      if (typeof candidate === typeof fallback) {
        writable[field] = candidate as string | number | boolean
      }
    }
    return next
  } catch {
    return null
  }
}

export function usePersistedViewState<T extends ViewStateRecord>(
  key: string,
  initialValue: T
) {
  const [restored, setRestored] = useState(() => {
    if (typeof window === 'undefined') return false
    return readStoredView(key, initialValue) != null
  })
  const [value, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue
    return readStoredView(key, initialValue) ?? initialValue
  })
  const latestRef = useRef({ key, initialValue, value })
  const active = useMemo(
    () => JSON.stringify(value) !== JSON.stringify(initialValue),
    [initialValue, value]
  )

  useEffect(() => {
    latestRef.current = { key, initialValue, value }
  }, [initialValue, key, value])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeStoredView(key, initialValue, value)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [active, initialValue, key, value])

  useEffect(
    () => () => {
      const latest = latestRef.current
      writeStoredView(latest.key, latest.initialValue, latest.value)
    },
    []
  )

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    setRestored(false)
    setStoredValue((current) => {
      const next =
        typeof nextValue === 'function'
          ? (nextValue as (current: T) => T)(current)
          : nextValue
      latestRef.current = { ...latestRef.current, value: next }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    latestRef.current = { key, initialValue, value: initialValue }
    setStoredValue(initialValue)
    setRestored(false)
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Keep the in-memory reset even when browser storage is unavailable.
    }
  }, [initialValue, key])

  return {
    value,
    setValue,
    active,
    restored: restored && active,
    clear,
  }
}
