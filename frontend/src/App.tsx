import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, ChevronRight, Code2, Keyboard, Moon, Play, Search, Settings2, ShieldCheck, Sparkles, Sun, X, Zap } from './icons'
import { CodePane } from './components/CodePane'
import { VisualCanvas } from './components/VisualCanvas'
import { Inspector } from './components/Inspector'
import { Timeline } from './components/Timeline'
import { examples, type Example } from './data/examples'
import type { TraceResult, ViewMode } from './types'
import { loadTutorConfig, saveTutorConfig, tutorRequestFields, PROVIDER_META, type TutorConfig, type TutorProvider } from './lib/tutorConfig'
import './styles.css'

const EMPTY_RESULT: TraceResult = { status: 'completed', events: [], structure: { nodes: [], edges: [] }, output: '', error: null, needsInput: null }
const DEFAULT_EXAMPLE = examples.find(example => example.id === 'loop')!

function App() {
  const [code, setCode] = useState(DEFAULT_EXAMPLE.code)
  const [baseline, setBaseline] = useState(DEFAULT_EXAMPLE.code)
  const [result, setResult] = useState<TraceResult>(EMPTY_RESULT)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(850)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<ViewMode>('flow')
  const [explanationMode, setExplanationMode] = useState<'beginner' | 'technical'>('beginner')
  const [showExamples, setShowExamples] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [inputs, setInputs] = useState<string[]>([])
  const [pendingInput, setPendingInput] = useState('')
  const [breakpoint, setBreakpoint] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<'code' | 'visual' | 'state'>('visual')
  const [tutorConfig, setTutorConfig] = useState<TutorConfig>(loadTutorConfig)
  const stale = result.events.length > 0 && code !== baseline
  const event = result.events[index]
  const previous = index > 0 ? result.events[index - 1] : undefined

  const execute = useCallback(async (runInputs = inputs) => {
    setLoading(true); setPlaying(false)
    try {
      const response = await fetch('/api/trace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, inputs: runInputs }) })
      if (!response.ok) throw new Error((await response.json()).detail || 'The trace service did not respond.')
      const next: TraceResult = await response.json()
      setResult(next); setBaseline(code); setIndex(0)
      if (next.events.length) setPlaying(next.status !== 'needs_input')
    } catch (error) {
      setResult({ ...EMPTY_RESULT, status: 'error', error: { type: 'ConnectionError', message: error instanceof Error ? error.message : 'Could not reach the execution service.' } })
    } finally { setLoading(false) }
  }, [code, inputs])

  useEffect(() => {
    if (!playing || result.events.length === 0) return
    if (index >= result.events.length - 1) { setPlaying(false); return }
    const timer = window.setTimeout(() => {
      const next = index + 1
      setIndex(next)
      if (breakpoint && result.events[next]?.line === breakpoint) setPlaying(false)
    }, speed)
    return () => window.clearTimeout(timer)
  }, [playing, index, result.events, speed, breakpoint])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void execute() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setShowExamples(true) }
      if (event.key === 'Escape') { setShowExamples(false); setShowSettings(false) }
      if (event.key === 'ArrowRight' && event.altKey && result.events.length) setIndex(i => Math.min(result.events.length - 1, i + 1))
      if (event.key === 'ArrowLeft' && event.altKey && result.events.length) setIndex(i => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [execute, result.events.length])

  const loadExample = (example: Example) => {
    setCode(example.code); setBaseline(example.code); setResult(EMPTY_RESULT); setInputs([]); setIndex(0)
    setMode(example.recommended as ViewMode); setShowExamples(false); setMobileTab('code')
  }
  const reset = () => { setCode(baseline); setResult(EMPTY_RESULT); setIndex(0); setInputs([]) }
  const submitInput = () => {
    const nextInputs = [...inputs, pendingInput]
    setInputs(nextInputs); setPendingInput(''); void execute(nextInputs)
  }
  const outputToEvent = useMemo(() => event?.output ?? '', [event])

  return <div className={`app ${theme}`}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Code2 size={20}/><span/></div><div><strong>MIMO</strong><span>PYTHON VISUAL PLAYGROUND</span></div></div>
      <div className="tagline"><Sparkles size={14}/><span>See how Python thinks.</span></div>
      <div className="top-actions">
        <div className="safety-pill"><ShieldCheck size={14}/><span>Restricted execution</span></div>
        <button className="header-button" title="Keyboard shortcuts"><Keyboard size={16}/></button>
        <button className="header-button" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme">{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button>
        <button className={`header-button tutor-pill-btn ${tutorConfig.apiKey ? 'configured' : ''}`} onClick={() => setShowSettings(true)} title="AI Tutor & API Key Settings">
          <Sparkles size={14}/><span>{tutorConfig.apiKey ? `${tutorConfig.provider.toUpperCase()} Key` : 'AI Tutor Key'}</span>
        </button>
        <button className="header-button" onClick={() => setShowSettings(true)} title="Settings"><Settings2 size={16}/></button>
        <button className="run-button" onClick={() => void execute()} disabled={loading || !code.trim()}>{loading ? <span className="spinner"/> : <Play size={16} fill="currentColor"/>}<span>{loading ? 'Tracing…' : 'Run & visualise'}</span><kbd>⌘↵</kbd></button>
      </div>
    </header>

    <nav className="mobile-tabs"><button className={mobileTab === 'code' ? 'active' : ''} onClick={() => setMobileTab('code')}>Code</button><button className={mobileTab === 'visual' ? 'active' : ''} onClick={() => setMobileTab('visual')}>Visualise</button><button className={mobileTab === 'state' ? 'active' : ''} onClick={() => setMobileTab('state')}>State</button></nav>

    <main className="workspace">
      <div className={`workspace-pane left-pane ${mobileTab === 'code' ? 'mobile-active' : ''}`}>
        <CodePane code={code} onChange={setCode} currentLine={!stale ? event?.line : undefined} errorLine={result.error?.line} onExamples={() => setShowExamples(true)} onReset={reset}/>
        <section className="console-panel panel">
          <div className="console-head"><div><span className="console-dot red"/><span className="console-dot amber"/><span className="console-dot green"/><strong>OUTPUT</strong></div><span>{outputToEvent.length} chars</span></div>
          <pre>{outputToEvent || <span className="console-placeholder">Program output will appear here…</span>}</pre>
        </section>
      </div>
      <div className={`workspace-pane center-pane ${mobileTab === 'visual' ? 'mobile-active' : ''}`}>
        {stale && <div className="stale-banner"><AlertCircle size={16}/><span>Your code changed. Run it again to create an updated visualisation.</span><button onClick={() => void execute()}>Run now <ChevronRight size={14}/></button></div>}
        {result.error && <div className={`error-banner ${result.status}`}><AlertCircle size={17}/><div><strong>{result.error.type}</strong><span>{result.error.message}</span>{result.error.hint && <em className="error-hint">💡 {result.error.hint}</em>}</div>{result.error.line && <b>Line {result.error.line}</b>}</div>}
        <VisualCanvas result={stale ? EMPTY_RESULT : result} event={stale ? undefined : event} index={index} mode={mode} onMode={setMode}/>
      </div>
      <div className={`workspace-pane right-pane ${mobileTab === 'state' ? 'mobile-active' : ''}`}>
        <Inspector event={stale ? undefined : event} previous={stale ? undefined : previous} explanationMode={explanationMode} onExplanationMode={setExplanationMode} code={code} error={result.error} tutorConfig={tutorConfig} onOpenSettings={() => setShowSettings(true)}/>
      </div>
    </main>

    <Timeline events={stale ? [] : result.events} index={index} playing={playing} speed={speed} breakpoint={breakpoint} onIndex={setIndex} onPlay={() => setPlaying(p => !p)} onStop={() => setPlaying(false)} onRestart={() => { setIndex(0); setPlaying(false) }} onSpeed={setSpeed} onBreakpoint={setBreakpoint}/>

    {showExamples && <ExampleLibrary onClose={() => setShowExamples(false)} onSelect={loadExample}/>} 
    {showSettings && <SettingsModal onClose={() => setShowSettings(false)} mode={explanationMode} onMode={setExplanationMode} speed={speed} onSpeed={setSpeed} tutorConfig={tutorConfig} onTutorConfig={next => { setTutorConfig(next); saveTutorConfig(next) }}/>} 
    {result.needsInput && <div className="modal-backdrop input-backdrop"><div className="input-modal"><div className="input-icon"><Zap size={22}/></div><span>PROGRAM PAUSED</span><h2>Python is waiting for input</h2><p>{result.needsInput.prompt || 'Enter a value to continue.'}</p><input autoFocus value={pendingInput} onChange={event => setPendingInput(event.target.value)} onKeyDown={event => event.key === 'Enter' && submitInput()} placeholder="Type a value…"/><div><button className="secondary" onClick={() => setResult(r => ({...r, needsInput: null, status: 'stopped'}))}>Stop</button><button className="primary" onClick={submitInput}>Send to Python <ChevronRight size={15}/></button></div><small>input() always returns text. Convert it with int() or float() when needed.</small></div></div>}
  </div>
}

