import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { emptyInterviewReadings, interviewTopics, type CoverageLevel, type InterviewBackground, type InterviewEvaluation, type InterviewSummary, type InterviewSummaryContent } from '../../core/interview';
import type { FeedbackStatus, TranscriptEntry } from '../../core/simulator/types';
import { illustrativeLevels } from './simulator-voice-story';
import { streamedReportView } from '../simulator/use-report';
import type { ReportState } from '../../core/simulator/report';
import { InterviewConversation, InterviewSetup, InterviewSummaryScreen, type InterviewSnapshot, type InterviewVoiceId } from '../interview/screens';
import type { ConversationPhase } from '../simulator/conversation';
import { stableLink, type Link } from '../simulator/live-connection';
import '../simulator/simulator.css';
import '../interview/interview.css';

export const transcript: TranscriptEntry[] = [
  { id: 's1', speaker: 'client', text: 'What was the project about? Start wherever it makes sense to you.', startMs: 0, endMs: 5300 },
  { id: 'u1', speaker: 'trainee', text: 'We built a small inspection prototype so field teams could capture notes in one place. I was the technical lead.', startMs: 5400, endMs: 14300 },
  { id: 's2', speaker: 'client', text: 'What part of that work felt most important to you?', startMs: 14600, endMs: 19000 },
  { id: 'u2', speaker: 'trainee', text: 'The useful part was watching two inspectors try it. They kept returning to the offline question, so I made sure we described offline use as something to validate, not a finished feature.', startMs: 19300, endMs: 31600 },
  { id: 's3', speaker: 'client', text: 'Was there a moment when the team had to change course?', startMs: 32000, endMs: 36000 },
  { id: 'u3', speaker: 'trainee', text: 'Yes. Access to sample records arrived late. We used a smaller synthetic set for the demo and said so plainly. That kept the meeting useful without pretending we had tested the real integration.', startMs: 36400, endMs: 50100 },
  { id: 's4', speaker: 'client', text: 'What would you carry into the next project?', startMs: 50600, endMs: 54800 },
  { id: 'u4', speaker: 'trainee', text: 'I would ask for representative records and access earlier. I am glad we were direct with the client about what the prototype had and had not proven.', startMs: 55200, endMs: 64200 },
];

const summaryText = `The interviewee described a **field-inspection prototype** intended to give inspectors one place to capture notes. They served as technical lead.

## At a glance

- **Win:** Two inspectors tried the prototype and surfaced offline use as a question to validate.
- **Friction:** Sample records arrived late; the demo used a smaller synthetic set.
- **Practice to repeat:** The team explained the prototype's limits rather than presenting real integration or offline use as proven.

## Client experience

### Friction: representative records arrived late

Access to sample records arrived late. The team demonstrated the prototype using a smaller synthetic set and made that limitation explicit to the client. The participant said this kept the meeting useful without pretending that the real integration had been tested.

**Participant suggestion:** Request representative records and access earlier on the next project.

## Internal delivery and process

### Win: honest scope and useful feedback

The participant considered watching **two inspectors** try the prototype the most useful part of the work. Both kept returning to offline use. The technical lead made sure the team described that capability as something to validate, rather than a finished feature.

> “I am glad we were direct with the client about what the prototype had and had not proven.”

### How the demo proceeded

The participant described this workaround after sample records arrived late:

\`\`\`mermaid
flowchart TD
  A["Sample records arrived late"] --> B["Use smaller synthetic set"]
  B --> C["Explain demo limits to client"]
\`\`\`

This shows the reported sequence; it does not establish that real integration was later completed.

## Delivery and contributions

| Area | Contribution or delivery state |
| --- | --- |
| Inspection prototype | Built to capture field notes in one place; described as a prototype. |
| Technical lead | Participant's role; kept offline capability framed as unvalidated. |
| Inspector feedback | Two inspectors tried the prototype and raised offline-use questions. |
| Real integration | Not proven by the synthetic-data demonstration. |

## Open questions

The interview did not establish how the client later decided to proceed.`;

