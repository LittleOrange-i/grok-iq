import { createContext, useContext, useState, type ReactNode } from 'react'
import { getCookie, setCookie } from '@/lib/cookies'

const TANSTACK_DEVTOOLS_COOKIE_NAME = 'tanstack_devtools'
const TANSTACK_DEVTOOLS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const DEFAULT_ENABLED = false

type TanStackDevtoolsContextType = {
  defaultEnabled: boolean
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  resetTanStackDevtools: () => void
}

const TanStackDevtoolsContext =
  createContext<TanStackDevtoolsContextType | null>(null)

function readEnabledCookie() {
  return getCookie(TANSTACK_DEVTOOLS_COOKIE_NAME) === '1'
}

export function TanStackDevtoolsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [enabled, _setEnabled] = useState<boolean>(() => readEnabledCookie())

  const setEnabled = (nextEnabled: boolean) => {
    _setEnabled(nextEnabled)
    setCookie(
      TANSTACK_DEVTOOLS_COOKIE_NAME,
      nextEnabled ? '1' : '0',
      TANSTACK_DEVTOOLS_COOKIE_MAX_AGE
    )
  }

  const resetTanStackDevtools = () => {
    setEnabled(DEFAULT_ENABLED)
  }

  return (
    <TanStackDevtoolsContext
      value={{
        defaultEnabled: DEFAULT_ENABLED,
        enabled,
        setEnabled,
        resetTanStackDevtools,
      }}
    >
      {children}
    </TanStackDevtoolsContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTanStackDevtools() {
  const context = useContext(TanStackDevtoolsContext)
  if (!context) {
    throw new Error(
      'useTanStackDevtools must be used within a TanStackDevtoolsProvider'
    )
  }
  return context
}
