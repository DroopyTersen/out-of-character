import { useState } from 'react';
import { interviewFixtures } from '../../ai/interview/fixtures';
import recordings from '../../ai/interview/recordings.json';
import { COVERAGE_LEVEL_LABELS, interviewReadings, interviewTopics, type InterviewObjectiveReading, type InterviewReadingId } from '../../core/interview';
import { formatTime } from '../simulator/conversation';
import '../simulator/simulator.css';

type Recording = {
  collectedAt: string; rubricVersion: string; source: string;
  rows: {
    fixtureId: string;
    participant: { model: string; durationMs: number; readings: Record<InterviewReadingId, { value: number | null; evidence: { entryId: string; speaker: string; text: string } | null }>; objectives: InterviewObjectiveReading[] };
  }[];
};
const recorded = recordings as unknown as Recording;

function ParticipantEvidence({ evidence }: { evidence: { entryId: string; speaker: string; text: string } | null }) {
  return evidence?.speaker === 'participant'
    ? <blockquote className="sim-evidence"><span>Participant · {evidence.entryId}</span><p>“{evidence.text}”</p></blockquote>
    : <p className="sim-muted">No participant passage cited.</p>;
}

export function InterviewJudgingStory() {
  const [id, setId] = useState(interviewFixtures[0]!.id);
  const fixture = interviewFixtures.find(item => item.id === id)!;
  const row = recorded.rows.find(item => item.fixtureId === id)!;
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
      <p className="sim-lab-provenance">Synthetic fixture · {recorded.rubricVersion} · measured {recorded.collectedAt.slice(0, 10)}<br />Participant {row.participant.model} · {row.participant.durationMs} ms. Opening this view makes no provider request.</p>
      <div className="sim-lab-grid">
        <div>
          <h2 className="sim-lab-column-title">Conversation evidence</h2>
          <div className="sim-transcript">{fixture.transcript.map(entry =>
            <article key={entry.id} data-speaker={entry.speaker}>
              <header><strong>{entry.speaker === 'participant' ? 'Participant' : 'Sam'}</strong><time>{formatTime(entry.startMs / 1000)}</time></header>
              <p>{entry.text}</p>
            </article>
          )}</div>
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
            <h3>Topic coverage from the participant</h3>
            <p className="sim-muted">Marks require participant evidence and sufficient confidence. The raw probabilities below may favor a level that has not met those checks.</p>
            {interviewTopics.map(topic => {
              return <div key={topic.id}>
                <h4>{topic.label}</h4>
                {topic.objectives.map(objective => {
                  const reading = row.participant.objectives.find(item => item.id === objective.id)!;
                  return <div key={objective.id}>
                    <p>{objective.label} · {COVERAGE_LEVEL_LABELS[reading.level]}</p>
                    {reading.levels && <p className="sim-muted">{Object.entries(reading.levels).map(([level, probability]) => `${COVERAGE_LEVEL_LABELS[level as keyof typeof COVERAGE_LEVEL_LABELS]} ${Math.round(probability * 100)}%`).join(' · ')}</p>}
                    {reading.evidence && <ParticipantEvidence evidence={reading.evidence} />}
                  </div>;
                })}
              </div>;
            })}
          </section>
        </div>
      </div>
      <details className="sim-lab-source"><summary>Recording source</summary>
        <p className="sim-lab-provenance">{recorded.source} · synthetic transcript and reduced typed results only</p>
      </details>
    </div>
  </>;
}
