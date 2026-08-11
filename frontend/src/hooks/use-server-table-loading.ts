import { useCallback, useEffect, useRef, useState } from 'react'

export function useServerTableLoading({
  isFetching,
  inputPending = false,
  minimumDurationMs = 180,
}: {
  isFetching: boolean
  inputPending?: boolean
  minimumDurationMs?: number
}) {
  const [interactionPending, setInteractionPending] = useState(false)
  const startedAtRef = useRef(0)

  const beginTableInteraction = useCallback(() => {
    startedAtRef.current = Date.now()
    setInteractionPending(true)
  }, [])

  useEffect(() => {
    if (!interactionPending || inputPending || isFetching) return
    const elapsed = Date.now() - startedAtRef.current
    const remaining = Math.max(0, minimumDurationMs - elapsed)
    const timer = window.setTimeout(
      () => setInteractionPending(false),
      remaining
    )
    return () => window.clearTimeout(timer)
  }, [inputPending, interactionPending, isFetching, minimumDurationMs])

  return {
    beginTableInteraction,
    tableLoading: inputPending || interactionPending,
  }
}
