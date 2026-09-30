import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Clipboard, FileText, LoaderCircle, Mic, MicOff, Minus, RotateCcw, Volume2 } from 'lucide-react';
import { COVERAGE_LEVEL_LABELS, coverageConfidence, interviewReadings, interviewTopics, interviewVoices, INTERVIEWER_NAME, type InterviewBackground, type InterviewSession, type InterviewSummaryContent } from '../../core/interview';
import type { Client, FeedbackStatus, SessionSnapshot, TranscriptEntry } from '../../core/simulator/types';
import type { AudioLevels } from '../simulator/audio-levels';
import { formatTime } from '../simulator/conversation';
import { VoiceDisplay } from '../simulator/voice-display';
import type { ReportStage, StreamedReportView } from '../simulator/use-report';

export type InterviewSnapshot = SessionSnapshot;
export type InterviewVoiceId = typeof interviewVoices[number]['id'];

const portraits: Record<InterviewVoiceId, string> = {
  'sam-cedar': interviewVoices[0].image,
  'sam-gleam': interviewVoices[1].image,
};

export function samClient(voiceId: InterviewVoiceId): Client {
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

function InterviewTranscript({ entries }: { entries: TranscriptEntry[] }) {
  return <div className="sim-transcript interview-transcript">{entries.length ? entries.map(entry => <article key={entry.id} data-speaker={entry.speaker}><header><strong>{entry.speaker === 'trainee' ? 'You' : INTERVIEWER_NAME}</strong><time>{formatTime(entry.startMs / 1000)}</time></header><p>{entry.text}</p></article>) : <p className="sim-muted">The conversation will appear here.</p>}</div>;
}

function InterviewReadings({ interview, status }: { interview: InterviewSession | undefined; status: FeedbackStatus }) {
  const labels = {
    engagement: ['Limited response', 'Some response', 'Following along', 'Building the thread', 'Developing the story'],
    openness: ['Little shared', 'Brief perspective', 'Some perspective', 'Tradeoffs shared', 'Nuanced account'],
    specificity: ['General', 'Broad detail', 'Some specifics', 'Concrete', 'Rich detail'],
  };
  const readingStatus = status === 'current' ? 'Live observations' : status === 'delayed' || (status === 'unavailable' && interview?.evaluation) ? 'Latest observations' : status === 'unavailable' ? 'Observations unavailable' : 'Listening for details';
  return <section className="interview-readings sim-panel">
    <header><h2>Conversation readings</h2><span className="interview-feedback-state" data-status={status}>{readingStatus}</span></header>
    <p>These reflect what you have shared so far. A concise answer can say a lot.</p>
    <div className="interview-reading-list">{interviewReadings.map(item => {
      const reading = interview?.evaluation?.readings[item.id];
      const value = reading?.value;
      const observation = value == null ? 'Not yet observed' : labels[item.id][Math.round(Math.max(0, Math.min(4, value)))];
      return <div className="interview-reading" key={item.id}>
        <div><strong>{item.label}</strong><span>{observation}{value != null && <small className="interview-reading-score" aria-label={`score ${value.toFixed(1)} of 4`}>{value.toFixed(1)}/4</small>}</span></div>
        <small>{item.description}</small>
      </div>;
    })}</div>
    {interviewReadings.some(item => interview?.evaluation?.readings[item.id].evidence) && <details className="interview-reading-evidence"><summary>From your words</summary>{interviewReadings.map(item => {
      const evidence = interview?.evaluation?.readings[item.id].evidence;
      return evidence && <div key={item.id}><strong>{item.label}</strong><blockquote>“{evidence.text}”</blockquote></div>;
    })}</details>}
  </section>;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function InterviewTopics({ interview }: { interview: InterviewSession | undefined }) {
  const readings = new Map(interview?.evaluation?.objectives.filter(item => item.evidence).map(item => [item.id, item]) ?? []);
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

export function InterviewConversation({ voiceId, snapshot, phase, muted, levels, elapsed, onEnd, onMute, onAudio, onContinue, error }: {
  voiceId: InterviewVoiceId; snapshot: InterviewSnapshot | null; phase: 'connecting' | 'live' | 'ending';
  muted: boolean; levels: AudioLevels; elapsed: number;
  onEnd: () => void; onMute: () => void; onAudio: () => void; onContinue: () => void; error?: string | null;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptButton = useRef<HTMLButtonElement>(null);
  const transcriptPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (transcriptOpen) transcriptPanel.current?.focus(); }, [transcriptOpen]);
  const warning = phase === 'live' ? snapshot?.warning : null;
  const remaining = warning ? Math.max(0, Math.ceil((warning.endsAt - Date.now()) / 1000)) : 0;
  const automaticFinish = !!warning && warning.kind !== 'idle' && !remaining;
  const micOff = muted || phase === 'ending' || automaticFinish;
  const caption = snapshot?.transcript.toSorted((a, b) => b.endMs - a.endMs)[0];
  return <section className="interview-conversation">
    <header className="interview-session-bar"><div><h1 tabIndex={-1}>A conversation with Sam</h1></div><time aria-label={`${formatTime(elapsed)} elapsed`}>{formatTime(elapsed)} <small>elapsed</small></time><button className="interview-end" onClick={onEnd} disabled={phase === 'ending'}>{phase === 'connecting' ? 'Cancel' : phase === 'ending' ? 'Finishing…' : 'End interview'}</button></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    {warning && <div className="sim-session-warning" role="status"><div><strong>{warning.kind === 'idle' ? 'Still there?' : automaticFinish ? 'Finishing this conversation' : warning.kind === 'limit' ? 'Approaching the one-hour limit' : 'This conversation is nearly full'}</strong><p>{warning.kind === 'idle' ? `The interview will end in ${formatTime(remaining)} without activity.` : automaticFinish ? 'Your mic is off while the current reply finishes.' : `Please wrap up in ${formatTime(remaining)} before the interview ends automatically.`}</p></div>{warning.kind === 'idle' && <button onClick={onContinue}>Continue interview</button>}</div>}
    <div className="interview-live-grid">
      <div className="interview-primary">
        <div className="interview-sam-stage sim-panel"><div className="interview-sam-heading"><h2>Sam</h2><p>A thoughtful friend with good questions.</p></div><VoiceDisplay client={samClient(voiceId)} levels={levels} phase={phase} muted={micOff} compact relationship="interviewer" /><div className="interview-caption">{caption ? <><small>{caption.speaker === 'trainee' ? 'You' : 'Sam'}</small><p>{caption.text}</p></> : <p className="sim-muted">{phase === 'connecting' ? 'Opening your voice connection…' : phase === 'ending' ? 'Preparing your summary…' : 'Sam is ready when you are.'}</p>}</div>
          <div className="interview-controls" role="group" aria-label="Interview controls"><button onClick={onMute} disabled={phase !== 'live' || automaticFinish} aria-pressed={micOff} className={micOff ? 'muted' : ''}>{micOff ? <MicOff size={18} /> : <Mic size={18} />}{micOff ? 'Mic off' : 'Mic on'}</button><button ref={transcriptButton} onClick={() => setTranscriptOpen(value => !value)} aria-expanded={transcriptOpen} aria-controls="interview-live-transcript"><FileText size={18} />Transcript</button><button onClick={onAudio} disabled={phase === 'ending'}><Volume2 size={18} />Audio</button></div>
        </div>
        {transcriptOpen && <section className="interview-live-transcript sim-panel" id="interview-live-transcript" tabIndex={-1} ref={transcriptPanel}><header><h2>Conversation so far</h2><button className="quiet-button" onClick={() => { setTranscriptOpen(false); transcriptButton.current?.focus(); }}>Close</button></header><InterviewTranscript entries={snapshot?.transcript ?? []} /></section>}
        <InterviewBackgroundLive notes={snapshot?.interview?.background} />
      </div>
      <div className="interview-observations"><InterviewReadings interview={snapshot?.interview} status={phase === 'ending' && snapshot?.interview?.evaluation ? 'delayed' : snapshot?.feedbackStatus ?? 'waiting'} /><InterviewTopics interview={snapshot?.interview} /></div>
    </div>
  </section>;
}

const summaryTitles: Record<ReportStage, string> = {
  compiling: 'Putting your conversation together', writing: 'Writing your summary', completed: 'The conversation, in context',
  failed: 'The summary is unavailable', exhausted: 'The summary is unavailable', ineligible: 'Not enough conversation to summarize',
  unavailable: 'This session is no longer available', 'status-error': 'Couldn’t load your summary',
};

export function InterviewSummaryScreen({ snapshot, report, onRetrySummary, onCheckSummary, onReset, error }: {
  snapshot: InterviewSnapshot | null; report: StreamedReportView<InterviewSummaryContent>;
  onRetrySummary: () => void; onCheckSummary: () => void; onReset: () => void; error?: string | null;
}) {
  const writing = report.stage === 'compiling' || report.stage === 'writing';
  const complete = report.state.status === 'completed';
  const text = report.state.status === 'completed' ? report.state.report.text : writing ? report.draft?.text : null;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    if (!complete || !text) return;
    try { await navigator.clipboard.writeText(text); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  };
  const paragraphs = text?.trim().split(/\n\s*\n/).filter(Boolean) ?? [];
  return <section className="interview-summary">
    <header className="interview-summary-header"><h1 tabIndex={-1}>What we heard<span className="interview-title-dot">.</span></h1><p>Sam’s internal notes reflect one participant’s account of the project.</p></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    <article className="interview-summary-paper sim-panel" aria-busy={writing}><div className="interview-summary-paper-header"><h2>{summaryTitles[report.stage]}</h2>{writing && <LoaderCircle className="sim-report-spinner" size={24} aria-hidden="true" />}{complete && <button className="quiet-button" onClick={() => { void copy(); }}><Clipboard size={17} />{copyState === 'copied' ? 'Copied' : 'Copy summary'}</button>}</div>
      <span className="sim-announcement" role="status">{summaryTitles[report.stage]}</span>
      {copyState === 'failed' && <p role="status" className="sim-notice">Copy was unavailable. You can select the summary text below.</p>}
      {paragraphs.length > 0 && <div className="interview-summary-text">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}
      {!paragraphs.length && <div className="interview-summary-state"><p>{writing ? 'You can read the transcript while the summary takes shape.' : report.stage === 'status-error' ? 'Your summary may still be finishing. Check its status without starting again.' : 'Your transcript is still available below.'}</p></div>}
      {report.stage === 'status-error' && <button className="quiet-button" onClick={onCheckSummary}>Check summary</button>}
      {report.canRetry && <button className="quiet-button" onClick={onRetrySummary}><RotateCcw size={17} /> Retry summary</button>}
    </article>
    {!!snapshot?.interview?.background?.length && <details className="interview-summary-background sim-debrief-transcript"><summary>Background Sam received <ChevronDown size={18} aria-hidden="true" /></summary><p className="interview-background-context">Current public background; your account establishes what happened on the project.</p><InterviewBackgroundFacts notes={snapshot.interview.background} /></details>}
    <details className="interview-summary-transcript sim-debrief-transcript"><summary>Read the transcript <ChevronDown size={18} aria-hidden="true" /></summary><InterviewTranscript entries={snapshot?.transcript ?? []} /></details>
    <button className="arcade-button interview-new" onClick={onReset}>New interview</button>
  </section>;
}
