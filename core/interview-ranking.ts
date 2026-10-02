import type { ConversationMap, MapThread } from './interview-map';

/**
 * Code's half of the turn loop: Jev reads the open threads after each settled participant turn, and code scores them,
 * holds down the ones Jev saw answered, declined or stalled, and picks keep-pulling or a thread to tug. Sol owns thread
 * status; nothing here is ever written back to the map. Every time here (atMs, nowMs, startedAtMs) is interview-elapsed
 * ms, measured from the session start.
 */
export const THREAD_STATES = ['open', 'answered', 'declined', 'stalled'] as const;
export type ThreadState = typeof THREAD_STATES[number];
export const BANDS = ['right-there', 'nearby', 'elsewhere'] as const;
export type Band = typeof BANDS[number];

export const RANKING = {
  weights: { natural: 1, spicy: .5, grounding: .4 },
  /** Grounding matters while Sam is still learning what was built and for whom. */
  groundingFadeMs: 5 * 60_000,
  /** Scores this close are a tie, and the closer band wins. */
  tie: .1,
  /** How far another thread must beat the current one; it shrinks with each turn spent on the current thread. */
  margin: { start: .3, step: .05, min: .05 },
  stalledHoldMs: 3 * 60_000,
  /** An answered or declined thread stays down until Sol's next call starts, or this long if Sol's calls keep failing. */
  maxHoldMs: 2 * 60_000,
  /**
   * An entity linked to more than this share of the others, or anchoring more than this share of open threads, and to
   * at least three, is a hub and doesn't make threads nearby.
   */
  hub: { share: 1 / 3, minEntities: 6, minThreads: 4 },
  nearby: 2,
  /** Jev's "substantially new" probability that wakes Sol early. */
  novel: .8,
};

/** Jev's reading after one settled participant turn; `keys` is each open thread's wording in the map Jev was shown. */
export type TurnReading = {
  passageId: string; atMs: number; focus: string | null; keys: Record<string, string>;
  natural: Record<string, number>; states: Record<string, ThreadState>; novel: number;
};
/** Jev's reading of a thread when Sol adds or rewrites it; `key` is the thread content it was read against. */
export type ThreadTraits = { key: string; spicy: number; grounding: number };
/** `turn` is the first passage of the turn whose reading set the hold. */
export type Hold = { state: Exclude<ThreadState, 'open'>; atMs: number; key: string; turn: string | null };
export type RankingState = {
  current: string | null; turnsOnCurrent: number;
  holds: Record<string, Hold>; traits: Record<string, ThreadTraits>;
  reading: TurnReading | null;
  /** The first passage of the turn last read, so a re-read of it once it grows is known. */
  turn: string | null;
  /** When the applied map's Sol call started: Sol has seen every turn settled before it. */
  mapStartedAtMs: number | null;
};
export type Ranked = { id: string; score: number; band: Band };
export type Pick = { current: string | null; action: 'keep' | 'tug' | 'none'; lead: string | null; nearby: string[]; ranked: Ranked[] };

export const emptyRanking = (): RankingState => ({ current: null, turnsOnCurrent: 0, holds: {}, traits: {}, reading: null, turn: null, mapStartedAtMs: null });

/** What Jev reads a thread against; a change means Sol rewrote the gap, so earlier readings no longer apply. */
export const threadKey = (thread: MapThread) => JSON.stringify([thread.label, thread.unknown, thread.guess, thread.anchors]);
const openThreads = (map: ConversationMap) => map.threads.filter(item => item.status === 'open');

/** Open threads Jev hasn't read spicy and grounding for, in their current wording. */
export function threadsNeedingTraits(map: ConversationMap, state: RankingState): MapThread[] {
  return openThreads(map).filter(thread => state.traits[thread.id]?.key !== threadKey(thread));
}

export function withTraits(state: RankingState, traits: Record<string, ThreadTraits>): RankingState {
  return { ...state, traits: { ...state.traits, ...traits } };
}

