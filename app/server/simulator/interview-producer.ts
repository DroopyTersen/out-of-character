import {
  appendMapLog, emptyMapLog, generateMap, MAP_EFFORT, MAP_PROMPT_VERSION, MapOutputError, researchLogEvent, unloggedPassages,
  type MapLog, type MapLogEvent, type MapTail,
} from '../../../ai/interview/map.server';
import { evaluateTraits, evaluateTurn, latestTurn, RANKING_RUBRIC_VERSION } from '../../../ai/interview/ranking.server';
import { lookupInterviewBackground, researchKey, validateResearchRequest } from '../../../ai/interview/research.server';
import type { FoundryConfig } from '../../../ai/foundry.server';
import { isBackchannel, type InterviewBackground, type InterviewObjectiveReading } from '../../../core/interview';
import { emptyMap, type ConversationMap, type MapChanges } from '../../../core/interview-map';
import { emptyListNote, LIVE_NOTE_CHANNEL, listNote, listNoteKey, mapNote, mapNoteKey, NOTE_HEADERS, noteHeaders, type NoteChannel } from '../../../core/interview-notes';
import {
  deliveredBackground, PRODUCER_LIMITS, producerLatency, PRODUCER_VERSION,
  type MapRecord, type NoteRecord, type ProducerLogRecord, type ProducerSummary, type ResearchRecord, type ResearchRequest, type TraitRecord, type TurnRecord,
} from '../../../core/interview-producer';
import {
  emptyRanking, observeMap, observeTurn, pickThreads, RANKING, threadKey, threadsNeedingTraits, withTraits, type Pick, type RankingState,
} from '../../../core/interview-ranking';
import type { DirectorUsage } from '../../../core/simulator/director';
import type { TranscriptEntry } from '../../../core/simulator/types';

export const producerServices = { generateMap, evaluateTurn, evaluateTraits, lookupInterviewBackground };
type Options = {
  attemptId: string; startedAt: number; foundry: FoundryConfig; typesafeKey: string; services: typeof producerServices;
  /** The settled passages in transcript order, stopping at the first one still being transcribed. */
  settled: () => TranscriptEntry[]; coverage: () => InterviewObjectiveReading[];
  send: (event: Record<string, unknown>) => boolean; waitUntil?: (work: Promise<void>) => void;
  /** Defaults to the live channel; each channel has its own note headers. */
  channel?: NoteChannel;
};

const LIMITS = PRODUCER_LIMITS;
const timedOut = (error: unknown) => error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const round = (value: number) => Math.round(value * 100) / 100;
const roundAll = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, round(value)]));
const usageOf = (usage: { inputTokens?: number; outputTokens?: number } | undefined): DirectorUsage | undefined =>
  usage ? { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null } : undefined;
const spoken = (entry: TranscriptEntry) => entry.speaker === 'trainee' && !isBackchannel(entry.text);
/** A turn is re-read when it gains a passage or its text grows. */
const turnKey = (turn: TranscriptEntry[]) => turn.map(entry => `${entry.id}:${entry.text.length}`).join(',');
const compactChanges = ({ added, changed, dropped }: MapChanges) => ({ added, changed, dropped });
const RESEARCH_STATUS: Record<ResearchRecord['outcome'], string> = {
  pending: 'looking it up', found: 'found; see the event in the log', unresolved: 'found nothing reliable', invalid: 'rejected',
  duplicate: 'already requested', budget: 'no lookups left', busy: 'another lookup was running', timeout: 'failed', error: 'failed', aborted: 'failed',
};

/**
 * The interview's producer. Sol keeps the conversation map, one call at a time; wake reasons that arrive meanwhile merge
 * into the next call, which reads the transcript as of its start. Jev reads each settled participant turn against the
 * map's open threads, and code picks threads and sends Sam the list and map notes. Luna's lookups come back to Sol as
 * log events. Owns Sam's private notes only, never audio, grades or the session snapshot.
 */
