import { useEffect, useState } from 'react';
import { useLoaderData } from 'react-router';
import { useReducedMotion } from 'motion/react';
import type { Catalog } from '../../core/simulator/types';
import { VoiceDisplay } from '../simulator/voice-display';
import { SPECTRUM_BANDS, type AudioLevels } from '../simulator/audio-levels';

export const voiceStates = ['client', 'trainee', 'overlap', 'listening', 'muted', 'connecting', 'ending'] as const;
export type VoiceState = typeof voiceStates[number];

/** Deterministic illustration only. Production gets its bands from Web Audio. */
export function illustrativeLevels(state: string, frame: number, intensity = .65): AudioLevels {
  const bands = (offset: number) => Array.from({ length: SPECTRUM_BANDS }, (_, i) => intensity * (.2 + .8 * Math.abs(Math.sin(frame * .24 + i * .67 + offset))) * (1 - i / (SPECTRUM_BANDS * 1.7)));
  const input = state === 'trainee' || state === 'overlap';
  const output = state === 'client' || state === 'overlap';
  return { input: input ? intensity : 0, output: output ? intensity : 0, inputBands: input ? bands(1.9) : [], outputBands: output ? bands(0) : [] };
}

export function SimulatorVoiceStory() {
  const { simulatorCatalog: catalog } = useLoaderData() as { simulatorCatalog: Catalog };
  const [clientId, setClientId] = useState(catalog.clients[0]!.id);
  const [state, setState] = useState<VoiceState>('client');
  const [playing, setPlaying] = useState(true);
  const [cycle, setCycle] = useState(false);
  const [frame, setFrame] = useState(0);
  const [intensity, setIntensity] = useState(.65);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!playing || (reduced && !cycle)) return;
    const timer = setInterval(() => setFrame(value => value + (reduced ? 30 : 1)), reduced ? 2400 : 80);
    return () => clearInterval(timer);
  }, [playing, reduced, cycle]);
  const shown = cycle ? voiceStates[Math.floor(frame / 30) % voiceStates.length]! : state;
  const client = catalog.clients.find(item => item.id === clientId)!;
  return <>
    <div className="workshop-controls">
      <label>Client<select value={clientId} onChange={event => setClientId(event.target.value)}>{catalog.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Audio state<select value={state} onChange={event => { setState(event.target.value as VoiceState); setCycle(false); }}>{voiceStates.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Intensity<input type="range" min="0" max="1" step=".05" value={intensity} onChange={event => setIntensity(Number(event.target.value))} /></label>
      <button onClick={() => setPlaying(value => !value)}>{playing ? 'Pause preview' : 'Play preview'}</button>
      <button onClick={() => { setFrame(0); setCycle(true); setPlaying(true); }}>Replay all states</button>
      <button onClick={() => { setFrame(0); setCycle(false); setPlaying(false); setState('client'); setIntensity(.65); }}>Reset</button>
    </div>
    <p className="sim-collection-note">Illustrative audio. No microphone or connection. Mint is the client. Blue is your voice. Reduced motion uses steady activity indicators.</p>
    <section className="sim-voice-workbench sim-client-stage"><h2>{client.name}</h2><p>{client.style}</p><VoiceDisplay client={client} phase={shown === 'connecting' || shown === 'ending' ? shown : 'live'} muted={shown === 'muted'} levels={illustrativeLevels(shown, frame, intensity)} /></section>
  </>;
}
