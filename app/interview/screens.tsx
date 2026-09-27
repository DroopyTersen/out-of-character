import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clipboard, FileText, Mic, MicOff, Volume2 } from 'lucide-react';
import { interviewReadings, interviewTopics, interviewVoices, INTERVIEWER_NAME, type InterviewSession } from '../../core/interview';
import type { Client, FeedbackStatus, SessionSnapshot, TranscriptEntry } from '../../core/simulator/types';
import type { AudioLevels } from '../simulator/audio-levels';
import { formatTime } from '../simulator/conversation';
import { VoiceDisplay } from '../simulator/voice-display';

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
      <p className="interview-lede">Talk through a real project: what you built, how it went, and what the next team should know.</p>
      <div className="interview-intro"><span className="interview-intro-mark" aria-hidden="true">“</span><p>What’s the story about this project that never made it into a status report?</p><small>Sam</small></div>
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
        <div><strong>{item.label}</strong><span>{observation}</span></div>
        <small>{item.description}</small>
      </div>;
    })}</div>
    {interviewReadings.some(item => interview?.evaluation?.readings[item.id].evidence) && <details className="interview-reading-evidence"><summary>From your words</summary>{interviewReadings.map(item => {
      const evidence = interview?.evaluation?.readings[item.id].evidence;
      return evidence && <div key={item.id}><strong>{item.label}</strong><blockquote>“{evidence.text}”</blockquote></div>;
    })}</details>}
  </section>;
}

function InterviewTopics({ interview }: { interview: InterviewSession | undefined }) {
  const heard = new Set(interview?.evaluation?.objectives.filter(item => item.achieved && item.evidence).map(item => item.id) ?? []);
  return <section className="interview-topics sim-panel"><header><h2>Your project story</h2><p>Topics can come up in any order. There is no checklist to finish.</p></header>
    <div className="interview-topic-groups">{interviewTopics.map(topic => <div className="interview-topic" key={topic.id}><h3>{topic.label}</h3><ul>{topic.objectives.map(objective => <li key={objective.id} className={heard.has(objective.id) ? 'heard' : ''}><span className="interview-topic-mark" aria-hidden="true">{heard.has(objective.id) && <Check size={13} />}</span><span>{objective.label}</span></li>)}</ul></div>)}</div>
  </section>;
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
      </div>
      <div className="interview-observations"><InterviewReadings interview={snapshot?.interview} status={phase === 'ending' && snapshot?.interview?.evaluation ? 'delayed' : snapshot?.feedbackStatus ?? 'waiting'} /><InterviewTopics interview={snapshot?.interview} /></div>
    </div>
  </section>;
}

export function InterviewSummaryScreen({ snapshot, onReset, error }: { snapshot: InterviewSnapshot | null; onReset: () => void; error?: string | null }) {
  const summary = snapshot?.interview?.summary;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    if (!summary?.text) return;
    try { await navigator.clipboard.writeText(summary.text); setCopyState('copied'); }
    catch { setCopyState('failed'); }
  };
  const paragraphs = summary?.text?.trim().split(/\n\s*\n/).filter(Boolean) ?? [];
  return <section className="interview-summary">
    <header className="interview-summary-header"><h1 tabIndex={-1}>What we heard<span className="interview-title-dot">.</span></h1><p>Sam’s internal notes reflect one participant’s account of the project.</p></header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    <article className="interview-summary-paper sim-panel"><div className="interview-summary-paper-header"><h2>{summary?.status === 'ready' ? 'The conversation, in context' : 'Your summary'}</h2>{summary?.status === 'ready' && <button className="quiet-button" onClick={() => { void copy(); }}><Clipboard size={17} />{copyState === 'copied' ? 'Copied' : 'Copy summary'}</button>}</div>
      {copyState === 'failed' && <p role="status" className="sim-notice">Copy was unavailable. You can select the summary text below.</p>}
      {summary?.status === 'ready' && paragraphs.length ? <div className="interview-summary-text">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> : <div className="interview-summary-state" role="status"><strong>{summary?.status === 'unavailable' ? 'The summary is unavailable' : 'Sam is putting your conversation together.'}</strong><p>{summary?.status === 'unavailable' ? 'Open the transcript below.' : 'This can take a moment after the voice call ends. You can read the transcript while it finishes.'}</p></div>}
    </article>
    <details className="interview-summary-transcript sim-debrief-transcript"><summary>Read the transcript <ChevronDown size={18} aria-hidden="true" /></summary><InterviewTranscript entries={snapshot?.transcript ?? []} /></details>
    <button className="arcade-button interview-new" onClick={onReset}>New interview</button>
  </section>;
}
