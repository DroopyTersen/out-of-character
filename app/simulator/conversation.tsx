import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText, Lightbulb, Mic, MicOff, Volume2, X } from 'lucide-react';
import type { AudioLevels } from './audio-levels';
import { VoiceDisplay } from './voice-display';
import type { Client, ScenarioSummary, SessionSnapshot, TranscriptEntry } from '../../core/simulator/types';
import { SimulatorHint, SimulatorHintToast, SimulatorObjectives, SimulatorSkills } from './feedback';
import { SessionBrief } from './session-brief';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../shadcn/components/ui/dialog';

export function SimulatorTranscript({ entries, startAtEnd = false }: { entries: TranscriptEntry[]; startAtEnd?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { if (startAtEnd && container.current) container.current.scrollTop = container.current.scrollHeight; }, [startAtEnd]);
  return <div className="sim-transcript" ref={container}>{entries.length ? entries.map(entry => <article key={entry.id} data-speaker={entry.speaker}><header><strong>{entry.speaker === 'trainee' ? 'You' : 'Client'}</strong><time>{formatTime(entry.startMs / 1000)}</time></header><p>{entry.text}</p></article>) : <p className="sim-muted">The conversation will appear here.</p>}</div>;
}
export const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;

export function SimulatorConversation({ scenario, client, snapshot, phase, muted, levels, elapsed, onEnd, onMute, onAudio, onContinue, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null;
  phase: 'connecting' | 'live' | 'ending'; muted: boolean; levels: AudioLevels; elapsed: number;
  onEnd: () => void; onMute: () => void; onAudio: () => void; onContinue?: () => void; error?: string | null;
}) {
  const openEnded = scenario.objectives.length === 0;
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptButton = useRef<HTMLButtonElement>(null);
  const transcriptPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (transcriptOpen) transcriptPanel.current?.focus(); }, [transcriptOpen]);
  const closeTranscript = () => { setTranscriptOpen(false); transcriptButton.current?.focus(); };
  const [dismissedHints, setDismissedHints] = useState<string[]>([]);
  const hintButton = useRef<HTMLButtonElement>(null);
  const warning = phase === 'live' ? snapshot?.warning : null;
  const remaining = warning ? Math.max(0, Math.ceil((warning.endsAt - Date.now()) / 1000)) : 0;
  const automaticFinish = !!warning && warning.kind !== 'idle' && !remaining;
  const micOff = muted || phase === 'ending' || automaticFinish;
  const evaluation = openEnded ? null : snapshot?.evaluation ?? null;
  const concern = evaluation?.concern;
  const feedbackStatus = snapshot?.feedbackStatus;
  // A cleared concern can become relevant again; score-only updates cannot reopen it.
  useEffect(() => {
    if (feedbackStatus === 'current' && concern === null) setDismissedHints(previous => previous.filter(key => !key.startsWith('concern:')));
  }, [concern, feedbackStatus]);
  const caption = snapshot?.transcript.toSorted((a, b) => b.endMs - a.endMs)[0];
  const hint = phase === 'live' && snapshot?.feedbackStatus !== 'unavailable' ? evaluation?.concern ?? evaluation?.hint : null;
  // Authored hint identity survives new score revisions and temporary observation gaps.
  const hintKey = evaluation?.concern ? `concern:${evaluation.concern}` : `hint:${evaluation?.hintId ?? hint}`;
  const hintOpen = !!hint && !dismissedHints.includes(hintKey);
  const dismissHint = () => {
    setDismissedHints(previous => [...previous, hintKey]);
    hintButton.current?.focus();
  };
  const endLabel = phase === 'connecting' ? 'Cancel' : phase === 'ending' ? 'Finishing…' : 'End session';
  return <section className="sim-conversation">
    <header className="sim-session-bar">
      <span className="eyebrow">{scenario.category}</span><h1 tabIndex={-1}>{scenario.title}</h1>
      <time aria-label={`${formatTime(elapsed)} elapsed`}>{formatTime(elapsed)}<small> elapsed</small></time>
      <button className="sim-end sim-desktop-only" onClick={onEnd} disabled={phase === 'ending'}>{endLabel}</button>
    </header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    {warning && <div className="sim-session-warning" role="status">
      <div><strong>{warning.kind === 'idle' ? 'Still there?' : automaticFinish ? 'Finishing this conversation' : warning.kind === 'limit' ? 'Approaching the one-hour limit' : 'This conversation is nearly full'}</strong>
        <p>{warning.kind === 'idle' ? `Practice will end in ${formatTime(remaining)} without activity.` : automaticFinish ? 'Your mic is off while the current reply finishes.' : `Please wrap up in ${formatTime(remaining)} before practice ends automatically.`}</p></div>
      {warning.kind === 'idle' && <button onClick={onContinue}>Continue practice</button>}
    </div>}
    <div className="sim-live-grid" data-open-ended={openEnded || undefined}>
      <section className="sim-client-stage">
        <div className="sim-client-area">
          <h2>{client.name}</h2><p className="sim-client-role">{scenario.clientRole}<span className="sim-desktop-only"> · {client.style}</span></p>
          <VoiceDisplay client={client} levels={levels} phase={phase} muted={micOff} compact />
          <Dialog>
            <DialogTrigger asChild><button className="sim-open-brief sim-mobile-only" aria-label="Open session brief"><span>Brief <ChevronRight size={18} aria-hidden="true" /></span></button></DialogTrigger>
            <SessionBrief scenario={scenario} client={client} />
          </Dialog>
          {!openEnded && <div className="sim-mobile-only"><SimulatorHintToast text={hintOpen ? hint : null} concern={!!evaluation?.concern} delayed={snapshot?.feedbackStatus === 'delayed'} onDismiss={dismissHint} /></div>}
        </div>
        <div className="sim-caption sim-desktop-only">{caption && <><small>{caption.speaker === 'trainee' ? 'You' : client.name}</small><p>{caption.text}</p></>}{!caption && <p className="sim-muted">{phase === 'connecting' ? 'Your voice connection is opening.' : phase === 'ending' ? 'Your conversation has ended.' : 'Say hello when you are ready.'}</p>}</div>
        <div className="sim-call-controls" role="group" aria-label="Call controls">
          <button onClick={onMute} disabled={phase !== 'live' || automaticFinish} className={micOff ? 'muted' : ''} aria-pressed={micOff}>{micOff ? <MicOff size={18} /> : <Mic size={18} />}{micOff ? 'Mic off' : 'Mic on'}</button>
          <button className="sim-desktop-only" ref={transcriptButton} onClick={() => setTranscriptOpen(value => !value)} aria-expanded={transcriptOpen} aria-controls={transcriptOpen ? 'sim-conversation-transcript' : undefined}><FileText size={18} />Transcript</button>
          <Dialog>
            <DialogTrigger asChild><button className="sim-mobile-only"><FileText size={18} />Transcript</button></DialogTrigger>
            <DialogContent className="sim-dialog sim-transcript-panel" showCloseButton={false}>
              <header className="sim-dialog-header"><DialogTitle><span className="sim-announcement">Conversation </span>Transcript</DialogTitle><DialogClose className="quiet-button" aria-label="Close transcript"><X size={22} /></DialogClose></header>
              <DialogDescription>The conversation so far. Your session continues while this is open.</DialogDescription>
              <SimulatorTranscript entries={snapshot?.transcript ?? []} startAtEnd />
            </DialogContent>
          </Dialog>
          <button onClick={onAudio} disabled={phase === 'ending'} aria-label="Enable audio"><Volume2 size={18} /></button>
          {!openEnded && <button ref={hintButton} className="sim-hint-button sim-mobile-only" aria-label={hintOpen ? 'Hide live hint' : 'Show live hint'} aria-expanded={hintOpen} disabled={!hint} onClick={() => hintOpen ? dismissHint() : setDismissedHints(previous => previous.filter(key => key !== hintKey))}><Lightbulb size={18} /></button>}
          <button className="sim-end sim-mobile-only" onClick={onEnd} disabled={phase === 'ending'} aria-label={endLabel}>{phase === 'live' ? 'End' : endLabel}</button>
        </div>
      </section>
      {!openEnded && <><div className="sim-coaching"><div className="sim-desktop-only"><SimulatorHint evaluation={evaluation} phase={phase} status={snapshot?.feedbackStatus} /></div><SimulatorObjectives scenario={scenario} evaluation={evaluation} /></div>
      <SimulatorSkills evaluation={evaluation} status={phase === 'ending' && evaluation ? 'delayed' : snapshot?.feedbackStatus ?? 'waiting'} compact /></>}
    </div>
    {transcriptOpen && <section className="sim-transcript-panel sim-desktop-only" ref={transcriptPanel} id="sim-conversation-transcript" tabIndex={-1} aria-label="Conversation transcript"><header className="sim-section-heading"><h2>Conversation</h2><button className="quiet-button" onClick={closeTranscript}>Close transcript</button></header><SimulatorTranscript entries={snapshot?.transcript ?? []} /></section>}
  </section>;
}
