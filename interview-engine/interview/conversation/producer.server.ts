import { modelName, type Providers } from '../../providers/providers.server';
import { callFailure } from '../../providers/diagnostics.server';
import { DirectorOutputError, type ModelUsage } from '../../providers/structured.server';
import type { InterviewBackground, InterviewObjectiveReading as Reading } from '../../shared/snapshot';
import { activeElapsed, type PauseSpan } from '../../shared/timing';
import type { WireEntry as TranscriptEntry, WireSpeaker } from '../wire';
import { emptyMap, type ConversationMap, type MapChanges } from './map';
import {
  appendMapLog, emptyMapLog, generateMap, MAP_EFFORT, MAP_PROMPT_VERSION, MapOutputError, researchLogEvent, unloggedPassages,
  type MapLog, type MappedSpec, type MapTail,
} from './map.server';
import { emptyListState, emptyMapNote, LIVE_NOTE_CHANNEL, mapNote, mapNoteKey, mapNoteResearch, nextListNote, type ListState } from './notes';
import { emptyRanking, observeMap, observeTurn, RANKING, threadKey, type Pick } from './ranking';
import { evaluateTurn, latestTurn, RANKING_RUBRIC_VERSION, said, upToParticipant } from './ranking.server';
import {
  deliveredBackground, PRODUCER_LIMITS, producerLatency, PRODUCER_VERSION,
  type MapRecord, type NoteRecord, type ProducerLogRecord, type ProducerSummary, type ResearchRecord, type ResearchRequest, type TurnRecord,
} from './records';
import { lookupInterviewBackground, researchKey, validateResearchRequest } from './research.server';
import { isBackchannel, yieldsTurn } from './turns';

type InterviewObjectiveReading = Reading<WireSpeaker>;
export const producerServices = { generateMap, evaluateTurn, lookupInterviewBackground };
type Options = {
  spec: MappedSpec;
  attemptId: string; startedAt: number;
  providers: Omit<Providers, 'voice' | 'telemetry' | 'log'>;
  services: typeof producerServices;
  /** Settled passages in order, stopping at the first still being transcribed. */
  settled: () => TranscriptEntry[]; coverage: () => InterviewObjectiveReading[];
  send: (event: Record<string, unknown>) => boolean; waitUntil?: (work: Promise<void>) => void;
  pauses?: () => PauseSpan[];
};
/** Keep the map, its cached input, and the audit log. Re-read the current turn after a restart. */
export type ProducerCheckpoint = { records: ProducerLogRecord[]; map: ConversationMap; log: MapLog; readThrough: number };

const LIMITS = PRODUCER_LIMITS;
const timedOut = (error: unknown) => error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const round = (value: number) => Math.round(value * 100) / 100;
const roundAll = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, round(value)]));
const usageOf = (usage: { inputTokens?: number; outputTokens?: number } | undefined): ModelUsage | undefined =>
  usage ? { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null } : undefined;
/** A turn is re-read when its words change, including same-length transcript corrections. */
const turnKey = (turn: TranscriptEntry[]) => JSON.stringify(turn.map(entry => [entry.id, entry.text]));
const compactChanges = ({ added, changed, dropped }: MapChanges) => ({ added, changed, dropped });
const RESEARCH_STATUS: Record<ResearchRecord['outcome'], string> = {
  pending: 'looking it up', found: 'found; see the event in the log', unresolved: 'found nothing reliable', invalid: 'rejected',
  duplicate: 'already requested', budget: 'no lookups left', busy: 'another lookup was running', timeout: 'failed', error: 'failed', aborted: 'failed',
};

