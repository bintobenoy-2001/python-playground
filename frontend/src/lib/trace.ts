import type { TraceEvent, Variable } from '../types'

export type VariableChange = { name: string; before?: Variable; after?: Variable; kind: 'created' | 'changed' | 'removed' }

export function deriveChanges(previous: TraceEvent | undefined, current: TraceEvent | undefined): VariableChange[] {
  if (!current) return []
  const before = new Map((previous?.snapshot.variables ?? []).map(v => [`${v.scope}:${v.name}`, v]))
  const after = new Map(current.snapshot.variables.map(v => [`${v.scope}:${v.name}`, v]))
  const changes: VariableChange[] = []
  after.forEach((value, key) => {
    const old = before.get(key)
    if (!old) changes.push({ name: value.name, after: value, kind: 'created' })
    else if (old.value !== value.value || old.objectId !== value.objectId) changes.push({ name: value.name, before: old, after: value, kind: 'changed' })
  })
  before.forEach((value, key) => {
    if (!after.has(key)) changes.push({ name: value.name, before: value, kind: 'removed' })
  })
  return changes
}

export function eventTone(type: string) {
  if (type === 'exception') return 'danger'
  if (type === 'call' || type === 'return') return 'purple'
  if (type === 'output') return 'success'
  if (type === 'input') return 'cyan'
  return 'blue'
}

export function getExecutedLines(events: TraceEvent[], index: number): Set<number> {
  return new Set(events.slice(0, index + 1).map(event => event.line).filter(Boolean))
}
