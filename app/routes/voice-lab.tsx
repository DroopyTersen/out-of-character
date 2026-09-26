import { useRef, useState } from 'react';
import { Link, useLoaderData } from 'react-router';
import type { Route } from './+types/voice-lab';
import { clients, publicCatalog } from '../../ai/simulator/scenarios.server';
import { liveVoices } from '../../core/simulator/voices';
import { clientProfiles } from '../simulator/client-profiles';
import { GameHeader } from '../ui/game-header';
import '../simulator/simulator.css';

export const meta = () => [{ title: 'Voice Lab — Out of Character' }];

export function loader(_: Route.LoaderArgs) {
  return {
    clients: publicCatalog().clients,
    defaultVoices: Object.fromEntries(clients.map(client => [client.id, client.voice])) as Record<string, string>,
  };
}

export default function VoiceLab() {
  const { clients, defaultVoices } = useLoaderData<typeof loader>();
  const [clientId, setClientId] = useState(clients[0]!.id);
  const [voice, setVoice] = useState(defaultVoices[clientId]!);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const client = clients.find(item => item.id === clientId)!;
  const profile = clientProfiles[clientId]!;
  const chosenVoice = liveVoices.find(item => item.id === voice)!;
  const currentVoice = liveVoices.find(item => item.id === defaultVoices[clientId])!;
  const stopAudio = () => { audio.current?.pause(); if (audio.current) audio.current.currentTime = 0; setAudioError(false); };
  const chooseClient = (id: string) => { if (id === clientId) return; stopAudio(); setClientId(id); };
  const chooseVoice = (id: string) => { if (id === voice) return; stopAudio(); setVoice(id); };

  return <div className="app-shell simulator-shell"><GameHeader simulator><Link className="workshop-link" to="/simulator">Simulator</Link></GameHeader><main className="game-main">
    <section className="sim-voice-lab">
      <header className="sim-heading"><span className="eyebrow">VOICE LAB</span><h1>Find the right voice for each client</h1><p>Choose a character and a voice, then play a short sample while you look at the portrait. No call or microphone needed.</p></header>
      <div className="sim-voice-lab-grid">
        <section className="sim-panel"><header className="sim-section-heading"><h2>Choose a client</h2><span>{clients.length} characters</span></header>
          <div className="sim-voice-lab-clients" role="group" aria-label="Choose a client">{clients.map(item => <button key={item.id} className={`sim-voice-lab-client ${item.id === clientId ? 'selected' : ''}`} aria-pressed={item.id === clientId} onClick={() => chooseClient(item.id)}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.style}</small></span></button>)}</div>
        </section>
        <section className="sim-panel sim-voice-lab-choice"><header className="sim-section-heading"><h2>Hear the difference</h2><span>{liveVoices.length} voices</span></header>
          <div className="sim-voice-lab-person"><img src={client.image} alt="" /><div><span className="eyebrow">YOU'RE HEARING</span><h3>{client.name}</h3><p>{client.description}</p></div></div>
          <label className="sim-voice-lab-select">GPT-Live voice<select value={voice} onChange={event => chooseVoice(event.target.value)}>{liveVoices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <p className="sim-voice-lab-description"><strong>{chosenVoice.label}</strong> {'description' in chosenVoice ? chosenVoice.description : 'A standard built-in voice. OpenAI does not specify a regional or style description for this voice.'}</p>
          <p className="sim-voice-lab-default">{voice === currentVoice.id ? `This is ${client.name}’s current simulator voice.` : `The simulator currently uses ${currentVoice.label} for ${client.name}.`} {voice !== currentVoice.id && <button className="quiet-button" onClick={() => { chooseVoice(currentVoice.id); requestAnimationFrame(() => audio.current?.focus()); }}>Hear current voice</button>}</p>
          <div className="sim-voice-lab-sample"><h3>Sample line</h3><audio key={`${clientId}-${voice}`} ref={audio} controls preload="metadata" tabIndex={0} src={`/simulator/voice-lab/${clientId}/${voice}.mp3`} aria-label={`${client.name} speaking with the ${chosenVoice.label} voice`} onError={() => setAudioError(true)} />{audioError && <p role="alert" className="sim-notice error">This sample could not be played. Try another voice or reload the page.</p>}<blockquote>{profile.sample}</blockquote><small>AI-generated voice sample. The recording may differ slightly from the written line.</small></div>
          <div className="sim-voice-lab-profile"><h3>Personality</h3><div className="sim-voice-lab-traits">{profile.traits.map(trait => <span key={trait}>{trait}</span>)}</div><p><strong>Background</strong> {profile.background}</p><p><strong>Speaking style</strong> {profile.pace}</p></div>
          <p className="sim-voice-lab-source"><a href="https://developers.openai.com/api/docs/guides/live-conversations" target="_blank" rel="noreferrer">Voice descriptions</a> · <a href="https://developers.openai.com/api/reference/go/__sdk_schema?declaration=(resource)+live+%3E+(model)+built_in_voice+%3E+(schema)&selected=(resource)+live" target="_blank" rel="noreferrer">Full voice list</a></p>
        </section>
      </div>
    </section>
  </main></div>;
}
