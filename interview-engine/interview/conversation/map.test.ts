import { expect, test } from 'bun:test';
import { applyMapUpdate, emptyMap, PARTICIPANT_ID, renderMapForSol, type ConversationMap, type MapEntity, type MapThread, type MapUpdate } from './map';

const passages = [
  { id: 'p1', speaker: 'interviewer' as const }, { id: 'p2', speaker: 'participant' as const },
  { id: 'p3', speaker: 'interviewer' as const }, { id: 'p4', speaker: 'participant' as const },
];
const entity = (id: string, changes: Partial<MapEntity> = {}): MapEntity => ({ id, kind: 'product', label: `Entity ${id}`, detail: 'Per the participant.', source: 'participant', passageId: 'p2', ...changes });
const thread = (id: string, changes: Partial<MapThread> = {}): MapThread => ({
  id, label: `Thread ${id}`, anchors: ['e1'], unknown: 'who decided', guess: 'Dana alone', related: [], topics: ['client-decisions'], status: 'open', reason: null, ...changes,
});
const update = (changes: Partial<MapUpdate>): MapUpdate => ({ vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [], ...changes });
const first = (changes: Partial<MapUpdate> = {}) => update({
  vantage: 'App tech lead for the whole project.', preferences: [],
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

test('an update changes, closes and drops by ID, and anything it leaves out stays', () => {
  const map = built();
  const result = applyMapUpdate(map, update({
    drop: [{ id: 'e2', reason: 'merged into e3' }], entities: [entity('e3', { kind: 'person', label: 'Dana Ruiz', passageId: 'p4' })],
    close: [{ id: 't1', status: 'done', reason: 'Answered at p4.' }],
  }), passages);
  // r1 and t2 still point at e2, so dropping it alone is rejected.
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.defects).toEqual([{ kind: 'dangling', id: 'r1', detail: 'e2' }, { kind: 'dangling', id: 't2', detail: 'e2' }]);

  const fixed = applyMapUpdate(map, update({
    drop: [{ id: 'e2', reason: 'merged into e3' }], entities: [entity('e3', { kind: 'person', label: 'Dana Ruiz', passageId: 'p4' })],
    edges: [{ id: 'r1', kind: 'decided', from: 'e3', to: 'e1' }],
    threads: [thread('t2', { anchors: ['e3'], related: ['t1'] })], close: [{ id: 't1', status: 'done', reason: 'Answered at p4.' }],
  }), passages);
  expect(fixed.ok).toBe(true);
  if (!fixed.ok) return;
  expect(fixed.map.entities.map(item => item.id)).toEqual(['e1', 'e3']);
  expect(fixed.map.threads.map(item => [item.id, item.status, item.reason])).toEqual([['t1', 'done', 'Answered at p4.'], ['t2', 'open', null]]);
  expect(fixed.map.threads[0]).toEqual({ ...map.threads[0]!, status: 'done', reason: 'Answered at p4.' });
  expect(fixed.map.nextIds).toEqual({ e: 4, r: 2, t: 3 });
  expect(fixed.changes).toEqual({ added: ['e3'], changed: ['r1', 't2', 't1'], dropped: ['e2'], kept: [PARTICIPANT_ID, 'e1'] });
});

test('an empty update leaves the map as it was', () => {
  const map = built();
  const result = applyMapUpdate(map, update({}), passages);
  expect(result.ok && result.map).toEqual(map);
  expect(result.ok && result.changes).toEqual({ added: [], changed: [], dropped: [], kept: [PARTICIPANT_ID, 'e1', 'e2', 'r1', 't1', 't2'] });
});

test('revise moves an open thread’s gap without restating it; a closed thread comes back only in full', () => {
  const map = built();
  const revised = applyMapUpdate(map, update({ revise: [{ id: 't1', unknown: 'why Dana chose then', guess: 'the March budget review' }] }), passages);
  expect(revised.ok && revised.map.threads[0]).toEqual({ ...map.threads[0]!, unknown: 'why Dana chose then', guess: 'the March budget review' });
  expect(revised.ok && revised.changes.changed).toEqual(['t1']);

  const closed = applyMapUpdate(map, update({ close: [{ id: 't1', status: 'off', reason: 'Was on leave then.' }] }), passages);
  if (!closed.ok) throw new Error('close failed');
  const again = applyMapUpdate(closed.map, update({ revise: [{ id: 't1', unknown: 'who decided', guess: 'Dana' }] }), passages);
  expect(again.ok ? [] : again.defects).toEqual([{ kind: 'closed', id: 't1', detail: 'reopen it in full under threads' }]);
  const reopened = applyMapUpdate(closed.map, update({ threads: [thread('t1', { unknown: 'who decided after the leave' })] }), passages);
  expect(reopened.ok && reopened.map.threads[0]).toEqual(thread('t1', { unknown: 'who decided after the leave' }));
  // Closing a closed thread again only updates its status and reason.
  const reclosed = applyMapUpdate(closed.map, update({ close: [{ id: 't1', status: 'done', reason: 'Answered secondhand at p4.' }] }), passages);
  expect(reclosed.ok && [reclosed.map.threads[0]!.status, reclosed.map.threads[0]!.reason]).toEqual(['done', 'Answered secondhand at p4.']);
});

test('a rewritten node identical to its previous version counts as kept, whatever its key order', () => {
  const map = built();
  const all = [PARTICIPANT_ID, 'e1', 'e2', 'r1', 't1', 't2'];
  const result = applyMapUpdate(map, update({ vantage: map.participant.vantage, preferences: [], entities: [map.entities[0]!] }), passages);
  expect(result.ok && result.changes).toEqual({ added: [], changed: [], dropped: [], kept: all });
  const reversed = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).reverse()) as T;
  const reordered = applyMapUpdate(map, update({ entities: [reversed(map.entities[0]!)], threads: [reversed(map.threads[0]!)], revise: [{ id: 't2', unknown: 'who decided', guess: 'Dana alone' }] }), passages);
  expect(reordered.ok && reordered.changes).toEqual({ added: [], changed: [], dropped: [], kept: all });
});

