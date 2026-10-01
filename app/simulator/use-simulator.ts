import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../core/simulator/types';
import { LiveConnection, stableLink, type Link } from './live-connection';
import { silentLevels } from './audio-levels';
import type { ReportActions } from './use-report';

export type SimulatorPhase = 'selection' | 'connecting' | 'live' | 'paused' | 'ending' | 'debrief';

export function useSimulator(report: ReportActions) {
  const [phase, setPhase] = useState<SimulatorPhase>('selection');
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState(silentLevels);
  const [link, setLink] = useState<Link>(stableLink);
  const connection = useRef<LiveConnection | null>(null);
  const generation = useRef(0);
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
    setError(null); setSnapshot(null); setMuted(false); setLink(stableLink); setPhase('connecting');
    const active = () => generation.current === attempt;
    const beginReport = () => reportActions.current.begin(live.reportTarget.id);
    const live = new LiveConnection({
      snapshot: value => {
        if (!active()) return;
        if (value.status === 'live') reachedLive = true;
        setSnapshot(value);
        const status = value.status;
        if (status === 'ended' || status === 'interrupted') {
          setPhase(reachedLive ? 'debrief' : 'selection');
          if (reachedLive) beginReport();
        }
        // After the conversation starts, reconnecting media is part of the pause.
        else setPhase(reachedLive && status === 'connecting' ? 'paused' : status);
      },
      levels: value => { if (active()) setLevels(value); },
      error: (message, fatal) => { if (active()) { setError(message); if (fatal) { setPhase(reachedLive ? 'debrief' : 'selection'); if (reachedLive) beginReport(); } } },
      link: value => {
        if (!active()) return;
        setLink(value);
        if (value.state === 'resuming') setError(null);
      },
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
    setPhase('selection'); setSnapshot(null); setError(null); setMuted(false); setLevels(silentLevels); setLink(stableLink);
  }
  function toggleMute() { setMuted(value => { connection.current?.mute(!value); return !value; }); }
  // Locally lost media is paused before the server's state says so.
  const held = link.state === 'paused' || link.state === 'resuming';
  const shown: SimulatorPhase = held && phase === 'live' ? 'paused' : phase;
  return { phase: shown, snapshot, error, muted, levels, link, start, end, reset, toggleMute,
    resume: () => { void connection.current?.resume(); },
    keepActive: () => connection.current?.keepActive(), playAudio: () => { void connection.current?.playAudio().catch(() => setError('Audio playback is still blocked by the browser.')); } };
}
