import { useState } from 'react';
import { interviewFixtures } from '../../ai/interview/fixtures';
import recordings from '../../ai/interview/recordings.json';
import { interviewReadings, interviewTopics, type InterviewReadingId } from '../../core/interview';
import type { DirectorResult, DirectorSignal } from '../../core/simulator/director';
import { formatTime } from '../simulator/conversation';
import '../simulator/simulator.css';

type Recording = {
  collectedAt: string; rubricVersion: string; source: string;
  rows: {
    fixtureId: string;
    participant: { model: string; durationMs: number; readings: Record<InterviewReadingId, { value: number | null; evidence: { entryId: string; speaker: string; text: string } | null }>; objectives: { id: string; achieved: boolean; evidence: { entryId: string; speaker: string; text: string } | null }[] };
    interviewer: { model: string; durationMs: number; signals: DirectorSignal[] };
    director?: { decision: string; issueId?: string | null; result?: (DirectorResult & { model?: string; durationMs?: number }) | null };
  }[];
};
const recorded = recordings as unknown as Recording;

function ParticipantEvidence({ evidence }: { evidence: { entryId: string; speaker: string; text: string } | null }) {
  return evidence?.speaker === 'trainee'
    ? <blockquote className="sim-evidence"><span>Participant · {evidence.entryId}</span><p>“{evidence.text}”</p></blockquote>
    : <p className="sim-muted">No participant passage cited.</p>;
}

export function InterviewJudgingStory() {
  const [id, setId] = useState(interviewFixtures[0]!.id);
  const fixture = interviewFixtures.find(item => item.id === id)!;
  const row = recorded.rows.find(item => item.fixtureId === id)!;
  const heard = row.participant.objectives.filter(item => item.achieved && item.evidence?.speaker === 'trainee');
  return <>
    <div className="workshop-controls">
      <label>Synthetic interview<select value={id} onChange={event => setId(event.target.value)}>
        {interviewFixtures.map(item => <option key={item.id} value={item.id}>{item.id.replaceAll('-', ' ')}</option>)}
      </select></label>
    </div>
    <div className="sim-lab">
      <header className="sim-lab-heading">
        <span className="eyebrow">RECORDED ANALYSIS · SYNTHETIC INTERVIEW</span>
        <h1>{fixture.id.replaceAll('-', ' ')}</h1>
        <p>{fixture.description}</p>
      </header>
      <p className="sim-lab-provenance">Synthetic fixture · {recorded.rubricVersion} · measured {recorded.collectedAt.slice(0, 10)}<br />Participant {row.participant.model} · {row.participant.durationMs} ms · Interviewer {row.interviewer.model} · {row.interviewer.durationMs} ms. Opening this view makes no provider request.</p>
      <div className="sim-lab-grid">
        <div>
          <h2 className="sim-lab-column-title">Conversation evidence</h2>
          <div className="sim-transcript">{fixture.transcript.map(entry =>
            <article key={entry.id} data-speaker={entry.speaker}>
              <header><strong>{entry.speaker === 'trainee' ? 'Participant' : 'Sam'}</strong><time>{formatTime(entry.startMs / 1000)}</time></header>
              <p>{entry.text}</p>
            </article>
          )}</div>
          <section className="sim-director-readout">
            <h3>Private interviewer direction</h3>
            <>
              <p>Jev observations: {row.interviewer.signals.map(signal => 'probability' in signal ? `${signal.condition.replaceAll('-', ' ')} ${(signal.probability * 100).toFixed(0)}%` : null).filter(Boolean).join(' · ')}</p>
              <p>Producer gate: <strong>{row.director?.decision ?? 'Not replayed'}</strong>{row.director?.issueId ? ` · ${row.director.issueId}` : ''}</p>
              {row.director?.result?.action === 'intervene' ? <>
                <blockquote className="sim-evidence"><span>Recorded Sol direction{row.director.result.model ? ` · ${row.director.result.model}` : ''}</span><p>“{row.director.result.text}”</p></blockquote>
                {row.director.result.evidenceIds.map(entryId => {
                  const entry = fixture.transcript.find(item => item.id === entryId);
                  return entry ? <blockquote className="sim-evidence" key={entryId}><span>{entry.speaker === 'trainee' ? 'Participant' : 'Sam'} · {entryId}</span><p>“{entry.text}”</p></blockquote> : null;
                })}
              </> : <p>{row.director?.result?.action === 'none' ? 'Sol chose no direction for this review.' : !row.director ? 'This fixture has not had a Sol replay.' : row.director.decision === 'started' ? 'Sol did not return a usable direction.' : 'The gate made no Sol call for this fixture.'}</p>}
            </>
          </section>
        </div>
        <div>
          <h2 className="sim-lab-column-title">Participant observations</h2>
          <div className="sim-lab-grid">{interviewReadings.map(item => {
            const reading = row.participant.readings[item.id];
            return <section className="sim-panel" key={item.id}>
              <h3>{item.label}</h3>
              <p>{reading.value == null ? 'Not observed' : `${reading.value.toFixed(2)} / 4`}</p>
              <ParticipantEvidence evidence={reading.evidence} />
            </section>;
          })}</div>
          <section className="sim-director-readout">
            <h3>Topics heard from the participant</h3>
            {heard.length ? interviewTopics.map(topic => {
              const items = topic.objectives.filter(objective => heard.some(item => item.id === objective.id));
              return items.length ? <div key={topic.id}>
                <h4>{topic.label}</h4>
                {items.map(objective => <div key={objective.id}>
                  <p>✓ {objective.label}</p>
                  <ParticipantEvidence evidence={heard.find(item => item.id === objective.id)!.evidence} />
                </div>)}
              </div> : null;
            }) : <p>No topic was credited from participant evidence in this recording.</p>}
          </section>
        </div>
      </div>
      <details className="sim-lab-source"><summary>Recording source</summary>
        <p className="sim-lab-provenance">{recorded.source} · synthetic transcript and reduced typed results only</p>
      </details>
    </div>
  </>;
}