/** Sol maintains the map; Jev reads settled turns; changed notes go straight to Sam's private channel. */
export class InterviewProducer {
  readonly records: ProducerLogRecord[] = [];
  private abort = new AbortController();
  private work = new Set<Promise<void>>();
  private map: ConversationMap = emptyMap();
  private mapRecord: MapRecord | null = null;
  private log: MapLog = emptyMapLog();
  private ranking = emptyRanking();
  private call: { record: MapRecord; controller: AbortController; unmapped: boolean } | null = null;
  private lastMapStart: number;
  private reasons = new Set<string>();
  /** A failed call logged input that the current map has not incorporated. */
  private behind = false;
  private turnBusy = false;
  private readTurnKey = '';
  private readMapId: string | null = null;
  private readThrough = 0;
  private list: ListState = emptyListState();
  private mapKey: string | null = null;
  private lookupBusy = false;
  private closed = false;
  private restating = false;

  constructor(private options: Options) { this.lastMapStart = options.startedAt; }
  private get alive() { return !this.abort.signal.aborted; }
  private elapsed(now: number) { return activeElapsed(this.options.startedAt, now, this.options.pauses?.()); }
  get conversationMap() { return this.map; }
  get rankingState() { return this.ranking; }
  publicBackground(): InterviewBackground[] { return deliveredBackground(this.records); }

  private get counts() {
    const of = (source: ProducerLogRecord['source']) => this.records.filter(record => record.source === source);
    return {
      maps: of('map').length, applied: this.records.filter(record => record.source === 'map' && record.outcome === 'applied').length,
      turns: of('turn').length, notes: of('note').length,
      research: this.records.filter(record => record.source === 'research' && !['invalid', 'duplicate', 'budget', 'busy'].includes(record.outcome)).length,
    };
  }
  private get budgetLeft() { const { maps, turns, research } = this.counts; return LIMITS.calls - maps - turns - research; }
  async settle() { while (this.work.size) await Promise.all([...this.work]); }
  private track(work: Promise<void>) {
    this.work.add(work);
    work.then(() => this.work.delete(work), () => this.work.delete(work));
    this.options.waitUntil?.(work);
  }

  tick(now = Date.now()) {
    if (!this.alive) return;
    if (this.call && now - this.call.record.startedAt >= LIMITS.mapTimeout) this.abandon(now);
    this.readTurn(now);
    this.startMap(now);
    if (!this.turnBusy) this.pick(now);
    this.sendMapNote(now);
  }
  private wake(reason: string) { if (this.alive) this.reasons.add(reason); }

  /** An abandoned call is dropped where it stands; a late result is ignored. */
  private abandon(now: number) {
    const { record, controller, unmapped } = this.call!;
    this.call = null;
    record.outcome = 'timeout';
    record.completedAt = now;
    this.behind ||= unmapped;
    controller.abort();
  }

  private startMap(now: number) {
    if (this.call || this.budgetLeft <= 0 || now - this.lastMapStart < LIMITS.mapFloor) return;
    const settled = [...this.options.settled()];
    const unlogged = new Set(unloggedPassages(this.log, settled).map(entry => entry.id));
    const fresh = settled.some((entry, index) => unlogged.has(entry.id) && said(settled, index));
    const events = this.pendingResearch();
    if (events.some(item => this.records.some(record => record.source === 'research' && record.id === item.researchId && record.outcome === 'found'))) this.reasons.add('public research arrived');
    if (now - this.lastMapStart >= LIMITS.mapTimer && (fresh || this.behind)) this.reasons.add('a minute has passed since your last call');
    if (!this.reasons.size) return;
    // A wake whose news an earlier call already logged has nothing left to say.
    if (!fresh && !this.behind && !events.length) { this.reasons.clear(); return; }
    const reasons = [...this.reasons];
    this.reasons.clear();
    const log = appendMapLog(this.options.spec, this.log, settled, events.map(item => item.event));
    this.log = log;
    this.lastMapStart = now;
    const record: MapRecord = {
      source: 'map', id: `map-${crypto.randomUUID()}`, reasons, startedAt: now, outcome: 'pending',
      inputCount: settled.length, lastInputId: settled.at(-1)?.id ?? null, model: modelName(this.options.providers.language.agent),
    };
    this.records.push(record);
    for (const { researchId } of events) {
      const research = this.records.find((item): item is ResearchRecord => item.source === 'research' && item.id === researchId);
      if (research) research.loggedAt = now;
    }
    const controller = new AbortController();
    const unmapped = fresh || this.behind || events.length > 0;
    this.call = { record, controller, unmapped };
    this.track(this.generate(record, controller, log, settled, now, unmapped)
      .finally(() => { if (this.call?.record === record) this.call = null; }));
  }

