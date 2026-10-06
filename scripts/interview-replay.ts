/**
 * Replays exported interviews through the current ranking and thread-note code, using the Sol updates, Jev readings and
 * traits each run recorded. Makes no network or model call. A changed segmentation or ranking rule shows up as different
 * holds, picks and notes; Jev's readings themselves are the recorded ones, so a turn Jev would now read differently is
 * approximated by the reading it got.
 * Notes are held, as the producer holds them, until Sam next says something more than a backchannel. Sam's recorded speech
 * stands in for that moment; under the hold Sam might have spoken differently, which no replay can show.
 * Fidelity compares each thread note's structure (action, lead, other threads, offer), not its wording, so runs recorded
 * under an older note format still compare.
 * Usage: bun scripts/interview-replay.ts <row.json>... [--json=<path outside the repo>] [--baseline=<earlier --json>] [--verbose]
 * The JSON and --verbose output hold transcript-derived labels: keep them out of the repo.
 */
import { latestTurn, upToParticipant } from '../ai/interview/ranking.server';
import { isBackchannel } from '../core/interview';
import { applyMapUpdate, emptyMap, type ConversationMap, type MapPace } from '../core/interview-map';
import { emptyListState, nextListNote } from '../core/interview-notes';
import { PRODUCER_LIMITS, type GradeRecord, type MapRecord, type NoteRecord, type ProducerLogRecord, type TraitRecord, type TurnRecord } from '../core/interview-producer';
import { emptyRanking, observeMap, observeTurn, RANKING, threadKey, withTraits, type RankingState } from '../core/interview-ranking';
import { activeElapsed, type PauseSpan } from '../core/simulator/state';
import type { TranscriptEntry } from '../core/simulator/types';

const args = Bun.argv.slice(2);
const paths = args.filter(item => !item.startsWith('--'));
const flag = (name: string) => args.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const verbose = args.includes('--verbose');
if (!paths.length) throw new Error('Usage: bun scripts/interview-replay.ts <row.json>... [--json=<path>] [--baseline=<path>] [--verbose]');
const SETTLE_MS = 1200;
/** The session tick, which flushes a pick held while the participant talked. */
const TICK_MS = 500;

type Source = { id: string; startedAt: number; transcript: TranscriptEntry[]; records: ProducerLogRecord[]; pauses: PauseSpan[] };
function parse(raw: unknown): Source {
  const row = (Array.isArray(raw) ? ((raw[0] as { results?: unknown[] })?.results?.[0] ?? raw[0]) : raw) as Record<string, unknown>;
  const json = (field: unknown) => typeof field === 'string' ? JSON.parse(field) : field;
  const connection = json(row.provenance_json)?.connection as { pauses?: { pausedAt: number; resumedAt: number | null }[] } | undefined;
  const pauses = (connection?.pauses ?? []).map(item => ({ from: item.pausedAt, to: item.resumedAt }));
  return { id: String(row.id), startedAt: Number(row.started_at), transcript: json(row.transcript_json), records: json(row.interventions_json), pauses };
}

/** Wall time to the provider's transcript clock, interpolated between notes the provider placed; the two drift apart over a run. */
function providerClock(source: Source) {
  const anchors = source.records.flatMap(item => item.source === 'note' && item.delivery.startMs != null ? [[item.sentAt, item.delivery.startMs] as const] : [])
    .sort((a, b) => a[0] - b[0]);
  return (wall: number) => {
    if (!anchors.length) return wall - source.startedAt;
    const after = anchors.findIndex(([at]) => at >= wall);
    if (after <= 0) { const [at, ms] = anchors[after === 0 ? 0 : anchors.length - 1]!; return ms + wall - at; }
    const [a, am] = anchors[after - 1]!;
    const [b, bm] = anchors[after]!;
    return am + (bm - am) * (wall - a) / Math.max(1, b - a);
  };
}

type Event =
  | { at: number; kind: 'map'; record: MapRecord; map: ConversationMap }
  | { at: number; kind: 'traits'; record: TraitRecord }
  | { at: number; kind: 'turn'; record: TurnRecord }
  | { at: number; kind: 'grade'; record: GradeRecord }
  | { at: number; kind: 'resume' };
const ORDER = { resume: 0, map: 1, traits: 2, turn: 3, grade: 4 } as const;

