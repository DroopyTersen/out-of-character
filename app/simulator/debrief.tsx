import { RotateCcw, ArrowLeft } from 'lucide-react';
import { buildDebrief } from '../../core/simulator/state';
import type { Client, ScenarioSummary, SessionSnapshot } from '../../core/simulator/types';
import { EvidenceQuote, SimulatorObjectives, SimulatorSkills } from './feedback';
import { formatTime, SimulatorTranscript } from './conversation';

export function SimulatorDebrief({ scenario, client, snapshot, onRetry, onChoose, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null; onRetry: () => void; onChoose: () => void; error?: string | null;
}) {
  const debrief = buildDebrief(scenario, snapshot?.evaluation ?? null);
  const strengthGroups = new Map<string, typeof debrief.strengths>();
  for (const item of debrief.strengths) {
    const group = strengthGroups.get(item.evidence.entryId) ?? [];
    group.push(item);
    strengthGroups.set(item.evidence.entryId, group);
  }
  return <section className="sim-debrief"><header className="sim-heading"><span className="eyebrow">THE DEBRIEF · {client.name.toUpperCase()}</span><h1>Your session debrief</h1><p>{scenario.title} · {formatTime(snapshot?.usageSeconds ?? (snapshot?.transcript.at(-1)?.endMs ?? 0) / 1000)}</p></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    {snapshot?.evaluation?.concern && <p className="sim-notice">{snapshot.evaluation.concern}</p>}
    {snapshot?.feedbackStatus === 'delayed' && <p className="sim-notice">Final feedback is incomplete. These are the latest available skill readings; the final outcome could not be confirmed.</p>}
    <div className="sim-outcome"><img src={client.image} alt="" /><div className="sim-outcome-copy"><span className="eyebrow">ATTEMPT ENDED · {client.name.toUpperCase()}</span><strong>{debrief.outcome}</strong></div><div className="sim-outcome-count"><b>{debrief.completed}<small> / {debrief.total}</small></b><span>{debrief.completed} of {debrief.total} objectives confirmed</span></div></div>
    <div className="sim-debrief-grid"><div><section className="sim-takeaways"><h2>Take it into the next meeting</h2>{[...strengthGroups].map(([entryId, group]) => <article key={entryId}>{group.map(item => <span className="eyebrow" key={item.skill}>KEEP · {item.label.toUpperCase()}</span>)}<EvidenceQuote evidence={group[0]!.evidence} /></article>)}{debrief.improvements.map(item => <article key={item.skill}><span className="eyebrow">PRACTICE · {item.label.toUpperCase()}</span><p>{item.suggestion}</p><EvidenceQuote evidence={item.evidence} /></article>)}{!debrief.strengths.length && !debrief.improvements.length && <p className="sim-muted">There is not enough reliable evidence for a takeaway yet. Try a longer conversation and respond to the client’s concerns.</p>}</section><SimulatorObjectives scenario={scenario} evaluation={snapshot?.evaluation ?? null} /></div><SimulatorSkills evaluation={snapshot?.evaluation ?? null} status={snapshot?.feedbackStatus ?? 'unavailable'} final /></div>
    <div className="sim-debrief-actions"><button className="arcade-button primary" onClick={onRetry}><RotateCcw size={20} />Try this again</button><button className="quiet-button" onClick={onChoose}><ArrowLeft size={17} />Choose another simulation</button></div><details className="sim-debrief-transcript"><summary>Review the full conversation</summary><SimulatorTranscript entries={snapshot?.transcript ?? []} /></details>
  </section>;
}
