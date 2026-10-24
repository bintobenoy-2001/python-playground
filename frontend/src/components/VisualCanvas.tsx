import { useMemo, useState } from 'react'
import { Box, Braces, ChevronRight, CircleDot, CornerDownLeft, GitBranch, Maximize2, Minus, Network, Plus, RefreshCw, Repeat2, Route, ZoomIn } from '../icons'
import type { TraceEvent, TraceResult, ViewMode } from '../types'
import { deriveChanges, getExecutedLines } from '../lib/trace'

const modeMeta: Record<ViewMode, { label: string; icon: typeof Route }> = {
  flow: { label: 'Flow', icon: Route }, memory: { label: 'Memory', icon: Box },
  stack: { label: 'Call stack', icon: Braces }, journey: { label: 'Data journey', icon: Network },
  loop: { label: 'Loop focus', icon: Repeat2 }, recursion: { label: 'Recursion', icon: GitBranch },
}

function FlowView({ result, event, index }: { result: TraceResult; event?: TraceEvent; index: number }) {
  const executed = getExecutedLines(result.events, index)
  const activeLine = event?.line
  const occurrences = useMemo(() => result.events.slice(0, index + 1).reduce<Record<number, number>>((acc, item) => {
    acc[item.line] = (acc[item.line] || 0) + 1; return acc
  }, {}), [result.events, index])
  if (!result.structure.nodes.length) return <EmptyCanvas label="Run the program to build its execution flow." />
  return <div className="flow-map">
    <div className="flow-start"><span>START</span></div>
    {result.structure.nodes.map((node, i) => {
      const active = node.line === activeLine
      const visited = executed.has(node.line)
      return <div className="flow-row" key={node.id} style={{ marginLeft: Math.min(node.indent * 28, 100) }}>
        <div className={`flow-node ${node.kind} ${active ? 'active' : ''} ${visited ? 'visited' : 'unvisited'}`}>
          <div className="node-index">{String(i + 1).padStart(2, '0')}</div>
          <div className="node-main">
            <div className="node-meta"><span>{node.kind}</span><b>L{node.line}</b>{(occurrences[node.line] || 0) > 1 && <em>{occurrences[node.line]} visits</em>}</div>
            <code>{node.label}</code>
          </div>
          {active && <div className="active-pulse"><CircleDot size={16}/><span>Now</span></div>}
        </div>
        {i < result.structure.nodes.length - 1 && <div className={`flow-connector ${visited ? 'traversed' : ''}`}><ChevronRight size={16}/></div>}
      </div>
    })}
    <div className="flow-end"><span>{result.status === 'completed' ? 'COMPLETE' : 'END'}</span></div>
  </div>
}

function MemoryView({ event, previous }: { event?: TraceEvent; previous?: TraceEvent }) {
  if (!event) return <EmptyCanvas label="Run the program to reveal variables and objects." />
  const changes = deriveChanges(previous, event)
  const changed = new Set(changes.map(item => item.name))
  const heap = event.snapshot.heap
  return <div className="memory-board">
    <div className="memory-column">
      <div className="canvas-section-title"><span>NAMES</span><b>{event.snapshot.variables.length}</b></div>
      {event.snapshot.variables.map(variable => <div className={`variable-card ${changed.has(variable.name) ? 'changed' : ''}`} key={`${variable.scope}-${variable.name}`}>
        <div><small>{variable.scope}</small><strong>{variable.name}</strong></div>
        {variable.objectId ? <span className="reference-tag">ref <ChevronRight size={13}/></span> : <code>{variable.value}</code>}
      </div>)}
    </div>
    <div className="reference-lane"><div className="data-particle"/><span>references</span></div>
    <div className="memory-column objects">
      <div className="canvas-section-title"><span>OBJECT HEAP</span><b>{heap.length}</b></div>
      {heap.length === 0 && <div className="muted-card">Primitive values are displayed directly beside their names.</div>}
      {heap.map(object => {
        const names = event.snapshot.variables.filter(v => v.objectId === object.id).map(v => v.name)
        return <div className="object-card" key={object.id}>
          <div className="object-head"><span>{object.type}</span><small>{object.id}</small></div>
          {names.length > 0 && <div className="object-aliases">Referenced by {names.join(' · ')}</div>}
          {object.items.length > 0 ? <div className="object-items">{object.items.slice(0, 8).map((item, idx) => <div key={idx}><b>{item.key}</b><code>{item.value}</code>{item.ref && <span>↗ {item.ref}</span>}</div>)}</div> : <code className="object-preview">{object.preview}</code>}
          {object.truncated && <small>Preview truncated for performance</small>}
        </div>
      })}
    </div>
  </div>
}