function fixture(status: 'live' | 'ended', feedback: FeedbackStatus, summary: InterviewSummary | null, count = transcript.length): InterviewSnapshot {
  const entries = transcript.slice(0, count);
  const evidenceByObjective: Record<string, TranscriptEntry> = {
    'project-delivery': transcript[1]!,
    'project-role': transcript[1]!,
    'project-reflection': transcript[3]!,
    'client-access': transcript[5]!,
    'process-improve': transcript[7]!,
  };
  const has = (id: string) => entries.some(entry => entry.id === id);
  const evaluation: InterviewEvaluation = {
    revision: entries.length,
    readings: {
      ...emptyInterviewReadings(),
      engagement: has('u2') ? { value: 3.3, distribution: null, evidence: { entryId: 'u2', speaker: 'trainee', text: transcript[3]!.text } } : { value: null, distribution: null, evidence: null },
      openness: has('u3') ? { value: 2.8, distribution: null, evidence: { entryId: 'u3', speaker: 'trainee', text: transcript[5]!.text } } : { value: null, distribution: null, evidence: null },
      specificity: has('u3') ? { value: 3.5, distribution: null, evidence: { entryId: 'u3', speaker: 'trainee', text: transcript[5]!.text } } : has('u1') ? { value: 2.3, distribution: null, evidence: { entryId: 'u1', speaker: 'trainee', text: transcript[1]!.text } } : { value: null, distribution: null, evidence: null },
    },
    objectives: interviewTopics.flatMap(topic => topic.objectives.map(objective => {
      const entry = evidenceByObjective[objective.id];
      const heard = !!entry && has(entry.id);
      // One lighter band shows the difference between touched and explored.
      const level: CoverageLevel = !heard ? 'not-yet' : objective.id === 'project-reflection' ? 'touched' : 'explored';
      const explored = level === 'explored' ? .93 : level === 'touched' ? .35 : .02;
      const levels = { 'not-yet': level === 'not-yet' ? .96 : level === 'touched' ? .11 : .02, touched: level === 'touched' ? .53 : .04, explored, 'set-aside': .01 };
      return { id: objective.id, level, levels, probability: explored, achieved: level === 'explored', evidence: heard ? { entryId: entry.id, speaker: entry.speaker, text: entry.text } : null };
    })),
    model: 'workshop-fixture', durationMs: 0,
  };
  return {
    id: 'anonymous-workshop-interview', scenarioId: 'project-closeout', clientId: 'sam-cedar', status,
    startedAt: Date.now() - 50_000, limitSeconds: 3600, warning: null,
    revision: entries.length, transcript: entries, evaluation: null, coaching: null, feedbackStatus: feedback, message: null,
    finalization: status === 'ended' ? 'confirmed' : 'pending', usageSeconds: status === 'ended' ? 50 : null,
    interview: { evaluation: feedback === 'waiting' || feedback === 'unavailable' ? null : evaluation, summary },
  };
}

export function InterviewSetupStory() {
  const [voiceId, setVoiceId] = useState<InterviewVoiceId>('sam-cedar');
  const [enabled, setEnabled] = useState(true);
  const [notice, setNotice] = useState('');
  return <><div className="workshop-controls"><label className="workshop-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Live interviews available</label>{notice && <span role="status">{notice}</span>}</div><InterviewSetup voiceId={voiceId} onVoice={setVoiceId} onStart={() => setNotice('Workshop preview: no microphone or paid session was opened.')} enabled={enabled} /></>;
}

