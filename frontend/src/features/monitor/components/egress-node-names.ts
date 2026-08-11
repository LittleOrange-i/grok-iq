import type { EgressNode } from '@/lib/api'

export type EgressNodeNameMap = ReadonlyMap<string, string>

export function buildEgressNodeNameMap(
  nodes: Pick<EgressNode, 'id' | 'name'>[] | undefined
): EgressNodeNameMap {
  return new Map(
    (nodes ?? [])
      .filter((node) => node.id != null && node.name.trim())
      .map((node) => [String(node.id), node.name.trim()])
  )
}

export function getEgressNodeName(
  names: EgressNodeNameMap,
  nodeId?: string | number | null
): string | undefined {
  if (nodeId == null || nodeId === '') return undefined
  return names.get(String(nodeId))
}

export function formatEgressNodeText(
  names: EgressNodeNameMap,
  nodeId?: string | number | null,
  prefix = '#'
): string {
  if (nodeId == null || nodeId === '') return '—'
  const id = String(nodeId)
  const name = getEgressNodeName(names, id)
  return name ? `${prefix}${id}（${name}）` : `${prefix}${id}`
}
