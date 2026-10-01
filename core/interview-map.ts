import { interviewTopics } from './interview';
import type { Speaker } from './simulator/types';

/**
 * Sol's conversation map: a loose graph of what the participant has said and the open gaps worth pulling on.
 * Sol is its only writer. Code rebuilds it from Sol's ID-accounted update and reads it to rank threads; it never edits it.
 */
export const ENTITY_KINDS = ['person', 'org', 'product', 'feature', 'event', 'decision', 'fact', 'term'] as const;
/** Only the participant establishes project facts, including by confirming something Sam said. Research is context. */
export const ENTITY_SOURCES = ['participant', 'research', 'seed'] as const;
export const EDGE_KINDS = ['built', 'part-of', 'decided', 'works-for', 'involved', 'happened-during'] as const;
export const THREAD_STATUSES = ['open', 'done', 'off'] as const;
export const MAP_TOPIC_IDS = interviewTopics.flatMap(topic => topic.objectives.map(item => item.id));
/** The participant is an ordinary node with a fixed ID, so anchors and edges can point at them. */
export const PARTICIPANT_ID = 'participant';
export const MAP_ID_PREFIX = { entities: 'e', edges: 'r', threads: 't' } as const;
/** Hard limits code enforces after the call. Sol's schema carries none of the string lengths: strict decoding cuts a string mid-word at its limit. */
export const MAP_LIMITS = { nodes: 160, label: 80, detail: 240, unknown: 200, guess: 200, reason: 240, vantage: 600, preference: 200, preferences: 4, anchors: 4, related: 4, topics: 2 };

export type EntityKind = typeof ENTITY_KINDS[number];
export type EntitySource = typeof ENTITY_SOURCES[number];
export type EdgeKind = typeof EDGE_KINDS[number];
export type ThreadStatus = typeof THREAD_STATUSES[number];
export type MapTopicId = typeof MAP_TOPIC_IDS[number];

/** Each preference is something the participant asked for or showed, citing that passage, so Sol's own advice can't pass as theirs. */
export type MapPreference = { text: string; passageId: string };
export type MapParticipant = { vantage: string; preferences: MapPreference[] };
export type MapEntity = { id: string; kind: EntityKind; label: string; detail: string; source: EntitySource; passageId: string | null };
export type MapEdge = { id: string; kind: EdgeKind; from: string; to: string };
/** A gap, never a question: Sam turns the unknown and the guess into a question of its own. Every thread carries a guess. */
export type MapThread = {
  id: string; label: string; anchors: string[]; unknown: string; guess: string;
  related: string[]; topics: MapTopicId[]; status: ThreadStatus; reason: string | null;
};
/** `nextIds` is code's bookkeeping, not Sol content: a dropped ID is never reused, so rankings and hold-downs keyed by ID stay sound. */
export type ConversationMap = {
  participant: MapParticipant; entities: MapEntity[]; edges: MapEdge[]; threads: MapThread[];
  nextIds: Record<typeof MAP_ID_PREFIX[keyof typeof MAP_ID_PREFIX], number>;
};

/** Unchanged nodes by ID, changed and new nodes in full, dropped nodes by ID with a reason. `participant: null` means unchanged. */
export type MapUpdate = {
  keep: string[]; drop: { id: string; reason: string }[];
  participant: MapParticipant | null; entities: MapEntity[]; edges: MapEdge[]; threads: MapThread[];
};
export type MapDefect = {
  kind: 'schema' | 'skipped' | 'duplicate' | 'unknown' | 'prefix' | 'reused' | 'dangling' | 'reason' | 'passage' | 'participant' | 'size';
  id: string; detail?: string;
};
export type MapChanges = { added: string[]; changed: string[]; dropped: string[]; kept: string[] };
export type MapResult = { ok: true; map: ConversationMap; changes: MapChanges } | { ok: false; defects: MapDefect[] };

export const emptyMap = (): ConversationMap => ({ participant: { vantage: '', preferences: [] }, entities: [], edges: [], threads: [], nextIds: { e: 1, r: 1, t: 1 } });

export function mapIds(map: ConversationMap): string[] {
  return [PARTICIPANT_ID, ...map.entities.map(item => item.id), ...map.edges.map(item => item.id), ...map.threads.map(item => item.id)];
}

