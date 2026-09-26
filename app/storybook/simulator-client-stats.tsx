import { useLoaderData } from 'react-router';
import type { ClientStats } from '../../core/simulator/types';

const traits: [keyof ClientStats, string][] = [
  ['assertiveness', 'Assertiveness'],
  ['skepticism', 'Skepticism'],
  ['guardedness', 'Guardedness'],
  ['bargaining', 'Bargaining'],
  ['riskAversion', 'Risk aversion'],
  ['relationship', 'Relationship focus'],
];

export function SimulatorClientStats({ clientId }: { clientId: string }) {
  const { workshopClientStats } = useLoaderData() as { workshopClientStats: { id: string; name: string; stats: ClientStats }[] };
  const client = workshopClientStats.find(item => item.id === clientId);
  if (!client) return null;
  return <details className="workshop-client-stats" aria-label={`${client.name} workshop client traits`}>
    <summary>Workshop only · Client traits</summary>
    <dl>{traits.map(([id, label]) => <div key={id}><dt>{label}</dt><dd><meter min={0} max={4} value={client.stats[id]} aria-label={`${label}: ${client.stats[id]} of 4`} /> <span>{client.stats[id]}/4</span></dd></div>)}</dl>
  </details>;
}
