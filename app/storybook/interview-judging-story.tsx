import { useState } from 'react';
import { interviewFixtures } from '../../ai/interview/fixtures';
import recordings from '../../ai/interview/recordings.json';
import { interviewReadings, interviewTopics } from '../../core/interview';
import { formatTime } from '../simulator/conversation';
import '../simulator/simulator.css';

function ParticipantEvidence({ evidence }: { evidence: { entryId: string; speaker: string; text: string } | null }) {
  return evidence?.speaker === 'trainee'
    ? <blockquote className="sim-evidence"><span>Participant · {evidence.entryId}</span><p>“{evidence.text}”</p></blockquote>
    : <p className="sim-muted">No participant passage cited.</p>;
}

export function InterviewJudgingStory() {
  const [id, setId] = useState(interviewFixtures[0]!.id);
  const fixture = interviewFixtures.find(item => item.id === id)!;
  const row = recordings.rows.find(item => item.fixtureId === id)!;
  const heard = row.participant.objectives.filter(item => item.achieved && item.evidence?.speaker === 'trainee');
  return <>
    <div className="workshop-controls">
      <label>Synthetic interview<select value={id} onChange={event => setId(event.target.value)}>
        {interviewFixtures.map(item => <option key={item.id} value={item.id}>{item.id.replaceAll('-', ' ')}</option>)}
      </select></label>
    </div>
    <div className="sim-lab">
      <header className="sim-lab-heading">
        <span className="eyebrow">RECORDED JEV ANALYSIS · SYNTHETIC INTERVIEW</span>
        <h1>{fixture.id.replaceAll('-', ' ')}</h1>
        <p>{fixture.description}</p>
      </header>
      <p className="sim-lab-provenance">Synthetic fixture · {recordings.rubricVersion} · measured {recordings.collectedAt.slice(0, 10)}<br />Participant {row.participant.model} · {row.participant.durationMs} ms · Interviewer {row.interviewer.model} · {row.interviewer.durationMs} ms. Opening this view makes no provider request.</p>
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
            <p>Recorded decision: <strong>{row.interviewer.cueId === 'no_hint' ? 'No cue selected' : row.interviewer.cueId}</strong> · {(row.interviewer.cueProbability * 100).toFixed(0)}% model probability</p>
            <p>{row.interviewer.cueId === 'no_hint' ? 'No private direction was proposed in this recording.' : 'A live session also checks freshness and cooldown before using this candidate.'}</p>
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
        <p className="sim-lab-provenance">{recordings.source} · synthetic transcript and reduced typed results only</p>
      </details>
    </div>
  </>;
}