function ExampleLibrary({ onClose, onSelect }: { onClose: () => void; onSelect: (example: Example) => void }) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<string>('All')
  const filtered = examples.filter(example => (level === 'All' || example.level === level) && `${example.title} ${example.concept}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="drawer-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside className="example-drawer">
    <div className="drawer-head"><div><span>LEARNING LIBRARY</span><h2>Start with a story</h2><p>Each example is ready to run and recommends the view that explains it best.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="library-tools"><label><Search size={16}/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search concepts…"/></label><div>{['All', 'Beginner', 'Intermediate', 'AI Foundation'].map(item => <button className={level === item ? 'active' : ''} onClick={() => setLevel(item)} key={item}>{item}</button>)}</div></div>
    <div className="example-grid">{filtered.map(example => <button className="example-card" onClick={() => onSelect(example)} key={example.id}><div><span className={`level ${example.level.replace(' ', '-').toLowerCase()}`}>{example.level}</span><small>{example.concept}</small></div><h3>{example.title}</h3><p>{example.objective}</p><div><code>{example.expected}</code><span>Open <ChevronRight size={14}/></span></div></button>)}</div>
  </aside></div>
}

function SettingsModal({ onClose, mode, onMode, speed, onSpeed, tutorConfig, onTutorConfig }: { onClose: () => void; mode: 'beginner' | 'technical'; onMode: (m: 'beginner' | 'technical') => void; speed: number; onSpeed: (n: number) => void; tutorConfig: TutorConfig; onTutorConfig: (c: TutorConfig) => void }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="settings-modal"><div className="settings-head"><div><span>PLAYGROUND SETTINGS</span><h2>Shape your learning view</h2></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="setting-row"><div><strong>Explanation language</strong><p>Switch without losing your current execution position.</p></div><div className="segmented"><button className={mode === 'beginner' ? 'active' : ''} onClick={() => onMode('beginner')}>Beginner</button><button className={mode === 'technical' ? 'active' : ''} onClick={() => onMode('technical')}>Technical</button></div></div>
    <div className="setting-row"><div><strong>Playback speed</strong><p>Animations remain interruptible at every speed.</p></div><select value={speed} onChange={e => onSpeed(Number(e.target.value))}><option value={1400}>Calm · 0.5×</option><option value={850}>Normal · 1×</option><option value={450}>Quick · 2×</option><option value={220}>Scan · 4×</option></select></div>
    <TutorSettings config={tutorConfig} onChange={onTutorConfig}/>
    <div className="limits-note"><ShieldCheck size={18}/><div><strong>Execution guardrails</strong><p>3 seconds CPU · 2,500 events · 64 KB output · restricted imports and host access</p></div></div>
    <button className="primary full" onClick={onClose}>Save preferences</button>
  </div></div>
}

function TutorSettings({ config, onChange }: { config: TutorConfig; onChange: (c: TutorConfig) => void }) {
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const providers: TutorProvider[] = ['server', 'openai', 'anthropic', 'openrouter', 'nvidia', 'custom']
  const meta = config.provider !== 'server' ? PROVIDER_META[config.provider] : undefined

  const update = (patch: Partial<TutorConfig>) => { setTestResult(null); onChange({ ...config, ...patch }) }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const response = await fetch('/api/tutor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'print("hello")', question: 'Reply with the single word: ready.', mode: 'beginner', ...tutorRequestFields(config) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Request failed.')
      if (data.enabled === false) setTestResult({ ok: false, text: 'No key configured — the tutor is in offline mode.' })
      else setTestResult({ ok: true, text: `Connected to ${data.provider || 'server'} (${data.model || 'default model'}).` })
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : 'Connection failed.' })
    } finally { setTesting(false) }
  }

  return <div className="tutor-settings">
    <div className="setting-row no-border"><div><strong>AI tutor</strong><p>Bring your own API key. It is stored only in this browser and sent directly with each question — never saved on the server.</p></div></div>
    <div className="tutor-config-grid">
      <label className="tcfg">
        <span>Provider</span>
        <select value={config.provider} onChange={e => update({ provider: e.target.value as TutorProvider })}>
          <option value="server">Server default (offline if none)</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="nvidia">NVIDIA NIM</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
      </label>
      {config.provider === 'server' && (
        <div className="server-provider-callout">
          <p>Currently using <b>Server Default</b> (or offline). To enter your own API key, choose a provider:</p>
          <div className="provider-chips">
            <button type="button" className="provider-chip" onClick={() => update({ provider: 'openai' })}>+ OpenAI</button>
            <button type="button" className="provider-chip" onClick={() => update({ provider: 'anthropic' })}>+ Anthropic (Claude)</button>
            <button type="button" className="provider-chip" onClick={() => update({ provider: 'openrouter' })}>+ OpenRouter</button>
            <button type="button" className="provider-chip" onClick={() => update({ provider: 'nvidia' })}>+ NVIDIA NIM</button>
            <button type="button" className="provider-chip" onClick={() => update({ provider: 'custom' })}>+ Custom Endpoint</button>
          </div>
        </div>
      )}
      {config.provider !== 'server' && <>
        <label className="tcfg">
          <span>API key {meta?.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer">{meta.keyUrlLabel} ↗</a>}</span>
          <div className="key-input">
            <input type={showKey ? 'text' : 'password'} value={config.apiKey} onChange={e => update({ apiKey: e.target.value })} placeholder={meta?.keyPlaceholder} autoComplete="off" spellCheck={false}/>
            <button type="button" onClick={() => setShowKey(s => !s)}>{showKey ? 'Hide' : 'Show'}</button>
          </div>
        </label>
        <label className="tcfg">
          <span>Model</span>
          <input value={config.model} onChange={e => update({ model: e.target.value })} placeholder={meta?.modelPlaceholder} autoComplete="off" spellCheck={false}/>
        </label>
        {config.provider === 'custom' && <label className="tcfg">
          <span>Base URL</span>
          <input value={config.baseUrl} onChange={e => update({ baseUrl: e.target.value })} placeholder="https://host/v1" autoComplete="off" spellCheck={false}/>
        </label>}
      </>}
    </div>
    <div className="tutor-config-actions">
      <button className="secondary" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button>
      {testResult && <span className={`test-result ${testResult.ok ? 'ok' : 'bad'}`}>{testResult.ok ? '✓' : '✕'} {testResult.text}</span>}
    </div>
    <p className="tutor-links">New to this? Free options: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter ↗</a> · <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noopener noreferrer">NVIDIA NIM ↗</a></p>
  </div>
}

export default App
