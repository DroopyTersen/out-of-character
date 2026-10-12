import { expect, test } from 'bun:test';
import { ParticipantIntent } from './participantIntent';

test('an answer keeps its id until acknowledged; edited text, or the same text after acknowledgment, is a new answer', () => {
  const intent = new ParticipantIntent();
  const first = intent.answer('Five days.');
  expect(first).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), text: 'Five days.' });
  expect(intent.answer('Five days.')).toBe(first);
  const edited = intent.answer('Five days, then one.');
  expect(edited.id).not.toBe(first.id);
  // Returning to the earlier words is a new answer too: the edited one was the one left unresolved.
  expect(intent.answer('Five days.').id).not.toBe(first.id);
  const sent = intent.answer('Done.');
  intent.acknowledged('some-other-id');
  expect(intent.answer('Done.')).toBe(sent);
  intent.acknowledged(sent.id);
  expect(intent.answer('Done.').id).not.toBe(sent.id);
});

test('applying the intent sets the mute preference and the open draft on a connection, nothing else', () => {
  const intent = new ParticipantIntent();
  const applied: [string, boolean][] = [];
  const connection = { mute: (muted: boolean) => { applied.push(['mute', muted]); }, setComposing: (value: boolean) => { applied.push(['composing', value]); } };
  intent.apply(connection);
  expect(applied).toEqual([['mute', false], ['composing', false]]);
  intent.muted = true;
  intent.composing = true;
  intent.apply(connection);
  expect(applied.slice(2)).toEqual([['mute', true], ['composing', true]]);
});