export function InterviewLiveStory() {
  const [voiceId, setVoiceId] = useState<InterviewVoiceId>('sam-cedar');
  const [callState, setCallState] = useState<keyof typeof callStates>('live');
  const { phase, link } = callStates[callState];
  const [shownAt] = useState(() => Date.now());
  const [speaking, setSpeaking] = useState('listening');
  const [frame, setFrame] = useState(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion || speaking === 'listening' || phase !== 'live') return;
    const timer = setInterval(() => setFrame(value => value + 1), 80);
    return () => clearInterval(timer);
  }, [speaking, reducedMotion, phase]);
  const [muted, setMuted] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackStatus>('current');
  const [count, setCount] = useState(6);
  const [notice, setNotice] = useState('');
  const live = fixture('live', feedback, null, count);
  const snapshot: InterviewSnapshot = phase === 'paused'
    ? { ...live, status: callState === 'resuming' ? 'connecting' : 'paused', pause: { reason: callState === 'restarted' ? 'restart' : 'provider', pausedAt: shownAt - 42_000, resumeBy: shownAt + 13 * 60_000, resumes: callState === 'exhausted' ? 5 : 1, maxResumes: 5 } }
    : live;
  return <><div className="workshop-controls"><label>Voice<select value={voiceId} onChange={event => setVoiceId(event.target.value as InterviewVoiceId)}><option value="sam-cedar">Cedar</option><option value="sam-gleam">Gleam</option></select></label><label>Call state<select value={callState} onChange={event => setCallState(event.target.value as typeof callState)}>{Object.entries(callStates).map(([value, state]) => <option key={value} value={value}>{state.label}</option>)}</select></label><label>Speaking<select value={speaking} onChange={event => setSpeaking(event.target.value)}><option value="listening">Listening</option><option value="client">Sam</option><option value="trainee">You</option><option value="overlap">Both</option></select></label><label>Observations<select value={feedback} onChange={event => setFeedback(event.target.value as FeedbackStatus)}><option value="waiting">Waiting</option><option value="current">Current</option><option value="delayed">Delayed</option><option value="unavailable">Unavailable</option></select></label><label>Transcript<select value={count} onChange={event => setCount(Number(event.target.value))}><option value="0">Empty</option><option value="2">Opening</option><option value="6">Detailed conversation</option><option value="8">Through reflection</option></select></label><label className="workshop-check"><input type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)} /> Mic muted</label>{notice && <span role="status">{notice}</span>}</div><InterviewConversation voiceId={voiceId} snapshot={snapshot} phase={phase} muted={muted} levels={illustrativeLevels(speaking, frame)} elapsed={50} onEnd={() => setNotice('Workshop preview: no live interview to end.')} onMute={() => setMuted(value => !value)} onAudio={() => setNotice('Workshop preview: audio remains off.')} onContinue={() => setNotice('Workshop preview: no live timer is running.')} onResume={() => setCallState('resuming')} link={link} /></>;
}

const callStates = {
  connecting: { label: 'Connecting', phase: 'connecting', link: stableLink },
  live: { label: 'Live', phase: 'live', link: stableLink },
  unstable: { label: 'Connection unstable', phase: 'live', link: { state: 'reconnecting', reach: 'answered' } },
  paused: { label: 'Paused', phase: 'paused', link: { state: 'paused', reach: 'answered' } },
  offline: { label: 'Paused, offline', phase: 'paused', link: { state: 'paused', reach: 'offline' } },
  unanswered: { label: 'Paused, server not answering', phase: 'paused', link: { state: 'paused', reach: 'unanswered' } },
  resuming: { label: 'Resuming', phase: 'paused', link: { state: 'resuming', reach: 'answered' } },
  exhausted: { label: 'Paused, no resumes left', phase: 'paused', link: { state: 'paused', reach: 'answered' } },
  reloaded: { label: 'Paused, page reloaded', phase: 'paused', link: { state: 'paused', reach: 'answered', reloaded: true } },
  restarted: { label: 'Paused, server restarted', phase: 'paused', link: { state: 'paused', reach: 'answered' } },
  ending: { label: 'Ending', phase: 'ending', link: stableLink },
} satisfies Record<string, { label: string; phase: ConversationPhase; link: Link }>;

