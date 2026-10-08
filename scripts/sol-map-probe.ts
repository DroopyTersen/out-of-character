/**
 * Replays an exported interview through Sol's map call on a simulated clock and reports latency, cache use and defects.
 * Usage: bun --env-file=.dev.vars scripts/sol-map-probe.ts <row.json> --paid --output=<path outside the repo>
 *   [--cadence=60] [--floor=20] [--limit=40] [--no-cache] [--effort=low|medium] [--timeout=50]
 * Paid: one Sol call per simulated wake. A passage is visible once its audio end plus 1.2 s has passed. Sol wakes on the timer
 * (cadence after the previous start, given a new participant turn) and when archived research arrived; Jev's "substantially new"
 * wake is not simulated. Coverage comes from the archived grades. The report holds transcript-derived maps: keep it out of the repo.
 * Cost units price input as uncached 1, cache read 0.05 and cache write 1.25, so they compare against a run with --no-cache.
 */
import { randomUUID } from 'node:crypto';
import { foundryConfig } from '../ai/foundry.server';
import { structuredWith } from '../interview-engine/providers/structured.server';
import { appendMapLog, emptyMapLog, generateMap, MapOutputError, MAP_EFFORT, MAP_PROMPT_VERSION, renderMapTail, researchLogEvent, settledPrefix, type MapLogEvent, type MapTail } from '../ai/interview/map.server';
import { DirectorOutputError } from '../ai/simulator/sol.server';
import { emptyMap, renderMapForSol, type MapChanges, type MapDefect, type MapPace } from '../core/interview-map';
import { yieldsTurn, type CoverageLevel, type InterviewBackground } from '../core/interview';
import { PRODUCER_LIMITS } from '../core/interview-producer';
import type { DirectorUsage } from '../core/simulator/director';
import type { TranscriptEntry } from '../core/simulator/types';

const [path, ...flags] = Bun.argv.slice(2);
const flag = (name: string) => flags.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!path || !flags.includes('--paid')) throw new Error('Usage: bun --env-file=.dev.vars scripts/sol-map-probe.ts <row.json> --paid --output=<path> [--cadence=60] [--floor=20] [--limit=40] [--no-cache] [--effort=low|medium] [--timeout=50]');
const output = flag('output');
if (!output) throw new Error('Pass --output=<path>; the report holds transcript-derived maps, so keep it outside the repo.');
const cadence = Number(flag('cadence') ?? 60) * 1000;
const floor = Number(flag('floor') ?? 20) * 1000;
const limit = Number(flag('limit') ?? 40);
const cache = !flags.includes('--no-cache');
const effort = flag('effort') ?? MAP_EFFORT;
if (effort !== 'low' && effort !== 'medium') throw new Error('--effort must be low or medium.');
// Defaults to production's map timeout; a longer one shows how far past it a slower effort runs.
const timeout = Number(flag('timeout') ?? PRODUCER_LIMITS.mapTimeout / 1000) * 1000;
const foundry = foundryConfig(process.env);

type Grade = { source: 'grade'; capturedAt: number; completedAt: number; lastInputId: string | null; objectives?: { id: string; shown: [CoverageLevel, string | null] }[] };
/** Lookups log as found at loggedAt; exports from before the map logged them as sent at sentAt. */
type Research = { source: 'research'; request: InterviewBackground['target']; outcome: string; facts?: InterviewBackground['facts']; loggedAt?: number; sentAt?: number; completedAt?: number };
const FOUND = ['found', 'sent'];
const raw = await Bun.file(path).json();
const row = (Array.isArray(raw) ? (raw[0]?.results?.[0] ?? raw[0]) : raw) as Record<string, unknown>;
const json = (field: unknown) => typeof field === 'string' ? JSON.parse(field) : field;
const transcript = json(row.transcript_json ?? row.transcript) as TranscriptEntry[];
const records = (json(row.interventions_json ?? row.interventions) ?? []) as { source: string }[];
if (!Array.isArray(transcript) || !transcript.length) throw new Error('Expected an interview row with transcript_json.');

