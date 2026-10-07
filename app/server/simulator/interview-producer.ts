import {
  appendMapLog, emptyMapLog, generateMap, MAP_EFFORT, MAP_PROMPT_VERSION, MapOutputError, researchLogEvent, unloggedPassages,
  type MapLog, type MapLogEvent, type MapTail,
} from '../../../ai/interview/map.server';
import { evaluateTraits, evaluateTurn, latestTurn, RANKING_RUBRIC_VERSION, said, upToParticipant } from '../../../ai/interview/ranking.server';
import { lookupInterviewBackground, researchKey, validateResearchRequest } from '../../../ai/interview/research.server';
import type { FoundryConfig } from '../../../ai/foundry.server';
import { callFailure } from '../../../ai/interview/diagnostics.server';
import { DirectorOutputError } from '../../../ai/simulator/sol.server';
import {
  asksToEnd, finishesTurn, isBackchannel, listeningMode, spokenWords, yieldsTurn, type InterviewBackground, type InterviewObjectiveReading, type ListeningMode,
} from '../../../core/interview';
import { emptyMap, type ConversationMap, type MapChanges, type MapPace } from '../../../core/interview-map';
import {
  CANCEL_NOTE, emptyListState, emptyMapNote, HOLD_NOTES, LIVE_NOTE_CHANNEL, mapNote, mapNoteKey, mapNoteResearch, nextListNote, NOTE_HEADERS, noteHeaders, TURN_NOTE,
  type ListState, type NoteChannel,
} from '../../../core/interview-notes';
import {
  deliveredBackground, PRODUCER_LIMITS, producerLatency, PRODUCER_VERSION,
  type MapRecord, type NoteRecord, type ProducerLogRecord, type ProducerSummary, type ResearchRecord, type ResearchRequest, type TraitRecord, type TurnRecord,
} from '../../../core/interview-producer';
import {
  emptyRanking, observeMap, observeTurn, pickThreads, RANKING, threadKey, threadsNeedingTraits, withTraits, type Pick, type RankingState, type TurnReading,
} from '../../../core/interview-ranking';
import type { DirectorUsage } from '../../../core/simulator/director';
import { activeElapsed, type PauseSpan } from '../../../core/simulator/state';
import { SPEECH_QUIET_MS, type TranscriptEntry } from '../../../core/simulator/types';

export const producerServices = { generateMap, evaluateTurn, evaluateTraits, lookupInterviewBackground };
type Options = {
  attemptId: string; startedAt: number; foundry: FoundryConfig; typesafeKey: string; services: typeof producerServices;
  /** The settled passages in transcript order, stopping at the first one still being transcribed. */
  settled: () => TranscriptEntry[]; coverage: () => InterviewObjectiveReading[];
  send: (event: Record<string, unknown>) => boolean; waitUntil?: (work: Promise<void>) => void;
  /** Defaults to the live channel; each channel has its own note headers. */
  channel?: NoteChannel;
  /** Connection pauses; elapsed time excludes them. */
  pauses?: () => PauseSpan[];
  /** Whether the participant is speaking or their latest words are still settling; a turn's new pick waits until they stop. */
  talking?: () => boolean;
  /** When either side was last heard, transcribed or not; without it Sam is never told the turn is theirs. */
  heard?: () => number;
  /** Sends each note as soon as it's decided rather than at Sam's next words: for tests of what is sent, not when. */
  immediate?: boolean;
  /** How Sam listens through the participant's pauses. Without a mode, only the silence watchdog times Sam's turn. */
  listening?: ListeningMode;
  /** The whole transcript, settling or not: the listening window closes on the participant's latest words. */
  transcript?: () => TranscriptEntry[];
};
type Counts = { maps: number; applied: number; turns: number; traits: number; notes: number; research: number; holds: number; handovers: number; cancels: number };
/** Hold, handover and cancel counts are absent on checkpoints saved before the listening hold. */
type SavedCounts = Omit<Counts, 'holds' | 'handovers' | 'cancels'> & Partial<Counts>;
/** What the browser last heard, in server time: when the participant's microphone and Sam's audio were last loud, and whether each still is. */
type Hearing = { inputAt: number | null; inputActive: boolean; outputAt: number | null; outputActive: boolean };
const unheard = (): Hearing => ({ inputAt: null, inputActive: false, outputAt: null, outputActive: false });
/**
 * The participant's floor, from when their microphone was last loud. `owed`: Sam has said nothing substantive since.
 * `clear`: it began while Sam was inaudible, so it isn't Sam's own audio heard back. `held`: this pause has its hold
 * note. `handed`: it has its turn note. `mark` is where Sam's latest passage stood then; `sam` is Sam's words since, by passage.
 */