/** `providerMs` is when the note was decided; `releasedMs` when Sam's speech released it, null if a newer note replaced it first or Sam never spoke again. */
type Note = { at: number; providerMs: number; releasedMs: number | null; text: string; lead: string | null; label: string | null; cause: Event['kind'] | 'deferred'; turnPassage: string | null; talking: boolean; offer: boolean };
/** A recorded map note, for where notes land against the floor. */
type MapNote = { providerMs: number; releasedMs: number | null };
type TurnRow = { passageId: string; first: string; focus: string | null; states: Record<string, string>; lead: string | null; action: string; replaced: string[]; deferred?: boolean; complaint?: number };
type RunResult = {
  id: string; minutes: number; fidelity: { matched: number; recorded: number; firstMismatch: number | null } | null;
  notes: Note[]; mapNotes: MapNote[]; turns: TurnRow[]; samPassages: { passageId: string; startMs: number; lead: string | null }[];
  /** Recorded notes, list and map, that reached Sam while the participant held the floor. */
  recordedHeld: number;
  mismatches: { index: number; recorded: string; replayed: string | null }[];
  firstCueMs: Record<string, number | null>;
  /** Readings that would wake Sol under the producer's newer wake rules, and how much sooner its next call could start. */
  wakes: { passageId: string; why: 'novel run' | 'stall'; gainS: number | null }[];
};

