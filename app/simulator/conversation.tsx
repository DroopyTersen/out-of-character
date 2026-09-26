import { useEffect, useRef, useState } from 'react';
import { FileText, Mic, MicOff, Volume2 } from 'lucide-react';
import type { AudioLevels } from './audio-levels';
import { VoiceDisplay } from './voice-display';
import type { Client, ScenarioSummary, SessionSnapshot, TranscriptEntry } from '../../core/simulator/types';
import { SimulatorHint, SimulatorObjectives, SimulatorSkills } from './feedback';

export function SimulatorTranscript({ entries }: { entries: TranscriptEntry[] }) {
  return <div className="sim-transcript">{entries.length ? entries.map(entry => <article key={entry.id} data-speaker={entry.speaker}><header><strong>{entry.speaker === 'trainee' ? 'You' : 'Client'}</strong><time>{formatTime(entry.startMs / 1000)}</time></header><p>{entry.text}</p></article>) : <p className="sim-muted">The conversation will appear here.</p>}</div>;
}
export const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;

export function SimulatorConversation({ scenario, client, snapshot, phase, muted, levels, elapsed, onEnd, onMute, onAudio, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null;
  phase: 'connecting' | 'live' | 'ending'; muted: boolean; levels: AudioLevels; elapsed: number;
  onEnd: () => void; onMute: () => void; onAudio: () => void; error?: string | null;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptButton = useRef<HTMLButtonElement>(null);
  const transcriptPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (transcriptOpen) transcriptPanel.current?.focus(); }, [transcriptOpen]);
  const closeTranscript = () => { setTranscriptOpen(false); transcriptButton.current?.focus(); };
  const micOff = muted || phase === 'ending';
  const evaluation = snapshot?.evaluation ?? null;
  const caption = snapshot?.transcript.toSorted((a, b) => b.endMs - a.endMs)[0];
  return <section className="sim-conversation">
    <header className="sim-session-bar"><span className="eyebrow">{scenario.category}</span><h1 tabIndex={-1}>{scenario.title}</h1><time>{formatTime(elapsed)}<small> / {formatTime(snapshot?.limitSeconds ?? 600)}</small></time><button className="sim-end" onClick={onEnd} disabled={phase === 'ending'}>{phase === 'connecting' ? 'Cancel' : phase === 'ending' ? 'Finishing…' : 'End session'}</button></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    <div className="sim-live-grid">
      <section className="sim-client-stage"><h2>{client.name}</h2><p>{scenario.clientRole} · {client.style}</p><VoiceDisplay client={client} levels={levels} phase={phase} muted={micOff} /><div className="sim-caption">{caption && <><small>{caption.speaker === 'trainee' ? 'You' : client.name}</small><p>{caption.text}</p></>}{!caption && <p className="sim-muted">{phase === 'connecting' ? 'Review your objectives while the voice connection opens.' : phase === 'ending' ? 'Your conversation has ended.' : 'Say hello when you are ready.'}</p>}</div><div className="sim-call-controls"><button onClick={onMute} disabled={phase !== 'live'} className={micOff ? 'muted' : ''} aria-pressed={micOff}>{micOff ? <MicOff size={18} /> : <Mic size={18} />}{micOff ? 'Mic off' : 'Mic on'}</button><button ref={transcriptButton} onClick={() => setTranscriptOpen(value => !value)} aria-expanded={transcriptOpen} aria-controls={transcriptOpen ? 'sim-conversation-transcript' : undefined}><FileText size={18} />Transcript</button><button onClick={onAudio} disabled={phase === 'ending'} aria-label="Enable audio"><Volume2 size={18} /></button></div></section>
      <div className="sim-coaching"><SimulatorHint evaluation={evaluation} phase={phase} status={snapshot?.feedbackStatus} /><SimulatorObjectives scenario={scenario} evaluation={evaluation} /></div>
      <SimulatorSkills evaluation={evaluation} status={phase === 'ending' && evaluation ? 'delayed' : snapshot?.feedbackStatus ?? 'waiting'} />
    </div>
    {transcriptOpen && <section className="sim-transcript-panel" ref={transcriptPanel} id="sim-conversation-transcript" tabIndex={-1} aria-label="Conversation transcript"><header className="sim-section-heading"><h2>Conversation</h2><button className="quiet-button" onClick={closeTranscript}>Close transcript</button></header><SimulatorTranscript entries={snapshot?.transcript ?? []} /></section>}
  </section>;
}
