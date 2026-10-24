import { Gauge, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from '../icons'
import type { TraceEvent } from '../types'
import { eventTone } from '../lib/trace'

type Props = {
  events: TraceEvent[]; index: number; playing: boolean; speed: number; breakpoint: number | null
  onIndex: (index: number) => void; onPlay: () => void; onStop: () => void; onRestart: () => void
  onSpeed: (speed: number) => void; onBreakpoint: (line: number | null) => void
}

export function Timeline({ events, index, playing, speed, breakpoint, onIndex, onPlay, onStop, onRestart, onSpeed, onBreakpoint }: Props) {
  const event = events[index]
  return <section className="timeline-panel" aria-label="Execution controls">
    <div className="transport">
      <button onClick={onRestart} disabled={!events.length} title="Restart"><RotateCcw size={16}/></button>
      <button onClick={() => onIndex(Math.max(0, index - 1))} disabled={index <= 0} title="Previous event"><SkipBack size={17}/></button>
      <button className="play-button" onClick={onPlay} disabled={!events.length} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={19}/> : <Play size={19} fill="currentColor"/>}</button>
      <button onClick={() => onIndex(Math.min(events.length - 1, index + 1))} disabled={!events.length || index >= events.length - 1} title="Next event"><SkipForward size={17}/></button>
      <button onClick={onStop} disabled={!events.length} title="Stop playback"><Square size={14}/></button>
    </div>
    <div className="timeline-main">
      <div className="timeline-summary"><b>{events.length ? index + 1 : 0}</b><span>/ {events.length} events</span>{event && <><i>•</i><strong>Line {event.line}</strong><small>{event.type}</small></>}</div>
      <div className="event-rail">
        <div className="rail-progress" style={{ width: events.length > 1 ? `${(index / (events.length - 1)) * 100}%` : '0%' }}/>
        {events.map((item, i) => <button key={item.id} onClick={() => onIndex(i)} title={`Event ${i + 1}: ${item.type}, line ${item.line}`} className={`${eventTone(item.type)} ${i === index ? 'active' : ''} ${i <= index ? 'past' : ''}`} style={{ left: `${events.length > 1 ? (i / (events.length - 1)) * 100 : 0}%` }} aria-label={`Jump to event ${i + 1}`}/>) }
      </div>
    </div>
    <div className="timeline-options">
      <label className="breakpoint-control" title="Pause playback when this line is reached">BP <input value={breakpoint ?? ''} onChange={e => onBreakpoint(e.target.value ? Number(e.target.value) : null)} placeholder="line" inputMode="numeric"/></label>
      <label className="speed-control"><Gauge size={15}/><select value={speed} onChange={e => onSpeed(Number(e.target.value))}><option value={1400}>0.5×</option><option value={850}>1×</option><option value={450}>2×</option><option value={220}>4×</option></select></label>
    </div>
  </section>
}
