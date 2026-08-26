import { Activity, Calculator, Power, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { InfoTooltip } from '@/components/info-tooltip'
import {
  NumberField,
  RiskFactorRow,
  RiskFieldGroup,
  RiskScoreField,
  RiskStatusRule,
  SettingList,
  SettingListItem,
  SettingsCard,
} from './settings-components'
import {
  formatFactorLimit,
  formatNumber,
  formatPercent,
} from './settings-format'
import {
  setRiskRuleEnabled,
  setRiskRulePriority,
  type SettingsForm,
  type SettingsSetter,
} from './settings-model'
import { SettingsReasoningPolicyCard } from './settings-reasoning-policy-card'

export function SettingsRiskTab({
  form,
  set,
  restoreRecommendedRiskScoring,
}: {
  form: SettingsForm
  set: SettingsSetter
  restoreRecommendedRiskScoring: () => void
}) {
  return (
    <div className='space-y-4'>
      <div className='grid gap-4 xl:grid-cols-2'>
        <SettingsCard
          icon={Activity}
          title='样本判定规则'
          description='配置探针样本的统计范围、TPS 阈值和缓冲特征。样本判定结果用于账号风险分析。'
        >
          <div className='space-y-5'>
            <RiskFieldGroup
              title='样本范围'
              hint='仅分析指定时间范围内且输出 Token 达到要求的探针样本。'
            >
              <NumberField
                label='分析窗口（小时）'
                hint='账号风险统计最近这段时间内当前固定出口、临时切换出口及上游调度诊断产生的探针样本。默认 168 小时即最近 7 天；更短会更快淡化旧异常，更长会保留更久的历史影响。保存后会立即按新窗口重算全部账号。'
                value={form.analysisWindowHours}
                min={1}
                max={8760}
                onChange={(value) => set('analysisWindowHours', value)}
              />
              <NumberField
                label='最低输出 Token'
                value={form.minimumOutputTokens}
                min={1}
                max={4096}
                onChange={(value) => set('minimumOutputTokens', value)}
              />
            </RiskFieldGroup>

            <p className='rounded-lg bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground'>
              当前统计最近 {form.analysisWindowHours} 小时。每次探针完成、删除结果或保存风险设置时，都会按该窗口重算异常占比、连续次数、风险分和账号状态。
            </p>

            <RiskFieldGroup
              title='TPS 阈值'
              hint='达到异常阈值的样本记为异常；达到强异常阈值的样本记为强异常。'
            >
              <NumberField
                label='异常 TPS 下限'
                value={form.degradationTps}
                min={0.1}
                step={0.1}
                onChange={(value) => set('degradationTps', value)}
              />
              <NumberField
                label='强异常 TPS 下限'
                value={form.strongDegradationTps}
                min={0.1}
                step={0.1}
                onChange={(value) => set('strongDegradationTps', value)}
              />
            </RiskFieldGroup>

            <RiskFieldGroup
              title='缓冲特征'
              hint='用于识别等待较久后集中吐出内容的样本。'
            >
              <NumberField
                label='首 Token 占比'
                value={form.bufferFirstTokenShare}
                min={0.5}
                max={0.99}
                step={0.01}
                suffix='%'
                displayMultiplier={100}
                onChange={(value) => set('bufferFirstTokenShare', value)}
              />
              <NumberField
                label='最短生成窗口（ms）'
                value={form.minGenerationMs}
                min={1}
                max={60000}
                onChange={(value) => set('minGenerationMs', value)}
              />
            </RiskFieldGroup>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={ShieldCheck}
          title='账号风险判定'
          description='配置账号进入观察、疑似和高风险的条件。统计风险周期内全部出口策略产生的有效探针样本。'
        >
          <div className='space-y-5'>
            <div className='grid gap-4 sm:grid-cols-3'>
              <NumberField
                label='重复异常次数'
                hint='连续条件和累计条件共用这个最少次数'
                value={form.consecutiveAnomalies}
                min={2}
                max={20}
                onChange={(value) => set('consecutiveAnomalies', value)}
              />
              <NumberField
                label='累计异常占比'
                hint='累计异常达到重复次数后，还要满足该占比'
                value={form.cumulativeAnomalyRate}
                min={0.01}
                max={1}
                step={0.01}
                suffix='%'
                displayMultiplier={100}
                onChange={(value) => set('cumulativeAnomalyRate', value)}
              />
              <NumberField
                label='高风险最少强信号数'
                hint='先满足重复异常，再检查强信号数量'
                value={form.highRiskHardCount}
                min={1}
                max={100}
                onChange={(value) => set('highRiskHardCount', value)}
              />
            </div>

            <div className='overflow-hidden rounded-xl border'>
              <RiskStatusRule
                status='观察'
                description='窗口内出现异常，但还没有满足重复条件'
                tone='warning'
              />
              <RiskStatusRule
                status='疑似'
                description={`连续 ${form.consecutiveAnomalies} 次，或累计至少 ${form.consecutiveAnomalies} 次且占比达到 ${formatPercent(form.cumulativeAnomalyRate)}`}
                tone='danger'
                divided
              />
              <RiskStatusRule
                status='高风险'
                description={`已经进入疑似，并且强信号达到 ${form.highRiskHardCount} 次`}
                tone='danger'
                divided
              />
            </div>
          </div>
        </SettingsCard>
      </div>

      <SettingsReasoningPolicyCard form={form} set={set} />

      <SettingsCard
        icon={Calculator}
        title='风险评分规则'
        description='配置各类风险信号每次增加多少分、同类信号最多累计多少分，以及不同账号状态的最低显示分。评分用于排序和展示，不直接改变状态判定。'
      >
        <div className='space-y-5'>
          <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
            <p className='max-w-3xl text-xs leading-5 text-muted-foreground'>
              <span className='font-medium text-foreground'>每次加分</span>
              是该信号出现一次增加多少分；
              <span className='font-medium text-foreground'>最多计分</span>
              是同类信号的上限。例如强信号每次加{' '}
              {formatNumber(form.riskHardWeight)} 分、最多{' '}
              {formatNumber(form.riskHardCap)} 分，通常需要{' '}
              {formatFactorLimit(form.riskHardWeight, form.riskHardCap)}{' '}
              个强信号才到上限。
            </p>
            <Button
              type='button'
              variant='outline'
              className='shrink-0'
              onClick={restoreRecommendedRiskScoring}
            >
              恢复推荐计分参数
            </Button>
          </div>

          <div className='overflow-hidden rounded-xl border'>
            <div className='hidden grid-cols-[minmax(0,1fr)_9rem_9rem] gap-4 border-b bg-muted/30 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase md:grid'>
              <span>计分因子</span>
              <span>加分强度</span>
              <span>最多计分</span>
            </div>
            <RiskFactorRow
              title='异常信号率'
              description='按异常样本占比计分，不按次数累加。例如设置 30 分，异常占比 50% 时本项得 15 分。'
              weight={form.riskAnomalyRateWeight}
              automaticCap
              onWeightChange={(value) => set('riskAnomalyRateWeight', value)}
            />
            <RiskFactorRow
              title='强信号'
              description='buffered_hard、fast_risk、marker_miss，以及达到模型策略连续次数后的 reasoning_zero 会计为强信号；单次思考为 0 仅观察。'
              weight={form.riskHardWeight}
              cap={form.riskHardCap}
              onWeightChange={(value) => set('riskHardWeight', value)}
              onCapChange={(value) => set('riskHardCap', value)}
            />
            <RiskFactorRow
              title='持续高速'
              description='每个 fast_risk 样本的专项额外加分，用于提高持续高速生成信号的优先级。'
              weight={form.riskFastWeight}
              cap={form.riskFastCap}
              onWeightChange={(value) => set('riskFastWeight', value)}
              onCapChange={(value) => set('riskFastCap', value)}
            />
            <RiskFactorRow
              title='标记缺失'
              description='每个 marker_miss 样本的专项额外加分，用于提高预期标记缺失信号的优先级。'
              weight={form.riskMarkerMissWeight}
              cap={form.riskMarkerMissCap}
              onWeightChange={(value) => set('riskMarkerMissWeight', value)}
              onCapChange={(value) => set('riskMarkerMissCap', value)}
            />
            <RiskFactorRow
              title='连续信号'
              description='按分析窗口内最大连续异常次数逐次加分，中间的正常可测样本会中断连续计数。'
              weight={form.riskStreakWeight}
              cap={form.riskStreakCap}
              onWeightChange={(value) => set('riskStreakWeight', value)}
              onCapChange={(value) => set('riskStreakCap', value)}
            />
          </div>

          <div className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex items-center gap-1.5 text-sm font-medium'>
                分数边界
                <InfoTooltip
                  label='分数边界'
                  content='状态保底分按从低到高排列，并且不能超过总分上限。保存后立即热应用，并使用新公式重算已有账号。'
                />
              </div>
              <div className='flex flex-wrap gap-2'>
                <Badge variant='warning'>
                  观察 {formatNumber(form.riskWatchFloor)}
                </Badge>
                <Badge variant='destructive'>
                  疑似 {formatNumber(form.riskSuspectFloor)}
                </Badge>
                <Badge variant='destructive'>
                  高风险 {formatNumber(form.riskHighFloor)}
                </Badge>
                <Badge variant='outline'>
                  上限 {formatNumber(form.riskScoreCap)}
                </Badge>
              </div>
            </div>
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <RiskScoreField
                label='观察保底'
                hint='账号处于观察状态时，即使原始加权分更低，也至少显示该分数。'
                tone='warning'
                value={form.riskWatchFloor}
                onChange={(value) => set('riskWatchFloor', value)}
              />
              <RiskScoreField
                label='疑似保底'
                hint='账号满足重复异常条件后，风险分至少显示该分数。'
                tone='danger'
                value={form.riskSuspectFloor}
                onChange={(value) => set('riskSuspectFloor', value)}
              />
              <RiskScoreField
                label='高风险保底'
                hint='账号满足重复异常和强信号条件后，风险分至少显示该分数。'
                tone='danger'
                value={form.riskHighFloor}
                onChange={(value) => set('riskHighFloor', value)}
              />
              <RiskScoreField
                label='总分上限'
                hint='所有计分因子相加并应用保底分后，最终风险分不会超过该值。'
                tone='default'
                value={form.riskScoreCap}
                min={0.1}
                onChange={(value) => set('riskScoreCap', value)}
              />
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={ShieldCheck}
        title='风控规则目录'
        description='目录中的数字是执行顺序，不是风险分：数值越小越先判断，单次样本命中主规则后停止向后分类。新增规则在后端注册后会自动出现；关闭规则后按剩余规则重算账号。'
      >
        <div className='space-y-4'>
          <p className='text-xs leading-5 text-muted-foreground'>
            例如 <span className='font-mono text-foreground'>10</span> 会先于{' '}
            <span className='font-mono text-foreground'>100</span>{' '}
            执行；它们只控制规则先后，不会给账号加分。思考连续信号由聚合阶段单独累计，因此不会被 TPS 主分类遮蔽。
          </p>
          <div className='overflow-hidden rounded-xl border'>
            {form.riskRules.length ? (
              [...form.riskRules]
                .sort((left, right) => {
                  const leftPriority =
                    form.riskRuleOverrides.find((item) => item.id === left.id)
                      ?.priority ?? left.priority
                  const rightPriority =
                    form.riskRuleOverrides.find((item) => item.id === right.id)
                      ?.priority ?? right.priority
                  return leftPriority - rightPriority
                })
                .map((rule, index) => {
                  const override = form.riskRuleOverrides.find(
                    (item) => item.id === rule.id
                  )
                  const enabled = override?.enabled ?? rule.enabled
                  return (
                    <div
                      key={rule.id}
                      className={`flex items-start justify-between gap-4 px-4 py-3.5 ${index ? 'border-t' : ''}`}
                    >
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='text-sm font-medium'>
                            {rule.label}
                          </span>
                          <Badge variant='outline'>
                            顺序 {override?.priority ?? rule.priority}
                          </Badge>
                          {rule.scopes.map((scope) => (
                            <Badge key={scope} variant='secondary'>
                              {scope === 'probe'
                                ? '探针'
                                : scope === 'audit'
                                  ? '审计'
                                  : scope}
                            </Badge>
                          ))}
                        </div>
                        <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                          {rule.description}
                          <span className='ml-2 font-mono text-[10px]'>
                            {rule.id}
                          </span>
                        </p>
                      </div>
                      <div className='flex shrink-0 items-center gap-2'>
                        <Input
                          className='h-8 w-20'
                          type='number'
                          min={-100000}
                          max={100000}
                          value={override?.priority ?? rule.priority}
                          disabled={!rule.configurable}
                          aria-label={`${rule.label}优先级`}
                          onChange={(event) =>
                            set(
                              'riskRuleOverrides',
                              setRiskRulePriority(
                                form,
                                rule.id,
                                Number(event.target.value)
                              )
                            )
                          }
                        />
                        <Switch
                          checked={enabled}
                          disabled={!rule.configurable}
                          aria-label={`${rule.label}规则`}
                          onCheckedChange={(value) => {
                            set(
                              'riskRuleOverrides',
                              setRiskRuleEnabled(form, rule.id, value)
                            )
                            if (rule.id === 'reasoning_zero') {
                              set('reasoningZeroRiskEnabled', value)
                            }
                            if (rule.id === 'media_input_observe') {
                              set('mediaInputObserveEnabled', value)
                            }
                          }}
                        />
                      </div>
                    </div>
                  )
                })
            ) : (
              <div className='px-4 py-6 text-sm text-muted-foreground'>
                保存或刷新设置后载入规则目录。
              </div>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Power}
        title='自动隔离'
        description='高风险账号可以自动停用 grok2api 账号；请求审计工作台的处置开关也在这里统一管理。'
      >
        <SettingList>
          <SettingListItem
            label='请求审计账号处置'
            description='控制请求审计工作台和自动处置流程是否可以停用或调整账号；关闭后仍保存风险证据。这里的隔离就是停用 grok2api 账号。'
            checked={form.requestAuditIsolationEnabled}
            onCheckedChange={(value) =>
              set('requestAuditIsolationEnabled', value)
            }
          />
          <SettingListItem
            label='TPS-only 自动降优先级'
            description='TPS 多次异常时，只降低 grok2api 优先级并提示更换出口，不直接停用。'
            checked={form.requestAuditTpsOnlyDeprioritizeEnabled}
            onCheckedChange={(value) =>
              set('requestAuditTpsOnlyDeprioritizeEnabled', value)
            }
          >
            {form.requestAuditTpsOnlyDeprioritizeEnabled ? (
              <div className='max-w-xs'>
                <NumberField
                  label='TPS-only 累计异常次数'
                  hint='达到该次数后降低账号优先级并提示更换出口。'
                  value={form.requestAuditTpsOnlyMinCount}
                  min={2}
                  max={100}
                  onChange={(value) =>
                    set('requestAuditTpsOnlyMinCount', value)
                  }
                />
              </div>
            ) : null}
          </SettingListItem>
          <SettingListItem
            label='自动停用高风险账号'
            description={`探针侧重复异常成立且强信号达到 ${form.highRiskHardCount} 次后，通过 grok2api 管理 API 停用账号。`}
            checked={form.autoQuarantine}
            onCheckedChange={(value) => set('autoQuarantine', value)}
          />
          <SettingListItem
            label='到期自动恢复'
            description='开启后按停用时长自动启用并降至最低优先级；关闭后保持停用，只能人工恢复。'
            checked={form.autoQuarantineRecoveryEnabled}
            disabled={!form.autoQuarantine}
            onCheckedChange={(value) =>
              set('autoQuarantineRecoveryEnabled', value)
            }
          >
            {form.autoQuarantine ? (
              <div className='max-w-xs'>
                <NumberField
                  label='停用时长'
                  hint='单位为分钟，仅在开启到期自动恢复时使用。'
                  value={form.quarantineMinutes}
                  min={1}
                  max={10080}
                  suffix='分钟'
                  disabled={!form.autoQuarantineRecoveryEnabled}
                  onChange={(value) => set('quarantineMinutes', value)}
                />
              </div>
            ) : null}
          </SettingListItem>
        </SettingList>
      </SettingsCard>
    </div>
  )
}
