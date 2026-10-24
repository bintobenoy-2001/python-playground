import { useMemo, useRef, useState } from 'react'
import { Copy, Eraser, RotateCcw, Sparkles } from '../icons'

type Props = {
  code: string; onChange: (code: string) => void; currentLine?: number; errorLine?: number
  onExamples: () => void; onReset: () => void
}

const TOKEN = /(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|return|if|elif|else|for|while|in|break|continue|class|try|except|raise|import|from|as|True|False|None|and|or|not|is|lambda|with|yield)\b|\b\d+(?:\.\d+)?\b|\b(?:print|input|len|range|int|float|str|list|dict|set|tuple|sum|min|max|zip|enumerate|round)\b)/g
function highlightedLine(line: string) {
  const parts = line.split(TOKEN)
  return parts.map((part, index) => {
    let kind = ''
    if (part.startsWith('#')) kind = 'comment'
    else if (/^["']/.test(part)) kind = 'string'
    else if (/^\d/.test(part)) kind = 'number'
    else if (/^(print|input|len|range|int|float|str|list|dict|set|tuple|sum|min|max|zip|enumerate|round)$/.test(part)) kind = 'builtin'
    else if (/^(def|return|if|elif|else|for|while|in|break|continue|class|try|except|raise|import|from|as|True|False|None|and|or|not|is|lambda|with|yield)$/.test(part)) kind = 'keyword'
    return kind ? <span className={`tok-${kind}`} key={index}>{part}</span> : part
  })
}

const PY_KEYWORDS = ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'break', 'continue', 'class', 'try', 'except', 'finally', 'raise', 'import', 'from', 'as', 'True', 'False', 'None', 'and', 'or', 'not', 'is', 'lambda', 'with', 'yield', 'pass', 'global', 'assert']
const PY_BUILTINS = ['print', 'input', 'len', 'range', 'int', 'float', 'str', 'list', 'dict', 'set', 'tuple', 'sum', 'min', 'max', 'zip', 'enumerate', 'round', 'abs', 'sorted', 'reversed', 'map', 'filter', 'bool', 'type', 'isinstance', 'any', 'all', 'ord', 'chr', 'format', 'repr']

type Suggestion = { text: string; kind: 'keyword' | 'builtin' | 'name' }

export function CodePane({ code, onChange, currentLine, errorLine, onExamples, onReset }: Props) {
  const [scrollTop, setScrollTop] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestIndex, setSuggestIndex] = useState(0)
  const [suggestAt, setSuggestAt] = useState({ top: 0, left: 0, wordStart: 0 })
  const lines = useMemo(() => code.split('\n'), [code])
  const active = errorLine || currentLine

  // Apply a full-text replacement and restore the caret to an explicit position.
  const applyEdit = (target: HTMLTextAreaElement, next: string, caret: number) => {
    onChange(next)
    requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = caret })
  }

  const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" }
  const OPENERS = new Set([')', ']', '}', '"', "'"])

  const closeSuggestions = () => setSuggestions([])

  // Recompute suggestions from the word being typed just before the caret.
  const refreshSuggestions = (target: HTMLTextAreaElement, text: string) => {
    const caret = target.selectionStart
    const upto = text.slice(0, caret)
    const wordMatch = upto.match(/[A-Za-z_][A-Za-z0-9_]*$/)
    if (!wordMatch || wordMatch[0].length < 2) { closeSuggestions(); return }
    const word = wordMatch[0]
    const wordStart = caret - word.length
    // Names the learner has already defined in their own code.
    const localNames = new Set<string>()
    for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g)) localNames.add(m[1])
    for (const m of text.matchAll(/\bdef\s+([A-Za-z_][A-Za-z0-9_]*)/g)) localNames.add(m[1])
    for (const m of text.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)/g)) localNames.add(m[1])
    const pool: Suggestion[] = [
      ...[...localNames].map(t => ({ text: t, kind: 'name' as const })),
      ...PY_BUILTINS.map(t => ({ text: t, kind: 'builtin' as const })),
      ...PY_KEYWORDS.map(t => ({ text: t, kind: 'keyword' as const })),
    ]
    const lower = word.toLowerCase()
    const seen = new Set<string>()
    const matches = pool.filter(s => {
      if (s.text === word || seen.has(s.text)) return false
      if (!s.text.toLowerCase().startsWith(lower)) return false
      seen.add(s.text); return true
    }).slice(0, 7)
    if (!matches.length) { closeSuggestions(); return }
    // Position the popup under the caret line.
    const before = text.slice(0, caret)
    const row = before.split('\n').length - 1
    const col = caret - (before.lastIndexOf('\n') + 1)
    setSuggestions(matches)
    setSuggestIndex(0)
    setSuggestAt({
      top: 10 + (row + 1) * 18.7 - scrollTop,
      left: 40 + 10 + col * 6.6,
      wordStart,
    })
  }

  const acceptSuggestion = (target: HTMLTextAreaElement, suggestion: Suggestion) => {
    const caret = target.selectionStart
    const next = code.slice(0, suggestAt.wordStart) + suggestion.text + code.slice(caret)
    const newCaret = suggestAt.wordStart + suggestion.text.length
    closeSuggestions()
    applyEdit(target, next, newCaret)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd

    // When the suggestion popup is open, these keys drive it.
    if (suggestions.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSuggestIndex(i => (i + 1) % suggestions.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSuggestIndex(i => (i - 1 + suggestions.length) % suggestions.length); return }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); acceptSuggestion(target, suggestions[suggestIndex]); return }
      if (event.key === 'Escape') { event.preventDefault(); closeSuggestions(); return }
    }
    const selection = code.slice(start, end)
    const lineStart = code.lastIndexOf('\n', start - 1) + 1
    const currentLineText = code.slice(lineStart, start)
    const indentMatch = currentLineText.match(/^[ \t]*/)
    const indent = indentMatch ? indentMatch[0] : ''

    // Enter: keep indentation, and add one level after a block opener (line ending in ':').
    if (event.key === 'Enter') {
      event.preventDefault()
      const trimmed = currentLineText.trimEnd()
      const extra = trimmed.endsWith(':') ? '    ' : ''
      const insert = '\n' + indent + extra
      const next = code.slice(0, start) + insert + code.slice(end)
      applyEdit(target, next, start + insert.length)
      return
    }

    // Tab / Shift+Tab: indent or dedent.
    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) {
        // Dedent: remove up to 4 leading spaces from the current line.
        const removable = code.slice(lineStart).match(/^ {1,4}/)
        if (removable) {
          const count = removable[0].length
          const next = code.slice(0, lineStart) + code.slice(lineStart + count)
          applyEdit(target, next, Math.max(lineStart, start - count))
        }
      } else {
        const next = code.slice(0, start) + '    ' + code.slice(end)
        applyEdit(target, next, start + 4)
      }
      return
    }

    // Auto-close brackets and quotes; wrap a selection if one exists.
    if (CLOSERS[event.key]) {
      event.preventDefault()
      const close = CLOSERS[event.key]
      if (selection) {
        const next = code.slice(0, start) + event.key + selection + close + code.slice(end)
        onChange(next)
        requestAnimationFrame(() => { target.selectionStart = start + 1; target.selectionEnd = start + 1 + selection.length })
      } else {
        const next = code.slice(0, start) + event.key + close + code.slice(end)
        applyEdit(target, next, start + 1)
      }
      return
    }

    // Typing a closer right before the same auto-inserted closer just steps over it.
    if (OPENERS.has(event.key) && code[start] === event.key && start === end) {
      event.preventDefault()
      applyEdit(target, code, start + 1)
      return
    }

    // Backspace at start of indentation removes a whole 4-space level; inside a pair
    // deletes both characters.
    if (event.key === 'Backspace' && start === end && start > 0) {
      const before = code.slice(0, start)
      const pair = code[start - 1] + (code[start] || '')
      if (['()', '[]', '{}', '""', "''"].includes(pair)) {
        event.preventDefault()
        applyEdit(target, code.slice(0, start - 1) + code.slice(start + 1), start - 1)
        return
      }
      const lineHead = before.slice(lineStart)
      if (/^ +$/.test(lineHead) && lineHead.length % 4 === 0) {
        event.preventDefault()
        applyEdit(target, code.slice(0, start - 4) + code.slice(start), start - 4)
        return
      }
    }
  }
  return <section className="panel code-panel" aria-label="Python code editor">
    <div className="panel-head">
      <div><span className="eyebrow">SOURCE</span><h2>Python editor</h2></div>
      <div className="icon-actions">
        <button className="icon-button" onClick={() => navigator.clipboard?.writeText(code)} title="Copy code"><Copy size={15}/></button>
        <button className="icon-button" onClick={() => onChange('')} title="Clear editor"><Eraser size={15}/></button>
        <button className="icon-button" onClick={onReset} title="Reset example"><RotateCcw size={15}/></button>
      </div>
    </div>
    <div className="plain-editor-shell">
      <div className="line-numbers" style={{ transform: `translateY(-${scrollTop}px)` }}>{lines.map((_, index) => <span className={active === index + 1 ? (errorLine ? 'error' : 'active') : ''} key={index}>{index + 1}</span>)}</div>
      <pre className="syntax-layer" aria-hidden="true" style={{ transform: `translateY(-${scrollTop}px)` }}>{lines.map((line, index) => <div className={active === index + 1 ? (errorLine ? 'error' : 'active') : ''} key={index}>{highlightedLine(line)}{'\n'}</div>)}</pre>
      <textarea ref={textarea} value={code} onChange={event => { onChange(event.target.value); refreshSuggestions(event.currentTarget, event.target.value) }} onScroll={event => { setScrollTop(event.currentTarget.scrollTop); closeSuggestions() }} onKeyDown={handleKeyDown} onBlur={() => requestAnimationFrame(closeSuggestions)} spellCheck={false} autoCapitalize="off" aria-label="Python source code"/>
      {suggestions.length > 0 && <ul className="autocomplete" style={{ top: suggestAt.top, left: suggestAt.left }}>
        {suggestions.map((s, i) => <li key={s.text} className={`${s.kind} ${i === suggestIndex ? 'active' : ''}`} onMouseDown={e => { e.preventDefault(); if (textarea.current) acceptSuggestion(textarea.current, s) }}><span>{s.text}</span><small>{s.kind}</small></li>)}
      </ul>}
    </div>
    <button className="example-trigger" onClick={onExamples}><Sparkles size={15}/> Explore example library <span>⌘ K</span></button>
  </section>
}
