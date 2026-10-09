import { z } from 'zod';
import type { ModelUsage, SolMessage, StructuredRequest } from '../../providers/structured.server';
import type { InterviewBackground, InterviewObjectiveReading } from '../../shared/snapshot';
import type { Passage } from '../../shared/transcript';
import { RESEARCH_KINDS, type ResearchRequest } from './records';
import {
  applyMapUpdate, EDGE_KINDS, ENTITY_KINDS, ENTITY_SOURCES, MAP_LIMITS, mapTopicIds, renderMapForSol, THREAD_STATUSES,
  type ConversationMap, type MapChanges, type MapDefect, type MapTopicId, type MapUpdate,
} from './map';
import { mapInstructions, mapSeed, type MappedSpec } from './map.prompt';

export { mapInstructions, mapSeed, type MappedSpec } from './map.prompt';
type TranscriptEntry = Passage;
/** Part of the cache key: any change to the instructions, schema, seed or effort needs a new version. */
export const MAP_PROMPT_VERSION = 'sol-map-v17';
export const MAP_EFFORT = 'low';
/** Reasoning counts against this; a whole first map plus reasoning must fit. */
export const MAP_MAX_OUTPUT_TOKENS = 8000;
/** The seed plus the latest three log blocks: four writes at most, and a failed call still leaves an earlier block to read from. */
const LOG_BREAKPOINTS = 3;

const text = (max: number) => z.string().trim().max(max);
const buildOutputSchema = (topicIds: [MapTopicId, ...MapTopicId[]]) => z.strictObject({
  vantage: text(MAP_LIMITS.vantage).nullable(),
  preferences: z.array(z.strictObject({ text: text(MAP_LIMITS.preference).min(1), passageId: z.string() })).max(MAP_LIMITS.preferences).nullable(),
  entities: z.array(z.strictObject({
    id: z.string(), kind: z.enum(ENTITY_KINDS), label: text(MAP_LIMITS.label), detail: text(MAP_LIMITS.detail),
    source: z.enum(ENTITY_SOURCES), passageId: z.string().nullable(),
  })),
  edges: z.array(z.strictObject({ id: z.string(), kind: z.enum(EDGE_KINDS), from: z.string(), to: z.string() })),
  threads: z.array(z.strictObject({
    id: z.string(), label: text(MAP_LIMITS.label), anchors: z.array(z.string()).max(MAP_LIMITS.anchors),
    unknown: text(MAP_LIMITS.unknown).min(1), guess: text(MAP_LIMITS.guess),
    related: z.array(z.string()).max(MAP_LIMITS.related),
    topics: z.array(z.enum(topicIds)).max(MAP_LIMITS.topics),
    status: z.enum(THREAD_STATUSES), reason: text(MAP_LIMITS.reason).nullable(),
  })),
  revise: z.array(z.strictObject({ id: z.string(), unknown: text(MAP_LIMITS.unknown).min(1), guess: text(MAP_LIMITS.guess) })),
  close: z.array(z.strictObject({ id: z.string(), status: z.enum(['done', 'off']), reason: text(MAP_LIMITS.reason) })),
  drop: z.array(z.strictObject({ id: z.string(), reason: text(MAP_LIMITS.reason) })),
  /** Code verifies that the participant named the lookup target. */
  research: z.strictObject({
    kind: z.enum(RESEARCH_KINDS), name: z.string().trim().min(1), clue: z.string().trim().nullable(), passageIds: z.array(z.string()),
  }).nullable(),
});

const strip = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'maxLength' && key !== 'minLength').map(([key, value]) => [key, strip(value)]));
};
type MapSchemas = { output: ReturnType<typeof buildOutputSchema>; wire: Record<string, unknown> };
const schemas = new WeakMap<MappedSpec, MapSchemas>();
const mapSchemas = (spec: MappedSpec): MapSchemas => {
  let found = schemas.get(spec);
  if (!found) {
    const output = buildOutputSchema(mapTopicIds(spec) as [MapTopicId, ...MapTopicId[]]);
    found = { output, wire: strip(z.toJSONSchema(output)) as Record<string, unknown> };
    schemas.set(spec, found);
  }
  return found;
};
/** The update Sol returns; thread topics are the spec's objective IDs. */
export const mapOutputSchema = (spec: MappedSpec) => mapSchemas(spec).output;
/** What Sol is sent: the same shape without string lengths, so an overlong string fails validation instead of being cut mid-word. */
export const mapWireSchema = (spec: MappedSpec) => mapSchemas(spec).wire;