const SETTLE_MS = 1200;
// A passage joins the log once it and everything before it have settled.
const visibleAt: number[] = [];
transcript.forEach((entry, index) => visibleAt.push(Math.max(index ? visibleAt[index - 1]! : 0, entry.endMs + SETTLE_MS)));
const endOf = new Map(transcript.map(entry => [entry.id, entry.endMs]));
const grades = records.filter((item): item is Grade => item.source === 'grade' && !!(item as Grade).objectives && (item as Grade).lastInputId != null)
  .map(item => ({ item, readyAt: endOf.get(item.lastInputId!)! + SETTLE_MS + (item.completedAt - item.capturedAt) })).filter(item => Number.isFinite(item.readyAt));
// Archive times are wall clock; the transcript is audio time. Map through the nearest earlier grade; without one there is no clock to map by.
const toAudio = (wall: number) => {
  const anchor = grades.filter(({ item }) => item.capturedAt <= wall).at(-1) ?? grades[0];
  const end = anchor && endOf.get(anchor.item.lastInputId!);
  return anchor && end != null ? wall - (anchor.item.capturedAt - end) : null;
};
const research = records.filter((item): item is Research => item.source === 'research' && [...FOUND, 'unresolved'].includes((item as Research).outcome));
const events: (MapLogEvent & { used: boolean; found: boolean })[] = research
  .flatMap(item => { const at = toAudio(item.loggedAt ?? item.sentAt ?? item.completedAt ?? NaN); return at == null || !Number.isFinite(at) ? [] : [{ atMs: at, text: researchLogEvent(item.request, FOUND.includes(item.outcome) ? item.facts ?? null : null), used: false, found: FOUND.includes(item.outcome) }]; })
  .sort((a, b) => a.atMs - b.atMs)
  .map((event, index) => ({ ...event, id: `L${index + 1}` }));
if (events.length < research.length) console.warn(`Skipped ${research.length - events.length} research events with no grade to place them on the audio clock.`);

const attemptId = `probe-${randomUUID()}`;
type Row = {
  call: number; atMs: number; reasons: string[]; blocks: number; latencyMs: number; outcome: 'ok' | 'defects' | 'incomplete' | 'error' | 'timeout';
  usage?: DirectorUsage; defects?: MapDefect[]; error?: string; changes?: Omit<MapChanges, 'kept'> & { kept: number }; open: number; closed: number; entities: number;
  /** The uncached tail Sol read and the update it returned, to debug a row without rerunning it. */
  tail: string; update?: unknown; pace?: MapPace;
};
const rows: Row[] = [];
const maps: { call: number; map: ReturnType<typeof emptyMap> }[] = [];
let map = emptyMap();
let log = emptyMapLog();
let loggedParticipant = 0;
let lastError = '';
let lastUpdate: unknown;
const request = async (url: string, options: RequestInit) => {
  const response = await fetch(url, options);
  if (!response.ok) lastError = (await response.clone().text()).slice(0, 600);
  else {
    const body = await response.clone().json().catch(() => null) as { output?: { type: string; content?: { text?: string }[] }[] } | null;
    const text = body?.output?.find(item => item.type === 'message')?.content?.[0]?.text;
    try { lastUpdate = text == null ? undefined : JSON.parse(text); } catch { lastUpdate = text; }
  }
  return response;
};
// A participant turn is a run of participant passages; Sam's backchannels and yields don't split one.
const turnsIn = (entries: TranscriptEntry[]) => entries.filter((entry, index) => entry.speaker === 'trainee'
  && entries.slice(0, index).findLast(item => item.speaker === 'trainee' || !yieldsTurn(item.text))?.speaker !== 'trainee').length;
let loggedTurns = 0;
const participantIndexes = transcript.flatMap((entry, index) => entry.speaker === 'trainee' ? [index] : []);
const nextParticipantAt = (count: number) => { const index = participantIndexes[count]; return index == null ? null : visibleAt[index]!; };

