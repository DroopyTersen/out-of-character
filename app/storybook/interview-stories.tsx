import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { emptyInterviewReadings, interviewTopics, type InterviewEvaluation, type InterviewSummary, type InterviewSummaryContent } from '../../core/interview';
import type { FeedbackStatus, TranscriptEntry } from '../../core/simulator/types';
import { illustrativeLevels } from './simulator-voice-story';
import { streamedReportView } from '../simulator/use-report';
import type { ReportState } from '../../core/simulator/report';
import { InterviewConversation, InterviewSetup, InterviewSummaryScreen, type InterviewSnapshot, type InterviewVoiceId } from '../interview/screens';
import '../simulator/simulator.css';
import '../interview/interview.css';

const transcript: TranscriptEntry[] = [
  { id: 's1', speaker: 'client', text: 'What was the project about? Start wherever it makes sense to you.', startMs: 0, endMs: 5300 },
  { id: 'u1', speaker: 'trainee', text: 'We built a small inspection prototype so field teams could capture notes in one place. I was the technical lead.', startMs: 5400, endMs: 14300 },
  { id: 's2', speaker: 'client', text: 'What part of that work felt most important to you?', startMs: 14600, endMs: 19000 },
  { id: 'u2', speaker: 'trainee', text: 'The useful part was watching two inspectors try it. They kept returning to the offline question, so I made sure we described offline use as something to validate, not a finished feature.', startMs: 19300, endMs: 31600 },
  { id: 's3', speaker: 'client', text: 'Was there a moment when the team had to change course?', startMs: 32000, endMs: 36000 },
  { id: 'u3', speaker: 'trainee', text: 'Yes. Access to sample records arrived late. We used a smaller synthetic set for the demo and said so plainly. That kept the meeting useful without pretending we had tested the real integration.', startMs: 36400, endMs: 50100 },
  { id: 's4', speaker: 'client', text: 'What would you carry into the next project?', startMs: 50600, endMs: 54800 },
  { id: 'u4', speaker: 'trainee', text: 'I would ask for representative records and access earlier. I am glad we were direct with the client about what the prototype had and had not proven.', startMs: 55200, endMs: 64200 },
];

const summaryText = `The interviewee described a small field-inspection prototype intended to give inspectors one place to capture notes. They served as technical lead. In their account, seeing two inspectors try the prototype was the most useful part of the work: both returned to the question of offline use. The team treated offline capability as something still to validate, rather than a delivered feature.\n\nAccess to sample records arrived late, so the team used a smaller synthetic data set in the demonstration. The interviewee said they made that limitation explicit in the meeting. This kept the demonstration useful while leaving real-system integration open.\n\nFor a similar project, the interviewee would seek representative data and access earlier. They were pleased with the team’s candor about what the prototype had and had not proven. The interview did not establish how the client later decided to proceed.`;

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
      const achieved = !!entry && has(entry.id);
      return { id: objective.id, probability: achieved ? .95 : null, achieved, evidence: achieved ? { entryId: entry.id, speaker: entry.speaker, text: entry.text } : null };
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
  const [phase, setPhase] = useState<'connecting' | 'live' | 'ending'>('live');
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
  const snapshot = fixture('live', feedback, null, count);
  return <><div className="workshop-controls"><label>Voice<select value={voiceId} onChange={event => setVoiceId(event.target.value as InterviewVoiceId)}><option value="sam-cedar">Cedar</option><option value="sam-gleam">Gleam</option></select></label><label>Call state<select value={phase} onChange={event => setPhase(event.target.value as typeof phase)}><option value="connecting">Connecting</option><option value="live">Live</option><option value="ending">Ending</option></select></label><label>Speaking<select value={speaking} onChange={event => setSpeaking(event.target.value)}><option value="listening">Listening</option><option value="client">Sam</option><option value="trainee">You</option><option value="overlap">Both</option></select></label><label>Observations<select value={feedback} onChange={event => setFeedback(event.target.value as FeedbackStatus)}><option value="waiting">Waiting</option><option value="current">Current</option><option value="delayed">Delayed</option><option value="unavailable">Unavailable</option></select></label><label>Transcript<select value={count} onChange={event => setCount(Number(event.target.value))}><option value="0">Empty</option><option value="2">Opening</option><option value="6">Detailed conversation</option><option value="8">Through reflection</option></select></label><label className="workshop-check"><input type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)} /> Mic muted</label>{notice && <span role="status">{notice}</span>}</div><InterviewConversation voiceId={voiceId} snapshot={snapshot} phase={phase} muted={muted} levels={illustrativeLevels(speaking, frame)} elapsed={50} onEnd={() => setNotice('Workshop preview: no live interview to end.')} onMute={() => setMuted(value => !value)} onAudio={() => setNotice('Workshop preview: audio remains off.')} onContinue={() => setNotice('Workshop preview: no live timer is running.')} /></>;
}

export function InterviewSummaryStory() {
  const [status, setStatus] = useState<'ready' | 'pending' | 'writing' | 'unavailable'>('ready');
  const [transcriptCount, setTranscriptCount] = useState(transcript.length);
  const [notice, setNotice] = useState('');
  const [length, setLength] = useState(240);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setLength(value => Math.min(summaryText.length, value + 24)), 90);
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