  private tail(settled: TranscriptEntry[], reasons: string[], now: number): MapTail {
    const reading = this.ranking.reading;
    const open = new Map(this.map.threads.filter(thread => thread.status === 'open').map(thread => [thread.id, thread]));
    const signals = reading ? Object.entries(reading.states).flatMap(([threadId, state]) => {
      const thread = open.get(threadId);
      return thread && state !== 'open' && reading.keys[threadId] === threadKey(thread) ? [{ threadId, state }] : [];
    }) : [];
    const research = this.records.filter((item): item is ResearchRecord => item.source === 'research');
    return {
      coverage: this.options.coverage(), signals, reasons, elapsedMs: this.elapsed(now), lastPassageId: settled.at(-1)?.id ?? null,
      research: {
        requests: research.map(item => ({ kind: item.request.kind, name: item.request.name, clue: item.request.clue,
          status: item.outcome === 'invalid' ? `rejected (${item.reason})` : RESEARCH_STATUS[item.outcome] })),
        left: Math.max(0, Math.min(LIMITS.research - this.counts.research, this.budgetLeft)),
      },
    };
  }

  private async generate(record: MapRecord, controller: AbortController, log: MapLog, settled: TranscriptEntry[], now: number, unmapped: boolean) {
    const { services, providers, attemptId } = this.options;
    const signal = AbortSignal.any([this.abort.signal, controller.signal, AbortSignal.timeout(LIMITS.mapTimeout)]);
    const live = () => this.alive && this.call?.record === record;
    let result: Awaited<ReturnType<typeof services.generateMap>>;
    try {
      result = await services.generateMap({
        spec: this.options.spec, structured: providers.structured, signal, attemptId, blocks: log.blocks, previous: this.map, tail: this.tail(settled, record.reasons, now), passages: settled,
        lookups: this.records.flatMap(item => item.source === 'research' && item.outcome === 'found' && item.eventId != null && item.loggedAt != null ? [item.eventId] : []),
      });
      if (!live()) return;
      signal.throwIfAborted();
    } catch (error) {
      if (!live()) return;
      record.failure = callFailure(error);
      if (error instanceof DirectorOutputError) record.usage = error.usage;
      if (error instanceof MapOutputError) Object.assign(record, { outcome: 'invalid', defects: error.defects.slice(0, 10), model: error.model, usage: error.usage } satisfies Partial<MapRecord>);
      else record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
      record.completedAt = Date.now();
      this.behind ||= unmapped;
      return;
    }
    // Outside the try: a failure after the map lands is not Sol's, so it neither fails this call nor leaves the map behind.
    Object.assign(record, {
      outcome: 'applied', completedAt: Date.now(), model: result.model, usage: result.usage,
      update: result.update, changes: compactChanges(result.changes), research: result.research,
    } satisfies Partial<MapRecord>);
    this.behind = false;
    this.map = result.map;
    this.mapRecord = record;
    this.ranking = observeMap(this.ranking, result.map);
    if (result.research) this.request(record, result.research, settled);
    this.sendMapNote(Date.now());
    // Jev scores the new gaps against the latest answer on the next tick.
  }

