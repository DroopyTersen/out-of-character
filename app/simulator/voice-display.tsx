import type { CSSProperties } from 'react';
import type { Client } from '../../core/simulator/types';
import { SPECTRUM_BANDS, type AudioLevels } from './audio-levels';

export function VoiceDisplay({ client, levels, phase, muted }: {
  client: Client; levels: AudioLevels; phase: 'connecting' | 'live' | 'ending'; muted: boolean;
}) {
  const clientSpeaking = phase === 'live' && levels.output > .03;
  const traineeSpeaking = phase === 'live' && !muted && levels.input > .03;
  const state = phase !== 'live' ? phase : clientSpeaking && traineeSpeaking ? 'overlap' : clientSpeaking ? 'client' : muted ? 'muted' : traineeSpeaking ? 'trainee' : 'listening';
  const labels = { connecting: 'Connecting to your client…', ending: 'Ending and reviewing…', client: `${client.name} is speaking`, trainee: 'Listening to you', overlap: 'Both of you are speaking', listening: 'Your client is listening', muted: 'Microphone muted' };
  return <div className="sim-voice-display" data-state={state}>
    <div className="sim-portrait" style={{ '--voice-energy': clientSpeaking ? levels.output : 0 } as CSSProperties}>
      <div className="sim-voice-glow" aria-hidden="true" />
      <img src={client.image} alt="" draggable={false} />
    </div>
    <div className="sim-speaking"><i />{labels[state]}</div>
    <div className="sim-voice" aria-hidden="true">
      <div className="sim-spectrum client">{Array.from({ length: SPECTRUM_BANDS }, (_, i) => <i key={i} style={{ height: `${2 + (clientSpeaking ? levels.outputBands[i] ?? 0 : 0) * 28}px`, '--bar': i } as CSSProperties} />)}</div>
      <div className="sim-spectrum trainee">{Array.from({ length: SPECTRUM_BANDS }, (_, i) => <i key={i} style={{ height: `${2 + (traineeSpeaking ? levels.inputBands[i] ?? 0 : 0) * 22}px` }} />)}</div>
      <div className="sim-voice-key"><span>{client.name}</span><span>{muted ? 'You · muted' : 'You'}</span></div>
    </div>
  </div>;
}
