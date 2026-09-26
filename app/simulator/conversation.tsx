import { useState } from 'react';
import { FileText, Mic, MicOff, Volume2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Client, ScenarioSummary, SessionSnapshot, TranscriptEntry } from '../../core/simulator/types';
import { SimulatorHint, SimulatorObjectives, SimulatorSkills } from './feedback';

export function VoiceActivity({ level, active }: { level: number; active: boolean }) {
  const reduced = useReducedMotion();
  return <div className="sim-voice" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <motion.i key={index} animate={{ height: active ? 4 + Math.max(level, .02) * (10 + ((index * 7) % 19)) : 3 }} transition={{ duration: reduced ? 0 : .12 }} />)}</div>;
}

export function SimulatorTranscript({ entries }: { entries: TranscriptEntry[] }) {
  return <div className="sim-transcript">{entries.length ? entries.map(entry => <article key={entry.id} data-speaker={entry.speaker}><header><strong>{entry.speaker === 'trainee' ? 'You' : 'Client'}</strong><time>{formatTime(entry.startMs / 1000)}</time></header><p>{entry.text}</p></article>) : <p className="sim-muted">The conversation will appear here.</p>}</div>;
}
export const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;

export function SimulatorConversation({ scenario, client, snapshot, phase, muted, levels, elapsed, onEnd, onMute, onAudio, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null;
  phase: 'connecting' | 'live' | 'ending'; muted: boolean; levels: { input: number; output: number }; elapsed: number;
  onEnd: () => void; onMute: () => void; onAudio: () => void; error?: string | null;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const evaluation = snapshot?.evaluation ?? null;
  const clientSpeaking = levels.output > .03;
  const traineeSpeaking = !muted && levels.input > .03;
  const caption = snapshot?.transcript.toSorted((a, b) => b.endMs - a.endMs)[0];
  const status = phase === 'connecting' ? 'Connecting to your client…' : phase === 'ending' ? 'Ending and reviewing…' : clientSpeaking ? `${client.name} is speaking` : traineeSpeaking ? 'Listening to you' : muted ? 'Microphone muted' : 'Your client is listening';
  return <section className="sim-conversation">
    <header className="sim-session-bar"><span className="eyebrow">{scenario.category}</span><h1>{scenario.title}</h1><time>{formatTime(elapsed)}<small> / {formatTime(snapshot?.limitSeconds ?? 600)}</small></time><button className="sim-end" onClick={onEnd} disabled={phase === 'ending'}>{phase === 'connecting' ? 'Cancel' : phase === 'ending' ? 'Finishing…' : 'End session'}</button></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    <div className="sim-live-grid">
      <section className="sim-client-stage"><h2>{client.name}</h2><p>{scenario.clientRole} · {client.style}</p><div className={`sim-portrait ${clientSpeaking ? 'speaking' : ''}`}><img src={client.image} alt={client.name} draggable={false} /></div><div className="sim-speaking"><i className={phase === 'connecting' || phase === 'ending' ? 'pending' : ''} />{status}</div><VoiceActivity level={Math.max(levels.output, muted ? 0 : levels.input)} active={phase === 'live'} /><div className="sim-caption">{caption && <><small>{caption.speaker === 'trainee' ? 'You' : client.name}</small><p>{caption.text}</p></>}{!caption && <p className="sim-muted">{phase === 'connecting' ? 'Review your objectives while the voice connection opens.' : 'Say hello when you are ready.'}</p>}</div><div className="sim-call-controls"><button onClick={onMute} disabled={phase !== 'live'} className={muted ? 'muted' : ''} aria-pressed={muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{muted ? 'Mic off' : 'Mic on'}</button><button onClick={() => setTranscriptOpen(value => !value)} aria-expanded={transcriptOpen}><FileText size={18} />Transcript</button><button onClick={onAudio} aria-label="Enable audio"><Volume2 size={18} /></button></div></section>
      <div className="sim-coaching"><SimulatorHint evaluation={evaluation} waiting={phase === 'connecting'} /><SimulatorObjectives scenario={scenario} evaluation={evaluation} /></div>
      <SimulatorSkills evaluation={evaluation} status={snapshot?.feedbackStatus ?? 'waiting'} />
    </div>
    {transcriptOpen && <section className="sim-transcript-panel"><header className="sim-section-heading"><h2>Conversation</h2><button className="quiet-button" onClick={() => setTranscriptOpen(false)}>Close transcript</button></header><SimulatorTranscript entries={snapshot?.transcript ?? []} /></section>}
  </section>;
}
