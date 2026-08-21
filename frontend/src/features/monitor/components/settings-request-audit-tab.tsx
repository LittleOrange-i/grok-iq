import { Link } from '@tanstack/react-router'
import { Archive, RefreshCw, ScanSearch, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  NumberField,
  SettingsCard,
  SwitchRow,
} from './settings-components'
import type { SettingsForm, SettingsSetter } from './settings-model'

function formatInterval(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

export function SettingsRequestAuditTab({
  form,
  set,
}: {
  form: SettingsForm
  set: SettingsSetter
}) {
  return (
    <div className='space-y-4'>
      <div className='grid gap-4 xl:grid-cols-2'>
        <SettingsCard
          icon={ScanSearch}
          title='采集与增量扫描'
          description='只控制请求审计数据的拉取和游标推进；风险判断统一在“风险与隔离”中配置。'
          descriptionAsHint
        >
          <div className='space-y-3'>
            <SwitchRow
              label='请求审计监控'
              description='允许手动和自动拉取 grok_build 请求审计；关闭后保留已有本地投影。'
              checked={form.requestAuditEnabled}
              onCheckedChange={(value) => set('requestAuditEnabled', value)}
            />
            <SwitchRow
              label='自动增量扫描'
              description='由后台任务持续读取最新游标页，并在扫描完成后保存进度。'
              checked={form.requestAuditAutoScanEnabled}
              disabled={!form.requestAuditEnabled}
              onCheckedChange={(value) =>
                set('requestAuditAutoScanEnabled', value)
              }
            />
            <SwitchRow
              label='自适应扫描节奏'
              description='根据近期请求量、风险活动和分页积压，在忙时、常态和闲时之间切换。'
              checked={form.requestAuditAdaptiveScanEnabled}
              disabled={!form.requestAuditAutoScanEnabled}
              onCheckedChange={(value) =>
                set('requestAuditAdaptiveScanEnabled', value)
              }
            />
          </div>
        </SettingsCard>

        <SettingsCard
          icon={RefreshCw}
          title='扫描节奏'
          description='自适应模式要求忙时不慢于常态、常态不慢于闲时；关闭后使用固定分钟间隔。'
          descriptionAsHint
        >
          {form.requestAuditAdaptiveScanEnabled ? (
            <div className='space-y-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <NumberField
                  label='忙时扫描间隔（秒）'
                  value={form.requestAuditBusyScanIntervalSeconds}
                  min={15}
                  max={300}
                  onChange={(value) =>
                    set('requestAuditBusyScanIntervalSeconds', value)
                  }
                />
                <NumberField
                  label='常态扫描间隔（秒）'
                  value={form.requestAuditNormalScanIntervalSeconds}
                  min={30}
                  max={1800}
                  onChange={(value) =>
                    set('requestAuditNormalScanIntervalSeconds', value)
                  }
                />
                <NumberField
                  label='闲时扫描间隔（秒）'
                  value={form.requestAuditIdleScanIntervalSeconds}
                  min={60}
                  max={3600}
                  onChange={(value) =>
                    set('requestAuditIdleScanIntervalSeconds', value)
                  }
                />
                <NumberField
                  label='忙时请求阈值（次/分钟）'
                  value={form.requestAuditBusyRequestsPerMinute}
                  min={1}
                  max={100000}
                  onChange={(value) =>
                    set('requestAuditBusyRequestsPerMinute', value)
                  }
                />
              </div>
              <div className='grid grid-cols-3 overflow-hidden rounded-lg border bg-muted/20 text-center'>
                {[
                  [
                    '忙时',
                    formatInterval(form.requestAuditBusyScanIntervalSeconds),
                    'text-amber-700 dark:text-amber-300',
                  ],
                  [
                    '常态',
                    formatInterval(form.requestAuditNormalScanIntervalSeconds),
                    'text-sky-700 dark:text-sky-300',
                  ],
                  [
                    '闲时',
                    formatInterval(form.requestAuditIdleScanIntervalSeconds),
                    'text-emerald-700 dark:text-emerald-300',
                  ],
                ].map(([label, value, tone], index) => (
                  <div
                    key={label}
                    className={`px-2 py-3 ${index ? 'border-l' : ''}`}
                  >
                    <div className='text-[11px] text-muted-foreground'>
                      {label}
                    </div>
                    <div className={`mt-1 font-mono text-sm ${tone}`}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <NumberField
              label='固定扫描间隔（分钟）'
              value={form.requestAuditScanIntervalMinutes}
              min={1}
              max={1440}
              onChange={(value) =>
                set('requestAuditScanIntervalMinutes', value)
              }
            />
          )}
        </SettingsCard>
      </div>

      <div className='grid gap-4 xl:grid-cols-2'>
        <SettingsCard
          icon={RefreshCw}
          title='页面刷新'
          description='页面后台刷新不改变当前筛选、分页和选中项，只替换最新聚合结果。'
          descriptionAsHint
        >
          <div className='space-y-4'>
            <SwitchRow
              label='页面无感刷新'
              description='请求审计工作台打开时，在后台按固定间隔刷新状态和列表。'
              checked={form.requestAuditLiveRefreshEnabled}
              onCheckedChange={(value) =>
                set('requestAuditLiveRefreshEnabled', value)
              }
            />
            <NumberField
              label='刷新间隔（秒）'
              value={form.requestAuditLiveRefreshSeconds}
              min={10}
              max={300}
              disabled={!form.requestAuditLiveRefreshEnabled}
              onChange={(value) =>
                set('requestAuditLiveRefreshSeconds', value)
              }
            />
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Archive}
          title='本地投影保留'
          description='控制请求审计本地明细的清理周期；账号风险聚合会基于仍保留的数据重新计算。'
          descriptionAsHint
        >
          <div className='space-y-4'>
            <NumberField
              label='本地保留天数'
              value={form.requestAuditRetentionDays}
              min={1}
              max={90}
              onChange={(value) => set('requestAuditRetentionDays', value)}
            />
            <div className='flex flex-col gap-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2 text-sm font-medium'>
                  <ShieldAlert className='size-4 text-sky-600' />
                  风险规则已集中管理
                </div>
                <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                  TPS、思考输出、Media Input、连续命中和自动处置不再在审计页面保存副本。
                </p>
              </div>
              <Button asChild variant='outline' size='sm' className='shrink-0'>
                <Link to='/settings/risk'>进入风险设置</Link>
              </Button>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Badge variant='secondary'>运行参数</Badge>
              <Badge variant='outline'>保存后热应用</Badge>
              <Badge variant='outline'>历史数据继续保留</Badge>
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  )
}
