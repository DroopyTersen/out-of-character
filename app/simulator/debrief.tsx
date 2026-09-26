import { RotateCcw, ArrowLeft } from 'lucide-react';
import { buildDebrief } from '../../core/simulator/state';
import type { Client, ScenarioSummary, SessionSnapshot } from '../../core/simulator/types';
import { EvidenceQuote, SimulatorObjectives, SimulatorSkills } from './feedback';
import { formatTime, SimulatorTranscript } from './conversation';

export function SimulatorDebrief({ scenario, client, snapshot, onRetry, onChoose, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null; onRetry: () => void; onChoose: () => void; error?: string | null;
}) {
  const debrief = buildDebrief(scenario, snapshot?.evaluation ?? null);
  const concern = snapshot?.evaluation?.concern;
  const strengthGroups = new Map<string, typeof debrief.strengths>();
  for (const item of concern ? [] : debrief.strengths) {
    const group = strengthGroups.get(item.evidence.entryId) ?? [];
    group.push(item);
    strengthGroups.set(item.evidence.entryId, group);
  }
  const practiceGroups = new Map<string, typeof debrief.improvements>();
  for (const item of debrief.improvements) {
    const group = practiceGroups.get(item.evidence.entryId) ?? [];
    group.push(item);
    practiceGroups.set(item.evidence.entryId, group);
  }
  return <section className="sim-debrief"><header className="sim-heading"><span className="eyebrow">THE DEBRIEF · {client.name.toUpperCase()}</span><h1>Your session debrief</h1><p>{scenario.title} · {formatTime(snapshot?.usageSeconds ?? (snapshot?.transcript.at(-1)?.endMs ?? 0) / 1000)}</p></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    {concern && <p className="sim-notice">{concern}</p>}
    {snapshot?.feedbackStatus === 'delayed' && <p className="sim-notice">Final feedback is incomplete. The outcome and readings below come from the latest assessment, which may not include the end of the conversation.</p>}
    <div className="sim-outcome" data-empty={debrief.completed === 0}><img src={client.image} alt="" /><div className="sim-outcome-copy"><span className="eyebrow">ATTEMPT ENDED · {client.name.toUpperCase()}</span><strong>{debrief.outcome}</strong></div><div className="sim-outcome-count"><b>{debrief.completed}<small> of {debrief.total}</small></b><span>Objectives confirmed</span></div></div>
    <div className="sim-debrief-grid"><div><section className="sim-takeaways"><h2>Takeaways</h2>{[...strengthGroups].map(([entryId, group]) => <article key={entryId}><span className="eyebrow">KEEP · {group.map(item => item.label).join(" + ").toUpperCase()}</span><EvidenceQuote evidence={group[0]!.evidence} /></article>)}{[...practiceGroups].map(([entryId, group]) => <article key={entryId}><span className="eyebrow">PRACTICE · {group.map(item => item.label).join(" + ").toUpperCase()}</span>{group.map(item => <p key={item.skill}>{item.suggestion}</p>)}<EvidenceQuote evidence={group[0]!.evidence} /></article>)}{!strengthGroups.size && !practiceGroups.size && <p className="sim-muted">{concern ? 'Focus your next attempt on the concern above. Open the skill readings to review the evidence.' : snapshot?.evaluation ? 'There is not enough reliable evidence for a takeaway yet. Try a longer conversation and respond to the client’s concerns.' : 'Takeaways need an assessment of the conversation, and none was available for this attempt.'}</p>}</section><SimulatorObjectives scenario={scenario} evaluation={snapshot?.evaluation ?? null} /></div><SimulatorSkills evaluation={snapshot?.evaluation ?? null} status={snapshot?.feedbackStatus ?? 'unavailable'} final /></div>
    <div className="sim-debrief-actions"><button className="arcade-button primary" onClick={onRetry}><RotateCcw size={20} />Try this again</button><button className="quiet-button" onClick={onChoose}><ArrowLeft size={17} />Choose another simulation</button></div><details className="sim-debrief-transcript"><summary>Review the full conversation</summary><SimulatorTranscript entries={snapshot?.transcript ?? []} /></details>
  </section>;
}