function StackView({ event }: { event?: TraceEvent }) {
  if (!event) return <EmptyCanvas label="Function frames will appear here during execution." />
  return <div className="stack-stage">
    <div className="stack-label">ACTIVE CALL STACK <span>top</span></div>
    {[...event.stack].reverse().map((frame, index) => {
      const locals = event.snapshot.variables.filter(v => v.scope === 'local')
      return <div className={`stack-frame ${index === 0 ? 'top' : ''}`} key={`${frame.function}-${index}`}>
        <div className="frame-rail"><span>{event.stack.length - index}</span></div>
        <div className="frame-content">
          <div><small>FRAME</small><h3>{frame.function === '<module>' ? 'Global module' : frame.function + '()'}</h3></div>
          <div className="frame-line">line {frame.line}</div>
          {index === 0 && <div className="frame-locals">{locals.slice(0, 6).map(v => <span key={v.name}><b>{v.name}</b> {v.value}</span>)}</div>}
        </div>
      </div>
    })}
    <div className="stack-base">STACK BASE</div>
  </div>
}

function JourneyView({ result, index }: { result: TraceResult; index: number }) {
  const meaningful = result.events.slice(0, index + 1).filter((event, i, list) => {
    const prev = list[i - 1]
    return event.type !== 'line' || deriveChanges(prev, event).length > 0
  }).slice(-9)
  if (!meaningful.length) return <EmptyCanvas label="Changed values, calls, input, and output will form a journey here." />
  return <div className="journey-track">
    {meaningful.map((item, i) => {
      const prevIndex = result.events.indexOf(item) - 1
      const changes = deriveChanges(result.events[prevIndex], item)
      const label = item.type === 'output' ? `Output ${item.text?.trim() || ''}` : item.type === 'input' ? `Input “${item.inputValue}”` : item.type === 'call' ? `Call ${item.function}()` : item.type === 'return' ? `Return ${item.returnValue}` : changes.map(c => `${c.name} = ${c.after?.value}`).join(', ') || item.source
      return <div className={`journey-stop ${i === meaningful.length - 1 ? 'active' : ''}`} key={item.id}>
        <div className="journey-dot">{i === 0 ? <CircleDot size={15}/> : <ChevronRight size={15}/>}</div>
        <div><small>EVENT {item.id + 1} · LINE {item.line}</small><strong>{label}</strong><span>{item.type}</span></div>
      </div>
    })}
  </div>
}

function LoopView({ result, index, event }: { result: TraceResult; index: number; event?: TraceEvent }) {
  const loops = result.structure.nodes.filter(node => node.kind === 'loop')
  if (!loops.length) return <EmptyCanvas label="This program has no for or while loop to focus on." />
  const selected = [...loops].reverse().find(node => node.line <= (event?.line || 0)) || loops[0]
  const visits = result.events.slice(0, index + 1).filter(e => e.line === selected.line)
  const latestVariables = event?.snapshot.variables ?? []
  return <div className="loop-stage">
    <div className="loop-orbit"><div className="orbit-count">{visits.length}<span>checks</span></div><RefreshCw size={72}/></div>
    <div className="loop-detail">
      <small>ACTIVE LOOP · LINE {selected.line}</small><h3>{selected.label}</h3>
      <div className="iteration-strip">{visits.map((visit, i) => <span className={visit.id === event?.id ? 'current' : ''} key={visit.id}>{i + 1}</span>)}</div>
      <div className="loop-vars">{latestVariables.slice(0, 8).map(v => <div key={v.name}><span>{v.name}</span><code>{v.value}</code></div>)}</div>
    </div>
  </div>
}

