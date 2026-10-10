import type { Passage } from '../../interview-engine/shared/transcript';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowRight, Check, ChevronDown, Clipboard, FileText, LoaderCircle, Mic, MicOff, Minus, RotateCcw, Send, Volume2 } from 'lucide-react';
import { COVERAGE_LEVEL_LABELS, coverageConfidence, interviewTopics, interviewVoices, INTERVIEWER_NAME, type InterviewBackground, type InterviewEvaluation, type InterviewSummaryContent } from '../../core/interview';
import type { Client } from '../../core/simulator/types';
import type { InterviewSnapshot as EngineSnapshot } from '../../interview-engine/shared/snapshot';
import type { AudioLevels } from '../../interview-engine/client/audioLevels';
import { TYPED_TEXT_LIMIT } from '../../interview-engine/shared/protocol';
import { ConnectionPaused, ConnectionUnstable, formatTime, type ConversationPhase } from '../simulator/conversation';
import { stableLink, type Link } from '../../interview-engine/client/liveConnection';
import { VoiceDisplay } from '../simulator/voice-display';
import type { ReportStage, StreamedReportView } from '../simulator/use-report';

/** The current interview uses the engine's canonical transcript and snapshot. */
export type InterviewSnapshot = EngineSnapshot;
export type InterviewVoiceId = typeof interviewVoices[number]['id'];

const SummaryMarkdown = lazy(() => import('./summary-markdown.client'));

const portraits: Record<InterviewVoiceId, string> = {
  'sam-cedar': interviewVoices[0].image,
  'sam-gleam': interviewVoices[1].image,
};

function samClient(voiceId: InterviewVoiceId): Client {
  return {
    id: voiceId,
    name: INTERVIEWER_NAME,
    style: 'A thoughtful, curious interviewer',
    description: 'A warm listener with a journalist’s ear for the details that make a project worth remembering.',
    image: portraits[voiceId],
  };
}

export function InterviewSetup({ voiceId, onVoice, onStart, enabled = true, error }: {
  voiceId: InterviewVoiceId; onVoice: (id: InterviewVoiceId) => void; onStart: () => void;
  enabled?: boolean; error?: string | null;
}) {
  return <section className="interview-setup">
    <div className="interview-setup-copy">
      <h1 tabIndex={-1}>The Debrief<span className="interview-title-dot">.</span></h1>
      <p className="interview-lede">Talk candidly about your project. Sam turns it into clear, professional feedback.</p>
      <figure className="interview-example" aria-label="An example of candid conversation becoming professional feedback">
        <div className="interview-example-input">
          <h2>Say it your way</h2>
          <div className="interview-thoughts">
            <p>“Ugh, a week lost to logins…”</p>
            <p>“Can we sort that before kickoff?”</p>
            <p>“Pairing with Priya? So good.”</p>
          </div>
        </div>
        <div className="interview-example-flow" aria-hidden="true"><ArrowRight size={24} /><span /></div>
        <div className="interview-example-output">
          <h2><FileText size={18} aria-hidden="true" />Clear feedback</h2>
          <ul>
            <li>Arrange access before kickoff; delays cost a week.</li>
            <li>Continue pairing with Priya; it worked well.</li>
          </ul>
        </div>
      </figure>
    </div>
    <div className="interview-setup-side">
      <div className="interview-voice-choice sim-panel">
        <h2>Choose Sam’s voice</h2>
        <div className="interview-voices" role="group" aria-label="Choose Sam’s voice">
          {interviewVoices.map(voice => <button key={voice.id} type="button" aria-pressed={voiceId === voice.id} className={voiceId === voice.id ? 'selected' : ''} onClick={() => onVoice(voice.id)}><img src={portraits[voice.id]} alt="" /><strong>{voice.presentation} voice</strong><span className="interview-choice-mark" aria-hidden="true">{voiceId === voice.id && <Check size={17} />}</span></button>)}
        </div>
      </div>
      <div className="interview-start">
        {error && <p className="sim-notice error" role="alert">{error}</p>}
        {!enabled && <p className="sim-notice" role="status">Live interviews are currently unavailable. You can explore the <a href="/storybook/interview-live">Workshop preview</a>.</p>}
        <p className="interview-research-disclosure">Sam may look up public background on organizations, products, and terms you mention.</p>
        <button className="arcade-button primary" onClick={onStart} disabled={!enabled}>Start interview <Mic size={21} aria-hidden="true" /></button>
        <p>Your words are transcribed and saved privately with an internal summary. Audio is not saved.</p>
      </div>
    </div>
  </section>;
}

