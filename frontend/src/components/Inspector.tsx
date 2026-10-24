import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Box, Braces, ChevronDown, ChevronRight, Info, Sparkles } from '../icons'
import type { TraceEvent, TraceResult } from '../types'
import { deriveChanges } from '../lib/trace'
import { tutorRequestFields, type TutorConfig } from '../lib/tutorConfig'

type Tab = 'state' | 'stack' | 'explain'

export function Inspector({ event, previous, explanationMode, onExplanationMode, code, error, tutorConfig }: { event?: TraceEvent; previous?: TraceEvent; explanationMode: 'beginner' | 'technical'; onExplanationMode: (mode: 'beginner' | 'technical') => void; code?: string; error?: TraceResult['error']; tutorConfig?: TutorConfig }) {
  const [tab, setTab] = useState<Tab>('state')
  const [openObjects, setOpenObjects] = useState<Set<string>>(new Set())
  const changes = deriveChanges(previous, event)
  // When a run fails without producing any step (e.g. a syntax error or a blocked
  // program), there is no event, but the learner still needs the tutor. Surface an
  // error-focused Explain view and jump to it automatically.
  const errorOnly = !event && !!error
  useEffect(() => {
    if (errorOnly) setTab('explain')
  }, [errorOnly, error?.type, error?.message])

  return <section className="panel inspector-panel" aria-label="Runtime inspector">
    <div className="inspector-tabs">{(['state', 'stack', 'explain'] as Tab[]).map(key => <button className={tab === key ? 'selected' : ''} onClick={() => setTab(key)} key={key}>{key === 'state' ? 'State' : key === 'stack' ? 'Stack' : 'Explain'}</button>)}</div>
    {errorOnly ? <div className="inspector-body">
      <div className="event-card">
        <div className="event-title"><span className="event-glyph exception"><AlertTriangle size={15}/></span><div><small>PROGRAM DID NOT RUN{error!.line ? ` · LINE ${error!.line}` : ''}</small><strong>{error!.type}</strong></div></div>
        <code>{error!.message}</code>
      </div>
      {error!.hint && <div className="exception-card"><AlertTriangle size={18}/><div><strong>Likely cause</strong><p className="exception-hint">💡 {error!.hint}</p></div></div>}
      <TutorPanel code={code} error={error} mode={explanationMode} tutorConfig={tutorConfig}/>
    </div> : !event ? <div className="inspector-empty"><Sparkles size={22}/><p>Runtime details will appear here as you step through the trace.</p></div> : <div className="inspector-body">
      {tab === 'state' && <>
        <div className="event-card">
          <div className="event-title"><span className={`event-glyph ${event.type}`}>{event.type === 'exception' ? <AlertTriangle size={15}/> : <Info size={15}/>}</span><div><small>CURRENT EVENT · LINE {event.line}</small><strong>{event.type.toUpperCase()}</strong></div></div>
          <code>{event.source || event.type}</code>
        </div>
        {changes.length > 0 && <InspectorSection title="Changed this step" count={changes.length} accent>
          {changes.map(change => <div className="change-row" key={`${change.kind}-${change.name}`}><span>{change.name}</span><div>{change.before && <code>{change.before.value}</code>}<ArrowRight size={13}/>{change.after && <code>{change.after.value}</code>}</div><small>{change.kind}</small></div>)}
        </InspectorSection>}
        <InspectorSection title="Names & values" count={event.snapshot.variables.length}>
          {event.snapshot.variables.length === 0 && <p className="empty-copy">No user variables in this frame yet.</p>}
          {event.snapshot.variables.map(v => <div className="variable-row" key={`${v.scope}-${v.name}`}><div><span className={`scope-badge ${v.scope}`}>{v.scope[0].toUpperCase()}</span><strong>{v.name}</strong></div><code title={v.value}>{v.value}</code><small>{v.type}</small></div>)}
        </InspectorSection>
        {event.snapshot.heap.length > 0 && <InspectorSection title="Objects" count={event.snapshot.heap.length}>
          {event.snapshot.heap.map(object => {
            const open = openObjects.has(object.id)
            return <div className="heap-row" key={object.id}><button onClick={() => setOpenObjects(current => { const next = new Set(current); open ? next.delete(object.id) : next.add(object.id); return next })}>{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<Box size={14}/><span>{object.id}</span><b>{object.type}</b></button>{open && <div className="heap-detail">{object.items.map((item, i) => <div key={i}><span>{item.key}</span><code>{item.value}</code></div>)}</div>}</div>
          })}
        </InspectorSection>}
      </>}
      {tab === 'stack' && <InspectorSection title="Active frames" count={event.stack.length}>
        {[...event.stack].reverse().map((frame, index) => <div className={`stack-row ${index === 0 ? 'active' : ''}`} key={`${frame.function}-${index}`}><Braces size={16}/><div><strong>{frame.function}</strong><small>line {frame.line}</small></div><span>{index === 0 ? 'active' : 'waiting'}</span></div>)}
        {event.returnValue && <div className="return-card"><CornerIcon/><div><small>RETURN VALUE</small><code>{event.returnValue}</code></div></div>}
      </InspectorSection>}
      {tab === 'explain' && <>
        <div className="mode-switch"><button className={explanationMode === 'beginner' ? 'selected' : ''} onClick={() => onExplanationMode('beginner')}>Beginner</button><button className={explanationMode === 'technical' ? 'selected' : ''} onClick={() => onExplanationMode('technical')}>Technical</button></div>
        <div className="explanation-card"><div><Sparkles size={17}/><span>{explanationMode === 'beginner' ? 'PLAIN LANGUAGE' : 'PYTHON RUNTIME'}</span></div><p>{explanationMode === 'beginner' ? event.beginner : event.technical}</p></div>
        <InspectorSection title="Why it matters"><p className="why-copy">{whyItMatters(event)}</p></InspectorSection>
        {event.exception && <div className="exception-card"><AlertTriangle size={18}/><div><strong>{event.exception.type}</strong><p>{event.exception.message}</p>{event.exception.hint && <p className="exception-hint">💡 {event.exception.hint}</p>}</div></div>}
        <TutorPanel event={event} code={code} error={error} mode={explanationMode} tutorConfig={tutorConfig}/>
      </>}
    </div>}
  </section>
}

function TutorPanel({ event, code, error, mode, tutorConfig }: { event?: TraceEvent; code?: string; error?: TraceResult['error']; mode: 'beginner' | 'technical'; tutorConfig?: TutorConfig }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const hasError = !!(error || event?.exception)

  const ask = async (prompt?: string) => {
    const q = (prompt ?? question).trim()
    setLoading(true); setAnswer('')
    try {
      const response = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code ?? '',
          question: q,
          mode,
          event: event ? {
            line: event.line, type: event.type, source: event.source, function: event.function,
            variables: event.snapshot.variables.map(v => ({ name: v.name, value: v.value })),
            output: event.output ?? '',
            error: error ?? event.exception ?? null,
          } : {
            line: error?.line ?? 0, type: 'error', source: '', function: '',
            variables: [], output: '', error: error ?? null,
          },
          ...(tutorConfig ? tutorRequestFields(tutorConfig) : {}),
        }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'The tutor is unavailable right now.')
      const data = await response.json()
      setConfigured(data.enabled !== false)
      setAnswer(data.answer || 'No answer was returned.')
    } catch (err) {
      setConfigured(true)
      setAnswer(err instanceof Error ? err.message : 'The tutor is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="tutor-panel">
    <div className="tutor-head"><Sparkles size={15}/><span>ASK THE AI TUTOR</span></div>
    <div className="tutor-quick">
      {hasError && <button disabled={loading} onClick={() => ask('What caused this error and what is the smallest fix? Point to the exact line.')}>Diagnose the error</button>}
      {hasError && <button disabled={loading} onClick={() => ask('Show me the corrected version of the problem line and explain the fix in one sentence.')}>How do I fix it?</button>}
      {event && <button disabled={loading} onClick={() => ask('Explain this step in simple terms.')}>Explain this step</button>}
      {event && <button disabled={loading} onClick={() => ask('Why did this value change, and what does it mean?')}>Why did this change?</button>}
    </div>
    <div className="tutor-ask">
      <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} placeholder="Ask about this line, value, or error…" disabled={loading}/>
      <button onClick={() => ask()} disabled={loading || !code}>{loading ? '…' : 'Ask'}</button>
    </div>
    {loading && <p className="tutor-answer loading">Thinking…</p>}
    {!loading && answer && <div className={`tutor-answer ${configured === false ? 'offline' : ''}`}>{answer}</div>}
    {!loading && !answer && <p className="tutor-hint">Uses an LLM if the server has one configured; otherwise the built-in offline explanations above apply.</p>}
  </div>
}

function InspectorSection({ title, count, accent, children }: { title: string; count?: number; accent?: boolean; children: React.ReactNode }) {
  return <div className={`inspector-section ${accent ? 'accent' : ''}`}><div className="section-heading"><span>{title}</span>{count !== undefined && <b>{count}</b>}</div>{children}</div>
}
function CornerIcon() { return <ArrowRight size={17}/> }
function whyItMatters(event: TraceEvent) {
  if (event.type === 'call') return 'Each function call gets its own frame, so local names can change without overwriting the caller’s local workspace.'
  if (event.type === 'return') return 'A return value reconnects the result of an isolated function calculation to the expression that called it.'
  if (event.type === 'exception') return 'Exceptions interrupt the normal path and travel through active frames until Python finds a matching handler.'
  if (event.type === 'output') return 'Output is a side effect: it leaves the expression flow and becomes visible to the user.'
  return 'Tracking state before each instruction makes reassignment, mutation, branch selection, and repeated loop work visible.'
}
