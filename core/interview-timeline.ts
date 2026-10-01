import { COVERAGE_LEVEL_LABELS, COVERAGE_LEVELS, interviewTopics } from './interview';
import type { GradeObjective, ProducerLogRecord } from './interview-producer';
import type { TranscriptEntry } from './simulator/types';

export const TIMELINE_LANES = ['dialogue', 'map', 'turn', 'traits', 'note', 'research', 'grade', 'delegation'] as const;
export type TimelineLane = typeof TIMELINE_LANES[number];
/** One debug row: offsets are from the session start; latency is the row's own span, parts break it down. */
export type TimelineRow = {
  id: string; lane: TimelineLane; atMs: number; title: string; detail: string | null;
  outcome: string | null; latencyMs: number | null; parts: { label: string; ms: number }[];
};

const SOURCES = new Set<string>(['map', 'turn', 'traits', 'note', 'research', 'grade', 'delegation'] satisfies ProducerLogRecord['source'][]);
const labels = new Map<string, string>(interviewTopics.flatMap(topic => topic.objectives.map(item => [item.id, item.label])));
const span = (from: number | undefined, to: number | undefined) => from != null && to != null ? to - from : null;
const parts = (entries: [string, number | undefined, number | undefined][]) =>
  entries.flatMap(([label, from, to]) => { const ms = span(from, to); return ms == null ? [] : [{ label, ms }]; });
const band = (level: GradeObjective['shown'][0]) => COVERAGE_LEVEL_LABELS[level].toLowerCase();
const odds = (levels: GradeObjective['levels']) => levels ? ` (${COVERAGE_LEVELS.map((level, index) => `${level[0]} ${levels[index]!.toFixed(2)}`).join(' ')})` : '';
const heard = (id: string | null | undefined) => id !== undefined ? `Next observed Sam passage after ${id ?? 'start'}` : null;
const ids = (label: string, items: string[] | undefined) => items?.length ? `${label} ${items.join(', ')}` : null;
const join = (items: (string | null | undefined | false)[]) => items.filter(Boolean).join(' · ') || null;

/** Candidate long gaps on the provider's transcript clock; a listener decides who held the floor. */
export function interviewTurnGaps(transcript: TranscriptEntry[]) {
  const gaps: { afterPassageId: string; beforePassageId: string; gapMs: number; sam: string; questionMark: boolean }[] = [];
  let last: TranscriptEntry | undefined;
  let sam = '';
  for (const entry of [...transcript].sort((a, b) => a.startMs - b.startMs)) {
    const extendsSpeech = !last || entry.endMs > last.endMs;
    if (entry.speaker === 'trainee') {
      if (last?.speaker === 'client' && entry.startMs - last.endMs >= 8000) {
        gaps.push({ afterPassageId: last.id, beforePassageId: entry.id, gapMs: entry.startMs - last.endMs, sam, questionMark: sam.includes('?') });
      }
      if (extendsSpeech) sam = '';
    } else {
      sam += entry.text;
    }
    // A backchannel inside a long participant passage does not become the last speech.
    if (extendsSpeech) last = entry;
  }
  return gaps;
}

/**
 * Dialogue, Sol's map calls, Jev's turn and trait readings, notes to Sam, lookups, coverage grades and delegations in
 * one time order. Dialogue offsets come from the voice session, so they can trail producer timestamps by the
 * connection time.
 */