function InterviewTranscript({ entries, scroller, onScroll }: { entries: Passage[]; scroller?: RefObject<HTMLDivElement | null>; onScroll?: () => void }) {
  return <div className="sim-transcript interview-transcript" ref={scroller} onScroll={onScroll}>{entries.length ? entries.map(entry => <article key={entry.id} data-speaker={entry.speaker}><header><strong>{entry.speaker === 'participant' ? 'You' : INTERVIEWER_NAME}</strong><time>{formatTime(entry.startMs / 1000)}</time></header><p>{entry.text}</p></article>) : <p className="sim-muted">The conversation will appear here.</p>}</div>;
}

/**
 * Keeps a scroll container at its newest content while the reader is already near the bottom. Scrolling up to read
 * earlier passages releases it until they return near the bottom.
 */
function useStickToBottom(signature: string) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (node) pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }, []);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [signature]);
  useEffect(() => {
    // The panel changes height when typing mode starts or ends; stay on the newest passage through that.
    const node = scroller.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (pinned.current) node.scrollTop = node.scrollHeight; });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { scroller, onScroll };
}

function LiveTranscript({ entries }: { entries: Passage[] }) {
  const last = entries.at(-1);
  const { scroller, onScroll } = useStickToBottom(`${entries.length}:${last?.id ?? ''}:${last?.text.length ?? 0}`);
  return <InterviewTranscript entries={entries} scroller={scroller} onScroll={onScroll} />;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function InterviewTopics({ evaluation }: { evaluation: InterviewEvaluation | null | undefined }) {
  const readings = new Map(evaluation?.objectives.filter(item => item.evidence).map(item => [item.id, item]) ?? []);
  return <section className="interview-topics sim-panel"><header><h2>Your project story</h2><p>These are suggestions. We’ll let the conversation flow naturally.</p>
    <ul className="interview-topic-legend" aria-label="Topic marks">{(['touched', 'explored', 'set-aside'] as const).map(level => <li key={level} data-level={level}><span className="interview-topic-mark" aria-hidden="true">{level === 'explored' ? <Check size={11} /> : level === 'set-aside' ? <Minus size={11} /> : null}</span>{COVERAGE_LEVEL_LABELS[level]}</li>)}<li className="interview-topic-legend-note">% = how sure the reading is</li></ul></header>
    <div className="interview-topic-groups">{interviewTopics.map(topic => <div className="interview-topic" key={topic.id}><h3>{topic.label}</h3><ul>{topic.objectives.map(objective => {
      const reading = readings.get(objective.id);
      const level = reading?.level ?? 'not-yet';
      const confidence = coverageConfidence(reading);
      const confidenceLabel = confidence == null ? '' : `${percent(confidence)} confidence ${level === 'touched' ? 'the topic came up; depth is still uncertain' : `it is ${COVERAGE_LEVEL_LABELS[level].toLowerCase()}`}`;
      return <li key={objective.id} data-level={level} className={level === 'explored' ? 'heard' : ''}>
        <span className="interview-topic-mark" aria-hidden="true">{level === 'explored' ? <Check size={13} /> : level === 'set-aside' ? <Minus size={13} /> : null}</span>
        <span>{objective.label}<span className="sim-announcement">: {COVERAGE_LEVEL_LABELS[level]}{confidenceLabel && `, ${confidenceLabel}`}</span></span>
        {confidence != null && <small className="interview-topic-confidence" aria-hidden="true" title={confidenceLabel}>{percent(confidence)}</small>}
      </li>;
    })}</ul></div>)}</div>
  </section>;
}

function InterviewBackgroundFacts({ notes }: { notes: InterviewBackground[] }) {
  return <div className="interview-background-list">{notes.map(note => <div className="interview-background-note" key={note.id}>
    <div className="interview-background-meta"><strong>{note.target.name}</strong><time dateTime={new Date(note.retrievedAt).toISOString()}>Retrieved {new Date(note.retrievedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time></div>
    {note.facts.slice(0, 2).map((fact, index) => <p key={`${note.id}-${index}`}>{fact.text} <a href={fact.url} target="_blank" rel="noopener noreferrer">{fact.title} · {new URL(fact.url).hostname}</a></p>)}
  </div>)}</div>;
}

function InterviewBackgroundLive({ notes }: { notes: InterviewBackground[] | undefined }) {
  if (!notes?.length) return null;
  return <section className="interview-background sim-panel" aria-label="Background Sam received"><h2>Background Sam received</h2><p className="interview-background-context">Current public background; your account establishes what happened on the project.</p><InterviewBackgroundFacts notes={notes} /></section>;
}

/**
 * An optional typed answer alongside the voice conversation. A nonempty draft pauses the microphone until it is sent
 * or cleared; a failed send keeps the draft. `onDraft` lets the page ask before discarding it.
 */
function InterviewComposer({ disabled, onComposing, onSubmit, onDraft, compact = false }: {
  disabled: boolean; onComposing: (value: boolean) => void; onSubmit: (text: string) => Promise<unknown>;
  onDraft?: (draft: string) => void; compact?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Host callbacks may change identity every render; only the composing value drives reports.
  const reportComposing = useRef(onComposing);
  reportComposing.current = onComposing;
  const composing = draft.length > 0;
  useEffect(() => { reportComposing.current(composing); }, [composing]);
  useEffect(() => () => reportComposing.current(false), []);
  useEffect(() => { onDraft?.(draft); }, [draft, onDraft]);
  const canSend = draft.trim() !== '' && !disabled && pending == null;
  const root = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // The textarea is disabled while sending, which drops focus; give it back so the next answer can follow.
  const refocus = useRef(false);
  useEffect(() => {
    if (pending != null || !refocus.current) return;
    refocus.current = false;
    textarea.current?.focus();
  }, [pending]);
  async function send() {
    if (!canSend) return;
    const text = draft;
    refocus.current = !!root.current?.contains(document.activeElement);
    setPending(text);
    setError(null);
    try {
      await onSubmit(text);
      setDraft(current => current === text ? '' : current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your answer could not be sent. Try again.');
    } finally {
      setPending(null);
    }
  }
  const status = pending != null ? 'Sending…' : error ?? (composing ? 'Mic paused while typing.' : '');
  return <div className={`interview-composer${compact ? ' compact' : ''}`} ref={root}>
    <textarea ref={textarea} value={draft} placeholder="Type an answer or add a detail…" maxLength={TYPED_TEXT_LIMIT} aria-label="Typed answer" aria-describedby="interview-composer-status interview-composer-hint" enterKeyHint="send" disabled={pending != null}
      onChange={event => { setDraft(event.target.value); setError(null); }}
      onKeyDown={event => {
        // Enter (and Ctrl/Cmd+Enter) sends; Shift+Enter is a new line; an IME composition keeps its own Enter.
        if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        void send();
      }} />
    <div className="interview-composer-row">
      <div className="interview-composer-note">
        <p className="interview-composer-status" id="interview-composer-status" role="status" data-error={error != null && pending == null ? '' : undefined}>{status}</p>
        {!status && <p className="interview-composer-hint" id="interview-composer-hint">Enter to send · Shift+Enter for a new line</p>}
      </div>
      <button type="button" className="quiet-button" onClick={() => { textarea.current?.focus(); setDraft(''); setError(null); }} disabled={!draft || pending != null}>Clear</button>
      <button type="button" className="interview-composer-send" onClick={() => { void send(); }} disabled={!canSend}><Send size={16} aria-hidden="true" />Send</button>
    </div>
  </div>;
}

export function InterviewConversation({ voiceId, snapshot, phase, muted, levels, elapsed, onEnd, onMute, onAudio, onContinue, onResume = () => {}, onComposing, onSubmitText, link = stableLink, error }: {
  voiceId: InterviewVoiceId; snapshot: InterviewSnapshot | null; phase: ConversationPhase;
  muted: boolean; levels: AudioLevels; elapsed: number;
  onEnd: () => void; onMute: () => void; onAudio: () => void; onContinue: () => void; onResume?: () => void;
  /** Both present show the typed-answer composer. */
  onComposing?: (value: boolean) => void; onSubmitText?: (text: string) => Promise<unknown>;
  link?: Link; error?: string | null;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const draft = useRef('');
  const [hasDraft, setHasDraft] = useState(false);
  const trackDraft = useCallback((value: string) => { draft.current = value; setHasDraft(value !== ''); }, []);
  // Typing mode: focus entered the composer, or a draft exists. Focus anywhere in the primary column (the transcript,
  // the compact Sam controls) keeps it, so reading back or toggling the mic does not collapse the layout.
  const [typingFocus, setTypingFocus] = useState(false);
  const typing = typingFocus || hasDraft;
  const [typingTranscriptHidden, setTypingTranscriptHidden] = useState(false);
  const showTranscript = typing ? !typingTranscriptHidden : transcriptOpen;
  const primary = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Fit the typing layout between the primary column's top and the bottom of the viewport. If the page was scrolled
    // past the column (or the column starts low), bring it to a usable top once, before any typing happens.
    const node = primary.current;
    if (!typing || !node) return;
    const fit = () => {
      const top = node.getBoundingClientRect().top;
      // On phones the session bar sticks to the top; start below it.
      const bar = node.closest('.interview-conversation')?.querySelector<HTMLElement>('.interview-session-bar');
      const floor = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom + 8 : 12;
      const fitted = Math.round(Math.min(Math.max(top, floor), window.innerHeight * .4));
      node.style.setProperty('--typing-top', `${fitted}px`);
      if (Math.abs(top - fitted) > 1) window.scrollBy(0, top - fitted);
      // The page cannot always scroll that far (short pages, column near the end): shrink the column so it still
      // fits the viewport where it actually landed.
      const settled = node.getBoundingClientRect().top;
      if (settled > fitted + 1) node.style.setProperty('--typing-top', `${Math.round(settled)}px`);
      else if (settled < fitted - 1) node.style.setProperty('--typing-top', `${Math.round(2 * fitted - settled)}px`);
    };
    fit();
    // A resized window (or a phone keyboard changing the viewport) refits the column.
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [typing]);
  const focusComposer = () => primary.current?.querySelector<HTMLTextAreaElement>('.interview-composer textarea')?.focus();
  const toggleTranscript = () => typing ? setTypingTranscriptHidden(value => !value) : setTranscriptOpen(value => !value);
  const closeTranscript = () => {
    if (typing) { setTypingTranscriptHidden(true); focusComposer(); return; }
    setTranscriptOpen(false);
    transcriptButton.current?.focus();
  };
  // Ending never submits a draft; it asks before discarding one.
  const end = () => { if (draft.current && !window.confirm('Discard your unsent typed answer and end the interview?')) return; onEnd(); };
  const transcriptButton = useRef<HTMLButtonElement>(null);
  const transcriptPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (transcriptOpen) transcriptPanel.current?.focus(); }, [transcriptOpen]);
  const warning = phase === 'live' ? snapshot?.warning : null;
  const remaining = warning ? Math.max(0, Math.ceil((warning.endsAt - Date.now()) / 1000)) : 0;
  const automaticFinish = !!warning && warning.kind !== 'idle' && !remaining;
  const micOff = muted || phase === 'ending' || automaticFinish;
  const caption = snapshot?.transcript.toSorted((a, b) => b.endMs - a.endMs)[0];
  return <section className="interview-conversation">
    <header className="interview-session-bar"><div><h1 tabIndex={-1}>A conversation with Sam</h1></div><time aria-label={`${formatTime(elapsed)} elapsed`}>{formatTime(elapsed)} <small>elapsed</small></time><button className="interview-end" onClick={end} disabled={phase === 'ending'}>{phase === 'connecting' ? 'Cancel' : phase === 'ending' ? 'Finishing…' : 'End interview'}</button></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    {phase === 'paused' ? <ConnectionPaused snapshot={snapshot} link={link} noun="interview" endLabel="End & get summary" onResume={onResume} onEnd={end} /> : phase === 'live' && <ConnectionUnstable link={link} />}
    {warning && <div className="sim-session-warning" role="status"><div><strong>{warning.kind === 'idle' ? 'Still there?' : automaticFinish ? 'Finishing this conversation' : warning.kind === 'limit' ? 'Approaching the one-hour limit' : 'This conversation is nearly full'}</strong><p>{warning.kind === 'idle' ? `The interview will end in ${formatTime(remaining)} without activity.` : automaticFinish ? 'Your mic is off while the current reply finishes.' : `Please wrap up in ${formatTime(remaining)} before the interview ends automatically.`}</p></div>{warning.kind === 'idle' && <button onClick={onContinue}>Continue interview</button>}</div>}
    <div className="interview-live-grid">
      <div className="interview-primary" ref={primary} data-mode={typing ? 'typing' : 'voice'} data-transcript={showTranscript ? 'open' : 'closed'}
        onFocus={event => { if ((event.target as Element).closest('.interview-composer')) setTypingFocus(true); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTypingFocus(false); }}>
        {/* While typing, pressing the compact strip keeps focus where it is so the layout does not shift under the pointer. */}
        <div className="interview-sam-stage sim-panel" onMouseDown={event => { if (typing) event.preventDefault(); }}><div className="interview-sam-heading"><h2>Sam</h2><p>A thoughtful friend with good questions.</p></div><VoiceDisplay client={samClient(voiceId)} levels={levels} phase={phase} muted={micOff} compact relationship="interviewer" /><div className="interview-caption">{caption ? <><small>{caption.speaker === 'participant' ? 'You' : 'Sam'}</small><p>{caption.text}</p></> : <p className="sim-muted">{phase === 'connecting' ? 'Opening your voice connection…' : phase === 'ending' ? 'Preparing your summary…' : phase === 'paused' ? 'Paused until the connection returns.' : 'Sam is ready when you are.'}</p>}</div>
          <div className="interview-controls" role="group" aria-label="Interview controls"><button onClick={onMute} disabled={phase !== 'live' || automaticFinish} aria-pressed={micOff} className={micOff ? 'muted' : ''} title={typing ? micOff ? 'Mic off' : 'Mic on' : undefined}>{micOff ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}<span className="interview-control-label">{micOff ? 'Mic off' : 'Mic on'}</span></button><button ref={transcriptButton} onClick={toggleTranscript} aria-expanded={showTranscript} aria-controls="interview-live-transcript" title={typing ? 'Transcript' : undefined}><FileText size={18} aria-hidden="true" /><span className="interview-control-label">Transcript</span></button><button onClick={onAudio} disabled={phase === 'ending'} title={typing ? 'Audio' : undefined}><Volume2 size={18} aria-hidden="true" /><span className="interview-control-label">Audio</span></button></div>
        </div>
        {onComposing && onSubmitText && <InterviewComposer disabled={phase !== 'live' || automaticFinish} onComposing={onComposing} onSubmit={onSubmitText} onDraft={trackDraft} />}
        {showTranscript && <section className="interview-live-transcript sim-panel" id="interview-live-transcript" tabIndex={-1} ref={transcriptPanel}><header><h2>Conversation so far</h2><button className="quiet-button" onClick={closeTranscript}>{typing ? 'Hide' : 'Close'}</button></header><LiveTranscript entries={snapshot?.transcript ?? []} /></section>}
        <InterviewBackgroundLive notes={snapshot?.background} />
      </div>
      <div className="interview-observations"><InterviewTopics evaluation={snapshot?.evaluation} /></div>
    </div>
  </section>;
}

const summaryTitles: Record<ReportStage, string> = {
  compiling: 'Putting your conversation together', writing: 'Writing your summary', completed: 'The conversation, in context',
  failed: 'The summary is unavailable', exhausted: 'The summary is unavailable', ineligible: 'Not enough conversation to summarize',
  unavailable: 'This session is no longer available', 'status-error': 'Couldn’t load your summary',
};

export function InterviewSummaryScreen({ snapshot, report, onRetrySummary, onCheckSummary, onReset, error }: {
  snapshot: InterviewSnapshot | null; report: StreamedReportView<InterviewSummaryContent, InterviewSnapshot>;
  onRetrySummary: () => void; onCheckSummary: () => void; onReset: () => void; error?: string | null;
}) {
  const writing = report.stage === 'compiling' || report.stage === 'writing';
  const complete = report.state.status === 'completed';
  const text = report.state.status === 'completed' ? report.state.report.text : writing ? report.draft?.text : null;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const copy = async () => {
    if (!complete || !text) return;
    try { await navigator.clipboard.writeText(text); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  };
  return <section className="interview-summary">
    <header className="interview-summary-header"><h1 tabIndex={-1}>What we heard<span className="interview-title-dot">.</span></h1><p>Sam’s internal notes reflect one participant’s account of the project.</p></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    <article className="interview-summary-paper sim-panel" aria-busy={writing}><div className="interview-summary-paper-header"><h2>{summaryTitles[report.stage]}</h2>{writing && <LoaderCircle className="sim-report-spinner" size={24} aria-hidden="true" />}{complete && <button className="quiet-button" onClick={() => { void copy(); }}><Clipboard size={17} />{copyState === 'copied' ? 'Copied' : 'Copy summary'}</button>}</div>
      <span className="sim-announcement" role="status">{summaryTitles[report.stage]}</span>
      {copyState === 'failed' && <p role="status" className="sim-notice">Copy was unavailable. You can select the summary text below.</p>}
      {text?.trim() ? <Suspense fallback={<p className="interview-summary-text">Loading summary formatting…</p>}>{mounted && <SummaryMarkdown text={text} writing={writing} />}</Suspense>
        : <div className="interview-summary-state"><p>{writing ? 'You can read the transcript while the summary takes shape.' : report.stage === 'status-error' ? 'Your summary may still be finishing. Check its status without starting again.' : 'Your transcript is still available below.'}</p></div>}
      {report.stage === 'status-error' && <button className="quiet-button" onClick={onCheckSummary}>Check summary</button>}
      {report.canRetry && <button className="quiet-button" onClick={onRetrySummary}><RotateCcw size={17} /> Retry summary</button>}
    </article>
    {!!snapshot?.background.length && <details className="interview-summary-background sim-debrief-transcript"><summary>Background Sam received <ChevronDown size={18} aria-hidden="true" /></summary><p className="interview-background-context">Current public background; your account establishes what happened on the project.</p><InterviewBackgroundFacts notes={snapshot.background} /></details>}
    <details className="interview-summary-transcript sim-debrief-transcript"><summary>Read the transcript <ChevronDown size={18} aria-hidden="true" /></summary><InterviewTranscript entries={snapshot?.transcript ?? []} /></details>
    <button className="arcade-button interview-new" onClick={onReset}>New interview</button>
  </section>;
}