export class InterviewProducer {
  readonly records: ProducerLogRecord[] = [];
  private abort = new AbortController();
  private work = new Set<Promise<void>>();
  private map: ConversationMap = emptyMap();
  /** The Sol call whose map is applied. */
  private mapRecord: MapRecord | null = null;
  private log: MapLog = emptyMapLog();
  private ranking: RankingState = emptyRanking();
  private call: { record: MapRecord; controller: AbortController; unmapped: boolean } | null = null;
  private lastMapStart: number;
  private reasons = new Set<string>();
  private events: { event: MapLogEvent; researchId: string }[] = [];
  /** A failed call logged participant text or events the map doesn't reflect yet. */
  private behind = false;
  private turnBusy = false;
  private readTurnKey = '';
  /** The first passage of the turn last read, so a re-read of a grown turn isn't counted as a new one. */
  private readTurnStart: string | null = null;
  private traitsBusy = false;
  /** Thread wording whose trait read failed; not retried until Sol's next applied map, so a failing read can't loop. */
  private traitFailures = new Map<string, string>();
  private listKey: string | null = null;
  private listSent = false;
  private mapKey: string | null = null;
  private lastMapNote: number | null = null;
  private samTurns = new Set<string>();
  private researched = new Set<string>();
  private lookups = 0;
  private counts = { maps: 0, applied: 0, turns: 0, traits: 0, notes: 0, research: 0 };

  constructor(private options: Options) { this.lastMapStart = options.startedAt; }

  private get alive() { return !this.abort.signal.aborted; }
  private elapsed(now: number) { return now - this.options.startedAt; }
  /** Read-only views for tests and probes. */
  get conversationMap() { return this.map; }
  get rankingState() { return this.ranking; }
  publicBackground(): InterviewBackground[] { return deliveredBackground(this.records); }

  /** Waits for all in-flight calls, including follow-ups they start. */
  async settle() { while (this.work.size) await Promise.all([...this.work]); }

  private track(work: Promise<void>) {
    this.work.add(work);
    work.then(() => this.work.delete(work), () => this.work.delete(work));
    this.options.waitUntil?.(work);
  }

  /** Called on the session tick: reads a new participant turn, starts a due Sol call, sends a held map note. */
  tick(now = Date.now()) {
    if (!this.alive) return;
    if (this.call && now - this.call.record.startedAt >= LIMITS.mapTimeout) this.abandon(now);
    this.readTurn(now);
    this.startMap(now);
    this.sendMapNote(now);
  }

  private wake(reason: string) { if (this.alive) this.reasons.add(reason); }