function replay(source: Source): RunResult {
  const { transcript, records, startedAt } = source;
  const toProvider = providerClock(source);
  const lookups = records.flatMap(item => item.source === 'research' && item.eventId ? [item.eventId] : []);
  const maps = new Map<string, ConversationMap>();
  const created = new Map<string, number>();
  const events: Event[] = [];
  let map = emptyMap();
  for (const record of records.filter((item): item is MapRecord => item.source === 'map').sort((a, b) => a.startedAt - b.startedAt)) {
    if (record.outcome !== 'applied') continue;
    if (!record.update) throw new Error(`${source.id}: map ${record.id} was shed from the archive; the replay can't rebuild later maps.`);
    const result = applyMapUpdate(map, record.update, transcript, lookups);
    if (!result.ok) throw new Error(`${source.id}: map ${record.id} no longer applies: ${JSON.stringify(result.defects.slice(0, 3))}`);
    map = result.map;
    maps.set(record.id, map);
    for (const id of result.changes.added) if (id.startsWith('t')) created.set(id, record.completedAt!);
    events.push({ at: record.completedAt!, kind: 'map', record, map });
  }
  for (const record of records) {
    if (record.source === 'turn' && record.outcome === 'read' && record.reading) events.push({ at: record.completedAt!, kind: 'turn', record });
    if (record.source === 'traits' && record.outcome === 'read' && record.traits) events.push({ at: record.completedAt!, kind: 'traits', record });
    if (record.source === 'grade' && record.objectives) events.push({ at: record.completedAt, kind: 'grade', record });
  }
  // A new provider session hears every note again.
  for (const pause of source.pauses) if (pause.to != null) events.push({ at: pause.to, kind: 'resume' });
  events.sort((a, b) => a.at - b.at || ORDER[a.kind] - ORDER[b.kind]);

  const mapAt = (id: string | null) => id == null ? emptyMap() : maps.get(id) ?? emptyMap();
  const keysOf = (shown: ConversationMap) => Object.fromEntries(shown.threads.filter(thread => thread.status === 'open').map(thread => [thread.id, threadKey(thread)]));
  const firstPassage = (passageId: string) => {
    const index = transcript.findIndex(entry => entry.id === passageId);
    return latestTurn(upToParticipant(transcript.slice(0, index + 1)))[0]?.id ?? passageId;
  };
  const talking = (wall: number) => { const at = toProvider(wall); return transcript.some(entry => entry.speaker === 'trainee' && entry.startMs <= at && at < entry.endMs + SETTLE_MS); };

  const elapsed = (wall: number) => activeElapsed(startedAt, wall, source.pauses);
  // Sam's passages that release held notes: more than a backchannel.
  const samSpeech = transcript.filter(entry => entry.speaker === 'client' && entry.text.trim() && !isBackchannel(entry.text));
  const releaseAt = (ms: number) => { const next = samSpeech.find(entry => entry.endMs > ms); return next ? Math.max(ms, next.startMs) : null; };
  const talkingMs = (ms: number) => transcript.some(entry => entry.speaker === 'trainee' && entry.startMs <= ms && ms < entry.endMs + SETTLE_MS);
  const order = transcript.map(entry => entry.id);
  const after = (passageId: string, mark: string | null) => mark == null || order.indexOf(passageId) > order.indexOf(mark);
  let applied = 0;
  let pace: (MapPace & { inputId: string | null; offeredAfter?: string | null; spent?: boolean }) | null = null;
  let lastOffer: number | null = null;
  const offering = (at: number) => pace?.verdict === 'may-offer-finish' && !pace.spent && applied >= PRODUCER_LIMITS.offerMaps
    && elapsed(at) >= PRODUCER_LIMITS.offerAfter && (lastOffer == null || elapsed(at) - lastOffer >= PRODUCER_LIMITS.offerSpacing);
  const reading = (wall: number) => records.some(item => item.source === 'turn' && item.startedAt <= wall && (item.completedAt == null || wall < item.completedAt));
  let ranking: RankingState = emptyRanking();
  let current = emptyMap();
  let list = emptyListState();
  let deferred: { row: TurnRow; passageId: string; at: number } | null = null;
  let heldAt: number | null = null;
  const notes: Note[] = [];
  const turns: TurnRow[] = [];
  const calls = records.filter((item): item is MapRecord => item.source === 'map').sort((a, b) => a.startedAt - b.startedAt);
  const wakes: RunResult['wakes'] = [];
  let novelSince = new Set<string>();
  let novelCall: string | null = null;
  const label = (id: string | null) => id == null ? null : current.threads.find(thread => thread.id === id)?.label ?? null;

  // The producer's pick() as of interview-producer-v18: while the participant talks, a turn reading waits, and so does a refresh that would move the lead.
  const pick = (at: number, cause: Note['cause'], turn?: { row: TurnRow; passageId: string }) => {
    const talk = cause !== 'resume' && talking(at);
    const offer = !talk && (!!turn || !reading(at)) && offering(at);
    if (turn && talk) { turn.row.deferred = true; deferred = { ...turn, at }; turn = undefined; }
    else if (turn) deferred = null;
    const decision = nextListNote(current, ranking, elapsed(at), list, { turn: !!turn, offer });
    if (turn) Object.assign(turn.row, { lead: decision.pick.lead, action: decision.pick.action });
    if (!decision.text) { list = decision.state; return; }
    if (talk && decision.state.lead !== list.lead) { heldAt ??= at; return; }
    heldAt = null;
    list = decision.state;
    const providerMs = toProvider(at);
    // A resumed session hears its notes at once; otherwise the note waits for Sam's speech, and a held offer is dropped if the participant is talking by then.
    let releasedMs = cause === 'resume' ? providerMs : releaseAt(providerMs);
    if (decision.offer && releasedMs != null && talkingMs(releasedMs)) { releasedMs = null; list = { ...list, key: null }; }
    const previous = notes.at(-1);
    if (previous?.releasedMs != null && releasedMs != null && previous.releasedMs === releasedMs && previous.providerMs <= providerMs && cause !== 'resume') previous.releasedMs = null;
    notes.push({ at, providerMs, releasedMs, text: decision.text, lead: decision.state.lead, label: label(decision.state.lead), cause, turnPassage: turn?.passageId ?? null, talking: talking(at), offer: decision.offer });
    if (decision.offer && releasedMs != null && pace) {
      pace.offeredAfter = [...transcript].reverse().find(entry => entry.endMs + SETTLE_MS <= releasedMs!)?.id ?? null;
      lastOffer = elapsed(at);
    }
  };
  /** The session ticks between events, flushing a held pick once nobody is talking and no reading is in flight. */
  const tickUntil = (until: number) => {
    const from = Math.min(deferred?.at ?? Infinity, heldAt ?? Infinity);
    if (from === Infinity) return;
    for (let at = Math.ceil(from / TICK_MS) * TICK_MS; at < until; at += TICK_MS) {
      if (talking(at) || reading(at)) continue;
      const held = deferred;
      deferred = heldAt = null;
      pick(at, 'deferred', held ?? undefined);
      return;
    }
  };

  for (const event of events) {
    tickUntil(event.at);
    if (event.kind === 'grade') continue;
    if (event.kind === 'resume') { list = { ...list, key: null, sent: false }; pick(event.at, 'resume'); continue; }
    if (event.kind === 'map') {
      current = event.map;
      applied++;
      // Runs recorded before Sol judged pace never offer.
      pace = event.record.pace ? { ...event.record.pace, inputId: event.record.lastInputId ?? null } : null;
      ranking = observeMap(ranking, current, elapsed(event.record.startedAt));
      pick(event.at, 'map');
    } else if (event.kind === 'traits') {
      const shown = mapAt(event.record.mapId);
      const traits = Object.fromEntries(Object.entries(event.record.traits!).flatMap(([id, [spicy, grounding]]) => {
        const thread = shown.threads.find(item => item.id === id);
        return thread ? [[id, { key: threadKey(thread), spicy, grounding }]] : [];
      }));
      ranking = withTraits(ranking, traits);
      pick(event.at, 'traits');
    } else {
      const { record } = event;
      const read = { ...record.reading!, passageId: record.passageId, keys: keysOf(mapAt(record.mapId)) };
      const first = firstPassage(record.passageId);
      const before = ranking.holds;
      ranking = observeTurn(ranking, current, read, first);
      const replaced = Object.keys(before).filter(id => before[id]!.turn === first && ranking.holds[id] !== before[id]);
      const row: TurnRow = { passageId: record.passageId, first, focus: read.focus, states: Object.fromEntries(Object.entries(read.states).filter(([, state]) => state !== 'open')), lead: null, action: 'none', replaced, ...(read.complaint != null ? { complaint: read.complaint } : {}) };
      turns.push(row);
      if (pace?.verdict === 'may-offer-finish' && !pace.spent) {
        if (pace.offeredAfter !== undefined && after(record.passageId, pace.offeredAfter)) pace.spent = true;
        else if (read.novel >= RANKING.novel && after(record.passageId, pace.inputId)) pace.spent = true;
      }
      // The recorded calls already include the strong-novelty wake; these are the wakes added since.
      const last = calls.filter(call => call.startedAt <= event.at).at(-1);
      if ((last?.id ?? null) !== novelCall) { novelCall = last?.id ?? null; novelSince = new Set(); }
      const run = read.novel < RANKING.novel && read.novel >= RANKING.novelRun.probability && novelSince.add(first).size >= RANKING.novelRun.turns;
      const stall = ranking.current != null && read.states[ranking.current] === 'stalled';
      if (run || stall) {
        const next = calls.find(call => call.startedAt > event.at);
        const busy = last?.completedAt != null && last.completedAt > event.at ? last.completedAt : 0;
        const earliest = Math.max(event.at, (last?.startedAt ?? startedAt) + PRODUCER_LIMITS.mapFloor, busy);
        wakes.push({ passageId: record.passageId, why: stall ? 'stall' : 'novel run', gainS: next ? Math.max(0, Math.round((next.startedAt - earliest) / 1000)) : null });
      }
      pick(event.at, 'turn', { row, passageId: record.passageId });
    }
  }
  tickUntil((events.at(-1)?.at ?? 0) + 10 * 60_000);

  const recorded = records.filter((item): item is NoteRecord => item.source === 'note' && item.kind === 'list').sort((a, b) => (a.decidedAt ?? a.sentAt) - (b.decidedAt ?? b.sentAt));
  // Aligned as sequences, so one note the replay skips or adds doesn't misalign every note after it.
  const pairs = align(recorded.map(note => shape(note.text)), notes.map(note => shape(note.text)));
  const matched = pairs.filter(([a, b]) => a != null && b != null).length;
  const mismatches: RunResult['mismatches'] = pairs.filter(([a, b]) => a == null || b == null)
    .map(([a, b]) => ({ index: a ?? -1, recorded: a == null ? '—' : shape(recorded[a]!.text), replayed: b == null ? null : `${shape(notes[b]!.text)} @${(notes[b]!.providerMs / 1000).toFixed(1)}s` }));
  const unmatched = pairs.findIndex(([a, b]) => a == null || b == null);
  const firstMismatch = unmatched < 0 ? null : pairs.slice(0, unmatched).filter(([a]) => a != null).length;
  const landed = (note: NoteRecord) => note.delivery.startMs ?? toProvider(note.sentAt);
  const recordedHeld = records.filter((item): item is NoteRecord => item.source === 'note' && item.outcome === 'sent').filter(note => floorHeld(transcript, landed(note))).length;
  const mapNotes = records.filter((item): item is NoteRecord => item.source === 'note' && item.kind === 'map' && item.outcome === 'sent')
    .map(note => { const providerMs = toProvider(note.decidedAt ?? note.sentAt); return { providerMs, releasedMs: releaseAt(providerMs) }; });
  mapNotes.forEach((note, index) => { const next = mapNotes[index + 1]; if (next && note.releasedMs != null && next.releasedMs === note.releasedMs) note.releasedMs = null; });

  const leadAt = (ms: number) => notes.filter(note => note.releasedMs != null && note.releasedMs <= ms).at(-1)?.lead ?? null;
  const samPassages = transcript.filter(entry => entry.speaker === 'client').map(entry => ({ passageId: entry.id, startMs: entry.startMs, lead: leadAt(entry.startMs) }));
  const firstCueMs = Object.fromEntries([...created].map(([id, at]) => [id, notes.find(note => note.lead === id && note.at >= at) ? notes.find(note => note.lead === id && note.at >= at)!.at - at : null]));
  return {
    id: source.id, minutes: (transcript.at(-1)?.endMs ?? 0) / 60_000,
    fidelity: { matched, recorded: recorded.length, firstMismatch }, mismatches, recordedHeld,
    notes, mapNotes, turns, samPassages, firstCueMs, wakes,
  };
}