test('an open thread’s reason is cleared, the one repair', () => {
  const result = applyMapUpdate(emptyMap(), first({ threads: [thread('t1', { reason: 'Left over from when it was done.' }), thread('t2')] }), passages);
  expect(result.ok && result.map.threads.map(item => item.reason)).toEqual([null, null]);
});

test('preferences cite the participant passage where they were expressed', () => {
  const defects = (preferences: { text: string; passageId: string }[]) => {
    const result = applyMapUpdate(emptyMap(), first({ vantage: 'App tech lead.', preferences }), passages);
    return result.ok ? [] : result.defects;
  };
  expect(defects([{ text: 'Wants concrete questions', passageId: 'p2' }])).toEqual([]);
  expect(defects([{ text: 'Wants concrete questions', passageId: 'p3' }])).toEqual([{ kind: 'passage', id: PARTICIPANT_ID, detail: 'preference citing p3, not a participant passage' }]);
  expect(defects([{ text: 'Wants concrete questions', passageId: 'p99' }])).toEqual([{ kind: 'passage', id: PARTICIPANT_ID, detail: 'preference citing p99, not a participant passage' }]);
});

test('edits name each ID once, and only previous IDs or the next free numbers', () => {
  const map = built();
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(map, value, passages); return result.ok ? [] : result.defects; };
  expect(defects(update({ threads: [thread('t1')], close: [{ id: 't1', status: 'done', reason: 'Answered.' }] }))).toEqual([{ kind: 'duplicate', id: 't1' }]);
  expect(defects(update({ revise: [{ id: 't2', unknown: 'who', guess: 'Dana' }], drop: [{ id: 't2', reason: 'mistake' }] }))).toEqual([{ kind: 'duplicate', id: 't2' }]);
  expect(defects(update({ drop: [{ id: 'x', reason: 'mistake' }] }))).toEqual([{ kind: 'unknown', id: 'x' }]);
  expect(defects(update({ close: [{ id: 't9', status: 'off', reason: 'Declined.' }] }))).toEqual([{ kind: 'unknown', id: 't9' }]);
  expect(defects(update({ revise: [{ id: 'e1', unknown: 'who', guess: 'Dana' }] }))).toEqual([{ kind: 'prefix', id: 'e1', detail: 'not a previous thread' }]);
  expect(defects(update({ threads: [{ ...thread('e1') }] }))).toEqual([{ kind: 'prefix', id: 'e1', detail: 'not a previous thread' }]);
  expect(defects(update({ entities: [entity('t3')] }))).toEqual([{ kind: 'prefix', id: 't3', detail: 'entities' }]);
  expect(defects(update({ entities: [entity('e1x')] }))).toEqual([{ kind: 'prefix', id: 'e1x', detail: 'entities' }]);
  // e03 would make a second spelling of e3.
  expect(defects(update({ entities: [entity('e03')] }))).toEqual([{ kind: 'prefix', id: 'e03', detail: 'entities' }]);
  expect(defects(update({ entities: [entity('e0')] }))).toEqual([{ kind: 'prefix', id: 'e0', detail: 'entities' }]);
  // e2 was dropped earlier: its number is never handed out again.
  const merged = applyMapUpdate(map, update({ drop: [{ id: 'e2', reason: 'mistake' }, { id: 'r1', reason: 'mistake' }, { id: 't2', reason: 'mistake' }] }), passages);
  if (!merged.ok) throw new Error('drop failed');
  const again = applyMapUpdate(merged.map, update({ entities: [entity('e2')] }), passages);
  expect(again.ok ? [] : again.defects).toEqual([{ kind: 'reused', id: 'e2', detail: 'next free is e3' }]);
});

