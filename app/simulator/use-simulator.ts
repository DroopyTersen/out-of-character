import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../core/simulator/types';
import { LiveConnection } from './live-connection';

export function useSimulator() {
  const [phase, setPhase] = useState<'selection' | 'connecting' | 'live' | 'ending' | 'debrief'>('selection');
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState({ input: 0, output: 0 });
  const connection = useRef<LiveConnection | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const leave = () => { generation.current++; connection.current?.dispose(); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, []);

  function start(scenarioId: string, clientId: string) {
    connection.current?.dispose();
    const attempt = ++generation.current;
    let reachedLive = false;
    setError(null); setSnapshot(null); setMuted(false); setPhase('connecting');
    const active = () => generation.current === attempt;
    const live = new LiveConnection({
      snapshot: value => {
        if (!active()) return;
        if (value.status === 'live') reachedLive = true;
        setSnapshot(value);
        setPhase(value.status === 'ended' || value.status === 'interrupted' ? reachedLive ? 'debrief' : 'selection' : value.status);
      },
      levels: (input, output) => { if (active()) setLevels({ input, output }); },
      error: (message, fatal) => { if (active()) { setError(message); if (fatal) setPhase(reachedLive ? 'debrief' : 'selection'); } },
    });
    connection.current = live;
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
    connection.current?.dispose(); connection.current = null;
    setPhase('selection'); setSnapshot(null); setError(null); setMuted(false); setLevels({ input: 0, output: 0 });
  }
  function toggleMute() { setMuted(value => { connection.current?.mute(!value); return !value; }); }
  return { phase, snapshot, error, muted, levels, start, end, reset, toggleMute, playAudio: () => { void connection.current?.playAudio().catch(() => setError('Audio playback is still blocked by the browser.')); } };
}
