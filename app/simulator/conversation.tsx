import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText, Lightbulb, Mic, MicOff, RotateCcw, Volume2, WifiOff, X } from 'lucide-react';
import type { AudioLevels } from '../../interview-engine/client/audioLevels';
import { stableLink, type Link } from '../../interview-engine/client/liveConnection';
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

export type ConversationPhase = 'connecting' | 'live' | 'paused' | 'ending';

/** Shown while media is recovering on its own; nothing is lost yet. */
export function ConnectionUnstable({ link }: { link: Link }) {
  if (link.state !== 'reconnecting') return null;
  return <p className="sim-notice sim-connection-unstable" role="status">Connection unstable — reconnecting…</p>;
}

/** The current time, refreshed every second while `running`, so countdowns move without new snapshots. */
function useNow(running: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** A started conversation whose connection was lost: the server holds its transcript until it is resumed, ended, or the hold expires. */
export function ConnectionPaused({ snapshot, link, noun, endLabel, onResume, onEnd }: {
  snapshot: SessionSnapshot | null; link: Link; noun: 'interview' | 'practice'; endLabel: string; onResume: () => void; onEnd: () => void;
}) {
  const pause = snapshot?.pause;
  const resuming = link.state === 'resuming' || snapshot?.status === 'connecting';
  const exhausted = !!pause && pause.resumes >= pause.maxResumes;
  const now = useNow(!!pause);
  const remaining = pause ? Math.max(0, Math.ceil((pause.resumeBy - now) / 1000)) : null;
  const saved = `Your ${noun} is saved${remaining != null ? ` for ${formatTime(remaining)}` : ''}.`;
  const detail = resuming ? 'Reconnecting your voice connection…'
    : exhausted ? `This ${noun} has reconnected too many times. End it to keep what was captured.`
      : link.reach === 'offline' ? `Waiting for your internet connection. ${saved}`
        : link.reach === 'unanswered' ? `The server isn’t answering yet; still trying. ${saved}`
        : remaining != null ? `Everything so far is saved. Resume within ${formatTime(remaining)} to pick up where you left off.`
          : 'Everything so far is saved. Resume to pick up where you left off.';
  return <div className="sim-connection-paused" role="status" aria-busy={resuming}>
    <WifiOff size={22} aria-hidden="true" />
    <div><strong>{link.reloaded ? `Your ${noun} is paused.` : pause?.reason === 'restart' ? `The server restarted — ${noun} paused.` : `Connection lost — ${noun} paused.`}</strong><p>{detail}</p></div>
    <div className="sim-connection-actions">
      <button className="sim-resume" onClick={onResume} disabled={resuming || exhausted || link.reach === 'offline'}><RotateCcw size={17} aria-hidden="true" />{resuming ? 'Resuming…' : `Resume ${noun}`}</button>
      <button className="quiet-button" onClick={onEnd}>{endLabel}</button>
    </div>
  </div>;
}

export function SimulatorConversation({ scenario, client, snapshot, phase, muted, levels, elapsed, onEnd, onMute, onAudio, onContinue, onResume = () => {}, link = stableLink, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null;
  phase: ConversationPhase; muted: boolean; levels: AudioLevels; elapsed: number;
  onEnd: () => void; onMute: () => void; onAudio: () => void; onContinue: () => void; onResume?: () => void; link?: Link; error?: string | null;
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
  const liveHint = snapshot?.coaching;
  const concern = liveHint?.kind === 'concern';
  const [expiredHint, setExpiredHint] = useState<string | null>(null);
  useEffect(() => {
    setExpiredHint(null);
    if (!liveHint) return;
    const timer = setTimeout(() => setExpiredHint(liveHint.id), Math.max(0, liveHint.expiresAt - liveHint.createdAt));
    return () => clearTimeout(timer);
  }, [liveHint?.id, liveHint?.expiresAt]);
  const caption = snapshot?.transcript.toSorted((a, b) => b.endMs - a.endMs)[0];
  const hint = phase === 'live' && liveHint?.id !== expiredHint ? liveHint?.text : null;
  // A generated replacement and score revisions preserve the same dismissal identity.
  const hintKey = liveHint?.id ?? '';
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
    {phase === 'paused' ? <ConnectionPaused snapshot={snapshot} link={link} noun="practice" endLabel="End & see debrief" onResume={onResume} onEnd={onEnd} /> : phase === 'live' && <ConnectionUnstable link={link} />}
    {warning && <div className="sim-session-warning" role="status">
      <div><strong>{warning.kind === 'idle' ? 'Still there?' : warning.kind === 'client' ? `${client.name} ended the meeting` : automaticFinish ? 'Finishing this conversation' : warning.kind === 'limit' ? 'Approaching the one-hour limit' : 'This conversation is nearly full'}</strong>
        <p>{warning.kind === 'idle' ? `Practice will end in ${formatTime(remaining)} without activity.` : warning.kind === 'client' ? 'Your mic is off while they finish. Your debrief is next.' : automaticFinish ? 'Your mic is off while the current reply finishes.' : `Please wrap up in ${formatTime(remaining)} before practice ends automatically.`}</p></div>
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
          {!openEnded && <div className="sim-mobile-only"><SimulatorHintToast text={hintOpen ? hint! : null} concern={concern} onDismiss={dismissHint} /></div>}
        </div>
        <div className="sim-caption sim-desktop-only">{caption && <><small>{caption.speaker === 'trainee' ? 'You' : client.name}</small><p>{caption.text}</p></>}{!caption && <p className="sim-muted">{phase === 'connecting' ? 'Your voice connection is opening.' : phase === 'ending' ? 'Your conversation has ended.' : phase === 'paused' ? 'Paused until the connection returns.' : 'Say hello when you are ready.'}</p>}</div>
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
      {!openEnded && <><div className="sim-coaching"><div className="sim-desktop-only"><SimulatorHint phase={phase} liveHint={hintOpen ? liveHint! : null} onDismiss={dismissHint} /></div><SimulatorObjectives scenario={scenario} evaluation={evaluation} /></div>
      <SimulatorSkills evaluation={evaluation} status={phase === 'ending' && evaluation ? 'delayed' : snapshot?.feedbackStatus ?? 'waiting'} compact /></>}
    </div>
    {transcriptOpen && <section className="sim-transcript-panel sim-desktop-only" ref={transcriptPanel} id="sim-conversation-transcript" tabIndex={-1} aria-label="Conversation transcript"><header className="sim-section-heading"><h2>Conversation</h2><button className="quiet-button" onClick={closeTranscript}>Close transcript</button></header><SimulatorTranscript entries={snapshot?.transcript ?? []} /></section>}
  </section>;
}
