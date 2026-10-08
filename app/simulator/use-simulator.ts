import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../core/simulator/types';
import { LiveConnection, stableLink, type Attempt, type Link } from '../../interview-engine/client/liveConnection';
import { silentLevels } from '../../interview-engine/client/audioLevels';
import { pollTarget, pollTransport } from '../../interview-engine/client/transport';
import type { ReportActions } from './use-report';

export type SimulatorPhase = 'selection' | 'connecting' | 'live' | 'paused' | 'ending' | 'debrief';
export type AttemptChoice = { scenarioId: string; clientId: string };
/**
 * `left` marks an attempt its page held on the way out; a duplicated tab copies the storage without it. `route` is the
 * session routes the attempt started on; a claim saved before it was recorded started on the practice simulator's.
 */
type SavedAttempt = Attempt & AttemptChoice & { left?: boolean; route?: SessionRoutes };

/** The practice simulator's session routes; the interview page runs its attempts through the interview's. */
export const SIMULATOR_SESSIONS = '/api/simulator/sessions';
export const INTERVIEW_SESSIONS = '/api/interview/sessions';
type SessionRoutes = typeof SIMULATOR_SESSIONS | typeof INTERVIEW_SESSIONS;

/** A started attempt survives a reload of its tab: the page rejoins it paused. */
const savedAttempts = {
  key: (kind: string) => `ooc-attempt-${kind}`,
  /** The attempt this page held when it left, claimed so that only one page rejoins it. */
  claim(kind: string): SavedAttempt | null {
    const saved = this.read(kind);
    if (!saved?.left) return null;
    const { left: _left, ...attempt } = saved;
    this.write(kind, attempt);
    return attempt;
  },
  leave(kind: string) {
    const saved = this.read(kind);
    if (saved) this.write(kind, { ...saved, left: true });
  },
  read(kind: string): SavedAttempt | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(this.key(kind)) || 'null') as Partial<SavedAttempt> | null;
      return value && /^[a-f0-9-]{36}$/.test(value.id ?? '') && /^[a-f0-9]{64}$/.test(value.capability ?? '') && typeof value.scenarioId === 'string' && typeof value.clientId === 'string'
        && (value.route === undefined || value.route === SIMULATOR_SESSIONS || value.route === INTERVIEW_SESSIONS)
        ? value as SavedAttempt : null;
    } catch { return null; }
  },
  write(kind: string, attempt: SavedAttempt) { try { sessionStorage.setItem(this.key(kind), JSON.stringify(attempt)); } catch { /* A reload then ends the attempt. */ } },
  clear(kind: string) { try { sessionStorage.removeItem(this.key(kind)); } catch { /* Nothing was saved. */ } },
};

/**
 * `kind` separates the practice and interview pages' saved attempts; `sessions` is where new attempts start;
 * `onReattach` restores a reloaded page's choice.
 */
