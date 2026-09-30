import { useEffect, useRef, useState } from 'react';
import { Link, useLoaderData, useNavigate } from 'react-router';
import type { Route } from './+types/simulator';
import { publicCatalog } from '../../ai/simulator/scenarios.server';
import { GameHeader } from '../ui/game-header';
import { SimulatorSelection } from '../simulator/selection';
import { SimulatorConversation } from '../simulator/conversation';
import { SimulatorDebrief } from '../simulator/debrief';
import { SimulatorBriefing } from '../simulator/briefing';
import { useSimulator } from '../simulator/use-simulator';
import { useSessionReport } from '../simulator/use-report';
import { scenarioBriefings } from '../../core/simulator/briefings';
import { parsePracticeLink, practicePath } from '../simulator/practice-links';
import { liveAvailable } from '../server/simulator/api';
import '../simulator/simulator.css';

export const meta = () => [{ title: 'The Simulator — Out of Character' }];
export function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const catalog = publicCatalog();
  return { catalog, ...parsePracticeLink(new URL(request.url).searchParams, catalog), enabled: liveAvailable(env) };
}

export default function Simulator() {
  const { catalog, enabled, initial, invalidLink } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [scenarioId, setScenarioId] = useState(initial?.scenarioId ?? catalog.scenarios[0]!.id);
  const [clientId, setClientId] = useState(initial?.clientId ?? catalog.clients[0]!.id);
  const [now, setNow] = useState(Date.now());
  const [briefingOpen, setBriefingOpen] = useState(!!initial);
  const report = useSessionReport();
  const session = useSimulator(report);
  useEffect(() => {
    if (session.phase !== 'live') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [session.phase]);
  const screen = briefingOpen ? 'briefing' : session.phase === 'selection' || session.phase === 'debrief' ? session.phase : 'conversation';
  const shownScreen = useRef(screen);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    // A new screen unmounts the control that had focus; start keyboard and screen-reader users at its heading.
    if (shownScreen.current !== screen) {
      main.current?.querySelector<HTMLElement>('h1')?.focus();
      if (screen === 'selection') void navigate('/simulator', { replace: true, preventScrollReset: true });
    }
    shownScreen.current = screen;
  }, [screen, navigate]);
  const scenario = catalog.scenarios.find(item => item.id === scenarioId)!;
  const client = catalog.clients.find(item => item.id === clientId)!;
  const openBriefing = () => {
    void navigate(practicePath(scenarioId, clientId), { replace: true, preventScrollReset: true });
    setBriefingOpen(true);
  };
  const startConversation = () => { setBriefingOpen(false); session.start(scenarioId, clientId); };
  return <div className="app-shell simulator-shell"><GameHeader simulator /><main className="game-main" ref={main}>
    {briefingOpen ? <SimulatorBriefing scenario={scenario} client={client} briefing={scenarioBriefings[scenarioId]!} enabled={enabled} onBack={() => setBriefingOpen(false)} onStart={startConversation} />
      : session.phase === 'selection' ? <><SimulatorSelection catalog={catalog} scenarioId={scenarioId} clientId={clientId} onScenario={setScenarioId} onClient={setClientId} onStart={openBriefing} enabled={enabled} error={session.error ?? (invalidLink ? 'That practice link is incomplete or unavailable. Choose a scenario and client to continue.' : null)} /><p className="sim-lab-link">Trying different voices? <Link to="/simulator/voice-lab">Open the Voice Lab →</Link></p></>
      : session.phase === 'debrief' ? <SimulatorDebrief scenario={scenario} client={client} snapshot={session.snapshot} report={report.view} onRetryReport={report.retry} onCheckReport={report.checkStatus} onRetry={() => session.start(scenarioId, clientId)} onChoose={session.reset} error={session.error} />
        : <SimulatorConversation scenario={scenario} client={client} snapshot={session.snapshot} phase={session.phase} muted={session.muted} levels={session.levels} elapsed={session.snapshot ? Math.max(0, (now - session.snapshot.startedAt) / 1000) : 0} onEnd={() => { void session.end(); }} onMute={session.toggleMute} onAudio={session.playAudio} onContinue={session.keepActive} error={session.error} />}
  </main></div>;
}
