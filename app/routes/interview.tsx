import { useEffect, useRef, useState } from 'react';
import { useLoaderData } from 'react-router';
import type { Route } from './+types/interview';
import { INTERVIEW_SCENARIO_ID, interviewVoices, interviewSummarySchema } from '../../core/interview';
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
  const [now, setNow] = useState(Date.now());
  const report = useStreamedReport(interviewSummarySchema, draft => !!draft?.text);
  const session = useSimulator(report);
  const main = useRef<HTMLElement>(null);
  const screen = session.phase === 'selection' || session.phase === 'debrief' ? session.phase : 'conversation';
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (session.phase !== 'live') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [session.phase]);
  useEffect(() => {
    if (shownScreen.current !== screen) main.current?.querySelector<HTMLElement>('h1')?.focus();
    shownScreen.current = screen;
  }, [screen]);
  return <div className="app-shell simulator-shell interview-shell"><GameHeader simulator interview /><main className="game-main" ref={main}>
    {session.phase === 'selection' ? <InterviewSetup voiceId={voiceId} onVoice={setVoiceId} onStart={() => session.start(INTERVIEW_SCENARIO_ID, voiceId)} enabled={enabled} error={session.error} />
      : session.phase === 'debrief' ? <InterviewSummaryScreen report={report.view} onRetrySummary={report.retry} onCheckSummary={report.checkStatus} snapshot={report.view.snapshot ?? session.snapshot} onReset={session.reset} error={session.error} />
        : <InterviewConversation voiceId={voiceId} snapshot={session.snapshot} phase={session.phase} muted={session.muted} levels={session.levels} elapsed={session.snapshot ? Math.max(0, (now - session.snapshot.startedAt) / 1000) : 0} onEnd={() => { void session.end(); }} onMute={session.toggleMute} onAudio={session.playAudio} onContinue={session.keepActive} error={session.error} />}
  </main></div>;
}
