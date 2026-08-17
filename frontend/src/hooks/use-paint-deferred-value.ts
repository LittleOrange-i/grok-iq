import { useEffect, useRef, useState } from 'react'

function sameValue<T>(left: T, right: T) {
  if (Object.is(left, right)) return true
  if (
    left == null ||
    right == null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  if (keys.length !== Object.keys(rightRecord).length) return false
  return keys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
}

// Keep the first paint in sync, then wait for the browser to paint the
// current UI (loading overlay, closed select) before applying the next value.
export function usePaintDeferredValue<T>(value: T): T {
  const [deferred, setDeferred] = useState(value)
  const skipDeferRef = useRef(true)

  useEffect(() => {
    if (skipDeferRef.current) {
      skipDeferRef.current = false
      return
    }
    if (sameValue(deferred, value)) return

    let innerId = 0
    const outerId = window.requestAnimationFrame(() => {
      innerId = window.requestAnimationFrame(() => {
        setDeferred(value)
      })
    })
    return () => {
      window.cancelAnimationFrame(outerId)
      window.cancelAnimationFrame(innerId)
    }
  }, [deferred, value])

  return deferred
}
