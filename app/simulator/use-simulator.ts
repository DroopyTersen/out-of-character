import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../core/simulator/types';
import { LiveConnection } from './live-connection';
import { silentLevels } from './audio-levels';
import { useSessionReport } from './use-report';
import { INTERVIEW_SCENARIO_ID } from '../../core/interview';

export function useSimulator() {
  const [phase, setPhase] = useState<'selection' | 'connecting' | 'live' | 'ending' | 'debrief'>('selection');
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState(silentLevels);
  const connection = useRef<LiveConnection | null>(null);
  const generation = useRef(0);
  const report = useSessionReport();
  // Connection callbacks outlive renders; submit with the endpoint prepared at Start.
  const reportActions = useRef(report);
  reportActions.current = report;
  useEffect(() => {
    const leave = () => { generation.current++; connection.current?.dispose(); reportActions.current.cancel(); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, []);

  function start(scenarioId: string, clientId: string) {
    connection.current?.dispose();
    const attempt = ++generation.current;
    let reachedLive = false;
    setError(null); setSnapshot(null); setMuted(false); setPhase('connecting');
    const active = () => generation.current === attempt;
    const beginReport = () => { if (scenarioId !== INTERVIEW_SCENARIO_ID) reportActions.current.begin(live.reportTarget.id); };
    const live = new LiveConnection({
      snapshot: value => {
        if (!active()) return;
        if (value.status === 'live') reachedLive = true;
        setSnapshot(value);
        setPhase(value.status === 'ended' || value.status === 'interrupted' ? reachedLive ? 'debrief' : 'selection' : value.status);
        if (reachedLive && (value.status === 'ended' || value.status === 'interrupted')) {
          beginReport();
        }
      },
      levels: value => { if (active()) setLevels(value); },
      error: (message, fatal) => { if (active()) { setError(message); if (fatal) { setPhase(reachedLive ? 'debrief' : 'selection'); if (reachedLive) beginReport(); } } },
    });
    connection.current = live;
    report.prepare(live.reportTarget);
    void live.start(scenarioId, clientId);
  }

  async function end() {
    const attempt = generation.current;
    const cancelled = phase === 'connecting';
    setPhase('ending');
    await connection.current?.end();
    if (generation.current === attempt) setPhase(cancelled ? 'selection' : 'debrief');
  }
  function reset() {
    generation.current++;
    report.cancel();
    connection.current?.dispose(); connection.current = null;
    setPhase('selection'); setSnapshot(null); setError(null); setMuted(false); setLevels(silentLevels);
  }
  function toggleMute() { setMuted(value => { connection.current?.mute(!value); return !value; }); }
  return { phase, snapshot, error, muted, levels, report: report.view, retryReport: report.retry, checkReport: report.checkStatus, start, end, reset, toggleMute, keepActive: () => connection.current?.keepActive(), playAudio: () => { void connection.current?.playAudio().catch(() => setError('Audio playback is still blocked by the browser.')); } };
}