const idNumber = (id: string, prefix: string) => new RegExp(`^${prefix}[1-9]\\d{0,3}$`).test(id) ? Number(id.slice(prefix.length)) : null;
/** Key order doesn't matter: a map read back from the archive must compare equal to the one that was saved. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([key, item]) => [key, canonical(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Rebuilds the full map from Sol's update. Every previous ID must be accounted for exactly once; nothing disappears silently.
 * Rejects rather than repairs: the probe counts defects, and a rejected update leaves the previous map in place. The one
 * repair: a reason on an open thread is cleared, since nothing reads it and a reopened thread would otherwise carry it unseen.
 * `passages` is the transcript Sol saw, used to check that participant facts and preferences cite a participant passage.
 */
export function applyMapUpdate(previous: ConversationMap, input: MapUpdate, passages: { id: string; speaker: Speaker }[]): MapResult {
  const update = { ...input, threads: input.threads.map(thread => thread.status === 'open' && thread.reason != null ? { ...thread, reason: null } : thread) };
  const defects: MapDefect[] = [];
  const before = new Set(mapIds(previous));
  const mentions = new Map<string, number>();
  const mention = (id: string) => mentions.set(id, (mentions.get(id) ?? 0) + 1);
  update.keep.forEach(mention);
  update.drop.forEach(item => mention(item.id));
  if (update.participant) mention(PARTICIPANT_ID);
  const nextIds = { ...previous.nextIds };
  for (const key of ['entities', 'edges', 'threads'] as const) {
    const prefix = MAP_ID_PREFIX[key];
    for (const item of update[key]) {
      mention(item.id);
      if (before.has(item.id)) {
        if (!previous[key].some(node => node.id === item.id)) defects.push({ kind: 'prefix', id: item.id, detail: `not a previous ${key.slice(0, -1)}` });
        continue;
      }
      const number = idNumber(item.id, prefix);
      if (number == null) defects.push({ kind: 'prefix', id: item.id, detail: key });
      else if (number < previous.nextIds[prefix]) defects.push({ kind: 'reused', id: item.id, detail: `next free is ${prefix}${previous.nextIds[prefix]}` });
      else nextIds[prefix] = Math.max(nextIds[prefix], number + 1);
    }
  }
  for (const id of before) if (!mentions.has(id)) defects.push({ kind: 'skipped', id });
  for (const [id, count] of mentions) if (count > 1) defects.push({ kind: 'duplicate', id });
  for (const id of [...update.keep, ...update.drop.map(item => item.id)]) if (!before.has(id)) defects.push({ kind: 'unknown', id });
  if (update.drop.some(item => item.id === PARTICIPANT_ID)) defects.push({ kind: 'participant', id: PARTICIPANT_ID, detail: 'cannot be dropped' });
  for (const item of update.drop) if (!item.reason.trim()) defects.push({ kind: 'reason', id: item.id });
  if (defects.length) return { ok: false, defects };

  const dropped = new Set(update.drop.map(item => item.id));
  const merge = <T extends { id: string }>(old: T[], next: T[]) => {
    const replaced = new Map(next.map(item => [item.id, item]));
    const kept = old.filter(item => !dropped.has(item.id)).map(item => replaced.get(item.id) ?? item);
    return [...kept, ...next.filter(item => !before.has(item.id))];
  };
  const map: ConversationMap = {
    participant: update.participant ?? previous.participant,
    entities: merge(previous.entities, update.entities),
    edges: merge(previous.edges, update.edges),
    threads: merge(previous.threads, update.threads),
    nextIds,
  };

  const entityIds = new Set([PARTICIPANT_ID, ...map.entities.map(item => item.id)]);
  const threadIds = new Set(map.threads.map(item => item.id));
  const speakers = new Map(passages.map(item => [item.id, item.speaker]));
  if (mapIds(map).length > MAP_LIMITS.nodes) defects.push({ kind: 'size', id: PARTICIPANT_ID, detail: `${mapIds(map).length} nodes` });
  for (const edge of map.edges) {
    for (const end of [edge.from, edge.to]) if (!entityIds.has(end)) defects.push({ kind: 'dangling', id: edge.id, detail: end });
    if (edge.from === edge.to) defects.push({ kind: 'dangling', id: edge.id, detail: 'self' });
  }
  for (const thread of map.threads) {
    if (!thread.anchors.length) defects.push({ kind: 'dangling', id: thread.id, detail: 'no anchor' });
    for (const anchor of thread.anchors) if (!entityIds.has(anchor)) defects.push({ kind: 'dangling', id: thread.id, detail: anchor });
    for (const related of thread.related) if (!threadIds.has(related) || related === thread.id) defects.push({ kind: 'dangling', id: thread.id, detail: related });
    if (thread.status !== 'open' && !thread.reason?.trim()) defects.push({ kind: 'reason', id: thread.id });
  }
  // A participant fact needs a participant passage: Sam's guesses and playbacks count only once the participant confirms them.
  // Research and seed facts come from outside the dialogue, so they cite none.
  for (const entity of update.entities) {
    const speaker = entity.passageId == null ? undefined : speakers.get(entity.passageId);
    if (entity.passageId != null && !speaker) defects.push({ kind: 'passage', id: entity.id, detail: entity.passageId });
    if (entity.source === 'participant' && speaker !== 'trainee') defects.push({ kind: 'passage', id: entity.id, detail: 'participant fact without a participant passage' });
    if (entity.source !== 'participant' && entity.passageId != null) defects.push({ kind: 'passage', id: entity.id, detail: `${entity.source} fact citing a passage` });
  }
  for (const preference of update.participant?.preferences ?? []) {
    if (speakers.get(preference.passageId) !== 'trainee') defects.push({ kind: 'passage', id: PARTICIPANT_ID, detail: `preference citing ${preference.passageId}, not a participant passage` });
  }
  if (defects.length) return { ok: false, defects };

  const old = new Map([...previous.entities, ...previous.edges, ...previous.threads].map(item => [item.id, item] as const));
  const upserts = [...update.entities, ...update.edges, ...update.threads];
  const participantChanged = !!update.participant && !same(update.participant, previous.participant);
  return { ok: true, map, changes: {
    added: upserts.filter(item => !before.has(item.id)).map(item => item.id),
    changed: [...(participantChanged ? [PARTICIPANT_ID] : []), ...upserts.filter(item => before.has(item.id) && !same(item, old.get(item.id))).map(item => item.id)],
    dropped: [...dropped],
    kept: [...update.keep, ...(update.participant && !participantChanged ? [PARTICIPANT_ID] : []), ...upserts.filter(item => before.has(item.id) && same(item, old.get(item.id))).map(item => item.id)],
  } };
}

