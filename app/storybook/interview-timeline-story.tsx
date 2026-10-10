import { useMemo, useState } from 'react';
import { producerLatency, type ProducerLogRecord } from '../../interview-engine/interview/conversation/records';
import { parseTimelineExport, producerTimeline, TIMELINE_LANES, type TimelineLane } from '../../core/interview-timeline';
import type { Passage } from '../../interview-engine/shared/transcript';
import { formatTime } from '../simulator/conversation';
import { transcript } from './interview-stories';
import '../simulator/simulator.css';
import '../interview/interview.css';

const startedAt = Date.UTC(2026, 0, 5, 15);
const at = (seconds: number) => startedAt + seconds * 1000;
/** Synthetic dialogue, grades, two map calls, Jev readings, an unresolved lookup and notes to Sam. */
const records: ProducerLogRecord[] = [
  { source: 'map', id: 'map-1', reasons: ['the participant spoke'], startedAt: at(9.5), completedAt: at(12.6), outcome: 'applied', inputCount: 2, lastInputId: 'u1', model: 'gpt-6.1-sol',
    changes: { added: ['e1', 'e2', 't1', 't2'], changed: [], dropped: [] }, research: null },
  { source: 'traits', id: 'traits-1', mapId: 'map-1', threadIds: ['t1', 't2'], startedAt: at(12.6), completedAt: at(13.5), outcome: 'read', durationMs: 900, traits: { t1: [.35, .9], t2: [.8, .2] } },
  { source: 'note', id: 'note-1', kind: 'list', text: 'Threads to pull\n- Who the field teams were, and how they worked before.\n- Nearby: what the technical lead decided.', mapId: 'map-1',
    sentAt: at(12.7), outcome: 'sent', delivery: { eventId: 'note-1', afterPassageId: 'u1', status: 'accepted' }, nextSamTurnAt: at(14.6), nextSamTurnAfterId: 'u1' },
  { source: 'grade', id: 'grade-1', final: false, revision: 2, capturedAt: at(15), completedAt: at(15.3), inputCount: 2, lastInputId: 'u1', outcome: 'graded', durationMs: 300,
    objectives: [{ id: 'project-delivery', shown: ['explored', 'u1'], graded: ['explored', 'u1'], levels: [.01, .03, .95, .01] }] },
  { source: 'turn', id: 'turn-1', passageId: 'u2', mapId: 'map-1', startedAt: at(29.5), completedAt: at(30.7), outcome: 'read', durationMs: 1200,
    reading: { atMs: 29_500, focus: 't1', novel: .86, natural: { t1: .7, t2: .4 }, states: { t1: 'answered', t2: 'open' } },
    pick: { current: 't1', action: 'tug', lead: 't2', nearby: [], ranked: [['t2', .66, 'elsewhere']] } },
  { source: 'note', id: 'note-2', kind: 'list', text: 'Threads to pull\n- What made the team change course.', mapId: 'map-1', turnId: 'turn-1',
    sentAt: at(30.7), outcome: 'sent', delivery: { eventId: 'note-2', afterPassageId: 'u2', status: 'accepted' }, nextSamTurnAt: at(32), nextSamTurnAfterId: 'u2' },
  { source: 'map', id: 'map-2', reasons: ['the participant’s latest turn (u2) adds something the map lacks'], startedAt: at(31), completedAt: at(35.6), outcome: 'applied',
    inputCount: 4, lastInputId: 'u2', model: 'gpt-6.1-sol', changes: { added: ['e3', 't3'], changed: ['t2'], dropped: [] },
    research: { kind: 'term', name: 'offline use', clue: null } },
  { source: 'research', id: 'research-1', mapId: 'map-2', request: { kind: 'term', name: 'offline use', clue: null }, passageIds: ['u2'], model: 'gpt-6-luna',
    requestedAt: at(35.6), lookupAt: at(50.4), completedAt: at(50.4), loggedAt: at(52), outcome: 'unresolved', reason: 'Too general to identify one public source.' },
  { source: 'grade', id: 'grade-2', final: false, revision: 4, capturedAt: at(31), completedAt: at(31.2), inputCount: 4, lastInputId: 'u2', outcome: 'graded', durationMs: 200,
    objectives: [{ id: 'project-delivery', shown: ['explored', 'u1'], graded: ['touched', 'u2'], levels: [.02, .37, .6, .01] }] },
  { source: 'note', id: 'note-3', kind: 'map', text: 'Conversation map\nThe participant led the technical work on a field-inspection prototype.', mapId: 'map-2',
    sentAt: at(79), outcome: 'sent', delivery: { eventId: 'note-3', afterPassageId: 'u4', status: 'accepted' } },
];

export function InterviewTimelineStory() {
  const [lanes, setLanes] = useState<TimelineLane[]>(TIMELINE_LANES.filter(lane => lane !== 'traits' && lane !== 'grade'));
  const [source, setSource] = useState<{ name: string; startedAt: number; transcript: Passage[]; records: ProducerLogRecord[]; skipped: number }>({ name: 'Synthetic interview', startedAt, transcript, records, skipped: 0 });
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => producerTimeline(source), [source]);
  const latency = producerLatency(source.records);
  const load = async (file: File | undefined) => {
    if (!file) return;
    try { setSource({ name: file.name, ...parseTimelineExport(JSON.parse(await file.text())) }); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'That file could not be read.'); }
  };
  return <>
    <div className="workshop-controls">
      {TIMELINE_LANES.map(lane => <label className="workshop-check" key={lane}><input type="checkbox" checked={lanes.includes(lane)} onChange={event => setLanes(value => event.target.checked ? [...value, lane] : value.filter(item => item !== lane))} /> {lane}</label>)}
      <label>Archive JSON<input type="file" accept="application/json,.json" onChange={event => { void load(event.target.files?.[0]); }} /></label>
      {error && <span role="status">{error}</span>}
      {source.skipped > 0 && <span role="status">{source.skipped} records from an earlier producer version are not shown.</span>}
    </div>
    <div className="sim-lab">
      <header className="sim-lab-heading">
        <span className="eyebrow">PRODUCER DEBUG · {source.name.toUpperCase()}</span>
        <h1>Producer timeline</h1>
        <p>Dialogue, Sol’s map calls, Jev’s readings, notes to Sam and lookups in one order, with each step’s latency. A loaded file stays in this browser; opening this view makes no provider request.</p>
      </header>
      <p className="sim-lab-checks">{Object.entries(latency).map(([name, stat]) => <span key={name}>{name} {stat ? `p50 ${stat.p50} · p90 ${stat.p90} ms · n ${stat.count}` : '—'}</span>)}</p>
      <ol className="interview-timeline">{rows.filter(row => lanes.includes(row.lane)).map(row => <li key={`${row.lane}-${row.id}`} data-lane={row.lane}>
        <time>{formatTime(Math.max(0, row.atMs) / 1000)}</time>
        <div>
          <p className="interview-timeline-title"><strong>{row.title}</strong>{row.outcome && <span className="interview-timeline-outcome">{row.outcome}</span>}{row.latencyMs != null && <span>{row.latencyMs} ms</span>}</p>
          {row.parts.length > 0 && <small>{row.parts.map(part => `${part.label} ${part.ms} ms`).join(' · ')}</small>}
          {row.detail && <p>{row.detail}</p>}
        </div>
      </li>)}</ol>
    </div>
  </>;
}
