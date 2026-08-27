export const WORKSPACE_TAB_IDS = [
  'accounts',
  'runs',
  'request-audits',
] as const

export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number]

export const WORKSPACE_TAB_PATHS = {
  accounts: '/accounts',
  runs: '/runs',
  'request-audits': '/request-audits',
} as const

export const WORKSPACE_TAB_TITLES: Record<WorkspaceTabId, string> = {
  accounts: '账号探针',
  runs: '任务中心',
  'request-audits': '请求审计',
}

export function normalizePathname(pathname: string): string {
  const path = pathname.replace(/\/+$/, '')
  return path || '/'
}

export function matchWorkspaceTabId(pathname: string): WorkspaceTabId | null {
  const path = normalizePathname(pathname)
  const matched = WORKSPACE_TAB_IDS.find(
    (id) => WORKSPACE_TAB_PATHS[id] === path
  )
  return matched ?? null
}

export function isWorkspaceTabPath(pathname: string): boolean {
  return matchWorkspaceTabId(pathname) != null
}