function RecursionView({ result, index }: { result: TraceResult; index: number }) {
  const calls = result.events.slice(0, index + 1).filter(e => e.type === 'call' && e.function !== '<module>')
  if (!calls.length) return <EmptyCanvas label="Recursive function calls will grow into a tree here." />
  const counts = calls.reduce<Record<string, number>>((acc, event) => { acc[event.function] = (acc[event.function] || 0) + 1; return acc }, {})
  const recursive = Object.keys(counts).find(name => counts[name] > 1)
  if (!recursive) return <EmptyCanvas label="Function calls are present, but no recursive call has occurred yet." />
  const nodes = calls.filter(call => call.function === recursive)
  return <div className="recursion-tree">
    {nodes.map((call, i) => {
      const returned = result.events.slice(call.id + 1, index + 1).find(e => e.type === 'return' && e.function === recursive && e.stack.length === call.stack.length)
      const args = call.snapshot.variables.filter(v => v.scope === 'local').map(v => `${v.name}=${v.value}`).join(', ')
      return <div className={`recursion-node ${i === nodes.length - 1 && !returned ? 'active' : ''}`} style={{ marginLeft: i * 56 }} key={call.id}>
        <GitBranch size={18}/><div><small>DEPTH {i + 1}</small><strong>{recursive}({args})</strong></div><span>{returned ? `↩ ${returned.returnValue}` : 'expanding'}</span>
      </div>
    })}
  </div>
}

function EmptyCanvas({ label }: { label: string }) {
  return <div className="empty-canvas"><div><ZoomIn size={32}/></div><h3>Visual story waiting</h3><p>{label}</p></div>
}

export function VisualCanvas({ result, event, index, mode, onMode }: { result: TraceResult; event?: TraceEvent; index: number; mode: ViewMode; onMode: (mode: ViewMode) => void }) {
  const [zoom, setZoom] = useState(1)
  const previous = index > 0 ? result.events[index - 1] : undefined
  return <section className="panel canvas-panel" aria-label="Execution visualisation">
    <div className="canvas-toolbar">
      <div className="view-tabs" role="tablist">{(Object.keys(modeMeta) as ViewMode[]).map(key => {
        const Icon = modeMeta[key].icon
        return <button role="tab" aria-selected={mode === key} className={mode === key ? 'selected' : ''} onClick={() => onMode(key)} key={key}><Icon size={15}/><span>{modeMeta[key].label}</span></button>
      })}</div>
      <div className="zoom-tools">
        <button onClick={() => setZoom(z => Math.max(.7, z - .1))} title="Zoom out"><Minus size={15}/></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(1.5, z + .1))} title="Zoom in"><Plus size={15}/></button>
        <button onClick={() => setZoom(1)} title="Fit canvas"><Maximize2 size={15}/></button>
      </div>
    </div>
    <div className="canvas-viewport">
      <div className="canvas-grid"/>
      <div className="canvas-content" style={{ transform: `scale(${zoom})` }}>
        {mode === 'flow' && <FlowView result={result} event={event} index={index}/>} 
        {mode === 'memory' && <MemoryView event={event} previous={previous}/>} 
        {mode === 'stack' && <StackView event={event}/>} 
        {mode === 'journey' && <JourneyView result={result} index={index}/>} 
        {mode === 'loop' && <LoopView result={result} index={index} event={event}/>} 
        {mode === 'recursion' && <RecursionView result={result} index={index}/>} 
      </div>
    </div>
    <div className="canvas-status"><span className={`status-dot ${result.status}`}/><b>{event ? `Event ${event.id + 1}` : 'Ready'}</b><span>{event ? `${event.type} in ${event.function}` : 'Run code to create a trace'}</span>{event?.type === 'return' && <span><CornerDownLeft size={13}/> {event.returnValue}</span>}</div>
  </section>
}