/** The participant spoke last and Sam hasn't started since: the floor is theirs, even in a pause. */
function floorHeld(transcript: TranscriptEntry[], ms: number) {
  const started = transcript.filter(entry => entry.startMs <= ms);
  if (started.some(entry => entry.speaker === 'client' && ms < entry.endMs)) return false;
  return started.at(-1)?.speaker === 'trainee';
}

/** A thread note's structure in either note format: what it asks Sam to do, about which thread, which others it names, and whether it offers to stop. */
function shape(text: string): string {
  // The offer line leads in v18 and trailed in earlier drafts; either way it is a flag, not the note's first move.
  const all = text.split('\n').slice(1);
  const offer = all.some(line => line.startsWith('Pace:'));
  const lines = all.filter(line => !line.startsWith('Pace:'));
  if (lines[0]?.startsWith('No open thread')) return `none${offer ? '|offer' : ''}`;
  if (lines[0]?.startsWith('They just gave feedback')) return `complaint|${lines[1] ?? ''}`;
  const lead = lines[0]?.match(/^(Keep pulling|Worth pulling next) \((.+?)\): /);
  if (!lead) return `?|${lines[0] ?? ''}`;
  const next = lines.find(line => line.startsWith('If that’s answered, then ('))?.match(/\((.+?)\):/)?.[1];
  const rest = lines.find(line => /^(Nearby|Also open): /.test(line))?.replace(/^(Nearby|Also open): /, '').split(' · ') ?? [];
  // The other threads as a set: v18 moved the runner-up to the front.
  return [lead[1] === 'Keep pulling' ? 'keep' : 'tug', lead[2], [...(next ? [next] : []), ...rest].sort().join(' · '), ...(offer ? ['offer'] : [])].join('|');
}