export function useSimulator(report: ReportActions, { kind, sessions = SIMULATOR_SESSIONS, onReattach }: { kind: 'practice' | 'interview'; sessions?: SessionRoutes; onReattach?: (choice: AttemptChoice) => void }) {
  const [phase, setPhase] = useState<SimulatorPhase>('selection');
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState(silentLevels);
  const [link, setLink] = useState<Link>(stableLink);
  const connection = useRef<LiveConnection<SessionSnapshot> | null>(null);
  const generation = useRef(0);
  // Connection callbacks outlive renders; submit with the endpoint prepared at Start.
  const reportActions = useRef(report);
  reportActions.current = report;
  const reattached = useRef(onReattach);
  reattached.current = onReattach;
  useEffect(() => {
    // Leaving the page holds a started attempt so a reload can resume it; unmounting ends it.
    const leave = () => {
      generation.current++;
      if (connection.current?.detach()) savedAttempts.leave(kind);
      reportActions.current.cancel();
    };
    const unmount = () => {
      generation.current++;
      if (connection.current) { savedAttempts.clear(kind); connection.current.dispose(); }
      reportActions.current.cancel();
    };
    const rejoin = () => {
      const saved = savedAttempts.claim(kind);
      if (!saved) return;
      reattached.current?.({ scenarioId: saved.scenarioId, clientId: saved.clientId });
      begin(saved, saved);
    };
    // A page restored from the back-forward cache has already detached its connection.
    const show = (event: PageTransitionEvent) => { if (event.persisted) rejoin(); };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', show);
    // Deferred, so a development remount does not end the attempt it just rejoined.
    const timer = setTimeout(rejoin);
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', show); unmount(); };
  }, [kind]);

  function begin(choice: AttemptChoice, saved?: SavedAttempt) {
    connection.current?.dispose();
    const attempt = ++generation.current;
    let reachedLive = false;
    setError(null); setSnapshot(null); setMuted(false); setLevels(silentLevels); setLink(stableLink); setPhase(saved ? 'paused' : 'connecting');
    const active = () => generation.current === attempt;
    const beginReport = () => reportActions.current.begin(live.attempt.id);
    // A rejoined attempt stays on the routes it started on.
    const route = saved ? saved.route ?? SIMULATOR_SESSIONS : sessions;
    const live = new LiveConnection<SessionSnapshot>(pollTransport(route), {
      snapshot: value => {
        if (!active()) return;
        // A rejoined attempt had already started.
        if (!reachedLive && (value.status === 'live' || saved)) {
          reachedLive = true;
          if (!saved) savedAttempts.write(kind, { ...live.attempt, ...choice, route });
        }
        setSnapshot(value);
        const status = value.status;
        if (status === 'ended' || status === 'interrupted') {
          savedAttempts.clear(kind);
          setPhase(reachedLive ? 'debrief' : 'selection');
          if (reachedLive) beginReport();
        }
        // After the conversation starts, reconnecting media is part of the pause.
        else setPhase(reachedLive && status === 'connecting' ? 'paused' : status);
      },
      levels: value => { if (active()) setLevels(value); },
      error: (message, fatal) => {
        if (!active()) return;
        setError(message);
        if (!fatal) return;
        savedAttempts.clear(kind);
        setPhase(reachedLive ? 'debrief' : 'selection');
        if (reachedLive) beginReport();
      },
      link: value => {
        if (!active()) return;
        setLink(value);
        if (value.state === 'resuming') setError(null);
      },
    }, saved);
    connection.current = live;
    reportActions.current.prepare(pollTarget(route, live.attempt));
    void (saved ? live.reattach() : live.start(choice.scenarioId, choice.clientId));
  }

  async function end() {
    const attempt = generation.current;
    const cancelled = phase === 'connecting';
    savedAttempts.clear(kind);
    setPhase('ending');
    await connection.current?.end();
    if (generation.current === attempt) setPhase(cancelled ? 'selection' : 'debrief');
  }
  function reset() {
    generation.current++;
    report.cancel();
    savedAttempts.clear(kind);
    connection.current?.dispose(); connection.current = null;
    setPhase('selection'); setSnapshot(null); setError(null); setMuted(false); setLevels(silentLevels); setLink(stableLink);
  }
  function toggleMute() { setMuted(value => { connection.current?.mute(!value); return !value; }); }
  // Locally lost media is paused before the server's state says so.
  const held = link.state === 'paused' || link.state === 'resuming';
  const shown: SimulatorPhase = held && phase === 'live' ? 'paused' : phase;
  return { phase: shown, snapshot, error, muted, levels, link, end, reset, toggleMute,
    start: (scenarioId: string, clientId: string) => begin({ scenarioId, clientId }),
    resume: () => { void connection.current?.resume(); },
    keepActive: () => connection.current?.keepActive(), playAudio: () => { void connection.current?.playAudio().catch(() => setError('Audio playback is still blocked by the browser.')); } };
}
