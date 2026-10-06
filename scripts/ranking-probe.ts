/**
 * Replays an exported interview through Jev's turn and trait readings against the maps a Sol map probe produced,
 * and prints the picks and the notes Sam would have received.
 * Usage: bun --env-file=.dev.vars scripts/ranking-probe.ts <row.json> <sol-map-probe report.json> --paid --output=<path outside the repo> [--limit=80]
 * Paid: one Jev call per settled participant turn that isn't backchannels alone, plus one per map change with new or rewritten threads.
 * A map applies once its Sol call finished (start plus latency); the replay stops a cadence after the last Sol call. The report holds transcript-derived notes: keep it out of the repo.
 */
import { evaluateTraits, evaluateTurn, latestTurn } from '../ai/interview/ranking.server';
import { yieldsTurn } from '../core/interview';
import type { ConversationMap } from '../core/interview-map';
import { emptyListState, mapNote, mapNoteKey, nextListNote } from '../core/interview-notes';
import { emptyRanking, observeMap, observeTurn, RANKING, threadsNeedingTraits, withTraits, type Pick, type TurnReading } from '../core/interview-ranking';
import type { TranscriptEntry } from '../core/simulator/types';

const [path, reportPath, ...flags] = Bun.argv.slice(2);
const flag = (name: string) => flags.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!path || !reportPath || !flags.includes('--paid')) throw new Error('Usage: bun --env-file=.dev.vars scripts/ranking-probe.ts <row.json> <sol-map-probe report.json> --paid --output=<path> [--limit=80]');
const output = flag('output');
if (!output) throw new Error('Pass --output=<path>; the report holds transcript-derived notes, so keep it outside the repo.');
const limit = Number(flag('limit') ?? 80);
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error('Load TYPESAFE_API_KEY with bun --env-file=.dev.vars.');

const raw = await Bun.file(path).json();
const row = (Array.isArray(raw) ? (raw[0]?.results?.[0] ?? raw[0]) : raw) as Record<string, unknown>;
const json = (field: unknown) => typeof field === 'string' ? JSON.parse(field) : field;
const transcript = json(row.transcript_json ?? row.transcript) as TranscriptEntry[];
if (!Array.isArray(transcript) || !transcript.length) throw new Error('Expected an interview row with transcript_json.');
type SolRow = { call: number; atMs: number; latencyMs: number; outcome: string };
const report = await Bun.file(reportPath).json() as { cadence: number; rows: SolRow[]; maps: { call: number; map: ConversationMap }[] };
const maps = report.maps.map(item => { const sol = report.rows.find(rowItem => rowItem.call === item.call)!; return { ...item, startedAt: sol.atMs, readyAt: sol.atMs + sol.latencyMs }; });

const SETTLE_MS = 1200;
// A participant turn is read once it and everything before it have settled, as in the Sol probe.
const visibleAt: number[] = [];
transcript.forEach((entry, index) => visibleAt.push(Math.max(index ? visibleAt[index - 1]! : 0, entry.endMs + SETTLE_MS)));
// Past the Sol probe's last call plus one cadence the map would be stale, so the replay stops there.
const end = Math.max(...report.rows.map(item => item.atMs)) + report.cadence;
// A participant turn ends where Sam takes a turn rather than a backchannel or a yield, as latestTurn reads it.
const samRepliesAfter = (index: number) => {
  for (const entry of transcript.slice(index + 1)) { if (entry.speaker === 'trainee') return false; if (!yieldsTurn(entry.text)) return true; }
  return true;
};
const turns = transcript.flatMap((entry, index) => entry.speaker === 'trainee' && samRepliesAfter(index) && visibleAt[index]! <= end
  ? [{ index, atMs: visibleAt[index]! }] : []);

