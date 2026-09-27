import { useLoaderData } from 'react-router';
import type { Route } from './+types/voice-lab';
import { clients, publicCatalog } from '../../ai/simulator/scenarios.server';
import { VoiceLabContent } from '../simulator/voice-lab';
import { GameHeader } from '../ui/game-header';

export const meta = () => [{ title: 'Voice Lab — Out of Character' }];

export function loader(_: Route.LoaderArgs) {
  return {
    clients: publicCatalog().clients,
    defaultVoices: Object.fromEntries(clients.map(client => [client.id, client.voice])) as Record<string, string>,
  };
}

export default function VoiceLab() {
  const { clients, defaultVoices } = useLoaderData<typeof loader>();
  return <div className="app-shell simulator-shell"><GameHeader simulator /><main className="game-main"><VoiceLabContent clients={clients} defaultVoices={defaultVoices} /></main></div>;
}