const quote = (text: string) => JSON.stringify(text);

/**
 * The previous map as Sol reads it in its uncached tail. Compact by design: the tail is the largest uncached input,
 * so closed threads shrink to one line. A closed thread Sol reopens is written out again in full.
 */
export function renderMapForSol(map: ConversationMap): string {
  const open = map.threads.filter(item => item.status === 'open');
  const closed = map.threads.filter(item => item.status !== 'open');
  const lines = [
    `${PARTICIPANT_ID} | vantage: ${quote(map.participant.vantage)} | preferences: ${map.participant.preferences.map(item => `${quote(item.text)} [${item.passageId}]`).join('; ') || 'none'}`,
    `NEXT FREE IDS ${Object.entries(map.nextIds).map(([prefix, number]) => `${prefix}${number}`).join(' ')}`,
    'ENTITIES',
    ...map.entities.map(item => `${item.id} ${item.kind} ${quote(item.label)}: ${quote(item.detail)} [${item.source}${item.passageId ? ` ${item.passageId}` : ''}]`),
    'EDGES',
    ...map.edges.map(item => `${item.id} ${item.from} ${item.kind} ${item.to}`),
    'OPEN THREADS',
    ...open.map(item => `${item.id} ${quote(item.label)} | anchors ${item.anchors.join(',')} | unknown: ${quote(item.unknown)} | guess: ${quote(item.guess)}`
      + `${item.related.length ? ` | related ${item.related.join(',')}` : ''}${item.topics.length ? ` | topics ${item.topics.join(',')}` : ''}`),
    'CLOSED THREADS',
    ...closed.map(item => `${item.id} [${item.status}] ${quote(item.label)}: ${quote(item.reason ?? '')}`),
  ];
  return lines.join('\n');
}