const researchTranscript: TranscriptEntry[] = [
  { id: 'sam-1', speaker: 'client', text: 'What were you building on this project?', startMs: 0, endMs: 3300 },
  { id: 'you-1', speaker: 'trainee', text: 'A field mapping prototype that used OpenStreetMap. We wanted to see how inspectors could record what they found across several sites.', startMs: 3800, endMs: 12800 },
  { id: 'sam-2', speaker: 'client', text: 'What did the inspectors notice when they tried it?', startMs: 13500, endMs: 17100 },
];

// Manually authored synthetic delivery; this is not a recorded model or search result.
const researchBackground: InterviewBackground[] = [{
  id: 'synthetic-osm-background',
  target: { kind: 'product', name: 'OpenStreetMap' },
  facts: [{ text: 'OpenStreetMap is maintained by a community of mappers.', url: 'https://www.openstreetmap.org/about', title: 'About OpenStreetMap' }],
  retrievedAt: Date.UTC(2026, 8, 27, 12),
}];

function InterviewResearchStory({ delivered }: { delivered: boolean }) {
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState('');
  const snapshot: InterviewSnapshot = {
    ...fixture('live', 'waiting', null, 0),
    revision: researchTranscript.length,
    transcript: researchTranscript,
    interview: { evaluation: null, summary: null, ...(delivered ? { background: researchBackground } : {}) },
  };
  return <>
    <div className="workshop-controls"><span>Synthetic transcript · {delivered ? 'manually authored public background delivered; no model or search call' : 'lookup skipped; no public background delivered'}</span>{notice && <span role="status">{notice}</span>}</div>
    <InterviewConversation voiceId="sam-cedar" snapshot={snapshot} phase="live" muted={muted} levels={illustrativeLevels('listening', 0)} elapsed={18} onEnd={() => setNotice('Workshop preview: no live interview to end.')} onMute={() => setMuted(value => !value)} onAudio={() => setNotice('Workshop preview: audio remains off.')} onContinue={() => setNotice('Workshop preview: no live timer is running.')} />
  </>;
}

export function InterviewBackgroundDeliveredStory() { return <InterviewResearchStory delivered />; }
export function InterviewBackgroundSkippedStory() { return <InterviewResearchStory delivered={false} />; }

export function InterviewSummaryStory() {
  const [status, setStatus] = useState<'ready' | 'pending' | 'writing' | 'unavailable'>('ready');
  const [transcriptCount, setTranscriptCount] = useState(transcript.length);
  const [notice, setNotice] = useState('');
  const [length, setLength] = useState(240);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setLength(value => Math.min(summaryText.length, value + 100)), 90);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (playing && length === summaryText.length) { setPlaying(false); setStatus('ready'); }
  }, [playing, length]);
  const replay = () => { setLength(0); setStatus('writing'); setPlaying(true); };
  const state: ReportState<InterviewSummaryContent> = status === 'ready'
    ? { status: 'completed', starts: 1, report: { text: summaryText }, failure: null }
    : status === 'unavailable' ? { status: 'failed', starts: 1, report: null, failure: 'provider' }
      : { status: 'running', starts: 1, report: null, failure: null };
  const draft = status === 'writing' ? { text: summaryText.slice(0, length) } : undefined;
  const report = streamedReportView({ state, draft }, !!draft?.text);
  return <><div className="workshop-controls"><label>Summary<select value={status} onChange={event => { setPlaying(false); setStatus(event.target.value as typeof status); setLength(240); }}><option value="ready">Ready</option><option value="pending">Preparing</option><option value="writing">Writing</option><option value="unavailable">Unavailable</option></select></label><button onClick={replay}>Replay stream</button><label>Transcript<select value={transcriptCount} onChange={event => setTranscriptCount(Number(event.target.value))}><option value="0">Empty</option><option value="8">Available</option></select></label>{notice && <span role="status">{notice}</span>}</div><InterviewSummaryScreen snapshot={fixture('ended', 'current', null, transcriptCount)} report={report} onRetrySummary={replay} onCheckSummary={() => setNotice('Debugger example: no live request.')} onReset={() => setNotice('Workshop preview: no live interview was started.')} /></>;
}
