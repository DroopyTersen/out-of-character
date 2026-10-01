import { expect, test } from 'bun:test';
import { applyMapUpdate, emptyMap, PARTICIPANT_ID, renderMapForSol, type ConversationMap, type MapEntity, type MapThread, type MapUpdate } from './interview-map';

const passages = [
  { id: 'p1', speaker: 'client' as const }, { id: 'p2', speaker: 'trainee' as const },
  { id: 'p3', speaker: 'client' as const }, { id: 'p4', speaker: 'trainee' as const },
];
const entity = (id: string, changes: Partial<MapEntity> = {}): MapEntity => ({ id, kind: 'product', label: `Entity ${id}`, detail: 'Per the participant.', source: 'participant', passageId: 'p2', ...changes });
const thread = (id: string, changes: Partial<MapThread> = {}): MapThread => ({
  id, label: `Thread ${id}`, anchors: ['e1'], unknown: 'who decided', guess: null, related: [], topics: ['client-decisions'], status: 'open', reason: null, ...changes,
});
const update = (changes: Partial<MapUpdate>): MapUpdate => ({ keep: [], drop: [], participant: null, entities: [], edges: [], threads: [], ...changes });
const first = (changes: Partial<MapUpdate> = {}) => update({
  participant: { vantage: 'App tech lead for the whole project.', preferences: '' },
  entities: [entity('e1'), entity('e2', { kind: 'person', label: 'Dana' })],
  edges: [{ id: 'r1', kind: 'decided', from: 'e2', to: 'e1' }],
  threads: [thread('t1'), thread('t2', { anchors: ['e2', PARTICIPANT_ID], related: ['t1'] })],
  ...changes,
});
const built = (): ConversationMap => {
  const result = applyMapUpdate(emptyMap(), first(), passages);
  if (!result.ok) throw new Error(JSON.stringify(result.defects));
  return result.map;
};

test('a first update builds the map and advances the next free IDs', () => {
  const result = applyMapUpdate(emptyMap(), first(), passages);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.map.entities.map(item => item.id)).toEqual(['e1', 'e2']);
  expect(result.map.nextIds).toEqual({ e: 3, r: 2, t: 3 });
  expect(result.changes).toEqual({ added: ['e1', 'e2', 'r1', 't1', 't2'], changed: [PARTICIPANT_ID], dropped: [], kept: [] });
});

test('an update keeps, changes, closes and drops by ID, and nothing disappears silently', () => {
  const map = built();
  const result = applyMapUpdate(map, update({
    keep: [PARTICIPANT_ID, 'e1', 'r1', 't2'], drop: [{ id: 'e2', reason: 'merged into e3' }],
    entities: [entity('e3', { kind: 'person', label: 'Dana Ruiz', passageId: 'p4' })],
    edges: [], threads: [thread('t1', { status: 'done', reason: 'Answered at p4.' })],
  }), passages);
  // r1 and t2 still point at e2, so dropping it alone is rejected.
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.defects).toEqual([{ kind: 'dangling', id: 'r1', detail: 'e2' }, { kind: 'dangling', id: 't2', detail: 'e2' }]);

  const fixed = applyMapUpdate(map, update({
    keep: [PARTICIPANT_ID, 'e1'], drop: [{ id: 'e2', reason: 'merged into e3' }],
    entities: [entity('e3', { kind: 'person', label: 'Dana Ruiz', passageId: 'p4' })],
    edges: [{ id: 'r1', kind: 'decided', from: 'e3', to: 'e1' }],
    threads: [thread('t1', { status: 'done', reason: 'Answered at p4.' }), thread('t2', { anchors: ['e3'], related: ['t1'] })],
  }), passages);
  expect(fixed.ok).toBe(true);
  if (!fixed.ok) return;
  expect(fixed.map.entities.map(item => item.id)).toEqual(['e1', 'e3']);
  expect(fixed.map.threads.map(item => [item.id, item.status])).toEqual([['t1', 'done'], ['t2', 'open']]);
  expect(fixed.map.nextIds).toEqual({ e: 4, r: 2, t: 3 });
  expect(fixed.changes).toEqual({ added: ['e3'], changed: ['r1', 't1', 't2'], dropped: ['e2'], kept: [PARTICIPANT_ID, 'e1'] });
});

test('a rewritten node identical to its previous version counts as kept', () => {
  const map = built();
  const result = applyMapUpdate(map, update({ participant: map.participant, keep: ['e2', 'r1', 't1', 't2'], entities: [map.entities[0]!] }), passages);
  expect(result.ok && result.changes).toEqual({ added: [], changed: [], dropped: [], kept: ['e2', 'r1', 't1', 't2', PARTICIPANT_ID, 'e1'] });
});