/**
 * Applies Jev's turn reading: focus sets the current thread, and a turn that answers or declines a thread, or stalls the
 * one being asked about, holds it down. A reading of a thread Sol has since rewritten no longer applies. A re-read of
 * a turn that grew, named by its first passage, replaces the earlier reading and its holds without counting as another
 * turn on the current thread.
 */
export function observeTurn(state: RankingState, map: ConversationMap, reading: TurnReading, turn: string | null = null): RankingState {
  const open = new Map(openThreads(map).map(thread => [thread.id, thread]));
  // A thread Sol rewrote after Jev read it isn't the thread Jev judged.
  const read = (id: string | null) => { const thread = id == null ? undefined : open.get(id); return thread && reading.keys[thread.id] === threadKey(thread) ? thread : undefined; };
  const focus = read(reading.focus)?.id ?? null;
  const regrown = turn != null && turn === state.turn;
  // Stalled means Sam asked and the answer didn't move it, so it only counts for the thread the conversation was or is on.
  const asked = new Set([focus, state.current]);
  const holds = Object.fromEntries(Object.entries(state.holds).filter(([, hold]) => !regrown || hold.turn !== turn));
  for (const [id, threadState] of Object.entries(reading.states)) {
    const thread = read(id);
    if (!thread || threadState === 'open' || (threadState === 'stalled' && !asked.has(id))) continue;
    // An active hold isn't extended, so repeated readings can't pin a thread down past Sol's next call.
    if (active(holds[id], thread, reading.atMs)) continue;
    holds[id] = { state: threadState, atMs: reading.atMs, key: threadKey(thread), turn };
  }
  return {
    ...state, holds, reading, turn,
    current: focus, turnsOnCurrent: focus == null ? 0 : focus === state.current ? state.turnsOnCurrent + (regrown ? 0 : 1) : 1,
  };
}

/**
 * Applies a new map. Sol has now ruled on every answered or declined reading settled before its call started,
 * so those holds lift; a thread Sol rewrote starts fresh; state for closed and dropped threads goes.
 */
export function observeMap(state: RankingState, map: ConversationMap, startedAtMs: number): RankingState {
  const open = new Map(openThreads(map).map(thread => [thread.id, thread]));
  const holds = Object.fromEntries(Object.entries(state.holds).filter(([id, hold]) => {
    const thread = open.get(id);
    return thread && hold.key === threadKey(thread) && (hold.state === 'stalled' || hold.atMs > startedAtMs);
  }));
  const traits = Object.fromEntries(Object.entries(state.traits).filter(([id]) => open.has(id)));
  const focused = state.current == null ? undefined : open.get(state.current);
  const current = focused && state.reading?.keys[focused.id] === threadKey(focused) ? focused.id : null;
  return { ...state, holds, traits, current, turnsOnCurrent: current == null ? 0 : state.turnsOnCurrent, mapStartedAtMs: startedAtMs };
}

function active(hold: Hold | undefined, thread: MapThread, nowMs: number) {
  if (!hold || hold.key !== threadKey(thread)) return false;
  return nowMs < hold.atMs + (hold.state === 'stalled' ? RANKING.stalledHoldMs : RANKING.maxHoldMs);
}

/** Entities that every path runs through, such as the product or the client: linked to many others, or anchoring many threads. */
export function hubs(map: ConversationMap): Set<string> {
  const { share, minEntities, minThreads } = RANKING.hub;
  const found = new Set<string>();
  const count = map.entities.length + 1;
  if (count >= minEntities) {
    const neighbors = new Map<string, Set<string>>();
    const link = (a: string, b: string) => neighbors.set(a, (neighbors.get(a) ?? new Set()).add(b));
    for (const edge of map.edges) { link(edge.from, edge.to); link(edge.to, edge.from); }
    for (const [id, set] of neighbors) if (set.size > Math.max(2, share * (count - 1))) found.add(id);
  }
  const open = openThreads(map);
  if (open.length >= minThreads) {
    const anchored = new Map<string, number>();
    for (const thread of open) for (const id of new Set(thread.anchors)) anchored.set(id, (anchored.get(id) ?? 0) + 1);
    for (const [id, number] of anchored) if (number > Math.max(2, share * open.length)) found.add(id);
  }
  return found;
}

