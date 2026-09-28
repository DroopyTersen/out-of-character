import { useMemo, useState } from 'react';
import { producerLatency, type ProducerLogRecord } from '../../core/interview-producer';
import { parseTimelineExport, producerTimeline, TIMELINE_LANES, type TimelineLane } from '../../core/interview-timeline';
import type { TranscriptEntry } from '../../core/simulator/types';
import { formatTime } from '../simulator/conversation';
import { transcript } from './interview-stories';
import '../simulator/simulator.css';
import '../interview/interview.css';

const startedAt = Date.UTC(2026, 0, 5, 15);
const at = (seconds: number) => startedAt + seconds * 1000;
const check = (probability: number, lastInputId: string) => ({ probability, inputCount: 4, lastInputId });
/** Synthetic log for the story transcript: an unresolved lookup, a withheld follow-up, a sent cue and two rundowns. */
const records: ProducerLogRecord[] = [
  { source: 'assessment', id: 'assessment-1', snapshotAt: at(15), completedAt: at(17.2), model: 'jev-1.13.0', inputCount: 2, lastInputId: 'u1',
    signals: [{ condition: 'missed-thread', probability: .22 }, { condition: 'leading', probability: .04 }], researchProbability: .71, outcome: 'observed', concerns: [] },
  { source: 'producer', id: 'producer-1', triggers: [{ kind: 'check-in' }, { kind: 'signal', condition: 'research', probability: .71 }], queued: false, model: 'gpt-6-sol', effort: 'none',
    inputCount: 4, lastInputId: 'u2', triggeredAt: at(31.8), startedAt: at(31.8), generatedAt: at(33.1), completedAt: at(33.1), outcome: 'none',
    result: { cue: null, evidenceIds: [], research: { kind: 'term', name: 'offline use', clue: null, passageIds: ['u2'] } } },
  { source: 'research', id: 'research-1', consultationId: 'producer-1', request: { kind: 'term', name: 'offline use', clue: null, passageIds: ['u2'] }, model: 'gpt-6-luna',
    requestedAt: at(33.1), lookupAt: at(47.9), completedAt: at(47.9), outcome: 'unresolved', reason: 'Too general to identify one public source.' },
  { source: 'rundown', id: 'rundown-1', sentAt: at(34), reason: 'change', elapsedMinutes: 1, levels: { 'project-delivery': 'explored', 'project-role': 'explored' }, outcome: 'sent',
    delivery: { eventId: 'rundown-1', afterPassageId: 'u2', status: 'accepted' } },
  { source: 'assessment', id: 'assessment-2', snapshotAt: at(40), completedAt: at(42.6), model: 'jev-1.13.0', inputCount: 6, lastInputId: 'u3',
    signals: [{ condition: 'missed-thread', probability: .64 }, { condition: 'leading', probability: .06 }], researchProbability: .2, outcome: 'observed', concerns: [] },
  { source: 'producer', id: 'producer-2', triggers: [{ kind: 'research', researchId: 'research-1', status: 'unresolved' }, { kind: 'signal', condition: 'missed-thread', probability: .64 }],
    queued: false, model: 'gpt-6-sol', effort: 'none', inputCount: 6, lastInputId: 'u3', triggeredAt: at(47.9), startedAt: at(47.9), generatedAt: at(49.2), checkedAt: at(50.1),
    completedAt: at(50.1), outcome: 'withheld', check: check(.41, 'u3'),
    result: { cue: 'If it fits, ask which offline tool the inspectors compared it with.', evidenceIds: ['u2'], research: null } },
  { source: 'producer', id: 'producer-3', triggers: [{ kind: 'check-in' }], queued: true, model: 'gpt-6-sol', effort: 'none', inputCount: 6, lastInputId: 'u3',
    triggeredAt: at(48.5), startedAt: at(50.1), generatedAt: at(51.3), checkedAt: at(52), sentAt: at(52.1), nextSamTurnAt: at(54.2), completedAt: at(52.1), outcome: 'sent',
    check: check(.83, 'u3'), result: { cue: 'Ask what the client did with the synthetic-data caveat.', evidenceIds: ['u3'], research: null },
    delivery: { eventId: 'cue-3', afterPassageId: 'u3', status: 'accepted' } },
  { source: 'rundown', id: 'rundown-2', sentAt: at(60), reason: 'change', elapsedMinutes: 1,
    levels: { 'project-delivery': 'explored', 'project-role': 'explored', 'project-reflection': 'touched', 'client-access': 'explored' }, outcome: 'sent',
    delivery: { eventId: 'rundown-2', afterPassageId: 'u4', status: 'accepted' } },
];

export function InterviewTimelineStory() {
  const [lanes, setLanes] = useState<TimelineLane[]>(TIMELINE_LANES.filter(lane => lane !== 'assessment'));
  const [source, setSource] = useState<{ name: string; startedAt: number; transcript: TranscriptEntry[]; records: ProducerLogRecord[] }>({ name: 'Synthetic interview', startedAt, transcript, records });
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
    </div>
    <div className="sim-lab">
      <header className="sim-lab-heading">
        <span className="eyebrow">PRODUCER DEBUG · {source.name.toUpperCase()}</span>
        <h1>Producer timeline</h1>
        <p>Dialogue, Sol consultations, research cards, rundowns and assessments in one order, with each step’s latency. A loaded file stays in this browser; opening this view makes no provider request.</p>
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
