import type { SystemVersionInfo } from '@/lib/api'

export const SYSTEM_VERSION_QUERY_KEY = ['system-version'] as const

export const SYSTEM_UPDATE_COMMANDS = [
  'docker compose --profile "*" pull',
  'docker compose --profile "*" up -d --force-recreate --remove-orphans',
].join('\n')

export const SYSTEM_UPDATE_DISMISS_KEY = 'grokiq-dismissed-update-version'
export const SYSTEM_UPDATE_PREVIEW_EVENT = 'grokiq-system-update-preview'

export function buildSystemUpdatePreview(
  current: SystemVersionInfo
): SystemVersionInfo {
  const match = current.currentVersion.match(/^v?(\d+)\.(\d+)\.(\d+)/i)
  const previewVersion = match
    ? `v${match[1]}.${match[2]}.${Number(match[3]) + 1}`
    : 'vNEXT'
  return {
    status: 'update_available',
    updateAvailable: true,
    currentVersion: current.currentVersion,
    latestVersion: previewVersion,
    releaseUrl: 'https://github.com/kaibush/grok-iq/releases',
    releaseNotes: [
      '## 更新提醒预览',
      '',
      '> 这是开发环境中的本地界面预览，不会修改后端检测结果。',
      '',
      '- 展示 GitHub Release 更新说明',
      '- 提供 Docker Compose 更新命令',
      '- 支持关闭本次提醒',
    ].join('\n'),
    publishedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    error: '',
  }
}