let at = nextParticipantAt(0);
console.log(`Sol map probe · ${foundry.agentModel} · ${MAP_PROMPT_VERSION} · effort ${effort} · timeout ${timeout / 1000}s · cadence ${cadence / 1000}s · floor ${floor / 1000}s · cache ${cache ? 'explicit' : 'off'} · ${transcript.length} passages`);
console.log('call   at   why                      blocks  ms     input  cached  written   tail  output  reason  visible  result');
while (at != null && rows.length < limit) {
  const settled = settledPrefix(transcript, entry => entry.endMs + SETTLE_MS <= at!);
  const participant = settled.filter(entry => entry.speaker === 'trainee').length;
  const arrived = events.filter(event => !event.used && event.atMs <= at!);
  arrived.forEach(event => { event.used = true; });
  const turns = turnsIn(settled);
  const reasons = [
    ...(participant > loggedParticipant ? [rows.length ? `timer: ${Math.max(1, turns - loggedTurns)} new participant turns` : 'first participant answer'] : []),
    ...(arrived.length ? ['research arrived'] : []),
  ];
  log = appendMapLog(log, settled, arrived);
  loggedParticipant = participant;
  loggedTurns = turns;
  const coverage = grades.filter(item => item.readyAt <= at!).at(-1)?.item.objectives?.map(item => ({ id: item.id, level: item.shown[0] })) ?? [];
  const started = performance.now();
  lastError = '';
  lastUpdate = undefined;
  const tail: MapTail = { coverage, reasons, elapsedMs: at, lastPassageId: settled.at(-1)?.id ?? null };
  const base = { call: rows.length + 1, atMs: at, reasons, blocks: log.blocks.length, tail: renderMapTail(map, tail) };
  let result: Row;
  try {
    const value = await generateMap({ structured: structuredWith(foundry, request), signal: AbortSignal.timeout(timeout), attemptId, blocks: log.blocks, previous: map, passages: settled, lookups: events.filter(event => event.used && event.found).map(event => event.id), cache, effort, tail });
    map = value.map;
    maps.push({ call: base.call, map });
    result = { ...base, latencyMs: Math.round(performance.now() - started), outcome: 'ok', usage: value.usage, changes: { ...value.changes, kept: value.changes.kept.length }, update: lastUpdate, pace: value.pace, ...counts() };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    if (error instanceof MapOutputError) result = { ...base, latencyMs, outcome: 'defects', usage: error.usage, defects: error.defects, update: error.value, ...counts() };
    else if (error instanceof DirectorOutputError && error.detail) result = { ...base, latencyMs, outcome: 'incomplete', usage: error.usage, error: error.message, ...counts() };
    else result = { ...base, latencyMs, outcome: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'error', error: `${error instanceof Error ? error.message : String(error)} ${lastError}`.trim(), ...counts() };
  }
  rows.push(result);
  print(result);
  // The first calls write the breakpoints; reads only settle from the fourth call on.
  if (rows.length === 4) console.log(`  cache share on call 4: ${share(rows.slice(3))}`);
  // Next start: the timer or research, never inside the floor or while this call was running.
  const timer = (() => { const next = nextParticipantAt(loggedParticipant); return next == null ? null : Math.max(at + cadence, next); })();
  const research = events.find(event => !event.used)?.atMs ?? null;
  const wake = [timer, research].filter((value): value is number => value != null);
  at = wake.length ? Math.max(Math.min(...wake), at + floor, at + result.latencyMs) : null;
}

