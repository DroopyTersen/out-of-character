import { COVERAGE_LEVEL_LABELS, COVERAGE_LEVELS, interviewTopics } from './interview';
import type { GradeObjective, ProducerLogRecord, ProducerTrigger } from './interview-producer';
import type { TranscriptEntry } from './simulator/types';

export const TIMELINE_LANES = ['dialogue', 'producer', 'research', 'rundown', 'assessment', 'grade', 'delegation'] as const;
export type TimelineLane = typeof TIMELINE_LANES[number];
/** One debug row: offsets are from the session start; latency is the row's own span, parts break it down. */
export type TimelineRow = {
  id: string; lane: TimelineLane; atMs: number; title: string; detail: string | null;
  outcome: string | null; latencyMs: number | null; parts: { label: string; ms: number }[];
};

const labels = new Map<string, string>(interviewTopics.flatMap(topic => topic.objectives.map(item => [item.id, item.label])));
const span = (from: number | undefined, to: number | undefined) => from != null && to != null ? to - from : null;
const parts = (entries: [string, number | undefined, number | undefined][]) =>
  entries.flatMap(([label, from, to]) => { const ms = span(from, to); return ms == null ? [] : [{ label, ms }]; });
const trigger = (item: ProducerTrigger) => item.kind === 'check-in' ? 'check-in'
  : item.kind === 'research' ? `research ${item.status}` : `${item.condition} ${item.probability.toFixed(2)}`;
const band = (level: GradeObjective['shown'][0]) => COVERAGE_LEVEL_LABELS[level].toLowerCase();
const odds = (levels: GradeObjective['levels']) => levels ? ` (${COVERAGE_LEVELS.map((level, index) => `${level[0]} ${levels[index]!.toFixed(2)}`).join(' ')})` : '';
const heard = (id: string | null | undefined) => id !== undefined ? `Next observed Sam passage after ${id ?? 'start'}` : null;

/**
 * Dialogue, Sol consultations, research cards, rundowns, assessments, coverage grades and delegations in one
 * time order. Dialogue offsets come from the voice session, so they can trail producer
 * timestamps by the connection time.
 */
export function producerTimeline({ startedAt, transcript, records }: { startedAt: number; transcript: TranscriptEntry[]; records: ProducerLogRecord[] }): TimelineRow[] {
  const at = (time: number) => time - startedAt;
  const rows: TimelineRow[] = transcript.map(entry => ({
    id: entry.id, lane: 'dialogue', atMs: entry.startMs, title: `${entry.speaker === 'trainee' ? 'Participant' : 'Sam'} · ${entry.id}`,
    detail: entry.text, outcome: null, latencyMs: null, parts: [],
  }));
  let graded = new Map<string, GradeObjective>();
  for (const record of records) {
    if (record.source === 'producer') {
      const request = record.result?.research;
      const detail = [record.result?.cue ? `“${record.result.cue}” (${record.result.evidenceIds.join(', ')})` : record.result ? 'No cue' : null,
        request ? `Research ${request.kind} “${request.name}”${request.clue ? ` · clue “${request.clue}”` : ''}` : null, heard(record.nextSamTurnAfterId)].filter(Boolean).join(' · ');
      const outcome = record.reason ? `${record.outcome} (${record.reason})` : record.outcome;
      rows.push({
        id: record.id, lane: 'producer', atMs: at(record.triggeredAt), title: `Sol · ${record.triggers.map(trigger).join(', ')}${record.queued ? ' · queued' : ''}`,
        detail: detail || null, outcome: record.check?.probability != null ? `${outcome} · check ${record.check.probability.toFixed(2)}` : outcome,
        latencyMs: span(record.triggeredAt, record.sentAt ?? record.completedAt),
        parts: parts([['wait', record.triggeredAt, record.startedAt], ['Sol', record.startedAt, record.generatedAt], ['check', record.generatedAt, record.checkedAt], ['to Sam', record.sentAt, record.nextSamTurnAt]]),
      });
    } else if (record.source === 'research') {
      const found = record.facts?.length ? `${record.facts.length} fact${record.facts.length === 1 ? '' : 's'}: ${record.facts.map(fact => fact.text).join(' / ')}` : null;
      rows.push({
        id: record.id, lane: 'research', atMs: at(record.requestedAt), title: `Research · ${record.request.kind} “${record.request.name}”${record.request.clue ? ` · clue “${record.request.clue}”` : ''}`,
        detail: [found, record.reason, heard(record.nextSamTurnAfterId)].filter(Boolean).join(' · ') || null,
        outcome: record.check?.probability != null ? `${record.outcome} · check ${record.check.probability.toFixed(2)}` : record.outcome,
        latencyMs: span(record.requestedAt, record.sentAt ?? record.completedAt),
        parts: parts([['lookup', record.requestedAt, record.lookupAt], ['check', record.lookupAt, record.checkedAt], ['to Sam', record.sentAt, record.nextSamTurnAt]]),
      });
    } else if (record.source === 'rundown') {
      const bands = COVERAGE_LEVELS.filter(level => level !== 'not-yet').flatMap(level => {
        const ids = Object.entries(record.levels).filter(([, value]) => value === level).map(([id]) => labels.get(id) ?? id);
        return ids.length ? [`${COVERAGE_LEVEL_LABELS[level]}: ${ids.join(', ')}`] : [];
      });
      rows.push({ id: record.id, lane: 'rundown', atMs: at(record.sentAt), title: `Rundown · ${record.reason} · ${record.elapsedMinutes} min`,
        detail: bands.join(' · ') || 'Nothing covered yet', outcome: record.delivery ? `${record.outcome} · ${record.delivery.status}` : record.outcome, latencyMs: null, parts: [] });
    } else if (record.source === 'assessment') {
      const signals = record.signals.flatMap(item => 'probability' in item && item.probability >= .5 ? [`${item.condition} ${item.probability.toFixed(2)}`] : []);
      if (record.researchProbability != null && record.researchProbability >= .5) signals.push(`research ${record.researchProbability.toFixed(2)}`);
      rows.push({ id: record.id, lane: 'assessment', atMs: at(record.snapshotAt), title: `Assessment · through ${record.lastInputId ?? 'start'}`,
        detail: signals.join(', ') || null, outcome: record.concerns.length ? `${record.outcome} · concern ${record.concerns.join(', ')}` : record.outcome,
        latencyMs: span(record.snapshotAt, record.completedAt), parts: [] });
    } else if (record.source === 'grade') {
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
    } else {
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

/** Accepts an `interview_attempts` row (as exported from D1) or `{ startedAt, transcript, interventions }`. */
export function parseTimelineExport(value: unknown): { startedAt: number; transcript: TranscriptEntry[]; records: ProducerLogRecord[] } {
  const row = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | undefined;
  const json = (field: unknown) => typeof field === 'string' ? JSON.parse(field) : field;
  const startedAt = Number(row?.started_at ?? row?.startedAt);
  const transcript = json(row?.transcript_json ?? row?.transcript);
  const records = json(row?.interventions_json ?? row?.interventions);
  if (!Number.isFinite(startedAt) || !Array.isArray(transcript) || !Array.isArray(records)) throw new Error('Expected an interview archive row with started_at, transcript_json and interventions_json.');
  return { startedAt, transcript, records };
}
