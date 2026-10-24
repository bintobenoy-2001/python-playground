export type Variable = { name: string; scope: 'local' | 'global'; type: string; value: string; objectId: string | null }
export type HeapItem = { key: string; value: string; ref: string | null }
export type HeapObject = { id: string; type: string; preview: string; length: number | null; items: HeapItem[]; truncated: boolean }
export type StackFrame = { function: string; line: number }
export type TraceEvent = {
  id: number; type: string; line: number; function: string; source: string
  snapshot: { variables: Variable[]; heap: HeapObject[] }
  stack: StackFrame[]; output: string; beginner: string; technical: string
  returnValue?: string; text?: string; inputValue?: string; prompt?: string
  exception?: { type: string; message: string; hint?: string }
}
export type StructureNode = { id: string; line: number; endLine: number; kind: string; label: string; indent: number }
export type StructureEdge = { from: string; to: string; type: string }
export type TraceResult = {
  status: 'completed' | 'error' | 'stopped' | 'blocked' | 'syntax_error' | 'needs_input'
  events: TraceEvent[]
  structure: { nodes: StructureNode[]; edges: StructureEdge[] }
  output: string; error: null | { type: string; message: string; line?: number; offset?: number; hint?: string }
  needsInput: null | { prompt: string; index: number }
  limits?: { events: number; output: number; recursion: number; timeSeconds: number }
}
export type ViewMode = 'flow' | 'memory' | 'stack' | 'journey' | 'loop' | 'recursion'