function counts() {
  return { open: map.threads.filter(item => item.status === 'open').length, closed: map.threads.filter(item => item.status !== 'open').length, entities: map.entities.length };
}
function share(list: Row[]) {
  const input = list.reduce((sum, item) => sum + (item.usage?.inputTokens ?? 0), 0);
  const cached = list.reduce((sum, item) => sum + (item.usage?.cachedTokens ?? 0), 0);
  return input ? `${Math.round(cached / input * 100)}% of ${input} input tokens read from cache` : 'no usage reported';
}
/** Input neither read from nor written to the cache. */
function tailTokens(usage: DirectorUsage | undefined) {
  return usage?.inputTokens == null ? null : usage.inputTokens - (usage.cachedTokens ?? 0) - (usage.cacheWriteTokens ?? 0);
}
function costUnits(usage: DirectorUsage | undefined) {
  const tail = tailTokens(usage);
  return tail == null ? 0 : tail + .05 * (usage!.cachedTokens ?? 0) + 1.25 * (usage!.cacheWriteTokens ?? 0);
}
function print(item: Row) {
  const usage = item.usage;
  const visible = usage?.outputTokens == null ? null : usage.outputTokens - (usage.reasoningTokens ?? 0);
  const cell = (value: number | null | undefined, width: number) => String(value ?? '—').padStart(width);
  const status = item.outcome === 'ok' ? `ok +${item.changes!.added.length} ~${item.changes!.changed.length} -${item.changes!.dropped.length} · ${item.open} open ${item.closed} closed ${item.entities} entities${item.pace ? ` · ${item.pace.verdict}: ${item.pace.reason}` : ''}`
    : item.outcome === 'defects' ? `DEFECTS ${item.defects!.map(defect => `${defect.kind}:${defect.id}${defect.detail ? `(${defect.detail})` : ''}`).join(' ')}`
      : `${item.outcome.toUpperCase()} ${item.error ?? ''}`;
  console.log(`${String(item.call).padStart(4)} ${(item.atMs / 60_000).toFixed(1).padStart(5)}  ${item.reasons.join(', ').slice(0, 24).padEnd(24)} ${cell(item.blocks, 5)} ${cell(item.latencyMs, 6)} ${cell(usage?.inputTokens, 7)} ${cell(usage?.cachedTokens, 7)} ${cell(usage?.cacheWriteTokens, 8)} ${cell(tailTokens(usage), 6)} ${cell(usage?.outputTokens, 7)} ${cell(usage?.reasoningTokens, 7)} ${cell(visible, 8)}  ${status}`);
}

const ok = rows.filter(item => item.outcome === 'ok');
const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null; };
const latencies = rows.map(item => item.latencyMs);
const outputs = rows.flatMap(item => item.usage?.outputTokens != null ? [item.usage.outputTokens] : []);
const visible = rows.flatMap(item => item.usage?.outputTokens != null ? [item.usage.outputTokens - (item.usage.reasoningTokens ?? 0)] : []);
const tails = rows.flatMap(item => { const tail = tailTokens(item.usage); return tail == null ? [] : [tail]; });
const summary = {
  calls: rows.length, ok: ok.length, defects: rows.filter(item => item.outcome === 'defects').length, incomplete: rows.filter(item => item.outcome === 'incomplete').length,
  failed: rows.filter(item => item.outcome === 'error' || item.outcome === 'timeout').length,
  latencyMs: { p50: quantile(latencies, .5), p90: quantile(latencies, .9), max: Math.max(...latencies), overTimeout: latencies.filter(value => value > PRODUCER_LIMITS.mapTimeout).length },
  outputTokens: { p50: quantile(outputs, .5), p90: quantile(outputs, .9) },
  visibleOutputTokens: { p50: quantile(visible, .5), p90: quantile(visible, .9) },
  tailTokens: { p50: quantile(tails, .5), p90: quantile(tails, .9) },
  cacheShareFromFourth: share(rows.slice(3)),
  inputCostUnits: Math.round(rows.reduce((sum, item) => sum + costUnits(item.usage), 0)),
  uncachedInputTokens: rows.reduce((sum, item) => sum + (item.usage?.inputTokens ?? 0), 0),
  defectKinds: Object.fromEntries(Object.entries(Object.groupBy(rows.flatMap(item => item.defects ?? []), defect => defect.kind)).map(([kind, list]) => [kind, list!.length])),
};
console.log('\nSummary', JSON.stringify(summary, null, 2));
console.log(`\nFinal map\n${renderMapForSol(map)}`);
await Bun.write(output, JSON.stringify({ collectedAt: new Date().toISOString(), model: foundry.agentModel, version: MAP_PROMPT_VERSION, effort, attemptId, cadence, floor, cache, summary, rows, maps, blocks: log.blocks }, null, 2));
console.log(`\nReport: ${output}`);