export function producerTimeline({ startedAt, transcript, records }: { startedAt: number; transcript: TranscriptEntry[]; records: ProducerLogRecord[] }): TimelineRow[] {
  const at = (time: number) => time - startedAt;
  const rows: TimelineRow[] = transcript.map(entry => ({
    id: entry.id, lane: 'dialogue', atMs: entry.startMs, title: `${entry.speaker === 'trainee' ? 'Participant' : 'Sam'} · ${entry.id}`,
    detail: entry.text, outcome: null, latencyMs: null, parts: [],
  }));
  let graded = new Map<string, GradeObjective>();
  for (const record of records) {
    switch (record.source) {
      case 'map': {
        const request = record.research;
        rows.push({
          id: record.id, lane: 'map', atMs: at(record.startedAt), title: `Sol map · through ${record.lastInputId ?? 'start'}`,
          detail: join([record.reasons.join('; '), ids('added', record.changes?.added), ids('changed', record.changes?.changed), ids('dropped', record.changes?.dropped),
            request && `research ${request.kind} “${request.name}”${request.clue ? ` · clue “${request.clue}”` : ''}`,
            !!record.defects?.length && `defects ${record.defects.map(item => `${item.kind} ${item.id}`).join(', ')}`]),
          outcome: record.outcome, latencyMs: span(record.startedAt, record.completedAt), parts: [],
        });
        break;
      }
      case 'turn': {
        const reading = record.reading;
        const states = reading ? Object.entries(reading.states).filter(([, state]) => state !== 'open').map(([id, state]) => `${id} ${state}`) : [];
        const pick = record.pick;
        rows.push({
          id: record.id, lane: 'turn', atMs: at(record.startedAt), title: `Jev turn · ${record.passageId}`,
          detail: join([reading && `focus ${reading.focus ?? 'none'}`, reading && `novel ${reading.novel.toFixed(2)}`, states.join(', '),
            pick && (pick.action === 'none' ? 'pick none' : `${pick.action} ${pick.lead}${pick.nearby.length ? ` · nearby ${pick.nearby.join(', ')}` : ''}`)]),
          outcome: record.outcome, latencyMs: record.durationMs ?? span(record.startedAt, record.completedAt), parts: [],
        });
        break;
      }
      case 'traits':
        rows.push({
          id: record.id, lane: 'traits', atMs: at(record.startedAt), title: `Jev traits · ${record.threadIds.join(', ')}`,
          detail: record.traits ? Object.entries(record.traits).map(([id, [spicy, grounding]]) => `${id} spicy ${spicy.toFixed(2)} grounding ${grounding.toFixed(2)}`).join(' · ') : null,
          outcome: record.outcome, latencyMs: record.durationMs ?? span(record.startedAt, record.completedAt), parts: [],
        });
        break;
      case 'note':
        rows.push({
          id: record.id, lane: 'note', atMs: at(record.sentAt), title: `Note · ${record.kind}${record.mapId ? ` · ${record.mapId}` : ''}`,
          detail: join([record.text.split('\n').filter(Boolean).join(' / '), ids('research', record.researchIds), heard(record.nextSamTurnAfterId)]),
          outcome: `${record.outcome} · ${record.delivery.status}`, latencyMs: span(record.sentAt, record.nextSamTurnAt), parts: [],
        });
        break;
      case 'research': {
        const found = record.facts?.length ? `${record.facts.length} fact${record.facts.length === 1 ? '' : 's'}: ${record.facts.map(fact => fact.text).join(' / ')}` : null;
        rows.push({
          id: record.id, lane: 'research', atMs: at(record.requestedAt), title: `Research · ${record.request.kind} “${record.request.name}”${record.request.clue ? ` · clue “${record.request.clue}”` : ''}`,
          detail: join([found, record.reason]), outcome: record.outcome, latencyMs: span(record.requestedAt, record.loggedAt ?? record.completedAt),
          parts: parts([['lookup', record.requestedAt, record.lookupAt], ['to Sol', record.lookupAt, record.loggedAt]]),
        });
        break;
      }
      case 'grade': {
        // Keep probability-only changes visible as well as changes to bands or evidence.
        const moved = (record.objectives ?? []).flatMap(item => {
          const before = graded.get(item.id);
          if (before && JSON.stringify(before) === JSON.stringify(item)) return [];
          const [level, evidenceId] = item.shown;
          const [ownLevel, ownEvidenceId] = item.graded;
          const shown = before && before.shown[0] !== level ? `${band(before.shown[0])} → ${band(level)}` : band(level);
          const own = level !== ownLevel || evidenceId !== ownEvidenceId ? `; graded ${band(ownLevel)} · ${ownEvidenceId ?? 'no evidence'}` : '';
          return [`${labels.get(item.id) ?? item.id}: ${shown} · ${evidenceId ?? 'no evidence'}${own}${odds(item.levels)}`];
        });
        if (record.objectives) graded = new Map(record.objectives.map(item => [item.id, item]));
        rows.push({ id: record.id, lane: 'grade', atMs: at(record.capturedAt), title: `Grade · ${record.final ? 'final' : 'live'} · through ${record.lastInputId ?? 'start'}`,
          detail: moved.join('; ') || null, outcome: record.outcome, latencyMs: record.durationMs ?? span(record.capturedAt, record.completedAt), parts: [] });
        break;
      }
      case 'delegation':
        rows.push({ id: record.id, lane: 'delegation', atMs: at(record.createdAt), title: `Delegation${record.target ? ` · ${record.target}` : ''}`,
          detail: null, outcome: record.replied ? 'replied' : 'no reply', latencyMs: null, parts: [] });
    }
  }
  return rows.sort((a, b) => a.atMs - b.atMs || TIMELINE_LANES.indexOf(a.lane) - TIMELINE_LANES.indexOf(b.lane));
}

export function formatTimelineRows(rows: TimelineRow[]): string {
  const clock = (ms: number) => `${Math.floor(Math.max(0, ms) / 60_000)}:${String(Math.floor(Math.max(0, ms) % 60_000 / 1000)).padStart(2, '0')}`;
  return rows.map(row => [
    `${clock(row.atMs).padStart(5)}  ${row.lane.padEnd(10)}  ${row.title}${row.outcome ? `  [${row.outcome}]` : ''}${row.latencyMs != null ? `  ${row.latencyMs} ms` : ''}`,
    row.parts.length ? `${' '.repeat(19)}${row.parts.map(part => `${part.label} ${part.ms} ms`).join(' · ')}` : null,
    row.detail ? `${' '.repeat(19)}${row.detail}` : null,
  ].filter(Boolean).join('\n')).join('\n');
}

/**
 * Accepts an `interview_attempts` row (as exported from D1) or `{ startedAt, transcript, interventions }`. Records from
 * earlier producer versions (cues, assessments, rundowns, turn prompts) are counted in `skipped`, not shown.
 */
export function parseTimelineExport(value: unknown): { startedAt: number; transcript: TranscriptEntry[]; records: ProducerLogRecord[]; skipped: number } {
  const row = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | undefined;
  const json = (field: unknown) => typeof field === 'string' ? JSON.parse(field) : field;
  const startedAt = Number(row?.started_at ?? row?.startedAt);
  const transcript = json(row?.transcript_json ?? row?.transcript);
  const all = json(row?.interventions_json ?? row?.interventions);
  if (!Number.isFinite(startedAt) || !Array.isArray(transcript) || !Array.isArray(all)) throw new Error('Expected an interview archive row with started_at, transcript_json and interventions_json.');
  const records = all.filter((item): item is ProducerLogRecord => SOURCES.has((item as { source?: unknown })?.source as string));
  return { startedAt, transcript, records, skipped: all.length - records.length };
}