type Floor = { owed: boolean; clear: boolean; held: boolean; handed: boolean; mark: { id: string; length: number } | null; sam: Map<string, string> };
const idleFloor = (): Floor => ({ owed: false, clear: false, held: false, handed: false, mark: null, sam: new Map() });
type NoteMarks = { wake?: true; handover?: true; quietMs?: number };
type PendingEvent = { event: MapLogEvent; researchId: string };
/** A decided note waiting for Sam's next words. */
type HeldNote = { text: string; decidedAt: number; mapId: string | null; turnId?: string; researchIds: string[]; offer: boolean };
/**
 * Sol's latest pace call. A grant to offer stopping is spent once the participant answers an offer (a turn after
 * `offeredAfter`), or says something the map lacks after the transcript Sol judged (a turn after `inputId`).
 */
type PaceState = MapPace & { mapId: string; inputId: string | null; offeredAfter?: string | null; spent?: 'answered' | 'novel' };
/** Producer state that outlives the isolate. In-flight work is not kept: a restored producer starts idle. */
export type ProducerCheckpoint = {
  records: ProducerLogRecord[]; counts: SavedCounts;
  map: ConversationMap; mapRecordId: string | null; log: MapLog; ranking: RankingState;
  lastMapStart: number; reasons: string[]; events: PendingEvent[]; behind: boolean;
  /** Absent on checkpoints saved before two fairly new turns woke Sol. */
  novelTurns?: string[];
  readTurnKey: string; readThrough: number; traitFailures: [string, string][];
  /** Absent on checkpoints saved before the lead in force was kept. */
  list: ListState; deferredTurnId?: string | null;
  mapKey: string | null; lastMapNote: number | null;
  samTurns: string[]; researched: string[];
  /** Absent on checkpoints saved before Sol judged pace. `lastOffer` is in active time. */
  pace?: PaceState | null; lastOffer?: number | null;
  /** Absent on checkpoints saved before turn notes. */
  woken?: string[];
};

const LIMITS = PRODUCER_LIMITS;
const timedOut = (error: unknown) => error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const round = (value: number) => Math.round(value * 100) / 100;
const roundAll = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, round(value)]));
const usageOf = (usage: { inputTokens?: number; outputTokens?: number } | undefined): DirectorUsage | undefined =>
  usage ? { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null } : undefined;
