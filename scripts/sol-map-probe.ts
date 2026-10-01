/**
 * Replays an exported interview through Sol's map call on a simulated clock and reports latency, cache use and defects.
 * Usage: bun --env-file=.dev.vars scripts/sol-map-probe.ts <row.json> --paid --output=<path outside the repo>
 *   [--cadence=60] [--floor=20] [--limit=40] [--no-cache]
 * Paid: one Sol call per simulated wake. A passage is visible once its audio end plus 1.2 s has passed. Sol wakes on the timer
 * (cadence after the previous start, given a new participant turn) and when archived research arrived; Jev's "substantially new"
 * wake is not simulated. Coverage comes from the archived grades. The report holds transcript-derived maps: keep it out of the repo.
 */
import { randomUUID } from 'node:crypto';
import { foundryConfig } from '../ai/foundry.server';
import { appendMapLog, emptyMapLog, generateMap, MapOutputError, MAP_PROMPT_VERSION, researchLogEvent, settledPrefix, type MapLogEvent } from '../ai/interview/map.server';
import { emptyMap, renderMapForSol, type MapChanges, type MapDefect } from '../core/interview-map';
import type { CoverageLevel, InterviewBackground } from '../core/interview';
import type { DirectorUsage } from '../core/simulator/director';
import type { TranscriptEntry } from '../core/simulator/types';

const [path, ...flags] = Bun.argv.slice(2);
const flag = (name: string) => flags.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!path || !flags.includes('--paid')) throw new Error('Usage: bun --env-file=.dev.vars scripts/sol-map-probe.ts <row.json> --paid --output=<path> [--cadence=60] [--floor=20] [--limit=40] [--no-cache]');
const output = flag('output');
if (!output) throw new Error('Pass --output=<path>; the report holds transcript-derived maps, so keep it outside the repo.');
const cadence = Number(flag('cadence') ?? 60) * 1000;
const floor = Number(flag('floor') ?? 20) * 1000;
const limit = Number(flag('limit') ?? 40);
const cache = !flags.includes('--no-cache');
const foundry = foundryConfig(process.env);

type Grade = { source: 'grade'; capturedAt: number; completedAt: number; lastInputId: string | null; objectives?: { id: string; shown: [CoverageLevel, string | null] }[] };
type Research = { source: 'research'; request: InterviewBackground['target']; outcome: string; facts?: InterviewBackground['facts']; sentAt?: number; completedAt?: number };
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
// Archive times are wall clock; the transcript is audio time. Map through the nearest earlier grade.
const toAudio = (wall: number) => {
  const anchor = grades.filter(({ item }) => item.capturedAt <= wall).at(-1) ?? grades[0];
  return anchor ? wall - (anchor.item.capturedAt - endOf.get(anchor.item.lastInputId!)!) : 0;
};
const events: (MapLogEvent & { used: boolean })[] = records.filter((item): item is Research => item.source === 'research' && ['sent', 'unresolved'].includes((item as Research).outcome))
  .flatMap(item => { const at = item.sentAt ?? item.completedAt; return at == null ? [] : [{ atMs: toAudio(at), text: researchLogEvent(item.request, item.outcome === 'sent' ? item.facts ?? null : null), used: false }]; })
  .sort((a, b) => a.atMs - b.atMs);

const attemptId = `probe-${randomUUID()}`;
type Row = {
  call: number; atMs: number; reasons: string[]; blocks: number; latencyMs: number; outcome: 'ok' | 'defects' | 'error' | 'timeout';
  usage?: DirectorUsage; defects?: MapDefect[]; error?: string; changes?: Omit<MapChanges, 'kept'> & { kept: number }; open: number; closed: number; entities: number;
};
const rows: Row[] = [];
const maps: { call: number; map: ReturnType<typeof emptyMap> }[] = [];
let map = emptyMap();
let log = emptyMapLog();
let loggedParticipant = 0;
let lastError = '';
const request = async (url: string, options: RequestInit) => {
  const response = await fetch(url, options);
  if (!response.ok) lastError = (await response.clone().text()).slice(0, 600);
  return response;
};
const participantIndexes = transcript.flatMap((entry, index) => entry.speaker === 'trainee' ? [index] : []);
const nextParticipantAt = (count: number) => { const index = participantIndexes[count]; return index == null ? null : visibleAt[index]!; };

