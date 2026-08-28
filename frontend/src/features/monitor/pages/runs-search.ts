import { z } from 'zod'

export const runsSearchSchema = z.object({
  account: z.string().optional(),
  run: z.string().optional(),
})

export type RunsSearch = z.infer<typeof runsSearchSchema>

export function isRunsPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/runs'
}

export function readRunsSearch(search: unknown): RunsSearch {
  const parsed = runsSearchSchema.safeParse(search)
  if (!parsed.success) return {}
  const account = parsed.data.account?.trim()
  const run = parsed.data.run?.trim()
  return {
    ...(account ? { account } : {}),
    ...(run ? { run } : {}),
  }
}

export function pinnedAccountIdFromRunsSearch(
  search: RunsSearch
): number | null {
  const raw = search.account?.trim() ?? ''
  if (!/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

export function runsSearchFromAccount(
  accountId?: number | null,
  runId?: string | null
): RunsSearch | undefined {
  const account =
    typeof accountId === 'number' &&
    Number.isSafeInteger(accountId) &&
    accountId > 0
      ? String(accountId)
      : undefined
  const run = runId?.trim() || undefined
  if (!account && !run) return undefined
  return {
    ...(account ? { account } : {}),
    ...(run ? { run } : {}),
  }
}