/** A turn is re-read when its words change, including same-length transcript corrections. */
const turnKey = (turn: TranscriptEntry[]) => JSON.stringify(turn.map(entry => [entry.id, entry.text]));
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
  /** Turns since Sol's last call that Jev read as fairly new, by first passage, so a re-read isn't counted twice. */
  private novelTurns = new Set<string>();
  private events: PendingEvent[] = [];
  /** A failed call logged participant text or events the map doesn't reflect yet. */
  private behind = false;
  private turnBusy = false;
  private readTurnKey = '';
  /** Transcript boundary last read; revisit it for growth, then drain later turns in order. */
  private readThrough = 0;
  private traitsBusy = false;
  /** Thread wording whose trait read failed; not retried until Sol's next applied map, so a failing read can't loop. */
  private traitFailures = new Map<string, string>();
  private list: ListState = emptyListState();
  /** A turn reading that landed while the participant was talking; its pick waits for them to stop. */
  private deferred: TurnRecord | null = null;
  /** A new map or traits would have moved the lead while the participant was talking; the pick waits for them to stop. */
  private heldRefresh = false;
  private mapKey: string | null = null;
  private lastMapNote: number | null = null;
  /** Notes decided while Sam was quiet: the latest of each kind goes out when Sam next speaks, so none lands in a pause the participant may still be thinking in. */
  private held = new Map<NoteRecord['kind'], HeldNote>();
  private pace: PaceState | null = null;
  /** Active time of the last offer to stop that reached Sam. */
  private lastOffer: number | null = null;
  private samTurns = new Set<string>();
  /** When the transcript last changed, for either speaker. */
  private lastChange: number;
  /** Participant turns, by passage and length, that Sam was told are over; their next words are a new turn. */
  private woken = new Set<string>();
  private researched = new Set<string>();
  private lookups = 0;
  private counts: Counts = { maps: 0, applied: 0, turns: 0, traits: 0, notes: 0, research: 0, holds: 0, handovers: 0, cancels: 0 };
  private hearing = unheard();
  private floor = idleFloor();
  /** Sam's latest passage as last transcribed, and when Sam's transcript last changed. */
  private latestSam: { id: string; length: number } | null = null;
  private lastSam = 0;
  /** Sam said something substantive after the held notes were decided; they go out once the participant's microphone is quiet. */
  private releaseDue = false;
  private closed = false;
  /** Notes restated for a new provider session are outside the note budget. */
  private restating = false;

  constructor(private options: Options) { this.lastMapStart = this.lastChange = options.startedAt; }

  private get alive() { return !this.abort.signal.aborted; }
  private elapsed(now: number) { return activeElapsed(this.options.startedAt, now, this.options.pauses?.()); }
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

  /** Called on the session tick: reads a new participant turn, starts a due Sol call, sends a held map note, makes a held pick, and nudges a silent Sam. */
  tick(now = Date.now()) {
    if (!this.alive) return;
    if (this.call && now - this.call.record.startedAt >= LIMITS.mapTimeout) this.abandon(now);
    this.readTurn(now);
    this.startMap(now);
    this.sendMapNote(now);
    // A reading of the turn they just finished may still be on its way, and it replaces the held one.
    if ((this.deferred || this.heldRefresh) && !this.turnBusy && !this.options.talking?.()) {
      const record = this.deferred;
      this.deferred = null;
      this.heldRefresh = false;
      const pick = this.pick(now, record ?? undefined);
      if (record) record.pick = compactPick(pick);
    }
    this.listen(now);
    this.unstall(now);
  }

  /**
   * Sam has gone quiet after the participant finished: nothing transcribed and nothing heard for `wakeAfter`, their
   * latest words complete, and nothing from Sam since but a backchannel or a short reaction. The held notes go out at
   * once, then a turn note. Not after a hanging clause, a request for time or a request to stop, and once per
   * participant turn.
   */
  private unstall(now: number) {
    if (!this.options.heard || this.restating || !this.samTurns.size || this.woken.size >= LIMITS.wakes || this.options.talking?.()) return;
    if (now - Math.max(this.lastChange, this.options.heard()) < LIMITS.wakeAfter) return;
    const settled = this.options.settled();
    const index = settled.findLastIndex(entry => entry.speaker === 'trainee' && !!spokenWords(entry.text));
    const last = settled[index];
    if (!last) return;
    const key = `${last.id}:${last.text.length}`;
    if (this.woken.has(key) || !finishesTurn(last.text) || asksToEnd(last.text)) return;
    // Sam's question, or a prompt such as "Walk me through the handoff.", leaves the turn with them: their quiet is thinking time.
    if (settled.slice(index + 1).some(entry => entry.speaker === 'client' && (entry.text.includes('?') || !yieldsTurn(entry.text)))) return;
    this.woken.add(key);
    this.deliver(now, { wake: true });
    this.send('turn', this.fixed(TURN_NOTE, now), now, { wake: true });
  }

  private fixed(text: string, now: number): HeldNote { return { text, decidedAt: now, mapId: this.mapRecord?.id ?? null, researchIds: [], offer: false }; }

  // ---- The listening hold ----

  /**
   * The browser's latest report of how long each side has been quiet; null when it can't tell. The participant's
   * microphone turning loud again, after a pause or after Sam's words, starts a new pause: its clock restarts, and if
   * a turn note went out that Sam hasn't acted on, a cancel note follows.
   */
  hear(now: number, { inputQuietMs, outputQuietMs }: { inputQuietMs?: number | null; outputQuietMs?: number | null }) {
    if (!this.alive) return;
    const previous = this.hearing;
    if (outputQuietMs !== undefined) {
      this.hearing = { ...this.hearing, outputActive: outputQuietMs != null && outputQuietMs < SPEECH_QUIET_MS, outputAt: outputQuietMs == null ? previous.outputAt : now - outputQuietMs };
    }
    if (inputQuietMs !== undefined) {
      const active = inputQuietMs != null && inputQuietMs < SPEECH_QUIET_MS;
      const at = inputQuietMs == null ? previous.inputAt : now - inputQuietMs;
      this.hearing = { ...this.hearing, inputActive: active, inputAt: at };
      // A repeated report of the same quiet moves only by the network's jitter; new speech moves it by more than a pause.
      if ((active && !previous.inputActive) || (at != null && (previous.inputAt == null || at - previous.inputAt > SPEECH_QUIET_MS))) {
        // Sam was audible when the microphone was last loud, even if both have gone quiet since the last report.
        const { outputAt, outputActive } = this.hearing;
        const overSam = outputActive || (at != null && outputAt != null && outputAt >= at - SPEECH_QUIET_MS);
        this.heardInput(now, Math.max(0, (at ?? now) - this.quietSince(now, previous)), overSam);
      }
    }
    this.listen(now);
  }

  /** `pausedMs`: how long both sides had been quiet when the participant spoke again. */
  private heardInput(now: number, pausedMs: number, overSam: boolean) {
    // Sam had the turn note but hasn't begun the question: it waits. Once Sam's audio plays, a note can't stop it.
    if (this.floor.handed && this.floor.owed && !overSam && this.counts.cancels < LIMITS.cancels) {
      this.counts.cancels++;
      this.send('cancel', this.fixed(CANCEL_NOTE, now), now, { quietMs: pausedMs });
    }
    // Heard over Sam's listening sound, it may be that sound coming back: the pause keeps its notes.
    if (overSam && this.floor.owed) return;
    this.floor = { ...idleFloor(), owed: true, clear: !overSam, mark: this.latestSam && { ...this.latestSam } };
  }

  /** Sam's words since the participant's microphone was last loud; any substantive ones take the turn. */
  private samSaid(entry: TranscriptEntry, now: number) {
    this.lastSam = now;
    this.latestSam = { id: entry.id, length: entry.text.length };
    const floor = this.floor;
    if (!floor.owed) return;
    floor.sam.set(entry.id, floor.mark?.id === entry.id ? entry.text.slice(floor.mark.length) : entry.text);
    const said = [...floor.sam.values()].join(' ');
    if (said.trim() && !yieldsTurn(said)) floor.owed = false;
  }

  /** The last sound from either side as the server knows it; the participant's own transcript lags their voice, so it doesn't count. */
  private quietSince(now: number, hearing = this.hearing) {
    const { inputAt, inputActive, outputAt, outputActive } = hearing;
    return inputActive || outputActive ? now : Math.max(inputAt ?? 0, outputAt ?? 0, this.lastSam);
  }

  /** The participant's latest passage, while Sam has said nothing substantive since: their answer, still in progress or finished. */
  private answer(): TranscriptEntry | null {
    const transcript = this.options.transcript?.() ?? this.options.settled();
    const index = transcript.findLastIndex(entry => entry.speaker === 'trainee' && !!spokenWords(entry.text));
    if (index < 0 || transcript.slice(index + 1).some(entry => entry.speaker === 'client' && (entry.text.includes('?') || !yieldsTurn(entry.text)))) return null;
    return transcript[index]!;
  }

  /**
   * Once the participant's microphone goes quiet, Sam gets the mode's hold note; once both sides have been quiet for
   * the mode's window after a complete answer, the held notes go out, then a turn note. Not after a hanging clause, a
   * request for time or a request to stop, and once per pause. A held note Sam's words released waits for their
   * microphone to go quiet. The session also calls it when `floorDue` comes.
   */
  listen(now = Date.now()) {
    if (!this.alive || this.restating) return;
    const { inputAt, inputActive, outputActive } = this.hearing;
    if (this.releaseDue && !inputActive && (inputAt == null || now - inputAt > LIMITS.releaseQuiet)) this.deliver(now);
    const mode = this.options.listening;
    const floor = this.floor;
    if (!mode || !floor.owed || inputActive || outputActive || inputAt == null) return;
    // A pause that began over Sam's audio counts once the participant's words are transcribed.
    if (!floor.held && now - inputAt >= LIMITS.holdAfter && ![...floor.sam.values()].join('').trim() && this.counts.holds < LIMITS.holds && (floor.clear || this.answer())) {
      floor.held = true;
      this.counts.holds++;
      this.send('hold', this.fixed(HOLD_NOTES[mode], now), now, { quietMs: now - this.quietSince(now) });
    }
    const quietMs = now - this.quietSince(now);
    if (floor.handed || quietMs < listeningMode(mode).windowMs || this.counts.handovers >= LIMITS.handovers) return;
    const last = this.answer();
    if (!last || !finishesTurn(last.text) || asksToEnd(last.text)) return;
    floor.handed = true;
    this.counts.handovers++;
    this.deliver(now, { handover: true });
    this.send('turn', this.fixed(TURN_NOTE, now), now, { handover: true, quietMs });
  }

  /** When the listening hold next needs a look, if it waits on the clock alone; the session sets a timer for it. */
  floorDue(now = Date.now()): number | null {
    const { inputAt, inputActive, outputActive } = this.hearing;
    if (!this.alive || inputAt == null || inputActive) return null;
    const due = this.releaseDue ? [inputAt + LIMITS.releaseQuiet + 1] : [];
    const mode = this.options.listening;
    if (mode && this.floor.owed && !outputActive) {
      if (!this.floor.held) due.push(inputAt + LIMITS.holdAfter);
      if (!this.floor.handed) due.push(this.quietSince(now) + listeningMode(mode).windowMs);
    }
    // Anything already due waits on words, not the clock: the next transcript change or tick looks again.
    const next = due.filter(at => at > now);
    return next.length ? Math.min(...next) : null;
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
    const unlogged = new Set(unloggedPassages(this.log, settled).map(entry => entry.id));
    const fresh = settled.some((entry, index) => unlogged.has(entry.id) && said(settled, index));
    if (now - this.lastMapStart >= LIMITS.mapTimer && (fresh || this.behind)) this.reasons.add('a minute has passed since your last call');
    if (!this.reasons.size) return;
    // A wake whose news an earlier call already logged has nothing left to say.
    if (!fresh && !this.behind && !this.events.length) { this.reasons.clear(); return; }
    const reasons = [...this.reasons];
    this.reasons.clear();
    this.novelTurns.clear();
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
      update: result.update, changes: compactChanges(result.changes), research: result.research, pace: result.pace,
    } satisfies Partial<MapRecord>);
    this.counts.applied++;
    this.behind = false;
    this.map = result.map;
    this.mapRecord = record;
    this.pace = { ...result.pace, mapId: record.id, inputId: record.lastInputId };
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
    const transcript = [...this.options.settled()];
    for (let end = this.readThrough; end <= transcript.length; end++) {
      const next = transcript[end];
      if (next && (next.speaker !== 'client' || yieldsTurn(next.text))) continue;
      const settled = upToParticipant(transcript.slice(0, end));
      const turn = latestTurn(settled);
      const key = turnKey(turn);
      if (!turn.length || key === this.readTurnKey) continue;
      this.readThrough = end;
      this.readTurnKey = key;
      this.turnBusy = true;
      this.counts.turns++;
      const record: TurnRecord = { source: 'turn', id: `turn-${crypto.randomUUID()}`, passageId: turn.at(-1)!.id, mapId: this.mapRecord?.id ?? null, startedAt: now, outcome: 'pending' };
      this.records.push(record);
      this.track(this.evaluate(record, settled, now, turn[0]!.id));
      return;
    }
  }

  /** `turn` is the turn's first passage: a turn that grew keeps it, so its re-read replaces the earlier one. */
  private async evaluate(record: TurnRecord, settled: TranscriptEntry[], now: number, turn: string) {
    const scope = this.abort.signal;
    const signal = AbortSignal.any([scope, AbortSignal.timeout(LIMITS.turnTimeout)]);
    try {
      const result = await this.options.services.evaluateTurn({ transcript: settled, map: this.map, apiKey: this.options.typesafeKey, signal, atMs: this.elapsed(now) });
      if (scope.aborted) return;
      signal.throwIfAborted();
      if (Date.now() - record.startedAt >= LIMITS.turnTimeout) { record.outcome = 'timeout'; return; }
      const { reading } = result;
      Object.assign(record, {
        outcome: 'read', durationMs: result.durationMs, usage: usageOf(result.usage),
        reading: {
          atMs: reading.atMs, focus: reading.focus, novel: round(reading.novel), ...(reading.complaint != null ? { complaint: round(reading.complaint) } : {}),
          natural: roundAll(reading.natural), states: reading.states,
        },
      } satisfies Partial<TurnRecord>);
      this.ranking = observeTurn(this.ranking, this.map, reading, turn);
      this.wakeOnReading(reading, turn);
      this.spendPace(record.passageId, reading.novel);
      record.pick = compactPick(this.pick(Date.now(), record));
    } catch (error) {
      if (scope.aborted) return;
      record.failure = callFailure(error);
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
    } finally {
      // Freed with the pick, so a map that lands next knows this turn is read. A pause already released the slot; a
      // resumed producer may own it now.
      if (!scope.aborted) { record.completedAt = Date.now(); this.turnBusy = false; }
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
    const scope = this.abort.signal;
    const signal = AbortSignal.any([scope, AbortSignal.timeout(LIMITS.traitTimeout)]);
    const map = this.map;
    this.track((async () => {
      try {
        const result = await this.options.services.evaluateTraits({ map, threads, apiKey: this.options.typesafeKey, signal });
        if (scope.aborted) return;
        signal.throwIfAborted();
        Object.assign(record, {
          outcome: 'read', durationMs: result.durationMs, usage: usageOf(result.usage),
          traits: Object.fromEntries(Object.entries(result.traits).map(([id, item]) => [id, [round(item.spicy), round(item.grounding)]])),
        } satisfies Partial<TraitRecord>);
        this.ranking = withTraits(this.ranking, result.traits);
        this.pick(Date.now());
      } catch (error) {
        if (scope.aborted) return;
        record.failure = callFailure(error);
        record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
        for (const thread of threads) this.traitFailures.set(thread.id, threadKey(thread));
      } finally {
        if (!scope.aborted) {
          record.completedAt = Date.now();
          this.traitsBusy = false;
        }
      }
      // Sol may have rewritten threads while this read ran.
      if (!scope.aborted) this.readTraits();
    })());
  }

  /**
   * Re-picks after a turn reading, a new map or new traits. Only a turn reading picks a new lead, and only once the
   * participant has stopped talking; until then it refreshes the lead in force like a map does. A refresh that would
   * move the lead, because Sol closed it, waits for them to stop as well.
   */
  private pick(now: number, turn?: TurnRecord): Pick {
    // A new provider session hears its notes at once.
    const talking = !this.restating && !!this.options.talking?.();
    // Offer to stop only once the participant's latest turn is read: this pick is that reading's, or none is pending.
    const offer = !talking && (!!turn || !this.turnBusy) && this.offering(now);
    if (turn && talking) {
      turn.deferred = true;
      this.deferred = turn;
      turn = undefined;
    } else if (turn) this.deferred = null;
    const decision = nextListNote(this.map, this.ranking, this.elapsed(now), this.list, { turn: !!turn, offer, headers: noteHeaders(this.options.channel) });
    if (!decision.text) { this.list = decision.state; return decision.pick; }
    // Sam's lead doesn't move under the participant: a refresh that would change it waits for them to stop, too.
    if (talking && decision.state.lead !== this.list.lead) { this.heldRefresh = true; return decision.pick; }
    this.heldRefresh = false;
    const outcome = this.note('list', decision.text, now, { turn, offer: decision.offer });
    if (outcome === 'sent' || outcome === 'held') this.list = decision.state;
    return decision.pick;
  }

  /** Sol allows an offer to stop, and the producer's own floors and spacing are met. */
  private offering(now: number): boolean {
    const pace = this.pace;
    if (pace?.verdict !== 'may-offer-finish' || pace.spent || this.counts.applied < LIMITS.offerMaps) return false;
    const elapsed = this.elapsed(now);
    return elapsed >= LIMITS.offerAfter && (this.lastOffer == null || elapsed - this.lastOffer >= LIMITS.offerSpacing);
  }

  /** A turn after an offer reached Sam answers it; one after Sol's transcript that adds what the map lacks outdates Sol's call. */
  private spendPace(passageId: string, novel: number) {
    const pace = this.pace;
    if (pace?.verdict !== 'may-offer-finish' || pace.spent) return;
    const ids = this.options.settled().map(entry => entry.id);
    const after = (mark: string | null) => mark == null || ids.indexOf(passageId) > ids.indexOf(mark);
    if (pace.offeredAfter !== undefined && after(pace.offeredAfter)) pace.spent = 'answered';
    else if (novel >= RANKING.novel && after(pace.inputId)) pace.spent = 'novel';
  }

  /**
   * Wakes Sol, still no sooner than the floor, when a turn adds something the map lacks, when two turns since its last
   * call add a fair amount, or when the thread the participant is on stalled: that thread isn't held down, so its gap
   * needs asking another way.
   */
  private wakeOnReading(reading: TurnReading, turn: string) {
    const { novel, novelRun } = RANKING;
    if (reading.novel >= novel) this.wake(`the participant's latest turn (${reading.passageId}) adds something the map lacks`);
    else if (reading.novel >= novelRun.probability && this.novelTurns.add(turn).size >= novelRun.turns) {
      this.wake(`the participant's last ${this.novelTurns.size} turns add things the map lacks`);
    }
    const focus = this.ranking.current;
    if (focus && reading.states[focus] === 'stalled') this.wake(`the participant's latest turn (${reading.passageId}) didn't move the thread they're on (${focus}); its gap may need asking another way`);
  }

  // ---- The map note ----

  /** A change to how the participant wants to be interviewed goes to Sam without waiting out the spacing. */
  private sendMapNote(now: number) {
    if (!this.mapRecord) return;
    const key = mapNoteKey(this.map);
    if (key === this.mapKey) return;
    const spaced = this.lastMapNote == null || now - this.lastMapNote >= LIMITS.mapNoteSpacing;
    if (!spaced && preferencesLine(key) === preferencesLine(this.mapKey)) return;
    const headers = noteHeaders(this.options.channel);
    const text = mapNote(this.map, headers) ?? (this.mapKey ? emptyMapNote(headers) : null);
    if (!text) { this.mapKey = key; return; }
    // The note carries the lookups its research facts cite; Sol's update was checked to cite only found lookups it had read.
    const cited = new Set(mapNoteResearch(this.map).map(entity => entity.passageId));
    const researchIds = this.records.flatMap(item => item.source === 'research' && item.outcome === 'found' && item.eventId != null && cited.has(item.eventId) ? [item.id] : []);
    const outcome = this.note('map', text, now, { researchIds });
    if (!outcome) return;
    this.lastMapNote = now;
    if (outcome !== 'error') this.mapKey = key;
  }

  /**
   * Decides a note. Unless a new provider session needs it at once, it waits for Sam's next words, replacing any held
   * note of its kind: a note that lands while Sam is quiet can prompt Sam to speak into the participant's pause, and
   * Sam replies faster than a note can arrive, so holding it costs nothing. Null when the budget is spent.
   */
  private note(kind: NoteRecord['kind'], text: string, now: number, { turn, researchIds = [], offer = false }: { turn?: TurnRecord; researchIds?: string[]; offer?: boolean } = {}): NoteRecord['outcome'] | 'held' | null {
    if (!this.restating && this.counts.notes >= LIMITS.notes) return null;
    const held: HeldNote = { text, decidedAt: now, mapId: this.mapRecord?.id ?? null, ...(turn ? { turnId: turn.id } : {}), researchIds, offer };
    if (this.restating || this.options.immediate) return this.send(kind, held, now).outcome;
    this.held.set(kind, held);
    this.releaseDue = false;
    return 'held';
  }

  // Set delivery before sending: an acknowledgment may arrive immediately.
  private send(kind: NoteRecord['kind'], note: HeldNote, now: number, marks: NoteMarks = {}): NoteRecord {
    // Turn-taking notes have their own limits.
    if (!this.restating && (kind === 'list' || kind === 'map')) this.counts.notes++;
    const id = `note-${crypto.randomUUID()}`;
    const record: NoteRecord = {
      source: 'note', id, kind, text: note.text, mapId: note.mapId, ...(note.turnId ? { turnId: note.turnId } : {}), sentAt: now,
      ...(note.decidedAt !== now ? { decidedAt: note.decidedAt } : {}), ...(note.offer ? { offer: true as const } : {}), ...marks, outcome: 'sent',
      delivery: { eventId: id, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' },
      ...(note.researchIds.length ? { researchIds: note.researchIds } : {}),
    };
    this.records.push(record);
    const sent = this.options.send({ type: this.options.channel ?? LIVE_NOTE_CHANNEL, event_id: id, delegation_id: null, content: note.text });
    if (!sent) record.outcome = 'error';
    if (note.offer && sent && this.pace) {
      this.pace.offeredAfter = record.delivery.afterPassageId;
      this.lastOffer = this.elapsed(now);
    }
    return record;
  }

  /**
   * Sam has started speaking, or has the turn: the held notes go out, map first. A held offer to stop is dropped if the
   * participant has spoken since it was decided, since what they said may outdate it; their turn's reading decides again.
   */
  private deliver(now: number, marks: NoteMarks = {}) {
    this.releaseDue = false;
    for (const kind of ['map', 'list'] as const) {
      const held = this.held.get(kind);
      if (!held) continue;
      this.held.delete(kind);
      const unsent = held.offer && this.options.talking?.() ? null : this.counts.notes < LIMITS.notes ? this.send(kind, held, now, marks) : null;
      if (unsent?.outcome === 'sent') continue;
      // Not sent: the next pick or the map note after its spacing goes out again.
      if (kind === 'list') this.list = { ...this.list, key: null };
      else this.mapKey = null;
    }
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
    const scope = this.abort.signal;
    this.track(this.research(record, key).finally(() => { if (!scope.aborted) this.lookups--; }));
  }

  /** A found lookup wakes Sol; one that found nothing waits in the log for Sol's next call. */
  private async research(record: ResearchRecord, key: string) {
    const { kind, name, clue } = record.request;
    const scope = this.abort.signal;
    const signal = AbortSignal.any([scope, AbortSignal.timeout(LIMITS.lookupTimeout)]);
    try {
      const lookup = await this.options.services.lookupInterviewBackground({ target: { kind, name }, clue, foundry: this.options.foundry, signal });
      if (scope.aborted) return;
      signal.throwIfAborted();
      const now = Date.now();
      record.lookupAt = now;
      record.queries = lookup.queries;
      if (lookup.status === 'found') Object.assign(record, { outcome: 'found', facts: lookup.facts, retrievedAt: lookup.retrievedAt } satisfies Partial<ResearchRecord>);
      else Object.assign(record, { outcome: 'unresolved', reason: lookup.reason } satisfies Partial<ResearchRecord>);
      const facts = lookup.status === 'found' ? lookup.facts : null;
      record.eventId = `L${this.records.filter(item => item.source === 'research' && item.eventId != null).length + 1}`;
      // Log events sit among passages, whose times include connection pauses.
      this.events.push({ researchId: record.id, event: { id: record.eventId, atMs: now - this.options.startedAt, text: researchLogEvent({ kind, name }, facts, lookup.status === 'unresolved' ? lookup.reason : undefined) } });
      if (facts?.length) this.wake(`public research arrived about the ${kind} "${name}"`);
    } catch (error) {
      if (scope.aborted) return;
      record.failure = callFailure(error);
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
      // A transient failure may be requested again; it still used an attempt.
      this.researched.delete(key);
    } finally {
      if (!scope.aborted) record.completedAt = Date.now();
    }
  }

  // ---- Session events ----

  /**
   * Sam's substantive words release the held notes. With a listening mode, a reaction of a few words doesn't, and they
   * wait for the participant's microphone to go quiet. Also marks the next substantive Sam passage at or after a sent
   * note, not whether Sam acted on it. A growing passage counts once it is more than a backchannel.
   */
  transcriptChanged(entry: TranscriptEntry, previousId: string | null, now = Date.now()) {
    if (!this.alive) return;
    this.lastChange = now;
    if (entry.speaker === 'client' && entry.text.trim()) this.samSaid(entry, now);
    if (entry.speaker !== 'client' || !entry.text.trim() || isBackchannel(entry.text)) { this.listen(now); return; }
    if (!this.options.listening) this.deliver(now);
    else if (!yieldsTurn(entry.text)) this.releaseDue = this.held.size > 0;
    this.listen(now);
    if (this.samTurns.has(entry.id)) return;
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
    // A turn-taking note is a nudge in the moment; resending it later would be out of place.
    if ((record.kind !== 'list' && record.kind !== 'map') || this.held.has(record.kind) || this.records.findLast(item => item.source === 'note' && item.kind === record.kind) !== record) return;
    if (record.kind === 'list') this.list = { ...this.list, key: null };
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
      ...(this.options.listening ? { listening: {
        mode: this.options.listening, windowMs: listeningMode(this.options.listening).windowMs, holdAfterMs: LIMITS.holdAfter,
        holds: this.counts.holds, handovers: this.counts.handovers, cancels: this.counts.cancels, wakes: this.woken.size,
      } } : {}),
    };
  }

  /** A new provider session, or none: the browser's media restarts, and so does the participant's floor. */
  private forgetFloor() {
    this.hearing = unheard();
    this.floor = idleFloor();
    this.latestSam = null;
    this.releaseDue = false;
  }

  /**
   * The connection dropped. In-flight calls are abandoned: their notes would reach a provider session that no
   * longer exists. Whatever they consumed is released, so the work runs again after the resume.
   */
  pause() {
    this.abort.abort();
    this.call?.controller.abort();
    this.call = null;
    this.turnBusy = this.traitsBusy = false;
    this.lookups = 0;
    // The resume restates every note.
    this.held.clear();
    this.forgetFloor();
    this.release(Date.now());
  }

  /** A new provider session joined. Its instructions carry the conversation but none of Sam's notes, so restate them. */
  resume(now = Date.now()) {
    if (this.closed || this.alive) return;
    this.abort = new AbortController();
    this.mapKey = this.lastMapNote = null;
    this.lastChange = now;
    this.forgetFloor();
    // The new session has no thread note to supersede, so nothing is sent until there is a lead.
    this.list = { ...this.list, key: null, sent: false };
    this.restating = true;
    try {
      this.sendMapNote(now);
      this.pick(now);
    } finally { this.restating = false; }
    this.readTraits();
  }

  checkpoint(): ProducerCheckpoint {
    return {
      records: this.records, counts: { ...this.counts }, map: this.map, mapRecordId: this.mapRecord?.id ?? null, log: this.log, ranking: this.ranking,
      lastMapStart: this.lastMapStart, reasons: [...this.reasons], events: this.events, behind: this.behind, novelTurns: [...this.novelTurns],
      readTurnKey: this.readTurnKey, readThrough: this.readThrough, traitFailures: [...this.traitFailures],
      list: this.list, deferredTurnId: this.deferred?.id ?? null, mapKey: this.mapKey, lastMapNote: this.lastMapNote,
      samTurns: [...this.samTurns], researched: [...this.researched], pace: this.pace, lastOffer: this.lastOffer, woken: [...this.woken],
    };
  }

  /** Restores a paused producer. In-flight work in the checkpoint was lost with the isolate. */
  restore(checkpoint: ProducerCheckpoint) {
    this.abort.abort();
    this.call = null;
    this.turnBusy = this.traitsBusy = false;
    this.lookups = 0;
    this.records.splice(0, this.records.length, ...checkpoint.records);
    this.counts = { holds: 0, handovers: 0, cancels: 0, ...checkpoint.counts };
    this.map = checkpoint.map;
    this.mapRecord = this.records.find((item): item is MapRecord => item.source === 'map' && item.id === checkpoint.mapRecordId) ?? null;
    this.log = checkpoint.log;
    this.ranking = checkpoint.ranking;
    this.lastMapStart = checkpoint.lastMapStart;
    this.reasons = new Set(checkpoint.reasons);
    this.novelTurns = new Set(checkpoint.novelTurns ?? []);
    this.events = checkpoint.events;
    this.behind = checkpoint.behind;
    this.readTurnKey = checkpoint.readTurnKey;
    this.readThrough = checkpoint.readThrough;
    this.traitFailures = new Map(checkpoint.traitFailures);
    this.list = checkpoint.list ?? emptyListState();
    this.deferred = this.records.find((item): item is TurnRecord => item.source === 'turn' && item.id === checkpoint.deferredTurnId) ?? null;
    this.mapKey = checkpoint.mapKey;
    this.lastMapNote = checkpoint.lastMapNote;
    this.samTurns = new Set(checkpoint.samTurns);
    this.researched = new Set(checkpoint.researched);
    this.pace = checkpoint.pace ?? null;
    this.lastOffer = checkpoint.lastOffer ?? null;
    this.woken = new Set(checkpoint.woken ?? []);
    this.lastChange = Date.now();
    this.held.clear();
    this.forgetFloor();
    this.release(Date.now());
  }

  /** Marks pending work aborted and releases what it held: Sol's logged passages leave the map behind, a turn is re-read, a lookup may be requested again. */
  private release(now: number) {
    for (const record of this.records) {
      if (!(record.source === 'map' || record.source === 'turn' || record.source === 'traits' || record.source === 'research') || record.outcome !== 'pending') continue;
      if (record.source === 'map') this.behind = true;
      if (record.source === 'turn') this.readTurnKey = '';
      if (record.source === 'research') this.researched.delete(researchKey(record.request));
      record.outcome = 'aborted';
      record.completedAt ??= now;
    }
  }

  close() {
    this.closed = true;
    this.abort.abort();
    this.call?.controller.abort();
    this.call = null;
    this.reasons.clear();
    this.held.clear();
    this.release(Date.now());
  }
}

const preferencesLine = (key: string | null) => key?.split('\n').find(line => line.startsWith('They prefer: ')) ?? '';

function compactPick(pick: Pick): NonNullable<TurnRecord['pick']> {
  return { ...pick, ranked: pick.ranked.map(item => [item.id, round(item.score), item.band]) };
}

/** Exposed for the delivery probe, which sends the same notes outside a session. */
export const NOTE_KINDS = Object.keys(NOTE_HEADERS) as NoteRecord['kind'][];