type Row = {
  passageId: string; atMs: number; mapCall: number | null; focus: string | null; novel: number; complaint?: number; durationMs: number; inputTokens?: number;
  natural?: TurnReading['natural']; states?: TurnReading['states']; holds?: string[];
  pick: Omit<Pick, 'ranked'> & { top: [string, number, string][] }; listNote?: string; mapNote?: string; error?: string;
};
const rows: Row[] = [];
const traitCalls: { mapCall: number; threads: number; durationMs: number; inputTokens?: number; error?: string }[] = [];
let state = emptyRanking();
let applied: (typeof maps)[number] | null = null;
let list = emptyListState();
let lastMap = '';
let backchannels = 0;
console.log(`Ranking probe · ${turns.length} participant turns · ${maps.length} maps`);
for (const turn of turns.slice(0, limit)) {
  const ready = maps.filter(item => item.readyAt <= turn.atMs).at(-1) ?? null;
  if (ready && ready !== applied) {
    applied = ready;
    state = observeMap(state, ready.map, ready.startedAt);
    const threads = threadsNeedingTraits(ready.map, state);
    if (threads.length) {
      const started = performance.now();
      try {
        const traits = await evaluateTraits({ map: ready.map, threads, apiKey, signal: AbortSignal.timeout(10_000) });
        state = withTraits(state, traits.traits);
        traitCalls.push({ mapCall: ready.call, threads: threads.length, durationMs: traits.durationMs, inputTokens: traits.usage.inputTokens });
      } catch (error) {
        traitCalls.push({ mapCall: ready.call, threads: threads.length, durationMs: Math.round(performance.now() - started), error: String(error) });
      }
    }
  }
  const map = applied?.map ?? null;
  const settled = transcript.slice(0, turn.index + 1);
  const passageId = settled.at(-1)!.id;
  if (!map) { console.log(`${passageId.padStart(5)} ${(turn.atMs / 60_000).toFixed(1).padStart(5)}  no map yet`); continue; }
  if (!latestTurn(settled).length) { backchannels++; console.log(`${passageId.padStart(5)} ${(turn.atMs / 60_000).toFixed(1).padStart(5)}  backchannel only, not read`); continue; }
  const started = performance.now();
  let item: Row;
  try {
    const result = await evaluateTurn({ transcript: settled, map, apiKey, atMs: turn.atMs, signal: AbortSignal.timeout(10_000) });
    state = observeTurn(state, map, result.reading, latestTurn(settled)[0]!.id);
    // The producer's thread note as of interview-producer-v17, picked as if the participant had stopped talking.
    const decision = nextListNote(map, state, turn.atMs, list, { turn: true });
    list = decision.state;
    const { ranked, ...pick } = decision.pick;
    item = {
      passageId, atMs: turn.atMs, mapCall: applied!.call, focus: result.reading.focus, novel: result.reading.novel, complaint: result.reading.complaint, durationMs: result.durationMs, inputTokens: result.usage.inputTokens,
      natural: result.reading.natural, states: result.reading.states, holds: Object.keys(state.holds),
      pick: { ...pick, top: ranked.slice(0, 4).map(entry => [entry.id, +entry.score.toFixed(2), entry.band]) },
    };
    if (decision.text) item.listNote = decision.text;
    const mapKey = mapNoteKey(map);
    if (mapKey !== lastMap) { lastMap = mapKey; const note = mapNote(map); if (note) item.mapNote = note; }
  } catch (error) {
    item = { passageId, atMs: turn.atMs, mapCall: applied!.call, focus: null, novel: 0, durationMs: Math.round(performance.now() - started), error: String(error),
      pick: { current: state.current, action: 'none', lead: null, nearby: [], top: [] } };
  }
  rows.push(item);
  const top = item.pick.top.map(([id, value, band]) => `${id}:${value}${band === 'right-there' ? '★' : band === 'nearby' ? '·' : ''}`).join(' ');
  console.log(`${passageId.padStart(5)} ${(turn.atMs / 60_000).toFixed(1).padStart(5)}  map ${String(item.mapCall).padStart(2)}  ${String(item.durationMs).padStart(5)}ms  focus ${String(item.focus ?? '—').padEnd(4)} new ${item.novel.toFixed(2)}${(item.complaint ?? 0) >= RANKING.complaint ? ` complaint ${item.complaint!.toFixed(2)}` : ''}  ${item.pick.action.padEnd(4)} ${String(item.pick.lead ?? '—').padEnd(4)} | ${top}${item.error ? `  ERROR ${item.error}` : ''}`);
  const states = Object.entries(item.states ?? {}).map(([id, value]) => `${id}=${value}`).join(' ');
  if (states || item.holds?.length) console.log(`        states ${states || '—'} · holding ${item.holds?.join(',') || '—'}`);
  if (item.listNote) console.log(`        ${item.listNote.split('\n').slice(1).join('\n        ')}`);
  if (item.mapNote) console.log(`        [map note] ${item.mapNote.split('\n').slice(1).join(' / ')}`);
}

const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null; };
const ok = rows.filter(item => !item.error);
const leads = ok.map(item => item.pick.lead);
const summary = {
  turns: rows.length, backchannels, errors: rows.length - ok.length, listNotes: rows.filter(item => item.listNote).length, mapNotes: rows.filter(item => item.mapNote).length,
  turnMs: { p50: quantile(ok.map(item => item.durationMs), .5), p90: quantile(ok.map(item => item.durationMs), .9) },
  turnInputTokens: { p50: quantile(ok.flatMap(item => item.inputTokens ?? []), .5), max: Math.max(...ok.flatMap(item => item.inputTokens ?? [0])) },
  traitCalls: traitCalls.length, traitErrors: traitCalls.filter(item => item.error).length,
  novelWakes: ok.filter(item => item.novel >= RANKING.novel).length,
  complaints: ok.filter(item => (item.complaint ?? 0) >= RANKING.complaint).length,
  noPick: ok.filter(item => item.pick.action === 'none').length,
  // A→B→A: the lead changes back to one of the two leads before the one it just left.
  leadReturns: leads.reduce((count, lead, index) => { const changes = leads.slice(0, index).filter((value, i, list) => value !== list[i - 1]); return count + (lead != null && lead !== leads[index - 1] && changes.slice(-3, -1).includes(lead) ? 1 : 0); }, 0),
};
console.log('\nSummary', JSON.stringify(summary, null, 2));
await Bun.write(output, JSON.stringify({ collectedAt: new Date().toISOString(), summary, rows, traitCalls }, null, 2));
console.log(`\nReport: ${output}`);