  private readTurn(now: number) {
    if (this.turnBusy || this.budgetLeft <= 0) return;
    const transcript = [...this.options.settled()];
    let settled: TranscriptEntry[] | null = null;
    let boundary = this.readThrough;
    for (let end = this.readThrough; end <= transcript.length; end++) {
      const next = transcript[end];
      if (next && (next.speaker !== 'client' || yieldsTurn(next.text))) continue;
      const candidate = upToParticipant(transcript.slice(0, end));
      const turn = latestTurn(candidate);
      if (!turn.length || turnKey(turn) === this.readTurnKey) continue;
      settled = candidate;
      boundary = end;
      break;
    }
    // A changed map gets a fresh score of the latest answer; unread answers take precedence.
    const mapId = this.mapRecord?.id ?? null;
    if (!settled && this.readMapId !== mapId) { settled = upToParticipant(transcript); boundary = transcript.length; }
    const turn = latestTurn(settled ?? []);
    if (!settled || !turn.length) return;
    this.readThrough = boundary;
    this.readTurnKey = turnKey(turn);
    this.readMapId = mapId;
    this.turnBusy = true;
    const record: TurnRecord = { source: 'turn', id: `turn-${crypto.randomUUID()}`, passageId: turn.at(-1)!.id, mapId, startedAt: now, outcome: 'pending' };
    this.records.push(record);
    this.track(this.evaluate(record, settled, now));
  }

  private async evaluate(record: TurnRecord, settled: TranscriptEntry[], now: number) {
    const scope = this.abort.signal;
    const signal = AbortSignal.any([scope, AbortSignal.timeout(LIMITS.turnTimeout)]);
    try {
      const result = await this.options.services.evaluateTurn({ transcript: settled, map: this.map, judge: this.options.providers.judge, signal, atMs: this.elapsed(now) });
      if (scope.aborted) return;
      signal.throwIfAborted();
      if (Date.now() - record.startedAt >= LIMITS.turnTimeout) { record.outcome = 'timeout'; return; }
      const { reading } = result;
      Object.assign(record, {
        outcome: 'read', durationMs: result.durationMs, usage: usageOf(result.usage),
        reading: {
          atMs: reading.atMs, focus: reading.focus, novel: round(reading.novel),
          ...(reading.feedback != null ? { feedback: round(reading.feedback) } : {}),
          natural: roundAll(reading.natural), states: reading.states,
        },
      } satisfies Partial<TurnRecord>);
      // Sol may have landed a different map while Jev read. The next tick reads against that map.
      if (record.mapId !== (this.mapRecord?.id ?? null)) return;
      this.ranking = observeTurn(this.ranking, this.map, reading, latestTurn(settled)[0]!.id);
      if ((reading.novel >= RANKING.novel || (reading.feedback ?? 0) >= RANKING.novel) && unloggedPassages(this.log, settled).some(entry => entry.speaker === 'trainee')) this.wake(`the participant's latest turn (${reading.passageId}) adds facts or feedback the map lacks`);
      record.pick = compactPick(this.pick(Date.now(), record));
    } catch (error) {
      if (scope.aborted) return;
      record.failure = callFailure(error);
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
    } finally {
      if (!scope.aborted) { record.completedAt = Date.now(); this.turnBusy = false; }
    }
  }

  private pick(now: number, turn?: TurnRecord): Pick {
    const decision = nextListNote(this.map, this.ranking, this.list);
    if (!decision.text || this.note('list', decision.text, now, { turn }) === 'sent') this.list = decision.state;
    return decision.pick;
  }

  private sendMapNote(now: number) {
    if (!this.mapRecord) return;
    const key = mapNoteKey(this.map);
    if (key === this.mapKey) return;
    const text = mapNote(this.map) ?? (this.records.some(record => record.source === 'note' && record.kind === 'map') ? emptyMapNote() : null);
    if (!text) { this.mapKey = key; return; }
    const cited = new Set(mapNoteResearch(this.map).map(entity => entity.passageId));
    const researchIds = this.records.flatMap(item => item.source === 'research' && item.outcome === 'found' && item.eventId != null && cited.has(item.eventId) ? [item.id] : []);
    if (this.note('map', text, now, { researchIds }) === 'sent') this.mapKey = key;
  }