/** Longest common subsequence of two lists, as index pairs; an index paired with null has no counterpart. */
function align(a: string[], b: string[]): [number | null, number | null][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: [number | null, number | null][] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) pairs.push([i++, j++]);
    else if (j >= b.length || (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)) pairs.push([i++, null]);
    else pairs.push([null, j++]);
  }
  return pairs;
}

function metrics(run: RunResult) {
  const changes = run.notes.filter((note, index) => index > 0 && note.lead !== run.notes[index - 1]!.lead);
  const identical = run.notes.filter((note, index) => index > 0 && note.text === run.notes[index - 1]!.text).length;
  // Lead changes between consecutive turn readings: more than one means something other than a turn moved the lead.
  const turnTimes = run.notes.filter(note => note.cause === 'turn' || note.cause === 'deferred').map(note => note.at);
  const windows = new Map<number, number>();
  for (const note of changes) { const window = turnTimes.filter(at => at <= note.at).length; windows.set(window, (windows.get(window) ?? 0) + 1); }
  const cues = Object.values(run.firstCueMs);
  const released = [...run.notes, ...run.mapNotes].filter(note => note.releasedMs != null);
  const waits = released.map(note => note.releasedMs! - note.providerMs).sort((a, b) => a - b);
  const cued = cues.filter((value): value is number => value != null).sort((a, b) => a - b);
  return {
    minutes: +run.minutes.toFixed(1), notes: run.notes.length, perMinute: +(run.notes.length / Math.max(run.minutes, .1)).toFixed(1),
    leadChanges: changes.length, identical, multiChangeWindows: [...windows.values()].filter(count => count > 1).length,
    changesWhileTalking: changes.filter(note => note.talking).length, nonTurnChanges: changes.filter(note => note.cause !== 'turn' && note.cause !== 'deferred').length,
    deferredTurns: run.turns.filter(turn => turn.deferred).length,
    threads: cues.length, neverCued: cues.length - cued.length, firstCueP50s: cued.length ? +(cued[Math.floor(cued.length / 2)]! / 1000).toFixed(1) : null,
    replacedHolds: run.turns.reduce((sum, turn) => sum + turn.replaced.length, 0),
    newWakes: run.wakes?.length ?? 0,
    // Where notes reach Sam: recorded, and under the hold. Held notes a newer one replaced before Sam spoke never land.
    recordedNotesWhileFloorHeld: run.recordedHeld,
    notesWhileFloorHeld: released.filter(note => floorHeld(transcriptOf.get(run.id) ?? [], note.releasedMs!)).length,
    replacedWhileHeld: run.notes.length + run.mapNotes.length - released.length,
    holdP50s: waits.length ? +(waits[Math.floor(waits.length / 2)]! / 1000).toFixed(1) : null,
    holdMaxS: waits.length ? +(waits.at(-1)! / 1000).toFixed(1) : null,
    offers: run.notes.filter(note => note.offer && note.releasedMs != null).length,
  };
}