/**
 * The append-only transcript log. A block is committed when a call starts, whatever its outcome, so its rendering never changes.
 * `logged` holds each passage's text as last logged, to render growth as a continuation.
 */
export type MapLog = { blocks: string[]; logged: Record<string, string> };
/** `id` is what a research fact cites, so code knows which lookups a map carries. */
export type MapLogEvent = { id: string; atMs: number; text: string };
export const emptyMapLog = (): MapLog => ({ blocks: [], logged: {} });

const minutes = (ms: number) => (Math.max(0, ms) / 60_000).toFixed(1);
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
const speakerName = (spec: MappedSpec, entry: Pick<TranscriptEntry, 'speaker'>) => entry.speaker === 'participant' ? 'participant' : spec.interviewer.name;

/** Passages are logged in order, so one still being transcribed holds back everything after it until it settles. */
export function settledPrefix(transcript: TranscriptEntry[], settled: (entry: TranscriptEntry) => boolean): TranscriptEntry[] {
  const index = transcript.findIndex(entry => !settled(entry));
  return index < 0 ? transcript : transcript.slice(0, index);
}

/** Settled passages whose current text the log doesn't have yet. */
export function unloggedPassages(log: MapLog, settled: TranscriptEntry[]): TranscriptEntry[] {
  return settled.filter(entry => { const current = oneLine(entry.text); return !!current && log.logged[entry.id] !== current; });
}

/** Appends one block of new settled passages and events in time order; returns the same log when nothing is new. */
export function appendMapLog(spec: MappedSpec, log: MapLog, settled: TranscriptEntry[], events: MapLogEvent[] = []): MapLog {
  const logged = { ...log.logged };
  const lines: string[] = [];
  const pending = [...events].sort((a, b) => a.atMs - b.atMs);
  const flush = (untilMs: number) => { while (pending.length && pending[0]!.atMs <= untilMs) { const event = pending.shift()!; lines.push(`[event ${event.id} · ${minutes(event.atMs)} min] ${oneLine(event.text)}`); } };
  for (const entry of settled) {
    const current = oneLine(entry.text);
    const previous = logged[entry.id];
    if (previous === current || !current) continue;
    flush(entry.startMs);
    if (previous == null) lines.push(`[${entry.id} · ${speakerName(spec, entry)} · ${minutes(entry.startMs)} min] ${current}`);
    else if (current.startsWith(previous)) lines.push(`[${entry.id} · ${speakerName(spec, entry)} · continued] ${current.slice(previous.length).trim()}`);
    else lines.push(`[${entry.id} · ${speakerName(spec, entry)} · corrected] ${current}`);
    logged[entry.id] = current;
  }
  flush(Infinity);
  return lines.length ? { blocks: [...log.blocks, lines.join('\n')], logged } : log;
}

/** Research is context Sol may record as source research; it never establishes what happened on the project. */
export function researchLogEvent(target: InterviewBackground['target'], facts: InterviewBackground['facts'] | null, reason?: string): string {
  if (!facts?.length) return `Public research about the ${target.kind} "${target.name}" found nothing reliable${reason ? `: ${reason}` : ''}.`;
  return `Public research about the ${target.kind} "${target.name}" (public background, not project fact): ${facts.map(fact => `${fact.text} [${fact.title}]`).join(' · ')}`;
}

/** The volatile state, never cached: everything here may change between calls. */
export type MapTail = {
  coverage: Pick<InterviewObjectiveReading, 'id' | 'level' | 'applicability'>[];
  /** Jev's per-thread state for the latest participant turn, by thread ID. */
  signals?: { threadId: string; state: string }[];
  reasons: string[];
  elapsedMs: number;
  lastPassageId: string | null;
  /** Lookups requested so far, and how many remain. */
  research?: { requests: { kind: ResearchRequest['kind']; name: string; clue: string | null; status: string }[]; left: number };
};