  private note(kind: NoteRecord['kind'], text: string, now: number, { turn, researchIds = [] }: { turn?: TurnRecord; researchIds?: string[] } = {}): NoteRecord['outcome'] | null {
    if (!this.restating && this.counts.notes >= LIMITS.notes) return null;
    const id = `note-${crypto.randomUUID()}`;
    const record: NoteRecord = {
      source: 'note', id, kind, text, mapId: this.mapRecord?.id ?? null, ...(turn ? { turnId: turn.id } : {}), sentAt: now, outcome: 'sent',
      delivery: { eventId: id, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' },
      ...(researchIds.length ? { researchIds } : {}),
    };
    this.records.push(record);
    if (!this.options.send({ type: LIVE_NOTE_CHANNEL, event_id: id, delegation_id: null, content: text })) record.outcome = 'error';
    return record.outcome;
  }

  /** Completed lookups not yet appended to Sol's input; recoverable from the audit log. */
  private pendingResearch() {
    return this.records.flatMap(record => record.source === 'research' && record.eventId != null && record.loggedAt == null
      ? [{ researchId: record.id, event: { id: record.eventId, atMs: record.lookupAt! - this.options.startedAt,
        text: researchLogEvent(record.request, record.facts ?? null, record.reason) } }] : []);
  }

  private request(map: MapRecord, request: ResearchRequest, settled: TranscriptEntry[]) {
    const record: ResearchRecord = { source: 'research', id: `research-${crypto.randomUUID()}`, mapId: map.id, request, model: modelName(this.options.providers.language.fast), requestedAt: Date.now(), outcome: 'pending' };
    const refuse = (outcome: ResearchRecord['outcome'], reason: string) => { record.outcome = outcome; record.reason = reason; record.completedAt = Date.now(); this.records.push(record); };
    const valid = validateResearchRequest(request, settled);
    if (!valid.ok) return refuse('invalid', valid.reason);
    record.request = valid.request;
    const key = researchKey(valid.request);
    if (this.records.some(item => item.source === 'research' && ['pending', 'found', 'unresolved'].includes(item.outcome) && researchKey(item.request) === key)) return refuse('duplicate', 'duplicate');
    if (this.budgetLeft <= 0 || this.counts.research >= LIMITS.research) return refuse('budget', 'budget');
    if (this.lookupBusy) return refuse('busy', 'busy');
    this.records.push(record);
    this.lookupBusy = true;
    const scope = this.abort.signal;
    this.track(this.research(record).finally(() => { if (!scope.aborted) this.lookupBusy = false; }));
  }

  /** A found lookup wakes Sol; one that found nothing waits in the log for Sol's next call. */
  private async research(record: ResearchRecord) {
    const { kind, name, clue } = record.request;
    const scope = this.abort.signal;
    const signal = AbortSignal.any([scope, AbortSignal.timeout(LIMITS.lookupTimeout)]);
    try {
      const lookup = await this.options.services.lookupInterviewBackground({ target: { kind, name }, clue, model: this.options.providers.language.fast, signal });
      if (scope.aborted) return;
      signal.throwIfAborted();
      const now = Date.now();
      record.lookupAt = now;
      record.queries = lookup.queries;
      if (lookup.status === 'found') Object.assign(record, { outcome: 'found', facts: lookup.facts, retrievedAt: lookup.retrievedAt } satisfies Partial<ResearchRecord>);
      else Object.assign(record, { outcome: 'unresolved', reason: lookup.reason } satisfies Partial<ResearchRecord>);
      const facts = lookup.status === 'found' ? lookup.facts : null;
      record.eventId = `L${this.records.filter(item => item.source === 'research' && item.eventId != null).length + 1}`;
      if (facts?.length) this.wake(`public research arrived about the ${kind} "${name}"`);
    } catch (error) {
      if (scope.aborted) return;
      record.failure = callFailure(error);
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
    } finally {
      if (!scope.aborted) record.completedAt = Date.now();
    }
  }

  /** Marks the next substantive Sam passage; it does not claim Sam acted on the note. */
  transcriptChanged(entry: TranscriptEntry, previousId: string | null, now = Date.now()) {
    if (!this.alive || entry.speaker !== 'client' || !entry.text.trim() || isBackchannel(entry.text)) return;
    for (const record of this.records) {
      if (record.source === 'note' && record.outcome === 'sent' && record.sentAt <= now && record.delivery.afterPassageId !== entry.id && record.nextSamTurnAt == null) {
        record.nextSamTurnAt = now;
        record.nextSamTurnAfterId = previousId;
      }
    }
  }

  /** Only the latest note of its kind can be retried. Rejection never re-enters send synchronously. */
  providerEvent(id: string, accepted: boolean, timing?: { startMs?: number; endMs?: number }) {
    if (!this.alive) return;
    const record = this.records.find((item): item is NoteRecord => item.source === 'note' && item.delivery.eventId === id);
    if (!record) return;
    Object.assign(record.delivery, { status: accepted ? 'accepted' : 'rejected', acknowledgedAt: Date.now() }, timing);
    if (accepted) return;
    record.outcome = 'rejected';
    if (this.records.findLast(item => item.source === 'note' && item.kind === record.kind) !== record) return;
    if (record.kind === 'list') this.list.key = null;
    if (record.kind === 'map') this.mapKey = null;
  }

  delegation(id: string, target: string | null, replied: boolean) {
    if (this.alive) this.records.push({ source: 'delegation', id, createdAt: Date.now(), target, replied });
  }

  summary(): ProducerSummary {
    return {
      model: modelName(this.options.providers.language.agent), effort: MAP_EFFORT, version: PRODUCER_VERSION,
      mapPrompt: MAP_PROMPT_VERSION, rankingRubric: RANKING_RUBRIC_VERSION,
      ...this.counts, latency: producerLatency(this.records),
    };
  }

  pause() {
    this.abort.abort();
    this.call?.controller.abort();
    this.call = null;
    this.turnBusy = this.lookupBusy = false;
    this.release(Date.now());
  }

  /** The new voice session has the transcript but no private notes. */
  resume(now = Date.now()) {
    if (this.closed || this.alive) return;
    this.abort = new AbortController();
    this.mapKey = null;
    this.list = emptyListState();
    this.restating = true;
    try { this.sendMapNote(now); this.pick(now); }
    finally { this.restating = false; }
  }

  checkpoint(): ProducerCheckpoint {
    return { records: this.records, map: this.map, log: this.log, readThrough: this.readThrough };
  }

  restore(checkpoint: ProducerCheckpoint) {
    this.pause();
    this.records.splice(0, this.records.length, ...checkpoint.records);
    this.map = checkpoint.map;
    this.mapRecord = this.records.findLast((item): item is MapRecord => item.source === 'map' && item.outcome === 'applied') ?? null;
    this.log = checkpoint.log;
    const lastMap = this.records.findLast((item): item is MapRecord => item.source === 'map');
    this.lastMapStart = lastMap?.startedAt ?? this.options.startedAt;
    this.behind = lastMap != null && lastMap.outcome !== 'applied';
    this.readThrough = checkpoint.readThrough;
    this.readTurnKey = '';
    this.ranking = emptyRanking();
    this.readMapId = null;
    this.reasons.clear();
    this.release(Date.now());
  }

  /** Pending paid work was lost; its results must never reach a replacement voice session. */
  private release(now: number) {
    for (const record of this.records) {
      if (!(record.source === 'map' || record.source === 'turn' || record.source === 'research') || record.outcome !== 'pending') continue;
      if (record.source === 'map') this.behind = true;
      if (record.source === 'turn') this.readTurnKey = '';
      record.outcome = 'aborted';
      record.completedAt ??= now;
    }
  }

  close() { this.closed = true; this.pause(); this.reasons.clear(); }
}

function compactPick(pick: Pick): NonNullable<TurnRecord['pick']> {
  return { ...pick, ranked: pick.ranked.map(item => [item.id, round(item.score), item.band]) };
}