const results: RunResult[] = [];
const transcriptOf = new Map<string, TranscriptEntry[]>();
for (const path of paths) {
  const source = parse(await Bun.file(path).json());
  transcriptOf.set(source.id, source.transcript);
  results.push(replay(source));
}
const baseline = flag('baseline') ? (await Bun.file(flag('baseline')!).json()) as RunResult[] : null;

for (const run of results) {
  const short = run.id.slice(0, 8);
  const fidelity = run.fidelity ? `fidelity ${run.fidelity.matched}/${run.fidelity.recorded}${run.fidelity.firstMismatch != null ? ` (first mismatch at note ${run.fidelity.firstMismatch})` : ''}` : '';
  console.log(`\n${short} ${fidelity}`);
  console.log('  now      ', JSON.stringify(metrics(run)));
  const before = baseline?.find(item => item.id === run.id);
  if (before) {
    console.log('  baseline ', JSON.stringify(metrics(before)));
    // A turn re-read as it grew repeats its passage, so readings pair by their order among the same passage's.
    const nth = (turns: TurnRow[], index: number) => turns.slice(0, index).filter(item => item.passageId === turns[index]!.passageId).length;
    const changed = run.turns.flatMap((turn, index) => {
      const old = before.turns.filter(item => item.passageId === turn.passageId)[nth(run.turns, index)];
      return old && old.lead !== turn.lead ? [`${turn.passageId}: ${old.lead}→${turn.lead}`] : [];
    });
    console.log(`  picks changed after a turn (${changed.length}): ${changed.join(', ') || '—'}`);
    const sam = run.samPassages.flatMap(item => { const old = before.samPassages.find(entry => entry.passageId === item.passageId); return old && old.lead !== item.lead ? [`${item.passageId}: ${old.lead}→${item.lead}`] : []; });
    console.log(`  lead in force at Sam passages changed (${sam.length}): ${sam.join(', ') || '—'}`);
  }
  if (run.wakes.length) console.log(`  new Sol wakes (${run.wakes.length}): ${run.wakes.map(wake => `${wake.passageId} ${wake.why} ${wake.gainS == null ? 'no later call' : `${wake.gainS}s sooner`}`).join(', ')}`);
  if (verbose) {
    for (const item of run.mismatches) console.log(`    mismatch at note ${item.index}: recorded ${item.recorded} / replayed ${item.replayed ?? '—'}`);
    for (const turn of run.turns) console.log(`    turn ${turn.first}…${turn.passageId} focus ${turn.focus ?? '—'} ${Object.entries(turn.states).map(([id, state]) => `${id}=${state}`).join(' ')} → ${turn.action} ${turn.lead ?? '—'}${turn.replaced.length ? ` · replaced holds ${turn.replaced.join(',')}` : ''}`);
    for (const note of run.notes) console.log(`    note @${(note.providerMs / 1000).toFixed(1)}s→${note.releasedMs == null ? 'replaced' : `${(note.releasedMs / 1000).toFixed(1)}s`} ${note.cause}${note.talking ? ' (talking)' : ''} ${note.lead ?? '—'} ${note.text.split('\n').slice(1).join(' / ')}`);
  }
}
const output = flag('json');
if (output) { await Bun.write(output, JSON.stringify(results, null, 2)); console.log(`\nReport: ${output}`); }
