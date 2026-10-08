import type { ConversationMap, MapThread } from './map';

export const THREAD_STATES = ['open', 'answered', 'declined', 'stalled'] as const;
export type ThreadState = typeof THREAD_STATES[number];
/** Nearby remains readable in historical archives; new picks use only Sol's related links. */
export const BANDS = ['right-there', 'nearby', 'elsewhere'] as const;
export type Band = typeof BANDS[number];
/** Within a tenth, keep the current thread or prefer one Sol marked related. */
export const RANKING = { margin: .1, nearby: 2, novel: .8 };

/** Keys keep a reading from applying to a gap Sol rewrote while Jev was running. */
export type TurnReading = {
  passageId: string; atMs: number; focus: string | null; keys: Record<string, string>;
  natural: Record<string, number>; states: Record<string, ThreadState>; novel: number;
  /** Unsaved interview feedback; absent in checkpoints from before ranking v5. */
  feedback?: number;
};
export type RankingState = {
  current: string | null; reading: TurnReading | null;
  /** Answered, declined or stalled gaps wait for Sol's next applied map. */
  holds: Record<string, { state: Exclude<ThreadState, 'open'>; turn: string }>;
};
export type Ranked = { id: string; score: number; band: Band };
export type Pick = { current: string | null; action: 'keep' | 'tug' | 'none'; lead: string | null; nearby: string[]; ranked: Ranked[] };

export const emptyRanking = (): RankingState => ({ current: null, holds: {}, reading: null });
export const threadKey = (thread: MapThread) => JSON.stringify([thread.label, thread.unknown, thread.guess, thread.anchors]);

export function observeTurn(state: RankingState, map: ConversationMap, reading: TurnReading, turn = reading.passageId): RankingState {
  const read = new Set(map.threads.filter(thread => thread.status === 'open' && reading.keys[thread.id] === threadKey(thread)).map(thread => thread.id));
  // Transcript corrections replace this turn's holds, without lifting an earlier turn's decline.
  const holds = Object.fromEntries(Object.entries(state.holds).filter(([, hold]) => hold.turn !== turn));
  for (const [id, status] of Object.entries(reading.states)) {
    if (read.has(id) && status !== 'open') holds[id] ??= { state: status, turn };
  }
  return { holds, reading, current: reading.focus != null && read.has(reading.focus) ? reading.focus : null };
}

export function observeMap(state: RankingState, map: ConversationMap): RankingState {
  const current = map.threads.find(thread => thread.id === state.current && thread.status === 'open');
  return { ...state, holds: {}, current: current && state.reading?.keys[current.id] === threadKey(current) ? current.id : null };
}

export function score(state: RankingState, thread: MapThread): number {
  return state.reading?.keys[thread.id] === threadKey(thread) ? state.reading.natural[thread.id] ?? 0 : 0;
}

export function band(from: MapThread | null, to: MapThread): Band {
  return from && (from.related.includes(to.id) || to.related.includes(from.id)) ? 'right-there' : 'elsewhere';
}

/** Natural-next scores decide; an easy segue only breaks a near-tie. */
export function pickThreads(map: ConversationMap, state: RankingState): Pick {
  const open = map.threads.filter(thread => thread.status === 'open');
  const current = open.find(thread => thread.id === state.current) ?? null;
  const ranked = open.filter(thread => !state.holds[thread.id] && state.reading?.keys[thread.id] === threadKey(thread))
    .map(thread => ({ id: thread.id, score: score(state, thread), band: band(current, thread) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const mine = ranked.find(item => item.id === current?.id);
  const keep = !!mine && !!best && best.score <= mine.score + RANKING.margin;
  const related = best && ranked.find(item => item.band === 'right-there' && item.score >= best.score - RANKING.margin);
  const lead = keep ? mine.id : (related ?? best)?.id ?? null;
  return {
    current: current?.id ?? null, action: lead == null ? 'none' : keep ? 'keep' : 'tug', lead,
    nearby: ranked.filter(item => item.id !== lead && item.id !== current?.id).slice(0, RANKING.nearby).map(item => item.id), ranked,
  };
}
