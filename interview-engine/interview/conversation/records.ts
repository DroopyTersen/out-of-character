import type { CallFailure } from '../../providers/diagnostics.server';
import type { ModelUsage } from '../../providers/structured.server';
import type { CoverageLevel, InterviewBackground, InterviewObjectiveReading as Reading } from '../../shared/snapshot';
import type { Speaker } from '../../shared/transcript';
import type { MapDefect, MapUpdate } from './map';
import type { Band, Pick, ThreadState } from './ranking';

type InterviewObjectiveReading = Reading<Speaker>;

/**
 * Private producer state for the interview: Sol keeps the conversation map, Jev reads each settled participant turn
 * against its threads, and code picks threads and sends Sam two fixed-template notes. Luna's research feeds the map.
 */
export const PRODUCER_VERSION = 'interview-producer-v27';
export const PRODUCER_LIMITS = {
  /** Shared cap for paid producer calls, including failures and interrupted calls. */
  calls: 400,
  /** One Sol call at a time; early wakes are spaced start to start. */
  mapFloor: 20_000, mapTimer: 60_000, mapTimeout: 50_000,
  turnTimeout: 3000, lookupTimeout: 90_000,
  research: 3, notes: 100,
};

export const RESEARCH_KINDS = ['organization', 'product', 'term'] as const satisfies readonly InterviewBackground['target']['kind'][];
export type ResearchKind = typeof RESEARCH_KINDS[number];
export type ResearchRequest = { kind: ResearchKind; name: string; clue: string | null; passageIds: string[] };
export type NoteDelivery = { eventId: string; afterPassageId: string | null; status: 'unknown' | 'accepted' | 'rejected'; acknowledgedAt?: number; startMs?: number; endMs?: number };
/** Safe provider metadata only; never response bodies, request headers or exception messages. */
export type { CallFailure };

/** One Sol call. The applied updates replay to the map, so the map itself isn't stored; an applied record without one was shed to fit the archive row. */
export type MapRecord = {
  source: 'map'; id: string; reasons: string[]; startedAt: number; completedAt?: number;
  outcome: 'pending' | 'applied' | 'invalid' | 'timeout' | 'error' | 'aborted';
  inputCount: number; lastInputId: string | null; model: string; usage?: ModelUsage;
  update?: MapUpdate; changes?: { added: string[]; changed: string[]; dropped: string[] };
  /** The first few, for an invalid update. */
  defects?: MapDefect[];
  research?: ResearchRequest | null;
  failure?: CallFailure;
};
/**
 * Jev's reading of one settled participant turn and the pick code made from it. Scores are rounded; ranked is
 * [id, score, band].
 */
export type TurnRecord = {
  source: 'turn'; id: string; passageId: string; mapId: string | null; startedAt: number; completedAt?: number;
  outcome: 'pending' | 'read' | 'timeout' | 'error' | 'aborted'; durationMs?: number; usage?: ModelUsage;
  reading?: { atMs: number; focus: string | null; novel: number; feedback?: number; natural: Record<string, number>; states: Record<string, ThreadState> };
  pick?: Omit<Pick, 'ranked'> & { ranked: [id: string, score: number, band: Band][] };
  failure?: CallFailure;
};
/** Historical trait readings from interviews before v26; new runs use only natural-next scores. */
export type TraitRecord = {
  source: 'traits'; id: string; mapId: string | null; threadIds: string[]; startedAt: number; completedAt?: number;
  outcome: 'pending' | 'read' | 'timeout' | 'error' | 'aborted'; durationMs?: number; usage?: ModelUsage;
  traits?: Record<string, [spicy: number, grounding: number]>;
  failure?: CallFailure;
};
/** A private note and its delivery acknowledgment. nextSamTurnAt measures timing, not whether Sam followed it. */
export type NoteRecord = {
  source: 'note'; id: string; kind: 'list' | 'map'; text: string; mapId: string | null; turnId?: string; sentAt: number;
  outcome: 'sent' | 'error' | 'rejected'; delivery: NoteDelivery; researchIds?: string[];
  nextSamTurnAt?: number; nextSamTurnAfterId?: string | null;
};
/** Sol requests a lookup on its map output; the result reaches Sol as a log event and Sam only through Sol's map. */
export type ResearchRecord = {
  source: 'research'; id: string; mapId: string; request: ResearchRequest; model: string;
  requestedAt: number; lookupAt?: number; completedAt?: number; loggedAt?: number;
  /** The ID of the lookup's event in Sol's log, which research facts cite. */
  eventId?: string;
  facts?: InterviewBackground['facts']; retrievedAt?: number; queries?: string[]; reason?: string;
  outcome: 'pending' | 'invalid' | 'duplicate' | 'budget' | 'busy' | 'found' | 'unresolved' | 'timeout' | 'error' | 'aborted';
  failure?: CallFailure;
};
export type DelegationRecord = { source: 'delegation'; id: string; createdAt: number; target: string | null; replied: boolean };
/** Compact, named tuples keep either judgment's evidence small; a live grade without objectives was thinned to fit the archive row. */
export type GradeObjective = {
  id: string;
  shown: [level: CoverageLevel, evidenceId: string | null];
  graded: [level: CoverageLevel, evidenceId: string | null];
  levels: [notYet: number, touched: number, explored: number, setAside: number] | null;
};
export type GradeRecord = {
  source: 'grade'; id: string; final: boolean; revision: number; capturedAt: number; completedAt: number; inputCount: number; lastInputId: string | null;
  outcome: 'graded' | 'stale' | 'aborted' | 'evaluation_timeout' | 'evaluation_error'; durationMs?: number; objectives?: GradeObjective[];
  failure?: CallFailure;
};
export type ProducerLogRecord = MapRecord | TurnRecord | TraitRecord | NoteRecord | ResearchRecord | DelegationRecord | GradeRecord;

