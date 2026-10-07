import type { CSSProperties } from 'react';
import type { Client } from '../../core/simulator/types';
import { SPECTRUM_BANDS, type AudioLevels } from '../../interview-engine/client/audioLevels';

export function VoiceDisplay({ client, levels, phase, muted, compact = false, relationship = 'client' }: {
  client: Client; levels: AudioLevels; phase: 'connecting' | 'live' | 'paused' | 'ending'; muted: boolean; compact?: boolean; relationship?: 'client' | 'interviewer';
}) {
  const clientSpeaking = phase === 'live' && levels.output > .03;
  const traineeSpeaking = phase === 'live' && !muted && levels.input > .03;
  const state = phase !== 'live' ? phase : clientSpeaking && traineeSpeaking ? 'overlap' : clientSpeaking ? 'client' : muted ? 'muted' : traineeSpeaking ? 'trainee' : 'listening';
  const labels = { connecting: `Connecting to your ${relationship}…`, paused: 'Paused until the connection returns', ending: 'Ending and reviewing…', client: `${client.name} is speaking`, trainee: 'Listening to you', overlap: 'Both of you are speaking', listening: relationship === 'interviewer' ? `${client.name} is listening` : 'Your client is listening', muted: 'Microphone muted' };
  const shortLabels = { connecting: 'Connecting…', paused: 'Paused', ending: 'Finishing…', client: 'Speaking', trainee: 'Listening to you', overlap: 'Both speaking', listening: 'Listening', muted: 'Mic muted' };
  return <div className="sim-voice-display" data-state={state}>
    <span className="sim-announcement" role="status">{phase === 'live' ? 'Voice session connected.' : labels[phase]}</span>
    <div className="sim-portrait" style={{ '--voice-energy': clientSpeaking ? levels.output : 0 } as CSSProperties}>
      <div className="sim-voice-glow" aria-hidden="true" />
      <img src={client.image} alt="" draggable={false} />
    </div>
    <div className="sim-speaking"><i />{compact ? <><span className="sim-desktop-only">{labels[state]}</span><span className="sim-mobile-only">{shortLabels[state]}</span></> : labels[state]}</div>
    <div className="sim-voice" aria-hidden="true" data-muted={muted}>
      <div className="sim-spectrum client">{Array.from({ length: SPECTRUM_BANDS }, (_, i) => <i key={i} style={{ height: `${Math.round(2 + (clientSpeaking ? levels.outputBands[i] ?? 0 : 0) * 28)}px`, '--bar': String(i) } as CSSProperties} />)}</div>
      <div className="sim-spectrum trainee">{Array.from({ length: SPECTRUM_BANDS }, (_, i) => <i key={i} style={{ height: `${Math.round(2 + (traineeSpeaking ? levels.inputBands[i] ?? 0 : 0) * 22)}px` }} />)}</div>
      <div className="sim-voice-key"><span>{client.name}</span><span>{muted ? 'You · muted' : 'You'}</span></div>
    </div>
  </div>;
}
