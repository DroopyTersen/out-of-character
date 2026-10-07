import { useEffect, useRef, useState } from 'react';
import { useLoaderData } from 'react-router';
import type { Route } from './+types/interview';
import { DEFAULT_LISTENING, INTERVIEW_SCENARIO_ID, interviewVoices, interviewSummarySchema, type ListeningMode } from '../../core/interview';
import { InterviewConversation, InterviewSetup, InterviewSummaryScreen, type InterviewVoiceId } from '../interview/screens';
import { useSimulator } from '../simulator/use-simulator';
import { useStreamedReport } from '../simulator/use-report';
import { liveAvailable } from '../server/simulator/api';
import { GameHeader } from '../ui/game-header';
import '../simulator/simulator.css';
import '../interview/interview.css';

export const meta = () => [{ title: 'The Debrief — Out of Character' }];
export function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  return { enabled: liveAvailable(env) };
}

export default function Interview() {
  const { enabled } = useLoaderData<typeof loader>();
  const [voiceId, setVoiceId] = useState<InterviewVoiceId>(interviewVoices[0].id);
  const [listening, setListening] = useState<ListeningMode>(DEFAULT_LISTENING);
  const [now, setNow] = useState(Date.now());
  const report = useStreamedReport(interviewSummarySchema, draft => !!draft?.text);
  const session = useSimulator(report, { kind: 'interview', onReattach: ({ clientId, listening: mode }) => {
    const voice = interviewVoices.find(item => item.id === clientId);
    if (voice) setVoiceId(voice.id);
    if (mode) setListening(mode);
  } });
  const main = useRef<HTMLElement>(null);
  const screen = session.phase === 'selection' || session.phase === 'debrief' ? session.phase : 'conversation';
  const shownScreen = useRef(screen);
  useEffect(() => {
    // A paused conversation keeps ticking for its hold countdown.
    if (session.phase !== 'live' && session.phase !== 'paused') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [session.phase]);
  useEffect(() => {
    if (shownScreen.current !== screen) main.current?.querySelector<HTMLElement>('h1')?.focus();
    shownScreen.current = screen;
  }, [screen]);
  return <div className="app-shell simulator-shell interview-shell"><GameHeader simulator interview /><main className="game-main" ref={main}>
    {session.phase === 'selection' ? <InterviewSetup voiceId={voiceId} onVoice={setVoiceId} listening={listening} onListening={setListening} onStart={() => session.start(INTERVIEW_SCENARIO_ID, voiceId, listening)} enabled={enabled} error={session.error} />
      : session.phase === 'debrief' ? <InterviewSummaryScreen report={report.view} onRetrySummary={report.retry} onCheckSummary={report.checkStatus} snapshot={report.view.snapshot ?? session.snapshot} onReset={session.reset} error={session.error} />
        : <InterviewConversation voiceId={voiceId} snapshot={session.snapshot} phase={session.phase} muted={session.muted} levels={session.levels} elapsed={session.snapshot ? Math.max(0, ((session.snapshot.pause?.pausedAt ?? now) - session.snapshot.startedAt) / 1000) : 0} onEnd={() => { void session.end(); }} onMute={session.toggleMute} onAudio={session.playAudio} onContinue={session.keepActive} onResume={session.resume} link={session.link} error={session.error} />}
  </main></div>;
}