/**
 * How easy a segue from `from` to `to` should be: threads Sol called related, then threads whose anchors share an
 * entity or an edge, ignoring hubs unless a thread is anchored only on hubs.
 */
export function band(map: ConversationMap, from: MapThread | null, to: MapThread, hubIds = hubs(map)): Band {
  if (!from) return 'elsewhere';
  if (from.related.includes(to.id) || to.related.includes(from.id)) return 'right-there';
  const ends = (thread: MapThread) => { const own = thread.anchors.filter(id => !hubIds.has(id)); return new Set(own.length ? own : thread.anchors); };
  const a = ends(from);
  const b = ends(to);
  if ([...a].some(id => b.has(id))) return 'nearby';
  return map.edges.some(edge => (a.has(edge.from) && b.has(edge.to)) || (a.has(edge.to) && b.has(edge.from))) ? 'nearby' : 'elsewhere';
}

export function score(state: RankingState, thread: MapThread, nowMs: number): number {
  const { weights } = RANKING;
  const traits = state.traits[thread.id]?.key === threadKey(thread) ? state.traits[thread.id]! : null;
  const fade = Math.max(0, 1 - nowMs / RANKING.groundingFadeMs);
  const reading = state.reading;
  const natural = reading?.keys[thread.id] === threadKey(thread) ? reading.natural[thread.id] ?? 0 : 0;
  // A thread Jev hasn't read in its current wording scores nothing for that part: it waits for evidence rather than jumping the queue.
  return weights.natural * natural + weights.spicy * (traits?.spicy ?? 0) + weights.grounding * fade * (traits?.grounding ?? 0);
}

/** Highest score first; scores within the tie margin of the best go to the closer band. */
function order(items: Ranked[]): Ranked[] {
  const rest = [...items];
  const sorted: Ranked[] = [];
  while (rest.length) {
    const top = Math.max(...rest.map(item => item.score));
    const pool = rest.filter(item => item.score >= top - RANKING.tie);
    const best = pool.reduce((a, b) => BANDS.indexOf(b.band) < BANDS.indexOf(a.band) || (b.band === a.band && b.score > a.score) ? b : a);
    sorted.push(best);
    rest.splice(rest.indexOf(best), 1);
  }
  return sorted;
}

/**
 * Keep pulling on the current thread until it's held down or crossed out, or another thread beats it by a margin
 * that shrinks with each turn spent on it, so it can't hold the floor forever.
 */
export function pickThreads(map: ConversationMap, state: RankingState, nowMs: number): Pick {
  const open = openThreads(map);
  const current = open.find(thread => thread.id === state.current) ?? null;
  const hubIds = hubs(map);
  const eligible = open.filter(thread => !active(state.holds[thread.id], thread, nowMs));
  const ranked = order(eligible.map(thread => ({ id: thread.id, score: score(state, thread, nowMs), band: band(map, current, thread, hubIds) })));
  const others = ranked.filter(item => item.id !== current?.id);
  const mine = ranked.find(item => item.id === current?.id);
  const margin = Math.max(RANKING.margin.min, RANKING.margin.start - RANKING.margin.step * Math.max(0, state.turnsOnCurrent - 1));
  const keep = !!mine && (!others.length || others[0]!.score < mine.score + margin);
  const lead = keep ? mine!.id : others[0]?.id ?? null;
  return {
    current: current?.id ?? null, action: lead == null ? 'none' : keep ? 'keep' : 'tug', lead,
    nearby: others.filter(item => item.id !== lead).slice(0, RANKING.nearby).map(item => item.id), ranked,
  };
}
