import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../core/simulator/types';
import { LiveConnection, stableLink, type Attempt, type ConnectionSnapshot, type Link } from '../../interview-engine/client/liveConnection';
import type { StartInput, SubmitTextReply } from '../../interview-engine/shared/protocol';
import { silentLevels } from '../../interview-engine/client/audioLevels';
import { pollTarget, pollTransport } from '../../interview-engine/client/transport';
import type { ReportActions } from './use-report';

export type SimulatorPhase = 'selection' | 'connecting' | 'live' | 'paused' | 'ending' | 'debrief';
export type AttemptChoice = { scenarioId: string; clientId: string };
/**
 * `left` marks an attempt its page held on the way out; a duplicated tab copies the storage without it. `route` is the
 * session routes the attempt started on; a claim saved without one rejoins this page's routes.
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
export function useSimulator<S extends ConnectionSnapshot = SessionSnapshot>(report: ReportActions, { kind, sessions = SIMULATOR_SESSIONS, onReattach }: { kind: 'practice' | 'interview'; sessions?: SessionRoutes; onReattach?: (choice: AttemptChoice) => void }) {
  const [phase, setPhase] = useState<SimulatorPhase>('selection');
  const [snapshot, setSnapshot] = useState<S | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState(silentLevels);
  const [link, setLink] = useState<Link>(stableLink);
  const connection = useRef<LiveConnection<S> | null>(null);
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
    // A rejoined attempt is already saved; a new one is saved once its conversation starts.
    let remembered = !!saved;
    setError(null); setSnapshot(null); setMuted(false); setLevels(silentLevels); setLink(stableLink); setPhase(saved ? 'paused' : 'connecting');
    const active = () => generation.current === attempt;
    // A rejoined attempt stays on the routes it started on.
    const route = saved?.route ?? sessions;
    const transport = pollTransport(route);
    const live = new LiveConnection<S>({ request: (action, body, options) => {
      // The practice simulator shares media handling but owns its scenario/client API.
      if (route === SIMULATOR_SESSIONS && action === 'start') {
        const { planId, voiceId, ...rest } = body as StartInput;
        body = { ...rest, scenarioId: planId, clientId: voiceId };
      }
      return transport.request(action, body, options);
    } }, {
      snapshot: value => {
        if (!active()) return;
        if (!remembered && value.status === 'live') {
          remembered = true;
          savedAttempts.write(kind, { ...live.attempt, ...choice, route });
        }
        setSnapshot(value);
        const status = value.status;
        // `closed` follows a terminal snapshot. After the conversation starts, reconnecting media is part of the pause.
        if (status !== 'ended' && status !== 'interrupted') setPhase(current => status === 'connecting' && current !== 'connecting' ? 'paused' : status);
      },
      levels: value => { if (active()) setLevels(value); },
      error: message => { if (active()) setError(message); },
      link: value => {
        if (!active()) return;
        setLink(value);
        if (value.state === 'resuming') setError(null);
      },
      closed: ({ outcome, reachedLive }) => {
        if (!active()) return;
        // An unanswered end may have left the attempt held: rejoin it, paused, to resume or end it again.
        if (outcome === 'unconfirmed' && reachedLive) {
          const held = { ...live.attempt, ...choice, route };
          savedAttempts.write(kind, held);
          begin(choice, held);
          setError('Ending did not reach the server. Your attempt is paused; resume it or end it again.');
          return;
        }
        savedAttempts.clear(kind);
        setPhase(reachedLive ? 'debrief' : 'selection');
        if (reachedLive) reportActions.current.begin(live.attempt.id);
      },
    }, saved);
    connection.current = live;
    reportActions.current.prepare(pollTarget(route, live.attempt));
    void (saved ? live.reattach() : live.start(choice.scenarioId, choice.clientId));
  }

  function end() {
    savedAttempts.clear(kind);
    setPhase('ending');
    void connection.current?.end();
  }
  function reset() {
    generation.current++;
    report.cancel();
    savedAttempts.clear(kind);
    connection.current?.dispose(); connection.current = null;
    setPhase('selection'); setSnapshot(null); setError(null); setMuted(false); setLevels(silentLevels); setLink(stableLink);
  }
  /** A nonempty typed draft pauses the microphone; without a connection there is nothing to protect. */
  function setComposing(value: boolean) { connection.current?.setComposing(value); }
  /** Sends one typed answer; a superseded attempt never reports it accepted. */
  async function submitText(text: string): Promise<SubmitTextReply> {
    const live = connection.current, attempt = generation.current;
    if (!live) throw new Error('The interview is not live.');
    const reply = await live.submitText(text);
    if (generation.current !== attempt) throw new Error('The interview is not live.');
    return reply;
  }
  function toggleMute() { setMuted(value => { connection.current?.mute(!value); return !value; }); }
  // Locally lost media is paused before the server's state says so.
  const held = link.state === 'paused' || link.state === 'resuming';
  const shown: SimulatorPhase = held && phase === 'live' ? 'paused' : phase;
  return { phase: shown, snapshot, error, muted, levels, link, end, reset, toggleMute, setComposing, submitText,
    start: (scenarioId: string, clientId: string) => begin({ scenarioId, clientId }),
    resume: () => { void connection.current?.resume(); },
    keepActive: () => connection.current?.keepActive(), playAudio: () => { void connection.current?.playAudio().catch(() => setError('Audio playback is still blocked by the browser.')); } };
}