  // ---- Sol ----

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
    if (this.call || this.counts.maps >= LIMITS.mapCalls || now - this.lastMapStart < LIMITS.mapFloor) return;
    const settled = [...this.options.settled()];
    const fresh = unloggedPassages(this.log, settled).some(spoken);
    if (now - this.lastMapStart >= LIMITS.mapTimer && (fresh || this.behind)) this.reasons.add('a minute has passed since your last call');
    if (!this.reasons.size) return;
    // A wake whose news an earlier call already logged has nothing left to say.
    if (!fresh && !this.behind && !this.events.length) { this.reasons.clear(); return; }
    const reasons = [...this.reasons];
    this.reasons.clear();
    const events = this.events;
    this.events = [];
    const log = appendMapLog(this.log, settled, events.map(item => item.event));
    this.log = log;
    this.lastMapStart = now;
    this.counts.maps++;
    const record: MapRecord = {
      source: 'map', id: `map-${crypto.randomUUID()}`, reasons, startedAt: now, outcome: 'pending',
      inputCount: settled.length, lastInputId: settled.at(-1)?.id ?? null, model: this.options.foundry.agentModel,
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
        left: Math.max(0, LIMITS.research - this.counts.research),
      },
    };
  }

  private async generate(record: MapRecord, controller: AbortController, log: MapLog, settled: TranscriptEntry[], now: number, unmapped: boolean) {
    const { services, foundry, attemptId } = this.options;
    const signal = AbortSignal.any([this.abort.signal, controller.signal, AbortSignal.timeout(LIMITS.mapTimeout)]);
    const live = () => this.alive && this.call?.record === record;
    let result: Awaited<ReturnType<typeof services.generateMap>>;
    try {
      result = await services.generateMap({
        foundry, signal, attemptId, blocks: log.blocks, previous: this.map, tail: this.tail(settled, record.reasons, now), passages: settled,
      });
      if (!live()) return;
      signal.throwIfAborted();
    } catch (error) {
      if (!live()) return;
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
    this.counts.applied++;
    this.behind = false;
    this.map = result.map;
    this.mapRecord = record;
    this.traitFailures.clear();
    this.ranking = observeMap(this.ranking, result.map, this.elapsed(record.startedAt));
    if (result.research) this.request(record, result.research, settled);
    this.pick(Date.now());
    this.sendMapNote(Date.now());
    this.readTraits();
  }

  // ---- Jev and the list note ----

  private readTurn(now: number) {
    if (this.turnBusy || this.counts.turns >= LIMITS.turns) return;
    const settled = [...this.options.settled()];
    const turn = latestTurn(settled);
    const key = turnKey(turn);
    if (!turn.length || key === this.readTurnKey) return;
    this.readTurnKey = key;
    const regrown = this.readTurnStart === turn[0]!.id;
    this.readTurnStart = turn[0]!.id;
    this.turnBusy = true;
    this.counts.turns++;
    const record: TurnRecord = { source: 'turn', id: `turn-${crypto.randomUUID()}`, passageId: turn.at(-1)!.id, mapId: this.mapRecord?.id ?? null, startedAt: now, outcome: 'pending' };
    this.records.push(record);
    this.track(this.evaluate(record, settled, now, regrown).finally(() => { this.turnBusy = false; }));
  }

  private async evaluate(record: TurnRecord, settled: TranscriptEntry[], now: number, regrown: boolean) {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(LIMITS.turnTimeout)]);
    try {
      const result = await this.options.services.evaluateTurn({ transcript: settled, map: this.map, apiKey: this.options.typesafeKey, signal, atMs: this.elapsed(now) });
      if (!this.alive) return;
      signal.throwIfAborted();
      if (Date.now() - record.startedAt >= LIMITS.turnTimeout) { record.outcome = 'timeout'; return; }
      const { reading } = result;
      Object.assign(record, {
        outcome: 'read', durationMs: result.durationMs, usage: usageOf(result.usage),
        reading: { atMs: reading.atMs, focus: reading.focus, novel: round(reading.novel), natural: roundAll(reading.natural), states: reading.states },
      } satisfies Partial<TurnRecord>);
      this.ranking = observeTurn(this.ranking, this.map, reading, regrown);
      if (reading.novel >= RANKING.novel) this.wake(`the participant's latest turn (${reading.passageId}) adds something the map lacks`);
      record.pick = compactPick(this.pick(Date.now(), record));
    } catch (error) {
      if (!this.alive) return;
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
    } finally {
      if (this.alive) record.completedAt = Date.now();
    }
  }

  /** Threads Sol added or rewrote get one trait read; the pick is redone when it lands. */
  private readTraits() {
    if (!this.alive || this.traitsBusy || this.counts.traits >= LIMITS.traits) return;
    const threads = threadsNeedingTraits(this.map, this.ranking).filter(thread => this.traitFailures.get(thread.id) !== threadKey(thread));
    if (!threads.length) return;
    this.traitsBusy = true;
    this.counts.traits++;
    const record: TraitRecord = { source: 'traits', id: `traits-${crypto.randomUUID()}`, mapId: this.mapRecord?.id ?? null, threadIds: threads.map(thread => thread.id), startedAt: Date.now(), outcome: 'pending' };
    this.records.push(record);
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(LIMITS.traitTimeout)]);
    const map = this.map;
    this.track((async () => {
      try {
        const result = await this.options.services.evaluateTraits({ map, threads, apiKey: this.options.typesafeKey, signal });
        if (!this.alive) return;
        signal.throwIfAborted();
        Object.assign(record, {
          outcome: 'read', durationMs: result.durationMs, usage: usageOf(result.usage),
          traits: Object.fromEntries(Object.entries(result.traits).map(([id, item]) => [id, [round(item.spicy), round(item.grounding)]])),
        } satisfies Partial<TraitRecord>);
        this.ranking = withTraits(this.ranking, result.traits);
        this.pick(Date.now());
      } catch (error) {
        if (!this.alive) return;
        record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
        for (const thread of threads) this.traitFailures.set(thread.id, threadKey(thread));
      } finally {
        if (this.alive) record.completedAt = Date.now();
        this.traitsBusy = false;
      }
      // Sol may have rewritten threads while this read ran.
      this.readTraits();
    })());
  }

  /** Re-picks after a turn reading, a new map or new traits; a list note goes out only when its key changes. */
  private pick(now: number, turn?: TurnRecord): Pick {
    const pick = pickThreads(this.map, this.ranking, this.elapsed(now));
    const key = listNoteKey(this.map, pick);
    if (key === this.listKey) return pick;
    const headers = noteHeaders(this.options.channel);
    const text = listNote(this.map, pick, headers) ?? (this.listSent ? emptyListNote(headers) : null);
    if (!text) { this.listKey = key; return pick; }
    const note = this.note('list', text, now, turn);
    if (note?.outcome === 'sent') { this.listKey = key; this.listSent = true; }
    return pick;
  }

  // ---- The map note ----

  private sendMapNote(now: number) {
    if (!this.mapRecord || (this.lastMapNote != null && now - this.lastMapNote < LIMITS.mapNoteSpacing)) return;
    const key = mapNoteKey(this.map);
    if (key === this.mapKey) return;
    const text = mapNote(this.map, noteHeaders(this.options.channel));
    if (!text) { this.mapKey = key; return; }
    // Sol had read every lookup logged when this map's call started.
    const startedAt = this.mapRecord.startedAt;
    const researchIds = text.includes('\nPublic background') ? this.records.flatMap(item =>
      item.source === 'research' && item.outcome === 'found' && item.loggedAt != null && item.loggedAt <= startedAt ? [item.id] : []) : [];
    const note = this.note('map', text, now, undefined, researchIds);
    if (!note) return;
    this.lastMapNote = now;
    if (note.outcome === 'sent') this.mapKey = key;
  }

  // Set delivery before sending: an acknowledgment may arrive immediately.
  private note(kind: NoteRecord['kind'], text: string, now: number, turn?: TurnRecord, researchIds: string[] = []): NoteRecord | null {
    if (this.counts.notes >= LIMITS.notes) return null;
    this.counts.notes++;
    const id = `note-${crypto.randomUUID()}`;
    const record: NoteRecord = {
      source: 'note', id, kind, text, mapId: this.mapRecord?.id ?? null, ...(turn ? { turnId: turn.id } : {}), sentAt: now, outcome: 'sent',
      delivery: { eventId: id, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' },
      ...(researchIds.length ? { researchIds } : {}),
    };
    this.records.push(record);
    const sent = this.options.send({ type: this.options.channel ?? LIVE_NOTE_CHANNEL, event_id: id, delegation_id: null, content: text });
    if (!sent) record.outcome = 'error';
    return record;
  }

  // ---- Research ----

  private request(map: MapRecord, request: ResearchRequest, settled: TranscriptEntry[]) {
    const record: ResearchRecord = { source: 'research', id: `research-${crypto.randomUUID()}`, mapId: map.id, request, model: this.options.foundry.fastModel, requestedAt: Date.now(), outcome: 'pending' };
    this.records.push(record);
    const refuse = (outcome: ResearchRecord['outcome'], reason: string) => { record.outcome = outcome; record.reason = reason; record.completedAt = Date.now(); };
    const valid = validateResearchRequest(request, settled);
    if (!valid.ok) return refuse('invalid', valid.reason);
    record.request = valid.request;
    const key = researchKey(valid.request);
    if (this.researched.has(key)) return refuse('duplicate', 'duplicate');
    if (this.counts.research >= LIMITS.research) return refuse('budget', 'budget');
    if (this.lookups) return refuse('busy', 'busy');
    this.researched.add(key);
    this.counts.research++;
    this.lookups++;
    this.track(this.research(record, key).finally(() => { this.lookups--; }));
  }

  /** A found lookup wakes Sol; one that found nothing waits in the log for Sol's next call. */
  private async research(record: ResearchRecord, key: string) {
    const { kind, name, clue } = record.request;
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(LIMITS.lookupTimeout)]);
    try {
      const lookup = await this.options.services.lookupInterviewBackground({ target: { kind, name }, clue, foundry: this.options.foundry, signal });
      if (!this.alive) return;
      signal.throwIfAborted();
      const now = Date.now();
      record.lookupAt = now;
      record.queries = lookup.queries;
      if (lookup.status === 'found') Object.assign(record, { outcome: 'found', facts: lookup.facts, retrievedAt: lookup.retrievedAt } satisfies Partial<ResearchRecord>);
      else Object.assign(record, { outcome: 'unresolved', reason: lookup.reason } satisfies Partial<ResearchRecord>);
      const facts = lookup.status === 'found' ? lookup.facts : null;
      this.events.push({ researchId: record.id, event: { atMs: this.elapsed(now), text: researchLogEvent({ kind, name }, facts, lookup.status === 'unresolved' ? lookup.reason : undefined) } });
      if (facts?.length) this.wake(`public research arrived about the ${kind} "${name}"`);
    } catch (error) {
      if (!this.alive) return;
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
      // A transient failure may be requested again; it still used an attempt.
      this.researched.delete(key);
    } finally {
      if (this.alive) record.completedAt = Date.now();
    }
  }

  // ---- Session events ----

  /** Marks the next substantive Sam passage after a sent note, not whether Sam acted on it. A growing passage counts once it is more than a backchannel. */
  transcriptChanged(entry: TranscriptEntry, previousId: string | null, now = Date.now()) {
    if (!this.alive || entry.speaker !== 'client' || this.samTurns.has(entry.id) || isBackchannel(entry.text)) return;
    this.samTurns.add(entry.id);
    for (const record of this.records) {
      if (record.source === 'note' && record.outcome === 'sent' && record.sentAt <= now && record.nextSamTurnAt == null) {
        record.nextSamTurnAt = now;
        record.nextSamTurnAfterId = previousId;
      }
    }
  }

  /** A rejected note is sent again at the next change: the list note on the next pick, the map note after its spacing. One a newer note of its kind already replaced is not. */
  providerEvent(id: string, accepted: boolean, timing?: { startMs?: number; endMs?: number }) {
    if (!this.alive) return;
    const record = this.records.find((item): item is NoteRecord => item.source === 'note' && item.delivery.eventId === id);
    if (!record) return;
    record.delivery.status = accepted ? 'accepted' : 'rejected';
    record.delivery.acknowledgedAt = Date.now();
    if (timing) Object.assign(record.delivery, timing);
    if (accepted) return;
    record.outcome = 'rejected';
    if (this.records.findLast(item => item.source === 'note' && item.kind === record.kind) !== record) return;
    if (record.kind === 'list') this.listKey = null;
    else this.mapKey = null;
  }

  delegation(id: string, target: string | null, replied: boolean) {
    if (this.alive) this.records.push({ source: 'delegation', id, createdAt: Date.now(), target, replied });
  }

  summary(): ProducerSummary {
    const { maps, applied, turns, notes, research } = this.counts;
    return {
      model: this.options.foundry.agentModel, effort: MAP_EFFORT, version: PRODUCER_VERSION, mapPrompt: MAP_PROMPT_VERSION, rankingRubric: RANKING_RUBRIC_VERSION,
      maps, applied, turns, notes, research, latency: producerLatency(this.records),
    };
  }

  close() {
    this.abort.abort();
    this.call = null;
    this.reasons.clear();
    const now = Date.now();
    for (const record of this.records) {
      if ((record.source === 'map' || record.source === 'turn' || record.source === 'traits' || record.source === 'research') && record.outcome === 'pending') {
        record.outcome = 'aborted';
        record.completedAt = now;
      }
    }
  }
}

function compactPick(pick: Pick): NonNullable<TurnRecord['pick']> {
  return { ...pick, ranked: pick.ranked.map(item => [item.id, round(item.score), item.band]) };
}

/** Exposed for the delivery probe, which sends the same notes outside a session. */
export const NOTE_KINDS = Object.keys(NOTE_HEADERS) as NoteRecord['kind'][];