export function renderMapTail(spec: MappedSpec, previous: ConversationMap, tail: MapTail): string {
  const first = !previous.entities.length && !previous.threads.length && !previous.participant.vantage;
  const coverage = new Map(tail.coverage.map(item => [item.id, item.applicability ? `${item.level}; applicability: ${item.applicability}` : item.level]));
  return [
    `PREVIOUS MAP${first ? ' (empty: this is your first call)' : ''}\n${renderMapForSol(previous)}`,
    `COVERAGE (Jev's readings; fallible)\n${mapTopicIds(spec).map(id => `- ${id}: ${coverage.get(id) ?? 'not-yet'}`).join('\n')}`,
    ...(tail.signals?.length ? [`THREAD SIGNALS (Jev, latest participant turn; fallible)\n${tail.signals.map(item => `- ${item.threadId}: ${item.state}`).join('\n')}`] : []),
    ...(tail.research ? [`RESEARCH (${tail.research.left} lookup${tail.research.left === 1 ? '' : 's'} left)\n${tail.research.requests.map(item => `- ${item.kind} "${item.name}"${item.clue ? ` (clue: ${item.clue})` : ''}: ${item.status}`).join('\n') || '- none requested yet'}`] : []),
    `WHY NOW\n${tail.reasons.map(reason => `- ${reason}`).join('\n') || '- scheduled'}`,
    `CLOCK\n${minutes(tail.elapsedMs)} minutes elapsed; last logged passage ${tail.lastPassageId ?? 'none'}.`,
    'Return your edits.',
  ].join('\n\n');
}

/** Seed and latest log blocks carry breakpoints; the tail is last and never cached. */
export function mapMessages(spec: MappedSpec, blocks: string[], tail: string): SolMessage[] {
  return [
    { role: 'developer', text: mapSeed(spec), cache: true },
    ...blocks.map((text, index) => ({ role: 'user' as const, text, cache: index >= blocks.length - LOG_BREAKPOINTS })),
    { role: 'user', text: tail },
  ];
}

export const mapCacheKey = (attemptId: string) => `sol-map:${MAP_PROMPT_VERSION}:${attemptId}`;

/** Carries what Sol returned, so a rejected update can still be counted and inspected. */
export class MapOutputError extends Error {
  constructor(readonly defects: MapDefect[], readonly value: unknown, readonly model: string, readonly usage: ModelUsage) {
    super(`Map update was invalid: ${defects.slice(0, 5).map(item => `${item.kind} ${item.id}${item.detail ? ` (${item.detail})` : ''}`).join('; ')}${defects.length > 5 ? '; …' : ''}`);
  }
}

export async function generateMap(input: {
  spec: MappedSpec;
  /** The providers' structured call to the agent model. */
  structured: StructuredRequest;
  signal: AbortSignal; attemptId: string; blocks: string[]; previous: ConversationMap; tail: MapTail;
  /** Every passage Sol has seen, to check what participant facts cite. */
  passages: Pick<TranscriptEntry, 'id' | 'speaker'>[];
  /** The IDs of every event in the log, to check what research facts cite. */
  lookups?: string[];
  /** False sends no cache options, for deployments that reject them. */
  cache?: boolean;
  /** For probes comparing efforts; production uses MAP_EFFORT. */
  effort?: 'low' | 'medium';
}): Promise<{ map: ConversationMap; update: MapUpdate; changes: MapChanges; research: ResearchRequest | null; model: string; usage: ModelUsage }> {
  const { output, wire } = mapSchemas(input.spec);
  const { value, model, usage } = await input.structured({
    signal: input.signal, instructions: mapInstructions(input.spec), name: 'conversation_map_update', schema: output, jsonSchema: wire,
    effort: input.effort ?? MAP_EFFORT, maxOutputTokens: MAP_MAX_OUTPUT_TOKENS,
    messages: mapMessages(input.spec, input.blocks, renderMapTail(input.spec, input.previous, input.tail)), cacheKey: input.cache === false ? null : mapCacheKey(input.attemptId),
  });
  const parsed = output.safeParse(value);
  if (!parsed.success) throw new MapOutputError(parsed.error.issues.map(issue => ({ kind: 'schema', id: issue.path.join('.'), detail: issue.message })), value, model, usage);
  const { research, ...update } = parsed.data;
  const result = applyMapUpdate(input.previous, update, input.passages, input.lookups);
  if (!result.ok) throw new MapOutputError(result.defects, value, model, usage);
  return { map: result.map, update, changes: result.changes, research, model, usage };
}