test('ID accounting rejects skipped, repeated, invented, misfiled and reused IDs', () => {
  const map = built();
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(map, value, passages); return result.ok ? [] : result.defects; };
  const all = [PARTICIPANT_ID, 'e1', 'e2', 'r1', 't1', 't2'];
  expect(defects(update({ keep: all.filter(id => id !== 't2') }))).toEqual([{ kind: 'skipped', id: 't2' }]);
  expect(defects(update({ keep: all, threads: [thread('t1')] }))).toEqual([{ kind: 'duplicate', id: 't1' }]);
  expect(defects(update({ keep: [...all, 'e9'] }))).toEqual([{ kind: 'unknown', id: 'e9' }]);
  expect(defects(update({ keep: all, drop: [{ id: 'x', reason: 'mistake' }] }))).toEqual([{ kind: 'unknown', id: 'x' }]);
  expect(defects(update({ keep: all.filter(id => id !== 'e1'), threads: [{ ...thread('e1') }] }))).toEqual([{ kind: 'prefix', id: 'e1', detail: 'not a previous thread' }]);
  expect(defects(update({ keep: all, entities: [entity('t3')] }))).toEqual([{ kind: 'prefix', id: 't3', detail: 'entities' }]);
  expect(defects(update({ keep: all, entities: [entity('e1x')] }))).toEqual([{ kind: 'prefix', id: 'e1x', detail: 'entities' }]);
  // e2 was dropped earlier: its number is never handed out again.
  const merged = applyMapUpdate(map, update({ keep: [PARTICIPANT_ID, 'e1', 't1'], drop: [{ id: 'e2', reason: 'mistake' }, { id: 'r1', reason: 'mistake' }, { id: 't2', reason: 'mistake' }] }), passages);
  if (!merged.ok) throw new Error('drop failed');
  const again = applyMapUpdate(merged.map, update({ keep: [PARTICIPANT_ID, 'e1', 't1'], entities: [entity('e2')] }), passages);
  expect(again.ok ? [] : again.defects).toEqual([{ kind: 'reused', id: 'e2', detail: 'next free is e3' }]);
});

test('the participant can only be kept or rewritten, never dropped or left out', () => {
  const map = built();
  const rest = ['e1', 'e2', 'r1', 't1', 't2'];
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(map, value, passages); return result.ok ? [] : result.defects; };
  expect(defects(update({ keep: rest }))).toEqual([{ kind: 'skipped', id: PARTICIPANT_ID }]);
  expect(defects(update({ keep: rest, drop: [{ id: PARTICIPANT_ID, reason: 'gone' }] }))).toContainEqual({ kind: 'participant', id: PARTICIPANT_ID, detail: 'cannot be dropped' });
  expect(defects(update({ keep: [...rest, PARTICIPANT_ID], participant: { vantage: 'x', preferences: '' } }))).toEqual([{ kind: 'duplicate', id: PARTICIPANT_ID }]);
});

test('threads and edges must resolve, and closed threads and drops need a reason', () => {
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(emptyMap(), value, passages); return result.ok ? [] : result.defects; };
  expect(defects(first({ threads: [thread('t1', { anchors: [] })] }))).toEqual([{ kind: 'dangling', id: 't1', detail: 'no anchor' }]);
  expect(defects(first({ threads: [thread('t1', { anchors: ['e7'] })] }))).toEqual([{ kind: 'dangling', id: 't1', detail: 'e7' }]);
  expect(defects(first({ threads: [thread('t1', { related: ['t1', 't8'] })] }))).toEqual([{ kind: 'dangling', id: 't1', detail: 't1' }, { kind: 'dangling', id: 't1', detail: 't8' }]);
  expect(defects(first({ edges: [{ id: 'r1', kind: 'involved', from: 'e1', to: 'e1' }] }))).toEqual([{ kind: 'dangling', id: 'r1', detail: 'self' }]);
  expect(defects(first({ edges: [{ id: 'r1', kind: 'works-for', from: PARTICIPANT_ID, to: 'e5' }] }))).toEqual([{ kind: 'dangling', id: 'r1', detail: 'e5' }]);
  expect(defects(first({ threads: [thread('t1', { status: 'off', reason: ' ' })] }))).toEqual([{ kind: 'reason', id: 't1' }]);
  const map = built();
  const result = applyMapUpdate(map, update({ keep: [PARTICIPANT_ID, 'e1', 'e2', 'r1', 't1'], drop: [{ id: 't2', reason: '' }] }), passages);
  expect(result.ok ? [] : result.defects).toEqual([{ kind: 'reason', id: 't2' }]);
});

test('participant facts need a participant passage; Sam cannot establish one', () => {
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(emptyMap(), value, passages); return result.ok ? [] : result.defects; };
  expect(defects(first({ entities: [entity('e1', { passageId: 'p3' }), entity('e2')] })))
    .toEqual([{ kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(defects(first({ entities: [entity('e1', { passageId: null }), entity('e2')] })))
    .toEqual([{ kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(defects(first({ entities: [entity('e1', { passageId: 'p99', source: 'research' }), entity('e2')] }))).toEqual([{ kind: 'passage', id: 'e1', detail: 'p99' }]);
  expect(defects(first({ entities: [entity('e1', { passageId: null, source: 'research' }), entity('e2')] }))).toEqual([]);
  // A kept entity is not rechecked: its passage may since have left the bounded transcript.
  const result = applyMapUpdate(built(), update({ keep: [PARTICIPANT_ID, 'e1', 'e2', 'r1', 't1', 't2'] }), []);
  expect(result.ok).toBe(true);
});

test('the map renders compactly for Sol, with closed threads on one line', () => {
  const map = built();
  const closed = applyMapUpdate(map, update({ keep: [PARTICIPANT_ID, 'e1', 'e2', 'r1', 't2'], threads: [thread('t1', { status: 'off', reason: 'Was on leave then.' })] }), passages);
  if (!closed.ok) throw new Error('close failed');
  expect(renderMapForSol(closed.map)).toBe([
    'participant | vantage: "App tech lead for the whole project." | preferences: ""',
    'NEXT FREE IDS e3 r2 t3',
    'ENTITIES',
    'e1 product "Entity e1": "Per the participant." [participant p2]',
    'e2 person "Dana": "Per the participant." [participant p2]',
    'EDGES',
    'r1 e2 decided e1',
    'OPEN THREADS',
    't2 "Thread t2" | anchors e2,participant | unknown: "who decided" | guess: none | related t1 | topics client-decisions',
    'CLOSED THREADS',
    't1 [off] "Thread t1": "Was on leave then."',
  ].join('\n'));
});
