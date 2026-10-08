/**
 * Replays archived Sol updates and Jev readings through the current ranking and note templates. No paid calls.
 * Recorded readings approximate the new policy: this cannot predict Sam's speech or score newly introduced gaps.
 * Usage: bun scripts/interview-replay.ts <row.json>... [--json=<private path>] [--baseline=<earlier --json>] [--verbose]
 */
import { latestTurn, upToParticipant } from '../interview-engine/interview/conversation/ranking.server';
import { applyMapUpdate, emptyMap, type ConversationMap } from '../interview-engine/interview/conversation/map';
import { emptyListState, nextListNote } from '../interview-engine/interview/conversation/notes';
import { type MapRecord, type NoteRecord, type ProducerLogRecord, type TurnRecord } from '../interview-engine/interview/conversation/records';
import { emptyRanking, observeMap, observeTurn, threadKey } from '../interview-engine/interview/conversation/ranking';
import { parseTimelineExport } from '../core/interview-timeline';

const args = Bun.argv.slice(2);
const paths = args.filter(item => !item.startsWith('--'));
const flag = (name: string) => args.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!paths.length) throw new Error('Usage: bun scripts/interview-replay.ts <row.json>... [--json=<private path>] [--baseline=<earlier --json>] [--verbose]');

type Event = { at: number; record: MapRecord; map: ConversationMap } | { at: number; record: TurnRecord };
function replay(source: ReturnType<typeof parseTimelineExport>, id: string) {
  const { transcript, records, startedAt } = source;
  const maps = new Map<string, ConversationMap>();
  const events: Event[] = [];
  let current = emptyMap();
  for (const record of records.filter((item): item is MapRecord => item.source === 'map' && item.outcome === 'applied').sort((a, b) => a.startedAt - b.startedAt)) {
    if (!record.update) throw new Error(`${id}: map ${record.id} was shed from the archive; later maps cannot be rebuilt.`);
    const lookups = records.flatMap(item => item.source === 'research' && item.outcome === 'found' && item.eventId && item.loggedAt != null && item.loggedAt <= record.startedAt ? [item.eventId] : []);
    const result = applyMapUpdate(current, record.update, transcript, lookups);
    if (!result.ok) throw new Error(`${id}: map ${record.id} no longer applies: ${JSON.stringify(result.defects.slice(0, 3))}`);
    current = result.map;
    maps.set(record.id, current);
    events.push({ at: record.completedAt!, record, map: current });
  }
  for (const record of records) if (record.source === 'turn' && record.outcome === 'read' && record.reading) events.push({ at: record.completedAt!, record });
  events.sort((a, b) => a.at - b.at || Number(b.record.source === 'map') - Number(a.record.source === 'map'));
  current = emptyMap();
  let mapId: string | null = null;
  let ranking = emptyRanking();
  let list = emptyListState();
  let skipped = 0;
  const notes: { atMs: number; passageId: string; lead: string | null; text: string }[] = [];
  for (const event of events) {
    if ('map' in event) {
      current = event.map;
      mapId = event.record.id;
      ranking = observeMap(ranking, current);
      continue;
    }
    const record = event.record;
    // A live producer ignores a turn result whose map was replaced while Jev read it.
    if (record.mapId !== mapId) { skipped++; continue; }
    const shown = record.mapId == null ? emptyMap() : maps.get(record.mapId)!;
    const boundary = transcript.findIndex(entry => entry.id === record.passageId);
    const turn = latestTurn(upToParticipant(transcript.slice(0, boundary + 1)));
    ranking = observeTurn(ranking, current, {
      ...record.reading!, passageId: record.passageId,
      keys: Object.fromEntries(shown.threads.filter(thread => thread.status === 'open').map(thread => [thread.id, threadKey(thread)])),
    }, turn[0]?.id ?? record.passageId);
    const decision = nextListNote(current, ranking, list);
    list = decision.state;
    if (decision.text) notes.push({ atMs: event.at - startedAt, passageId: record.passageId, lead: decision.pick.lead, text: decision.text });
  }
  const recorded = records.filter((item): item is NoteRecord => item.source === 'note' && item.kind === 'list' && item.outcome === 'sent');
  const leads = notes.map(note => note.lead);
  const summary = {
    turns: events.filter(event => event.record.source === 'turn').length, skipped,
    recordedNotes: recorded.length, replayedNotes: notes.length,
    leadReturns: leads.filter((lead, i) => lead != null && i >= 2 && lead !== leads[i - 1] && lead === leads[i - 2]).length,
  };
  return { id, summary, notes };
}

const runs: ReturnType<typeof replay>[] = [];
for (const path of paths) {
  const raw = await Bun.file(path).json();
  const value = raw.row ?? raw;
  const row = Array.isArray(value) ? value[0]?.results?.[0] ?? value[0] : value;
  const run = replay(parseTimelineExport(value), String(row.id ?? path));
  runs.push(run);
  console.log(run.id, JSON.stringify(run.summary));
  if (args.includes('--verbose')) for (const note of run.notes) console.log(`  ${(note.atMs / 1000).toFixed(1)}s ${note.passageId}\n${note.text}`);
}
if (flag('baseline')) {
  const baseline = await Bun.file(flag('baseline')!).json() as { runs: { id: string; summary: unknown }[] };
  for (const run of runs) console.log('comparison', run.id, JSON.stringify({ before: baseline.runs.find(item => item.id === run.id)?.summary ?? null, after: run.summary }));
}
if (flag('json')) await Bun.write(flag('json')!, JSON.stringify({ policy: 'interview-producer-v26', runs }, null, 2));
