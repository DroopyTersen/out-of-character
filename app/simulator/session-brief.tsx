import { Clock, UserRound, X } from 'lucide-react';
import type { Client, ScenarioSummary } from '../../core/simulator/types';
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from '../shadcn/components/ui/dialog';

export function SessionBrief({ scenario, client }: { scenario: ScenarioSummary; client: Client }) {
  const openEnded = scenario.objectives.length === 0;
  return <DialogContent className="sim-dialog sim-session-brief" showCloseButton={false}>
    <header className="sim-dialog-header"><DialogTitle>Session brief</DialogTitle><DialogClose className="quiet-button" aria-label="Close session brief"><X size={22} /></DialogClose></header>
    <DialogDescription className="sim-announcement">Your client and the setting. The conversation continues while this is open.</DialogDescription>
    <div className="sim-brief-body">
      <section>
        <h3>Client</h3>
        <div className="sim-brief-client"><img src={client.image} alt="" /><div><h4>{client.name}</h4><p className="sim-muted">{scenario.clientRole} · {client.style}</p><p>{client.description}</p></div></div>
      </section>
      <section><h3>Scenario</h3><h4>{scenario.title}</h4><p>{scenario.summary}</p><div className="sim-brief-meta"><span><UserRound size={16} />{scenario.role}</span><span><Clock size={16} />{scenario.durationMinutes} minutes</span></div></section>
      <section><h3>{openEnded ? 'The setting' : 'Your lead'}</h3><p>{scenario.lead}</p></section>
      {scenario.briefing && <section><h3>What you know going in</h3><ul>{scenario.briefing.map(fact => <li key={fact}>{fact}</li>)}</ul></section>}
      {!openEnded && <><section><h3>Our capabilities</h3><ul>{scenario.services.map(service => <li key={service}>{service}</li>)}</ul></section>
      <section><h3>Your objectives <small>Any order</small></h3><ul>{scenario.objectives.map(objective => <li key={objective.id}>{objective.label}</li>)}</ul></section></>}
    </div>
  </DialogContent>;
}