test('the participant is never dropped, and vantage and preferences change one at a time', () => {
  const map = built();
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(map, value, passages); return result.ok ? [] : result.defects; };
  expect(defects(update({ drop: [{ id: PARTICIPANT_ID, reason: 'gone' }] }))).toContainEqual({ kind: 'participant', id: PARTICIPANT_ID, detail: 'cannot be dropped' });
  const preferences = [{ text: 'Wants concrete questions', passageId: 'p2' }];
  const withPreference = applyMapUpdate(map, update({ preferences }), passages);
  if (!withPreference.ok) throw new Error('preference failed');
  expect(withPreference.map.participant).toEqual({ vantage: map.participant.vantage, preferences });
  const moved = applyMapUpdate(withPreference.map, update({ vantage: 'App tech lead, weeks 1-6.' }), passages);
  expect(moved.ok && moved.map.participant).toEqual({ vantage: 'App tech lead, weeks 1-6.', preferences });
  expect(moved.ok && moved.changes.changed).toEqual([PARTICIPANT_ID]);
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
  const result = applyMapUpdate(map, update({ drop: [{ id: 't2', reason: '' }] }), passages);
  expect(result.ok ? [] : result.defects).toEqual([{ kind: 'reason', id: 't2' }]);
  const close = applyMapUpdate(map, update({ close: [{ id: 't1', status: 'off', reason: ' ' }] }), passages);
  expect(close.ok ? [] : close.defects).toEqual([{ kind: 'reason', id: 't1' }]);
});

test('participant facts need a participant passage; Sam cannot establish one', () => {
  const defects = (value: MapUpdate) => { const result = applyMapUpdate(emptyMap(), value, passages); return result.ok ? [] : result.defects; };
  expect(defects(first({ entities: [entity('e1', { passageId: 'p3' }), entity('e2')] })))
    .toEqual([{ kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(defects(first({ entities: [entity('e1', { passageId: null }), entity('e2')] })))
    .toEqual([{ kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(defects(first({ entities: [entity('e1', { passageId: 'p99' }), entity('e2')] })))
    .toEqual([{ kind: 'passage', id: 'e1', detail: 'p99' }, { kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  // A research fact cites the lookup event it came from, one Sol has read; a seed fact cites nothing.
  const cited = (value: MapEntity) => { const result = applyMapUpdate(emptyMap(), first({ entities: [value, entity('e2')] }), passages, ['L1']); return result.ok ? [] : result.defects; };
  expect(cited(entity('e1', { passageId: 'L1', source: 'research' }))).toEqual([]);
  expect(cited(entity('e1', { passageId: 'L2', source: 'research' }))).toEqual([{ kind: 'passage', id: 'e1', detail: 'research fact citing L2, not a lookup event' }]);
  expect(cited(entity('e1', { passageId: 'p2', source: 'research' }))).toEqual([{ kind: 'passage', id: 'e1', detail: 'research fact citing p2, not a lookup event' }]);
  expect(cited(entity('e1', { passageId: null, source: 'research' }))).toEqual([{ kind: 'passage', id: 'e1', detail: 'research fact citing nothing, not a lookup event' }]);
  expect(cited(entity('e1', { passageId: 'L1' })))
    .toEqual([{ kind: 'passage', id: 'e1', detail: 'L1' }, { kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(cited(entity('e1', { passageId: 'p2', source: 'seed' }))).toEqual([{ kind: 'passage', id: 'e1', detail: 'seed fact citing a passage' }]);
  expect(cited(entity('e1', { passageId: null, source: 'seed' }))).toEqual([]);
  // An entity left out is not rechecked: its passage may since have left the bounded transcript.
  const result = applyMapUpdate(built(), update({}), []);
  expect(result.ok).toBe(true);
});

test('the map renders compactly for Sol, with closed threads on one line', () => {
  const map = built();
  const closed = applyMapUpdate(map, update({ close: [{ id: 't1', status: 'off', reason: 'Was on leave then.' }] }), passages);
  if (!closed.ok) throw new Error('close failed');
  expect(renderMapForSol(closed.map)).toBe([
    'participant | vantage: "App tech lead for the whole project." | preferences: none',
    'NEXT FREE IDS e3 r2 t3',
    'ENTITIES',
    'e1 product "Entity e1": "Per the participant." [participant p2]',
    'e2 person "Dana": "Per the participant." [participant p2]',
    'EDGES',
    'r1 e2 decided e1',
    'OPEN THREADS',
    't2 "Thread t2" | anchors e2,participant | unknown: "who decided" | guess: "Dana alone" | related t1 | topics client-decisions',
    'CLOSED THREADS',
    't1 [off] "Thread t1": "Was on leave then."',
  ].join('\n'));
});