const round = (value: number) => Math.round(value * 100) / 100;
export function gradeObjectives(graded: InterviewObjectiveReading[], shown: InterviewObjectiveReading[]): GradeObjective[] {
  return graded.map(own => {
    const reading = shown.find(item => item.id === own.id);
    const levels = own.levels;
    return { id: own.id, shown: [reading?.level ?? 'not-yet', reading?.evidence?.entryId ?? null],
      graded: [own.level, own.evidence?.entryId ?? null],
      levels: levels ? [round(levels['not-yet']), round(levels.touched), round(levels.explored), round(levels['set-aside'])] : null };
  });
}

/** Lookups Sam could have read: a research fact in a map note cites them, and the voice service accepted the note. */
export function deliveredBackground(records: ProducerLogRecord[]): InterviewBackground[] {
  const delivered = new Set(records.flatMap(item => item.source === 'note' && item.delivery.status === 'accepted' ? item.researchIds ?? [] : []));
  return records.flatMap(item => item.source === 'research' && item.outcome === 'found' && delivered.has(item.id) && item.facts?.length && item.retrievedAt != null
    ? [{ id: item.id, target: { kind: item.request.kind, name: item.request.name }, facts: item.facts, retrievedAt: item.retrievedAt }] : []);
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * Fits the records to the bytes left in a D1 row. Live grades thin first, evenly in time (every other one, then every
 * fourth, and so on; the final grade keeps its objectives), then Sol's updates go, oldest first.
 */
export function fitRecords(records: ProducerLogRecord[], budget: number): ProducerLogRecord[] {
  const fitted = [...records];
  const sizes = fitted.map(bytes);
  // Brackets and commas.
  let total = sizes.reduce((sum, size) => sum + size, fitted.length + 1);
  const shed = (index: number, record: ProducerLogRecord) => { const size = bytes(record); total += size - sizes[index]!; sizes[index] = size; fitted[index] = record; };
  const live = fitted.flatMap((item, index) => item.source === 'grade' && !item.final && item.objectives ? [index] : []);
  for (let stride = 2; total > budget && stride < live.length * 2; stride *= 2) {
    live.forEach((index, position) => {
      const item = fitted[index]!;
      if (position % stride && item.source === 'grade' && item.objectives) { const { objectives: _, ...rest } = item; shed(index, rest); }
    });
  }
  for (const [index, item] of fitted.entries()) {
    if (total <= budget) break;
    if (item.source === 'map' && item.update) { const { update: _, ...rest } = item; shed(index, rest); }
  }
  return fitted;
}

export type LatencyStat = { count: number; p50: number; p90: number } | null;
export type ProducerSummary = {
  model: string; effort: 'none' | 'low'; version: string; mapPrompt: string; rankingRubric: string;
  maps: number; applied: number; turns: number; notes: number; research: number;
  latency: { sol: LatencyStat; jevTurn: LatencyStat; lookup: LatencyStat; noteToSam: LatencyStat; turnToSam?: LatencyStat };
};

export function latencyStat(values: number[]): LatencyStat {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)]!;
  return { count: sorted.length, p50: at(.5), p90: at(.9) };
}

export function producerLatency(records: ProducerLogRecord[]): ProducerSummary['latency'] {
  const spans = (pairs: [number | undefined, number | undefined][]) => pairs.flatMap(([from, to]) => from != null && to != null ? [to - from] : []);
  const of = <S extends ProducerLogRecord['source']>(source: S) => records.filter(item => item.source === source) as Extract<ProducerLogRecord, { source: S }>[];
  return {
    sol: latencyStat(spans(of('map').filter(item => item.outcome === 'applied').map(item => [item.startedAt, item.completedAt]))),
    jevTurn: latencyStat(spans(of('turn').filter(item => item.outcome === 'read').map(item => [item.startedAt, item.completedAt]))),
    lookup: latencyStat(spans(of('research').map(item => [item.requestedAt, item.lookupAt]))),
    noteToSam: latencyStat(spans(of('note').filter(item => item.kind === 'list' || item.kind === 'map').map(item => [item.sentAt, item.nextSamTurnAt]))),
  };
}