let at = nextParticipantAt(0);
console.log(`Sol map probe · ${foundry.agentModel} · ${MAP_PROMPT_VERSION} · cadence ${cadence / 1000}s · floor ${floor / 1000}s · cache ${cache ? 'explicit' : 'off'} · ${transcript.length} passages`);
console.log('call   at   why                      blocks  ms     input  cached  written  output  reason  result');
while (at != null && rows.length < limit) {
  const settled = settledPrefix(transcript, entry => entry.endMs + SETTLE_MS <= at!);
  const participant = settled.filter(entry => entry.speaker === 'trainee').length;
  const arrived = events.filter(event => !event.used && event.atMs <= at!);
  arrived.forEach(event => { event.used = true; });
  const reasons = [
    ...(participant > loggedParticipant ? [rows.length ? `timer: ${participant - loggedParticipant} new participant turns` : 'first participant answer'] : []),
    ...(arrived.length ? ['research arrived'] : []),
  ];
  log = appendMapLog(log, settled, arrived);
  loggedParticipant = participant;
  const coverage = grades.filter(item => item.readyAt <= at!).at(-1)?.item.objectives?.map(item => ({ id: item.id, level: item.shown[0] })) ?? [];
  const started = performance.now();
  lastError = '';
  const base = { call: rows.length + 1, atMs: at, reasons, blocks: log.blocks.length };
  let result: Row;
  try {
    const value = await generateMap({
      foundry, signal: AbortSignal.timeout(30_000), attemptId, blocks: log.blocks, previous: map, passages: settled, cache,
      tail: { coverage, reasons, elapsedMs: at, lastPassageId: settled.at(-1)?.id ?? null },
    }, request);
    map = value.map;
    maps.push({ call: base.call, map });
    result = { ...base, latencyMs: Math.round(performance.now() - started), outcome: 'ok', usage: value.usage, changes: { ...value.changes, kept: value.changes.kept.length }, ...counts() };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    if (error instanceof MapOutputError) result = { ...base, latencyMs, outcome: 'defects', usage: error.usage, defects: error.defects, ...counts() };
    else result = { ...base, latencyMs, outcome: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'error', error: `${error instanceof Error ? error.message : String(error)} ${lastError}`.trim(), ...counts() };
  }
  rows.push(result);
  print(result);
  if (rows.length === 3) console.log(`  cache share after call 3: ${share(rows.slice(1))}`);
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
function print(item: Row) {
  const usage = item.usage;
  const cell = (value: number | null | undefined, width: number) => String(value ?? '—').padStart(width);
  const status = item.outcome === 'ok' ? `ok +${item.changes!.added.length} ~${item.changes!.changed.length} -${item.changes!.dropped.length} · ${item.open} open ${item.closed} closed ${item.entities} entities`
    : item.outcome === 'defects' ? `DEFECTS ${item.defects!.map(defect => `${defect.kind}:${defect.id}${defect.detail ? `(${defect.detail})` : ''}`).join(' ')}`
      : `${item.outcome.toUpperCase()} ${item.error ?? ''}`;
  console.log(`${String(item.call).padStart(4)} ${(item.atMs / 60_000).toFixed(1).padStart(5)}  ${item.reasons.join(', ').slice(0, 24).padEnd(24)} ${cell(item.blocks, 5)} ${cell(item.latencyMs, 6)} ${cell(usage?.inputTokens, 7)} ${cell(usage?.cachedTokens, 7)} ${cell(usage?.cacheWriteTokens, 8)} ${cell(usage?.outputTokens, 7)} ${cell(usage?.reasoningTokens, 7)}  ${status}`);
}

const ok = rows.filter(item => item.outcome === 'ok');
const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null; };
const latencies = rows.map(item => item.latencyMs);
const outputs = rows.flatMap(item => item.usage?.outputTokens != null ? [item.usage.outputTokens] : []);
const summary = {
  calls: rows.length, ok: ok.length, defects: rows.filter(item => item.outcome === 'defects').length, failed: rows.filter(item => item.outcome === 'error' || item.outcome === 'timeout').length,
  latencyMs: { p50: quantile(latencies, .5), p90: quantile(latencies, .9), max: Math.max(...latencies) },
  outputTokens: { p50: quantile(outputs, .5), p90: quantile(outputs, .9) },
  cacheShareAfterFirst: share(rows.slice(1)),
  defectKinds: Object.fromEntries(Object.entries(Object.groupBy(rows.flatMap(item => item.defects ?? []), defect => defect.kind)).map(([kind, list]) => [kind, list!.length])),
};
console.log('\nSummary', JSON.stringify(summary, null, 2));
console.log(`\nFinal map\n${renderMapForSol(map)}`);
await Bun.write(output, JSON.stringify({ collectedAt: new Date().toISOString(), model: foundry.agentModel, version: MAP_PROMPT_VERSION, attemptId, cadence, floor, cache, summary, rows, maps, blocks: log.blocks }, null, 2));
console.log(`\nReport: ${output}`);
