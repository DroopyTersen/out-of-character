import { useEffect, useRef, useState } from 'react';
import { Link, useLoaderData } from 'react-router';
import type { Route } from './+types/voice-lab';
import { clients, publicCatalog } from '../../ai/simulator/scenarios.server';
import { liveVoices } from '../../core/simulator/voices';
import { clientProfiles } from '../simulator/client-profiles';
import { GameHeader } from '../ui/game-header';
import { SimulatorConversation, SimulatorTranscript } from '../simulator/conversation';
import { useSimulator } from '../simulator/use-simulator';
import '../simulator/simulator.css';

export const meta = () => [{ title: 'Voice Lab — Out of Character' }];

export function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  return {
    catalog: publicCatalog(),
    defaultVoices: Object.fromEntries(clients.map(client => [client.id, client.voice])) as Record<string, string>,
    enabled: String(env.SIMULATOR_ENABLED) === 'true' && String(env.PAID_SERVICES_ENABLED) === 'true' && !!env.OPENAI_API_KEY && !!env.TYPESAFE_API_KEY,
  };
}

export default function VoiceLab() {
  const { catalog, defaultVoices, enabled } = useLoaderData<typeof loader>();
  const scenario = catalog.scenarios.find(item => item.id === 'happy-hour')!;
  const [clientId, setClientId] = useState(catalog.clients[0]!.id);
  const [voice, setVoice] = useState(defaultVoices[clientId]!);
  const [now, setNow] = useState(Date.now());
  const session = useSimulator();
  const client = catalog.clients.find(item => item.id === clientId)!;
  const profile = clientProfiles[clientId]!;
  const chosenVoice = liveVoices.find(item => item.id === voice)!;
  const main = useRef<HTMLElement>(null);
  const screen = session.phase === 'selection' || session.phase === 'debrief' ? session.phase : 'conversation';
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current !== screen) main.current?.querySelector<HTMLElement>('h1')?.focus();
    shownScreen.current = screen;
  }, [screen]);
  useEffect(() => {
    if (session.phase !== 'live') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [session.phase]);
  const chooseClient = (id: string) => setClientId(id);
  const start = () => session.start(scenario.id, clientId, voice);

  return <div className="app-shell simulator-shell"><GameHeader simulator><Link className="workshop-link" to="/simulator">Simulator</Link></GameHeader><main className="game-main" ref={main}>
    {session.phase === 'selection' ? <section className="sim-voice-lab">
      <header className="sim-heading"><span className="eyebrow">VOICE LAB</span><h1 tabIndex={-1}>Find the right voice for each client</h1><p>Pick a client and a voice, then have an open conversation. Change either one for your next call.</p></header>
      <div className="sim-voice-lab-grid">
        <section className="sim-panel"><header className="sim-section-heading"><h2>Choose a client</h2><span>{catalog.clients.length} characters</span></header>
          <div className="sim-voice-lab-clients" role="group" aria-label="Choose a client">{catalog.clients.map(item => <button key={item.id} className={`sim-voice-lab-client ${item.id === clientId ? 'selected' : ''}`} aria-pressed={item.id === clientId} onClick={() => chooseClient(item.id)}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.style}</small></span></button>)}</div>
        </section>
        <section className="sim-panel sim-voice-lab-choice"><header className="sim-section-heading"><h2>Choose a voice</h2><span>{liveVoices.length} options</span></header>
          <div className="sim-voice-lab-person"><img src={client.image} alt="" /><div><span className="eyebrow">YOU'RE TALKING TO</span><h3>{client.name}</h3><p>{client.description}</p></div></div>
          <label className="sim-voice-lab-select">GPT-Live voice<select value={voice} onChange={event => setVoice(event.target.value)}>{liveVoices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <p className="sim-voice-lab-description"><strong>{chosenVoice.label}</strong> {'description' in chosenVoice ? chosenVoice.description : 'A standard built-in voice. The GPT-Live guide does not give this voice a regional or style description.'}</p>
          <p className="sim-voice-lab-source"><a href="https://developers.openai.com/api/docs/guides/live-conversations" target="_blank" rel="noreferrer">Voice descriptions</a> · <a href="https://developers.openai.com/api/reference/go/__sdk_schema?declaration=(resource)+live+%3E+(model)+built_in_voice+%3E+(schema)&selected=(resource)+live" target="_blank" rel="noreferrer">Full voice list</a></p>
          <p className="sim-voice-lab-default">{voice === defaultVoices[clientId] ? 'This is the client’s current simulator voice.' : `The simulator currently uses ${liveVoices.find(item => item.id === defaultVoices[clientId])?.label ?? defaultVoices[clientId]} for ${client.name}.`}</p>
          <div className="sim-voice-lab-profile"><h3>Personality</h3><div className="sim-voice-lab-traits">{profile.traits.map(trait => <span key={trait}>{trait}</span>)}</div><p><strong>Background</strong> {profile.background}</p><p><strong>Speaking style</strong> {profile.pace}</p></div>
          <p className="sim-voice-lab-note">No objectives or score. Just talk and hear how the voice fits the character. Voice changes take effect on the next call.</p>
        </section>
      </div>
      <div className="sim-start">{session.error && <p role="alert" className="sim-notice error">{session.error}</p>}{!enabled && <p className="sim-notice">Live voice sessions are currently unavailable.</p>}<button className="arcade-button primary" disabled={!enabled} onClick={start}>Talk to {client.name} with {chosenVoice.label}</button><small>Uses your microphone. Transcripts, but no audio, are saved privately to improve the simulator.</small></div>
    </section> : session.phase === 'debrief' ? <section className="sim-voice-lab sim-debrief">
      <header className="sim-heading"><span className="eyebrow">VOICE LAB · {client.name.toUpperCase()} · {chosenVoice.label.toUpperCase()}</span><h1 tabIndex={-1}>Your conversation</h1><p>How did this voice fit {client.name}?</p></header>
      {(session.error || session.snapshot?.message) && <p className="sim-notice" role="status">{session.error || session.snapshot?.message}</p>}
      <div className="sim-debrief-actions"><button className="arcade-button primary" onClick={start}>Try {chosenVoice.label} again</button><button className="quiet-button" onClick={session.reset}>Choose another voice or client</button></div>
      <details className="sim-debrief-transcript"><summary>Review the conversation</summary><SimulatorTranscript entries={session.snapshot?.transcript ?? []} /></details>
    </section> : <div className="sim-voice-lab"><p className="sim-voice-lab-now">Voice Lab · {client.name} with {chosenVoice.label}</p><SimulatorConversation scenario={scenario} client={client} snapshot={session.snapshot} phase={session.phase} muted={session.muted} levels={session.levels} elapsed={session.snapshot ? Math.max(0, (now - session.snapshot.startedAt) / 1000) : 0} onEnd={() => { void session.end(); }} onMute={session.toggleMute} onAudio={session.playAudio} error={session.error} /></div>}
  </main></div>;
}
