import { formatNumber } from '@/lib/utils'

export function tpsOverridden(
  tps: number | null | undefined,
  upstreamTps?: number | null
) {
  return (
    tps != null &&
    upstreamTps != null &&
    Number.isFinite(tps) &&
    Number.isFinite(upstreamTps) &&
    Math.abs(upstreamTps - tps) > 0.01
  )
}

export function formatDualTps(
  tps: number | null | undefined,
  upstreamTps?: number | null
) {
  if (tps == null || !Number.isFinite(tps)) return '—'
  const main = formatNumber(tps)
  if (!tpsOverridden(tps, upstreamTps)) return main
  return `${main}（上游 ${formatNumber(upstreamTps ?? tps)}）`
}


export function durationWindowTps(
  outputTokens?: number | null,
  durationMs?: number | null
) {
  if (
    outputTokens == null ||
    durationMs == null ||
    outputTokens <= 0 ||
    durationMs <= 0
  ) {
    return null
  }
  return (outputTokens * 1000) / durationMs
}
